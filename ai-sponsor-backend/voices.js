/* ─── Sponsor voices (xAI) ────────────────────────────────────────────────────
   One list, shared by the registration picker and the settings page (through
   /api/voice/preview) and by the WhatsApp voice notes (whatsapp.js).

   WHY xAI RATHER THAN OPENAI. Matt's note was that the voice notes sound
   "clearly a recording" next to a real one. Two reasons for that, and this
   endpoint fixes both:

   1. SPEECH TAGS. xAI performs inline direction inside the text: [pause],
      [long-pause], [breath], [sigh], [laugh], and wrapping <soft>, <slow>,
      <whisper>, <loud>. OpenAI's speech API only takes a general `instructions`
      string describing the overall tone; it cannot place a breath on a specific
      word. Verified the tags are performed and not read aloud: the same line
      with [long-pause] transcribes to identical words but holds a real 2.45s
      silence exactly where the tag sat.

   2. OGG/OPUS OUTPUT. WhatsApp only renders a native voice note (the waveform
      bubble) for OGG with the opus codec; an MP3 arrives as a generic audio
      attachment, which is the other half of "clearly a recording". We were
      sending MP3. xAI returns Ogg/Opus directly, so nothing has to be
      transcoded and there is no ffmpeg dependency. Their published docs claim
      no opus support; the live API accepts it and returns Ogg/Opus, confirmed
      against the real endpoint.

   The allow-list stays for the same reason as before: a value arriving from a
   browser or out of a stored profile can only ever be a real voice, and never
   reaches the provider unvalidated.

   Claude is still the sponsor. xAI is only ever the mouth. */

const VOICES = ['carina', 'luna', 'celeste', 'naksh', 'lux', 'rigel'];

/* Chosen from xAI's 25 for how they were tagged for wellness and support work
   (see the roster in voice-compare.js). Not chosen by ear: swapping any of them
   is a one-word edit here, and the picker renders whatever this list says. */

const DEFAULT_VOICE = process.env.SPONSOR_TTS_VOICE || 'carina';

const TTS_URL = 'https://api.x.ai/v1/tts';

/* Ogg/Opus is not a preference, it is the thing that makes WhatsApp show a
   voice note instead of a file. Also about a third the size of the MP3, which
   matters on a phone on mobile data.

   bit_rate is here for a reason that is easy to miss. WhatsApp only draws the
   play button on an audio file of 512KB or less; above that it swaps in a
   download icon, which is exactly the "this arrived as a file" complaint we
   were trying to fix in the first place. Left to itself this endpoint returns
   about 108kbps, so a voice note crossed 512KB at around 39 seconds, and the
   sponsor is told to speak precisely when a reply is too long to type. At
   32000 the ceiling moves out past 95 seconds and speech at this bitrate is
   indistinguishable by ear. xAI's docs say bit_rate is MP3 only; the live API
   honours it for opus, measured at 43kbps against 108 without it. */
const OUTPUT = { codec: 'opus', bit_rate: 32000 };
const CONTENT_TYPE = 'audio/ogg';
const FILE_EXT = 'ogg';

/* ── Speech tags ────────────────────────────────────────────────────────────
   The reason for being on xAI at all, and until now the only things that ever
   carried one were three hard-coded lines: the preview, the spoken hello, and
   the voice-change confirmation. Every actual reply went to the voice engine as
   flat text, which is why Matt could hear the difference between the greeting
   and the conversation.

   Verified against the live endpoint, every tag in this list: each one changes
   the audio (a [long-pause] adds nearly three seconds of real silence) and none
   of them is read out. Whisper transcribes the tagged and untagged lines to the
   same words.

   The list is an allow-list for the same reason the voice list is one. A tag
   the model invents is not silently performed, it is read aloud in the middle
   of a sentence, so nothing unverified reaches the provider. */
const INLINE_TAGS = ['pause', 'long-pause', 'breath', 'sigh', 'laugh'];
const WRAPPING_TAGS = ['soft', 'slow', 'whisper', 'loud'];

/* Anything shaped like a stage direction: [word], [two words], <word>, </word>.
   Deliberately narrow. Ordinary replies from this sponsor do not contain square
   or angle brackets, and a rule that ate real punctuation would be worse than
   the problem.

   Spaces are inside the pattern rather than outside it because a model asked
   for [long-pause] writes [long pause] and [LONG PAUSE] soon enough, and the
   cost of not matching those is the worst outcome available here: the words
   "long pause" said out loud, in the middle of a sentence, to somebody who
   reached out at 3am. Matched, they are canonicalised to the form that was
   actually verified rather than thrown away. */
const ANY_DIRECTION = /\[([a-z][a-z -]{0,20})\]|<\/?([a-z][a-z -]{0,20})>/gi;

const canonical = (name) => String(name).trim().toLowerCase().replace(/[\s-]+/g, '-');

const allowed = (name) =>
  INLINE_TAGS.includes(canonical(name)) || WRAPPING_TAGS.includes(canonical(name));

/* Tidies up after a tag is removed, so nothing gives away that one was there:
   no double space, no space in front of a full stop, no line that now starts
   with the gap the tag used to sit in. */
const tidy = (text) =>
  text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim();

/* For the voice engine: keep what we have verified, in the form we verified it
   in, and drop anything else. */
function forSpeech(text) {
  return tidy(String(text).replace(ANY_DIRECTION, (m, inline, wrapping) => {
    const name = inline !== undefined ? inline : wrapping;
    if (!allowed(name)) return '';
    if (inline !== undefined) return `[${canonical(name)}]`;
    return m.startsWith('</') ? `</${canonical(name)}>` : `<${canonical(name)}>`;
  }));
}

/* For every pair of eyes: no tags at all.

   This runs on the copy that is persisted, shown in the web chat, and sent as
   text when the safety guard overrules a voice note. A tag is invisible when it
   is spoken and glaring when it is read, and history is shared across channels,
   so one leaking into a stored turn teaches the model to write them everywhere.
   Same reasoning as stripping [[voice]] in server.js, and the same place in the
   pipeline. */
function stripSpeechTags(text) {
  return tidy(String(text).replace(ANY_DIRECTION, ''));
}

/* Short on purpose: every preview plays this line, so it should be quick to
   audition and cheap to generate. Tagged, because the point of the preview is
   to hear what the sponsor will actually sound like. */
const PREVIEW_LINE =
  "Hey. [breath] It's good to hear from you. <soft>We can take this at your pace.</soft>";

const enabled = !!process.env.XAI_API_KEY;

function resolve(voice) {
  return VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

async function synthesize(text, voice) {
  if (!enabled) throw new Error('XAI_API_KEY not configured');
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: forSpeech(text),
      voice_id: resolve(voice),
      language: 'en',
      output_format: OUTPUT,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`xAI TTS ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* Previews are generated once per voice per process and held in memory. The
   line never changes, so paying for it on every signup would be pure waste, and
   the second visitor onwards gets it instantly. In-flight requests share one
   promise so six quick taps don't become six API calls. */
const previewCache = new Map();

function preview(voice) {
  const v = resolve(voice);
  if (!previewCache.has(v)) {
    previewCache.set(
      v,
      synthesize(PREVIEW_LINE, v).catch((e) => {
        previewCache.delete(v); // let the next request retry
        throw e;
      })
    );
  }
  return previewCache.get(v);
}

module.exports = {
  VOICES, DEFAULT_VOICE, PREVIEW_LINE, CONTENT_TYPE, FILE_EXT,
  INLINE_TAGS, WRAPPING_TAGS,
  enabled, resolve, synthesize, preview, forSpeech, stripSpeechTags,
};
