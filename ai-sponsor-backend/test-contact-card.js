/* Guards the contact card. Run: node test-contact-card.js

   Offline by default: `fetch` is replaced so the exact request can be inspected
   and nothing reaches a real phone.

   To actually deliver one to yourself:
       META_WA_TOKEN=... META_WA_PHONE_NUMBER_ID=... \
       node test-contact-card.js --send +1XXXXXXXXXX "AI Sponsor"

   WHY IT IS WORTH TESTING. The card exists to fix the top line of somebody's
   WhatsApp header, and the top line comes from their own address book, so the
   only proof that any of this works is a real phone showing a real name. The
   spec has been right and the behaviour wrong three times on this product
   already. The offline half checks we send what Meta documents; the --send half
   is the only half that proves anything. */

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}

(async () => {
  if (sendIdx !== -1) {
    /* The real thing. Needs a live token and reaches an actual handset. */
    const to = args[sendIdx + 1];
    const cardName = args[sendIdx + 2] || 'AI Sponsor';
    if (!to) { console.error('--send needs a phone number'); process.exit(1); }

    const metacloud = require('./metacloud');
    if (!metacloud.enabled) {
      console.error('META_WA_TOKEN / META_WA_PHONE_NUMBER_ID are not set, nothing to send with');
      process.exit(1);
    }
    console.log(`Our number:  ${await metacloud.selfPhoneNumber()}`);
    console.log(`Sending "${cardName}" to ${to} ...`);
    const res = await metacloud.sendContactCard(to, cardName);
    console.log(`Sent. message id: ${res.messageId}`);
    console.log('\nNow check the handset: tap the card, save it, and confirm the');
    console.log('chat header top line changes to the name on the card.');
    return;
  }

  /* Offline. Swap fetch out before requiring metacloud so nothing can escape. */
  process.env.META_WA_TOKEN = process.env.META_WA_TOKEN || 'test-token';
  process.env.META_WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID || '1164530693420800';
  process.env.META_WA_CONTACT_NUMBER = '+1 307-323-4467';

  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url: String(url), body: JSON.parse(options.body) };
    return {
      ok: true, status: 200,
      json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
      text: async () => '{"messages":[{"id":"wamid.TEST"}]}',
    };
  };

  const metacloud = require('./metacloud');

  console.log('\n— the payload Meta receives');
  await metacloud.sendContactCard('+15551234567', 'AI Sponsor');
  const c = captured.body.contacts[0];

  check('message type is contacts', captured.body.type, 'contacts');
  check('formatted_name carries the name', c.name.formatted_name, 'AI Sponsor');
  check('first_name is set too (Meta rejects name-less cards)', c.name.first_name, 'AI Sponsor');
  check('the card points at OUR number', c.phones[0].phone, '+13073234467');
  check('wa_id is bare digits, so the card opens a chat', c.phones[0].wa_id, '13073234467');
  check('recipient is bare digits, as Meta wants', captured.body.to, '15551234567');

  console.log('\n— the name is never invented');
  for (const empty of ['', '   ', null, undefined]) {
    let threw = false;
    try { await metacloud.sendContactCard('+15551234567', empty); } catch (e) { threw = true; }
    check(`refuses to send with name ${JSON.stringify(empty)}`, threw, true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
