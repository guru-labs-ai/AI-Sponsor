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

/* ─── EVERYTHING BELOW IS THE FULL SURFACE, NOT JUST VOICE NOTES ─────────────

   The file above was written for one job: send a voice note through Meta and
   leave everything else on Twilio. That plan died on Aug 24. With our own app,
   our own permanent token and the app subscribed to the WABA, Meta accepts a
   media upload on this number and refuses every send with a blanket
   `(#200) You do not have the necessary permissions`, text and audio alike,
   window open or closed. Management rights we have; messaging rights sit with
   Twilio, who registered the number.

   So the hybrid is off and the destination is the whole surface moving here.
   That needs more than sending audio: text out, media in, and read receipts.
   None of it runs until the number is registered to our app and
   META_WA_INBOUND is set, so adding it changes nothing today. */

/* Inbound is a SEPARATE switch from `enabled` on purpose. Sending through Meta
   and listening through Meta are two different migrations and the second one is
   the dangerous half: the moment the number is registered to our app, Twilio's
   webhook stops firing and anything not handled here is silence for somebody
   who reached out. Two flags means the switchover can be staged and, more to
   the point, reversed one half at a time. */
const inbound = !!(TOKEN && PHONE_NUMBER_ID && process.env.META_WA_INBOUND === '1');

/* ⭐ AND SENDING IS A THIRD FLAG, SEPARATE AGAIN. Listening on Meta and sending
   on Meta must be switchable independently or the rollout cannot be staged, and
   an unstaged rollout here means finding out whether the webhook works by
   pointing a live product at it.

   The order that makes the switchover survivable:
     1. META_WA_INBOUND=1        mounts the routes so Meta's dashboard can
                                 verify the callback URL. Nothing is listening
                                 yet in practice, because the number is still
                                 Twilio's and Meta sends us nothing. Replies
                                 keep going out through Twilio, unchanged.
     2. register the number      Twilio's webhook stops, ours starts.
     3. META_WA_OUTBOUND=1       replies switch to Meta, which is the only route
                                 that still works once step 2 has happened.
   Steps 2 and 3 are seconds apart on the day; step 1 can be days earlier and
   changes nothing that anyone can see. Collapsing 1 and 3 into one flag would
   mean the only way to verify the webhook is to break every text reply first. */
const outbound = !!(TOKEN && PHONE_NUMBER_ID && process.env.META_WA_OUTBOUND === '1');

/* Meta signs its webhooks with the app secret. Without this set we cannot tell
   a real delivery from anyone who found the URL, which matters more here than
   on most products: an unverified inbound message becomes a conversation with
   somebody's sponsor. */
const APP_SECRET = process.env.META_APP_SECRET;

/* WhatsApp caps a message at 4096 characters on Meta's own API, wider than the
   1600 Twilio enforces. whatsapp.js already splits to 1500 before it gets here,
   so this is a backstop for anything that reaches Meta by another path rather
   than the primary guard. */
const MAX_BODY = 4096;

async function sendText(toPhone, body) {
  if (!enabled) throw new Error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID not configured');
  const text = String(body || '').slice(0, MAX_BODY);
  if (!text.trim()) throw new Error('refusing to send an empty message');

  const res = await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toE164(toPhone),
      type: 'text',
      text: { body: text, preview_url: true },
    }),
  });
  return { messageId: (res.messages && res.messages[0] && res.messages[0].id) || null };
}

/* ⭐ THE THING TWILIO NEVER HAD. reference_twilio_whatsapp_ai_sponsor records,
   correctly, that Twilio exposes NO standalone mark-as-read call and blue ticks
   only arrive as a side effect of the typing indicator. Meta has a real one, and
   it takes the typing indicator in the same call, so the two things we were
   getting by accident we now get on purpose.

   Same discipline as the Twilio version: never awaited by the caller, short
   timeout, every failure swallowed after logging. A read receipt must never be
   able to slow down or take out an actual reply. */
async function markRead(wamid) {
  if (!enabled) return;
  if (!wamid) {
    console.warn('[Meta] no message id — cannot mark as read');
    return;
  }
  /* Meta's ids look like wamid.HBgM… — checked rather than assumed, so that if
     we are ever handed a Twilio SID by mistake the log says why the ticks went
     grey instead of leaving somebody to guess. */
  if (!/^wamid\./i.test(wamid)) {
    console.warn(`[Meta] unexpected message id shape "${String(wamid).slice(0, 24)}" — skipping read receipt`);
    return;
  }
  await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
      typing_indicator: { type: 'text' },
    }),
  });
}

/* Inbound media is a two-step read on this path and that is an improvement, not
   a chore. Twilio hands over a URL that may 404 for a second or two after the
   webhook lands, which is the documented race that once answered somebody's
   voice note with "I'm having a moment" (see downloadAudio in whatsapp.js).
   Meta hands over an id that already resolves, and the bytes come from a
   authenticated lookup rather than a public fetch.

   Kept the retry anyway. It costs nothing when the first call works, and being
   wrong about a race a second time on this particular product is expensive. */
const MEDIA_RETRY_DELAYS = [400, 800, 1600];

async function downloadMedia(mediaId) {
  if (!enabled) throw new Error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID not configured');
  if (!mediaId) throw new Error('no media id');

  let lastErr;
  for (let attempt = 0; attempt <= MEDIA_RETRY_DELAYS.length; attempt++) {
    try {
      const meta = await graph(`${mediaId}`, { method: 'GET' });
      if (!meta.url) throw new Error(`media ${mediaId} has no url`);

      /* The download URL is on a Meta host and still needs the bearer token.
         Fetching it without one returns a 401 that looks like an expired media
         id, which is a confusing hour if you have not seen it before. */
      const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!res.ok) throw new Error(`media fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      if (attempt > 0) console.log(`[Meta] media downloaded on attempt ${attempt + 1}`);
      return { buffer: buf, mimeType: meta.mime_type || '', bytes: buf.length };
    } catch (e) {
      lastErr = e;
      const delay = MEDIA_RETRY_DELAYS[attempt];
      if (delay === undefined) break;
      console.warn(`[Meta] media not ready (${e.message}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* whatsapp.js works in file paths because Twilio needed a file it could serve.
   Nothing on this path does, but the callers still hand us one, so this is the
   adapter rather than a reason to rewrite them. */
async function sendVoiceNoteFile(toPhone, audioFilePath) {
  const fs = require('fs');
  return sendVoiceNote(toPhone, fs.readFileSync(audioFilePath));
}

module.exports = {
  enabled, inbound, outbound, APP_SECRET, GRAPH_VERSION, AUDIO_MIME, PHONE_NUMBER_ID, WABA_ID,
  toE164, uploadAudio, sendVoiceNote, sendVoiceNoteFile, preflight,
  sendText, markRead, downloadMedia, graph,
};
