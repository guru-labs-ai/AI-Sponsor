/* Offline tests: which Slack channel each AI Sponsor alert lands in, and the
   phone line Matt asked for (31 Oct) so he can message people himself.

   Sign-ups and every Stripe event MOVE to #realtime-alerts (Mariam, 9 Nov:
   "reroute what we already have", not a second copy). Meeting reports and
   deletion replies stay in #ai-sponsor-updates. If Slack refuses the command
   center (bot not invited), the alert falls back so nothing is lost.

   Run: node test-alert-routing.js
*/

const assert = require('assert');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_ALERTS_CHANNEL = 'C_UPDATES';
process.env.STRIPE_PRICE_MONTHLY = 'price_sponsor_monthly';
process.env.STRIPE_PRICE_ANNUAL = 'price_sponsor_annual';
delete process.env.SLACK_CUSTOMER_CHANNEL;

const alerts = require('./alerts');
const stripeModule = require('./stripe');

const COMMAND_CENTER = 'C0CANT8BT17';
let sent = [];
let replies = []; // queue of Slack answers, one per post; empty = ok
global.fetch = async (url, opts) => {
  sent.push(JSON.parse(opts.body));
  const body = replies.length ? replies.shift() : { ok: true };
  return { json: async () => body };
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const PHONE = '+1 203 892 2383';

const customerAlerts = {
  'sign-up': () => alerts.registered({ name: 'Kiki W', email: 'k@example.com', phone: PHONE, access: 'Paid' }),
  'trial started': () => alerts.trialStarted({ name: 'Kiki W', email: 'k@example.com', phone: PHONE, plan: 'monthly' }),
  paid: () => alerts.paid({ name: 'Kiki W', email: 'k@example.com', phone: PHONE, amount: 500, currency: 'usd' }),
  'trial ending': () => alerts.trialEnding({ name: 'Kiki W', email: 'k@example.com', phone: PHONE, trialEnd: 1796641200 }),
  'payment failed': () => alerts.paymentFailed({ name: 'Kiki W', email: 'k@example.com', phone: PHONE, amount: 500, currency: 'usd' }),
  cancelled: () => alerts.cancelled({ name: 'Kiki W', email: 'k@example.com', phone: PHONE }),
};

for (const [label, fire] of Object.entries(customerAlerts)) {
  test(`${label} goes to #realtime-alerts only, once, saying AI Sponsor, with the email`, async () => {
    await fire();
    assert.strictEqual(sent.length, 1, 'posted once, not copied');
    assert.strictEqual(sent[0].channel, COMMAND_CENTER);
    assert.ok(sent[0].text.includes('AI Sponsor'), 'names the product in a shared channel');
    assert.ok(sent[0].text.includes('k@example.com'), 'shows the email');
  });
}

for (const label of ['trial started', 'paid', 'trial ending', 'payment failed', 'cancelled']) {
  test(`${label} carries the phone as a one-tap WhatsApp link`, async () => {
    await customerAlerts[label]();
    assert.ok(sent[0].text.includes('*Phone:* <https://wa.me/12038922383|+12038922383>'), sent[0].text);
  });
}

test('no phone on record means no phone line, not an empty one', async () => {
  await alerts.paid({ name: 'A', email: 'a@example.com', amount: 500 });
  assert.ok(!sent[0].text.includes('*Phone:*'));
});

test('a meeting report stays in #ai-sponsor-updates', async () => {
  await alerts.meetingProblem({ name: 'Monday Night', program: 'AA', what: 'link dead' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].channel, 'C_UPDATES');
});

test('a reply during a pending deletion stays in #ai-sponsor-updates', async () => {
  await alerts.leavingReply({ name: 'A', scheduledFor: new Date() });
  assert.strictEqual(sent[0].channel, 'C_UPDATES');
});

test('bot not invited yet: the payment falls back to #ai-sponsor-updates with the reason', async () => {
  replies = [{ ok: false, error: 'channel_not_found' }, { ok: true }];
  const r = await alerts.paid({ name: 'A', email: 'a@example.com', amount: 500 });
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].channel, COMMAND_CENTER);
  assert.strictEqual(sent[1].channel, 'C_UPDATES');
  assert.ok(sent[1].text.includes('PAID'), 'the alert itself is kept');
  assert.ok(sent[1].text.includes('channel_not_found'), 'says why it landed here');
  assert.ok(sent[1].text.includes('/invite @AI Sponsor Metrics'), 'says how to fix it');
  assert.strictEqual(r.ok, true);
});

test('both channels refusing still never throws', async () => {
  replies = [{ ok: false, error: 'channel_not_found' }, { ok: false, error: 'invalid_auth' }];
  const r = await alerts.cancelled({ email: 'a@example.com' });
  assert.strictEqual(r.ok, false);
  assert.ok(/channel_not_found/.test(r.error) && /invalid_auth/.test(r.error), r.error);
});

test('SLACK_CUSTOMER_CHANNEL overrides the command center', async () => {
  process.env.SLACK_CUSTOMER_CHANNEL = 'C_OTHER';
  await alerts.paid({ email: 'a@example.com', amount: 500 });
  delete process.env.SLACK_CUSTOMER_CHANNEL;
  assert.strictEqual(sent[0].channel, 'C_OTHER');
});

test('QA Guru test sign-ups still post nothing anywhere', async () => {
  await alerts.registered({ email: 'qa-proj-ai-sponsor-1@reloulexei.resend.app', phone: PHONE });
  assert.strictEqual(sent.length, 0);
});

test('cancel during the free trial says nothing was paid', async () => {
  await alerts.cancelled({ email: 'a@example.com', duringTrial: true });
  assert.ok(sent[0].text.includes('nothing. They cancelled during the 30 day free trial'));
});

test('cancel after the trial says so', async () => {
  await alerts.cancelled({ email: 'a@example.com', duringTrial: false });
  assert.ok(sent[0].text.includes('after the free trial ended'));
});

test('failed payment names the retry date when Stripe gives one', async () => {
  await alerts.paymentFailed({ email: 'a@example.com', attemptCount: 1, amount: 500, nextAttemptAt: 1794700800 });
  assert.ok(/retry automatically on \d+ \w+ 2026\./.test(sent[0].text), sent[0].text);
});

test('Stripe: a failed invoice carries amount, invoice id and retry date', async () => {
  const result = await stripeModule.handleWebhookEvent({
    type: 'invoice.payment_failed',
    data: { object: {
      id: 'in_FAIL', customer: 'cus_FAIL', attempt_count: 1, amount_due: 500, currency: 'usd',
      next_payment_attempt: 1794700800,
      lines: { data: [{ price: { id: 'price_sponsor_monthly' } }] },
    } },
  });
  assert.strictEqual(result.amount, 500);
  assert.strictEqual(result.invoiceId, 'in_FAIL');
  assert.strictEqual(result.nextAttemptAt, 1794700800);
});

test('Stripe: a cancel before trial_end is marked during the trial', async () => {
  const sub = (canceled_at) => ({
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_1', metadata: { plan: 'monthly' }, trial_end: 2000, canceled_at } },
  });
  assert.strictEqual((await stripeModule.handleWebhookEvent(sub(1000))).duringTrial, true);
  assert.strictEqual((await stripeModule.handleWebhookEvent(sub(3000))).duringTrial, false);
});

(async () => {
  let pass = 0;
  for (const [name, fn] of tests) {
    sent = [];
    replies = [];
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
