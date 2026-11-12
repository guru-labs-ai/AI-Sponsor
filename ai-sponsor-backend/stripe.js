/* ─── Stripe Subscriptions Module ──────────────────────────────────────────
   Handles: Monthly ($5/mo, 30-day trial) and Annual ($49/yr) plans.

   SETUP NEEDED BEFORE THIS WORKS (do this in the Stripe Dashboard):
   1. Create one Product: "AI Sponsor Subscription"
   2. Under that product, create two Prices:
        - Monthly: $5.00 USD, recurring monthly  -> copy its Price ID (price_xxx)
        - Annual:  $49.00 USD, recurring yearly   -> copy its Price ID (price_xxx)
   3. Drop those two Price IDs into your .env as STRIPE_PRICE_MONTHLY and
      STRIPE_PRICE_ANNUAL (see .env.example).
   4. Create a Webhook endpoint in Stripe pointing to:
        https://<your-render-url>/api/stripe/webhook
      Subscribe it to these events:
        - checkout.session.completed
        - customer.subscription.trial_will_end
        - customer.subscription.deleted
        - invoice.payment_failed
        - invoice.payment_succeeded   <- the only event where money moves
      Copy the webhook signing secret into STRIPE_WEBHOOK_SECRET in .env.
   ───────────────────────────────────────────────────────────────────────── */

const Stripe = require('stripe');

// Construct the client ONLY when a key exists. Stripe SDK v17 throws at
// construction on an empty string ("Neither apiKey nor config.authenticator
// provided"), which would crash the whole server at boot and take the live
// web chat down with it. Stays null until STRIPE_SECRET_KEY is set on the host;
// the functions below return a clean error if called before then.
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY, // $5/month
  annual: process.env.STRIPE_PRICE_ANNUAL,   // $49/year
};

const TRIAL_DAYS = 30;

/* ── Ad attribution -> Stripe metadata ──────────────────────────────────────
   Both plans open with a 30-day trial, so checkout takes $0 and the only
   moment real money moves is the day-31 invoice. By then the browser is long
   gone: no pixel, no cookies, no page to fire an event from. Anything we want
   to know about which ad produced that customer has to be written down NOW and
   carried by Stripe itself.

   These go on subscription_data.metadata specifically, not just the session,
   because Stripe mirrors subscription metadata onto every future invoice as
   subscription_details.metadata. That is what makes the day-31 payment
   traceable back to the ad click, without depending on any third party.

   Stripe caps metadata at 50 keys and 500 chars per value, so each field is
   trimmed and blanks are dropped rather than stored as empty strings. ────── */
function attributionMetadata(attribution) {
  if (!attribution || typeof attribution !== 'object') return {};
  const fields = {
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_content: attribution.utmContent,
    utm_term: attribution.utmTerm,
    fbclid: attribution.fbclid,
    gclid: attribution.gclid,
    fbp: attribution.fbp,
    fbc: attribution.fbc,
    // GA4's client id. Without it here the day-31 charge reaches Analytics as
    // a brand new user with no route back to the ad click. See ga4.js.
    ga: attribution.ga,
    referrer: attribution.referrer,
    landing: attribution.landing,
    // The first page's English title, so the alert can name a blog post.
    landing_title: attribution.title,
    first_seen: attribution.at,
  };
  /* The visit they signed up on, when it was not their first (12 Nov 2026:
     a customer found us on Google and signed up three weeks later, and nothing
     recorded what brought them back). Flat keys: Stripe metadata is one level. */
  const visit = attribution.visit && typeof attribution.visit === 'object' ? attribution.visit : null;
  if (visit) {
    Object.assign(fields, {
      visit_utm_source: visit.utmSource,
      visit_utm_medium: visit.utmMedium,
      visit_utm_campaign: visit.utmCampaign,
      visit_referrer: visit.referrer,
      visit_landing: visit.landing,
      visit_title: visit.title,
      visit_at: visit.at,
    });
  }
  const out = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim().slice(0, 500);
    if (trimmed) out[key] = trimmed;
  });
  return out;
}

