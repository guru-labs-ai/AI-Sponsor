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

/* ── Bind a registration to the number it actually messaged from ─────────────
   The prefilled wa.me message carries a one-time code. Twilio tells us the real
   sending number, which no typo can fake, so claiming that code is what turns a
   number somebody typed into a number we know is theirs.

   Copies their registration profile onto the wa- identity and corrects the
   phone on the registration row to the real one. Deliberately does NOT touch an
   existing wa- profile's own fields beyond the merge: saveProfile merges, so
   someone re-linking cannot blank what is already there.

   Silent when there is no code, which is every ordinary message. */
/* Parenthesised, because that is exactly how the prefill writes it and a bare
   six-character token is not distinctive enough: THANKS, SUNDAY and BETTER all
   fit this alphabet. A stray word colliding with somebody else's live code
   would bind a stranger's registration to this phone, which is precisely the
   harm the codes exist to prevent. */
const LINK_CODE_RE = /\(([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6})\)/;

async function bindLinkCode(text, waUserIdValue, realPhone) {
  if (!text) return;
  const m = LINK_CODE_RE.exec(String(text).toUpperCase());
  if (!m) return;

  const regUserId = await db.claimLinkCode(m[1], realPhone).catch(() => null);
  if (!regUserId) return; // not a real code, already used, or expired

  try {
    const profile = (await db.getProfile(regUserId)) || {};
    const reg = (await db.getUser(regUserId)) || {};
    // Nothing to carry across means something upstream failed to store it, and
    // writing an empty profile over theirs would make it worse, not better.
    if (Object.keys(profile).length) await db.saveProfile(waUserIdValue, profile);
    await db.upsertUser({
      userId: waUserIdValue,
      name: reg.name, email: reg.email, phone: realPhone,
      ghlContactId: reg.ghl_contact_id,
      sponsorName: reg.sponsor_name, sponsorStyle: reg.sponsor_style,
      program: reg.program, stage: reg.stage, access: reg.access,
    });
    // The number they typed may have been wrong; this one is not.
    await db.upsertUser({ userId: regUserId, phone: realPhone });
    db.recordEvent(regUserId, 'phone_verified',
      { phone: realPhone, boundTo: waUserIdValue }, 'whatsapp-link-code').catch(() => {});
    console.log(`[WhatsApp] link code claimed: ${regUserId} verified as ${realPhone}`);
  } catch (e) {
    console.error('[WhatsApp] link code binding failed:', e.message);
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
/* WhatsApp caps a message at 1600 characters and Twilio rejects the whole thing
   for going over, which is how a beta user got "I'm having a moment" twice
   instead of his answer: the sponsor wrote something long, Twilio refused it,
   and the entire reply was lost.

   So long replies are split and sent in order, which is what a person does
   anyway when they have a lot to say. 1500 leaves room, because the limit
   counts the concatenated body and I would rather not find the exact edge with
   somebody's 3am message.

   Split on a paragraph break where there is one, then a sentence end, then a
   space, so the break lands somewhere a human would have paused rather than
   mid-word. */
const WA_CHAR_LIMIT = 1500;

function splitForWhatsApp(text) {
  const clean = String(text || '').trim();
  if (clean.length <= WA_CHAR_LIMIT) return [clean];

  const parts = [];
  let rest = clean;
  while (rest.length > WA_CHAR_LIMIT) {
    const window = rest.slice(0, WA_CHAR_LIMIT);
    let cut = window.lastIndexOf('\n\n');
    if (cut < WA_CHAR_LIMIT * 0.4) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
    if (cut < WA_CHAR_LIMIT * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = WA_CHAR_LIMIT - 1; // no break to find, e.g. one long unbroken string
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

async function sendTextReply(toPhone, text) {
  // Twilio rejects an empty body, and there is nothing to say anyway.
  const parts = splitForWhatsApp(text).filter((p) => p.length);
  if (!parts.length) {
    console.warn('[WhatsApp] nothing to send — empty reply');
    return null;
  }
  if (parts.length > 1) {
    console.log(`[WhatsApp] reply is ${String(text).length} chars — sending as ${parts.length} messages`);
  }
  let last;
  for (const body of parts) {
    // Sequentially, so they arrive in the order they were written.
    last = await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: toPhone, // already has "whatsapp:" prefix from Twilio's incoming payload
      body,
    });
  }
  return last;
}

/* ── Send audio reply via Twilio REST API ────────────────────────────────────
   Twilio needs a public URL to fetch the audio from. We serve it from our own
   Express server at /media/:filename, Twilio fetches it, WhatsApp delivers it.

   The file used to be deleted the moment it had been served once. That is a
   race: Twilio does not necessarily fetch a URL exactly once, and sendFile's
   callback fires on a mid-stream error as well as on success, so a retry could
   arrive to find nothing there and report 63019, "media failed to download".
   Cleanup is now left entirely to the timer below. A few audio files living in
   the container's temp directory for five minutes costs nothing; a voice note
   that never arrives costs somebody their reply. */
async function sendAudioReply(toPhone, audioFilePath, expressApp) {
  const filename = path.basename(audioFilePath);

  /* No route is registered here on purpose. server.js mounts /media/:filename
     at boot, which therefore matches before anything added later, so a
     per-file route registered now would never be reached. One used to be, and
     it quietly did nothing while looking like the thing serving the audio.
     server.js owns serving; this function owns making the file and sending the
     message. */

  // Cleanup, five minutes after the message goes out. Deliberately not "delete
  // once served": Twilio does not promise to fetch a URL exactly once, and a
  // retry finding nothing there is 63019 all over again.
  setTimeout(() => fs.unlink(audioFilePath, () => {}), 5 * 60 * 1000);

  /* Fetch our own URL from the public internet before handing it to Twilio.
     Twilio reports a failed media download as 63019 asynchronously, long after
     messages.create() has resolved, so by the time it is known the reply is
     already lost and there is nothing left to fall back to. This does the same
     round trip Twilio is about to do, through the same proxy, and turns a
     silent delivery failure into an ordinary error we can still recover from. */
  const publicAudioUrl = `${process.env.RENDER_EXTERNAL_URL}/media/${filename}`;

  const probe = await fetch(publicAudioUrl, { method: 'GET' })
    .then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }))
    .catch((e) => ({ status: 0, type: null, bytes: 0, error: e.message }));

  if (probe.status !== 200 || !probe.bytes) {
    throw new Error(
      `media URL not fetchable (status=${probe.status} bytes=${probe.bytes} type=${probe.type}${probe.error ? ' err=' + probe.error : ''})`
    );
  }
  console.log(`[WhatsApp] media reachable: ${probe.bytes} bytes as ${probe.type}`);

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
      /* Does this message carry a link code from a registration? If so, the
         number it arrived from is proof, and it beats whatever they typed into
         the form. Bind before anything else, so the reply that follows already
         comes from the sponsor they built rather than a stranger. */
      await bindLinkCode(userMessageText, userId, fromPhone.replace('whatsapp:', ''));

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

      const replyText = await getSponsorReply(userId, userMessageText, { channel: 'whatsapp', viaVoice: isAudio });
      console.log(`[WhatsApp] Claude reply to ${fromPhone}: "${replyText.substring(0, 80)}..."`);

      // ── 6/7. Reply in the same medium the person used ────────────────────
      // Voice in, voice back. Text in, text back. No longer sends both.
      if (isAudio) {
        /* Voice back, but never at the cost of the reply itself. Synthesis or
           media delivery can fail (a provider blip, Twilio failing to fetch the
           file), and until now that meant somebody who reached out got complete
           silence. On this product that is the worst failure available: the
           person assumes they were ignored. If the voice note cannot be sent,
           the words still go. */
        try {
          const audioPath = await synthesizeSpeech(replyText, profile && profile.sponsorVoice);
          await sendAudioReply(fromPhone, audioPath, expressApp);
        } catch (voiceErr) {
          console.error('[WhatsApp] voice reply failed, falling back to text:', voiceErr.message);
          await sendTextReply(fromPhone, replyText);
        }
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

/* Deleting someone has to clear this process's "already captured" guard too,
   or a person who deletes and later comes back is silently skipped by
   captureWhatsAppUser until the next deploy. */
function clearCapturedNumber(userId) {
  capturedNumbers.delete(userId);
}

module.exports = {
  clearCapturedNumber,
  handleIncomingMessage,
  sendTextReply,
  sendVoiceNote,
  validateTwilioSignature,
};
