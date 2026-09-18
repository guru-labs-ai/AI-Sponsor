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
const language = require('./language');
const copy = require('./notice-copy');   // the check-in in six other languages

const ON = String(process.env.QUIET_CHECKIN || '').toLowerCase() === 'on';
const QUIET_DAYS = Math.max(1, parseInt(process.env.QUIET_CHECKIN_DAYS, 10) || 5);

/* ── Check-ins are on request (Mariam, Sep 17) ───────────────────────────────
   A check-in nobody asked for is MARKETING by Meta's rules, and WhatsApp does
   not deliver MARKETING to US numbers, which is most of the people here. So
   the check-in is now something a person asks for: their sponsor offers once
   in chat, they can ask for it or stop it in their own words any time, and
   there is a switch on the settings page. Only people who said yes are ever
   checked in on, and the message says it is the check-in they asked for, which
   is what lets it be a UTILITY template that reaches every number.

   The old unrequested quiet_checkin template stays on the WABA, unused. */
const TEMPLATE = 'checkin_requested';
const TEMPLATE_MORE_LANGUAGES = 'checkin_on_request';
const CHECKIN_REQUESTED_EN = "Hi {{1}}, you asked me to check in if I hadn't heard from you for a few days, so here I am. Reply whenever you want to talk. You can turn check-ins off on your settings page.";

/* The offer comes once there is some real conversation to stand on, never in
   the first few messages. */
const OFFER_AFTER_MESSAGES = 10;

/* Whether this person has said yes. Stored on every identity they hold. */
function wantsCheckins(profile) {
  return !!(profile && profile.checkinOptIn === true);
}

/* Whether the sponsor should offer check-ins in this reply. Only while the
   feature is switched on (an offer nobody can honour is a broken promise),
   only if they have never answered and never been offered, and only once the
   conversation has some history. The prompt decides whether this particular
   moment is calm enough; this decides whether it is allowed at all. */
function offerDue(profile, historyLength) {
  if (!ON || !profile) return false;
  if (profile.checkinOptIn === true || profile.checkinOptIn === false) return false;
  if (profile.checkinOffered) return false;
  return (historyLength || 0) >= OFFER_AFTER_MESSAGES;
}

async function saveToEveryIdentity(dbh, userId, change) {
  const ids = dbh.findAllIdentities ? await dbh.findAllIdentities(userId) : [userId];
  await Promise.all(ids.map((id) => dbh.saveProfile(id, change)));
  return ids;
}

/* Yes or no, from wherever it came: an answer in chat, a request in their own
   words, or the settings switch. Written to every identity and recorded as an
   event, so there is a record of who asked for these and when. */
async function setWish(dbh, userId, on, source) {
  await saveToEveryIdentity(dbh, userId, { checkinOptIn: !!on, checkinOptInAt: new Date().toISOString() });
  await dbh.recordEvent(userId, on ? 'checkin_opt_in' : 'checkin_opt_out', { source }, 'checkin')
    .catch((e) => console.error('[checkin] recordEvent failed:', e.message));
  console.log(`[checkin] ${userId} ${on ? 'wants' : 'does not want'} check-ins (${source})`);
}

/* The sponsor just asked. Recorded so it never asks again. */
async function recordOffer(dbh, userId) {
  await saveToEveryIdentity(dbh, userId, { checkinOffered: new Date().toISOString() });
}

/* What their message said about check-ins (language.readMessage reads it, with
   the offer as context when one is waiting for an answer). Only a change is
   written. Never throws: a missed yes costs one check-in, not the reply. */
async function noteWish(dbh, userId, read, profile) {
  try {
    if (!read || !read.checkins || read.checkins === 'none') return null;
    const on = read.checkins === 'start';
    if (profile && profile.checkinOptIn === on) return null;
    await setWish(dbh, userId, on, 'chat');
    return on;
  } catch (e) {
    console.warn('[checkin] could not save the check-in wish:', e.message);
    return null;
  }
}

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
function checkinText(name, lang = 'en') {
  const hi = firstName(name) || copy.SPONSOR_NAME_FALLBACK[lang] || copy.SPONSOR_NAME_FALLBACK.en;
  const t = lang !== 'en' && copy.CHECKIN_REQUESTED[lang] ? copy.CHECKIN_REQUESTED[lang].template : CHECKIN_REQUESTED_EN;
  return t.replace('{{1}}', hi);
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

  /* Only people who asked for check-ins. US numbers are included once Meta has
     the English checkin_requested approved as UTILITY, which is the version
     every reader can fall back to; until then they are left out rather than
     sent into nothing, and left out in the query so they cannot starve the
     queue (see db.quietCheckinCandidates). */
  let englishIsUtility = false;
  try {
    const info = sender && sender.templateInfo ? await sender.templateInfo(TEMPLATE, 'en_US') : null;
    englishIsUtility = !!(info && info.category === 'UTILITY' && info.status === 'APPROVED');
  } catch (e) {
    console.warn('[checkin] could not read the template category, leaving US numbers out:', e.message);
  }
  const people = await db.quietCheckinCandidates({
    quietDays: QUIET_DAYS, limit, optedInOnly: true, excludeUsNumbers: !englishIsUtility,
  }).catch((e) => { console.error('[checkin] candidate query failed:', e.message); return []; });

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
      const lang = language.noticeLanguage(await language.languageOf(db, p.user_id));
      /* The button opens their settings page on the sponsor pane, where the
         check-in switch is, so turning these off is one tap from the message. */
      const token = db.getOrCreateSettingsToken ? await db.getOrCreateSettingsToken(p.user_id).catch(() => null) : null;
      if (!token) { out.failed++; console.warn(`[checkin] no settings token for ${p.user_id}, not sending`); continue; }
      /* mustArrive: their language where Meta has it as approved UTILITY,
         otherwise the English, so a US number is never sent a translation Meta
         moved to MARKETING. */
      await language.sendTemplateIn(sender, phone, TEMPLATE, lang,
        (l) => [firstName(p.name) || copy.SPONSOR_NAME_FALLBACK[l]], `${token}#sponsor`,
        /* checkin_on_request carries the nine languages added on Sep 17. Its
           own name because Meta ties a category to a name and checkin_requested
           already has a MARKETING translation (Russian). */
        { mustArrive: true, alsoTry: [TEMPLATE_MORE_LANGUAGES] });
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

module.exports = {
  runCheckinSweep, maybeSweep, checkinText, withinTheirHours, enabled: ON, TEMPLATE,
  CHECKIN_REQUESTED_EN, OFFER_AFTER_MESSAGES, wantsCheckins, offerDue, setWish, recordOffer, noteWish,
};
