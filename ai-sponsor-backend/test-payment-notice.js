/* Exercises the "your payment went through" notice without a database, a Meta
   token or a running server. Same shape as test-trial-ending.js: the risk is
   the branching (inside or outside the 24-hour window, a Stripe retry arriving
   twice, a $0 invoice), not the three sentences.
   Run: node test-payment-notice.js */
const p = require('./paymentnotice');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${e}\n      actual:   ${a}`);
  ok ? pass++ : fail++;
}

function fakeDb({ lastAt = null, events = [] } = {}) {
  const recorded = [];
  return {
    recorded,
    getLastMessageAt: async () => lastAt,
    getEvents: async () => events,
    getOrCreateSettingsToken: async () => 'TOK',
    recordEvent: async (uid, event, detail) => { recorded.push({ uid, event, detail }); },
    recordOutbound: async () => {},
  };
}
function fakeWhatsapp({ throws = null } = {}) {
  const sent = [];
  return { sent, sendTextReply: async (to, body) => { if (throws) throw new Error(throws); sent.push({ to, body }); return { messageId: 'wamid.text' }; } };
}
function fakeMeta() {
  const sent = [];
  return { sent, enabled: true,
    sendTemplate: async (to, name, params, url) => { sent.push({ to, name, params, url }); return { messageId: 'wamid.tpl' }; },
    getTemplateStatus: async () => ({ status: 'APPROVED', category: 'UTILITY' }),
  };
}
const user = { user_id: 'reg-1', name: 'Lindsay Jacobi', phone: '+15550000447' };
const base = { user, invoiceId: 'in_1', amount: 500, currency: 'usd', plan: 'monthly', siteUrl: 'https://getaisponsor.com', now: new Date(Date.UTC(2026, 10, 19, 4, 0)) };

(async () => {
  console.log('— the words');
  check('dollars', p.formatAmount(500, 'usd'), '$5.00');
  check('annual price', p.formatAmount(4900, 'usd'), '$49.00');
  check('other currencies keep their code', p.formatAmount(450, 'eur'), '4.50 EUR');
  check('$0 is not a payment', [p.formatAmount(0), p.formatAmount(null)], [null, null]);
  check('plan words', [p.planWord('monthly'), p.planWord('annual'), p.planWord('year'), p.planWord('')], ['monthly', 'annual', 'annual', 'AI Sponsor']);
  const b = p.paymentBody({ first: 'Lindsay', amount: '$5.00', plan: 'monthly', link: 'L' });
  check('the note says what, how it shows, and how to cancel', [
    b.startsWith('Lindsay, quick note about your account, not a message from your sponsor.'),
    b.includes('Your AI Sponsor payment of $5.00 for the monthly plan went through today.'),
    b.includes('It may show on your card statement under GURU LABS.'),
    b.includes('To change your plan or cancel, tap here:\n\nL'),
  ], [true, true, true, true]);

  console.log('— who gets what');
  {
    const db = fakeDb({ lastAt: new Date(Date.now() - 3600e3) }), wa = fakeWhatsapp(), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, db, whatsapp: wa, metacloud: mc });
    check('inside the 24-hour window: a plain message, with their settings link', [r, wa.sent.length, wa.sent[0].body.includes('ai-sponsor-settings.html?t=TOK#plan'), mc.sent.length], [{ sent: true, via: 'text' }, 1, true, 0]);
    check('and it is recorded against the invoice', db.recorded.map((x) => [x.event, x.detail.invoiceId, x.detail.via]), [['payment_notified', 'in_1', 'text']]);
  }
  {
    const db = fakeDb({ lastAt: new Date(Date.now() - 40 * 86400e3) }), wa = fakeWhatsapp(), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, db, whatsapp: wa, metacloud: mc });
    check('outside the window: the template, never a text that Meta would drop', [r, wa.sent.length, mc.sent.length], [{ sent: true, via: 'template' }, 0, 1]);
    check('template name, its four values and the button link', [mc.sent[0].name, mc.sent[0].params, mc.sent[0].url], ['payment_received', ['Lindsay', '$5.00', 'monthly', '19 November'], 'TOK#plan']);
  }
  {
    const db = fakeDb({ lastAt: null }), wa = fakeWhatsapp(), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, user: { ...user, name: '' }, db, whatsapp: wa, metacloud: mc });
    check('never wrote on WhatsApp, no name: template, with "there"', [r.via, mc.sent[0].params[0]], ['template', 'there']);
  }
  {
    const db = fakeDb({ lastAt: new Date(Date.now() - 3600e3) }), wa = fakeWhatsapp({ throws: 'Meta error 131047: outside window' }), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, db, whatsapp: wa, metacloud: mc });
    check('a text refused as outside the window falls back to the template', r, { sent: true, via: 'template' });
  }
  {
    const db = fakeDb({ events: [{ event: 'payment_notified', detail: { invoiceId: 'in_1' } }] }), wa = fakeWhatsapp(), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, db, whatsapp: wa, metacloud: mc });
    check('Stripe sends the same invoice again: nothing goes out twice', [r, wa.sent.length, mc.sent.length], [{ sent: false, reason: 'already-sent' }, 0, 0]);
  }
  {
    const db = fakeDb({ events: [{ event: 'payment_notified', detail: { invoiceId: 'in_0' } }], lastAt: new Date(Date.now() - 3600e3) }), wa = fakeWhatsapp(), mc = fakeMeta();
    const r = await p.notifyPayment({ ...base, invoiceId: 'in_2', db, whatsapp: wa, metacloud: mc });
    check('next month is a new invoice, so it gets its own note', r.sent, true);
  }
  {
    const db = fakeDb(), wa = fakeWhatsapp(), mc = fakeMeta();
    check('$0 trial invoice: nothing', await p.notifyPayment({ ...base, amount: 0, db, whatsapp: wa, metacloud: mc }), { sent: false, reason: 'no-charge' });
    check('no phone at all: nothing, and says why', await p.notifyPayment({ ...base, user: { user_id: 'reg-2', name: 'X' }, db, whatsapp: wa, metacloud: mc }), { sent: false, reason: 'no-phone' });
    check('a wa- id is its own phone number', (await p.notifyPayment({ ...base, user: { user_id: 'wa-+15550001111', name: 'Y' }, db, whatsapp: wa, metacloud: mc })).sent, true);
  }
  {
    const db = fakeDb({ lastAt: new Date(Date.now() - 40 * 86400e3) }), wa = fakeWhatsapp();
    const mc = { enabled: true, sendTemplate: async () => { throw new Error('template not approved'); }, getTemplateStatus: async () => ({ status: 'APPROVED', category: 'UTILITY' }) };
    const r = await p.notifyPayment({ ...base, db, whatsapp: wa, metacloud: mc });
    check('template refused: recorded as failed, never thrown at the webhook', [r, db.recorded.map((x) => x.event)], [{ sent: false, reason: 'outside-24h' }, ['payment_notify_failed']]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
