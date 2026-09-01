/* The sweep's ordering, which is the part that can hurt somebody. Run:
   node test-deletion-sweep.js

   Stubs db/stripe/ghl through the require cache rather than mocking
   deleteUserIdentity, so the real orchestration runs and the test covers the
   thing that actually ships. No database: this must never be pointed at one.

   What is being protected, in order of how bad it would be:
   1. Telling somebody their data is gone when it is not.
   2. Reading their phone after the purge, so the confirmation goes nowhere.
   3. Purging the same person twice, or messaging them twice. */
const path = require('path');

function stub(rel, exports) {
  const id = require.resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

/* One person, on WhatsApp, with a subscription. The fake db forgets them the
   moment purgeUserData runs, exactly as the real one does. */
function makeWorld({ stripeStatus = 'canceled' } = {}) {
  const log = [];
  const users = {
    'wa-+15551234567': {
      user_id: 'wa-+15551234567', name: 'Sam Okafor',
      phone: '+15551234567', stripe_subscription_id: 'sub_1', ghl_contact_id: null,
    },
  };
  let due = [{ user_id: 'wa-+15551234567' }];
  const marks = [];
  const sent = [];

  stub('./db.js', {
    enabled: true,
    releaseStaleDeletions: async () => 0,
    claimDueDeletion: async () => { log.push('claim'); return due.shift() || null; },
    getUser: async (id) => { log.push('getUser'); return users[id] || null; },
    findAllIdentities: async (id) => [id],
    purgeUserData: async (id) => { log.push('purge'); delete users[id]; },
    markDeletionDone: async (id, status, note) => { log.push('mark:' + status); marks.push({ id, status, note }); },
  });
  stub('./stripe.js', {
    cancelSubscription: async () => { log.push('stripeCancel'); return stripeStatus; },
    getSubscriptionStatus: async () => stripeStatus,
  });
  stub('./ghl.js', { getContact: async () => ({ tags: [] }), removeTags: async () => {}, deleteContact: async () => true });

  const whatsapp = { sendTextReply: async (to, body) => { log.push('send'); sent.push({ to, body }); } };
  return { log, marks, sent, whatsapp };
}

function freshDeletion() {
  delete require.cache[require.resolve('./deletion.js')];
  return require('./deletion.js');
}

(async () => {
  // 1. Happy path.
  process.env.DELETION_SWEEP = 'on';
  let w = makeWorld();
  let out = await freshDeletion().runDeletionSweep({ limit: 5, whatsapp: w.whatsapp });
  check('completes one due request', [out.completed, out.stopped, out.failed], [1, 0, 0]);
  check('marked completed', w.marks.map((m) => m.status), ['completed']);
  check('phone read BEFORE the purge', w.log.indexOf('getUser') < w.log.indexOf('purge'), true);
  check('confirmation sent AFTER the purge', w.log.indexOf('send') > w.log.indexOf('purge'), true);
  check('confirmation went to their number', w.sent[0] && w.sent[0].to, 'whatsapp:+15551234567');
  check('confirmation uses their first name', /^Sam, /.test(w.sent[0].body), true);
  check('one message only', w.sent.length, 1);

  // 2. Stripe not confirmed cancelled: nothing deleted, nobody told.
  w = makeWorld({ stripeStatus: 'active' });
  out = await freshDeletion().runDeletionSweep({ limit: 5, whatsapp: w.whatsapp });
  check('stopped, not completed', [out.completed, out.stopped], [0, 1]);
  check('nothing purged', w.log.includes('purge'), false);
  check('nobody was told their data is gone', w.sent.length, 0);
  check('marked stopped with a reason', !!(w.marks[0] && w.marks[0].status === 'stopped' && w.marks[0].note), true);

  // 3. Off unless switched on. This is what stops a deploy purging anybody.
  process.env.DELETION_SWEEP = '';
  w = makeWorld();
  out = await freshDeletion().runDeletionSweep({ limit: 5, whatsapp: w.whatsapp });
  check('disabled by default', out, { ok: false, reason: 'sweep-disabled' });
  check('disabled sweep touches nothing', w.log.length, 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