/* ── Create a Stripe Checkout Session ───────────────────────────────────────
   Frontend redirects the user to the returned `url`. Stripe hosts the actual
   payment form, so we never touch raw card numbers on our server — this is
   the safest and fastest way to integrate (no PCI compliance burden on us).
─────────────────────────────────────────────────────────────────────────── */
async function createCheckoutSession({ plan, email, userId, successUrl, cancelUrl, attribution }) {
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
  if (!['monthly', 'annual'].includes(plan)) {
    throw new Error(`Invalid plan "${plan}". Must be "monthly" or "annual".`);
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    throw new Error(
      `Missing Stripe price ID for plan "${plan}". Check STRIPE_PRICE_${plan.toUpperCase()} in .env`
    );
  }

  const attrMeta = attributionMetadata(attribution);

  const subscriptionData = {
    metadata: { userId: userId || '', plan, ...attrMeta },
  };

  // Both plans get the same 30-day free trial. Whichever plan they picked,
  // the card is saved now and nothing is charged until day 31.
  subscriptionData.trial_period_days = TRIAL_DAYS;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: subscriptionData,
    success_url: successUrl || `${process.env.FRONTEND_URL}/ai-sponsor-registration.html?payment=success`,
    cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/ai-sponsor-registration.html?payment=cancelled`,
    metadata: { userId: userId || '', plan, ...attrMeta },
  });

  return { checkoutUrl: session.url, sessionId: session.id };
}

/* ── Verify and parse an incoming webhook event ─────────────────────────── */
function constructWebhookEvent(rawBody, signature) {
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

/* Where an invoice keeps its parent subscription's metadata depends on the
   Stripe API version, and it moved without ceremony:
     2024-12-18.acacia (what this file pins) -> invoice.subscription_details
     2025-03-31.basil and later              -> invoice.parent.subscription_details
   Verified against a real invoice by requesting the same object under both
   versions. Reading both means bumping apiVersion later degrades nothing here
   instead of silently returning an empty object. */
function subscriptionMetadata(invoice) {
  return invoice?.subscription_details?.metadata
    || invoice?.parent?.subscription_details?.metadata
    || {};
}

/* ── Guard: this Stripe account is shared with other products (DRM, GHL
   funnels), so before processing any event we confirm it actually belongs
   to AI Sponsor. checkout.session/subscription objects carry our own
   metadata.plan tag (set above in createCheckoutSession). Invoices don't
   carry that metadata at the top level, but Stripe mirrors the parent
   subscription's metadata onto invoice.subscription_details.metadata, so
   we check there. Line-item price ID is kept only as a last-resort
   fallback since its shape has changed across Stripe API versions. ────── */
function belongsToAiSponsor(event) {
  const obj = event.data.object;

  const directPlan = obj.metadata?.plan;
  if (directPlan === 'monthly' || directPlan === 'annual') return true;

  const invoicePlan = obj.subscription_details?.metadata?.plan;
  if (invoicePlan === 'monthly' || invoicePlan === 'annual') return true;

  const linePriceId = obj.lines?.data?.[0]?.price?.id
    || obj.lines?.data?.[0]?.pricing?.price_details?.price;
  if (linePriceId && Object.values(PRICE_IDS).includes(linePriceId)) return true;

  return false;
}

/* ── Handle webhook events ──────────────────────────────────────────────────
   Returns a small descriptive object so server.js can log / forward to GHL
   without this module needing to know about GHL directly.
─────────────────────────────────────────────────────────────────────────── */
async function handleWebhookEvent(event) {
  if (!belongsToAiSponsor(event)) {
    return { type: 'ignored_not_ai_sponsor', stripeEventType: event.type };
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      return {
        type: 'subscription_started',
        userId: session.metadata?.userId,
        plan: session.metadata?.plan,
        email: session.customer_email,
        customerId: session.customer,
        subscriptionId: session.subscription,
        /* When the first real charge lands. The trial opens the moment this
           session completes, so it is that timestamp plus the trial length.
           Carried here because the session object itself has no trial_end
           (that lives on the subscription) and every alert about a trial is
           misleading without the date the money actually moves. */
        firstChargeAt: session.created ? session.created + TRIAL_DAYS * 86400 : null,
        /* First touch, written into the session at checkout by the landing
           script. Carried out whole rather than picked apart here: the reader
           takes the fields it knows and new ones cost nothing. */
        attribution: session.metadata || null,
      };
    }

    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      return {
        type: 'trial_ending_soon',
        userId: sub.metadata?.userId,
        customerId: sub.customer,
        // Stripe fires this ~3 days before trial ends
        trialEnd: sub.trial_end,
      };
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const endedAt = sub.canceled_at || sub.ended_at;
      return {
        type: 'subscription_cancelled',
        userId: sub.metadata?.userId,
        customerId: sub.customer,
        // Ended before the trial did, so no charge was ever taken. Null when
        // Stripe did not say, so the alert stays quiet rather than guessing.
        duringTrial: sub.trial_end && endedAt ? endedAt < sub.trial_end : null,
      };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return {
        type: 'payment_failed',
        customerId: invoice.customer,
        attemptCount: invoice.attempt_count,
        // What was owed and when Stripe tries again. The Slack alerts already
        // asked for the amount; until now nothing passed it, so it was blank.
        invoiceId: invoice.id,
        amount: invoice.amount_due,
        currency: invoice.currency,
        nextAttemptAt: invoice.next_payment_attempt || null,
      };
    }

    /* The day-31 charge, and the only event in the entire funnel where money
       actually moves. Both plans now open with a 30-day trial, so checkout
       takes $0 and reports no revenue anywhere. Without this event a paying
       customer is invisible to us, to GHL and to every ad platform.

       Stripe also sends this for the $0 invoice that OPENS a trial, which is
       why the amount is checked. Treating that as a sale would report revenue
       that has not happened, which is the same mistake as firing a Purchase
       pixel event on a free trial. */
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const amountPaid = invoice.amount_paid ?? 0;

      if (amountPaid <= 0) {
        return { type: 'trial_invoice_no_charge', invoiceId: invoice.id };
      }

      return {
        type: 'payment_succeeded',
        // On an invoice the plan metadata lives under subscription_details,
        // not on the invoice itself. Both are read so this keeps working if
        // Stripe ever moves it.
        userId: invoice.subscription_details?.metadata?.userId
          || invoice.metadata?.userId,
        plan: invoice.subscription_details?.metadata?.plan
          || invoice.metadata?.plan,
        email: invoice.customer_email,
        customerId: invoice.customer,
        subscriptionId: invoice.subscription,
        invoiceId: invoice.id,
        amount: amountPaid,          // cents
        currency: invoice.currency,
        // "subscription_cycle" is a trial converting or a renewal.
        // "subscription_create" would be a plan bought with no trial at all.
        billingReason: invoice.billing_reason,
        // The ad click that produced this customer, written at checkout 30+
        // days ago and carried here by Stripe. This is the only place it is
        // still available: the browser session that had the cookies is long
        // over. Whatever reports this sale onward (GHL, Meta CAPI) needs it
        // from here or the sale attributes to nothing.
        attribution: subscriptionMetadata(invoice),
      };
    }

    default:
      return { type: 'unhandled', stripeEventType: event.type };
  }
}

/* ── List AI Sponsor subscriptions (for the north-star metrics endpoint) ─────
   The Stripe account is SHARED across products, so we keep only subscriptions
   whose price id matches an AI Sponsor price — same isolation rule as the
   webhook guard. Returns date/status fields only, no customer details.       */
async function listSponsorSubscriptions() {
  if (!stripe) return []; // Stripe not configured — metrics degrade gracefully
  const sponsorPrices = Object.values(PRICE_IDS).filter(Boolean);
  const subs = [];
  let startingAfter;
  for (let page = 0; page < 10; page++) {
    const resp = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    resp.data.forEach((s) => {
      const priceId = s.items?.data?.[0]?.price?.id;
      if (!sponsorPrices.includes(priceId)) return;
      subs.push({
        status: s.status,
        created: s.created,                    // unix seconds
        canceledAt: s.canceled_at || null,
        endedAt: s.ended_at || null,
        /* Which plan, and when the free month runs out. Both are needed to
           answer "what is monthly revenue" honestly: a subscription sitting in
           `trialing` is a captured card, not money, and the two plans are worth
           different amounts a month. Price id rather than amount, so a price
           change in Stripe cannot silently rewrite past months. */
        plan: priceId === PRICE_IDS.annual ? 'annual'
          : priceId === PRICE_IDS.monthly ? 'monthly' : 'unknown',
        trialEnd: s.trial_end || null,         // unix seconds, null if no trial
      });
    });
    if (!resp.has_more) break;
    startingAfter = resp.data[resp.data.length - 1].id;
  }
  return subs;
}

/* ── Is there already a live AI Sponsor plan on this email? ─────────────────
   12 Nov 2026: a customer went through checkout twice, eleven minutes apart, and
   ended up with two trials on one card, so they would have paid $10 on 12 Dec
   for one account. Checkout asks this first and sends somebody who already
   has a plan straight through instead of opening a second one; the trial
   alert asks it too, as a backstop.

   - customers.list, not customers.search: search is eventually consistent and
     can miss a customer created seconds ago, which is exactly the double-tap
     case. list's email filter is exact and case-sensitive, so the address is
     tried as typed and lower-cased.
   - The Stripe account is shared with DRM and other products, so only plans on
     an AI Sponsor price, or carrying our own plan tag, count. A DRM customer
     using the same email must never be blocked from AI Sponsor.
   - A plan already set to end (cancel_at_period_end) does not count: that
     person chose to leave and is allowed to start again. */
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid']);

function isAiSponsorSubscription(sub) {
  const tag = sub?.metadata?.plan;
  if (tag === 'monthly' || tag === 'annual') return true;
  const sponsorPrices = Object.values(PRICE_IDS).filter(Boolean);
  return (sub?.items?.data || []).some((item) => sponsorPrices.includes(item?.price?.id));
}

async function findLiveSubscriptions(email, { excludeId } = {}) {
  if (!stripe) return [];
  const typed = String(email || '').trim();
  if (!typed) return [];
  const addresses = [...new Set([typed, typed.toLowerCase()])];
  const seen = new Set();
  const found = [];
  for (const address of addresses) {
    const customers = await stripe.customers.list({ email: address, limit: 10 });
    for (const customer of customers.data) {
      if (seen.has(customer.id)) continue;
      seen.add(customer.id);
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 20 });
      for (const sub of subs.data) {
        if (sub.id === excludeId) continue;
        if (!LIVE_STATUSES.has(sub.status) || sub.cancel_at_period_end) continue;
        if (!isAiSponsorSubscription(sub)) continue;
        const priceId = sub.items?.data?.[0]?.price?.id;
        found.push({
          id: sub.id,
          customerId: customer.id,
          status: sub.status,
          created: sub.created,
          trialEnd: sub.trial_end || null,
          plan: sub.metadata?.plan
            || (priceId === PRICE_IDS.annual ? 'annual' : priceId === PRICE_IDS.monthly ? 'monthly' : 'unknown'),
        });
      }
    }
  }
  return found;
}

/* ── "Forget me" deletion support ─────────────────────────────────────────
   Two functions, used together by deletion.js's Stripe-confirmation step:

   cancelSubscription — immediate cancel (equivalent to DELETE /subscriptions/
   :id), NOT cancel-at-period-end, per Mariam's spec. Stripe's synchronous
   response is authoritative: if it comes back "canceled", that's final and no
   follow-up check is needed.

   getSubscriptionStatus — a read-only lookup, used ONLY on the cancel-call
   error path. Stripe never hard-deletes a subscription, so a "no such
   subscription" error does NOT mean it's safe to proceed — it usually means a
   wrong id or a test/live key mismatch. This lookup is how the caller tells
   the difference between "already cancelled, fine" and "something's wrong,
   stop." Never used on the normal/happy path. ───────────────────────────── */
async function cancelSubscription(subscriptionId) {
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
  const sub = await stripe.subscriptions.cancel(subscriptionId);
  return sub.status; // 'canceled' on success
}

async function getSubscriptionStatus(subscriptionId) {
  if (!stripe) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing).');
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return sub.status;
}

/* ── What somebody's own plan page needs to show them ──────────────────────
   Everything here answers a question a person actually asks: what am I on,
   when does the money move, and how much. Nothing about ids or internal
   state, because none of that belongs on a page written for somebody in
   recovery who wants to know whether they are about to be charged.

   Returns null rather than throwing when Stripe cannot be reached, so a page
   whose whole job is reassurance never renders an error where a date should
   be. The caller decides what to say about a missing answer. */
async function getSubscriptionSummary(subscriptionId) {
  if (!stripe || !subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const price = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price) || {};
    return {
      status: sub.status,
      interval: (price.recurring && price.recurring.interval) || null,
      amount: typeof price.unit_amount === 'number' ? price.unit_amount : null,
      currency: (price.currency || 'usd').toUpperCase(),
      trialEnd: sub.trial_end || null,
      // The day money actually moves, which during a trial is the trial end.
      nextChargeAt: sub.trial_end || sub.current_period_end || null,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    };
  } catch (err) {
    console.warn(`[stripe] could not read ${subscriptionId}: ${err.message}`);
    return null;
  }
}

module.exports = {
  cancelSubscription,
  getSubscriptionStatus,
  getSubscriptionSummary,
  createCheckoutSession,
  constructWebhookEvent,
  handleWebhookEvent,
  listSponsorSubscriptions,
  findLiveSubscriptions,
  isAiSponsorSubscription,
  PRICE_IDS,
};
