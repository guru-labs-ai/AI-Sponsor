/* Guards the inbound Meta path and the rest of the Meta transport.
   Run: node test-metawebhook.js

   Offline. Nothing here touches the network: `fetch` is replaced so the exact
   requests can be inspected, and no webhook is ever received.

   WHY THESE PARTICULAR THINGS. This code runs on the day the number is
   registered to our own app, which is the day Twilio's webhook stops firing.
   Anything wrong here is not a degraded feature, it is somebody in recovery
   messaging their sponsor and getting nothing back. So the tests are aimed at
   the failures that would be silent rather than loud:

   1. THE IDENTITY KEY. Meta sends a bare E.164; everything downstream expects
      Twilio's "whatsapp:+…", which waUserId() turns into the "wa-" key the
      Jul 10 beta import used for all 58 phone-holding members. Drop the plus
      and every one of them silently becomes a brand-new stranger with no
      profile and no history, and the conversation still "works".
   2. SIGNATURE VERIFICATION. Without it anyone who finds the URL can put words
      in front of somebody's sponsor.
   3. ACKNOWLEDGING BEFORE PROCESSING. Meta retries a delivery it does not see
      acknowledged quickly, and a retry means the sponsor answers twice.
   4. THE WIRING. A correct module nobody calls is the obvious way for this to
      go wrong, and it is exactly how the Aug 18 voice-note fix "shipped"
      without ever running. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);
const src = (f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');

/* A real delivery, trimmed to the fields we read. */
const delivery = (messages, extra) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1511886417372375',
    changes: [{
      field: 'messages',
      value: Object.assign({
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '13073234467', phone_number_id: '1164530693420800' },
        contacts: [{ profile: { name: 'Test' }, wa_id: '995598785151' }],
        messages,
      }, extra || {}),
    }],
  }],
});

