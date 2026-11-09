/* ─── AI Sponsor → Slack alerts ───────────────────────────────────────────────
   Sign-ups and Stripe events: #realtime-alerts (Matt's command center).
   Meeting reports and deletion replies: #ai-sponsor-updates.

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

const { resolveSource } = require('./db'); // one shared definition of "came from"
const { isQaTest } = require('./qatest'); // QA Guru's test inbox is not a person

const SLACK_POST_MESSAGE = 'https://slack.com/api/chat.postMessage';
const DEFAULT_CHANNEL = 'C0BQYBMJPP0'; // #ai-sponsor-updates

/* Sign-ups and every Stripe event go to Matt's company command center,
   #realtime-alerts (his ask, 20 Oct 2026: "signups, trials, purchases,
   cancellations, failed payments... for any/all products"). They MOVED there,
   they are not copied: Mariam, 9 Nov, "reroute what we already have". The two
   alerts that are jobs for the AI Sponsor team (a meeting that did not work,
   a reply during a pending deletion) stay in #ai-sponsor-updates.
   SLACK_CUSTOMER_CHANNEL overrides the command center channel. */
const CUSTOMER_CHANNEL = 'C0CANT8BT17'; // #realtime-alerts

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

/* Matt, 20 Oct, for #realtime-alerts: every alert shows "severity, ... a
   source link, and who or which agent owns the next action". AI Sponsor's
   owner is Mariam. Severity is one of two words, so it reads at a glance:
   "Info" (nothing to do) or "Needs attention" (someone should act). */
const OWNER = 'Mariam';
function triage(severity) {
  return `*Severity:* ${severity} · *Owner:* ${OWNER}`;
}

function stripeLink(kind, id) {
  if (!id || !/^(cus|in)_[A-Za-z0-9]+$/.test(String(id))) return null;
  const test = /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '') ? '/test' : '';
  const label = kind === 'invoices' ? 'Open the invoice in Stripe' : 'Open the customer in Stripe';
  return `<https://dashboard.stripe.com${test}/${kind}/${id}|${label}>`;
}

/* Matt, 31 Oct: he wants to message people himself when they start a trial,
   pay, fail a payment or cancel. The number opens a WhatsApp chat in one tap. */
function phoneLine(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? `*Phone:* <https://wa.me/${digits}|+${digits}> (tap to WhatsApp them)` : null;
}

/* Where this person came from, in as much detail as we actually hold.

   The headline label is db.resolveSource(), the same rule the dashboard groups
   on, so a signup and the chart can never tell different stories. Everything
   under it is the raw first-touch record, printed only when it exists.

   Honesty rule, inherited from resolveSource: no browser data at all means
   "Unknown", never "Direct". Direct is a claim that they typed us in. Unknown
   is the truth when a WhatsApp arrival or an import reached us with no page
   behind it, and quietly upgrading one to the other invents credit we did not
   earn. Ad clicks matter most here: fbclid or gclid is the only proof a paid
   click produced this person, and on a 30-day trial it is the only thing that
   will still be around when the money finally lands. */
function sourceLines(attribution) {
  const raw = attribution && typeof attribution === 'object' ? attribution : null;
  if (!raw || !Object.keys(raw).length) {
    return ['*Came from:* Unknown (no browser data reached us)'];
  }

  /* Two shapes reach this function and they are not the same. The browser posts
     camelCase to /register; Stripe hands back the subscription metadata, which
     is snake_case because that is how it was written at checkout. Reading only
     one shape would silently label every paying customer "Unknown", which is
     the exact failure this alert exists to prevent. */
  const a = {
    utmSource: raw.utmSource || raw.utm_source || '',
    utmMedium: raw.utmMedium || raw.utm_medium || '',
    utmCampaign: raw.utmCampaign || raw.utm_campaign || '',
    referrer: raw.referrer || '',
    landing: raw.landing || '',
    firstSeen: raw.firstSeen || raw.first_seen || '',
    fbclid: raw.fbclid || '',
    gclid: raw.gclid || '',
  };

  const utms = [
    a.utmSource ? `source ${a.utmSource}` : null,
    a.utmMedium ? `medium ${a.utmMedium}` : null,
    a.utmCampaign ? `campaign ${a.utmCampaign}` : null,
  ].filter(Boolean);

  const paidClick = a.fbclid ? 'Meta (fbclid)' : a.gclid ? 'Google (gclid)' : null;

  return [
    `*Came from:* ${resolveSource(a)}`,
    a.referrer ? `*Referrer:* ${a.referrer}` : null,
    utms.length ? `*Campaign:* ${utms.join(', ')}` : null,
    paidClick ? `*Paid click:* ${paidClick}, so this one can be attributed to an ad` : null,
    a.landing ? `*Landed on:* ${a.landing}` : null,
    a.firstSeen ? `*First seen:* ${a.firstSeen}` : null,
  ].filter(Boolean);
}

function opsChannel() {
  return process.env.SLACK_ALERTS_CHANNEL || DEFAULT_CHANNEL;
}

