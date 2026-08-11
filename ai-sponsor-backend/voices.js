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
   matters on a phone on mobile data. */
const OUTPUT = { codec: 'opus' };
const CONTENT_TYPE = 'audio/ogg';
const FILE_EXT = 'ogg';

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
      text,
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
  enabled, resolve, synthesize, preview,
};
