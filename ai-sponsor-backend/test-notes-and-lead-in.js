/* Two fixes from 18 Nov, tested without a database or a model.

   1. A cut question takes the sentence that set it up with it
      (server.js dropTrailingQuestion). 16 Nov: a reply ended "You keep going
      back to OA meetings." because the question after it was cut.
   2. The notes about a person say how old they are (server.js
      buildMemoryBlock). Old notes read as now: "one week sober" from August.

   Both are lifted out of server.js the same way test-reply-length.js does, so
   there is no copy to drift. */

const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const lengthBody = src.slice(src.indexOf('const CRISIS_RESOURCE ='), src.indexOf('/* ── What they put on your messages'));
const { dropTrailingQuestion } = new Function(
  `${lengthBody.replace(/console\.log\([^)]*\);/g, '')}; return { dropTrailingQuestion };`
)();
const memBody = src.slice(src.indexOf('function buildMemoryBlock'), src.indexOf('// One in-flight summary'));
const { buildMemoryBlock } = new Function(`${memBody}; return { buildMemoryBlock };`)();

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('A cut question takes its set-up with it');
for (const [input, want] of [
  // the 16 Nov shape
  ['That makes sense. You keep going back to OA meetings. What do you get from them?', 'That makes sense.'],
  ["I hear you. Every time you call her it ends like this. What would you want her to hear?", 'I hear you.'],
  ["That's real. You always put everyone else first. Where are you in all this?", "That's real."],
  ["That's a lot. It sounds like you keep coming back to that night. What happened after?", "That's a lot."],
  // announcing a question
  ["That makes sense. I'm curious about something. What's pulling you there?", 'That makes sense.'],
  ['That lands hard. Can I ask you something. Who knows about this?', 'That lands hard.'],
  ["Good on you for going. Here's my question:\nwhat did you hear there?", 'Good on you for going.'],
  // a real sentence before the question stays
  ['You did the hard part. What happened next?', 'You did the hard part.'],
  ['You keep showing up. That counts. What was today like?', 'You keep showing up. That counts.'],
  ["That's a big step. Whenever you're ready, we start. What first?", "That's a big step. Whenever you're ready, we start."],
  ["Here are two:\nhttps://a.org/x\nhttps://b.org/y\nWant more?", "Here are two:\nhttps://a.org/x\nhttps://b.org/y"],
]) check(JSON.stringify(input), () => assert.strictEqual(dropTrailingQuestion(input), want));

console.log('\nWhen nothing real would be left, the question stays');
for (const input of [
  'You keep going back to OA meetings. What draws you there?',
  "I'm curious about something. What's pulling you there?",
  'Here are two meetings:\nWhich one suits you?',
]) check(JSON.stringify(input), () => assert.strictEqual(dropTrailingQuestion(input), input));

console.log('\nUnchanged from before');
check('no question, nothing cut', () => assert.strictEqual(dropTrailingQuestion('That counts.'), 'That counts.'));
check('a crisis reply is never touched', () => {
  const t = "I'm worried about you. Call or text 988 now. Will you call them right now?";
  assert.strictEqual(dropTrailingQuestion(t), t);
});

console.log('\nThe notes say how old they are');
const mem = { digest: '- sober since 2026-08-01 (said one week on 2026-08-08)\n- voice not available', upto: 812, uptoAt: '2026-11-16T14:05:54.000Z' };
const block = buildMemoryBlock(mem);
check('says when the notes were last brought up to date', () => assert.ok(/last brought up to date on 16 November 2026/.test(block)));
check('says they describe then, not now', () => assert.ok(/how things were when they told you, not how they are now/.test(block)));
check('one mention is not a habit', () => assert.ok(/never call it a habit of theirs/.test(block)));
check('what the sponsor can do is not decided by the notes', () => assert.ok(/what you can or cannot do \(voice notes, meetings, reminders\) is not about them/.test(block)));
check('keeps the count rule', () => assert.ok(/A count with no date beside it is out of date/.test(block)));
check('the notes themselves follow', () => assert.ok(block.endsWith(mem.digest)));
check('same notes, same block (stays cached)', () => assert.strictEqual(buildMemoryBlock({ ...mem }), block));
check('no date known: no date claimed', () => {
  const b = buildMemoryBlock({ digest: 'x', upto: 3, uptoAt: null });
  assert.ok(!/brought up to date/.test(b) && /not how they are now/.test(b));
});
check('a bad date is ignored', () => assert.ok(!/brought up to date/.test(buildMemoryBlock({ digest: 'x', uptoAt: 'nope' }))));
check('no digest, no block', () => assert.strictEqual(buildMemoryBlock({ digest: '' }), null));
check('no memory, no block', () => assert.strictEqual(buildMemoryBlock(null), null));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
