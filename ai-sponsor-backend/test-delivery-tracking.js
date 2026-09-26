/* Guards the delivery receipts and page-open tracking added 26 Sep 2026.
   Run: node test-delivery-tracking.js

   Offline. No database, no network. The SQL itself is checked separately
   against a real throwaway Postgres (see the comment at the bottom).

   WHY THESE PARTICULAR THINGS. The point of this is to answer, for the weekly
   review and the trial notice, "did it arrive and did anybody open it". The
   ways it goes quietly wrong:

   1. A STATUS CALLBACK NOBODY READS. Meta reports sent / delivered / read /
      failed for every message we send. normalise() has always thrown these
      away, which is the whole reason "delivered" only meant "Meta accepted it".
   2. A PHONE NUMBER IN A METRICS TABLE. recipient_id in a status is the
      person's number. It must not survive parsing.
   3. RECORDING BREAKING A SEND. Tracking is fire and forget. A database that
      is down, or a stub with no such method, must never turn a delivered
      reminder into a failed one, and a billing notice must never be sent twice
      because a bookkeeping call threw.
   4. THE WIRING. A correct parser nobody calls, and a new user-scoped table
      that purgeUserData forgets, are the two easy ways for this to ship
      "working" while doing nothing or while keeping what it promised to erase. */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${name}\n   got      ${a}\n   expected ${e}`); }
}
const ok = (name, cond) => check(name, !!cond, true);

const mw = require('./metawebhook');

const wrap = (value) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value }] }],
});

/* ── Parsing what Meta reports ─────────────────────────────────────────────── */

{
  const body = wrap({
    messaging_product: 'whatsapp',
    statuses: [
      { id: 'wamid.A', status: 'sent', timestamp: '1790000001', recipient_id: '19739780447' },
      { id: 'wamid.A', status: 'delivered', timestamp: '1790000002', recipient_id: '19739780447' },
      { id: 'wamid.A', status: 'read', timestamp: '1790000009', recipient_id: '19739780447' },
      { id: 'wamid.B', status: 'failed', timestamp: '1790000003', recipient_id: '19739780447',
        errors: [{ code: 131047, title: 'Re-engagement message', message: 'More than 24 hours have passed' }] },
    ],
  });
  const s = mw.normaliseStatuses(body);
  check('all four statuses are read', s.map((x) => x.status), ['sent', 'delivered', 'read', 'failed']);
  check('ids come through', s.map((x) => x.wamid), ['wamid.A', 'wamid.A', 'wamid.A', 'wamid.B']);
  check('the timestamp is a number of seconds', s[1].timestamp, 1790000002);
  check('a failure carries Meta\'s code', s[3].errorCode, 131047);
  check('and its plain title', s[3].errorTitle, 'Re-engagement message');
  check('a delivery has no error', [s[1].errorCode, s[1].errorTitle], [null, null]);
  ok('the recipient phone number never survives parsing', !JSON.stringify(s).includes('19739780447'));
  ok('and no record has a recipient field at all', s.every((x) => !('recipient_id' in x) && !('recipientId' in x)));
}

check('a payload with only messages yields no statuses',
  mw.normaliseStatuses(wrap({ messages: [{ from: '1', id: 'wamid.M', type: 'text', text: { body: 'hi' } }] })), []);
check('garbage in, empty out', mw.normaliseStatuses(null), []);
check('another object type is ignored', mw.normaliseStatuses({ object: 'page', entry: [] }), []);
check('a non-messages field is ignored',
  mw.normaliseStatuses({ object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'account_update', value: { statuses: [{ id: 'x', status: 'read' }] } }] }] }), []);
check('an unknown status is skipped, not thrown on',
  mw.normaliseStatuses(wrap({ statuses: [{ id: 'wamid.Z', status: 'deleted' }, { id: 'wamid.Y', status: 'read', timestamp: '5' }] }))
    .map((x) => x.wamid), ['wamid.Y']);
check('a status with no id is skipped',
  mw.normaliseStatuses(wrap({ statuses: [{ status: 'read' }, null] })), []);
{
  const long = 'x'.repeat(900);
  const s = mw.normaliseStatuses(wrap({ statuses: [{ id: 'w', status: 'failed', errors: [{ code: 1, title: long }] }] }));
  check('an enormous error title is cut to something a table can hold', s[0].errorTitle.length, 200);
}

/* The existing behaviour must not change: a status-only delivery still yields
   no INCOMING messages, or every read receipt would be answered as if the
   person had spoken. */
check('normalise() still ignores a status-only delivery',
  mw.normalise(wrap({ statuses: [{ id: 'wamid.A', status: 'read', timestamp: '1' }] })), []);

/* ── Recording what we send, without ever breaking the send ────────────────── */

const trial = require('./trialnotice');
const baseTrial = {
  user: { user_id: 'reg-abc', name: 'Lindsay Jacobi', phone: '+19739780447' },
  trialEndUnix: Date.UTC(2026, 8, 29, 3, 49) / 1000,
  siteUrl: 'https://getaisponsor.com',
};
const stubDb = (extra = {}) => {
  const events = [];
  return Object.assign({
    events,
    getEvents: async () => events,
    getOrCreateSettingsToken: async () => 'tok123',
    recordEvent: async (uid, event, detail) => { events.push({ event, detail }); },
  }, extra);
};
const templater = (id = 'wamid.T') => ({
  enabled: true,
  sendTemplate: async () => (id ? { messageId: id } : {}),
});

(async () => {
  // Free text inside the window.
  {
    const recorded = [];
    const db = stubDb({ recordOutbound: async (...a) => { recorded.push(a); } });
    const whatsapp = { sendTextReply: async () => ({ messageId: 'wamid.TXT' }) };
    const r = await trial.notifyTrialEnding({ ...baseTrial, db, whatsapp, metacloud: templater() });
    check('the notice still reports it sent as text', r, { sent: true, via: 'text' });
    check('and the message id is recorded against the person, as a trial notice, via text',
      recorded, [['reg-abc', 'wamid.TXT', 'trial_ending', 'text']]);
  }

  // Outside the window, so the template goes.
  {
    const recorded = [];
    const db = stubDb({ recordOutbound: async (...a) => { recorded.push(a); } });
    const whatsapp = { sendTextReply: async () => { throw new Error('Meta 400 (131047): outside window'); } };
    const r = await trial.notifyTrialEnding({ ...baseTrial, db, whatsapp, metacloud: templater('wamid.TPL') });
    check('a template send is still reported as one', r, { sent: true, via: 'template' });
    check('and its id is recorded as a template', recorded, [['reg-abc', 'wamid.TPL', 'trial_ending', 'template']]);
  }

  // Nothing to record: Twilio result, or a template with no id.
  {
    const recorded = [];
    const db = stubDb({ recordOutbound: async (...a) => { recorded.push(a); } });
    const whatsapp = { sendTextReply: async () => ({ sid: 'SM123' }) };
    await trial.notifyTrialEnding({ ...baseTrial, db, whatsapp, metacloud: templater() });
    check('a result with no Meta id records nothing', recorded, []);
    const db2 = stubDb({ recordOutbound: async (...a) => { recorded.push(a); } });
    const w2 = { sendTextReply: async () => { throw new Error('131047'); } };
    const r2 = await trial.notifyTrialEnding({ ...baseTrial, db: db2, whatsapp: w2, metacloud: templater(null) });
    check('a template that returns no id still counts as sent', r2, { sent: true, via: 'template' });
    check('and records nothing', recorded, []);
  }

  // Bookkeeping must never break a billing notice.
  {
    const whatsapp = { sendTextReply: async () => ({ messageId: 'wamid.OK' }) };
    const failing = stubDb({ recordOutbound: async () => { throw new Error('database is down'); } });
    const r = await trial.notifyTrialEnding({ ...baseTrial, db: failing, whatsapp, metacloud: templater() });
    check('a recording failure does not fail the notice', r, { sent: true, via: 'text' });
    const noMethod = stubDb();
    const r2 = await trial.notifyTrialEnding({ ...baseTrial, db: noMethod, whatsapp, metacloud: templater() });
    check('a db without the method is fine too', r2, { sent: true, via: 'text' });
    check('and the once-only guard still recorded the send', failing.events.map((e) => e.event), ['trial_ending_notified']);
  }

  /* ── The wiring, checked in the source the way the other suites do ───────── */
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const weekly = fs.readFileSync(path.join(__dirname, 'weekly.js'), 'utf8');
  const dbsrc = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');

  const hook = server.indexOf('metawebhook.normaliseStatuses(req.body)');
  const early = server.indexOf('if (!messages.length) return;');
  ok('the webhook reads status callbacks', hook > -1);
  ok('and does so BEFORE the "no messages, stop" line that used to discard them', hook > -1 && early > hook);
  ok('the status hook cannot throw into the conversation flow',
    /try \{\s*for \(const s of metawebhook\.normaliseStatuses[\s\S]*?\} catch \(err\) \{/.test(server));
  ok('a failed status is logged without a phone number or text',
    /an outbound message failed: \$\{s\.errorCode/.test(server) && !/recipient/.test(server.slice(hook, hook + 900)));
  ok('the settings page API counts a visit without awaiting it',
    /db\.noteSettingsOpen\(userId\)\.catch\(\(\) => \{\}\);/.test(server));

  ok('the weekly review records a text send', /trackOutbound\(userId, sentMsg, 'text'\)/.test(weekly));
  ok('and a template send', /trackOutbound\(userId, sent, 'template'\)/.test(weekly));
  ok('recording is guarded so it cannot fail a delivery',
    /function trackOutbound[\s\S]*?typeof db\.recordOutbound !== 'function'[\s\S]*?\.catch\(\(\) => \{\}\)/.test(weekly));
  ok('deliverTemplate still returns something truthy for its existing callers', /return sent \|\| true;/.test(weekly));
  ok('and its call signature is untouched, because test-weekly.js pins it',
    weekly.includes('deliverTemplate(phone, payload, theirName, token, lang)'));

  // If you add another table keyed on user_id, add it to purgeUserData in the same commit.
  const purge = dbsrc.slice(dbsrc.indexOf('async function purgeUserData'), dbsrc.indexOf('async function purgeUserData') + 1500);
  ok('deleting a person removes their delivery receipts', purge.includes("DELETE FROM outbound_messages WHERE user_id = $1"));
  ok('and their page opens', purge.includes("DELETE FROM settings_opens WHERE user_id = $1"));
  ok('both tables are created at boot', /CREATE TABLE IF NOT EXISTS outbound_messages/.test(dbsrc) && /CREATE TABLE IF NOT EXISTS settings_opens/.test(dbsrc));
  ok('no message text is stored in the receipts table',
    !/CREATE TABLE IF NOT EXISTS outbound_messages[\s\S]*?(body|content|text)\s+TEXT[\s\S]*?\);/.test(dbsrc.slice(dbsrc.indexOf('CREATE TABLE IF NOT EXISTS outbound_messages'), dbsrc.indexOf('CREATE TABLE IF NOT EXISTS settings_opens'))));

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

/* THE SQL. recordOutbound, applyMessageStatus (ordering, idempotence, unknown
   ids), noteSettingsOpen (the ten-minute throttle) and purgeUserData were run
   against a real throwaway Postgres on 26 Sep 2026, not against a mock,
   because the CASE ranking is exactly the sort of thing a mock agrees with by
   construction. That harness is not in the repo: db.js hardcodes SSL, so it
   needs a patched local copy. See reference_embedded_postgres_windows_testing. */
