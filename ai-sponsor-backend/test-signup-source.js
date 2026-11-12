/* Offline tests for "where did this sign-up come from", 12 Nov 2026.

   Matt read a trial alert saying "Came from: Google / Referrer: google.com /
   Landed on: / / First seen: 2026-10-01T08:15:42.120Z" and had to ask what it
   meant. The same person had also gone through checkout twice and held
   two trials on one card. This file pins down the fixes, using a sign-up of the
   same shape:
     - the alert says it in words: how and when they found us, the first page
       by name, and what brought them back when that was a different visit
     - checkout finds an existing live AI Sponsor plan on the email, and never
       counts another product's plan on the shared Stripe account
     - the trial alert warns when a second plan slips through
     - the visit script on the site records the right visit, skips the trip
       back from Stripe, and names a group's own link
     - Search Console stays dark without a key and reads totals with one

   Nothing touches Slack, Stripe, Google or the database.
   Run: node test-signup-source.js
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const Module = require('module');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_MONTHLY = 'price_ais_monthly';
process.env.STRIPE_PRICE_ANNUAL = 'price_ais_annual';
delete process.env.GSC_SERVICE_ACCOUNT_JSON;

/* A fake Stripe SDK, put where require('stripe') will find it, so stripe.js
   builds its client from this instead of the network. */
const fakeStripe = {
  created: [], customers: {}, subs: {}, listCalls: [],
};
function FakeStripe() {
  return {
    checkout: { sessions: { create: async (args) => { fakeStripe.created.push(args); return { url: 'https://checkout.example/cs', id: 'cs_1' }; } } },
    customers: { list: async ({ email }) => { fakeStripe.listCalls.push(email); return { data: fakeStripe.customers[email] || [] }; } },
    subscriptions: { list: async ({ customer }) => ({ data: fakeStripe.subs[customer] || [] }) },
    webhooks: { constructEvent: () => { throw new Error('not used'); } },
  };
}
const stripePath = Module._resolveFilename('stripe', module);
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: FakeStripe };

const db = require('./db');
const alerts = require('./alerts');
const stripeModule = require('./stripe');
const gsc = require('./gsc');

let sent = [];
global.fetch = async (url, opts) => {
  sent.push({ url, body: JSON.parse(opts.body) });
  return { json: async () => ({ ok: true }) };
};
const lastText = () => sent[sent.length - 1].body.text;
const lines = () => lastText().split('\n');

// Freeze "now" at a sign-up on 12 Nov 2026, 03:30 UTC.
const realNow = Date.now;
const SIGNUP = Date.parse('2026-11-12T03:30:00Z');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A returning visitor: first visit from Google, signed up 22 days later.
const FIRST_VISIT = { referrer: 'google.com', landing: '/', at: '2026-10-21T02:00:00.000Z' };
const THIS_VISIT = { utmSource: '', referrer: '', landing: '/ai-sponsor-registration.html', at: '2026-11-12T03:12:40.000Z' };

/* ── The alert says it in words ─────────────────────────────────────────── */

test("a returning sign-up reads as a sentence, not raw fields", async () => {
  Date.now = () => SIGNUP;
  await alerts.registered({ name: 'Sam', email: 't@example.com', access: 'Paid', attribution: { ...FIRST_VISIT, visit: THIS_VISIT } });
  const t = lastText();
  assert.ok(t.includes('*Found us:* Google search, 21 October 2026 (22 days ago)'), t);
  assert.ok(t.includes('*First page:* Homepage'), 'the page by name');
  assert.ok(t.includes('*Came back through:* No source given: typed in, or a link opened from WhatsApp, a text or an email, 12 November 2026, landing on Sign-up page'), t);
  assert.ok(!t.includes('Referrer:'), 'no raw referrer line');
  assert.ok(!t.includes('2026-10-21T03'), 'no raw timestamp');
  assert.ok(!t.includes('Landed on: /'), 'no bare path');
});

