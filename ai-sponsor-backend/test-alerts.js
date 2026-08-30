/* Offline tests for the Slack alerts (#ai-sponsor-updates).

   Nothing here touches Slack, Stripe or the database. It stubs global.fetch and
   asserts on the exact text we would post, because the whole point of this
   module is what the words say: the 30 Aug 2026 confusion was caused by an
   alert whose wording implied a sale on a $0 trial invoice.

   Run: node test-alerts.js
*/

const assert = require('assert');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_ALERTS_CHANNEL = 'C_TEST';

const alerts = require('./alerts');
const stripeModule = require('./stripe');

let sent = [];
let nextSlackBody = { ok: true };

global.fetch = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
  return { json: async () => nextSlackBody };
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const lastText = () => sent[sent.length - 1].body.text;

/* ── The trial alert, the one the DRM zap gets wrong ─────────────────────── */

test('trial start never calls itself a sale and states the $0', async () => {
  await alerts.trialStarted({
    name: 'Lindsay', email: 'l@example.com', plan: 'monthly', firstChargeAt: 1790653741,
  });
  const t = lastText();
  assert.ok(t.includes('Trial started'), 'says trial');
  assert.ok(t.includes('$0.00'), 'states nothing was charged');
  assert.ok(t.includes('not a sale yet'), 'says it is not a sale in words');
  assert.ok(t.includes('29 September 2026'), 'names the first charge date');
  assert.ok(!/PAID/.test(t), 'never says PAID');
});

test('trial start shows the annual price when the plan is annual', async () => {
  await alerts.trialStarted({ email: 'a@example.com', plan: 'annual' });
  assert.ok(lastText().includes('$49/year'));
});

test('trial start survives a missing name', async () => {
  await alerts.trialStarted({ email: 'noname@example.com', plan: 'monthly' });
  assert.ok(lastText().includes('noname@example.com'));
});

/* ── The payment alert, the only one that means money ────────────────────── */

test('payment says money moved, with the amount and both mentions', async () => {
  await alerts.paid({
    name: 'Lindsay', email: 'l@example.com', plan: 'monthly',
    amount: 500, currency: 'usd', billingReason: 'subscription_cycle',
    invoiceId: 'in_test123',
  });
  const t = lastText();
  assert.ok(t.includes('PAID'), 'says PAID');
  assert.ok(t.includes('$5.00 USD'), 'exact amount');
  assert.ok(t.includes('trial converting'), 'explains subscription_cycle');
  assert.ok(t.includes('U0B8NJSJYQH') && t.includes('U07212P3QNS'), 'mentions Mariam and Matt');
});

test('annual payment formats 49.00 not 4900', async () => {
  await alerts.paid({ email: 'a@example.com', plan: 'annual', amount: 4900, currency: 'usd' });
  assert.ok(lastText().includes('$49.00 USD'));
});

/* ── The rest ────────────────────────────────────────────────────────────── */

test('registration alert marks a founding member as free', async () => {
  await alerts.registered({
    name: 'Freedom', email: 'f@example.com', access: 'Beta',
    sponsorName: 'Ken', delivery: 'whatsapp', contactId: 'ghl123',
  });
  const t = lastText();
  assert.ok(t.includes('founding member, free'), 'flags the free cohort');
  assert.ok(/no money is involved/i.test(t), 'no revenue implied');
  assert.ok(t.includes('ghl123'), 'links the GHL contact');
});

test('re-registration is not announced as a new person', async () => {
  await alerts.registered({ name: 'Matt', email: 'm@example.com', returning: true });
  assert.ok(lastText().includes('Returning person'));
  assert.ok(!lastText().includes('New AI Sponsor registration'));
});

test('trial ending names the charge date and says nothing is paid yet', async () => {
  await alerts.trialEnding({ name: 'Lindsay', email: 'l@example.com', trialEnd: 1790653741 });
  const t = lastText();
  assert.ok(t.includes('29 September 2026'));
  assert.ok(t.includes('not paid anything yet'));
});

test('payment failed carries the attempt number', async () => {
  await alerts.paymentFailed({ email: 'l@example.com', attemptCount: 2, amount: 500, currency: 'usd' });
  assert.ok(lastText().includes('*Attempt:* 2'));
});

