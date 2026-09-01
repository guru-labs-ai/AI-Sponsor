/* ─── AI Sponsor → Meta Conversions API ──────────────────────────────────────
   The only place a real AI Sponsor sale is ever reported to Meta.

   Why this has to be server-side, and cannot be a pixel:

   Both plans open with a 30-day trial, so checkout takes $0. The browser fires
   StartTrial at card capture and deliberately does not fire Purchase, because
   no money has moved. The money moves on day 31, when Stripe raises the first
   real invoice. Nobody is on the site at that moment, there is no browser, no
   cookies and no pixel to fire. Without this module Meta never learns that any
   AI Sponsor customer ever paid, so it optimises against trial signups alone
   and cannot tell a trial that converts from one that never does.

   What makes the match possible 30 days later:

   The ad click is captured in the browser at registration (fbclid from the URL,
   _fbp and _fbc from the pixel's own cookies) and written into Stripe
   subscription metadata. Stripe mirrors subscription metadata onto every future
   invoice, so it comes back to us on the day-31 webhook. See attributionMetadata
   in stripe.js. That is the whole reason a purchase this far from the click can
   still be attributed at all.

   Sends are fire-and-forget: reporting a sale must never fail the webhook and
   make us return non-2xx to Stripe, which would trigger three days of retries
   against a payment we have already processed.

   Setup: META_CAPI_TOKEN (Events Manager > Conversions API > Generate access
   token, on the pixel below). Unset = no-op, so this is inert until it is set.
   META_CAPI_TEST_CODE is optional and routes events to the Test Events tab
   instead of the live dataset, which is how this gets proven before it matters.
──────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

// AI Sponsor's own pixel, created Aug 2026 in the Stand Up 8 LLC portfolio.
// DRM's pixel is a different one and the two must never be crossed.
const PIXEL_ID = process.env.META_CAPI_PIXEL_ID || '1018553221183175';

const TOKEN = process.env.META_CAPI_TOKEN;
const TEST_CODE = process.env.META_CAPI_TEST_CODE || '';

const enabled = !!(TOKEN && PIXEL_ID);

/* Meta requires every piece of personal data to arrive already hashed, lowercase
   and trimmed. It never receives a raw email from us. _fbp and _fbc are the
   exception and must be sent as-is: they are Meta's own cookie values, and
   hashing them destroys the match. */
function hash(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/* Stripe metadata is snake_case, because that is how it was written at checkout.
   The browser posts camelCase to /register. Both shapes are read here for the
   same reason alerts.js reads both: taking only one would silently drop every
   paying customer's attribution, which is the exact failure this module exists
   to prevent. */
function readAttribution(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    fbp: a.fbp || '',
    fbc: a.fbc || '',
    fbclid: a.fbclid || '',
    landing: a.landing || '',
    firstSeen: a.first_seen || a.firstSeen || a.at || '',
  };
}

/* _fbc is the cookie the pixel writes when someone lands on an ad click. If the
   pixel was blocked, or the person landed before it loaded, the cookie is
   missing but the fbclid is still in the URL and we captured it. Meta accepts a
   reconstructed value in exactly this shape, so a blocked pixel costs us match
   quality rather than the whole attribution.

   The timestamp has to be when the click happened, not now, or the value points
   at the wrong click. first_seen is that moment. If it is unreadable we send no
   fbc at all rather than a wrong one. */
function buildFbc({ fbc, fbclid, firstSeen }) {
  if (fbc) return fbc;
  if (!fbclid) return '';
  const clickedAt = Date.parse(firstSeen);
  if (!Number.isFinite(clickedAt)) return '';
  return `fb.1.${clickedAt}.${fbclid}`;
}

/* ── Report one real payment to Meta ─────────────────────────────────────────
   Called from the payment_succeeded branch of the Stripe webhook, which only
   ever sees invoices where amount_paid is above zero. The $0 invoice that opens
   a trial never reaches here, so this can never report revenue that has not
   happened.

   eventId is the Stripe invoice id. Meta deduplicates on it, so a webhook retry
   of a payment we already reported is recognised as the same event rather than
   counted twice. Renewals carry their own invoice id, so month two and the $49
   annual renewal are their own events and stay visible, which is what makes
   ROAS readable past the first charge.                                       */
async function purchase({
  email,
  amount,          // cents, as Stripe reports it
  currency,
  plan,
  invoiceId,
  attribution,
  siteUrl,
} = {}) {
  if (!enabled) return { sent: false, reason: 'META_CAPI_TOKEN not configured' };

  const a = readAttribution(attribution);
  const fbc = buildFbc(a);

  const userData = {};
  const hashedEmail = hash(email);
  if (hashedEmail) userData.em = [hashedEmail];
  if (a.fbp) userData.fbp = a.fbp;
  if (fbc) userData.fbc = fbc;

  /* No email and no cookie means Meta has nothing to match on, and an event it
     cannot attribute to anyone teaches it nothing. Better to say so in the log
     than to send a blank one and have it look like this is working. */
  if (!Object.keys(userData).length) {
    return { sent: false, reason: 'no matchable identifiers on this payment' };
  }

  const event = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: invoiceId || undefined,
    // The sale originated on our website even though the charge lands on a
    // server 30 days later, so this stays 'website' rather than 'system_generated'.
    action_source: 'website',
    event_source_url: a.landing || siteUrl || process.env.SITE_URL || undefined,
    user_data: userData,
    custom_data: {
      value: Number(((amount || 0) / 100).toFixed(2)),
      currency: String(currency || 'usd').toUpperCase(),
      content_name: plan === 'annual' ? 'AI Sponsor Annual' : 'AI Sponsor Monthly',
    },
  };

  const body = { data: [event] };
  if (TEST_CODE) body.test_event_code = TEST_CODE;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Meta CAPI rejected the Purchase: ${err}`);
  }

  return {
    sent: true,
    eventsReceived: json.events_received,
    matched: Object.keys(userData),
    test: !!TEST_CODE,
  };
}

/* Read-only check for the admin diagnostics endpoint, so "is this on?" is
   answerable without sending an event. */
function status() {
  return {
    enabled,
    pixelId: PIXEL_ID,
    graphVersion: GRAPH_VERSION,
    tokenSet: !!TOKEN,
    testMode: !!TEST_CODE,
  };
}

module.exports = { purchase, status, enabled, PIXEL_ID };
