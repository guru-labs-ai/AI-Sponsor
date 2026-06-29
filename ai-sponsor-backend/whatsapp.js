/* ─── WhatsApp (Twilio) Two-Way Text + Audio Module ────────────────────────
   
   ARCHITECTURE (per Matt's Phase 3 spec):
   User → WhatsApp → Twilio → AI Sponsor (this file) → Claude → AI Sponsor → Twilio → User

   WHAT THIS MODULE DOES:
   1. Receives inbound Twilio webhook (POST from Twilio when user sends a message)
   2. Validates the request is genuinely from Twilio (security — not optional)
   3. If text     → sends directly to Claude
   4. If audio    → downloads the OGG voice note → Whisper transcribes it → Claude
   5. Gets Claude's reply (same getSponsorReply() function as web chat — identical AI behavior)
   6. If original was text  → sends text reply back via Twilio
   7. If original was audio → sends text reply AND synthesized audio reply via Twilio TTS
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Twilio client for sending outbound messages (replies)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Your Wyoming (307) Twilio WhatsApp number — set in .env once purchased
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. "whatsapp:+13071234567"

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
   Converts Claude's text reply into an MP3 voice note to send back.
   'nova' voice = warm, natural, good fit for a supportive sponsor persona.
   NOTE: verify 'gpt-4o-mini-tts' is available on your OpenAI account.
   If not, fall back to 'tts-1'. */
async function synthesizeSpeech(text) {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',  // safer fallback; upgrade to 'gpt-4o-mini-tts' when confirmed available
    voice: 'nova',
    input: text,
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  const tmpPath = path.join(os.tmpdir(), `wa-reply-${Date.now()}.mp3`);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
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
  
  // Register a one-time route on the Express app to serve this specific file
  expressApp.get(`/media/${filename}`, (req, res) => {
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
      // userId = the sender's phone number (strips "whatsapp:" prefix for consistency)
      const userId = fromPhone.replace('whatsapp:', '');
      const replyText = await getSponsorReply(userId, userMessageText);
      console.log(`[WhatsApp] Claude reply to ${fromPhone}: "${replyText.substring(0, 80)}..."`);

      // ── 6. Send text reply (always) ──────────────────────────────────────
      await sendTextReply(fromPhone, replyText);

      // ── 7. Also send audio reply if user sent a voice note ───────────────
      if (isAudio) {
        const audioPath = await synthesizeSpeech(replyText);
        await sendAudioReply(fromPhone, audioPath, expressApp);
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

module.exports = {
  handleIncomingMessage,
  sendTextReply,
  validateTwilioSignature,
};
