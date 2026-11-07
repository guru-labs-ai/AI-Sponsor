/* Offline tests: the newsletter totals on the North Star page.
   Nothing here touches GHL. global.fetch is stubbed with a small fake GHL.

   Run: node test-newsletter.js
*/

const assert = require('assert');

process.env.GHL_API_TOKEN = 'pit-test';
process.env.EXCLUDED_PEOPLE = 'team@guru.test,+15550001111';
process.env.NEWSLETTER_EXCLUDED = 'helper@guru.test';

const SUBJECT = 'The AI Sponsor newsletter: every meeting for your program, in one place';
const SENT = Date.UTC(2026, 10, 6, 14, 1, 0);
const OLD_SUBJECT = 'The AI Sponsor newsletter: your sponsor can now find you a meeting';
const OLD_SENT = Date.UTC(2026, 9, 29, 21, 20, 0);
const iso = (ms) => new Date(ms).toISOString();

const schedules = [
  { id: 's2', status: 'complete', subject: SUBJECT, totalCount: 48, dateScheduled: SENT },
  // The team's test send of the same issue the night before: three people.
  { id: 's2t', status: 'complete', subject: SUBJECT, totalCount: 3, dateScheduled: SENT - 15 * 3600e3 },
  { id: 's1', status: 'complete', subject: OLD_SUBJECT, totalCount: 49, dateScheduled: OLD_SENT },
  { id: 'd', status: 'draft', subject: SUBJECT, totalCount: null, dateScheduled: null },
  { id: 'x', status: 'complete', subject: 'Webinar replay', totalCount: 300, dateScheduled: SENT },
];

const out = (id, to, subject, at, source = 'campaign') =>
  ({ id, direction: 'outbound', source, subject, to: [to], dateAdded: iso(at) });
const inb = (id, from, subject, at) =>
  ({ id, direction: 'inbound', source: null, subject, from, dateAdded: iso(at) });

const messages = [
  out('m1', 'ann@mail.test', SUBJECT, SENT + 1000),
  out('m2', 'bob@mail.test', SUBJECT, SENT + 2000),
  out('m3', 'cat@mail.test', SUBJECT, SENT + 3000),
  out('m3b', 'cat@mail.test', SUBJECT, SENT + 4000),          // sent twice, counts once
  out('m4', 'team@guru.test', SUBJECT, SENT + 5000),          // EXCLUDED_PEOPLE
  out('m5', 'helper@guru.test', SUBJECT, SENT + 6000),        // NEWSLETTER_EXCLUDED
  out('m6', 'qa-proj-x@reloulexei.resend.app', SUBJECT, SENT + 7000), // QA Guru
  out('m7', 'test@example.com', SUBJECT, SENT + 8000),        // reserved test domain
  out('t1', 'ann@mail.test', SUBJECT, SENT - 15 * 3600e3),    // the test send, before
  out('a1', 'ann@mail.test', SUBJECT, SENT + 1000, 'app'),    // a one-off, not the campaign
  out('o1', 'ann@mail.test', OLD_SUBJECT, OLD_SENT + 1000),
  out('o2', 'dan@mail.test', OLD_SUBJECT, OLD_SENT + 2000),
  inb('r1', 'Bob <bob@mail.test>', 'Re: ' + SUBJECT, SENT + 3600e3),
  inb('r2', 'bob@mail.test', 'RE: ' + SUBJECT, SENT + 7200e3),         // same person twice
  inb('r3', 'helper@guru.test', 'Re: ' + SUBJECT, SENT + 3600e3),      // team reply
  inb('r4', 'ann@mail.test', 'Re: ' + SUBJECT, SENT - 14 * 3600e3),    // reply to the test send
  inb('r5', 'dan@mail.test', 'Re: ' + OLD_SUBJECT, SENT + 3600e3),     // old issue, replied late
];

const status = { m1: 'clicked', m2: 'opened', m3: 'delivered', m3b: 'opened', m4: 'clicked',
  m5: 'opened', m6: 'opened', m7: 'opened', o1: 'opened', o2: 'bounced' };