test("the same sign-up from Stripe's flat snake_case metadata says the same thing", async () => {
  Date.now = () => SIGNUP;
  await alerts.registered({ email: 't@example.com', access: 'Paid', attribution: { ...FIRST_VISIT, visit: THIS_VISIT } });
  const fromBrowser = lines().filter((l) => /^\*(Found us|First page|Came back through):\*/.test(l));
  await alerts.trialStarted({
    email: 't@example.com', plan: 'monthly',
    attribution: {
      plan: 'monthly', userId: 'reg-1', referrer: 'google.com', landing: '/', first_seen: FIRST_VISIT.at,
      visit_landing: THIS_VISIT.landing, visit_at: THIS_VISIT.at,
    },
  });
  const fromStripe = lines().filter((l) => /^\*(Found us|First page|Came back through):\*/.test(l));
  assert.deepStrictEqual(fromStripe, fromBrowser);
  assert.strictEqual(fromStripe.length, 3);
});

test('a sign-up on the first visit has no "came back" line', async () => {
  Date.now = () => SIGNUP;
  await alerts.registered({
    email: 'x@example.com', access: 'Paid',
    attribution: { referrer: 'google.com', landing: '/', at: '2026-11-12T03:10:00Z',
      visit: { referrer: 'google.com', landing: '/', at: '2026-11-12T03:10:00Z' } },
  });
  assert.ok(!lastText().includes('Came back through'));
  assert.ok(!lastText().includes('days ago'), 'same day, so no "0 days ago"');
});

test('a blog post is named by its title, or by its address before titles existed', async () => {
  await alerts.registered({ email: 'b@example.com', access: 'Beta', attribution: {
    referrer: 'google.com', landing: '/blog/what-is-debtors-anonymous/', at: '2026-11-01T10:00:00Z',
    title: 'What is Debtors Anonymous, and what helps between meetings?' } });
  assert.ok(lastText().includes('*First page:* Blog: What is Debtors Anonymous, and what helps between meetings?'));
  await alerts.registered({ email: 'b@example.com', access: 'Beta', attribution: {
    referrer: 'google.com', landing: '/blog/what-is-overeaters-anonymous/', at: '2026-11-01T10:00:00Z' } });
  assert.ok(lastText().includes('*First page:* Blog: What is overeaters anonymous'));
});

test('a group link names the group; an AI answer and a social site read naturally', () => {
  assert.strictEqual(db.sourcePhrase({ utmSource: 'AA WhatsApp group', landing: '/' }), 'AA WhatsApp group (a link we tagged)');
  assert.strictEqual(db.sourcePhrase({ referrer: 'chatgpt.com', landing: '/' }), 'ChatGPT, a link in one of its answers');
  assert.strictEqual(db.sourcePhrase({ referrer: 'facebook.com', landing: '/' }), 'a link on Facebook');
  assert.strictEqual(db.sourcePhrase({ referrer: 'bing.com', landing: '/' }), 'Bing search');
  assert.strictEqual(db.sourcePhrase({}), 'Unknown (no website visit reached us)');
});

test('the day-31 payment alert gives the date but no "days ago"', async () => {
  Date.now = () => Date.parse('2026-12-12T03:30:00Z');
  await alerts.paid({ email: 't@example.com', amount: 500, currency: 'usd', attribution: { ...FIRST_VISIT } });
  assert.ok(lastText().includes('*Found us:* Google search, 21 October 2026\n'), lastText());
  assert.ok(!lastText().includes('days ago'));
});

/* ── A second plan on the same email ─────────────────────────────────────── */

test('trial alert warns, and needs attention, when the email already has a live plan', async () => {
  Date.now = realNow;
  await alerts.trialStarted({
    email: 'person@example.com', plan: 'monthly',
    otherPlans: [{ id: 'sub_first', status: 'trialing', created: 1794470400 }],
  });
  const t = lastText();
  assert.ok(t.includes(':warning: *This email already has another live plan:* sub_first (trialing, since 12 November 2026)'), t);
  assert.ok(t.includes('charged twice unless one is cancelled'));
  assert.ok(t.includes('*Severity:* Needs attention'));
});