test('cancel keeps founding members on their free access', async () => {
  await alerts.cancelled({ email: 'f@example.com', keptAccess: 'Beta' });
  assert.ok(lastText().includes('free access continues'));
});

/* ── Attribution: "where did they come from" in both shapes ─────────────── */

test('browser camelCase attribution is read (a paid Meta click)', async () => {
  await alerts.registered({
    name: 'Ada', email: 'ada@example.com', access: 'Unpaid',
    attribution: {
      utmSource: 'facebook', utmMedium: 'paid', utmCampaign: 'ais_launch',
      referrer: 'facebook.com', landing: '/ai-sponsor-registration.html',
      fbclid: 'IwAR_abc', firstSeen: '2026-08-30T03:43:20.300Z',
    },
  });
  const t = lastText();
  assert.ok(t.includes('*Came from:* Facebook'), 'utm_source wins the label');
  assert.ok(t.includes('source facebook, medium paid, campaign ais_launch'));
  assert.ok(t.includes('Paid click:* Meta (fbclid)'), 'names the ad click');
  assert.ok(t.includes('/ai-sponsor-registration.html'));
});

test("Stripe's snake_case metadata produces the same label, not Unknown", async () => {
  const camel = { utmSource: 'facebook', referrer: 'facebook.com', landing: '/x' };
  const snake = { utm_source: 'facebook', referrer: 'facebook.com', landing: '/x' };
  await alerts.paid({ email: 'a@e.com', amount: 500, currency: 'usd', attribution: camel });
  const fromCamel = lastText().split('\n').find((l) => l.startsWith('*Came from:*'));
  await alerts.paid({ email: 'a@e.com', amount: 500, currency: 'usd', attribution: snake });
  const fromSnake = lastText().split('\n').find((l) => l.startsWith('*Came from:*'));
  assert.strictEqual(fromCamel, fromSnake, 'both shapes must agree');
  assert.ok(fromSnake.includes('Facebook'));
});

test("Lindsay's real 30 Aug metadata reads as Direct, not Unknown", async () => {
  await alerts.trialStarted({
    email: 'lsjacobi513@gmail.com', plan: 'monthly',
    attribution: {
      fbp: 'fb.1.1788061400192.838791927536416833',
      first_seen: '2026-08-30T03:43:20.300Z',
      landing: '/ai-sponsor-registration.html',
      plan: 'monthly', userId: 'reg-59a034b3-d2e1-4d5d-9f06-8d99def02df1',
    },
  });
  const t = lastText();
  assert.ok(t.includes('*Came from:* Direct'), 'a real browser visit with no referrer is Direct');
  assert.ok(t.includes('2026-08-30T03:43:20.300Z'), 'shows first seen');
  assert.ok(!t.includes('Paid click'), 'no ad click, so it must not claim one');
});

test('no attribution at all says Unknown, never Direct', async () => {
  await alerts.registered({ email: 'wa@example.com', access: 'Beta' });
  assert.ok(lastText().includes('Unknown (no browser data reached us)'));
  assert.ok(!lastText().includes('Direct'), 'Direct would claim credit we did not earn');
});

test('a founding member is flagged as invisible to Stripe', async () => {
  await alerts.registered({ email: 'f@example.com', access: 'Beta' });
  assert.ok(lastText().includes('Stripe never sees this one'));
});

test('checkout carries the session metadata through as attribution', async () => {
  const event = {
    type: 'checkout.session.completed',
    data: { object: {
      created: 1788061726, customer: 'cus_x', customer_email: 'l@e.com',
      subscription: 'sub_x',
      metadata: { plan: 'monthly', userId: 'reg-1', utm_source: 'facebook', landing: '/' },
    } },
  };
  const result = await stripeModule.handleWebhookEvent(event);
  assert.strictEqual(result.attribution.utm_source, 'facebook');
  await alerts.trialStarted({ email: result.email, plan: result.plan, attribution: result.attribution });
  assert.ok(lastText().includes('*Came from:* Facebook'));
});

