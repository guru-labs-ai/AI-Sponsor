/* Offline tests: the status check says "back to normal" after an alert.

   Matt, 20 Nov: "maybe then a back online message automation would be prudent
   as well? so that happens in here and i'm not confused". The 18:29 WhatsApp
   blip fixed itself by 18:31 and nothing in the channel said so.

   Run: node test-status-recovery.js */
const assert = require('assert');

process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
delete process.env.SLACK_CUSTOMER_CHANNEL;
delete process.env.DATABASE_URL;

const posts = [];
let slackAnswer = () => ({ ok: true, ts: '1795110000.000100', channel: 'C0CANT8BT17' });
global.fetch = async (url, opts) => {
  if (String(url).includes('slack.com')) {
    posts.push(JSON.parse(opts.body));
    return { ok: true, json: async () => slackAnswer() };
  }
  throw new Error(`unexpected fetch ${url}`);
};

const db = require('./db');
let events = [];
let clock = Date.parse('2026-11-20T17:29:35Z');
db.enabled = true;
db.getEvents = async (u, n) => events.filter((e) => e.user === u).slice(0, n);
db.recordEvent = async (u, event, detail) => { events.unshift({ user: u, event, detail, created_at: new Date(clock).toISOString() }); };

const status = require('./status');
const run = (data) => status._internals.checkAndAlert(data);
const at = (iso) => { clock = Date.parse(iso); return iso; };
const down = (iso) => ({ checkedAt: at(iso), overall: 'down', checks: [
  { name: 'WhatsApp number', group: 'WhatsApp', state: 'down', detail: 'token rejected: An error has occurred.' },
  { name: 'Database', group: 'Backend', state: 'ok', detail: 'answering' },
] });
const ok = (iso) => ({ checkedAt: at(iso), overall: 'ok', checks: [{ name: 'WhatsApp number', group: 'WhatsApp', state: 'ok', detail: 'fine' }] });

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

(async () => {
  await t('a red posts the alert, names the three people, and remembers its thread', async () => {
    const r = await run(down('2026-11-20T17:29:35Z'));
    assert.strictEqual(r.posted, true);
    assert.strictEqual(posts.length, 1);
    assert.ok(posts[0].text.includes('something is broken'));
    assert.ok(posts[0].text.includes('<@U07212P3QNS>'));
    assert.strictEqual(events[0].event, 'status_alert');
    assert.strictEqual(events[0].detail.ts, '1795110000.000100');
    assert.deepStrictEqual(events[0].detail.names, ['WhatsApp number']);
  });

  await t('the same problem 15 minutes later is not posted again', async () => {
    const r = await run(down('2026-11-20T17:44:35Z'));
    assert.strictEqual(r.posted, false);
    assert.strictEqual(posts.length, 1);
  });

  await t('the first OK run after it posts "back to normal" in the alert thread, shown in the channel, no pings', async () => {
    const r = await run(ok('2026-11-20T17:59:35Z'));
    assert.strictEqual(r.posted, true);
    assert.deepStrictEqual(r.backToNormal, ['WhatsApp number']);
    assert.strictEqual(posts.length, 2);
    const p = posts[1];
    assert.ok(p.text.includes('back to normal'));
    assert.ok(p.text.includes('WhatsApp number'));
    assert.ok(p.text.includes('about 30 minutes ago'), p.text);
    assert.ok(!p.text.includes('<@'), 'an all-clear must not ping anyone');
    assert.strictEqual(p.thread_ts, '1795110000.000100');
    assert.strictEqual(p.reply_broadcast, true);
    assert.strictEqual(p.channel, 'C0CANT8BT17');
    assert.strictEqual(events[0].event, 'status_recovered');
  });

  await t('later OK runs say nothing more', async () => {
    const r = await run(ok('2026-11-20T18:14:35Z'));
    assert.strictEqual(r.posted, false);
    assert.strictEqual(posts.length, 2);
  });

  await t('the same problem coming back after an all-clear is posted again, not swallowed', async () => {
    const r = await run(down('2026-11-20T19:00:00Z'));
    assert.strictEqual(r.posted, true);
    assert.strictEqual(posts.length, 3);
  });

  await t('if Slack refuses the all-clear it is not marked done, and the next run tries again', async () => {
    slackAnswer = () => ({ ok: false, error: 'ratelimited' });
    process.env.SLACK_ALERTS_CHANNEL = process.env.SLACK_CUSTOMER_CHANNEL = 'C_SAME'; // no fallback channel to hide it
    await assert.rejects(() => run(ok('2026-11-20T19:15:00Z')));
    assert.strictEqual(events[0].event, 'status_alert');
    slackAnswer = () => ({ ok: true, ts: '1795119999.000200', channel: 'C_SAME' });
    const r = await run(ok('2026-11-20T19:30:00Z'));
    assert.strictEqual(r.posted, true);
    assert.strictEqual(events[0].event, 'status_recovered');
    delete process.env.SLACK_ALERTS_CHANNEL; delete process.env.SLACK_CUSTOMER_CHANNEL;
  });

  await t('an alert from before this existed (no thread) is closed quietly, not announced hours late', async () => {
    events.unshift({ user: 'system-status', event: 'status_alert', detail: { signature: 'WhatsApp number:down', overall: 'down' }, created_at: '2026-11-20T17:29:36Z' });
    const before = posts.length;
    const r = await run(ok('2026-11-20T23:00:00Z'));
    assert.strictEqual(r.posted, false);
    assert.strictEqual(posts.length, before);
    assert.strictEqual(events[0].event, 'status_recovered');
    assert.strictEqual(events[0].detail.announced, false);
  });

  await t('an amber still waiting to be confirmed never gets an all-clear (nobody was told)', async () => {
    const before = posts.length;
    const amber = { checkedAt: at('2026-11-21T01:00:00Z'), overall: 'warn', checks: [{ name: 'Voice notes in', group: 'The sponsor', state: 'warn', detail: 'could not check' }] };
    const r1 = await run(amber);
    assert.ok(r1.held);
    const r2 = await run(ok('2026-11-21T01:15:00Z'));
    assert.strictEqual(r2.posted, false);
    assert.strictEqual(posts.length, before);
  });

  await t('time since reads in minutes, then hours', () => {
    assert.strictEqual(status._internals.sinceText('2026-11-20T17:29:00Z', '2026-11-20T17:30:00Z'), 'about 1 minute');
    assert.strictEqual(status._internals.sinceText('2026-11-20T17:00:00Z', '2026-11-20T19:10:00Z'), 'about 2 hours');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