test('trial alert stays Info with no other plan, or when the check failed', async () => {
  await alerts.trialStarted({ email: 'one@example.com', plan: 'monthly', otherPlans: [] });
  assert.ok(lastText().includes('*Severity:* Info'));
  assert.ok(!lastText().includes(':warning:'));
  await alerts.trialStarted({ email: 'one@example.com', plan: 'monthly' });
  assert.ok(lastText().includes('*Severity:* Info'));
});

function sub(id, { status = 'trialing', price = 'price_ais_monthly', plan = 'monthly', cancelAtEnd = false } = {}) {
  return { id, status, created: 1794470400, trial_end: 1797046200, cancel_at_period_end: cancelAtEnd,
    metadata: plan ? { plan } : {}, items: { data: [{ price: { id: price } }] } };
}

test('finds a live AI Sponsor plan on the email', async () => {
  fakeStripe.customers = { 'person@example.com': [{ id: 'cus_A' }] };
  fakeStripe.subs = { cus_A: [sub('sub_live')] };
  const found = await stripeModule.findLiveSubscriptions('person@example.com');
  assert.deepStrictEqual(found.map((f) => f.id), ['sub_live']);
  assert.strictEqual(found[0].plan, 'monthly');
});

test("never counts another product's plan on the shared Stripe account", async () => {
  fakeStripe.customers = { 'drm@example.com': [{ id: 'cus_D' }] };
  fakeStripe.subs = { cus_D: [sub('sub_drm', { price: 'price_drm_1999', plan: null })] };
  assert.deepStrictEqual(await stripeModule.findLiveSubscriptions('drm@example.com'), []);
});

test('a cancelled plan, or one already set to end, does not block a new one', async () => {
  fakeStripe.customers = { 'left@example.com': [{ id: 'cus_L' }] };
  fakeStripe.subs = { cus_L: [sub('sub_gone', { status: 'canceled' }), sub('sub_ending', { cancelAtEnd: true })] };
  assert.deepStrictEqual(await stripeModule.findLiveSubscriptions('left@example.com'), []);
});

test('the trial alert check leaves out the plan that just started', async () => {
  fakeStripe.customers = { 'person@example.com': [{ id: 'cus_A' }, { id: 'cus_B' }] };
  fakeStripe.subs = { cus_A: [sub('sub_first')], cus_B: [sub('sub_second')] };
  const found = await stripeModule.findLiveSubscriptions('person@example.com', { excludeId: 'sub_second' });
  assert.deepStrictEqual(found.map((f) => f.id), ['sub_first']);
});

test('the email is tried as typed and lower-cased, each customer checked once', async () => {
  fakeStripe.listCalls = [];
  fakeStripe.customers = { 'Person@Example.com': [{ id: 'cus_A' }], 'person@example.com': [{ id: 'cus_A' }] };
  fakeStripe.subs = { cus_A: [sub('sub_live')] };
  const found = await stripeModule.findLiveSubscriptions(' Person@Example.com ');
  assert.deepStrictEqual(fakeStripe.listCalls, ['Person@Example.com', 'person@example.com']);
  assert.strictEqual(found.length, 1, 'same customer under both spellings counts once');
});

test('no email, no lookup', async () => {
  assert.deepStrictEqual(await stripeModule.findLiveSubscriptions(''), []);
});

/* ── Checkout carries the visit and the title through Stripe ─────────────── */

