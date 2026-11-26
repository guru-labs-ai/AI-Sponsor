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
  await check('the look: at least 3 hours later, inside their day, inside the 24-hour window, at every hour they might write', () => {
    for (const zone of ['Europe/London', 'America/New_York', 'Asia/Hong_Kong', 'America/Los_Angeles']) {
      for (let h = 0; h < 24; h++) {
        const last = new Date(Date.UTC(2026, 10, 16, h, 7));
        const due = followup.pickDueTime(last, zone);
        assert.ok(due, `${zone} ${h}:07 UTC has no slot`);
        const gap = (due - last) / H;
        assert.ok(gap >= 3 && gap <= 23, `${zone} ${h}:07 UTC -> ${gap}h`);
        const lh = localH(zone, due);
        assert.ok(lh >= 9 && lh < 21, `${zone} due at ${lh}:00 local`);
      }
    }
  });

  await check('the look comes about 3 hours later; an evening message waits for the morning', () => {
    // London, 22:00 -> +3h is 1am, so 9am next day.
    assert.strictEqual(followup.pickDueTime(new Date(Date.UTC(2026, 10, 16, 22, 0)), 'Europe/London').toISOString(), '2026-11-17T09:00:00.000Z');
    // London, 09:50 -> 12:50 the same day.
    assert.strictEqual(followup.pickDueTime(new Date(Date.UTC(2026, 10, 16, 9, 50)), 'Europe/London').toISOString(), '2026-11-16T12:50:00.000Z');
  });

  await check('the next day: 16+ hours after their last message, else the latest moment the window allows', () => {
    const nd = (lastH, nowH, zone = 'Europe/London') => {
      const r = followup.pickNextDay(new Date(Date.UTC(2026, 10, 16, lastH, 0)), zone, new Date(Date.UTC(2026, 10, 16, nowH, 0)));
      return r && r.toISOString();
    };
    assert.strictEqual(nd(20, 23), '2026-11-17T12:00:00.000Z', 'evening chat: around midday next day');
    assert.strictEqual(nd(14, 17), '2026-11-17T09:00:00.000Z', 'afternoon chat: the next morning');
    assert.strictEqual(nd(9, 12), '2026-11-16T20:45:00.000Z', 'morning chat: no next-day moment inside 23 hours, so that evening');
    for (const zone of ['Europe/London', 'America/New_York', 'Asia/Tbilisi']) {
      for (let h = 0; h < 24; h++) {
        const last = new Date(Date.UTC(2026, 10, 16, h, 0));
        const now = followup.pickDueTime(last, zone);
        const due = followup.pickNextDay(last, zone, now);
        if (!due) continue;
        assert.ok(due - now >= H, `${zone} ${h}:00: at least an hour after the look`);
        assert.ok(due - last <= 23 * H, `${zone} ${h}:00: inside the window`);
        const lh = localH(zone, due);
        assert.ok(lh >= 9 && lh < 21, `${zone} ${h}:00: due at ${lh}:00 local`);
      }
    }
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

  await check('LATER: the look books one more look the next day; the next-day look never waits again', async () => {
    const saved = { ...db };
    const finished = [], moved = [], sent = [], stages = [];
    Object.assign(db, {
      enabled: true,
      claimDueFollowups: async () => [{ ...row, stage: 'look' }, { ...row, user_id: 'wa-+447700900001', stage: 'next-day' }],
      followupGuards: async () => quiet,
      finishFollowup: async (u, s, n) => { finished.push([u, s, n]); },
      rescheduleFollowup: async (u, due) => { moved.push([u, new Date(due).toISOString()]); },
      recordOutbound: async () => {},
    });
    try {
      const r = await followup.runSweep({
        write: async (u, o) => { stages.push([u, o.stage]); return { later: true, zone: 'Europe/London' }; },
        send: async (p, t) => { sent.push([p, t]); return { messageId: 'wamid.TEST' }; },
        after: async () => {},
      }, { now });
      assert.deepStrictEqual(stages, [['wa-+447700900000', 'look'], ['wa-+447700900001', 'next-day']]);
      assert.deepStrictEqual([r.sent, r.later, r.skipped], [0, 1, 1]);
      // last message 22:00 London: the next day's moment is 14:00, 16 hours on
      assert.deepStrictEqual(moved, [['wa-+447700900000', '2026-11-17T14:00:00.000Z']]);
      assert.deepStrictEqual(finished, [['wa-+447700900001', 'skipped', 'nothing to say the next day']]);
      assert.strictEqual(sent.length, 0);
    } finally { Object.assign(db, saved); }
  });

  /* Mariam's test, 26 Nov: a first message went out two seconds before the
     reply to the voice note she had just sent. */
  await check('never on top of a reply still being written: skipped before writing, and again right before sending', async () => {
    const saved = { ...db };
    const finished = [], sent = [];
    Object.assign(db, {
      enabled: true,
      claimDueFollowups: async () => [row],
      followupGuards: async () => quiet,
      finishFollowup: async (u, s, n) => { finished.push([u, s, n]); },
      recordOutbound: async () => {},
    });
    const deps = (onWrite) => ({
      write: async (u) => { if (onWrite) onWrite(u); return { text: 'How did the call with the bank go?' }; },
      send: async (phone, text) => { sent.push([phone, text]); return { messageId: 'wamid.TEST' }; },
      after: async () => {},
    });
    try {
      followup.startAnswering(row.user_id);
      const r1 = await followup.runSweep(deps(), { now });
      assert.deepStrictEqual([r1.sent, r1.skipped], [0, 1], 'their message is still being answered');
      assert.strictEqual(finished[0][2], 'they are writing');
      followup.doneAnswering(row.user_id);
      assert.strictEqual(followup.beingAnswered(row.user_id), false);

      const r2 = await followup.runSweep(deps((u) => followup.startAnswering(u)), { now });
      assert.deepStrictEqual([r2.sent, r2.skipped], [0, 1], 'they wrote while it was being written');
      assert.strictEqual(finished[1][2], 'they wrote while it was being written');
      followup.doneAnswering(row.user_id);

      const r3 = await followup.runSweep(deps(), { now });
      assert.strictEqual(r3.sent, 1, 'once the reply is out, it sends as before');
      assert.strictEqual(sent.length, 1);
    } finally { Object.assign(db, saved); followup.doneAnswering(row.user_id); }
  });

  await check('two quick messages: still marked until both are answered; a stuck mark lapses after ten minutes', () => {
    const u = 'wa-+15550003333';
    followup.startAnswering(u); followup.startAnswering(u);
    followup.doneAnswering(u);
    assert.strictEqual(followup.beingAnswered(u), true, 'the second is still being answered');
    followup.doneAnswering(u);
    assert.strictEqual(followup.beingAnswered(u), false);
    followup.startAnswering(u);
    assert.strictEqual(followup.beingAnswered(u, Date.now() + 11 * 60 * 1000), false);
  });

  await check('WhatsApp marks the person the moment a message arrives and clears it when done', () => {
    const wa = fs.readFileSync(path.join(__dirname, 'whatsapp.js'), 'utf8');
    const start = wa.indexOf('if (!isReaction) followup.startAnswering(answeringId);');
    const iife = wa.indexOf('(async () => {', start);
    assert.ok(start > 0 && iife > start, 'marked before the reply work starts');
    assert.ok(/\} finally \{\s*if \(!isReaction\) followup\.doneAnswering\(answeringId\);\s*\}\s*\}\)\(\);/.test(wa), 'cleared however it ends');
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
    assert.ok(/Never apologize for or comment on an earlier reply of yours/.test(srv));
    assert.ok(!/Right now you can't start a conversation, only continue one/.test(srv), 'the old line would deny the message it just sent');
    assert.ok(/You can write to them first, but only within a day of their last message/.test(srv));
    assert.ok(/our last first message is still unanswered/.test(srv), 'never a second message on top of an unanswered one');
    assert.ok(/const saved = await db\.getProfile\(userId\)/.test(srv) && /if \(said\(saved\) \|\| said\(profile\)\)/.test(srv), 'a fresh "do not message me first" must be read from the database, not a stale copy');
  });

  await check('switched off with a test list: only the numbers on it, nobody else', () => {
    const a = followup.allowedBy;
    const list = '+15550001111, 447700900000';
    assert.strictEqual(a('wa-+15550001111', 'off', list), true);
    assert.strictEqual(a('wa-+447700900000', 'off', list), true, 'a number written without + still counts');
    assert.strictEqual(a('wa-+15550002222', 'off', list), false, 'someone not on the list');
    assert.strictEqual(a('wa-+15550001111', 'off', ''), false, 'off with no list is off for everyone');
    assert.strictEqual(a('wa-+15550001111', 'OFF', undefined), false);
    assert.strictEqual(a('reg-abc', 'off', list), false, 'only WhatsApp people');
  });

  await check('the test list skips the 3-day wait; nobody else does', () => {
    const t = followup.onTestListBy;
    assert.strictEqual(t('wa-+15550001111', 'off', '+15550001111'), true);
    assert.strictEqual(t('wa-+15550002222', 'off', '+15550001111'), false, 'not on the list');
    assert.strictEqual(t('wa-+15550001111', 'on', '+15550001111'), false, 'switched on: 3 days for everyone');
    const r = { user_id: 'wa-+15550001111', last_user_at: new Date(Date.UTC(2026, 10, 16, 22, 0)) };
    const g = { last_user_at: r.last_user_at, last_followup_at: new Date(Date.UTC(2026, 10, 16, 12, 0)), last_outbound_at: null, deletion_pending: false };
    const at = new Date(Date.UTC(2026, 10, 17, 10, 0));
    assert.strictEqual(followup.verdict(r, g, at), 'too-soon-after-the-last-one');
    assert.strictEqual(followup.verdict(r, g, at, { minDays: 0 }), 'write');
  });

  await check('switched on: everyone on WhatsApp, the list does not narrow it', () => {
    const a = followup.allowedBy;
    assert.strictEqual(a('wa-+15550002222', 'on', '+15550001111'), true);
    assert.strictEqual(a('wa-+15550002222', undefined, ''), true, 'unset means on, as before');
    assert.strictEqual(a('reg-abc', 'on', ''), false);
  });

  await check('the sponsor decides now, later or never; a fresh plan is never overwritten by an old sweep', () => {
    assert.ok(/Answer only the word LATER when the natural moment is the next day/.test(srv));
    assert.ok(/your answer was thin, vague or missed what they really asked/.test(srv), 'the fuller answer, a few hours later');
    assert.ok(/Something was left hanging between you/.test(srv), 'the light nudge about an open choice');
    assert.ok(/up to about two hundred words, in short paragraphs/.test(srv) && /if \(words\(text\) > 250\) return \{ skip: 'too long for a first message' \};/.test(srv), 'a fuller answer can be longer; past 250 words nothing is sent');
    assert.ok(/if \(\/\^\\W\*LATER\\b\/i\.test\(text\)\) return stage === 'look' \? \{ later: true, zone: userZone \}/.test(srv));
    assert.ok(/Write to them now, never LATER or SKIP/.test(srv), 'a crisis never waits for tomorrow');
    assert.ok(/SET status = \$2, note = \$3[\s\S]{0,160}WHERE user_id = \$1 AND status = 'writing'/.test(dbsrc), 'finish only the claimed row');
    assert.ok(/ADD COLUMN IF NOT EXISTS stage TEXT/.test(dbsrc));
  });

  await check('web search: only for the fuller answer on the first look, one search, never about them, never announced, and never the "let me look" text', () => {
    assert.ok(/const FOLLOWUP_SEARCH_TOOL = \{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 \};/.test(srv), 'one plain search, no more (the sifting programs of _20260209 crashed in testing)');
    assert.ok(/const FOLLOWUP_FETCH_TOOL = \{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 10, max_content_tokens: 5000 \};/.test(srv), 'opens the pages it found, again to double-check, each cut at 5,000 tokens');
    assert.ok(/If a page will not open, skip it and never try it again\./.test(srv), 'a refused page is not retried');
    assert.ok(/open one again if you want to double-check something/.test(srv));
    assert.ok(/Never search a second time for more results/.test(srv));
    assert.ok(/\[\[FOLLOWUP_SEARCH_TOOL, FOLLOWUP_FETCH_TOOL\], \[FOLLOWUP_SEARCH_TOOL\]\]/.test(srv), 'pages refused: search alone');
    assert.ok(/Never tell them you searched online, the internet or the web/.test(srv), 'not announced as an online search');
    assert.ok(/const searching = stage === 'look' && FOLLOWUP_SEARCH_ON;/.test(srv), 'never on the next-day look');
    assert.ok(/Never search for anything about them, and never put their name, their story or anything that could identify them in a search\./.test(srv));
    assert.ok(/Meeting times and links come only from what you were given in this conversation, never from a search\./.test(srv));
    assert.ok(/let text = followupMessageOf\(res\);/.test(srv), 'the message is what is between the tags, after the last search');
    assert.ok(/if \(text === null\) \{[^}]*return \{ skip: 'no message tags' \}; \}/.test(srv), 'no tags, nothing sent');
    assert.ok(/res\.stop_reason === 'pause_turn'/.test(srv), 'a paused search is carried on, not sent half-done');
    assert.ok(/writing without it/.test(srv), 'no search, still a message');
    // followupTextOf, copied out of server.js and run on a made-up answer
    const m = srv.match(/function followupTextOf\(res\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'followupTextOf found');
    const followupTextOf = new Function(`${m[0]}; return followupTextOf;`)();
    assert.strictEqual(followupTextOf({ content: [
      { type: 'text', text: 'Let me look that up.' },
      { type: 'server_tool_use', name: 'web_search' },
      { type: 'web_search_tool_result', content: [] },
      { type: 'text', text: 'Hi again, I was thinking more about ' },
      { type: 'text', text: 'the book you asked about.', citations: [{}] },
    ] }), 'Hi again, I was thinking more about the book you asked about.');
    assert.strictEqual(followupTextOf({ content: [{ type: 'text', text: 'SKIP' }] }), 'SKIP');
    // 26 Nov live test: the sponsor's note to itself must never be sent
    const m2 = srv.match(/function followupMessageOf\(res\) \{[\s\S]*?\n\}/);
    assert.ok(m2, 'followupMessageOf found');
    const followupMessageOf = new Function(`${m[0]}; ${m2[0]}; return followupMessageOf;`)();
    assert.strictEqual(followupMessageOf({ content: [
      { type: 'server_tool_use', name: 'web_search' },
      { type: 'web_search_tool_result', content: { error_code: 'unavailable' } },
      { type: 'text', text: 'The search ran even though the error came back. I have enough general knowledge.\n\n<message>Been thinking more about your question. ' },
      { type: 'text', text: 'Here is more.</message>', citations: [{}] },
    ] }), 'Been thinking more about your question. Here is more.');
    assert.strictEqual(followupMessageOf({ content: [{ type: 'text', text: 'The search failed, so here is the answer.' }] }), null, 'no tags: nothing');
    assert.strictEqual(followupMessageOf({ content: [{ type: 'text', text: 'Thinking.\n<message>LATER</message>' }] }), 'LATER');
  });

  console.log(`\n${failed ? 'FAILED' : 'All good'}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
