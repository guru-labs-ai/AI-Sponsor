/* ─── AI Sponsor → GA4 Measurement Protocol ──────────────────────────────────
   The only place a real AI Sponsor sale is ever reported to Google Analytics.

   Why this has to be server-side, and cannot be a gtag call:

   Same shape as metacapi.js, for the same reason. Both plans open with a
   30-day trial, so checkout takes $0 and the browser fires start_trial rather
   than purchase. The money moves on day 31, when Stripe raises the first real
   invoice, and at that moment nobody is on the site. There is no browser, no
   cookie and no tag to fire. Without this module GA4 shows registrations and
   trials and never a single dollar, which makes every Google Ads conversion
   imported from it blind to whether a trial was worth buying.

   What makes the match possible 30 days later:

   GA4 identifies a browser by its client id, which lives in the _ga cookie.
   collectAttribution() in the registration page reads it at checkout and it
   travels into Stripe subscription metadata alongside _fbp, so it comes back
   on the day-31 invoice. That is what lets a purchase this far from the visit
   attach to the session that produced it.

   When the client id is missing, the sale is still sent, under an id derived
   from the Stripe customer, and labelled client_id_source: 'synthetic'. That
   is deliberate. Every subscription created before this shipped has no client
   id in its metadata, so refusing those would mean the first charges we ever
   take are the ones GA4 never hears about. A labelled unattributed sale is
   worth more than a silent one, as long as nobody later reads it as organic.

   Sends are fire-and-forget: reporting a sale must never fail the webhook and
   make us return non-2xx to Stripe, which would trigger three days of retries
   against a payment we have already processed.

   Setup: GA4_API_SECRET (Analytics > Admin > Data streams > the web stream >
   Measurement Protocol API secrets > Create). Unset = no-op, so this is inert
   until it is set, and setting it needs Editor on the property.
   GA4_MP_DEBUG=1 routes to Google's validation endpoint, which answers with
   what is wrong with the payload instead of accepting it silently. That is how
   this gets proven before a real charge depends on it.
──────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

// AI Sponsor's web stream, the same G- id the five pages tag with.
const MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || 'G-S6Y7JPLC0G';

const API_SECRET = process.env.GA4_API_SECRET;
const DEBUG = !!process.env.GA4_MP_DEBUG;

const enabled = !!(API_SECRET && MEASUREMENT_ID);

function collectUrl() {
  const path = DEBUG ? '/debug/mp/collect' : '/mp/collect';
  return `https://www.google-analytics.com${path}`
    + `?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}`
    + `&api_secret=${encodeURIComponent(API_SECRET)}`;
}

/* The client id we stored at checkout, or a stable stand-in built from the
   Stripe customer id. Stable matters: a renewal a month later has to resolve
   to the same id, or one customer becomes a new GA4 user every billing cycle
   and the revenue-per-user numbers quietly break. Shaped like a real client id
   (digits.digits) because some GA4 reports assume that form. */
function resolveClientId(attribution, fallbackSeed) {
  const a = attribution && typeof attribution === 'object' ? attribution : {};
  const stored = typeof a.ga === 'string' ? a.ga.trim() : '';
  if (stored) return { clientId: stored, source: 'browser' };
  if (!fallbackSeed) return { clientId: '', source: 'none' };
  const digest = crypto.createHash('sha256').update(String(fallbackSeed)).digest('hex');
  const left = parseInt(digest.slice(0, 8), 16);
  const right = parseInt(digest.slice(8, 16), 16);
  return { clientId: `${left}.${right}`, source: 'synthetic' };
}

/* ── Report one real payment to GA4 ──────────────────────────────────────────
   Called from the payment_succeeded branch of the Stripe webhook, which only
   ever sees invoices where amount_paid is above zero, so this can never report
   revenue that has not happened.

   transaction_id is the Stripe invoice id. GA4 treats a repeated
   transaction_id as the same purchase, so a webhook retry does not double the
   revenue. Renewals carry their own invoice id and stay visible as their own
   sale, which is what keeps lifetime value readable past the first charge.

   engagement_time_msec is required for the event to be counted rather than
   dropped as a session-less hit. There is no session_id, because there is no
   session: this event belongs to a person, not a visit.                     */
async function purchase({
  email,           // not sent to GA4, see below
  amount,          // cents, as Stripe reports it
  currency,
  plan,
  invoiceId,
  customerId,
  attribution,
} = {}) {
  if (!enabled) return { sent: false, reason: 'GA4_API_SECRET not configured' };

  const { clientId, source } = resolveClientId(attribution, customerId || invoiceId);
  if (!clientId) {
    return { sent: false, reason: 'no client id and no customer id to derive one from' };
  }

  const planName = plan === 'annual' ? 'AI Sponsor Annual' : 'AI Sponsor Monthly';
  const value = Number(((amount || 0) / 100).toFixed(2));

  /* No email, no name, no phone. GA4's terms prohibit sending anything that
     identifies a person, and this is a recovery product: the fact that a
     specific human bought it is exactly the thing that must not leave here.
     The client id is a random browser id and carries no identity on its own. */
  const body = {
    client_id: clientId,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: invoiceId || undefined,
        currency: String(currency || 'usd').toUpperCase(),
        value,
        plan: plan || 'unknown',
        client_id_source: source,
        engagement_time_msec: 1,
        items: [{
          item_id: plan || 'unknown',
          item_name: planName,
          price: value,
          quantity: 1,
        }],
      },
    }],
  };

  const res = await fetch(collectUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /* The live endpoint answers 204 with an empty body and validates nothing, so
     a malformed event is accepted and silently dropped. Only the debug
     endpoint says what was wrong, which is why GA4_MP_DEBUG exists. */
  if (!res.ok) {
    throw new Error(`GA4 Measurement Protocol rejected the purchase: HTTP ${res.status}`);
  }

  if (DEBUG) {
    const json = await res.json().catch(() => ({}));
    const problems = json.validationMessages || [];
    if (problems.length) {
      throw new Error(`GA4 validation: ${problems.map((m) => m.description).join('; ')}`);
    }
    return { sent: true, debug: true, clientIdSource: source, value };
  }

  return { sent: true, clientIdSource: source, value };
}

/* Read-only check, so "is this on?" is answerable without sending an event. */
function status() {
  return {
    enabled,
    measurementId: MEASUREMENT_ID,
    secretSet: !!API_SECRET,
    debugMode: DEBUG,
  };
}

module.exports = { purchase, status, enabled, MEASUREMENT_ID };