test('checkout writes the title and the visit into Stripe, and they read back as the same lines', async () => {
  fakeStripe.created = [];
  await stripeModule.createCheckoutSession({
    plan: 'monthly', email: 't@example.com', userId: 'reg-1', successUrl: 's', cancelUrl: 'c',
    attribution: { ...FIRST_VISIT, title: 'AI Sponsor — Always Here', visit: THIS_VISIT },
  });
  const meta = fakeStripe.created[0].subscription_data.metadata;
  assert.strictEqual(meta.landing_title, 'AI Sponsor — Always Here');
  assert.strictEqual(meta.visit_landing, '/ai-sponsor-registration.html');
  assert.strictEqual(meta.visit_at, THIS_VISIT.at);
  assert.ok(!('visit_referrer' in meta), 'blank values are dropped, not stored empty');
  assert.ok(Object.keys(meta).length <= 50, "within Stripe's 50-key limit");
  Date.now = () => SIGNUP;
  await alerts.trialStarted({ email: 't@example.com', plan: 'monthly', attribution: meta });
  assert.ok(lastText().includes('*Came back through:* No source given'));
  Date.now = realNow;
});

/* ── The visit script on the site ─────────────────────────────────────────── */

function visitScript(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const i = html.indexOf('Attribution, THIS visit');
  const open = html.indexOf('<script>', i) + '<script>'.length;
  return html.slice(open, html.indexOf('</script>', open));
}

function runPage(file, { url, referrer = '', store = {}, ogTitle = '' }) {
  const u = new URL(url);
  const listeners = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const document = {
    referrer,
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
    querySelector: (sel) => (sel === 'meta[property="og:title"]' && ogTitle
      ? { getAttribute: () => ogTitle } : null),
  };
  vm.runInNewContext(visitScript(file), {
    location: { hostname: u.hostname, pathname: u.pathname, search: u.search },
    document, localStorage, URL, URLSearchParams, Date, JSON, String,
  });
  if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
  const read = (k) => (store[k] ? JSON.parse(store[k]) : null);
  return { visit: read('ais_visit'), attr: read('ais_attr'), store };
}

test('arriving from Google records the visit, with the page title', () => {
  const r = runPage('index.html', { url: 'https://getaisponsor.com/', referrer: 'https://www.google.com/', ogTitle: 'AI Sponsor — Always Here' });
  assert.strictEqual(r.visit.referrer, 'google.com');
  assert.strictEqual(r.visit.landing, '/');
  assert.strictEqual(r.visit.title, 'AI Sponsor — Always Here');
});

test('clicking around inside the site keeps the visit that brought them', () => {
  const store = { ais_visit: JSON.stringify({ referrer: 'google.com', landing: '/', at: '2026-11-12T03:00:00Z' }) };
  const r = runPage('blog/what-is-debtors-anonymous/index.html', {
    url: 'https://getaisponsor.com/blog/what-is-debtors-anonymous/', referrer: 'https://getaisponsor.com/', store });
  assert.strictEqual(r.visit.referrer, 'google.com', 'not overwritten by an internal click');
});

test('coming back from Stripe checkout is not a new visit', () => {
  const store = { ais_visit: JSON.stringify({ referrer: 'google.com', landing: '/', at: '2026-11-12T03:00:00Z' }) };
  let r = runPage('ai-sponsor-registration.html', { url: 'https://getaisponsor.com/ai-sponsor-registration.html?payment=success', referrer: 'https://checkout.stripe.com/', store });
  assert.strictEqual(r.visit.referrer, 'google.com');
  r = runPage('ai-sponsor-registration.html', { url: 'https://getaisponsor.com/ai-sponsor-registration.html?payment=success', referrer: '', store });
  assert.strictEqual(r.visit.referrer, 'google.com', 'even when the browser drops the referrer');
});

test("a group's own sign-up link names the group on the visit too", () => {
  const r = runPage('ai-sponsor-registration.html', { url: 'https://getaisponsor.com/ai-sponsor-registration.html?code=AAFOUNDER', referrer: '' });
  assert.strictEqual(r.visit.utmSource, 'AA WhatsApp group');
});