(async () => {
  process.env.META_WA_TOKEN = 'test-token';
  process.env.META_WA_PHONE_NUMBER_ID = '1164530693420800';
  process.env.META_WA_WABA_ID = '1511886417372375';
  process.env.META_APP_SECRET = 'test-app-secret';
  delete require.cache[require.resolve('./metacloud')];
  delete require.cache[require.resolve('./metawebhook')];
  const mc = require('./metacloud');
  const mw = require('./metawebhook');

  // ── The identity key ──────────────────────────────────────────────────────
  group('the identity key survives the carrier change');
  const text = mw.normalise(delivery([
    { from: '995598785151', id: 'wamid.ABC', timestamp: '1756060000', type: 'text', text: { body: 'hey' } },
  ]));
  check('one message parsed', text.length, 1);
  check('THE PLUS IS BACK ON', text[0].fromPhone, 'whatsapp:+995598785151');
  check('body carried', text[0].text, 'hey');
  check('wamid carried for the read receipt', text[0].wamid, 'wamid.ABC');
  check('not audio', text[0].isAudio, false);

  // A number arriving with formatting still has to key identically.
  const messy = mw.normalise(delivery([
    { from: '+995 598 785151', id: 'wamid.X', type: 'text', text: { body: 'hi' } },
  ]));
  check('formatting stripped, key identical', messy[0].fromPhone, 'whatsapp:+995598785151');

  // ── Voice notes ───────────────────────────────────────────────────────────
  group('voice notes');
  const audio = mw.normalise(delivery([
    { from: '995598785151', id: 'wamid.AUD', type: 'audio', audio: { id: '9988', mime_type: 'audio/ogg; codecs=opus', voice: true } },
  ]));
  check('flagged as audio', audio[0].isAudio, true);
  check('media id carried, not a url', audio[0].mediaId, '9988');
  check('mime carried', audio[0].mediaType, 'audio/ogg; codecs=opus');

  /* An audio message we cannot fetch must not look like audio, or the reply
     flow waits on a download that can never happen and the person gets the
     "I'm having a moment" fallback instead of an answer. */
  const brokenAudio = mw.normalise(delivery([
    { from: '995598785151', id: 'wamid.BAD', type: 'audio', audio: { mime_type: 'audio/ogg' } },
  ]));
  check('audio with no media id is not treated as audio', brokenAudio[0].isAudio, false);

  // ── Everything that is not somebody talking ───────────────────────────────
  group('deliveries that are not a message');
  check('status callbacks produce nothing to answer',
    mw.normalise({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.S', status: 'read' }] } }] }],
    }).length, 0);
  check('a foreign object is ignored', mw.normalise({ object: 'page', entry: [] }).length, 0);
  check('an empty body is ignored', mw.normalise(null).length, 0);
  check('a non-messages field is ignored',
    mw.normalise({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] }).length, 0);
  check('a message with no sender is skipped, not thrown',
    mw.normalise(delivery([{ id: 'wamid.NOFROM', type: 'text', text: { body: 'x' } }])).length, 0);

  /* One odd message must not take out the ones sitting beside it in the same
     delivery, which is the whole reason normalise() logs and continues. */
  const mixed = mw.normalise(delivery([
    { id: 'wamid.NOFROM', type: 'text', text: { body: 'dropped' } },
    { from: '995598785151', id: 'wamid.KEPT', type: 'text', text: { body: 'kept' } },
  ]));
  check('a bad entry does not take out its neighbours', mixed.length, 1);
  check('the good one survives', mixed[0].text, 'kept');

  group('several messages in one delivery are all answered');
  const many = mw.normalise(delivery([
    { from: '995598785151', id: 'wamid.1', type: 'text', text: { body: 'one' } },
    { from: '995598785151', id: 'wamid.2', type: 'text', text: { body: 'two' } },
  ]));
  check('both parsed', many.map((m) => m.text), ['one', 'two']);

  group('an unsupported type is carried, not guessed at');
  const img = mw.normalise(delivery([
    { from: '995598785151', id: 'wamid.IMG', type: 'image', image: { id: '5' } },
  ]));
  check('type preserved', img[0].type, 'image');
  check('not treated as audio', img[0].isAudio, false);
  check('no text invented', img[0].text, '');

  // ── The handshake ─────────────────────────────────────────────────────────
  group('the verification handshake');
  process.env.META_WA_VERIFY_TOKEN = 'correct-horse';
  const q = (o) => ({ query: o, headers: {} });
  check('the challenge is echoed back',
    mw.handleVerification(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'correct-horse', 'hub.challenge': '31415' })),
    { status: 200, body: '31415' });
  check('a wrong token is refused',
    mw.handleVerification(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })).status, 403);
  check('a wrong mode is refused',
    mw.handleVerification(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'correct-horse' })).status, 403);
  delete process.env.META_WA_VERIFY_TOKEN;
  check('unconfigured says so rather than passing',
    mw.handleVerification(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x' })).status, 500);
  process.env.META_WA_VERIFY_TOKEN = 'correct-horse';

  // ── Signatures ────────────────────────────────────────────────────────────
  group('webhook signatures (production rules)');
  const wasEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const raw = Buffer.from(JSON.stringify(delivery([
    { from: '995598785151', id: 'wamid.SIG', type: 'text', text: { body: 'hi' } },
  ])));
  const sign = (buf, secret) => 'sha256=' + crypto.createHmac('sha256', secret || 'test-app-secret').update(buf).digest('hex');

  check('a correctly signed body passes',
    mw.validateSignature({ headers: { 'x-hub-signature-256': sign(raw) }, rawBody: raw }), true);
  check('a tampered body fails',
    mw.validateSignature({ headers: { 'x-hub-signature-256': sign(raw) }, rawBody: Buffer.from(raw.toString().replace('hi', 'no')) }), false);
  check('the wrong secret fails',
    mw.validateSignature({ headers: { 'x-hub-signature-256': sign(raw, 'other') }, rawBody: raw }), false);
  check('no header fails', mw.validateSignature({ headers: {}, rawBody: raw }), false);
  check('a non-sha256 header fails',
    mw.validateSignature({ headers: { 'x-hub-signature-256': 'sha1=abc' }, rawBody: raw }), false);
  /* timingSafeEqual throws on a length mismatch rather than returning false, so
     a short signature must be rejected by us before it reaches crypto. */
  check('a short signature is refused, not thrown',
    mw.validateSignature({ headers: { 'x-hub-signature-256': 'sha256=abcd' }, rawBody: raw }), false);
  check('a missing raw body fails rather than passing blind',
    mw.validateSignature({ headers: { 'x-hub-signature-256': sign(raw) } }), false);
  process.env.NODE_ENV = wasEnv;

  // ── The outbound half ─────────────────────────────────────────────────────
  group('sending text through Meta');
  const realFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, opts) => {
    seen = { url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.OUT' }] }) };
  };
  const sent = await mc.sendText('whatsapp:+995598785151', 'take your time');
  check('posts to the number id', /1164530693420800\/messages$/.test(seen.url), true);
  check('recipient is bare digits', seen.body.to, '995598785151');
  check('type is text', seen.body.type, 'text');
  check('the words are the words', seen.body.text.body, 'take your time');
  check('message id returned', sent.messageId, 'wamid.OUT');
  check('an empty body is refused before it reaches Meta',
    await mc.sendText('whatsapp:+1', '   ').then(() => 'sent', (e) => /empty/.test(e.message)), true);

  group('read receipts, which Twilio never had');
  seen = null;
  await mc.markRead('wamid.ABC');
  check('status is read', seen.body.status, 'read');
  check('names the message', seen.body.message_id, 'wamid.ABC');
  check('the typing indicator rides along', seen.body.typing_indicator, { type: 'text' });
  seen = null;
  await mc.markRead('SM1234567890');
  check('a Twilio SID is refused rather than posted to Meta', seen, null);
  seen = null;
  await mc.markRead(null);
  check('no id does nothing', seen, null);

  group('inbound media is fetched with the token, in two steps');
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, auth: (opts && opts.headers && opts.headers.Authorization) || null });
    if (calls.length === 1) return { ok: true, status: 200, json: async () => ({ url: 'https://lookaside.fb/x', mime_type: 'audio/ogg' }) };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const got = await mc.downloadMedia('9988');
  check('looks the id up first', /\/9988$/.test(calls[0].url), true);
  check('then fetches the real url', calls[1].url, 'https://lookaside.fb/x');
  check('the download is authenticated too', calls[1].auth, 'Bearer test-token');
  check('bytes come back', got.bytes, 3);
  global.fetch = realFetch;

  // ── The wiring ────────────────────────────────────────────────────────────
  group('whatsapp.js actually uses the Meta path');
  const wa = src('whatsapp.js');
  check('reads the handed-over message', wa.includes('req.metaMessage'), true);
  check('skips Twilio signature checks on a Meta request',
    /if \(!viaMeta && !validateTwilioSignature\(req\)\)/.test(wa), true);
  check('read receipts route on the id shape', /\/\^wamid\\\./.test(wa) && wa.includes('metacloud.markRead'), true);
  check('inbound audio is fetched by media id', wa.includes('metacloud.downloadMedia(mediaId)'), true);
  check('text goes through Meta once the number has moved',
    wa.includes('if (metacloud.outbound)') && wa.includes('metacloud.sendText(toPhone, body'), true);
  /* Listening and sending MUST be separate switches. If mounting the webhook
     also flipped replies to Meta, the only way to let Meta verify the callback
     URL would be to break every text reply on a live product first. */
  check('sending is NOT gated on the inbound flag',
    wa.includes('if (metacloud.inbound)'), false);
  check('the two flags are independent in metacloud',
    /META_WA_INBOUND/.test(src('metacloud.js')) && /META_WA_OUTBOUND/.test(src('metacloud.js')), true);
  check('the Twilio path is still there as the pre-migration default',
    wa.includes('requireTwilio().messages.create'), true);
  /* The module has to survive being loaded on a host with no Twilio variables,
     which is the end state of this migration. An unguarded twilio() constructor
     throws at require time and takes the web chat down with it. */
  check('the Twilio client is only constructed when there are credentials',
    /const twilioClient = process\.env\.TWILIO_ACCOUNT_SID\s*\?/.test(wa), true);
  check('a send with no Twilio client says why in words',
    wa.includes('Twilio is not configured on this host'), true);

  group('server.js mounts it safely');
  const sv = src('server.js');
  check('mounted only behind the flag', sv.includes("process.env.META_WA_INBOUND === '1'"), true);
  check('the verification GET exists', sv.includes("app.get('/api/whatsapp/meta-webhook'"), true);
  /* The raw body must be captured by the GLOBAL parser. A verify hook on the
     Meta route itself is silently skipped, because the global express.json()
     has already consumed the stream, and every correctly signed delivery then
     returns 403. Found by testing it live rather than by reading it. */
  check('the raw body is kept by the global parser',
    /app\.use\(express\.json\(\{ verify: \(req, _res, buf\) => \{ req\.rawBody = buf; \} \}\)\)/.test(sv), true);
  check('the Meta route does not add a second parser that would be skipped',
    /meta-webhook',\s+async \(req, res\)/.test(sv), true);
  check('the signature is checked before anything is processed',
    sv.indexOf('validateSignature') < sv.indexOf('metawebhook.normalise'), true);
  check('Meta is acknowledged BEFORE the reply is worked on',
    sv.indexOf("res.status(200).send('EVENT_RECEIVED')") < sv.indexOf('metawebhook.normalise'), true);
  check('the shared handler is used, not a second copy of the reply logic',
    sv.includes('whatsapp\n          .handleIncomingMessage({ metaMessage }'), true);

  group('none of this is on yet');
  delete require.cache[require.resolve('./metacloud')];
  const before = process.env.META_WA_INBOUND;
  delete process.env.META_WA_INBOUND;
  delete require.cache[require.resolve('./metacloud')];
  check('inbound is off without the flag', require('./metacloud').inbound, false);
  if (before !== undefined) process.env.META_WA_INBOUND = before;

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
