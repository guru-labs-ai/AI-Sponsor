/* Answers one question and then gets out of the way: can we send a real
   WhatsApp voice note through Meta directly, on the number Twilio registered?

   Run:  node check-cloud-api.js
         node check-cloud-api.js --file some.ogg      # upload probe from a file
         node check-cloud-api.js --send +99512345678  # the real end-to-end test

   Needs META_WA_TOKEN and META_WA_WABA_ID in the environment. META_WA_PHONE_NUMBER_ID
   is discovered by step 2, so it does not have to be set the first time.

   This is a live probe, not a test suite. It is deliberately NOT named test-*
   so it never gets swept into a run of the offline suites.

   ⚠️ Steps 1 to 3 message nobody. Uploading media to Meta is a private
   operation: it stores a file and hands back an id. Step 4 sends to a real
   phone and only runs when you pass --send with a number, because the whole
   point of this product is that nothing surprising arrives on someone's
   phone. */
const fs = require('fs');
const metacloud = require('./metacloud');

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const sendTo = argOf('--send');
const fromFile = argOf('--file');

const ok = (m) => console.log(`  PASS  ${m}`);
const no = (m) => console.log(`  FAIL  ${m}`);
const note = (m) => console.log(`        ${m}`);
const head = (m) => console.log(`\n— ${m}`);

(async () => {
  console.log(`Graph ${metacloud.GRAPH_VERSION}, audio as "${metacloud.AUDIO_MIME}"`);

  // ── 1 + 2. Do we own this account, and can we see the number? ──────────────
  head('reading the WhatsApp Business Account');
  const pre = await metacloud.preflight();
  if (pre.errors.length) {
    pre.errors.forEach(no);
    note('If this is a permissions error, the token is missing whatsapp_business_management.');
    note('If it is "unsupported get request", the token cannot see this account at all.');
    process.exit(1);
  }
  ok(`account ${pre.waba.id} "${pre.waba.name}"`);

  head('the phone numbers on it');
  if (!pre.numbers.length) { no('no phone numbers visible on this account'); process.exit(1); }
  for (const n of pre.numbers) {
    ok(`${n.display_phone_number}  id=${n.id}`);
    note(`display name "${n.verified_name}" · name_status=${n.name_status} · quality=${n.quality_rating} · platform=${n.platform_type}`);
  }
  // name_status answers a second open question for free: whether the "AI Sponsor"
  // display name submitted in WhatsApp Manager has cleared Meta's review yet.

  const phoneId = metacloud.PHONE_NUMBER_ID || pre.numbers[0].id;
  if (!metacloud.PHONE_NUMBER_ID) {
    note(`META_WA_PHONE_NUMBER_ID is not set. Using ${phoneId} for the rest of this run.`);
    process.env.META_WA_PHONE_NUMBER_ID = phoneId;
  }

  // ── 3. THE CRUX. Can we act on a number Twilio registered? ─────────────────
  /* A media upload needs the same messaging permission on the same number that
     sending needs. If this passes, the integration is available to us and the
     only thing left is whether we want it. If it fails with a permission or
     ownership error, Twilio's registration has the number locked and the whole
     plan is dead, which is worth knowing in one command rather than after a day
     of building. */
  head('THE CRUX: can we act on this number, or has Twilio locked it');
  let audio = null;
  if (fromFile) {
    audio = fs.readFileSync(fromFile);
    note(`using ${fromFile} (${audio.length} bytes)`);
  } else if (process.env.XAI_API_KEY) {
    const voices = require('./voices');
    audio = await voices.synthesize("Hey. [breath] Testing one two.", 'carina');
    note(`synthesised a short line (${audio.length} bytes)`);
  } else {
    no('no audio to upload: set XAI_API_KEY, or pass --file path.ogg');
    note('Steps 1 and 2 passed, so the token can READ the account. The crux is still unanswered.');
    process.exit(1);
  }

  // Re-require so the module picks up META_WA_PHONE_NUMBER_ID if we just set it.
  delete require.cache[require.resolve('./metacloud')];
  const mc = require('./metacloud');

  let mediaId;
  try {
    mediaId = await mc.uploadAudio(audio);
    ok(`uploaded, media id ${mediaId}`);
    note('This is the answer. Meta accepted an upload on this number, so sending is available to us.');
  } catch (e) {
    no(e.message);
    note('If this is a permissions or ownership error, the number is locked to Twilio and the');
    note('hybrid is off. Fall back to asking Twilio to expose the flag.');
    process.exit(1);
  }

  // ── 4. The only step that reaches a human ─────────────────────────────────
  if (!sendTo) {
    head('not sending');
    note('Everything above messaged nobody. To finish the proof, run again with');
    note('  node check-cloud-api.js --send +YOURNUMBER');
    note('and look at what lands: a waveform and an avatar means it worked.');
    return;
  }

  head(`sending one voice note to ${sendTo}`);
  note('This reaches a real phone. It only runs because --send was passed.');
  try {
    const res = await mc.sendVoiceNote(sendTo, audio);
    ok(`sent, message id ${res.messageId}`);
    note('Now look at the phone. Waveform + avatar = a real voice note, and this is solved.');
    note('Flat seek line = it arrived as an audio file, and voice:true did not take.');
  } catch (e) {
    no(e.message);
    note('A 24-hour window error just means that number has not messaged the sponsor recently.');
    note('Send the sponsor a WhatsApp message first, then run this again.');
    process.exit(1);
  }
})().catch((e) => { console.error(`\nunexpected: ${e.stack || e.message}`); process.exit(1); });
