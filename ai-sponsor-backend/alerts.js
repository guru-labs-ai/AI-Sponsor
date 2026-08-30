/* ─── AI Sponsor → Slack alerts (#ai-sponsor-updates) ────────────────────────
   The product-side twin of the Zapier "NEW CUSTOMER ALERT" zap that serves DRM
   from the shared Stripe account.

   Why this lives here and not in Zapier:

   1. A Zapier zap sits on the Stripe account, which is shared by every Guru
      product, so it cannot reliably tell an AI Sponsor event from a DRM one.
      This module runs behind belongsToAiSponsor(), so it only ever sees ours.

   2. Both AI Sponsor plans open with a 30-day trial, so checkout takes $0.
      The DRM zap prints "NEW CUSTOMER ALERT" with a plan amount on a $0 trial
      invoice, which read as a closed sale on 30 Aug 2026 when it was not one.
      Every message here says in words whether money actually moved.

   3. Most of what matters on this product never touches Stripe at all. The
      founding cohort registers with a free code, so a Stripe-only alert would
      have shown nothing for the entire launch.

   Sends are fire-and-forget: an alert must never fail a registration or make us
   return non-2xx to Stripe (which would trigger three days of retries).

   Setup: SLACK_BOT_TOKEN (the "AI Sponsor Metrics" app, already used by the
   north-star post) and SLACK_ALERTS_CHANNEL. The bot has to be invited to the
   channel first, otherwise Slack answers channel_not_found. Unset = no-op, so
   this is inert until both are set.

   Deliberately NOT included in any message: programme, recovery stage, what
   brought them here, or anything they have said to their sponsor. The channel
   has an external contractor in it, and none of that is needed to know a sale
   happened. Name and email match what the DRM alerts already show.
──────────────────────────────────────────────────────────────────────────── */

const SLACK_POST_MESSAGE = 'https://slack.com/api/chat.postMessage';
const DEFAULT_CHANNEL = 'C0BQYBMJPP0'; // #ai-sponsor-updates

// Mariam, Matt. Money and failures only, so the mention still means something.
const MENTIONS = '<@U0B8NJSJYQH> <@U07212P3QNS>';

const GHL_LOCATION = process.env.GHL_LOCATION_ID || 'Mgfec8mT0vXxyhp9SizK';

/* Stripe deals in unix seconds, our own rows in Date objects. Everything is
   printed in UTC with the zone named, because the team reads these across four
   timezones and "29 September" alone is ambiguous about when we charge. */
function fmtDate(value) {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtMoney(cents, currency) {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  return `$${amount} ${String(currency || 'usd').toUpperCase()}`;
}

function ghlLink(contactId) {
  return contactId
    ? `<https://app.gohighlevel.com/v2/location/${GHL_LOCATION}/contacts/detail/${contactId}|View in GHL>`
    : null;
}

function who({ name, email }) {
  const n = (name || '').trim();
  const e = (email || '').trim();
  if (n && e) return `${n} (${e})`;
  return n || e || 'unknown person';
}

async function send(lines) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERTS_CHANNEL || DEFAULT_CHANNEL;
  if (!token) return { ok: false, skipped: 'no SLACK_BOT_TOKEN' };

  const text = lines.filter(Boolean).join('\n');
  const res = await fetch(SLACK_POST_MESSAGE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
  });
  const body = await res.json().catch(() => ({}));
  // Slack answers 200 with ok:false for real failures (channel_not_found,
  // not_in_channel, invalid_auth), so the status code alone proves nothing.
  if (!body.ok) throw new Error(`Slack rejected the alert: ${body.error || 'unknown'}`);
  return body;
}

/* The public surface. Each returns a promise that never rejects: callers are
   in the middle of a registration or a Stripe webhook and must not be taken
   down by Slack being unreachable. */
function safe(build) {
  return (payload = {}) =>
    Promise.resolve()
      .then(() => send(build(payload)))
      .catch((e) => {
        console.warn('[alerts] not delivered:', e.message);
        return { ok: false, error: e.message };
      });
}

/* Someone finished onboarding. The only alert that fires for the founding
   cohort, who pay nothing and so produce no Stripe event whatsoever. */
const registered = safe(({ name, email, access, sponsorName, delivery, contactId, returning }) => [
  returning
    ? ':arrows_counterclockwise: *Returning person re-registered*'
    : ':wave: *New AI Sponsor registration*',
  `*Who:* ${who({ name, email })}`,
  `*Access:* ${access || 'Unpaid'}${access === 'Beta' ? ' (founding member, free)' : ''}`,
  sponsorName ? `*Sponsor named:* ${sponsorName}` : null,
  delivery ? `*Talking on:* ${delivery}` : null,
  'No money involved at registration.',
  ghlLink(contactId),
]);

/* Card accepted, trial open. This is the one the DRM zap gets wrong. */
const trialStarted = safe(({ name, email, plan, firstChargeAt }) => [
  ':credit_card: *Trial started, card on file*',
  `*Who:* ${who({ name, email })}`,
  `*Plan:* ${plan === 'annual' ? '$49/year' : '$5/month'} after a 30 day free trial`,
  '*Charged today:* $0.00. This is not a sale yet.',
  firstChargeAt ? `*First charge:* ${fmtDate(firstChargeAt)}` : null,
  'Stripe validated the card before the trial opened, so it is real and chargeable.',
]);

/* Real money, for the first time in the funnel. */
const paid = safe(({ name, email, plan, amount, currency, billingReason, invoiceId }) => [
  ':moneybag: *PAID. Money actually moved.*',
  MENTIONS,
  `*Who:* ${who({ name, email })}`,
  `*Amount:* ${fmtMoney(amount, currency)}`,
  `*Plan:* ${plan || 'unknown'}`,
  billingReason === 'subscription_cycle'
    ? '*What this is:* a 30 day trial converting, or a renewal.'
    : `*What this is:* ${billingReason || 'unknown billing reason'}.`,
  invoiceId ? `*Invoice:* ${invoiceId}` : null,
]);

/* Three days before we take the first $5. The window to save the customer. */
const trialEnding = safe(({ name, email, trialEnd }) => [
  ':hourglass_flowing_sand: *Trial ends in 3 days*',
  `*Who:* ${who({ name, email })}`,
  trialEnd ? `*First charge:* ${fmtDate(trialEnd)}` : null,
  'They have not paid anything yet. Last chance to reach them before we do.',
]);

const paymentFailed = safe(({ name, email, attemptCount, amount, currency }) => [
  ':warning: *Payment failed*',
  MENTIONS,
  `*Who:* ${who({ name, email })}`,
  amount ? `*Amount:* ${fmtMoney(amount, currency)}` : null,
  `*Attempt:* ${attemptCount || 1}. Stripe will retry automatically.`,
]);

const cancelled = safe(({ name, email, keptAccess }) => [
  ':door: *Subscription cancelled*',
  `*Who:* ${who({ name, email })}`,
  keptAccess === 'Beta'
    ? 'Founding member, so their free access continues.'
    : 'Access set to Unpaid.',
]);

module.exports = {
  registered,
  trialStarted,
  paid,
  trialEnding,
  paymentFailed,
  cancelled,
  // exported for the test harness
  _internals: { fmtDate, fmtMoney, who, send, DEFAULT_CHANNEL },
};
