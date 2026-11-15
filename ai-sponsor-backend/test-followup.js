/* The sponsor texting first (followup.js). Offline: the database is a fake.
   Run: node test-followup.js

   What going wrong would look like:
   1. A message at 3am their time, or after WhatsApp's 24 hours, where it fails.
   2. A message to someone who is still talking, or a second one in a row.
   3. A message to someone whose deletion is pending, or who wiped the chat.
   4. The sponsor denying it can write first, right under a message it just wrote. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const followup = require('./followup');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); passed++; } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}
const H = 3600e3;
const localH = (zone, d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hour12: false }).format(d)) % 24;

(async () => {
  await check('due at least 8 hours later, inside their day, inside the 24-hour window, at every hour they might write', () => {
    for (const zone of ['Europe/London', 'America/New_York', 'Asia/Hong_Kong', 'America/Los_Angeles']) {
      for (let h = 0; h < 24; h++) {
        const last = new Date(Date.UTC(2026, 10, 16, h, 7));
        const due = followup.pickDueTime(last, zone);
        assert.ok(due, `${zone} ${h}:07 UTC has no slot`);
        const gap = (due - last) / H;
        assert.ok(gap >= 8 && gap <= 23, `${zone} ${h}:07 UTC -> ${gap}h`);
        const lh = localH(zone, due);
        assert.ok(lh >= 9 && lh < 21, `${zone} due at ${lh}:00 local`);
      }
    }
  });

  await check('an evening message gets one the next morning, a morning message the same evening', () => {
    // London, 22:00 -> +8h is 6am, so 9am next day.
    assert.strictEqual(followup.pickDueTime(new Date(Date.UTC(2026, 10, 16, 22, 0)), 'Europe/London').toISOString(), '2026-11-17T09:00:00.000Z');
    // London, 09:50 -> 17:50 the same day (with 12 hours this person had no slot at all).
    assert.strictEqual(followup.pickDueTime(new Date(Date.UTC(2026, 10, 16, 9, 50)), 'Europe/London').toISOString(), '2026-11-16T17:50:00.000Z');
  });

  await check('only WhatsApp people are planned for, and only on WhatsApp', async () => {
    const calls = [];
    const orig = db.planFollowup, origEnabled = db.enabled;
    db.planFollowup = async (...a) => { calls.push(a); };
    db.enabled = true;
    try {
      await followup.plan('reg-abc', { zone: 'Europe/London', channel: 'whatsapp' });
      await followup.plan('wa-+447700900000', { zone: 'Europe/London', channel: 'web' });
      await followup.plan('wa-+447700900000', { zone: 'Europe/London', channel: 'whatsapp', now: new Date(Date.UTC(2026, 10, 16, 22, 0)) });
    } finally { db.planFollowup = orig; db.enabled = origEnabled; }
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'wa-+447700900000');
    assert.strictEqual(new Date(calls[0][2]).toISOString(), '2026-11-17T09:00:00.000Z');
  });

  const now = new Date(Date.UTC(2026, 10, 17, 10, 0));
  const row = { user_id: 'wa-+447700900000', last_user_at: new Date(Date.UTC(2026, 10, 16, 22, 0)) };
  const quiet = { last_user_at: row.last_user_at, last_followup_at: null, last_outbound_at: null, deletion_pending: false };
  await check('writes to someone who went quiet, and to nobody else', () => {
    assert.strictEqual(followup.verdict(row, quiet, now), 'write');
    assert.strictEqual(followup.verdict(row, { ...quiet, deletion_pending: true }, now), 'deletion-pending');
    assert.strictEqual(followup.verdict(row, { ...quiet, last_user_at: new Date(Date.UTC(2026, 10, 17, 8, 0)) }, now), 'they-wrote-since');
    assert.strictEqual(followup.verdict(row, { ...quiet, last_followup_at: new Date(Date.UTC(2026, 10, 15, 12, 0)) }, now), 'too-soon-after-the-last-one');
    assert.strictEqual(followup.verdict(row, { ...quiet, last_outbound_at: new Date(Date.UTC(2026, 10, 17, 9, 0)) }, now), 'we-sent-something-else-recently');
    assert.strictEqual(followup.verdict(row, quiet, new Date(Date.UTC(2026, 10, 17, 22, 0))), 'window-closing');
  });

  await check('the sweep sends, saves it into the conversation, and records it; a skip sends nothing', async () => {
    const saved = { ...db };
    const finished = [], outbound = [], sent = [], after = [];
    Object.assign(db, {
      enabled: true,
      claimDueFollowups: async () => [row, { ...row, user_id: 'wa-+447700900001' }, { ...row, user_id: 'wa-+447700900002' }],
      followupGuards: async () => quiet,
      finishFollowup: async (u, s, n) => { finished.push([u, s, n]); },
      recordOutbound: async (u, id, kind) => { outbound.push([u, id, kind]); },
    });
    try {
      const r = await followup.runSweep({
        write: async (u) => (u.endsWith('0') ? { text: 'How did the call with the bank go?' } : u.endsWith('1') ? { skip: 'nothing natural to pick up' } : { text: 'x' }),
        send: async (phone, text) => { if (phone.endsWith('2')) throw new Error('(#131047) Re-engagement message'); sent.push([phone, text]); return { messageId: 'wamid.TEST' }; },
        after: async (u, t) => { after.push([u, t]); },
      }, { now });
      assert.deepStrictEqual([r.sent, r.skipped, r.failed], [1, 1, 1]);
      assert.deepStrictEqual(sent, [['+447700900000', 'How did the call with the bank go?']]);
      assert.deepStrictEqual(after, [['wa-+447700900000', 'How did the call with the bank go?']]);
      assert.deepStrictEqual(outbound, [['wa-+447700900000', 'wamid.TEST', 'followup']]);
      assert.deepStrictEqual(finished.map((f) => f[1]), ['sent', 'skipped', 'expired']);
    } finally { Object.assign(db, saved); }
  });

  const dbsrc = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
  const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  await check('the plan is a row that survives restarts, and is wiped with the person or their conversation', () => {
    assert.ok(/CREATE TABLE IF NOT EXISTS sponsor_followups/.test(dbsrc));
    assert.strictEqual((dbsrc.match(/DELETE FROM sponsor_followups WHERE user_id = \$1/g) || []).length, 2, 'purge and start-over');
    assert.ok(/FOR UPDATE SKIP LOCKED/.test(dbsrc), 'two sweeps can never claim the same person');
  });

  await check('every WhatsApp reply plans the next one, and the sweep runs', () => {
    assert.ok(/followup\.plan\(userId, \{ zone: userZone, now: new Date\(\), channel: context && context\.channel \}\)/.test(srv));
    assert.ok(/followup\.maybeSweep\(followupDeps\)/.test(srv) && /followup\.startInterval\(followupDeps\)/.test(srv));
  });

  await check('it reads as the sponsor thinking of them, and the sponsor no longer says it cannot write first', () => {
    assert.ok(/never as someone who read the chat or fixed something/.test(srv));
    assert.ok(/Never apologise for or comment on an earlier reply of yours/.test(srv));
    assert.ok(!/Right now you can't start a conversation, only continue one/.test(srv), 'the old line would deny the message it just sent');
    assert.ok(/You can write to them first, but only within a day of their last message/.test(srv));
    assert.ok(/our last first message is still unanswered/.test(srv), 'never a second message on top of an unanswered one');
  });

  console.log(`\n${failed ? 'FAILED' : 'All good'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
