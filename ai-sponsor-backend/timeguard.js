/* ── The time guard ──────────────────────────────────────────────────────────
   A last check on a finished reply: it must not place an earlier conversation
   inside "tonight" when the person last wrote hours or days ago.

   WHY (13-14 Nov 2026). A long-standing member had to tell the sponsor "It's
   not the same night. It's weeks later." Three times it called a conversation
   from two weeks or two months before "tonight": "we've been circling it for a
   while tonight", "after a night like this one", "I kept guessing wrong
   tonight". She asked to delete everything. The real fix is upstream (the
   history now carries its dates, see withTimeMarkers in server.js); this is the
   belt to those braces, a rule that does not depend on the model behaving.

   DELIBERATELY NARROW. A wrong fix is worse than a missed one: "You went to a
   meeting tonight, that's huge" is right when they just told you so. So it
   only acts when ALL of these hold:
     - their previous message was at least six hours ago,
     - their message now says nothing about tonight, today or this evening
       (if it does, the reply's "tonight" is probably about what they said),
     - the reply uses one of a short list of phrasings that can only mean an
       earlier conversation was tonight (or, after two days, "yesterday").
   Each match is rewritten to "last time" (or close to it), nothing else is
   touched, and every change is logged.

   Pure functions, no model call, so it costs nothing and is fully testable. */

const GAP_MS = 6 * 3600000;
const YESTERDAY_GAP_MS = 2 * 24 * 3600000;

/* They mentioned the present themselves: leave the reply alone. */
const THEY_SAID_NOW = /\b(?:tonight|today|this (?:morning|afternoon|evening)|earlier|just now|right now|yesterday)\b/i;

/* [pattern, replacement]. Replacements keep the sentence reading naturally. */
const RULES = [
  [/\bearlier (?:tonight|today|this (?:morning|afternoon|evening))\b/gi, 'last time'],
  [/\bfor a while tonight\b/gi, 'for a while'],
  [/\bso far tonight\b/gi, 'so far'],
  [/\ball tonight\b/gi, 'all this time'],
  [/\b(?:a|one) night like (?:this one|this|tonight)\b/gi, 'all of this'],
  [/\b(?:in )?this same (?:night|conversation|sitting)\b/gi, 'in our last conversation'],
  [/\btonight'?s conversation\b/gi, 'our last conversation'],
  /* The sponsor talking about itself and the conversation: "I kept guessing
     wrong tonight", "I got a lot wrong tonight", "we talked about it tonight".
     Only these verbs: "I'm here tonight" or "I was thinking of you tonight"
     are about now and must survive. */
  [/\b((?:I|we)(?:'ve|’ve| have| had)?\s+(?:kept|got|guessed|said|told|asked|talked|spoke|missed|covered|circled|mixed|confused)\b[^.?!\n]{0,60}?\b)tonight\b/gi, '$1last time'],
  [/\b(me getting\b[^.?!\n]{0,40}?\b)tonight\b/gi, '$1last time'],
];

const YESTERDAY_RULES = [
  /* "like you said yesterday", "we talked about it yesterday" after a gap of
     days: the conversation was not yesterday. */
  [/\b((?:you|we|I)\s+(?:said|told me|mentioned|talked about|spoke about|asked)\b[^.?!\n]{0,40}?\b)yesterday\b/gi, '$1last time'],
];

function sameCase(original, replacement) {
  return original && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
    ? replacement[0].toUpperCase() + replacement.slice(1)
    : replacement;
}

/**
 * @param {string} reply     the finished reply
 * @param {Date|string|null} lastAt  when they last wrote BEFORE this message
 * @param {string} theirMessage      what they wrote now
 * @param {Date} now
 * @returns {{ text: string, fixed: Array<{said: string, now: string}> }}
 */
function fixSameSitting(reply, lastAt, theirMessage, now = new Date()) {
  const text = String(reply || '');
  const out = { text, fixed: [] };
  if (!text || !lastAt) return out;
  const gap = now.getTime() - new Date(lastAt).getTime();
  if (!(gap >= GAP_MS)) return out;
  if (THEY_SAID_NOW.test(String(theirMessage || ''))) return out;

  let result = text;
  const rules = gap >= YESTERDAY_GAP_MS ? RULES.concat(YESTERDAY_RULES) : RULES;
  for (const [re, rep] of rules) {
    result = result.replace(re, (match, ...groups) => {
      const fixed = sameCase(match, rep.replace('$1', typeof groups[0] === 'string' ? groups[0] : ''));
      if (fixed !== match) out.fixed.push({ said: match, now: fixed });
      return fixed;
    });
  }
  out.text = result;
  return out;
}

module.exports = { fixSameSitting, GAP_MS, _RULES: RULES };