function customerChannel() {
  return process.env.SLACK_CUSTOMER_CHANNEL || CUSTOMER_CHANNEL;
}

async function send(lines, channelOverride) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = channelOverride || opsChannel();
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

/* The same, for alerts that belong in the command center. If Slack refuses
   that channel (most likely the bot was never invited, which Slack reports as
   channel_not_found), the alert falls back to #ai-sponsor-updates with a note
   saying why, so a payment is never lost to a channel setting. */
async function sendCustomer(lines) {
  try {
    return await send(lines, customerChannel());
  } catch (e) {
    if (customerChannel() === opsChannel()) throw e;
    console.warn('[alerts] command center refused, falling back:', e.message);
    return send([
      ...lines,
      `_Meant for #realtime-alerts, but Slack said: ${e.message}. Type /invite @AI Sponsor Metrics there._`,
    ], opsChannel()).catch((e2) => {
      throw new Error(`${e.message}; fallback also failed: ${e2.message}`);
    });
  }
}

function safeCustomer(build) {
  return (payload = {}) =>
    Promise.resolve()
      .then(() => sendCustomer(build(payload)))
      .catch((e) => {
        console.warn('[alerts] not delivered:', e.message);
        return { ok: false, error: e.message };
      });
}

/* A support ticket from the site's form. Moved to #realtime-alerts on 9 Nov
   (Matt's list for that channel names "support tickets"). It pings the two
   people who answer them. QA Guru's test tickets still post nothing (Mariam,
   9 Nov); the ticket itself is saved in GHL either way. */
const SUPPORT_MENTIONS = '<@U0B8NJSJYQH> <@U08V21E9Q8Z>'; // Mariam, Mubashir (Abdul off, Matt 6 Nov)
const supportTicketAlert = safeCustomer(({ name, email, subject, message, contactId }) => [
  ':envelope_with_arrow: *New AI Sponsor support ticket*',
  SUPPORT_MENTIONS,
  `*From:* ${name || '(no name)'} (${email || 'no email'})`,
  `*Subject:* ${subject || '(none)'}`,
  `*Message:* ${message || '(none)'}`,
  triage('Needs attention'),
  ghlLink(contactId),
]);

function supportTicket(payload = {}) {
  if (isQaTest(payload.email)) {
    console.log('[support] QA Guru test ticket: no Slack message');
    return Promise.resolve({ ok: true, skipped: 'qa-test' });
  }
  return supportTicketAlert(payload);
}

/* Someone finished onboarding. The only alert that fires for the founding
   cohort, who pay nothing and so produce no Stripe event whatsoever. */
const registeredAlert = safeCustomer(({
  name, email, phone, access, sponsorName, delivery, contactId, returning, attribution,
  code, codeDays,
}) => [
  returning
    ? ':arrows_counterclockwise: *AI Sponsor · Returning person re-registered*'
    : ':wave: *New AI Sponsor registration*',
  `*Who:* ${who({ name, email })}`,
  phone ? `*Phone:* ${phone}` : null,
  `*Access:* ${access || 'Unpaid'}${access === 'Beta' ? ' (founding member, free)' : ''}`,
  // Which group's code, so AA and NA sign-ups can be told apart at a glance.
  code ? `*Code:* ${code}${codeDays ? ` (${codeDays} days free)` : ''}` : null,
  ...sourceLines(attribution),
  sponsorName ? `*Sponsor named:* ${sponsorName}` : null,
  delivery ? `*Talking on:* ${delivery}` : null,
  access === 'Beta'
    ? 'Free code redeemed, so no money is involved and Stripe never sees this one.'
    : 'No money involved at registration.',
  triage('Info'),
  ghlLink(contactId),
]);

/* QA Guru's test sign-ups post nothing at all. Mariam, 9 Nov 2026: "can we
   just stop getting these messages". The contact is still saved in GHL,
   tagged qa-test, so the test can check its own run, and each one leaves a
   line in the Render log. */
function registered(payload = {}) {
  if (isQaTest(payload.email)) {
    console.log('[alerts] QA Guru test sign-up: no Slack alert');
    return Promise.resolve({ ok: true, skipped: 'qa-test' });
  }
  return registeredAlert(payload);
}

/* Card accepted, trial open. This is the one the DRM zap gets wrong. */
const trialStarted = safeCustomer(({
  name, email, phone, plan, firstChargeAt, attribution, customerId,
}) => [
  ':credit_card: *AI Sponsor · Trial started, card on file*',
  `*Who:* ${who({ name, email })}`,
  phoneLine(phone),
  `*Plan:* ${plan === 'annual' ? '$49/year' : '$5/month'} after a 30 day free trial`,
  '*Charged today:* $0.00. This is not a sale yet.',
  firstChargeAt ? `*First charge:* ${fmtDate(firstChargeAt)}` : null,
  ...sourceLines(attribution),
  'Stripe validated the card before the trial opened, so it is real and chargeable.',
  triage('Info'),
  stripeLink('customers', customerId),
]);

