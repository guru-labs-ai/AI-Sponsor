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
          isReaction: false,
          reactionEmoji: '',
          reactedTo: null,
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
        } else if (m.type === 'reaction') {
          /* Somebody long-pressed a message and put an emoji on it.

             This used to fall through with the rest and get answered with "I
             can receive text and voice messages", once per reaction, because
             the branch that sends that line sits in FRONT of the typing
             debounce. Matt reacted four times in a minute and got the same
             sentence back four times. Reading it here is what makes silence
             possible downstream.

             An EMPTY emoji is not a malformed reaction, it is Meta's way of
             saying they took the reaction back off. Kept rather than dropped:
             somebody removing a heart is a real thing that happened, and the
             caller can decide what it is worth. */
          msg.isReaction = true;
          msg.reactionEmoji = (m.reaction && m.reaction.emoji) || '';
          msg.reactedTo = (m.reaction && m.reaction.message_id) || null;
        }
        /* Everything else (image, document, sticker, location) falls through as
           its own type with empty text. The reply flow already has a branch for
           "I can receive text and voice messages", and that answer is better
           than pretending we understood. */

        out.push(msg);
      }
    }
  }
  return out;
}

/* The other half of what Meta sends: what became of the messages WE sent.

     statuses: [ { id: "wamid...", status: "sent" | "delivered" | "read" | "failed",
                   timestamp: "1790000000", recipient_id: "...",
                   errors: [ { code: 131047, title: "..." } ] } ]

   normalise() above deliberately stops at these, because nothing needs
   answering. That was fine while nobody asked whether a message arrived, and
   it is why "delivered" on a weekly review only ever meant "Meta accepted it".

   Returns plain records and nothing else. recipient_id is the person's phone
   number and is left out on purpose: the message id already ties the record to
   the person, and a number has no business in a metrics table. Tolerant like
   normalise(): one malformed entry is skipped, never thrown on. */
const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

function normaliseStatuses(body) {
  const out = [];
  if (!body || body.object !== 'whatsapp_business_account') return out;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      for (const s of ((change.value || {}).statuses) || []) {
        if (!s || !s.id || !KNOWN_STATUSES.has(s.status)) continue;
        const err = Array.isArray(s.errors) && s.errors[0] ? s.errors[0] : null;
        out.push({
          wamid: s.id,
          status: s.status,
          timestamp: s.timestamp ? Number(s.timestamp) : null,
          errorCode: err && err.code != null ? err.code : null,
          errorTitle: err && err.title ? String(err.title).slice(0, 200) : null,
        });
      }
    }
  }
  return out;
}

module.exports = { handleVerification, validateSignature, normalise, normaliseStatuses };
