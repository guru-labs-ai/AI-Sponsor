/* ─── Reactions in, emoji out ─────────────────────────────────────────────────
   Two separate things, and before Sep 2026 they were both wrong in opposite
   ways.

   INBOUND. Somebody long-presses a message and puts an emoji on it. Meta sends
   `type: "reaction"`, and normalise() had no branch for it, so it fell through
   with empty text and hit the unsupported branch in whatsapp.js, which answers
   "I can receive text and voice messages. Please try sending one of those!".
   That branch sits in FRONT of the typing debounce, so nothing batched it: one
   reply per reaction, instantly. Matt reacted four times and got the same line
   back four times (screenshot IMG_1950, 7 Sep).

   OUTBOUND. The sponsor's own replies carried no emoji at all, because nothing
   in the prompt ever mentioned them: 1 message in 1,128 across the whole live
   history. The prompt now allows them occasionally, and this file pins the one
   place where "occasionally" must be "never".

   Runs against the real modules, no mocks of the thing under test. Same
   approach as test-reactions.js and test-metawebhook.js.                      */

const assert = require('assert');
const { normalise } = require('./metawebhook');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}

/* Meta's envelope, trimmed to the shape normalise() actually reads. */
function envelope(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { messages: [message] } }] }],
  };
}
const reaction = (emoji, on = 'wamid.ORIGINAL') => envelope({
  from: '13075551234', id: 'wamid.REACTION', type: 'reaction',
  reaction: { message_id: on, emoji },
});

console.log('\n── A reaction is read, not discarded ──');

check('a reaction is parsed rather than falling through as unknown', () => {
  const [m] = normalise(reaction('\u{1F44D}'));
  assert.strictEqual(m.type, 'reaction');
  assert.strictEqual(m.isReaction, true);
  assert.strictEqual(m.reactionEmoji, '\u{1F44D}');
});

check('it carries the id of the message it was placed on', () => {
  const [m] = normalise(reaction('❤️', 'wamid.THE_ONE_THEY_TAPPED'));
  assert.strictEqual(m.reactedTo, 'wamid.THE_ONE_THEY_TAPPED');
});

check('every emoji from the screenshot survives, including the thumbs down', () => {
  for (const e of ['❤️', '\u{1F44D}', '\u{1F64F}', '\u{1F44E}']) {
    const [m] = normalise(reaction(e));
    assert.strictEqual(m.reactionEmoji, e, `lost ${e}`);
    assert.strictEqual(m.isReaction, true);
  }
});

check('removing a reaction is kept, not mistaken for a malformed one', () => {
  // Meta signals "they took it back off" with an empty emoji string.
  const [m] = normalise(reaction(''));
  assert.strictEqual(m.isReaction, true);
  assert.strictEqual(m.reactionEmoji, '');
});

check('a reaction still carries no text, so it can never look like a message', () => {
  const [m] = normalise(reaction('\u{1F44D}'));
  assert.strictEqual(m.text, '');
  assert.strictEqual(m.isAudio, false);
});

check('an ordinary text message is untouched and is not flagged as a reaction', () => {
  const [m] = normalise(envelope({
    from: '13075551234', id: 'wamid.TEXT', type: 'text',
    text: { body: 'day 8 today \u{1F64F}' },
  }));
  assert.strictEqual(m.isReaction, false);
  assert.strictEqual(m.text, 'day 8 today \u{1F64F}');   // typed emoji were never the problem
});

check('a reaction with no reaction object does not throw', () => {
  const [m] = normalise(envelope({ from: '13075551234', id: 'wamid.X', type: 'reaction' }));
  assert.strictEqual(m.isReaction, true);
  assert.strictEqual(m.reactionEmoji, '');
  assert.strictEqual(m.reactedTo, null);
});

console.log('\n── The reply flow refuses to answer one ──');

