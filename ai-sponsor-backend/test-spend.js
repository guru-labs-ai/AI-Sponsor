/* Tests for spend.js: what a call costs, and that counting it never changes
   or breaks the call itself.   node test-spend.js */
const assert = require('assert');
delete process.env.DATABASE_URL;
const spend = require('./spend');
const db = require('./db');

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

(async () => {
  await t('prices every kind of token the way Anthropic bills it', () => {
    // Opus 4.8 at $5 / $25: 1,000 fresh in, 2,000 written to the 1-hour cache (2x),
    // 3,000 read from cache (0.1x), 500 out.
    const usage = { input_tokens: 1000, cache_creation_input_tokens: 2000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 },
      cache_read_input_tokens: 3000, output_tokens: 500 };
    near(spend.costOf('claude-opus-4-8', usage), (1000 * 5 + 2000 * 10 + 3000 * 0.5 + 500 * 25) / 1e6);
  });

  await t('a cache write with no lifetime breakdown is billed as the 5-minute kind', () => {
    near(spend.costOf('claude-opus-4-8', { cache_creation_input_tokens: 1000 }), 1000 * 5 * 1.25 / 1e6);
  });

  await t('Opus 5.5 cache reads are 0.05x, not 0.1x', () => {
    near(spend.costOf('claude-opus-5-5', { cache_read_input_tokens: 1e6 }), 0.2);
  });

  await t('a dated model id is priced as its model', () => {
    near(spend.costOf('claude-haiku-4-5-20251001', { input_tokens: 1e6 }), 1);
  });

  await t('an unknown model has no price rather than a guessed one', () => {
    assert.strictEqual(spend.costOf('claude-something-new', { input_tokens: 10 }), null);
  });

  await t('a counted call is sent without the bookkeeping fields and returns unchanged', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    let sent = null;
    const answer = { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'text', text: 'hi' }] };
    const client = spend.instrument({ messages: { create: async (body) => { sent = body; return answer; } } }, 'reply');
    const got = await client.messages.create({ _kind: 'notes', _who: 'wa-+1555', model: 'claude-opus-4-8', max_tokens: 5, messages: [] });
    assert.strictEqual(got, answer);
    assert.ok(!('_kind' in sent) && !('_who' in sent), 'bookkeeping fields reached the API');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'notes');
    assert.strictEqual(rows[0].who, 'wa-+1555');
    near(rows[0].cost, (100 * 5 + 10 * 25) / 1e6);
  });

  await t('the client default kind is used when a call does not say', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    const client = spend.instrument({ messages: { create: async () => ({ model: 'claude-sonnet-5', usage: { output_tokens: 1 } }) } }, 'weekly');
    await client.messages.create({ model: 'claude-sonnet-5', messages: [] });
    assert.strictEqual(rows[0].kind, 'weekly');
  });

  await t('the beta client is counted too (the language check uses it)', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    const client = spend.instrument({ messages: { create: async () => ({}) },
      beta: { messages: { create: async () => ({ model: 'claude-opus-5', usage: { input_tokens: 10 } }) } } }, 'language');
    await client.beta.messages.create({ model: 'claude-opus-5', messages: [] });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'language');
  });

  await t('a streamed reply passes every event through and is counted once at the end', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 200, cache_read_input_tokens: 50, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'message_delta', usage: { output_tokens: 40 } },
      { type: 'message_stop' },
    ];
    const stream = { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
    const client = spend.instrument({ messages: { create: async () => stream } }, 'reply');
    const s = await client.messages.create({ model: 'claude-opus-4-8', stream: true, messages: [], _who: 'reg-1' });
    const seen = [];
    for await (const e of s) seen.push(e.type);
    assert.deepStrictEqual(seen, events.map((e) => e.type));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].output, 40);
    near(rows[0].cost, (200 * 5 + 50 * 0.5 + 40 * 25) / 1e6);
  });

  await t('a sink that throws never breaks the reply', async () => {
    spend.setSink(() => { throw new Error('database down'); });
    const client = spend.instrument({ messages: { create: async () => ({ model: 'claude-opus-4-8', usage: { input_tokens: 1 } }) } }, 'reply');
    const got = await client.messages.create({ model: 'claude-opus-4-8', messages: [] });
    assert.strictEqual(got.model, 'claude-opus-4-8');
  });

  await t('a failed API call still fails the same way and is not counted', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    const client = spend.instrument({ messages: { create: async () => { throw new Error('credit balance is too low'); } } }, 'reply');
    await assert.rejects(() => client.messages.create({ model: 'claude-opus-4-8', messages: [] }), /credit balance/);
    assert.strictEqual(rows.length, 0);
  });

  await t('instrumenting twice does not count a call twice', async () => {
    const rows = [];
    spend.setSink((r) => rows.push(r));
    const raw = { messages: { create: async () => ({ model: 'claude-opus-4-8', usage: { input_tokens: 1 } }) } };
    spend.instrument(raw, 'reply');
    spend.instrument(raw, 'reply');
    await raw.messages.create({ model: 'claude-opus-4-8', messages: [] });
    assert.strictEqual(rows.length, 1);
  });

  await t('without a database, recording and reading are quiet no-ops', async () => {
    assert.strictEqual(db.enabled, false);
    await db.recordSpend('members', { kind: 'reply', model: 'x', cost: 1 });
    assert.strictEqual(await db.getSpend(), null);
    assert.strictEqual(await db.isTeamUser('wa-+1555'), false);
  });

  spend.setSink(null);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
