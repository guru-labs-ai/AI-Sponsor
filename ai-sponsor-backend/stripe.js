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

/* ── Create a Stripe Checkout Session ───────────────────────────────────────
   Frontend redirects the user to the returned `url`. Stripe hosts the actual
   payment form, so we never touch raw card numbers on our server — this is
   the safest and fastest way to integrate (no PCI compliance burden on us).
─────────────────────────────────────────────────────────────────────────── */
async function createCheckoutSession({ plan, email, userId, successUrl, cancelUrl }) {
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

  const subscriptionData = {
    metadata: { userId: userId || '', plan },
  };

  // Only the monthly plan gets the 30-day free trial (per the ClickUp task).
  // The annual plan is a straight $49/yr charge with no trial.
  if (plan === 'monthly') {
    subscriptionData.trial_period_days = TRIAL_DAYS;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: subscriptionData,
    success_url: successUrl || `${process.env.FRONTEND_URL}/ai-sponsor-registration.html?payment=success`,
    cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/ai-sponsor-registration.html?payment=cancelled`,
    metadata: { userId: userId || '', plan },
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
      return {
        type: 'subscription_cancelled',
        userId: sub.metadata?.userId,
        customerId: sub.customer,
      };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return {
        type: 'payment_failed',
        customerId: invoice.customer,
        attemptCount: invoice.attempt_count,
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
      });
    });
    if (!resp.has_more) break;
    startingAfter = resp.data[resp.data.length - 1].id;
  }
  return subs;
}

module.exports = {
  createCheckoutSession,
  constructWebhookEvent,
  handleWebhookEvent,
  listSponsorSubscriptions,
  PRICE_IDS,
};
