/* ─── Inbound WhatsApp, straight from Meta ───────────────────────────────────

   WHY THIS FILE EXISTS. metacloud.js was built on Aug 18 to send voice notes
   through Meta while everything else stayed on Twilio. On Aug 24 that plan was
   tested properly with our own Meta app, a permanent system user token and the
   app subscribed to the WABA, and Meta refuses every send on this number with
   `(#200) You do not have the necessary permissions` — text and audio alike,
   with the 24-hour window open and closed. Uploads succeed, reads succeed.
   We hold management rights on the number; the messaging right sits with
   Twilio, who registered it.

   So the destination changed: not a hybrid, the whole surface. That means
   listening here too, because the moment the number is registered to our app
   Twilio's webhook stops firing, and anything this file does not handle is
   somebody reaching out to their sponsor and getting silence.

   ⚠️ NOTHING HERE RUNS UNTIL BOTH: the number is registered to our app, AND
   META_WA_INBOUND=1. server.js will not even mount the routes otherwise.

   WHAT META SENDS, from the documented payload shape:
     { object: "whatsapp_business_account",
       entry: [ { id: <waba id>,
                  changes: [ { field: "messages",
                               value: { messaging_product: "whatsapp",
                                        metadata: { phone_number_id },
                                        contacts: [ { wa_id, profile } ],
                                        messages: [ { from, id, timestamp, type,
                                                      text: { body },
                                                      audio: { id, mime_type, voice } } ],
                                        statuses: [ ... ] } } ] } ] }

   Two things that are easy to get wrong and expensive to get wrong:

   1. `from` is a BARE E.164 with no plus. Everything downstream speaks Twilio's
      "whatsapp:+4477..." and waUserId() turns that into the "wa-" identity key
      the Jul 10 beta import used. Hand it a bare number and all 58 imported
      members become brand-new strangers with no profile and no history. The
      plus goes back on here, once, and never anywhere else.

   2. One webhook can carry SEVERAL messages, and Meta retries the whole
      delivery if we do not 200 quickly. Both are handled by the caller: we
      return a list, server.js answers 200 immediately and processes after. */

const crypto = require('crypto');
const metacloud = require('./metacloud');

/* Meta calls this once when the callback URL is saved in the app dashboard, and
   again whenever it is edited. It is a GET, not a POST, and getting it wrong is
   the difference between "webhook saved" and an error dialog with no detail.

   The verify token is ours to choose and only has to match what is typed into
   the dashboard. It is NOT a Meta credential, which is worth saying because it
   looks like one and gets treated like one. */
function handleVerification(req) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.META_WA_VERIFY_TOKEN;

  if (!expected) {
    console.error('[Meta] META_WA_VERIFY_TOKEN is not set — cannot complete the handshake');
    return { status: 500, body: 'not configured' };
  }
  if (mode === 'subscribe' && token === expected) {
    console.log('[Meta] webhook verification handshake passed');
    return { status: 200, body: String(challenge == null ? '' : challenge) };
  }
  console.warn('[Meta] webhook verification failed — mode or token did not match');
  return { status: 403, body: 'Forbidden' };
}

/* The equivalent of validateTwilioSignature, and not optional for the same
   reason: without it anyone who finds the URL can put words in front of
   somebody's sponsor.

   Meta signs the RAW body, so server.js has to keep it. A re-serialised
   JSON.stringify of the parsed object will differ by a space or a key order and
   fail every time, which reads exactly like a wrong app secret. */
function validateSignature(req) {
  /* Same carve-out as the Twilio path: local dev has no tunnel and no secret,
     and refusing to run there just means nobody tests this before it is live. */
  if (process.env.NODE_ENV !== 'production') return true;

  const secret = metacloud.APP_SECRET;
  if (!secret) {
    console.error('[Meta] META_APP_SECRET is not set — refusing unverified webhook');
    return false;
  }
  const header = req.headers['x-hub-signature-256'];
  if (!header || !header.startsWith('sha256=')) {
    console.warn('[Meta] webhook has no x-hub-signature-256 header');
    return false;
  }
  const raw = req.rawBody;
  if (!raw || !raw.length) {
    console.warn('[Meta] webhook raw body missing — cannot verify signature');
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = header.slice('sha256='.length);

  /* Both halves have to be the same length before timingSafeEqual will look at
     them, and it throws rather than returning false if they are not. */
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'));
}

/* Meta's envelope down to the handful of things the reply flow actually needs,
   in the same shape the Twilio parse produces, so that everything downstream of
   the parse stays one code path rather than two.

   Deliberately tolerant. A malformed or unexpected entry is skipped with a log
   rather than throwing, because one odd message in a batch must not take out
   the others sitting beside it in the same delivery. */
function normalise(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account') return out;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};

      /* Delivery and read receipts for messages WE sent. Useful later for
         knowing a voice note landed; nothing to answer, so they stop here
         rather than being mistaken for somebody talking to us. */
      if (value.statuses && !value.messages) continue;

      for (const m of value.messages || []) {
        if (!m || !m.from || !m.id) {
          console.warn('[Meta] skipping a message with no sender or id');
          continue;
        }
        const msg = {
          fromPhone: `whatsapp:+${String(m.from).replace(/[^\d]/g, '')}`, // see note 1 at the top
          wamid: m.id,
          type: m.type || 'unknown',
          text: '',
          isAudio: false,
          mediaId: null,
          mediaType: '',
        };

        if (m.type === 'text') {
          msg.text = (m.text && m.text.body) || '';
        } else if (m.type === 'audio') {
          msg.isAudio = true;
          msg.mediaId = (m.audio && m.audio.id) || null;
          msg.mediaType = (m.audio && m.audio.mime_type) || '';
          if (!msg.mediaId) {
            console.warn('[Meta] audio message with no media id — treating as unsupported');
            msg.isAudio = false;
          }
        }
        /* Everything else (image, document, sticker, location, reaction) falls
           through as its own type with empty text. The reply flow already has a
           branch for "I can receive text and voice messages", and that answer is
           better than pretending we understood. */

        out.push(msg);
      }
    }
  }
  return out;
}

module.exports = { handleVerification, validateSignature, normalise };
