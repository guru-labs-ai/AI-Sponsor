/* Guards what we tell Meta about a real payment. Run: node test-metacapi.js

   Offline. global.fetch is stubbed, so nothing leaves the machine and the
   assertions are made against the exact payload Meta would have received.

   Why this file exists. This is the only report of an AI Sponsor sale that ever
   reaches Meta, it fires 30 days after the click that produced it, and every way
   it can go wrong is silent:

   1. Sending a raw email. Meta requires personal data hashed, and an unhashed
      one is both a privacy failure and an unmatchable event.
   2. Hashing _fbp or _fbc. They are Meta's own cookie values and hashing them
      destroys the match, while still returning a cheerful 200.
   3. Losing the click when the pixel was blocked. The cookie is missing but the
      fbclid is not, and it can be rebuilt.
   4. Reading only one metadata shape. Stripe hands back snake_case because that
      is how it was written at checkout, so a camelCase-only reader would label
      every paying customer unattributed.
   5. Dropping the dedup key, which turns one webhook retry into two sales.    */
const path = require('path');
const crypto = require('crypto');

process.env.META_CAPI_TOKEN = 'test-token';
process.env.META_CAPI_PIXEL_ID = '1018553221183175';
delete process.env.META_CAPI_TEST_CODE;

const modulePath = path.resolve(__dirname, 'metacapi.js');
const metacapi = require(modulePath);

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

// Captures the request instead of making it, and answers the way Meta does.
let sent = null;
global.fetch = async (url, options) => {
  sent = { url, body: JSON.parse(options.body) };
  return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A day-31 charge, with attribution in the shape Stripe actually returns it.
const payment = (over = {}) => ({
  email: 'Someone@Example.com ',
  amount: 500,
  currency: 'usd',
  plan: 'monthly',
  invoiceId: 'in_123',
  siteUrl: 'https://getaisponsor.com',
  attribution: {
    fbp: 'fb.1.1756000000000.987654321',
    fbc: 'fb.1.1756000000000.IwAR_click',
    utm_source: 'facebook',
    landing: 'https://getaisponsor.com/ai-sponsor-registration.html',
    first_seen: '2026-08-24T10:00:00.000Z',
  },
  ...over,
});

(async () => {
  group('a real payment is reported as a Purchase');
  let r = await metacapi.purchase(payment());
  let ev = sent.body.data[0];
  check('it was sent', r.sent, true);
  check('event name', ev.event_name, 'Purchase');
  check('action source', ev.action_source, 'website');
  check('value is dollars, not cents', ev.custom_data.value, 5);
  check('currency is upper case', ev.custom_data.currency, 'USD');
  check('plan name', ev.custom_data.content_name, 'AI Sponsor Monthly');
  check('the annual plan is named as itself',
    (await metacapi.purchase(payment({ plan: 'annual' })), sent.body.data[0].custom_data.content_name),
    'AI Sponsor Annual');

  group('the invoice id is the dedup key');
  await metacapi.purchase(payment());
  check('event_id is the invoice', sent.body.data[0].event_id, 'in_123');
  check('a renewal is its own event, not a duplicate',
    (await metacapi.purchase(payment({ invoiceId: 'in_456' })), sent.body.data[0].event_id),
    'in_456');

  group('personal data never leaves raw');
  await metacapi.purchase(payment());
  ev = sent.body.data[0];
  check('email is hashed, lowercased and trimmed', ev.user_data.em, [sha('someone@example.com')]);
  check('the raw email is nowhere in the payload',
    JSON.stringify(sent.body).includes('Someone@Example.com'), false);

  group('Meta cookies are passed through untouched');
  check('_fbp is not hashed', ev.user_data.fbp, 'fb.1.1756000000000.987654321');
  check('_fbc is not hashed', ev.user_data.fbc, 'fb.1.1756000000000.IwAR_click');

  group('a blocked pixel costs match quality, not the whole click');
  await metacapi.purchase(payment({
    attribution: { fbclid: 'IwAR_click', first_seen: '2026-08-24T10:00:00.000Z' },
  }));
  check('fbc is rebuilt from the fbclid at click time',
    sent.body.data[0].user_data.fbc,
    `fb.1.${Date.parse('2026-08-24T10:00:00.000Z')}.IwAR_click`);

  await metacapi.purchase(payment({ attribution: { fbclid: 'IwAR_click' } }));
  check('with no click time we send no fbc rather than a wrong one',
    sent.body.data[0].user_data.fbc, undefined);

  group('both metadata shapes are read');
  await metacapi.purchase(payment({
    attribution: { fbclid: 'IwAR_click', firstSeen: '2026-08-24T10:00:00.000Z' },
  }));
  check('camelCase from the browser works too',
    sent.body.data[0].user_data.fbc,
    `fb.1.${Date.parse('2026-08-24T10:00:00.000Z')}.IwAR_click`);

  group('an event Meta cannot match is not sent at all');
  r = await metacapi.purchase(payment({ email: '', attribution: {} }));
  check('not sent', r.sent, false);
  check('and it says why', r.reason, 'no matchable identifiers on this payment');

  group('a rejection is raised, not swallowed');
  global.fetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { message: 'Invalid access token' } }),
  });
  let threw = '';
  try { await metacapi.purchase(payment()); } catch (e) { threw = e.message; }
  check('the reason is in the error', threw, 'Meta CAPI rejected the Purchase: Invalid access token');

  group('unset token is a no-op, never a crash');
  delete require.cache[modulePath];
  delete process.env.META_CAPI_TOKEN;
  const off = require(modulePath);
  r = await off.purchase(payment());
  check('not sent', r.sent, false);
  check('and it says why', r.reason, 'META_CAPI_TOKEN not configured');
  check('status reports it as off', off.status().enabled, false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
