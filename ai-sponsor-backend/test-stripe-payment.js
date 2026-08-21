/* Guards the day-31 charge. Run: node test-stripe-payment.js

   Offline. No Stripe key, no network, no database: handleWebhookEvent is a
   pure function of the event it is handed, so the events are built by hand.

   Why this file exists. Both plans now open with a 30-day free trial, so
   checkout takes $0 and every earlier event in the funnel reports no revenue.
   `invoice.payment_succeeded` is the only place money appears. Two ways to get
   that wrong, and both are silent:

   1. Reporting the $0 invoice that OPENS a trial as a sale. Stripe raises one,
      it looks exactly like a real invoice, and treating it as revenue would
      say a customer paid on the day they paid nothing.
   2. Picking up another product's invoice. The Stripe account is shared, so
      DRM's charges arrive at this same webhook and must be ignored.

   The plan metadata also moves: on an invoice it lives under
   subscription_details, not on the invoice itself, so reading the wrong one
   returns a payment with no idea who made it. */
const path = require('path');

process.env.STRIPE_PRICE_MONTHLY = 'price_sponsor_monthly';
process.env.STRIPE_PRICE_ANNUAL = 'price_sponsor_annual';
delete process.env.STRIPE_SECRET_KEY;   // stays unconfigured on purpose

const stripe = require(path.resolve(__dirname, 'stripe.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

// A day-31 charge as Stripe actually sends it.
const invoice = (over = {}) => ({
  type: 'invoice.payment_succeeded',
  data: {
    object: {
      id: 'in_123',
      customer: 'cus_123',
      customer_email: 'someone@example.com',
      subscription: 'sub_123',
      amount_paid: 500,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      subscription_details: { metadata: { userId: 'u_1', plan: 'monthly' } },
      lines: { data: [{ price: { id: 'price_sponsor_monthly' } }] },
      ...over,
    },
  },
});

(async () => {
  group('a real charge is reported as money');
  let r = await stripe.handleWebhookEvent(invoice());
  check('type', r.type, 'payment_succeeded');
  check('amount stays in cents', r.amount, 500);
  check('currency', r.currency, 'usd');
  check('invoice id is carried, so a retry is recognisable', r.invoiceId, 'in_123');
  check('subscription id', r.subscriptionId, 'sub_123');
  check('customer id', r.customerId, 'cus_123');
  check('email', r.email, 'someone@example.com');
  check('billing reason', r.billingReason, 'subscription_cycle');

  group('who paid, read from where Stripe actually puts it');
  check('userId comes off subscription_details', r.userId, 'u_1');
  check('plan comes off subscription_details', r.plan, 'monthly');
  r = await stripe.handleWebhookEvent(invoice({
    subscription_details: undefined,
    metadata: { userId: 'u_2', plan: 'annual' },
  }));
  check('falls back to invoice metadata', r.userId, 'u_2');
  check('plan falls back too', r.plan, 'annual');

  group('the $0 invoice that opens a trial is NOT a sale');
  r = await stripe.handleWebhookEvent(invoice({ amount_paid: 0, billing_reason: 'subscription_create' }));
  check('reported as no charge', r.type, 'trial_invoice_no_charge');
  check('carries the invoice id anyway', r.invoiceId, 'in_123');
  r = await stripe.handleWebhookEvent(invoice({ amount_paid: undefined }));
  check('a missing amount is treated as zero, never as a sale', r.type, 'trial_invoice_no_charge');

  group('the annual plan is money too, at its own price');
  r = await stripe.handleWebhookEvent(invoice({
    amount_paid: 4900,
    subscription_details: { metadata: { userId: 'u_3', plan: 'annual' } },
    lines: { data: [{ price: { id: 'price_sponsor_annual' } }] },
  }));
  check('type', r.type, 'payment_succeeded');
  check('amount', r.amount, 4900);
  check('plan', r.plan, 'annual');

  group('another product on the shared account is ignored');
  r = await stripe.handleWebhookEvent(invoice({
    subscription_details: { metadata: { userId: 'drm_1', plan: 'drm_monthly' } },
    metadata: {},
    lines: { data: [{ price: { id: 'price_some_other_product' } }] },
  }));
  check('not ours', r.type, 'ignored_not_ai_sponsor');
  check('and it says which event it dropped', r.stripeEventType, 'invoice.payment_succeeded');

  group('recognised by price id even with no metadata at all');
  r = await stripe.handleWebhookEvent(invoice({
    subscription_details: undefined,
    metadata: {},
  }));
  check('still ours', r.type, 'payment_succeeded');
  check('but we do not know who, and do not invent it', r.userId, undefined);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
