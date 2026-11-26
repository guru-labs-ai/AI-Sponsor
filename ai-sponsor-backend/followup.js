/* ─── The sponsor texts first ─────────────────────────────────────────────────
   Mariam, 15 Nov 2026: "it would be nice if we text them first", for everyone,
   and "dont ask anyone anything it should just be naturally when someone texts
   their AI sponsor". So nobody is asked to opt in. After somebody has talked to
   their sponsor on WhatsApp and gone quiet, the sponsor writes once more, the
   way a human sponsor texts the next day: about what they last talked about,
   asked for or said they would do.

   Why it can be free text and personal. WhatsApp lets a business send ordinary
   messages for 24 hours after the person's last message, to every number, US
   included, with no template and no category. Outside those 24 hours only an
   approved template can go, and Meta files an unrequested "checking in" as
   MARKETING, which US numbers never receive (checkin.js has the history). So
   this lives entirely inside the window: never earlier than 8 hours after
   their last message (a morning chat gets an evening message, an evening chat
   the next morning), never later than 23, and only between 9am and 9pm where
   they are. A moment that does not fit is simply no message.

   The restraint, which is most of this file:
   - one per quiet spell: their next message replaces the plan, and a person
     still talking gets nothing
   - not within 3 days of the last one, and not within 6 hours of anything else
     we sent (the weekly note, a notice)
   - never while a deletion is pending, never after a start-over (the plan is
     wiped with the conversation), never if they said they do not want it
     ("stop checking in" reaches the same switch as the old check-ins)
   - the sponsor may decide there is nothing to pick up and send nothing

   How it reads is decided in server.js (writeFollowup): it has to sound like
   the sponsor thinking of them, never like someone who read the chat and fixed
   something (Mariam, 15 Nov). This file only decides whether and when.

   A row, not a timer (db.sponsor_followups): restarts and deploys kill timers,
   and the row survives them. SPONSOR_FOLLOWUPS=off on Render stops all of it.

   A test list (Mariam, 26 Nov: "lets just test it on my number as if I would
   be a user"). While SPONSOR_FOLLOWUPS=off, SPONSOR_FOLLOWUPS_ONLY can name a
   few WhatsApp numbers (comma-separated, e.g. +15550001111,+447700900000) and only those
   people get first messages, by exactly the same rules as everyone would.
   Nobody else is planned for or written to. It is a separate variable on
   purpose: older code ignores it and stays off, so setting it can never turn
   this on for everyone. SPONSOR_FOLLOWUPS=on means everyone and the list is
   not needed.
──────────────────────────────────────────────────────────────────────────── */
const db = require('./db');
const timezones = require('./timezones');

function readList(value) {
  return new Set(String(value || '').split(',')
    .map((n) => n.replace(/[^\d+]/g, ''))
    .filter((n) => /\d{6,}/.test(n))
    .map((n) => (n.startsWith('+') ? n : `+${n}`)));
}
/* Whether this person may get first messages at all. Pure, for the tests. */
function allowedBy(userId, switchValue, onlyValue) {
  const id = String(userId || '');
  if (!id.startsWith('wa-')) return false;
  if (String(switchValue || 'on').toLowerCase() !== 'off') return true;
  return readList(onlyValue).has(id.slice(3));
}
const EVERYONE = String(process.env.SPONSOR_FOLLOWUPS || 'on').toLowerCase() !== 'off';
const ONLY = readList(process.env.SPONSOR_FOLLOWUPS_ONLY);
const ON = EVERYONE || ONLY.size > 0;
const allowed = (userId) => allowedBy(userId, process.env.SPONSOR_FOLLOWUPS, process.env.SPONSOR_FOLLOWUPS_ONLY);
const EARLIEST_H = 8;       // after their last message (12 left people who write around 9am with no slot at all)
const LATEST_H = 23;        // the window closes at 24; an hour of slack
const DAY_START = 9;        // their local time
const DAY_END = 21;
const MIN_DAYS_BETWEEN = 3;
const QUIET_AFTER_OTHER_H = 6;
const STEP_MS = 15 * 60 * 1000;
const H = 3600 * 1000;

/* The first moment at least 8 hours after their last message that falls in
   their day, or null if there is none before the window closes. */
function pickDueTime(lastUserAt, zone) {
  const last = new Date(lastUserAt).getTime();
  if (!Number.isFinite(last)) return null;
  const z = zone || 'UTC';
  for (let t = last + EARLIEST_H * H; t <= last + LATEST_H * H; t += STEP_MS) {
    const hour = timezones.localHour(z, new Date(t));
    if (hour !== null && hour >= DAY_START && hour < DAY_END) return new Date(t);
  }
  return null;
}