check('the handler returns before the unsupported branch can fire', () => {
  /* The guarantee is structural, so it is asserted against the source: the
     reaction check has to come BEFORE the line that sends the fallback, or the
     four-replies bug is still there. */
  const src = require('fs').readFileSync(require.resolve('./whatsapp.js'), 'utf8');
  const guard = src.indexOf('if (isReaction) {');
  /* The sending line, not the comment above the guard that quotes it. */
  const fallback = src.indexOf('sendTextReply(fromPhone, "I can receive text and voice messages');
  assert.ok(guard > 0, 'the reaction guard is gone from whatsapp.js');
  assert.ok(fallback > 0, 'the fallback line moved, this test needs updating');
  assert.ok(guard < fallback,
    'the reaction guard must come before the fallback reply, or reactions get answered again');
});

check('a reaction is recorded, so it is not invisible in the reader', () => {
  const src = require('fs').readFileSync(require.resolve('./whatsapp.js'), 'utf8');
  const guard = src.indexOf('if (isReaction) {');
  const block = src.slice(guard, guard + 900);
  assert.ok(/recordEvent\(.*?'reaction_received'/.test(block.replace(/\s+/g, ' ')),
    'a reaction should still leave a trace, even though it draws no reply');
});

console.log('\n── An emoji never shares a message with a crisis number ──');

/* Lifted out of server.js rather than copied, the same way test-reactions.js
   lifts deservesReaction. Requiring server.js would start a listener, and a
   second copy of the rule is a copy that can drift silently. This runs the real
   regexes. */
const serverSrc = require('fs').readFileSync(require.resolve('./server.js'), 'utf8');
const guardBody = serverSrc.slice(
  serverSrc.indexOf('const CRISIS_RESOURCE ='),
  serverSrc.indexOf('async function getSponsorReply')
);
const stripEmojiNearCrisis = new Function(
  `${guardBody.replace(/console\.log\([^)]*\);/g, '')}; return stripEmojiNearCrisis;`
)();

check('the guard is still wired into the reply that goes out', () => {
  assert.ok(guardBody.includes('function stripEmojiNearCrisis'),
    'stripEmojiNearCrisis is gone from server.js');
  assert.ok(serverSrc.includes('stripEmojiNearCrisis(voices.stripSpeechTags('),
    'the guard exists but nothing calls it, so nothing is guaranteed');
});

check('a heart next to 988 is removed', () => {
  const out = stripEmojiNearCrisis('Please call 988 now. I am here. ❤️');
  assert.ok(!/❤/.test(out), out);
  assert.ok(out.includes('988'));
  assert.ok(!/\s$/.test(out), 'left trailing whitespace behind');
});

check('it strips mid-sentence without leaving a double space', () => {
  const out = stripEmojiNearCrisis('Text HOME to 741741 \u{1F64F} and stay with me.');
  assert.strictEqual(out, 'Text HOME to 741741 and stay with me.');
});

check('skin tones and joined sequences go too', () => {
  const out = stripEmojiNearCrisis('Call the crisis line. \u{1F44D}\u{1F3FB}\u{1F468}‍\u{1F469}‍\u{1F466}');
  assert.strictEqual(out, 'Call the crisis line.');
});

check('an ordinary warm message keeps its emoji', () => {
  const warm = 'Eight days. That is not nothing. \u{1F64C}';
  assert.strictEqual(stripEmojiNearCrisis(warm), warm);
});

check('a crisis message with no emoji is returned untouched', () => {
  const t = 'Call 988. I am not going anywhere.';
  assert.strictEqual(stripEmojiNearCrisis(t), t);
});

check('non-strings do not throw', () => {
  assert.strictEqual(stripEmojiNearCrisis(null), null);
  assert.strictEqual(stripEmojiNearCrisis(undefined), undefined);
});

console.log('\n── The web chat streams, so it gets the cheaper half of the same rule ──');

/* Replays the delta sequence from the live test conversation that exposed this:
   the sponsor wrote "...put 988 in your phone? Just save it." and closed with a
   white heart, and the web chat sent it. */
function streamOut(deltas) {
  const { CRISIS_RESOURCE, ANY_EMOJI } = new Function(
    `${guardBody.replace(/console\.log\([^)]*\);/g, '')}; return { CRISIS_RESOURCE, ANY_EMOJI };`
  )();
  let full = '', sent = '';
  for (const d of deltas) {
    let piece = d;
    if (CRISIS_RESOURCE.test(full)) piece = piece.replace(ANY_EMOJI, '');
    full += piece;
    sent += piece;
  }
  return sent;
}

check('the streaming guard is wired into /api/chat', () => {
  assert.ok(/if \(CRISIS_RESOURCE\.test\(fullResponse\)\) piece = piece\.replace\(ANY_EMOJI, ''\);/.test(serverSrc),
    'the web chat no longer strips emoji after a crisis number');
  assert.ok(serverSrc.includes('fullResponse += piece;'),
    'the persisted copy must be the cleaned one, or history and what was sent disagree');
});

check('an emoji after a crisis number never reaches the browser', () => {
  const sent = streamOut(['Put ', '988', ' in your phone.', ' Just save it. ', '\u{1F90D}']);
  assert.ok(!/\u{1F90D}/u.test(sent), sent);
  assert.ok(sent.includes('988'));
});

check('an ordinary streamed reply keeps its emoji', () => {
  const sent = streamOut(['Eight days.', ' That counts. ', '\u{1F64C}']);
  assert.ok(/\u{1F64C}/u.test(sent), sent);
});

check('the known hole is the documented one, not a surprise', () => {
  // An emoji BEFORE the number still goes out: tokens cannot be recalled.
  const sent = streamOut(['\u{1F90D}', ' Please call ', '988', ' now.']);
  assert.ok(/\u{1F90D}/u.test(sent),
    'if this ever passes, the stream is being buffered and the comment is wrong');
});

console.log('\n── A thumbs down informs tone, and never more than that ──');

const buildReactionBlock = new Function(
  `${guardBody.replace(/console\.log\([^)]*\);/g, '')}; return buildReactionBlock;`
)();

const react = (...e) => e.map((emoji) => ({ emoji, removed: false, at: new Date() }));
const said = (content) => ({ role: 'assistant', content });
const them = (content) => ({ role: 'user', content });

check('nothing to say when nobody reacted', () => {
  assert.strictEqual(buildReactionBlock([], [said('hey')]), null);
  assert.strictEqual(buildReactionBlock(null, []), null);
});

check('a reaction reaches the sponsor at all, which it never did before', () => {
  const b = buildReactionBlock(react('\u{1F44D}'), [said('good to hear from you')]);
  assert.ok(b && b.includes('\u{1F44D}'), b);
});

/* Mariam, 9 Sep: "we don't want the thumbs down reactions at all, maybe with
   the negative emojis only the sad and crying emoji and thats it." */
check('a thumbs down NEVER reaches the sponsor', () => {
  assert.strictEqual(
    buildReactionBlock(react('\u{1F44E}'), [said('I think you already know the answer')]),
    null);
});

check('a thumbs down does not smuggle itself in beside a warm one', () => {
  const b = buildReactionBlock(react('\u{1F44E}', '\u{1F44D}'), [said('anything')]);
  assert.ok(b, 'the thumbs up should still land');
  assert.ok(!/\u{1F44E}/u.test(b), 'the thumbs down leaked into the prompt: ' + b);
});

check('angry, sick and the rest of the dismissive set are not shown either', () => {
  for (const e of ['\u{1F621}', '\u{1F92E}', '\u{1F4A9}', '\u{1F595}', '\u{1F644}']) {
    assert.strictEqual(buildReactionBlock(react(e), [said('anything')]), null, `${e} was shown`);
  }
});

check('anything unrecognised falls to silence rather than into the prompt', () => {
  assert.strictEqual(buildReactionBlock(react('\u{1F996}'), [said('anything')]), null);
});

check('a thumbs up still lands, whichever skin tone sent it', () => {
  const b = buildReactionBlock(react('\u{1F44D}\u{1F3FF}'), [said('anything')]);
  assert.ok(b && b.includes('\u{1F44D}\u{1F3FF}'), b);
});

check('it can never override what the sponsor was going to say', () => {
  const b = buildReactionBlock(react('\u{1F44D}'), [said('anything')]);
  assert.ok(/never changes what you were going to say/i.test(b), b);
});

console.log('\n── Sad and crying are the exception, and they get heard ──');

check('a crying face is shown, and told to land', () => {
  const b = buildReactionBlock(react('\u{1F62D}'), [said('that sounds like a hard week')]);
  assert.ok(b && b.includes('\u{1F62D}'), b);
  assert.ok(/telling you how they feel/i.test(b), b);
  assert.ok(/Be gentler, go slower/i.test(b), b);
});

check('a sad face gets the same treatment', () => {
  const b = buildReactionBlock(react('\u{1F622}'), [said('anything')]);
  assert.ok(/sad or crying face/i.test(b), b);
});

check('the gentler instruction does NOT appear for a warm reaction', () => {
  const b = buildReactionBlock(react('❤️'), [said('anything')]);
  assert.ok(!/Be gentler, go slower/i.test(b), b);
});

check('it is never turned into a question about the emoji', () => {
  const b = buildReactionBlock(react('\u{1F62D}'), [said('anything')]);
  assert.ok(/do not ask them what the emoji meant/i.test(b), b);
});

check('the sponsor is told not to mention or thank them for it', () => {
  const b = buildReactionBlock(react('❤️'), [said('anything')]);
  assert.ok(/Never announce that you noticed it/i.test(b), b);
});

/* The half that is in code rather than the prompt. */
check('NOTHING is surfaced when the recent conversation carried a crisis number', () => {
  const history = [
    them('I dont want to be here anymore'),
    said('Please call or text 988. It is the Suicide and Crisis Lifeline.'),
    them('ok'),
  ];
  /* A thumbs up, not a thumbs down: this has to fail on the CRISIS check, not
     on the allow-list, or it would pass even with the crisis rule deleted. */
  assert.strictEqual(buildReactionBlock(react('\u{1F44D}'), history), null);
});

check('even a crying face is withheld next to a crisis reply', () => {
  /* The one place the sad exception does not apply. Reading distress off a
     reaction is the wrong move while a hotline number is on the screen. */
  const history = [said('Text HOME to 741741 and stay with me.')];
  assert.strictEqual(buildReactionBlock(react('\u{1F62D}', '❤️'), history), null);
});

check('the crisis check reads the sponsor own words, not the person mentioning a number', () => {
  // They can say "988" themselves without that being the sponsor handing it over.
  const b = buildReactionBlock(react('\u{1F44D}'), [them('my mate gave me 988 once')]);
  assert.ok(b, 'a reaction should still land when the sponsor did not give a resource');
});

check('an old crisis, well behind the recent window, stops suppressing', () => {
  const history = [
    said('Call 988 now.'),
    ...Array.from({ length: 7 }, (_, i) => said(`ordinary message ${i}`)),
  ];
  assert.ok(buildReactionBlock(react('\u{1F44D}'), history),
    'the window is the recent turns, not the whole history');
});

check('the block is actually wired into the reply', () => {
  assert.ok(/const reactionBlock = buildReactionBlock\(/.test(serverSrc),
    'buildReactionBlock exists but nothing calls it');
  assert.ok(/db\.recentReactions\(userId\)\.catch\(\(\) => \[\]\)/.test(serverSrc),
    'the read must never be able to block a reply');
});

check('db.recentReactions drops the ones they took back off', () => {
  const dbSrc = require('fs').readFileSync(require.resolve('./db.js'), 'utf8');
  assert.ok(/async function recentReactions/.test(dbSrc), 'recentReactions is gone');
  assert.ok(/\.filter\(\(x\) => x\.emoji && !x\.removed\)/.test(dbSrc),
    'a removed reaction should not be handed to the sponsor as context');
  assert.ok(/created_at > now\(\) - /.test(dbSrc),
    'reactions must be time-boxed, or the sponsor answers last week');
  assert.ok(/recentReactions,/.test(dbSrc), 'recentReactions is not exported');
});

console.log('\n── The prompt actually tells it the rule ──');

check('the master prompt carries the emoji section', () => {
  const src = require('fs').readFileSync(require.resolve('./server.js'), 'utf8');
  assert.ok(src.includes('### An emoji occasionally, the way anyone texting would'),
    'the emoji guidance is missing from MASTER_SYSTEM_PROMPT');
  assert.ok(/One at most, and not in most messages/.test(src),
    'the restraint rule is missing, which is the half Mariam asked for');
  assert.ok(/relapse, crisis, shame, grief, fear/.test(src),
    'the never-here rule is missing');
});

console.log(`\n${failed ? 'FAILED' : 'All good'}: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
