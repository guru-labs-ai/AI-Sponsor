/* Guards the retry on inbound voice-note downloads. Run: node test-media-retry.js

   Aug 18 19:46:46, from the production log:

     [WhatsApp] Voice note from whatsapp:+9955XXXXXXX — transcribing...
     [WhatsApp] Error processing message: Request failed with status code 404

   Somebody sent their sponsor a voice note and got "I'm having a moment" back.
   The media was never missing: fetching that exact URL afterwards returns 200
   and 16676 bytes of audio. Twilio posts the webhook and publishes the media as
   two separate, unordered events, and we asked once, too early, and gave up.

   It is a race, so it passes every time you test it by hand. Two voice notes
   from the same person earlier in the same hour went through fine. That is
   exactly why it needs a test that can force the losing side.

   Read out of the shipped source rather than imported, since whatsapp.js pulls
   in the whole app at require time. Same trick as test-voice-choice.js. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, 'whatsapp.js'), 'utf8');
const a = src.indexOf('const MEDIA_RETRY_DELAYS');
const b = src.indexOf('/* ── Speech-to-text via OpenAI Whisper', a);
if (a === -1 || b === -1) throw new Error('test-media-retry: could not find downloadAudio in whatsapp.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

/* Builds a fresh copy of downloadAudio with a fake axios and a fake clock, so
   the real backoff schedule is exercised without six seconds of waiting. */
function build(responder) {
  const attempts = [];
  const waited = [];
  const axios = {
    get: async (url) => {
      attempts.push(url);
      return responder(attempts.length);
    },
  };
  const fakeTimers = { setTimeout: (fn, ms) => { waited.push(ms); fn(); } };
  const written = [];
  const fakeFs = { writeFileSync: (p, d) => written.push({ p, d }) };

  const fn = new Function(
    'axios', 'fs', 'os', 'path', 'console', 'setTimeout', 'process',
    `${src.slice(a, b)}; return downloadAudio;`
  )(axios, fakeFs, os, path, { log() {}, warn() {} }, fakeTimers.setTimeout,
    { env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' } });

  return { fn, attempts, waited, written };
}

const err = (status) => {
  const e = new Error(`Request failed with status code ${status}`);
  if (status !== null) e.response = { status };
  return e;
};
const okResponse = { data: Buffer.from('OggS fake audio') };

(async () => {
  group('THE INCIDENT: a 404 in the same second is a race, not a missing file');
  {
    const t = build((n) => { if (n === 1) throw err(404); return okResponse; });
    const out = await t.fn('https://api.twilio.com/media/1');
    check('recovered on the second attempt', t.attempts.length, 2);
    check('waited before retrying', t.waited, [400]);
    check('returned a path to the saved file', typeof out === 'string' && out.endsWith('.ogg'), true);
    check('wrote the audio to disk', t.written.length, 1);
  }

  group('it keeps trying across the whole backoff, then gives up honestly');
  {
    const t = build(() => { throw err(404); });
    let thrown = null;
    try { await t.fn('https://api.twilio.com/media/2'); } catch (e) { thrown = e; }
    check('five attempts in total', t.attempts.length, 5);
    check('the documented backoff', t.waited, [400, 800, 1600, 3200]);
    check('the real error is rethrown, not swallowed', thrown && thrown.response.status, 404);
    // Rethrowing matters: the handler above still sends the fallback message, so
    // a genuinely missing file is not turned into silence.
  }

  group('a slow publish still lands inside the budget');
  {
    const t = build((n) => { if (n < 4) throw err(404); return okResponse; });
    await t.fn('https://api.twilio.com/media/3');
    check('recovered on the fourth attempt', t.attempts.length, 4);
    check('after 2.8 seconds of waiting', t.waited.reduce((x, y) => x + y, 0), 2800);
  }

  group('credentials problems are NOT retried');
  // A 401 or 403 will not fix itself in 400ms, and hammering an authenticated
  // endpoint is how an account gets flagged. Fail fast and loudly instead.
  for (const status of [401, 403]) {
    const t = build(() => { throw err(status); });
    let thrown = null;
    try { await t.fn('https://api.twilio.com/media/4'); } catch (e) { thrown = e; }
    check(`${status} tried exactly once`, t.attempts.length, 1);
    check(`${status} never slept`, t.waited, []);
    check(`${status} propagated`, thrown && thrown.response.status, status);
  }

  group('server-side and network failures ARE retried');
  {
    const t = build((n) => { if (n === 1) throw err(500); return okResponse; });
    await t.fn('https://api.twilio.com/media/5');
    check('500 is retried', t.attempts.length, 2);
  }
  {
    // No `response` at all: DNS, socket reset, Render losing the network.
    const t = build((n) => { if (n === 1) throw err(null); return okResponse; });
    await t.fn('https://api.twilio.com/media/6');
    check('a bare network error is retried', t.attempts.length, 2);
  }

  group('the happy path is untouched');
  {
    const t = build(() => okResponse);
    await t.fn('https://api.twilio.com/media/7');
    check('one attempt', t.attempts.length, 1);
    check('no delay', t.waited, []);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
