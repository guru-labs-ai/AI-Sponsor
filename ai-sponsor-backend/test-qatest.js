/* Offline tests: QA Guru's test inbox is told apart from real people.
   Nothing here touches GHL or Slack. global.fetch is stubbed and we assert on
   what would have been sent.

   Run: node test-qatest.js
*/

const assert = require('assert');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_ALERTS_CHANNEL = 'C_TEST';
process.env.GHL_API_TOKEN = 'pit-test';

const { isQaTest } = require('./qatest');
const ghl = require('./ghl');
const alerts = require('./alerts');

let sent = [];
global.fetch = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ ok: true, contact: { id: 'c1' } }) };
};

const TEST_EMAIL = 'qa-proj-ai-sponsor-mw4so919@reloulexei.resend.app';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the QA Guru test inbox is recognised, real people are not', () => {
  assert.strictEqual(isQaTest(TEST_EMAIL), true);
  assert.strictEqual(isQaTest('  QA-Proj-X@Reloulexei.Resend.App '), true);
  assert.strictEqual(isQaTest('someone@gmail.com'), false);
  assert.strictEqual(isQaTest('reloulexei.resend.app@gmail.com'), false);
  assert.strictEqual(isQaTest('x@other.resend.app'), false);
  assert.strictEqual(isQaTest(''), false);
  assert.strictEqual(isQaTest(undefined), false);
});

test('a test sign-up via the Amends form is tagged qa-test, never amends-tv', () => {
  const body = ghl.buildContactBody({ name: 'Alex Rivera', email: TEST_EMAIL, amendsInterest: true, source: 'amends-landing-modal' });
  assert.deepStrictEqual(body.tags, ['ai-sponsor', 'qa-test']);
});

test('a test sign-up with a beta code is not counted as a beta sign-up', () => {
  const body = ghl.buildContactBody({ email: TEST_EMAIL, paymentStatus: 'beta' });
  assert.ok(!body.tags.includes('ai-sponsor-beta'), 'beta tag would count it as a sign-up');
  assert.ok(body.tags.includes('qa-test'));
});

test('a real person is tagged exactly as before', () => {
  assert.deepStrictEqual(
    ghl.buildContactBody({ email: 'a@example.com', paymentStatus: 'beta', amendsInterest: true }).tags,
    ['ai-sponsor', 'ai-sponsor-beta', 'amends-tv'],
  );
  assert.deepStrictEqual(ghl.buildContactBody({ email: 'b@example.com' }).tags, ['ai-sponsor']);
});

test('a test support ticket is saved with qa-test, a real one without', async () => {
  sent = [];
  await ghl.submitSupport({ name: 'Sarah M.', email: TEST_EMAIL, subject: 'Account help', message: 'hi' });
  const testUpsert = sent.find((s) => /contacts\/upsert/.test(s.url));
  assert.deepStrictEqual(testUpsert.body.tags, ['ai-sponsor', 'ai-sponsor-support', 'qa-test']);

  sent = [];
  await ghl.submitSupport({ name: 'Real', email: 'real@example.com', subject: 's', message: 'm' });
  const realUpsert = sent.find((s) => /contacts\/upsert/.test(s.url));
  assert.deepStrictEqual(realUpsert.body.tags, ['ai-sponsor', 'ai-sponsor-support']);
});

test('a test sign-up posts nothing to Slack (9 Nov)', async () => {
  sent = [];
  const r = await alerts.registered({ name: 'Alex Rivera', email: TEST_EMAIL, access: 'Unpaid', contactId: 'TMVO' });
  assert.strictEqual(sent.length, 0, 'nothing sent: ' + JSON.stringify(sent));
  assert.strictEqual(r.skipped, 'qa-test');
});

test('a test support ticket posts nothing to Slack (9 Nov), a real one still does', async () => {
  // Tickets go through alerts.supportTicket since 9 Nov (to #realtime-alerts).
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
  const route = src.slice(src.indexOf("app.post('/support'"), src.indexOf("app.post('/support'") + 600);
  assert.ok(route.includes('alerts.supportTicket('), 'the form uses the alerts path');
  sent = [];
  const r = await alerts.supportTicket({ name: 'Sarah M.', email: TEST_EMAIL, subject: 'x', message: 'y' });
  assert.strictEqual(sent.length, 0, 'test ticket sends nothing');
  assert.strictEqual(r.skipped, 'qa-test');
  await alerts.supportTicket({ name: 'Jen', email: 'jen@example.com', subject: 'Help', message: 'Hi' });
  assert.strictEqual(sent.length, 1, 'a real ticket is posted');
  assert.ok(sent[0].body.text.includes('New AI Sponsor support ticket'));
});

test('a real sign-up alert is unchanged', async () => {
  sent = [];
  await alerts.registered({ name: 'Jen', email: 'jen@example.com', access: 'Beta' });
  const t = sent[0].body.text;
  assert.ok(t.includes('New AI Sponsor registration'));
  assert.ok(!t.includes('QA Guru'));
});

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      console.log(`  ok  ${name}`);
    } catch (e) {
      fail++;
      console.log(`  FAIL ${name}\n       ${e.message}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
