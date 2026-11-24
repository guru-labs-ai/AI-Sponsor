/* ─── The sponsor knows what somebody is on ──────────────────────────────────
   Run: node test-plan.js

   21 Nov: "is this free or will it cost money" got "I honestly don't know the
   pricing". plan.js gives the sponsor the person's plan, in the words members
   can already read elsewhere. These guard what it may and may not say. */

const assert = require('assert');
const fs = require('fs');
const { planOf, planLines } = require('./plan');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}
const NOW = new Date('2026-11-24T12:00:00Z');
const LINK = 'https://getaisponsor.com/ai-sponsor-settings.html?t=TOKEN#plan';
const text = (rows) => planLines(planOf(rows, NOW), LINK).join('\n');

// The shapes the live rows really have (24 Nov), values invented.
const founding = [
  { access: 'Beta', beta_code: 'AAFOUNDER', beta_expires_at: '2027-01-18T13:27:00Z', stripe_subscription_id: null, code_days: 60 },
  { access: 'Beta', beta_code: 'AAFOUNDER', beta_expires_at: '2027-01-18T13:26:00Z', stripe_subscription_id: null, code_days: 60 },
];
const beta = [{ access: 'Beta', beta_code: 'SPONSOR-BETA-USER', beta_expires_at: '2027-05-22T06:57:00Z', stripe_subscription_id: null, code_days: null }];
const oldBeta = [{ access: 'Beta', beta_code: null, beta_expires_at: '2027-02-01T00:00:00Z', stripe_subscription_id: null, code_days: null }];
const paid = [{ access: 'Paid', beta_code: null, beta_expires_at: null, stripe_subscription_id: 'sub_x', code_days: null }];
const ended = [{ access: 'Unpaid', beta_code: null, beta_expires_at: null, stripe_subscription_id: 'sub_x', code_days: null }];
const waOnly = [{ access: 'Unpaid', beta_code: null, beta_expires_at: null, stripe_subscription_id: null, code_days: null }];

console.log('\n── What they are on ──');

check('a founding-member code is free until its own date, in words a person reads', () => {
  const p = planOf(founding, NOW);
  assert.deepStrictEqual(p, { kind: 'founding', until: 'January 18' });
  const t = text(founding);
  assert.ok(/free for them until January 18\./.test(t), t);
  assert.ok(/the day and the month \(January 18\), never only the month/.test(t), 'the day is never dropped (eval 24 Nov: "until January 2027" 3 of 3)');
  assert.ok(/No card is needed/.test(t));
  assert.ok(/nothing is ever charged unless they choose to pay/.test(t));
});

check('what happens after the free time is not invented (Matt has not decided day 60)', () => {
  const t = text(founding);
  assert.ok(/you do not know yet/.test(t));
  assert.ok(/never say it will stop working or that they will be charged/.test(t));
  assert.ok(/never as what they will pay after January 18: you do not know that/.test(t), "eval 24 Nov: 'after that it is $5 a month'");
});

check('every other beta member: free access, and the six months is never said (Mariam, 3 Sep)', () => {
  for (const rows of [beta, oldBeta]) {
    assert.strictEqual(planOf(rows, NOW).kind, 'beta');
    const t = text(rows);
    assert.ok(/nothing will ever be taken from them/.test(t), 'same promise as the settings page');
    assert.ok(!/2027|May|six months|6 months/i.test(t), 'no end date or length leaks');
    assert.ok(/never say "forever" or "for life"/.test(t), 'and no lifetime promise either');
    assert.ok(/without making it sound either permanent or about to end/.test(t), 'eval 24 Nov: "No end date for you" read as forever');
    assert.ok(!/no end date to give/i.test(t), 'no ready-made line to copy');
  }
});

check('a founding code whose date has passed is not called free "until" a past day', () => {
  const p = planOf([{ ...founding[0], beta_expires_at: '2026-11-01T00:00:00Z' }], NOW);
  assert.strictEqual(p.kind, 'beta');
});

check('paid: the prices, and their own date only via their plan page, never guessed', () => {
  assert.strictEqual(planOf(paid, NOW).kind, 'paid');
  const t = text(paid);
  assert.ok(t.includes('$5 a month or $49 a year, and both start with 30 days free'));
  assert.ok(t.includes(LINK));
  assert.ok(/never guess them/.test(t));
});

check('a subscription that ended, and a WhatsApp-only arrival, are told apart', () => {
  assert.strictEqual(planOf(ended, NOW).kind, 'ended');
  assert.strictEqual(planOf(waOnly, NOW).kind, 'none');
  assert.ok(/no plan on file/.test(text(waOnly)));
  assert.ok(/Do not tell them what they personally owe or that it is free for them/.test(text(waOnly)));
});

check('free access wins over an old paid row, the same order access.js uses', () => {
  assert.strictEqual(planOf([...ended, ...beta], NOW).kind, 'beta');
});

check('no rows, or a failed read, means the sponsor simply does not know', () => {
  assert.deepStrictEqual(planLines(planOf(null, NOW), LINK), []);
  assert.deepStrictEqual(planLines(planOf([], NOW), LINK), []);
});

console.log('\n── Only when they ask about AI Sponsor itself ──');

check('never brought up by the sponsor, and never in a talk about their own money', () => {
  for (const rows of [founding, beta, paid, ended, waOnly]) {
    const t = text(rows);
    assert.ok(/Never bring any of this up yourself/.test(t));
    assert.ok(/Their own money \(debts, bills, rent, spending, a spending plan\) is not a question about AI Sponsor/.test(t));
  }
});

console.log('\n── Wired in ──');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const dbSrc = fs.readFileSync(require.resolve('./db.js'), 'utf8');

check('read in the same breath as the settings token, so it adds no wait', () => {
  assert.ok(/Promise\.all\(\[\s*db\.getOrCreateSettingsToken\(userId\)\.catch\(\(\) => null\),\s*typeof db\.getPlanFacts === 'function' \? db\.getPlanFacts\(userId\)\.catch\(\(\) => null\) : null,/.test(src));
  assert.ok(src.includes('...plan.planLines(plan.planOf(planRows), planLink),'));
});

check('their plan page is one of the things the settings link is for', () => {
  assert.ok(src.includes('- see their plan, what they pay and when, or stop paying. That one opens straight onto it: ${planLink}'));
  assert.ok(src.includes('const planLink = `${SITE_URL}/ai-sponsor-settings.html?t=${token}#plan`;'));
});

check('one query, every identity of the person, the code length joined in', () => {
  const fn = dbSrc.slice(dbSrc.indexOf('async function getPlanFacts'), dbSrc.indexOf('// Validate a beta code and count'));
  assert.ok(/LEFT JOIN beta_codes b ON b\.code = u\.beta_code/.test(fn));
  assert.ok(/LOWER\(u\.email\) = LOWER\(me\.email\)/.test(fn) && /u\.phone = me\.phone/.test(fn));
  assert.strictEqual((fn.match(/pool\.query/g) || []).length, 1, 'a single round trip');
  assert.ok(/getPlanFacts, logAdminAccess/.test(dbSrc), 'exported');
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nAll good: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
