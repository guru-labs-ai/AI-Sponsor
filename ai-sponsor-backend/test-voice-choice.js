/* Guards the sponsor choosing to speak. Run: node test-voice-choice.js

   Two independent pieces, both exercised against the shipped source:

   1. stripVoiceMarker (server.js) pulls [[voice]] off a reply. It must never
      leave the marker in a message a person reads, and never let it into the
      stored history, where the model would start copying its own past turns.

   2. textOnlyReason (whatsapp.js) is the safety guard, and it is the reason
      this file exists. The crisis protocol hands out 988, 741741 and
      1-800-662-4357. A number you heard in a voice note cannot be dialled,
      tapped, or scrolled back to while you are panicking. The guard overrules
      the sponsor's choice AND a direct request, so it has to be right, and it
      has to err toward text.

   Both are read out of the shipped source rather than imported, since server.js
   and whatsapp.js each pull in the whole app at require time. */
const fs = require('fs');
const path = require('path');

function pull(file, startMark, endMark, symbol) {
  const src = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a === -1 || b === -1) throw new Error(`test-voice-choice: could not find ${startMark} in ${file}`);
  return new Function(`${src.slice(a, b)}; return ${symbol};`)();
}

const stripVoiceMarker = pull('server.js', 'const VOICE_MARKER', '/* Lets the sponsor hand out', 'stripVoiceMarker');
const textOnlyReason = pull('whatsapp.js', 'const CRISIS_RESOURCE', '/* ── Not twice in a row', 'textOnlyReason');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

group('the marker is recognised and removed');
for (const raw of [
  '[[voice]] I heard that.',
  '[[voice]]\n\nI heard that.',
  '[[ voice ]] I heard that.',
  '[[VOICE]] I heard that.',
]) {
  const r = stripVoiceMarker(raw);
  check(`wanted: ${JSON.stringify(raw.slice(0, 18))}`, r.wanted, true);
  check(`clean:  ${JSON.stringify(raw.slice(0, 18))}`, r.text, 'I heard that.');
}

group('an ordinary reply is untouched');
for (const raw of [
  'I heard that.',
  'That sounds like a hard night. What time did it start?',
]) {
  const r = stripVoiceMarker(raw);
  check(`not wanted: ${JSON.stringify(raw.slice(0, 22))}`, r.wanted, false);
  check(`unchanged:  ${JSON.stringify(raw.slice(0, 22))}`, r.text, raw);
}

group('SAFETY: crisis resources can never be spoken');
[
  'Please call 988 right now, they are there all night.',
  'Text HOME to 741741 if calling feels like too much.',
  'The SAMHSA National Helpline is 1-800-662-4357, free and confidential.',
  'Try the Suicide and Crisis Lifeline, they will stay on with you.',
  'The Crisis Text Line is there 24/7.',
].forEach((t) => check(JSON.stringify(t.slice(0, 46)) + '…', textOnlyReason(t) !== null, true));

group('SAFETY: anything tappable stays text');
[
  'Here is your settings page: https://getaisponsor.com/ai-sponsor-settings.html?t=abc123',
  'You can change my voice at getaisponsor.com whenever you like.',
  'Have a look at www.aa.org for meetings near you.',
  'His number is 555 123 4567, call him before you do anything else.',
].forEach((t) => check(JSON.stringify(t.slice(0, 46)) + '…', textOnlyReason(t) !== null, true));

group('a normal reply is still allowed to be spoken');
[
  "I'm proud of you. Ninety days is not nothing, and you did that.",
  "That sounds like the loneliest kind of night. I'm here, take your time.",
  'Call your sponsor before you pick up. Not after.',
  "Step 4 is the one everybody dreads. You don't have to do it tonight.",
  'It was 3am when you wrote, and I want you to know I read every word.',
].forEach((t) => check(JSON.stringify(t.slice(0, 46)) + '…', textOnlyReason(t), null));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
