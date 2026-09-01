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

/* ── Retention, appended 1 Sep ──────────────────────────────────────────────
   The policy promises the digest survives. If this ever purges the users row,
   somebody coming back after a year meets a stranger and we have broken a
   written commitment. Run: node test-deletion-sweep.js */
(async () => {
  let pass = 0, fail = 0;
  const check = (name, a, e) => {
    const ok = JSON.stringify(a) === JSON.stringify(e);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) console.log(`      expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    ok ? pass++ : fail++;
  };
  const stub = (rel, exports) => {
    const id = require.resolve(rel);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };

  const called = [];
  stub('./db.js', {
    enabled: true,
    retentionCandidates: async () => [{ user_id: 'wa-+15559990000', last_active: '2025-08-01' }],
    purgeMessagesOnly: async (id) => { called.push('purgeMessagesOnly:' + id); return { messages: 140, weeklies: 6 }; },
    purgeUserData: async (id) => { called.push('purgeUserData:' + id); },
    recordEvent: async (id, ev, detail) => { called.push('event:' + ev + ':' + detail.messages); },
    releaseStaleDeletions: async () => 0,
    claimDueDeletion: async () => null,
  });
  stub('./stripe.js', { cancelSubscription: async () => 'canceled', getSubscriptionStatus: async () => 'canceled' });
  stub('./ghl.js', { getContact: async () => ({ tags: [] }), removeTags: async () => {}, deleteContact: async () => true });

  process.env.RETENTION_SWEEP = 'on';
  delete require.cache[require.resolve('./deletion.js')];
  let d = require('./deletion.js');
  let out = await d.runRetentionSweep({ limit: 5 });

  check('purges an aged-out account', [out.purged, out.messages], [1, 140]);
  check('uses the narrow purge, never the full one', called.filter(c => c.startsWith('purge')), ['purgeMessagesOnly:wa-+15559990000']);
  check('records what was removed', called.filter(c => c.startsWith('event')), ['event:retention_purge:140']);
  check('default window is 12 months', d.RETENTION_MONTHS, 12);

  process.env.RETENTION_SWEEP = '';
  delete require.cache[require.resolve('./deletion.js')];
  d = require('./deletion.js');
  out = await d.runRetentionSweep({ limit: 5 });
  check('off unless switched on', out, { ok: false, reason: 'retention-disabled' });

  console.log(`\nretention: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
