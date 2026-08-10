/* ─── Sponsor voices ──────────────────────────────────────────────────────────
   One list, shared by the registration picker (through /api/voice/preview) and
   by the WhatsApp voice notes (whatsapp.js). Before this existed, whatsapp.js
   hardcoded a single voice for everyone, so someone could name their sponsor
   and then hear a voice that had nothing to do with the name they chose.

   Kept as an explicit allow-list, same approach as voice-compare.js: a value
   arriving from a browser or out of a stored profile can only ever be a real
   voice, and never reaches OpenAI unvalidated.

   These are the six original OpenAI TTS voices. The newer ones (ash, ballad,
   coral, sage, verse) came in with the newer speech models, and this backend
   calls `tts-1`, so the six below are the set known to work with it.

   No gender labels here on purpose. The picker plays each one instead, which is
   both more accurate than any label and the right call for a product where the
   sponsor is somebody's chosen companion. */
const OpenAI = require('openai');

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

/* Used when someone never picked one: everybody who registered before the picker
   existed, and anyone who messages the WhatsApp number without signing up.
   Overridable from Render so it can be changed by ear without a deploy. */
const DEFAULT_VOICE = process.env.SPONSOR_TTS_VOICE || 'alloy';

const MODEL = 'tts-1';

/* Short on purpose: it is the line every preview plays, so it should be quick to
   audition and cheap to generate. */
const PREVIEW_LINE = "Hey, it's good to hear from you. I'm here, and we can take this at your pace.";

const enabled = !!process.env.OPENAI_API_KEY;
const openai = enabled ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/* Fall back rather than throw. A profile written before the picker existed, or a
   voice we later drop from the list, must never cost someone their reply. */
function resolve(voice) {
  return VOICES.includes(voice) ? voice : DEFAULT_VOICE;
}

async function synthesize(text, voice) {
  if (!enabled) throw new Error('OPENAI_API_KEY not configured');
  const mp3 = await openai.audio.speech.create({
    model: MODEL,
    voice: resolve(voice),
    input: text,
  });
  return Buffer.from(await mp3.arrayBuffer());
}

/* Previews are generated once per voice per process and held in memory. The line
   never changes, so paying OpenAI for it on every signup would be pure waste, and
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

module.exports = { VOICES, DEFAULT_VOICE, PREVIEW_LINE, enabled, resolve, synthesize, preview };
