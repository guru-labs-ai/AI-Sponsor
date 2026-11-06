/* ─── The first WhatsApp message, sent the moment someone signs up ───────────
   WhatsApp only lets the sponsor answer after the person has written, and
   people who signed up sat waiting for a sponsor that could not write first.
   Christine signed up twice on 7 Oct and three weeks later told us "It's not
   working". The sign-up end screen now says the first message is theirs, but
   Matt's WhatsApp group description tells people "Once registered, AI Sponsor
   will message you", and that is the better promise. So we keep it: Meta lets
   a business write first with an approved template, and this sends one short
   account message straight after sign-up.

   The wording is UTILITY on purpose, because MARKETING templates are never
   delivered to US numbers, and most AA and NA members are in the US. Meta
   decides the category, and it has been strict:
     - welcome_signup (30 Oct, "it's {{2}}, your AI Sponsor ... I'm here
       whenever you're ready") was re-filed as MARKETING.
     - A "tap Confirm to finish setting up your account" version (6 Nov) was
       rejected outright as the wrong category: it read as identity checking.
   What Meta has accepted as utility is a message the person asked for
   (checkin_requested: "you asked me to check in"). So this one says they asked
   to talk to their sponsor on WhatsApp, which is exactly what they chose on
   the last screen.

   Sent once per WhatsApp identity, never to a number that already talks to us,
   never to a number that belongs to somebody else, never for a QA Guru test.
──────────────────────────────────────────────────────────────────────────── */

const { isQaTest } = require('./qatest');

const TEMPLATE = 'signup_confirm';
const EVENT = 'signup_message_sent';

function firstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  // Meta rejects an empty variable, and a stray symbol reads as broken.
  return /[\p{L}]/u.test(first) ? first.slice(0, 40) : 'there';
}

/* Pure: whether this registration should get the message, and if not, why.
   Kept apart from the sending so every rule is tested without Meta. */
function decide({ phone, delivery, returning, email, mirrored }) {
  if (!phone) return { send: false, reason: 'no-phone' };
  if (String(delivery || '').toLowerCase() !== 'whatsapp') return { send: false, reason: 'not-whatsapp' };
  if (returning) return { send: false, reason: 'returning' };
  if (!mirrored) return { send: false, reason: 'number-belongs-to-someone-else' };
  if (isQaTest(email)) return { send: false, reason: 'qa-test' };
  return { send: true, reason: 'new-sign-up' };
}

/* Sends it, if nothing stands in the way. Never throws: a registration must
   not fail, or wait, because WhatsApp is slow or Meta says no. */
async function sendSignupMessage({ db, language, metacloud, waId, phone, name, lang, email, delivery, returning, mirrored }) {
  try {
    const verdict = decide({ phone, delivery, returning, email, mirrored });
    if (!verdict.send) return { sent: false, reason: verdict.reason };
    if (!metacloud || !metacloud.enabled) return { sent: false, reason: 'meta-off' };

    // Somebody who already writes to us needs no introduction.
    const prior = await db.getHistory(waId, 1).catch(() => null);
    if (Array.isArray(prior) && prior.length) return { sent: false, reason: 'already-talking' };
    if (await db.hasEvent(waId, EVENT).catch(() => false)) return { sent: false, reason: 'already-sent' };

    const first = firstName(name);
    const out = await language.sendTemplateIn(
      metacloud, phone, TEMPLATE, lang || 'en', () => [first], null, { mustArrive: true },
    );
    const wamid = out && out.messageId;
    db.recordEvent(waId, EVENT, { template: TEMPLATE }, 'registration').catch(() => {});
    if (wamid) db.recordOutbound(waId, wamid, 'signup', 'template').catch(() => {});
    console.log(`[register] sign-up WhatsApp message sent to ${waId.slice(0, 7)}…`);
    return { sent: true, wamid };
  } catch (e) {
    console.warn('[register] sign-up WhatsApp message not sent:', e.message);
    return { sent: false, reason: 'error', error: e.message };
  }
}

module.exports = { sendSignupMessage, decide, firstName, TEMPLATE, EVENT };