/* Real money, for the first time in the funnel. */
const paid = safeCustomer(({
  name, email, phone, plan, amount, currency, billingReason, invoiceId, attribution,
}) => [
  ':moneybag: *AI Sponsor · PAID. Money actually moved.*',
  MENTIONS,
  `*Who:* ${who({ name, email })}`,
  phoneLine(phone),
  `*Amount:* ${fmtMoney(amount, currency)}`,
  `*Plan:* ${plan || 'unknown'}`,
  /* The ad click that produced this customer, written at checkout 30 days ago
     and carried here by Stripe. Meta's attribution window is 7 days, so by the
     time this fires the ad platforms have long since stopped claiming it. This
     line is the only place the connection still exists. */
  ...sourceLines(attribution),
  billingReason === 'subscription_cycle'
    ? '*What this is:* a 30 day trial converting, or a renewal.'
    : `*What this is:* ${billingReason || 'unknown billing reason'}.`,
  invoiceId ? `*Invoice:* ${invoiceId}` : null,
  triage('Info'),
  stripeLink('invoices', invoiceId),
]);

/* Somebody told the sponsor a meeting it gave them did not work. Our list is a
   copy of each directory, so this is how a dead room comes to light. Nobody
   is named: the meeting is what needs checking, not the person. */
const meetingProblem = safe(({ name, program, what, fix, link, source, checkLink }) => [
  ':warning: *A meeting did not work for someone*',
  `*Meeting:* ${name || 'unknown'}${program ? ` (${program})` : ''}`,
  what ? `*What they said:* ${what}` : null,
  fix ? `*Right details they gave:* ${fix}` : null,
  link ? `*Link:* ${link}` : null,
  source ? `*Listing:* ${source}` : null,
  '*Now:* the sponsor stops offering it until somebody checks it, or its listing is updated in the directory.',
  checkLink ? `*Check it:* <${checkLink}|open the meetings to check>` : null,
]);

/* Three days before we take the first $5. The window to save the customer. */
const trialEnding = safeCustomer(({ name, email, phone, trialEnd, customerId }) => [
  ':hourglass_flowing_sand: *AI Sponsor · Trial ends in 3 days*',
  `*Who:* ${who({ name, email })}`,
  phoneLine(phone),
  trialEnd ? `*First charge:* ${fmtDate(trialEnd)}` : null,
  'They have not paid anything yet. Last chance to reach them before we do.',
  triage('Info'),
  stripeLink('customers', customerId),
]);

const paymentFailed = safeCustomer(({
  name, email, phone, attemptCount, amount, currency, nextAttemptAt, invoiceId, customerId,
}) => [
  ':warning: *AI Sponsor · Payment failed*',
  MENTIONS,
  `*Who:* ${who({ name, email })}`,
  phoneLine(phone),
  amount ? `*Amount:* ${fmtMoney(amount, currency)}` : null,
  `*Attempt:* ${attemptCount || 1}. Stripe will retry automatically${fmtDate(nextAttemptAt) ? ` on ${fmtDate(nextAttemptAt)}` : ''}.`,
  triage('Needs attention'),
  stripeLink('invoices', invoiceId) || stripeLink('customers', customerId),
]);

/* duringTrial answers the first thing Matt asked about a cancel (31 Oct): had
   they paid, or were they still on the free trial? Left out when unknown. */
const cancelled = safeCustomer(({ name, email, phone, keptAccess, duringTrial, customerId }) => [
  ':door: *AI Sponsor · Subscription cancelled*',
  `*Who:* ${who({ name, email })}`,
  phoneLine(phone),
  duringTrial === true ? '*Paid so far:* nothing. They cancelled during the 30 day free trial.' : null,
  duringTrial === false ? '*Paid so far:* they cancelled after the free trial ended.' : null,
  keptAccess === 'Beta'
    ? 'Founding member, so their free access continues.'
    : 'Access set to Unpaid.',
  triage('Needs attention'),
  stripeLink('customers', customerId),
]);

/* Somebody with a deletion counting down has written back. Every leaving
   message ends by inviting exactly this reply, and the reply lands on the
   sponsor, which cannot stop a deletion. Without this line the invitation is a
   promise nothing keeps.

   The message they sent is NOT included. It is a conversation with their
   sponsor, and this channel is read by more people than need it, including an
   external contractor. Same rule as the deactivation alert. */
const leavingReply = safe(({ name, userId, scheduledFor }) => ([
  '↩️ *Somebody with a pending deletion has replied*',
  `${name || userId}`,
  `Scheduled to complete ${fmtDate(scheduledFor)}.`,
  'They were told they could reply to stop it. Somebody has to actually stop it.',
]));

module.exports = {
  registered,
  leavingReply,
  trialStarted,
  paid,
  trialEnding,
  meetingProblem,
  paymentFailed,
  cancelled,
  supportTicket,
  // exported for the test harness (send, sendCustomer and triage also used by status.js)
  _internals: { fmtDate, fmtMoney, who, send, sendCustomer, triage, phoneLine, DEFAULT_CHANNEL, CUSTOMER_CHANNEL },
};
