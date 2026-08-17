/* Guards the two decisions that make the sponsor speak. Run: node test-voice-routing.js

   The bug this exists to stop: Matt typed "Send me an audio message again" and
   was told "I can't, Matt. It's text between us, that's all I've got." Nothing
   was broken in the voice pipeline. Voice was only ever triggered by an incoming
   voice note, so a request in words had no path, and the false denial then went
   into his history as the sponsor's own settled view of itself.

   Both of those are pattern decisions, and patterns rot quietly: they keep
   passing the tidy phrasings someone thought of while writing them and start
   missing the ones people actually use. So both are exercised here against real
   sentences, including the two verbatim from Matt's thread.

   Reads the patterns out of the shipped source rather than importing the
   modules, because whatsapp.js and server.js both pull in the full app (Twilio,
   Anthropic, Postgres) at require time and neither exports these. Slicing the
   self-contained declaration blocks tests the exact characters that ship: edit
   the source and this test follows the edit. */
const fs = require('fs');
const path = require('path');

function blockFrom(file, startMark, endMark) {
  const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a === -1 || b === -1) {
    throw new Error(`test-voice-routing: could not find the ${startMark} block in ${file}. ` +
      'If it was renamed or moved, update the markers here.');
  }
  return src.slice(a, b);
}

const asksForVoice = new Function(
  `${blockFrom('whatsapp.js', 'const VOICE_REQUEST', '/* ── The spoken hello')}; return asksForVoice;`
)();
const FALSE_VOICE_CLAIM = new Function(
  `${blockFrom('server.js', 'const FALSE_VOICE_CLAIM', 'const VOICE_CLAIM_CORRECTION')}; return FALSE_VOICE_CLAIM;`
)();

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  ok ? pass++ : fail++;
}
const group = (title) => console.log(`\n— ${title}`);

group('a request for a voice note, in text, must route to voice');
[
  'Send me an audio message again',            // Matt, verbatim
  'send me a voice note',
  'Can you send me a voice message?',
  'hey, could you reply with a voice note please',
  'record me an audio message',
  'say that out loud',
  'can you read it out loud for me',
  'i want to hear your voice',
  'let me listen to you speak',
  'speak to me',
  'voice note please',
  'audio message again',
  // phrased around a negative, but still plainly a request
  "I don't want to type right now, send me a voice note",
].forEach((t) => check(JSON.stringify(t), asksForVoice(t), true));

group('everything else stays text (an unexpected voice note is worse than a missing one)');
[
  'Not bad',
  'How you doing tonight?',
  'I just sent you a voice note',
  "i've sent you an audio message",
  'please stop sending voice notes',
  "don't send me audio messages any more",
  "I can't listen to voice notes right now, I'm at work",
  'my voice is shot today, been shouting all morning',
  'I heard your voice yesterday and it helped',
  'the meeting audio was terrible',
  '',
].forEach((t) => check(JSON.stringify(t), asksForVoice(t), false));

group('a false denial in history must be neutralised before the model sees it');
[
  // Matt's thread, verbatim. Note it never puts "can't" next to "voice" —
  // the original single pattern let this straight through.
  "I can't, Matt. I got that wrong a second ago if I gave you the impression I could. It's text between us, that's all I've got.",
  "I can't send voice messages, sorry.",
  "I'm unable to hear audio.",
  'I cannot receive voice notes.',
  "Voice notes aren't something I can do here.",
  'Text is all I have with you.',
].forEach((t) => check(JSON.stringify(t.slice(0, 50)) + '…', FALSE_VOICE_CLAIM.test(t), true));

group('true things the sponsor says about voice must be left alone');
[
  "I can hear you just fine, and I'll send one back.",
  'That sounds really hard. Tell me more about what happened.',
  "Send me a voice note any time you'd rather talk than type.",
  "I'll say it out loud if that lands better.",
].forEach((t) => check(JSON.stringify(t.slice(0, 50)), FALSE_VOICE_CLAIM.test(t), false));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
