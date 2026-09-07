/* Guards "just text me". Run: node test-text-only.js

   Why this file exists. Somebody told their sponsor he would rather only get
   text. It said it would remember. He then sent a voice note, as people do when
   talking is easier than typing, and got a voice note back, because the medium
   is decided in code by "voice in, voice back" and nothing was written down.

   The damage is not the unwanted audio. It is that a product whose whole claim
   is that it remembers you did the opposite of what it just agreed to. So the
   preference lives in code and on the profile, and this file is what keeps it
   working after the next person edits the routing.

   Read out of the shipped source rather than imported, the same way
   test-voice-choice.js does it, because whatsapp.js pulls in the whole app at
   require time. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, 'whatsapp.js'), 'utf8');
function pull(startMark, endMark, symbols) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a === -1 || b === -1) throw new Error(`test-text-only: could not find ${startMark}`);
  return new Function(`${src.slice(a, b)}; return {${symbols.join(',')}};`)();
}
const { asksForVoice, asksForTextOnly } =
  pull('const VOICE_REQUEST', '/* ── Worth a heart', ['asksForVoice', 'asksForTextOnly']);

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

/* The decision, mirrored from whatsapp.js. If that order changes, this mirror
   has to change with it, which is the point: it makes the change deliberate. */
function decide({ cameByVoice = false, text = '', savedTextOnly = false, modelWantsVoice = false }) {
  const askedForVoice = !cameByVoice && asksForVoice(text);
  let textOnly = savedTextOnly;
  if (asksForTextOnly(text)) textOnly = true;
  else if (askedForVoice && textOnly) textOnly = false;
  const requestedVoice = (cameByVoice || askedForVoice) && !(textOnly && !askedForVoice);
  let replyAsVoice;
  if (textOnly && !askedForVoice) replyAsVoice = false;
  else if (requestedVoice) replyAsVoice = true;
  else if (modelWantsVoice) replyAsVoice = true;
  else replyAsVoice = false;
  return { replyAsVoice, textOnly };
}

group('asking for text is understood, in the ways people actually say it');
[
  'can you just text me please',
  'no voice notes please',
  'please stop sending voice messages',
  'I would rather read it',
  'text only from now on',
  'I prefer text',
  'I cant listen to voice notes right now',
  'dont send me audio',
].forEach((t) => check(`"${t}"`, asksForTextOnly(t), true));

group('and never mistaken for something else');
[
  'send me a voice note',
  'can I hear your voice',
  'say that out loud',
  'I sent you a voice note',
  'thanks for the voice message',
  'my sponsor called me last night',
  'I had a rough day',
  'no I am not drinking',
].forEach((t) => check(`"${t}"`, asksForTextOnly(t), false));

group('the sequence that found this bug');
check('voice note in, voice back, before they ask',
  decide({ cameByVoice: true, text: 'rough day' }).replyAsVoice, true);
check('they ask for text only, and it is remembered',
  decide({ text: 'can you just text me please' }).textOnly, true);
check('THE BUG: a voice note afterwards still gets text back',
  decide({ cameByVoice: true, text: 'had a hard night', savedTextOnly: true }).replyAsVoice, false);
check('and the preference survives that turn',
  decide({ cameByVoice: true, text: 'had a hard night', savedTextOnly: true }).textOnly, true);

group('it beats everything except the person themselves');
check('the sponsor cannot overrule it by choosing to speak',
  decide({ text: 'thinking about tomorrow', savedTextOnly: true, modelWantsVoice: true }).replyAsVoice, false);
check('asking to hear the sponsor lifts it',
  decide({ text: 'actually send me a voice note', savedTextOnly: true }).replyAsVoice, true);
check('and lifting it is remembered too',
  decide({ text: 'actually send me a voice note', savedTextOnly: true }).textOnly, false);
check('somebody who never asked is unaffected',
  decide({ cameByVoice: true, text: 'morning' }).replyAsVoice, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