let calls = [];
global.fetch = async (url) => {
  calls.push(url);
  const u = new URL(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.pathname === '/emails/schedule') return json({ schedules });
  if (u.pathname === '/conversations/messages/export') {
    const from = Date.parse(u.searchParams.get('startDate'));
    const to = Date.parse(u.searchParams.get('endDate'));
    return json({ messages: messages.filter((m) => {
      const t = Date.parse(m.dateAdded); return t >= from && t <= to;
    }), nextCursor: null });
  }
  const m = u.pathname.match(/^\/conversations\/messages\/email\/(.+)$/);
  if (m) return json({ emailMessage: { id: m[1], status: status[m[1]] || 'delivered' } });
  return { ok: false, status: 404, json: async () => ({}) };
};

const nl = require('./newsletter');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('only full-size newsletter sends count as issues, newest first', async () => {
  const d = await nl.compute(SENT + 86400e3);
  assert.strictEqual(d.issues.length, 2);
  assert.strictEqual(d.issues[0].sentAt, iso(SENT));
  assert.strictEqual(d.issues[1].sentAt, iso(OLD_SENT));
  assert.strictEqual(d.issues[0].title, 'every meeting for your program, in one place');
});

test('the team, QA Guru and test addresses are left out; each person counts once', async () => {
  const d = await nl.compute(SENT + 86400e3);
  const i = d.issues[0];
  assert.strictEqual(i.sent, 3);        // ann, bob, cat
  assert.strictEqual(i.opened, 3);      // ann clicked (so opened), bob opened, cat opened her second copy
  assert.strictEqual(i.clicked, 1);
});

test('replies: real people, after the send, once each, matching the issue', async () => {
  const d = await nl.compute(SENT + 86400e3);
  assert.strictEqual(d.issues[0].replied, 1);   // bob, not the team, not the test-send reply
  assert.strictEqual(d.issues[1].replied, 1);   // dan replied to the old issue later
});

test('an email that bounced counts as not arriving, not as opened', async () => {
  const d = await nl.compute(SENT + 86400e3);
  const old = d.issues[1];
  assert.strictEqual(old.sent, 2);
  assert.strictEqual(old.didNotArrive, 1);
  assert.strictEqual(old.opened, 1);
});

test('people who opened any issue are counted across issues without doubles', async () => {
  const d = await nl.compute(SENT + 86400e3);
  assert.strictEqual(d.peopleWhoOpenedAny, 3);  // ann (both issues), bob, cat
});

test('no names or email addresses leave the module', async () => {
  const d = await nl.compute(SENT + 86400e3);
  const text = JSON.stringify(d);
  assert.ok(!/@/.test(text), 'an address leaked: ' + text);
  ['ann', 'bob', 'cat', 'dan'].forEach((n) => assert.ok(!text.includes(n)));
});

test('a click is not asked about again', async () => {
  calls = [];
  await nl.compute(SENT + 86400e3);
  assert.ok(!calls.some((c) => c.endsWith('/email/m1')), 'm1 was re-read after its click');
  assert.ok(calls.some((c) => c.endsWith('/email/m2')), 'm2 should be re-read');
});

test('address parsing', () => {
  const { emailOf, isLeftOut, listFromEnv } = nl._test;
  assert.strictEqual(emailOf(['A@B.test']), 'a@b.test');
  assert.strictEqual(emailOf('Bob Smith <Bob@Mail.test>'), 'bob@mail.test');
  assert.strictEqual(emailOf(undefined), '');
  assert.strictEqual(isLeftOut('', new Set()), true);
  assert.strictEqual(isLeftOut('x@example.com', new Set()), true);
  assert.strictEqual(isLeftOut('x@gmail.com', new Set()), false);
  // Phone numbers in EXCLUDED_PEOPLE are for the DB; they are ignored here.
  assert.deepStrictEqual(listFromEnv('EXCLUDED_PEOPLE'), ['team@guru.test']);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ', name); }
    catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
