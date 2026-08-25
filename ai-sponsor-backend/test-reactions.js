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
  check('reacts to their message id', wa.includes('metacloud.sendReaction(fromPhone, messageSid)'), true);
  check('failures are caught, never thrown', /sendReaction\([^)]*\)\s*\n\s*\.catch\(/.test(wa), true);
  /* If the reply ever waits on a reaction, a Meta hiccup costs somebody their
     answer. It must be fire and forget. */
  check('never awaited', /await\s+metacloud\.sendReaction/.test(wa), false);
  check('fires before the reply is composed',
    wa.indexOf('metacloud.sendReaction') < wa.indexOf('const replyText = await getSponsorReply'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
