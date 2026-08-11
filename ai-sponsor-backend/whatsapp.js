/* ─── WhatsApp (Twilio) Two-Way Text + Audio Module ────────────────────────
   
   ARCHITECTURE (per Matt's Phase 3 spec):
   User → WhatsApp → Twilio → AI Sponsor (this file) → Claude → AI Sponsor → Twilio → User

   WHAT THIS MODULE DOES:
   1. Receives inbound Twilio webhook (POST from Twilio when user sends a message)
   2. Validates the request is genuinely from Twilio (security — not optional)
   3. If text     → sends directly to Claude
   4. If audio    → downloads the OGG voice note → Whisper transcribes it → Claude
   5. Gets Claude's reply (same getSponsorReply() function as web chat — identical AI behavior)
   6. If original was text  → sends a text reply back via Twilio
   7. If original was audio → sends ONLY a synthesized audio reply via Twilio TTS, matching the medium the person used
   8. Returns TwiML response to Twilio (required — Twilio expects XML, not JSON)

   REAL TWILIO PAYLOAD FIELDS (from official docs — no guessing):
   - req.body.From        → sender's WhatsApp number e.g. "whatsapp:+923001234567"
   - req.body.To          → your Twilio number e.g. "whatsapp:+13075551234"
   - req.body.Body        → text message content (empty string if audio)
   - req.body.NumMedia    → "1" if voice note/media attached, "0" if text only
   - req.body.MediaUrl0   → URL to the media file (voice note OGG) if NumMedia > 0
   - req.body.MediaContentType0 → mime type e.g. "audio/ogg" for voice notes

   TWILIO RESPONSE FORMAT:
   Twilio expects TwiML XML back, NOT JSON. We use Twilio's SDK to generate it.
   For async processing (Claude takes time), we respond 200 immediately with empty
   TwiML, then send the reply proactively via Twilio REST API separately.
─────────────────────────────────────────────────────────────────────────── */

const twilio = require('twilio');
const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ghl = require('./ghl'); // safe to require unconfigured — throws only when called
const db = require('./db');   // no-ops without DATABASE_URL
const voices = require('./voices'); // the shared voice allow-list + TTS

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Twilio client for sending outbound messages (replies)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Your Wyoming (307) Twilio WhatsApp number — set in .env once purchased
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. "whatsapp:+13071234567"

/* ── Identity key ────────────────────────────────────────────────────────────
   "whatsapp:+4477…" → "wa-+4477…".

   The wa- prefix is NOT cosmetic. The Jul 10 beta-cohort import keyed all 58
   phone-holding members as wa-<E.164> precisely so they'd match themselves the
   first time they message. A bare phone here would strand every one of them as a
   brand-new stranger — no profile, duplicate row — and because getMetrics() joins
   activity_days to users on this key, their chats would land under a key with no
   user row and vanish from the usage numbers entirely. Keep in lockstep with the
   import. */
function waUserId(fromPhone) {
  return 'wa-' + String(fromPhone || '').replace('whatsapp:', '').trim();
}

/* ── Phase 5: capture WhatsApp-origin people ─────────────────────────────────
   The number is OPEN — anyone can message without ever touching the website, so
   for those people this is the only moment they'd ever be recorded anywhere.

   Fire-and-forget by design: a CRM hiccup must never cost someone in recovery
   their reply. Runs once per number per process; a failure clears the guard so
   the next message retries. */
const capturedNumbers = new Set();

async function captureWhatsAppUser(userId, phone) {
  if (capturedNumbers.has(userId)) return;
  capturedNumbers.add(userId);
  try {
    // Already known — an imported beta-cohort member, or an earlier message.
    // Their tags/status are already right; re-stamping would only damage them.
    if (await db.getUser(userId)) return;
    if (!process.env.GHL_API_TOKEN) return;

    const { contactId, isNew } = await ghl.upsertWhatsAppContact({ phone, userId });
    await db.upsertUser({
      userId,
      phone,
      // Only claim a status when we actually created the contact. If the phone
      // already existed, it may be someone who registered on the web — we don't
      // know what they are from a WhatsApp message alone, and guessing "Unpaid"
      // over a paying user is worse than leaving it blank.
      access: isNew ? 'Unpaid' : '',
      ghlContactId: contactId,
    });
    console.log(`[WhatsApp→GHL] captured ${userId} → contact ${contactId} (newContact=${isNew})`);
  } catch (e) {
    capturedNumbers.delete(userId); // let the next message try again
    console.error('[WhatsApp→GHL] capture failed:', e.message);
  }
}