test('the first page gets its title only on the visit that wrote it', () => {
  const fresh = { ais_attr: JSON.stringify({ landing: '/blog/x/', at: new Date().toISOString() }) };
  let r = runPage('blog/what-is-debtors-anonymous/index.html', { url: 'https://getaisponsor.com/blog/x/', referrer: 'https://www.google.com/', store: fresh, ogTitle: 'Post X' });
  assert.strictEqual(r.attr.title, 'Post X');
  const old = { ais_attr: JSON.stringify({ landing: '/', at: '2026-10-21T02:00:00.000Z' }) };
  r = runPage('blog/what-is-debtors-anonymous/index.html', { url: 'https://getaisponsor.com/blog/x/', referrer: 'https://www.google.com/', store: old, ogTitle: 'Post X' });
  assert.ok(!r.attr.title, 'a later page never relabels the first one');
});

test('every page that records the first visit also records this visit', () => {
  const root = path.join(__dirname, '..');
  const pages = ['index.html', 'ai-sponsor-registration.html', 'blog/index.html',
    ...fs.readdirSync(path.join(root, 'blog')).filter((d) => fs.existsSync(path.join(root, 'blog', d, 'index.html'))).map((d) => `blog/${d}/index.html`)];
  for (const p of pages) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    if (!html.includes("setItem('ais_attr'")) continue;
    assert.ok(html.includes("setItem('ais_visit'"), `${p} records the first visit but not this one`);
  }
});

/* ── Search Console ───────────────────────────────────────────────────────── */

test('Search Console is dark without a key: null, never zeros', async () => {
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  assert.strictEqual(await gsc.weekly(), null);
  process.env.GSC_SERVICE_ACCOUNT_JSON = 'not a key';
  assert.strictEqual(await gsc.weekly(), null);
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
});

test('the week shown ends 3 days ago, so its numbers do not move after we show them', () => {
  const end = new Date('2026-11-09T00:00:00Z');
  assert.deepStrictEqual(gsc._internals.windowEnding(end, 7), { from: '2026-11-03', to: '2026-11-09' });
});

test('with a key it reads totals, searches and pages, and names pages in words', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GSC_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify({
    client_email: 'reader@proj.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  })).toString('base64');
  const calls = [];
  const saved = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: opts.body });
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    const req = JSON.parse(opts.body);
    const dim = (req.dimensions || [])[0];
    const rows = !dim
      ? [{ clicks: req.startDate === '2026-11-03' ? 4 : 2, impressions: 90, position: 12.34 }]
      : dim === 'query'
        ? [{ keys: ['online aa sponsor'], clicks: 2, impressions: 30 }, { keys: ['ai sponsor'], clicks: 0, impressions: 40 }]
        : [{ keys: ['https://getaisponsor.com/'], clicks: 3, impressions: 60 }, { keys: ['https://getaisponsor.com/blog/what-is-debtors-anonymous/'], clicks: 1, impressions: 20 }];
    return { ok: true, json: async () => ({ rows }) };
  };
  try {
    const g = await gsc.weekly({ now: new Date('2026-11-12T10:00:00Z') });
    assert.strictEqual(g.from, '2026-11-03');
    assert.strictEqual(g.to, '2026-11-09');
    assert.strictEqual(g.clicks, 4);
    assert.strictEqual(g.previous.clicks, 2);
    assert.strictEqual(g.position, 12.3);
    assert.strictEqual(g.topSearches[0].search, 'online aa sponsor', 'clicks first');
    assert.deepStrictEqual(g.topPages.map((p) => p.page), ['Homepage', 'Blog: What is debtors anonymous']);
    const tokenCall = calls.find((c) => c.url.includes('oauth2'));
    assert.ok(tokenCall.body.includes('jwt-bearer'), 'signed JWT exchanged for a token');
    assert.ok(calls.some((c) => c.url.includes(encodeURIComponent('https://getaisponsor.com/'))), 'asks about getaisponsor.com');
  } finally {
    global.fetch = saved;
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  }
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
    finally { Date.now = realNow; }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
