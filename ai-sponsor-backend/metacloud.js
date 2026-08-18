/* ─── Voice notes straight to Meta, bypassing Twilio for this one thing ───────

   WHY THIS FILE EXISTS. Matt, #ai-sponsor Aug 18, with one of his own voice
   notes sitting directly above one of ours: "the audio not being delivered back
   and look like how it looks when I send one". His draws a waveform and his
   face. Ours draws a flat seek line. They are two different message types on
   Meta's side, not two renderings of the same one.

   A native voice note needs a boolean `voice: true` on the audio object.
   Twilio's API exposes no way to set it: not in the Message resource, not in
   the SDK's create options, not in the Content Template types, and Twilio
   normalises media content types to a bare `audio/ogg` in both directions, so
   even `codecs=opus` cannot be reached through it. That was checked properly
   before any of this was written. The audio itself has been correct since
   Aug 11 and is not the problem.

   ⭐ THE THING THAT MAKES THIS POSSIBLE: the WhatsApp Business Account is OURS,
   not Twilio's. It sits in the Stand Up 8 portfolio, created there through
   Meta's own embedded signup, which is why the display name is editable in our
   own WhatsApp Manager. Twilio is a provider with access, not the owner. So we
   can talk to Meta directly without leaving Twilio.

   SCOPE, DELIBERATELY NARROW. This sends voice notes and nothing else.
   Inbound webhooks, text replies, blue ticks and the typing indicator all stay
   exactly where they are on Twilio. One function changes, and it falls back to
   the Twilio path on any failure, so the worst case is what happens today.

   A SIDE EFFECT WORTH MORE THAN IT LOOKS: Meta takes an uploaded file and gives
   back an id. Twilio has to fetch a public URL from us, which is why whatsapp.js
   carries a reachability probe, a five-minute cleanup timer and a long comment
   about error 63019. On this path the file never has to be publicly reachable
   at all, so that entire class of "the reply silently never arrived" goes away.

   INERT UNTIL CONFIGURED. `enabled` is false unless both env vars are set, and
   whatsapp.js checks it before calling. Deploying this changes nothing. */

/* Meta's own audio-message docs show v25.0. Env-overridable because a version
   bump is otherwise a code change for something that is pure configuration. */
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const TOKEN = process.env.META_WA_TOKEN;
const PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID;
const WABA_ID = process.env.META_WA_WABA_ID; // preflight only, not needed to send

/* NOT `audio/ogg`. Meta's supported list is `audio/ogg; codecs=opus`, and the
   bare type is what produces the "unsupported MIME type" rejection. This is the
   exact parameter Twilio strips, which is a large part of why this file exists.
   voices.js already returns real Ogg/Opus, verified off the wire, so nothing
   has to be transcoded. */
const AUDIO_MIME = 'audio/ogg; codecs=opus';

const enabled = !!(TOKEN && PHONE_NUMBER_ID);

/* Meta wants a bare E.164 number with no plus and no channel prefix. Everything
   upstream here speaks Twilio's "whatsapp:+1307…" so the conversion lives in one
   place rather than at each call site. */
function toE164(phone) {
  return String(phone || '').replace(/^whatsapp:/, '').replace(/[^\d]/g, '');
}

/* Meta returns its errors as JSON with a useful message inside, and swallowing
   that is how you end up staring at "request failed" for an hour. Everything
   here throws with Meta's own words attached, because the caller logs the
   message and then falls back to Twilio. */
async function graph(path, options) {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error || {};
    throw new Error(
      `Meta ${res.status}${e.code ? ` (${e.code}${e.error_subcode ? '/' + e.error_subcode : ''})` : ''}: ` +
      `${e.message || JSON.stringify(body).slice(0, 200)}`
    );
  }
  return body;
}

/* Uploads the audio and returns Meta's media id. Meta keeps it for 30 days;
   we use it once, immediately. Harmless on its own: uploading media messages
   nobody, which is what makes it a safe way to prove this integration works
   without sending anything to a real person. See check-cloud-api.js. */
async function uploadAudio(buffer) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', AUDIO_MIME);
  form.append('file', new Blob([buffer], { type: AUDIO_MIME }), 'voice.ogg');

  const body = await graph(`${PHONE_NUMBER_ID}/media`, { method: 'POST', body: form });
  if (!body.id) throw new Error(`upload returned no media id: ${JSON.stringify(body).slice(0, 200)}`);
  return body.id;
}

/* The whole point of the file: `voice: true`. Without it Meta's own docs say
   the message "will be delivered as a standard audio message", which is exactly
   what we have been sending. */
async function sendVoiceNote(toPhone, buffer) {
  if (!enabled) throw new Error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID not configured');

  const mediaId = await uploadAudio(buffer);
  const body = await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toE164(toPhone),
      type: 'audio',
      audio: { id: mediaId, voice: true },
    }),
  });

  return { mediaId, messageId: (body.messages && body.messages[0] && body.messages[0].id) || null };
}

/* Read-only, and the reason it exists is one open question: does Meta let us
   send on a number Twilio registered? A number's registration belongs to one
   app and some provider setups lock it, so this is not something to assume in
   either direction. Reading the account and listing the numbers answers it
   without touching anything. Returns findings rather than printing them, so the
   script owns the words and this file stays a library. */
async function preflight() {
  const out = { graphVersion: GRAPH_VERSION, waba: null, numbers: [], errors: [] };
  if (!TOKEN) { out.errors.push('META_WA_TOKEN is not set'); return out; }
  if (!WABA_ID) { out.errors.push('META_WA_WABA_ID is not set'); return out; }

  try {
    out.waba = await graph(`${WABA_ID}?fields=id,name,currency,timezone_id`, { method: 'GET' });
  } catch (e) {
    out.errors.push(`cannot read the WhatsApp Business Account: ${e.message}`);
    return out;
  }

  try {
    const fields = 'id,display_phone_number,verified_name,name_status,quality_rating,code_verification_status,platform_type';
    const list = await graph(`${WABA_ID}/phone_numbers?fields=${fields}`, { method: 'GET' });
    out.numbers = list.data || [];
  } catch (e) {
    out.errors.push(`cannot list phone numbers: ${e.message}`);
  }

  return out;
}

module.exports = {
  enabled, GRAPH_VERSION, AUDIO_MIME, PHONE_NUMBER_ID, WABA_ID,
  toE164, uploadAudio, sendVoiceNote, preflight,
};