/* ── Security: Validate the request is genuinely from Twilio ─────────────────
   Twilio signs every webhook with X-Twilio-Signature using your Auth Token.
   Without this, anyone who discovers your webhook URL could spam it.
   IMPORTANT: needs the raw URL your Render service receives — must match
   exactly what Twilio used, including https:// and the /api/whatsapp/webhook path. */
function validateTwilioSignature(req) {
  // Skip validation in local dev/test to avoid ngrok URL mismatches
  if (process.env.NODE_ENV !== 'production') return true;

  const signature = req.headers['x-twilio-signature'];
  const url = `${process.env.RENDER_EXTERNAL_URL}/api/whatsapp/webhook`;
  
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );
}

/* ── Download incoming voice note from Twilio's media URL ────────────────────
   Twilio requires HTTP Basic Auth (Account SID + Auth Token) to download media.
   Voice notes from WhatsApp arrive as audio/ogg files. */
async function downloadAudio(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
  });

  // Save as .ogg — that's what WhatsApp voice notes are
  const tmpPath = path.join(os.tmpdir(), `wa-incoming-${Date.now()}.ogg`);
  fs.writeFileSync(tmpPath, response.data);
  return tmpPath;
}

/* ── Speech-to-text via OpenAI Whisper ───────────────────────────────────────
   Whisper handles .ogg/opus natively (WhatsApp's voice note format).
   Returns the transcribed text string. */
async function transcribeAudio(filePath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
  });

  fs.unlink(filePath, () => {}); // clean up temp file
  return transcription.text;
}

/* ── Text-to-speech via OpenAI TTS ──────────────────────────────────────────
   Converts Claude's text reply into an MP3 voice note to send back, in the voice
   this person picked for their sponsor at registration.

   This used to be hardcoded to one voice for everybody, which meant you could
   name your sponsor and then hear a voice with no relation to that name. The
   voice now comes from their profile; voices.js falls back to the default for
   anyone who never picked one. */
