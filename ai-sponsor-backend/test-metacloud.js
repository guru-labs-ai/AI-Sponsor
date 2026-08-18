/* Guards the Meta voice-note path. Run: node test-metacloud.js

   Offline. Nothing here touches the network: `fetch` is replaced so the exact
   requests can be inspected. That matters more than usual, because the whole
   feature is one boolean in one JSON body, and the failure mode of getting it
   wrong is silent. The message still sends, still plays, and still looks like
   the audio file we were already sending. Nobody would notice for a week.

   What is locked down here:
   1. `voice: true` is present on the audio object. This is the feature.
   2. The upload declares `audio/ogg; codecs=opus` and NOT the bare `audio/ogg`.
      The bare type is a documented rejection, and stripping that parameter is
      precisely what Twilio does to us.
   3. The module is inert until both env vars are set, so deploying it changes
      nothing.
   4. whatsapp.js tries Meta before Twilio and falls back rather than failing.
      A correct module nobody calls is the obvious way for this to go wrong. */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);
const src = (f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');

(async () => {
  group('inert until it is configured');
  delete require.cache[require.resolve('./metacloud')];
  check('disabled with no env vars', require('./metacloud').enabled, false);

  process.env.META_WA_TOKEN = 'test-token';
  process.env.META_WA_PHONE_NUMBER_ID = '111222333';
  process.env.META_WA_WABA_ID = '1511886417372375';
  delete require.cache[require.resolve('./metacloud')];
  const mc = require('./metacloud');
  check('enabled once both are set', mc.enabled, true);

  group('the recipient is normalised to what Meta expects');
  // Everything upstream speaks Twilio's dialect; Meta wants bare digits.
  check('twilio prefix stripped', mc.toE164('whatsapp:+16193140675'), '16193140675');
  check('plain E.164', mc.toE164('+995598785151'), '995598785151');
  check('spaces and dashes', mc.toE164('whatsapp:+1 307-323-4467'), '13073234467');
  check('undefined is survivable', mc.toE164(undefined), '');

  group('the two requests, captured off a fake fetch');
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith('/media')
        ? { id: 'MEDIA-1' }
        : { messages: [{ id: 'wamid.TEST' }] }),
    };
  };

  let sent = null, threw = null;
  try {
    sent = await mc.sendVoiceNote('whatsapp:+16193140675', Buffer.from('OggS-not-really'));
  } catch (e) {
    threw = e;
  }
  global.fetch = realFetch;

  if (threw) { console.log(`FAIL  sendVoiceNote threw: ${threw.message}`); fail++; }

  const upload = calls[0] || { options: { headers: {} } };
  const send = calls[1] || { options: {} };

  check('two requests were made', calls.length, 2);
  check("upload goes to the number's media endpoint",
    /\/v\d+\.\d+\/111222333\/media$/.test(upload.url || ''), true);
  check("send goes to the number's messages endpoint",
    /\/v\d+\.\d+\/111222333\/messages$/.test(send.url || ''), true);
  check('authorised as a bearer token', upload.options.headers.Authorization, 'Bearer test-token');

  group('THE FEATURE: voice: true');
  const body = JSON.parse(send.options.body || '{}');
  check('voice is true', body.audio && body.audio.voice, true);
  check('the uploaded media id is used', body.audio && body.audio.id, 'MEDIA-1');
  check('type is audio', body.type, 'audio');
  check('messaging_product is whatsapp', body.messaging_product, 'whatsapp');
  check('recipient is bare digits', body.to, '16193140675');
  check('the message id comes back', sent && sent.messageId, 'wamid.TEST');

  group('THE OTHER HALF: the mime type keeps its codecs parameter');
  // Bare audio/ogg is a documented rejection, and it is exactly what Twilio
  // leaves us with. If this ever regresses the send starts failing with an
  // unsupported-media error that reads like a Meta outage.
  check('constant carries codecs=opus', mc.AUDIO_MIME, 'audio/ogg; codecs=opus');
  check('source never declares the bare type', /['"]audio\/ogg['"]/.test(src('metacloud.js')), false);

  group('a Meta error comes back readable, not as "request failed"');
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: 131053, message: 'Unsupported MIME type', error_subcode: 2494008 } }),
  });
  let msg = '';
  try { await mc.sendVoiceNote('whatsapp:+1', Buffer.from('x')); } catch (e) { msg = e.message; }
  global.fetch = realFetch;
  check('carries Meta\'s own words', /131053/.test(msg) && /Unsupported MIME type/.test(msg), true);

  group('whatsapp.js actually calls it, and falls back if it fails');
  const wa = src('whatsapp.js');
  check('requires the module', wa.includes("require('./metacloud')"), true);
  check('guarded on enabled', wa.includes('if (metacloud.enabled)'), true);
  check('calls sendVoiceNote', wa.includes('metacloud.sendVoiceNote(toPhone'), true);
  check('a failure is caught, not thrown', /catch \(metaErr\)[\s\S]{0,240}falling back to Twilio/.test(wa), true);
  check('Meta is tried before the Twilio media URL is built',
    wa.indexOf('metacloud.sendVoiceNote') < wa.indexOf('const publicAudioUrl'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
