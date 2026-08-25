/* Guards the reaction feature. Run: node test-reactions.js

   Offline. `fetch` is replaced so the exact request can be inspected, and no
   reaction is ever sent to a real person.

   WHY THIS IS TESTED HARDER THAN IT LOOKS. A reaction is one emoji, so the
   instinct is that it barely needs a test. The opposite is true here. Getting
   it wrong does not produce a broken feature, it produces a person telling
   their sponsor they are struggling and receiving a heart. There is no error
   in a log for that and nobody would find it for weeks.

   So the tests are almost entirely about what must NOT get a reaction, and the
   bar is deliberately lopsided: missing a celebration costs a small warmth
   nobody knew to expect, reacting to distress costs somebody the feeling of
   being heard at the exact moment they opened up. */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);
const src = (f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');

/* deservesReaction is not exported (it is routing internals, like asksForVoice
   and textOnlyReason), so it is lifted out of the source the same way those are
   verified elsewhere. Keeps the test honest about the real regexes rather than
   a copy that can drift. */
const wa = src('whatsapp.js');
const body = wa.slice(wa.indexOf('const PROGRESS'), wa.indexOf('/* ── What can never be said out loud'));
const deservesReaction = new Function(`${body}; return deservesReaction;`)();

(async () => {
  group('the messages this exists for');
  [
    'I had a better day today',
    'today was better',
    'feeling better today',
    "I'm doing better",
    'things are improving',
    '3 days sober',
    '30 days clean',
    'one week sober today',
    "I didn't drink last night",
    'I stayed sober all weekend',
    'I made it through the day',
    'I went to a meeting tonight',
    'I got to my first meeting',
    'proud of myself',
    'feeling stronger',
  ].forEach((t) => check(`react: "${t}"`, deservesReaction(t), true));

  group('negated risk words are the whole point, not a veto');
  /* "I didn't relapse" contains "relapse". An earlier version refused to react
     to exactly the messages somebody is proudest of. */
  [
    "today I didn't relapse",
    "I didn't relapse this week",
    "I haven't used in 5 days",
    'no cravings today',
    "I didn't drink at the party",
    'today is good',
    'today feels better',
    'today was fine',
    'today I feel better',
    'tonight went well',
  ].forEach((t) => check(`react: "${t}"`, deservesReaction(t), true));

  group('distress must never get a heart');
  [
    'I relapsed last night',
    'I drank yesterday',
    'today was really hard',
    'I feel awful',
    'I am struggling',
    'having cravings all day',
    'I want to drink',
    'I feel like using',
    'I feel so alone',
    'I am scared',
    'everything is hopeless',
  ].forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));

  group('MIXED MESSAGES: the dangerous shape, positive then the hard part');
  /* This is how people test whether it is safe to say the real thing. A heart
     on the first half is the worst possible answer. */
  [
    'I had a better day but I still want to drink',
    'I am 3 days sober although I nearly slipped',
    'feeling better today, though the cravings are bad',
    'I went to a meeting but it was really hard',
    'today was good except I keep thinking about using',
    'I stayed clean, however I feel terrible',
  ].forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));

  group('negation does NOT soften the veto');
  /* The un-negated forms and the pivot word still win. */
  [
    "I didn't drink but I nearly did",
    "I didn't relapse though I wanted to",
    'no cravings today, but yesterday was awful',
    'I want to drink',
    'I used again',
  ].forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));

  group('questions want an answer, not an emoji');
  [
    'do you think I am doing better?',
    'I had a better day, is that normal?',
    'am I improving?',
  ].forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));

  group('anything self-harm adjacent, unconditionally silent');
  [
    'I had a good day but I want to die',
    'feeling better, thinking about ending it',
  ].forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));

  group('ordinary messages get nothing');
  ['hi', 'hello', 'are you there', 'what time is the meeting', '', '   ']
    .forEach((t) => check(`silent: "${t}"`, deservesReaction(t), false));
  check('silent: non-string', deservesReaction(null), false);

  group('the request Meta actually receives');
  process.env.META_WA_TOKEN = 'test-token';
  process.env.META_WA_PHONE_NUMBER_ID = '1164530693420800';
  delete require.cache[require.resolve('./metacloud')];
  const mc = require('./metacloud');
  const realFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, opts) => {
    seen = { url, body: opts && opts.body ? JSON.parse(opts.body) : null };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OUT' }] }) };
  };
  await mc.sendReaction('whatsapp:+995598785151', 'wamid.ABC');
  check('type is reaction', seen.body.type, 'reaction');
  check('names the message being reacted to', seen.body.reaction.message_id, 'wamid.ABC');
  check('recipient is bare digits', seen.body.to, '995598785151');
  check('default emoji is a heart', seen.body.reaction.emoji, '❤️');

  seen = null;
  await mc.sendReaction('whatsapp:+1', 'SM1234567890');
  check('a Twilio SID is refused, not posted', seen, null);
  seen = null;
  await mc.sendReaction('whatsapp:+1', null);
  check('no message id does nothing', seen, null);
  global.fetch = realFetch;

  group('wiring');
  check('off unless META_WA_REACTIONS=1', wa.includes("process.env.META_WA_REACTIONS === '1'"), true);
  check('reacts to their message id', wa.includes('metacloud.sendReaction(fromPhone, messageSid'), true);
  check('failures are caught, never thrown', /sendReaction\([^)]*\)\s*\n\s*\.catch\(/.test(wa), true);
  /* If the reply ever waits on a reaction, a Meta hiccup costs somebody their
     answer. It must be fire and forget. */
  check('never awaited', /await\s+metacloud\.sendReaction/.test(wa), false);
  check('fires before the reply is composed',
    wa.indexOf('metacloud.sendReaction') < wa.indexOf('const replyText = await getSponsorReply'), true);

  group('different emoji, not always a heart');
  /* Matt: "give different emoji responses to some (only some) of the messages
     to simulate a real conversation". The same heart every time is what makes
     an automation obvious. */
  const body2 = wa.slice(wa.indexOf('const REACTION_FOR'), wa.indexOf('/* ── Not two in a row'));
  const reactionEmoji = new Function(`${body2}; return reactionEmoji;`)();
  check('a counted milestone',        reactionEmoji('one week sober today'), '\u{1F64C}');
  check('a meeting',                  reactionEmoji('I went to a meeting tonight'), '\u{1F44F}');
  check('getting through it',         reactionEmoji("I didn't drink last night"), '\u{1F4AA}');
  check('made it through',            reactionEmoji('I made it through the day'), '\u{1F4AA}');
  check('everything else keeps the default heart', reactionEmoji('feeling better today'), null);
  /* Nothing that could land as flippant on a recovery product. */
  const emojis = ['\u{1F64C}', '\u{1F44F}', '\u{1F4AA}'];
  check('no thumbs up, fire or party poppers',
    emojis.some((e) => ['\u{1F44D}', '\u{1F525}', '\u{1F389}'].includes(e)), false);

  group('only some of them: not two in a row');
  /* React to every qualifying message and within a week it is wallpaper. Same
     rule the unprompted voice notes already use. */
  check('the guard exists', wa.includes('function reactionHeldBack'), true);
  check('it is consulted before reacting', wa.includes('reactionHeldBack(waUserId(fromPhone))'), true);
  check('and updated either way', wa.includes('noteReaction(waUserId(fromPhone), !holdBack)'), true);
  check('the chosen emoji is passed through',
    wa.includes('metacloud.sendReaction(fromPhone, messageSid, emoji)'), true);

  group('quoting the message being answered');
  /* Rewritten after Mariam tested it: quoting every message reads as a machine.
     A person quotes to disambiguate, so the only trigger is a burst. */
  const body3 = wa.slice(wa.indexOf('const BURST_WINDOW_MS'), wa.indexOf('async function sendTextReply'));
  const shouldQuote = new Function(`${body3}; return shouldQuote;`)();
  const NOW2 = Date.now();
  check('a burst is quoted: their last message seconds ago',
    shouldQuote({ lastMessageAt: new Date(NOW2 - 20000) }, NOW2), true);
  check('a single message is NOT quoted',
    shouldQuote({ lastMessageAt: new Date(NOW2 - 10 * 60000) }, NOW2), false);
  check('a long gap is NOT quoted either',
    shouldQuote({ lastMessageAt: new Date(NOW2 - 9 * 3600000) }, NOW2), false);
  check('first contact quotes nothing',
    shouldQuote({ lastMessageAt: null }, NOW2), false);
  check('clock skew cannot force a quote',
    shouldQuote({ lastMessageAt: new Date(NOW2 + 60000) }, NOW2), false);
  /* A voice note on its own is still just one message. */
  check('audio no longer forces a quote',
    /isAudio/.test(body3), false);
  check('only the first part of a split reply quotes',
    wa.includes('parts.indexOf(body) === 0 ? replyTo : null'), true);
  /* Without the role filter the "last message" is the sponsor's own reply and
     a burst can never be detected. */
  check('the gap measures THEIR messages, not ours',
    src('db.js').includes("role = 'user' ORDER BY id DESC"), true);
  check('metacloud attaches it as context',
    src('metacloud.js').includes('context: { message_id: replyTo }'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
