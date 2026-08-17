/* Guards the blue ticks. Run: node test-read-receipts.js

   Twilio has no standalone mark-as-read call for inbound WhatsApp. Read
   receipts arrive as a side effect of the typing-indicator endpoint, which is
   Public Beta and explicitly outside Twilio's SLA. That combination is worth a
   test: the request shape is a contract with somebody else's beta product, and
   if it drifts the only symptom is ticks quietly staying grey. Nothing breaks,
   nothing errors loudly, the product just feels a bit deader.

   Documented contract, from
   https://www.twilio.com/docs/whatsapp/api/typing-indicators-resource
     POST https://messaging.twilio.com/v3/Indicators/Typing.json
     basic auth, body {channel: "WHATSAPP", messageId: "SM… or MM…"}

   Runs the real markAsRead out of whatsapp.js with a stubbed axios, so the URL,
   body, auth and timeout are asserted against what actually ships. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, 'whatsapp.js'), 'utf8');
const a = src.indexOf('const TYPING_INDICATOR_URL');
const b = src.indexOf('/* ── Main entry point', a);
if (a === -1 || b === -1) throw new Error('test-read-receipts: could not find the markAsRead block in whatsapp.js');

process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
process.env.TWILIO_AUTH_TOKEN = 'test_token';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
  ok ? pass++ : fail++;
}

// Build markAsRead with an axios we control.
function build(onPost) {
  const axios = { post: (...args) => onPost(...args) };
  return new Function('axios', `${src.slice(a, b)}; return markAsRead;`)(axios);
}

(async () => {
  console.log('— the happy path sends exactly what Twilio documents');
  let seen = null;
  let markAsRead = build((url, body, cfg) => { seen = { url, body, cfg }; return Promise.resolve({ status: 200 }); });
  await markAsRead('SM1234567890abcdef1234567890abcdef');

  check('posts to the typing indicator endpoint',
    seen && seen.url, 'https://messaging.twilio.com/v3/Indicators/Typing.json');
  check('channel is WHATSAPP', seen && seen.body.channel, 'WHATSAPP');
  check('messageId is the inbound SID',
    seen && seen.body.messageId, 'SM1234567890abcdef1234567890abcdef');
  check('sends no stray body fields', seen && Object.keys(seen.body).sort().join(','), 'channel,messageId');
  check('authenticates with the account SID', seen && seen.cfg.auth.username, 'AC_test_sid');
  check('authenticates with the auth token', seen && seen.cfg.auth.password, 'test_token');
  check('has a timeout so a hung beta call cannot leak',
    seen && typeof seen.cfg.timeout === 'number' && seen.cfg.timeout > 0, true);

  console.log('\n— MM media SIDs count too (a voice note is where this matters most)');
  seen = null;
  markAsRead = build((url, body, cfg) => { seen = { url, body, cfg }; return Promise.resolve({ status: 200 }); });
  await markAsRead('MMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  check('MM SID is sent, not skipped', seen && seen.body.messageId, 'MMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  console.log('\n— nothing is sent when there is nothing to mark');
  for (const bad of [undefined, '', null, 'XX123', 'not-a-sid']) {
    let called = false;
    const m = build(() => { called = true; return Promise.resolve({}); });
    await m(bad);
    check(`no call for ${JSON.stringify(bad)}`, called, false);
  }

  console.log('\n— a failure is a rejected promise, never a thrown reply');
  // The call site is fire-and-forget with a .catch, so markAsRead must return a
  // promise that rejects rather than throwing synchronously. If it ever threw
  // sync, the whole webhook would die and the person would get no reply at all.
  const boom = build(() => Promise.reject(Object.assign(new Error('beta endpoint gone'), { response: { status: 503 } })));
  let threwSync = false;
  let rejected = false;
  try {
    await boom('SM1234567890abcdef1234567890abcdef').catch(() => { rejected = true; });
  } catch (e) { threwSync = true; }
  check('does not throw synchronously', threwSync, false);
  check('rejects so the call site .catch fires', rejected, true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
