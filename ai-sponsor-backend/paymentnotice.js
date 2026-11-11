/* ─── "Your payment went through" ────────────────────────────────────────────
   Mariam, 11 Nov 2026. Lindsay, the first person who ever paid for AI Sponsor,
   was charged $5 on 29 Sep and 29 Oct. The only thing she got each time was
   Stripe's own receipt: "Your receipt from Stand Up 8 LLC ... Questions?
   Contact us at get.guru.info@gmail.com", the shared company account's
   details, with GURU LABS on her bank statement. So when she wanted to cancel
   she did exactly what the receipt said, wrote to the Guru inbox, and waited 13
   days, because nobody there reads it for AI Sponsor.

   So every real charge now also gets a note from AI Sponsor itself: what it
   was, how it shows on the statement, and a one-tap way to change the plan or
   cancel. If they reply, it reaches AI Sponsor, not Guru.

   Built exactly like trialnotice.js, which has been doing the same job three
   days before the first charge since September: free text inside the 24-hour
   window, the approved `payment_received` template outside it, one notice per
   invoice however often Stripe retries the webhook. It speaks as the service,
   not the sponsor, for the same reason: that voice does not talk about money.

   English for now. The template exists in English only, and every other
   language falls back to it, which is what sendTemplateIn does anyway. */

const language = require('./language');
const window24 = require('./window24');

const TEMPLATE = 'payment_received';
const OUTSIDE_WINDOW = /63016|131047/;

/* "$5.00" for dollars, "4.50 EUR" for anything else. Stripe gives cents. */
function formatAmount(cents, currency = 'usd') {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return null;
  const v = (n / 100).toFixed(2);
  return String(currency || 'usd').toLowerCase() === 'usd' ? `$${v}` : `${v} ${String(currency).toUpperCase()}`;
}

/* The plan as the person chose it on the sign-up page. */
function planWord(plan) {
  const p = String(plan || '').toLowerCase();
  if (p === 'monthly' || p === 'month') return 'monthly';
  if (p === 'annual' || p === 'yearly' || p === 'year') return 'annual';
  return 'AI Sponsor';
}

/* Pure, so the wording can be read and argued about without running anything.
   Same sentences as the template, with the link written out. */
function paymentBody({ first, amount, plan, link }) {
  const hi = first ? `${first}, ` : '';
  return (
    `${hi}quick note about your account, not a message from your sponsor.\n\n` +
    `Your AI Sponsor payment of ${amount} for the ${plan} plan went through today. ` +
    `It may show on your card statement under GURU LABS.\n\n` +
    `To change your plan or cancel, tap here:\n\n${link}`
  );
}

async function sendTemplate({ metacloud, phone, first, amount, plan, day, token }) {
  let mc = metacloud;
  if (!mc) { try { mc = require('./metacloud'); } catch { return false; } }
  if (!mc.enabled || !mc.sendTemplate) return false;
  try {
    const sent = await language.sendTemplateIn(
      mc,
      `whatsapp:${phone}`,
      TEMPLATE,
      'en',
      // Meta refuses an empty variable, and plenty of people never gave a name.
      () => [String(first || '').trim() || 'there', amount, plan, day],
      `${token}#plan`,
      { mustArrive: true }
    );
    return sent || true;
  } catch (err) {
    console.warn(`[payment-notice] template failed: ${err.message}`);
    return false;
  }
}

async function notifyPayment({ user, invoiceId, amount, currency, plan, db, whatsapp, metacloud, siteUrl, now = new Date() }) {
  if (!user || !whatsapp || !db) return { sent: false, reason: 'not-configured' };
  const money = formatAmount(amount, currency);
  // A $0 invoice opens a trial; nothing was paid, so there is nothing to say.
  if (!money) return { sent: false, reason: 'no-charge' };
  if (!invoiceId) return { sent: false, reason: 'no-invoice' };

  const uid = String(user.user_id || '');
  const phone = (uid.startsWith('wa-') ? uid.slice(3) : '') || String(user.phone || '').trim();
  if (!phone) return { sent: false, reason: 'no-phone' };

  /* Stripe retries this webhook for days whenever anything after it throws.
     One note per invoice, however many times the event arrives. */
  const already = (await db.getEvents(uid, 30).catch(() => []))
    .some((e) => e.event === 'payment_notified' && String((e.detail || {}).invoiceId || '') === String(invoiceId));
  if (already) return { sent: false, reason: 'already-sent' };

  const token = await db.getOrCreateSettingsToken(uid).catch(() => null);
  if (!token) return { sent: false, reason: 'no-token' };

  const first = String(user.name || '').trim().split(/\s+/)[0];
  const planText = planWord(plan);
  const day = language.formatDay(now, 'en');
  const link = `${siteUrl}/ai-sponsor-settings.html?t=${token}#plan`;
  const body = paymentBody({ first, amount: money, plan: planText, link });

  const mark = (via) =>
    db.recordEvent(uid, 'payment_notified', { invoiceId: String(invoiceId), via }, 'stripe').catch(() => {});
  const track = (result, via) => {
    const id = result && result.messageId;
    if (!id || typeof db.recordOutbound !== 'function') return;
    db.recordOutbound(uid, id, 'payment_received', via).catch(() => {});
  };
  const failed = (reason) =>
    db.recordEvent(uid, 'payment_notify_failed', { invoiceId: String(invoiceId), reason }, 'stripe').catch(() => {});
  const viaTemplate = () => sendTemplate({ metacloud, phone, first, amount: money, plan: planText, day, token });

  /* Outside the window, straight to the template: a text sent outside it is
     accepted by Meta and refused later, so no error would ever reach us. */
  if ((await window24.insideWindow(db, phone)) === false) {
    const sent = await viaTemplate();
    if (sent) { await mark('template'); track(sent, 'template'); return { sent: true, via: 'template' }; }
    await failed('outside-24h');
    return { sent: false, reason: 'outside-24h' };
  }

  try {
    const sentMsg = await whatsapp.sendTextReply(`whatsapp:${phone}`, body);
    await mark('text');
    track(sentMsg, 'text');
    return { sent: true, via: 'text' };
  } catch (e) {
    const outside = OUTSIDE_WINDOW.test(e.message || '');
    const sent = outside ? await viaTemplate() : false;
    if (sent) { await mark('template'); track(sent, 'template'); return { sent: true, via: 'template' }; }
    await failed(outside ? 'outside-24h' : String(e.message).slice(0, 200));
    return { sent: false, reason: outside ? 'outside-24h' : 'send-failed' };
  }
}

module.exports = { notifyPayment, paymentBody, formatAmount, planWord, TEMPLATE };