/* ── Failure behaviour: an alert must never break the caller ─────────────── */

test('a Slack rejection resolves rather than throwing', async () => {
  nextSlackBody = { ok: false, error: 'channel_not_found' };
  const res = await alerts.paid({ email: 'l@example.com', amount: 500, currency: 'usd' });
  nextSlackBody = { ok: true };
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('channel_not_found'), 'reports the real Slack error');
});

test('a network failure resolves rather than throwing', async () => {
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  const res = await alerts.trialStarted({ email: 'l@example.com', plan: 'monthly' });
  global.fetch = realFetch;
  assert.strictEqual(res.ok, false);
});

test('no token means no post at all, and no crash', async () => {
  const token = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  const before = sent.length;
  const res = await alerts.paid({ email: 'l@example.com', amount: 500, currency: 'usd' });
  process.env.SLACK_BOT_TOKEN = token;
  assert.strictEqual(sent.length, before, 'nothing was sent');
  assert.strictEqual(res.skipped, 'no SLACK_BOT_TOKEN');
});

test('posts to the configured channel with the bot token', async () => {
  await alerts.trialStarted({ email: 'l@example.com', plan: 'monthly' });
  const s = sent[sent.length - 1];
  assert.strictEqual(s.body.channel, 'C_TEST');
  assert.strictEqual(s.headers.Authorization, 'Bearer xoxb-test-token');
  assert.strictEqual(s.body.unfurl_links, false);
});

/* ── The wiring: a real Stripe payload has to produce the right alert ────── */

test('a real $0 trial-opening invoice is not routed to the paid alert', async () => {
  // Shaped exactly like the invoice Stripe raised for the 30 Aug 2026 signup.
  const event = {
    type: 'invoice.payment_succeeded',
    data: { object: {
      id: 'in_1U9zjtDnTZ7n9tFMfd35UMSD',
      customer: 'cus_VAKOBs2QK8IiaT',
      customer_email: 'lsjacobi513@gmail.com',
      amount_paid: 0,
      total: 0,
      billing_reason: 'subscription_create',
      subscription_details: { metadata: { plan: 'monthly', userId: 'reg-59a' } },
    } },
  };
  const result = await stripeModule.handleWebhookEvent(event);
  assert.strictEqual(result.type, 'trial_invoice_no_charge',
    'the $0 trial invoice must never become a payment');
});

test('checkout completion carries the first-charge date 30 days out', async () => {
  const created = 1788061726; // 30 Aug 2026 03:48:46 UTC
  const event = {
    type: 'checkout.session.completed',
    data: { object: {
      created,
      customer: 'cus_VAKOBs2QK8IiaT',
      customer_email: 'lsjacobi513@gmail.com',
      subscription: 'sub_1U9zjt',
      metadata: { plan: 'monthly', userId: 'reg-59a' },
    } },
  };
  const result = await stripeModule.handleWebhookEvent(event);
  assert.strictEqual(result.type, 'subscription_started');
  assert.strictEqual(result.firstChargeAt, created + 30 * 86400);
  await alerts.trialStarted({ email: result.email, plan: result.plan, firstChargeAt: result.firstChargeAt });
  assert.ok(lastText().includes('29 September 2026'), 'matches the real trial_end in Stripe');
});

test("another product's invoice on the shared account raises no alert", async () => {
  const event = {
    type: 'invoice.payment_succeeded',
    data: { object: {
      id: 'in_drm', customer: 'cus_drm', amount_paid: 1999,
      billing_reason: 'subscription_cycle',
      lines: { data: [{ price: { id: 'price_some_drm_price' } }] },
    } },
  };
  const result = await stripeModule.handleWebhookEvent(event);
  assert.strictEqual(result.type, 'ignored_not_ai_sponsor');
});

(async () => {
  let pass = 0;
  for (const [name, fn] of tests) {
    sent = [];
    try {
      await fn();
      console.log(`  ok   ${name}`);
      pass++;
    } catch (e) {
      console.error(`  FAIL ${name}\n       ${e.message}`);
    }
  }
  console.log(`\n${pass}/${tests.length} passed`);
  process.exit(pass === tests.length ? 0 : 1);
})();
