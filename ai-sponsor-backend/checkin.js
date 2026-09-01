/* ─── "It has been a few days" ────────────────────────────────────────────────
   Mariam, 1 Sep 2026: 22 people have ever written to their sponsor and 13 wrote
   in the last week, so roughly nine had gone quiet and the product did not
   notice. The only thing standing between somebody going silent and anything at
   all was the weekly review, which is once a week and is a summary, not a
   question.

   Her threshold, and her constraint: five days, and do not pester people.

   ⚠️ THE 24-HOUR WINDOW IS WORSE HERE THAN ANYWHERE ELSE. The weekly and the
   trial notice both have a warm free-text path for anyone still inside it. This
   one does not, and cannot: five days of silence puts every single recipient
   outside the window by definition. So this reaches nobody at all until the
   `quiet_checkin` template is approved, and it is switched off until then.

   Unlike trialnotice.js this DOES speak as the sponsor, in the name the person
   chose. That file deliberately speaks as the service instead, because the
   sponsor's voice is not used to ask somebody for money. A check-in is the
   opposite: it is the one thing that voice is actually for.

   The restraint lives in db.quietCheckinCandidates, not here. Read that query
   before changing anything: every clause in it is there to stop this becoming
   the thing people mute. The short version is one message per quiet spell, none
   at all if they ignored the last one, nothing after fourteen days, and never
   while somebody is halfway out the door.
──────────────────────────────────────────────────────────────────────────── */

const db = require('./db');

const ON = String(process.env.QUIET_CHECKIN || '').toLowerCase() === 'on';
const QUIET_DAYS = Math.max(1, parseInt(process.env.QUIET_CHECKIN_DAYS, 10) || 5);
const TEMPLATE = 'quiet_checkin';

/* How far from their usual hour we will still send. Three either side of the
   hour they normally write turns a 24-hour window into about a seven-hour one,
   which is enough to miss the middle of their night without needing a timezone
   we do not have. Somebody with no clear pattern gets no restriction, since
   inventing one would just be a different kind of guess. */
const HOUR_SLACK = 3;

function withinTheirHours(usualHour, nowHour) {
  if (usualHour === null || usualHour === undefined) return true;
  const d = Math.abs(usualHour - nowHour);
  return Math.min(d, 24 - d) <= HOUR_SLACK;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/* Kept in one place because it is both the message and the thing Meta approves.
   If this wording changes the template has to be resubmitted, not edited here. */
function checkinText(name) {
  const hi = firstName(name);
  return hi
    ? `Hi ${hi}, it has been a few days. No agenda, I just wanted to see how you are.`
    : `It has been a few days. No agenda, I just wanted to see how you are.`;
}

/* Resolved here rather than handed in from server.js, which does not hold a
   reference to it. Injectable so the tests never touch the real module, and
   lazy for the same reason weekly.js does it: requiring it at load would drag
   the Meta client into a process that may have no token. */
function resolveSender(injected) {
  if (injected !== undefined) return injected;
  try { return require('./metacloud'); } catch { return null; }
}

async function runCheckinSweep({ limit = 3, whatsapp = null, metacloud, now = new Date() } = {}) {
  if (!ON) return { ok: false, reason: 'checkin-disabled' };
  if (!db.enabled) return { ok: false, reason: 'no-db' };
  const sender = resolveSender(metacloud);

  const people = await db.quietCheckinCandidates({ quietDays: QUIET_DAYS, limit })
    .catch((e) => { console.error('[checkin] candidate query failed:', e.message); return []; });

  const out = { considered: people.length, sent: 0, skippedHour: 0, failed: 0 };
  const nowHour = now.getUTCHours();

  for (const p of people) {
    if (!withinTheirHours(p.usual_hour, nowHour)) { out.skippedHour++; continue; }

    const phone = p.user_id.startsWith('wa-') ? p.user_id.slice(3) : '';
    if (!phone) { out.failed++; continue; }

    /* Template only. There is no free-text path here on purpose: everyone this
       finds is five days silent, so a free-text send would fail for all of them
       and the fallback would be the whole mechanism. */
    if (!sender || !sender.enabled || !sender.sendTemplate) {
      out.failed++;
      console.warn('[checkin] no template sender available, nobody was messaged');
      break;
    }

    try {
      await sender.sendTemplate(phone, TEMPLATE, [firstName(p.name) || 'there']);
      /* Written AFTER the send. A row written first would silence this person
         for thirty days on a message that never left. */
      await db.recordEvent(p.user_id, 'quiet_checkin', { quietDays: QUIET_DAYS }, 'checkin')
        .catch((e) => console.error('[checkin] recordEvent failed:', e.message));
      out.sent++;
    } catch (e) {
      out.failed++;
      console.warn(`[checkin] send failed for ${p.user_id}: ${e.message}`);
    }
  }

  if (out.sent || out.failed) {
    console.log(`[checkin] ${out.sent} sent, ${out.skippedHour} held for their hours, ${out.failed} failed`);
  }
  return { ok: true, ...out };
}

/* Piggybacked on ordinary traffic like everything else here, because Render
   spins the instance down and a cron would simply never fire. Once every six
   hours: the candidate query already limits who is eligible, so running it more
   often only adds load, never reach. */
let lastRun = 0;
const EVERY_MS = 6 * 60 * 60 * 1000;

function maybeSweep(whatsapp) {
  if (!ON || !db.enabled) return;
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  runCheckinSweep({ limit: 3, whatsapp })
    .catch((e) => console.error('[checkin] piggyback failed:', e.message));
}

module.exports = { runCheckinSweep, maybeSweep, checkinText, withinTheirHours, enabled: ON, TEMPLATE };