/* Called after every WhatsApp reply. Fire and forget: planning must never hold
   up or break a reply. */
function plan(userId, { zone = null, now = new Date(), channel = 'whatsapp' } = {}) {
  if (!ON || !db.enabled || channel !== 'whatsapp' || !allowed(userId)) return Promise.resolve();
  const due = pickDueTime(now, zone);
  const closes = new Date(now.getTime() + 24 * H);
  return db.planFollowup(userId, now, due, closes)
    .catch((e) => console.warn('[followup] could not plan:', e.message));
}

/* Whether to write to this person now, given what the database says. Pure, so
   it can be tested without a database. */
function verdict(row, guards, now = new Date()) {
  if (!guards) return 'no-data';
  if (guards.deletion_pending) return 'deletion-pending';
  const lastUser = guards.last_user_at ? new Date(guards.last_user_at).getTime() : 0;
  if (lastUser > new Date(row.last_user_at).getTime() + 1000) return 'they-wrote-since';
  if (now.getTime() - lastUser > LATEST_H * H + 30 * 60 * 1000) return 'window-closing';
  if (guards.last_followup_at && now.getTime() - new Date(guards.last_followup_at).getTime() < MIN_DAYS_BETWEEN * 24 * H) return 'too-soon-after-the-last-one';
  if (guards.last_outbound_at && now.getTime() - new Date(guards.last_outbound_at).getTime() < QUIET_AFTER_OTHER_H * H) return 'we-sent-something-else-recently';
  return 'write';
}

/* deps (from server.js, so this file never needs the prompt or the model):
     write(userId)      -> { text } | { skip: reason }
     send(phone, text)  -> the send result ({ messageId } on Meta)
     after(userId, text, result) -> saves it into their conversation */
async function runSweep(deps, { limit = 3, now = new Date() } = {}) {
  if (!ON) return { ok: false, reason: 'followups-off' };
  if (!db.enabled) return { ok: false, reason: 'no-db' };
  const rows = await db.claimDueFollowups(limit).catch((e) => { console.error('[followup] claim failed:', e.message); return []; });
  const out = { claimed: rows.length, sent: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    const userId = row.user_id;
    try {
      /* Rows left from before a switch-off, or anyone not on the test list. */
      if (!allowed(userId)) { out.skipped++; await db.finishFollowup(userId, 'skipped', 'not on the test list'); continue; }
      const v = verdict(row, await db.followupGuards(userId), now);
      if (v !== 'write') { out.skipped++; await db.finishFollowup(userId, 'skipped', v); continue; }
      const w = await deps.write(userId);
      if (!w || !w.text) { out.skipped++; await db.finishFollowup(userId, 'skipped', (w && w.skip) || 'nothing written'); continue; }
      const result = await deps.send(userId.slice(3), w.text);
      if (result && result.messageId && db.recordOutbound) {
        await db.recordOutbound(userId, result.messageId, 'followup', 'text').catch(() => {});
      }
      await deps.after(userId, w.text, result);
      await db.finishFollowup(userId, 'sent');
      out.sent++;
      console.log('[followup] sent one');
    } catch (e) {
      out.failed++;
      const outside = /63016|131047/.test(e.message || '');
      await db.finishFollowup(userId, outside ? 'expired' : 'failed', String(e.message || e).slice(0, 200)).catch(() => {});
      console.warn(`[followup] ${outside ? 'window closed' : 'failed'}: ${e.message}`);
    }
  }
  if (out.claimed) console.log(`[followup] sweep: ${out.sent} sent, ${out.skipped} skipped, ${out.failed} failed`);
  return { ok: true, ...out };
}

/* Run every ten minutes from an interval and on ordinary traffic; the claim in
   the database makes overlapping runs harmless. */
let lastRun = 0;
const EVERY_MS = 10 * 60 * 1000;
function maybeSweep(deps) {
  if (!ON || !db.enabled) return;
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  runSweep(deps).catch((e) => console.error('[followup] sweep failed:', e.message));
}
let timer = null;
function startInterval(deps) {
  if (!ON || timer) return;
  timer = setInterval(() => maybeSweep(deps), EVERY_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  enabled: ON, everyone: EVERYONE, allowedBy, plan, pickDueTime, verdict, runSweep, maybeSweep, startInterval,
  EARLIEST_H, LATEST_H, DAY_START, DAY_END, MIN_DAYS_BETWEEN, QUIET_AFTER_OTHER_H,
};
