/* Offline tests: the per-group codes (AAFOUNDER, NAFOUNDER) show up in GHL and
   in the Slack sign-up alert, so AA and NA sign-ups can be told apart.
   The database side (60 days, first code wins) was checked against the real
   database on 6 Nov with throwaway rows.

   Run: node test-founder-codes.js
*/

const assert = require('assert');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_ALERTS_CHANNEL = 'C_TEST';

const ghl = require('./ghl');
const alerts = require('./alerts');

let sent = [];
global.fetch = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body) });
  return { ok: true, json: async () => ({ ok: true }) };
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('an AA founding member is tagged with their code in GHL', () => {
  const tags = ghl.buildContactBody({ email: 'a@example.com', paymentStatus: 'Beta', betaCode: 'AAFOUNDER' }).tags;
  assert.deepStrictEqual(tags, ['ai-sponsor', 'ai-sponsor-beta', 'ai-sponsor-code-aafounder']);
});

test('an NA founding member gets the NA tag', () => {
  const tags = ghl.buildContactBody({ email: 'n@example.com', paymentStatus: 'Beta', betaCode: 'NAFOUNDER' }).tags;
  assert.ok(tags.includes('ai-sponsor-code-nafounder'));
});

test('no code, no code tag', () => {
  const tags = ghl.buildContactBody({ email: 'b@example.com', paymentStatus: 'Beta' }).tags;
  assert.deepStrictEqual(tags, ['ai-sponsor', 'ai-sponsor-beta']);
});

test('a QA Guru test never gets a code tag', () => {
  const tags = ghl.buildContactBody({ email: 'x@reloulexei.resend.app', paymentStatus: 'Beta', betaCode: 'AAFOUNDER' }).tags;
  assert.deepStrictEqual(tags, ['ai-sponsor', 'qa-test']);
});

test('the sign-up alert names the code and its length', async () => {
  sent = [];
  await alerts.registered({ name: 'Sam', email: 's@example.com', access: 'Beta', code: 'NAFOUNDER', codeDays: 60 });
  const t = sent[0].body.text;
  assert.ok(t.includes('*Code:* NAFOUNDER (60 days free)'), t);
});

test('a sign-up without a code has no code line', async () => {
  sent = [];
  await alerts.registered({ name: 'Jen', email: 'j@example.com', access: 'Beta' });
  assert.ok(!sent[0].body.text.includes('*Code:*'));
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
