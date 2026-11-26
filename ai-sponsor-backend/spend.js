/* What each call to Claude costs, and who it was for.

   Matt, 20 Nov: "is that cost usage from users or is that cost us from
   building? ... both of those need to be segregated". The Anthropic console
   shows one bill for everything on the account, and on test days our own test
   runs were most of it (15 Nov: $122 with 31 member replies; 19 and 20 Nov:
   under $5 with about 50 replies each). A per-person cost read off that bill
   is wrong by whatever we happened to test that day.

   So every call is priced here from the token counts Anthropic sends back
   with it, at Anthropic's list prices, and handed to a sink that files it
   under who it was for:
     members  real people talking to the live sponsor
     team     the team's own accounts on the live sponsor (EXCLUDED_PEOPLE /
              EXCLUDED_NAMES, the same list every other metric leaves out)
     testing  test runs (evals/run-eval.js), which never touch the live
              server and report their own total when they finish

   The live server's sink is set in server.js. The test runner replaces it
   with its own tally. Nothing here can stop a reply: every failure is
   swallowed and the call's own result is returned untouched.

   Prices are dollars per million tokens, Anthropic list prices as published
   on 20 Nov 2026. Cache writes are 1.25x the input price for the 5-minute
   cache and 2x for the 1-hour one; cache reads are 0.1x, except on the
   models marked otherwise. A model missing from this table is still counted
   (calls and tokens) with a cost of 0 and logged once, so a model change
   shows up as a gap rather than a wrong number. */

const PRICES = {
  'claude-opus-4-8':   { input: 5, output: 25, read: 0.1 },
  'claude-opus-5':     { input: 5, output: 25, read: 0.1 },
  'claude-opus-5-5':   { input: 4, output: 20, read: 0.05 },
  'claude-sonnet-5':   { input: 2, output: 10, read: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.05 },
  'claude-haiku-4-5':  { input: 1, output: 5,  read: 0.1 },
};

const unpriced = new Set();

function priceOf(model) {
  // 'claude-haiku-4-5-20251001' is priced as 'claude-haiku-4-5'.
  const base = String(model || '').replace(/-\d{8}$/, '');
  return PRICES[base] || null;
}

/* The four kinds of input token, split the way they are billed. When the
   API breaks cache writes down by lifetime we use that; older responses only
   give the total, which is billed as the 5-minute kind. */
function tokensOf(usage) {
  const u = usage || {};
  const cc = u.cache_creation || null;
  let write5m = 0;
  let write1h = 0;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    write5m = Number(cc.ephemeral_5m_input_tokens) || 0;
    write1h = Number(cc.ephemeral_1h_input_tokens) || 0;
  } else {
    write5m = Number(u.cache_creation_input_tokens) || 0;
  }
  return {
    input: Number(u.input_tokens) || 0,
    write5m,
    write1h,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
  };
}

/* Web search is billed per search on top of tokens: $10 per 1,000 searches
   (Anthropic pricing page, read 26 Nov 2026). Only the sponsor's fuller
   answers search (server.js writeFollowup). */
const SEARCH_DOLLARS = 0.01;
function searchesOf(usage) {
  const s = usage && usage.server_tool_use;
  return (s && Number(s.web_search_requests)) || 0;
}

function costOf(model, usage) {
  const p = priceOf(model);
  if (!p) return null;
  const t = tokensOf(usage);
  const dollars =
    t.input * p.input +
    t.write5m * p.input * 1.25 +
    t.write1h * p.input * 2 +
    t.cacheRead * p.input * p.read +
    t.output * p.output;
  return dollars / 1e6 + searchesOf(usage) * SEARCH_DOLLARS;
}

let sink = null;
function setSink(fn) { sink = typeof fn === 'function' ? fn : null; }

/* One finished call. `who` is the user id the call was for, when there is
   one; the sink decides members or team from it. */
function track(kind, model, usage, who) {
  try {
    if (!usage) return;
    const t = tokensOf(usage);
    let cost = costOf(model, usage);
    if (cost == null) {
      if (!unpriced.has(model)) {
        unpriced.add(model);
        console.error(`[spend] no price for ${model}; counting its tokens with a cost of $0. Add it to spend.js.`);
      }
      cost = 0;
    }
    const row = {
      kind: kind || 'reply',
      model: String(model || 'unknown'),
      who: who || null,
      calls: 1,
      input: t.input,
      cacheWrite: t.write5m + t.write1h,
      cacheRead: t.cacheRead,
      output: t.output,
      cost,
    };
    if (!sink) return;
    Promise.resolve(sink(row)).catch((e) => console.error('[spend] could not record a call:', e.message));
  } catch (e) {
    console.error('[spend] could not price a call:', e.message);
  }
}

/* A streamed reply reports its input tokens at the start and its output
   tokens at the end. This passes every event through unchanged and records
   the call once the stream has finished. Only `for await` is used on these
   streams in server.js, so that is the one thing wrapped. */
function watchStream(stream, kind, model, who) {
  try {
    const iterate = stream[Symbol.asyncIterator].bind(stream);
    let usage = null;
    stream[Symbol.asyncIterator] = async function* tracked() {
      try {
        for await (const event of { [Symbol.asyncIterator]: iterate }) {
          try {
            if (event && event.type === 'message_start' && event.message && event.message.usage) {
              usage = { ...event.message.usage };
            } else if (event && event.type === 'message_delta' && event.usage) {
              usage = { ...(usage || {}), ...event.usage };
            }
          } catch (_) { /* never let counting break the reply */ }
          yield event;
        }
      } finally {
        track(kind, model, usage, who);
      }
    };
  } catch (e) {
    console.error('[spend] could not watch a stream:', e.message);
  }
  return stream;
}

/* Wraps client.messages.create (and client.beta.messages.create) so every
   call is counted without each call site doing it. A call site can say what
   it is for with two extra fields, which are taken off before the request is
   sent, so Anthropic never sees them:
     _kind  'reply' (the default for this client), 'notes', 'weekly', ...
     _who   the user id the call is for */
function instrument(client, defaultKind) {
  const wrap = (messages) => {
    if (!messages || typeof messages.create !== 'function' || messages.__spendWrapped) return;
    const original = messages.create.bind(messages);
    messages.create = (params, options) => {
      const { _kind, _who, ...body } = params || {};
      const kind = _kind || defaultKind || 'reply';
      const result = original(body, options);
      return result.then((res) => {
        if (body.stream) return watchStream(res, kind, body.model, _who);
        track(kind, (res && res.model) || body.model, res && res.usage, _who);
        return res;
      });
    };
    messages.__spendWrapped = true;
  };
  try {
    wrap(client && client.messages);
    wrap(client && client.beta && client.beta.messages);
  } catch (e) {
    console.error('[spend] could not instrument a client:', e.message);
  }
  return client;
}

module.exports = { PRICES, SEARCH_DOLLARS, priceOf, tokensOf, searchesOf, costOf, setSink, track, instrument, watchStream };
