/* ─── Replies the length a person would actually write ───────────────────────
   Run: node test-reply-length.js

   WHY THIS EXISTS. 573 real replies were measured out of the live database on
   9 Sep 2026:

     the person   median  16 words
     the sponsor  median 116 words

   Seven times what it was answering, every time. 83% ran to three or more
   paragraphs, only 5% were short, 58% ended with a question. A beta member said
   they could still feel it was an AI, and that shape is why: it gives itself
   away before anybody reads a sentence.

   ⭐ THE PROMPT HAD ALREADY ASKED FOR ALL OF THIS and was followed about 5% of
   the time. What worked in the same prompt were the hard bans: "no em dashes,
   ever" got em dashes to 1%. So length and the question habit moved out of
   prose and into the routing layer, and this file guards them.

   Lifts the real functions out of server.js rather than copying them, the same
   way test-reactions.js lifts deservesReaction. Requiring server.js would start
   a listener, and a second copy is a copy that drifts.                        */

const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const body = src.slice(
  src.indexOf('const CRISIS_RESOURCE ='),
  src.indexOf('/* ── What they put on your messages')
);
const { replyBudget, dropTrailingQuestion, words } = new Function(
  `${body.replace(/console\.log\([^)]*\);/g, '')}; return { replyBudget, dropTrailingQuestion, words };`
)();

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}
const say = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

console.log('\n── The budget follows the person, not a fixed size ──');

check('a one line message does not earn three paragraphs', () => {
  const b = replyBudget(say(16), { history: [] });          // the real median
  assert.ok(b.target <= 40, `target was ${b.target} for a 16 word message`);
  assert.ok(b.target >= 12, `target was ${b.target}, too small to say anything`);
});

check('a long message earns a longer reply', () => {
  const short = replyBudget(say(10), { history: [] });
  const long = replyBudget(say(120), { history: [] });
  assert.ok(long.target > short.target, `${long.target} should beat ${short.target}`);
});

check('but never an essay, however much they wrote', () => {
  const b = replyBudget(say(600), { history: [] });
  assert.ok(b.target <= 110, `target ran to ${b.target}`);
});

check('a real question earns room to answer it', () => {
  const plain = replyBudget(say(12), { history: [] });
  const asked = replyBudget('what should I expect from step two?', { history: [] });
  assert.ok(asked.target > plain.target, 'a question should not be answered in eight words');
});

check('the very first message is allowed to introduce itself', () => {
  const b = replyBudget('hi', { history: [], isFirst: true });
  assert.ok(b.target >= 60, `first message target was only ${b.target}`);
});

console.log('\n── Crisis is exempt from all of it ──');

check('a reply near a crisis message is never shortened', () => {
  const history = [{ role: 'assistant', content: 'Please call or text 988 right now.' }];
  const b = replyBudget(say(8), { history });
  assert.strictEqual(b.target, null);
  assert.strictEqual(b.ceiling, null);
  assert.strictEqual(b.exempt, 'crisis');
});

check('the exemption is not permanent, it follows the recent turns', () => {
  const history = [
    { role: 'assistant', content: 'Please call 988.' },
    ...Array.from({ length: 5 }, (_, i) => ({ role: 'assistant', content: `ordinary ${i}` })),
  ];
  assert.ok(replyBudget(say(8), { history }).target, 'still exempt long after the crisis passed');
});

console.log('\n── Not two questions in a row ──');

check('a trailing question is removed', () => {
  const out = dropTrailingQuestion("Eight days. That counts. What made you go back?");
  assert.strictEqual(out, 'Eight days. That counts.');
});

check('several trailing questions all go', () => {
  const out = dropTrailingQuestion('That lands hard. How long has it been? Are you okay?');
  assert.strictEqual(out, 'That lands hard.');
});

check('a question in the middle is left alone', () => {
  const t = 'What made you go back? It counts either way.';
  assert.strictEqual(dropTrailingQuestion(t), t);
});

check('a reply that is ONLY a question is left alone', () => {
  // Nothing would be left to send, and silence is not the same as a message.
  const t = 'How long has it been?';
  assert.strictEqual(dropTrailingQuestion(t), t);
});

check('a crisis question is never removed', () => {
  const t = 'Please call 988 now. Will you do that for me?';
  assert.strictEqual(dropTrailingQuestion(t), t,
    'the most important question in the product must survive');
});

check('a reply with no question is untouched', () => {
  const t = 'Eight days. That counts, and you did it.';
  assert.strictEqual(dropTrailingQuestion(t), t);
});

check('it never returns something too short to send', () => {
  const out = dropTrailingQuestion('Yeah. Why?');
  assert.ok(words(out) >= 2, `left "${out}"`);
});

console.log('\n── Wired into the reply that goes out ──');

check('the budget is computed and put in front of the model', () => {
  assert.ok(/const budget = replyBudget\(message, \{ history: usableHistory/.test(src),
    'replyBudget is not being called on the real reply path');
  assert.ok(src.includes('HOW LONG THIS PARTICULAR REPLY SHOULD BE'),
    'the length is computed and then never told to the model');
});

check('an overshoot is actually rewritten, not just noted', () => {
  assert.ok(/if \(budget\.ceiling && words\(rawReply\) > budget\.ceiling\)/.test(src),
    'nothing acts on the ceiling');
  assert.ok(/rawReply = cut;/.test(src), 'the tightened copy is never used');
});

check('the question rule is enforced on the way out, not just requested', () => {
  assert.ok(/const trimmed = dropTrailingQuestion\(rawReply\)/.test(src),
    'dropTrailingQuestion is never called on the real reply');
  assert.ok(/lastReplyAskedSomething\.set\(userId/.test(src),
    'nothing remembers whether the last reply asked something');
});

console.log(`\n${failed ? 'FAILED' : 'All good'}: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