async function synthesizeSpeech(text, voice) {
  const buffer = await voices.synthesize(text, voice);
  // .ogg, not .mp3. WhatsApp only draws the voice-note bubble for OGG/Opus;
  // an MP3 lands as a generic audio attachment, which is half of why these
  // sounded like recordings rather than messages.
  const tmpPath = path.join(os.tmpdir(), `wa-reply-${Date.now()}.${voices.FILE_EXT}`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

/* ── The spoken hello ────────────────────────────────────────────────────────
   Sent once, alongside the first text reply, so someone hears the sponsor they
   built in the voice they chose.

   Deliberately NOT the text reply read aloud. That message has just landed in
   their chat and hearing the same words again is noise. This is its own short
   greeting, and short matters: it is quick to listen to, quick to generate, and
   cheap. Falls back gracefully when the profile is thin, because plenty of
   people reach this number without ever registering. */
async function sendFirstVoiceNote(fromPhone, profile, expressApp) {
  const sponsorName = (profile && profile.sponsorName) || '';
  const theirName = String((profile && profile.name) || '').trim().split(/\s+/)[0];

  /* Written to be spoken, not read. The tags are xAI's inline direction: a
     breath before the reassurance and a softer, slower close, so this lands as
     somebody talking rather than a paragraph being narrated. */
  const hello =
    (theirName ? `Hi ${theirName}. ` : 'Hi. ') +
    (sponsorName ? `It's ${sponsorName}. ` : '') +
    "[breath] It's really good to hear from you. " +
    "<soft>I'm here whenever you need me, day or night. [pause] Take your time.</soft>";

  const audioPath = await synthesizeSpeech(hello, profile && profile.sponsorVoice);
  await sendAudioReply(fromPhone, audioPath, expressApp);
}

/* ── Upload audio to a publicly accessible URL ───────────────────────────────
   Twilio needs a public URL to fetch the audio file from when sending media.
   We upload to Twilio's own media storage via the Messages API mediaUrl param —
   for now we host the file temporarily via a data URL trick.
   
   SIMPLER APPROACH for MVP: send text reply only, and send audio as a follow-up
   using a publicly hosted URL. Since we're on Render, we can serve the file
   from a temp route. See sendAudioReply() below. */

/* ── Send text reply via Twilio REST API ─────────────────────────────────────
   We use proactive outbound messaging (REST API) instead of TwiML reply
   because Claude takes 1-3 seconds to respond — longer than ideal for a
   synchronous TwiML response. This way we:
   1. Return empty TwiML to Twilio immediately (fast 200 OK)
   2. Process Claude's reply in the background
   3. Send reply proactively via REST API
   This prevents Twilio timeout errors on slow Claude responses. */
async function sendTextReply(toPhone, text) {
  return twilioClient.messages.create({
    from: TWILIO_WHATSAPP_NUMBER,
    to: toPhone, // already has "whatsapp:" prefix from Twilio's incoming payload
    body: text,
  });
}

/* ── Send audio reply via Twilio REST API ────────────────────────────────────
   Twilio needs a public URL to fetch the MP3 from.
   We temporarily serve the file via our own Express server at /media/:filename,
   then Twilio fetches it and delivers it as a WhatsApp voice note.
   The file is deleted after Twilio fetches it (or after 5 minutes as fallback). */
async function sendAudioReply(toPhone, audioFilePath, expressApp) {
  const filename = path.basename(audioFilePath);
  
  // Register a one-time route on the Express app to serve this specific file.
  // The Content-Type is set explicitly: Twilio passes it through to WhatsApp,
  // and WhatsApp decides between a voice-note bubble and a file attachment on
  // what it is told the media is. Guessing from the extension is not worth the
  // risk of it arriving as an attachment again.
  expressApp.get(`/media/${filename}`, (req, res) => {
    res.type(voices.CONTENT_TYPE);
    res.sendFile(audioFilePath, () => {
      // Delete after serving
      fs.unlink(audioFilePath, () => {});
      // Remove this route (Express doesn't support this natively, but the
      // file deletion means subsequent requests will 404, which is fine)
    });
  });

  // Also set a 5-minute cleanup fallback in case Twilio never fetches it
  setTimeout(() => fs.unlink(audioFilePath, () => {}), 5 * 60 * 1000);

  const publicAudioUrl = `${process.env.RENDER_EXTERNAL_URL}/media/${filename}`;

  return twilioClient.messages.create({
    from: TWILIO_WHATSAPP_NUMBER,
    to: toPhone,
    mediaUrl: [publicAudioUrl],
  });
}

/* ── Main entry point: handle one incoming Twilio WhatsApp webhook ────────────
   Called from server.js POST /api/whatsapp/webhook.
   `getSponsorReply`  = the shared Claude function from server.js
   `expressApp`       = the Express app instance (needed to serve audio files)
   
   Returns TwiML string that server.js must send back to Twilio immediately.
   Claude's reply is sent async via REST API after returning the TwiML. */
async function handleIncomingMessage(req, getSponsorReply, expressApp) {
  // ── 1. Security check ──────────────────────────────────────────────────────
  if (!validateTwilioSignature(req)) {
    console.warn('[WhatsApp] Invalid Twilio signature — request rejected');
    return { twiml: '<Response></Response>', rejected: true };
  }

  // ── 2. Parse Twilio's payload ──────────────────────────────────────────────
  const fromPhone = req.body.From;    // "whatsapp:+923001234567"
  const messageBody = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0', 10);
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0 || '';
  const isAudio = numMedia > 0 && mediaType.startsWith('audio/');
  const isText = numMedia === 0 && messageBody.trim().length > 0;

  // ── 3. Respond to Twilio immediately with empty TwiML ─────────────────────
  // This prevents Twilio's 15-second timeout while Claude thinks.
  // We'll send Claude's reply separately via REST API below (async).
  const emptyTwiML = '<Response></Response>';

  // ── 4. Process asynchronously (don't await — return TwiML first) ──────────
  (async () => {
    try {
      let userMessageText;

      if (isAudio && mediaUrl) {
        console.log(`[WhatsApp] Voice note from ${fromPhone} — transcribing...`);
        const audioPath = await downloadAudio(mediaUrl);
        userMessageText = await transcribeAudio(audioPath);
        console.log(`[WhatsApp] Transcribed: "${userMessageText}"`);
      } else if (isText) {
        userMessageText = messageBody;
        console.log(`[WhatsApp] Text from ${fromPhone}: "${userMessageText}"`);
      } else {
        console.log(`[WhatsApp] Unsupported message type from ${fromPhone} — skipping`);
        await sendTextReply(fromPhone, "I can receive text and voice messages. Please try sending one of those!");
        return;
      }

      // ── 5. Get Claude's reply ────────────────────────────────────────────
      // Uses the SAME getSponsorReply() function as the web chat —
      // identical AI sponsor behavior, conversation memory, crisis protocol.
      const userId = waUserId(fromPhone);

      // Record them in GHL + the DB (Phase 5). Not awaited: the reply must never
      // wait on the CRM, and must still go out if the CRM is down.
      captureWhatsAppUser(userId, fromPhone.replace('whatsapp:', '')).catch(() => {});

      /* Is this the first thing they have ever said to us? Must be asked BEFORE
         getSponsorReply(), which appends this message to their history.
         getHistory() returns null when the DB is off, and an unknown answer has
         to count as "no": an unexpected voice note is worse than a missing one. */
      const prior = await db.getHistory(userId, 1).catch(() => null);
      const isFirstContact = Array.isArray(prior) && prior.length === 0;

      /* Their sponsor as they built it. Registration mirrors the profile onto
         this same wa- key (see /register), so someone who signed up on the web
         is met by the sponsor they set up rather than a stock one. */
      const profile = await db.getProfile(userId).catch(() => null);

      const replyText = await getSponsorReply(userId, userMessageText);
      console.log(`[WhatsApp] Claude reply to ${fromPhone}: "${replyText.substring(0, 80)}..."`);

      // ── 6/7. Reply in the same medium the person used ────────────────────
      // Voice in, voice back. Text in, text back. No longer sends both.
      if (isAudio) {
        const audioPath = await synthesizeSpeech(replyText, profile && profile.sponsorVoice);
        await sendAudioReply(fromPhone, audioPath, expressApp);
      } else {
        await sendTextReply(fromPhone, replyText);

        /* The one deliberate exception to text-in-text-back: the spoken hello.
           People choose their sponsor's voice on the last screen of registration
           and then arrive here by tapping a link that sends TEXT, so without
           this they could talk for weeks and never once hear the voice they
           picked. Once, on first contact only.
           Not awaited: the text reply has already gone out, and a TTS or Twilio
           hiccup must never turn a delivered reply into an error. */
        if (isFirstContact) {
          sendFirstVoiceNote(fromPhone, profile, expressApp)
            .catch((e) => console.error('[WhatsApp] first voice note failed:', e.message));
        }
      }

    } catch (err) {
      console.error('[WhatsApp] Error processing message:', err.message);
      // Send a graceful fallback message to the user so they aren't left hanging
      try {
        await sendTextReply(fromPhone,
          "I'm having a moment — please try again in a few seconds. I'm still here with you. 🙏"
        );
      } catch (sendErr) {
        console.error('[WhatsApp] Failed to send fallback message:', sendErr.message);
      }
    }
  })();

  return { twiml: emptyTwiML };
}

/* Send a one-off voice note outside the reply flow. Used by the settings page so
   that changing your sponsor's voice is answered IN the new voice, which is the
   only way the change is actually perceivable, and the same reasoning as the
   spoken hello. Subject to the usual 24h window: fine in practice, because they
   only have the link because they were just talking to their sponsor. */
async function sendVoiceNote(toPhone, text, voice, expressApp) {
  const audioPath = await synthesizeSpeech(text, voice);
  return sendAudioReply(toPhone, audioPath, expressApp);
}

module.exports = {
  handleIncomingMessage,
  sendTextReply,
  sendVoiceNote,
  validateTwilioSignature,
};
