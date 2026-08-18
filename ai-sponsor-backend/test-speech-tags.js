/* Guards the direction tags that make a voice note sound like a person rather
   than a recording. Run: node test-speech-tags.js

   Matt, in #ai-sponsor on Aug 18: "the audio still comes as MP4 instead of the
   voice message with the voice anotations so it looks like a real human did
   it." He was right, and it was not the format. The audio was already Ogg/Opus,
   verified off the wire. What was missing is that the tags lived in three
   hard-coded strings and nothing ever told the sponsor it could use them, so
   every real reply went to the voice engine as flat text.

   Two things have to hold, and they pull in opposite directions:

   1. A tag has to survive all the way to the voice engine, or the feature does
      nothing at all.
   2. A tag must NEVER reach a pair of eyes. It is invisible when spoken and
      glaring when read, and the same reply can still end up as text: the safety
      guard overrules voice for crisis numbers and links, synthesis can fail and
      fall back, and the stored copy is shared with the web chat, which has no
      voice at all.

   So the split is tested from both ends, plus the shape of the pipeline in the
   shipped source, because a working pair of functions that nothing calls is the
   bug this whole file exists to catch. */
const fs = require('fs');
const path = require('path');
const voices = require('./voices.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);
const src = (f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');

group('every verified tag reaches the voice engine untouched');
for (const tag of voices.INLINE_TAGS) {
  const line = `Hey. [${tag}] It's good to hear from you.`;
  check(`[${tag}] survives`, voices.forSpeech(line), line);
}
for (const tag of voices.WRAPPING_TAGS) {
  const line = `Hey. <${tag}>It's good to hear from you.</${tag}>`;
  check(`<${tag}> survives`, voices.forSpeech(line), line);
}

group('anything invented is dropped before it reaches the provider');
// Not pedantry: an unverified tag is not silently ignored by the engine, it is
// read out loud in the middle of a sentence.
check('[warmly]', voices.forSpeech('I hear you. [warmly] Keep going.'), 'I hear you. Keep going.');
check('[chuckles]', voices.forSpeech('[chuckles] That is very you.'), 'That is very you.');
// The near miss is the dangerous one. A model asked for [long-pause] writes
// [long pause] before long, and unmatched it is read out word for word.
check('[LONG PAUSE] canonicalised', voices.forSpeech('Wait. [LONG PAUSE] Say that again.'), 'Wait. [long-pause] Say that again.');
check('[deep breath] dropped', voices.forSpeech('Wait. [deep breath] Say that again.'), 'Wait. Say that again.');
check('<SOFT> canonicalised', voices.forSpeech('<SOFT>Take your time.</SOFT>'), '<soft>Take your time.</soft>');
check('[LONG PAUSE] never read', voices.stripSpeechTags('Wait. [LONG PAUSE] Say that again.'), 'Wait. Say that again.');
check('[deep breath] never read', voices.stripSpeechTags('Wait. [deep breath] Say that again.'), 'Wait. Say that again.');
check('<em>', voices.forSpeech('That <em>matters</em>.'), 'That matters.');
check('<br>', voices.forSpeech('One day.<br>Then the next.'), 'One day.Then the next.');
check('mixed', voices.forSpeech('[breath] Slow down. [urgently] <soft>You are alright.</soft>'),
  '[breath] Slow down. <soft>You are alright.</soft>');

group('nothing tagged ever reaches a pair of eyes');
check('inline', voices.stripSpeechTags('Hey. [breath] It is good to hear from you.'),
  'Hey. It is good to hear from you.');
check('wrapping', voices.stripSpeechTags('<soft>Take your time.</soft>'), 'Take your time.');
check('invented too', voices.stripSpeechTags('[warmly] I am here. [pause] Always.'), 'I am here. Always.');
check('several', voices.stripSpeechTags('[breath] Ninety days. [long-pause] <slow>That is not nothing.</slow>'),
  'Ninety days. That is not nothing.');

group('an ordinary reply is left exactly as written');
[
  "I'm proud of you. Ninety days is not nothing, and you did that.",
  'Call your sponsor before you pick up. Not after.',
  'Step 4 is the one everybody dreads. You don\'t have to do it tonight.',
  'Text HOME to 741741 if calling feels like too much.',
  'Here is your settings page: https://getaisponsor.com/ai-sponsor-settings.html?t=abc123',
  'It was 3am when you wrote, and I read every word.',
].forEach((t) => {
  check(`spoken:  ${JSON.stringify(t.slice(0, 34))}…`, voices.forSpeech(t), t);
  check(`read:    ${JSON.stringify(t.slice(0, 34))}…`, voices.stripSpeechTags(t), t);
});

group('removing a tag never leaves the sentence looking broken');
check('no double space', voices.stripSpeechTags('I hear you. [pause] I do.'), 'I hear you. I do.');
check('no space before a full stop', voices.stripSpeechTags('I hear you [sigh] .'), 'I hear you.');
check('no space before a comma', voices.stripSpeechTags('Okay [pause] , then what?'), 'Okay, then what?');
check('trimmed at the front', voices.stripSpeechTags('[breath] Okay.'), 'Okay.');
check('trimmed at the end', voices.stripSpeechTags('Okay. [long-pause]'), 'Okay.');

group('the hard-coded spoken lines still pass the allow-list');
// These three are the only tagged strings that predate this change. If a tag is
// ever renamed in the vocabulary, these break here rather than in someone's ear.
const HARDCODED = [
  voices.PREVIEW_LINE,
  "[breath] It's really good to hear from you. <soft>I'm here whenever you need me, day or night. [pause] Take your time.</soft>",
  "[breath] This is how I sound now. <soft>I'm right here whenever you need me.</soft>",
];
HARDCODED.forEach((line, i) => check(`hard-coded line ${i + 1} unchanged`, voices.forSpeech(line), line));
check('the spoken hello is still in whatsapp.js', src('whatsapp.js').includes(HARDCODED[1].slice(0, 40)), true);
check('the voice-change line is still in server.js', src('server.js').includes(HARDCODED[2].slice(0, 40)), true);

group('[[voice]] is not a direction tag, and the order it is stripped in matters');
// stripVoiceMarker runs first in server.js. If that order is ever swapped, the
// inner [voice] here is eaten and a bare [[ ]] goes out to a person.
const VOICE_MARKER = /\[\[\s*voice\s*\]\]/gi;
const markerFirst = voices.stripSpeechTags('[[voice]] I heard that. [breath] Every word.'.replace(VOICE_MARKER, ''));
check('marker then tags', markerFirst, 'I heard that. Every word.');

group('the pipeline is actually wired up');
// A correct pair of functions nobody calls is exactly the failure this catches.
const server = src('server.js');
const whatsapp = src('whatsapp.js');
const voicesSrc = src('voices.js');
check('the spoken copy is put on the context', server.includes('context.spokenText = voices.forSpeech(markerFree)'), true);
check('the returned copy is the clean one', server.includes('const replyText = voices.stripSpeechTags(markerFree)'), true);
check('direction is given when the reply is already spoken',
  /if \(context\.replyIsSpoken\) systemBlocks\.push\(\{ type: 'text', text: SPEAKING_DIRECTION \}\)/.test(server), true);
check('direction is given when the sponsor can choose to speak',
  (server.match(/text: SPEAKING_DIRECTION/g) || []).length, 2);
check('the vocabulary in the prompt matches the allow-list',
  voices.INLINE_TAGS.every((t) => server.includes(`[${t}]`)) &&
  voices.WRAPPING_TAGS.every((t) => server.includes(`<${t}>`)), true);
check('whatsapp.js speaks the tagged copy', whatsapp.includes('synthesizeSpeech(ctx.spokenText || replyText'), true);
check('the provider only ever sees allow-listed tags', voicesSrc.includes('text: forSpeech(text)'), true);

group('a long voice note keeps its play button');
// WhatsApp swaps the play icon for a download icon above 512KB, which is the
// "it arrived as a file" complaint all over again. Measured off the live
// endpoint: 108kbps left to itself, 43kbps at this setting.
check('bit_rate is pinned', voices.forSpeech('x') === 'x' && voicesSrc.includes('bit_rate: 32000'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
