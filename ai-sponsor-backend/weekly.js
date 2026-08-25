// ─── The weekly review ───────────────────────────────────────────────────────
// An end-of-week note from the sponsor to the person, shown on their own
// settings page (which Matt correctly called "basically their dashboard") and
// nudged over WhatsApp with the same tokenised link they already use.
//
// WHY THIS IS BUILT THE WAY IT IS
//
// This backend sleeps. Render's free tier spins the instance down when it goes
// idle, which db.js already says out loud where it explains why sponsor_tokens
// live in Postgres rather than memory. So the obvious implementation — a timer
// that fires on Sunday night — is the one thing that cannot work: at the moment
// a week rolls over there is very often no process alive to notice.
//
// So nothing here is scheduled. A week is a CLOSED, FIXED window, and a summary
// for it is simply a row that either exists or doesn't. Four independent things
// can cause that row to be written:
//
//   1. an external scheduler hitting POST /api/cron/weekly-summaries
//   2. the person opening their own dashboard  (lazy, per-user)
//   3. anybody at all talking to the sponsor    (throttled sweep, piggybacked)
//   4. an in-process interval, while the instance happens to be awake
//
// None of them is load-bearing. If the cron never fires for three days, the
// summary is still correct when it eventually gets written, because the window
// it describes closed days ago and cannot change. Late is not wrong here.
//
// Double-firing is handled by the database, not by coordination: a UNIQUE
// (user_id, week_start) with ON CONFLICT DO NOTHING means two triggers racing
// produce one row, and the one that lost the race is told it lost, so it does
// not go on to send a second WhatsApp message. Generation and delivery are
// separately timestamped for the same reason — a crash in between must not cost
// the summary, and must not send the nudge twice.

const db = require('./db');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SITE_URL = process.env.SITE_URL || 'https://getaisponsor.com';

// Same model the rolling memory digest uses, for the same reason: this reads
// somebody's recovery week back to them and the writing quality is the product.
// Overridable if weekly spend ever needs to come down.
const WEEKLY_MODEL = process.env.WEEKLY_MODEL || 'claude-opus-4-8';

/* Below this many messages there is genuinely nothing to analyse, and asking a
   model to find themes in three messages is asking it to invent them. Those
   weeks get an honest short card written here in code, with no model call at
   all. Cheaper, but that is not the reason: the reason is that a padded summary
   of a week somebody barely showed up for is a small lie told to a person whose
   recovery depends on not being lied to. */
const MIN_FOR_NARRATIVE = parseInt(process.env.WEEKLY_MIN_MESSAGES || '4', 10);

/* A heavy week can be hundreds of turns. Cap what we read and what we send, so
   one very talkative person cannot blow the context window or the bill. */
const MAX_ROWS = 500;
const MAX_TRANSCRIPT_CHARS = 40000;

/* Outbound WhatsApp is OFF by default and has to be switched on deliberately.
   Generating a summary is private and reversible; messaging real people in
   recovery is neither. The pane works either way — with delivery off, the
   summary is simply waiting for them next time they open the link. */
const DELIVER = String(process.env.WEEKLY_DELIVER || '').toLowerCase() === 'true';

/* ── The week ───────────────────────────────────────────────────────────────
   Monday to Sunday, and always the last one that has fully CLOSED. Never the
   week in progress: a review of a week that is still happening is wrong the
   moment it is written, and would have to be regenerated, which breaks the
   whole "the row either exists or it doesn't" model that makes this survive a
   sleeping instance.

   All UTC. The instance has no idea what timezone anyone is in, and quietly
   guessing would put somebody's Sunday night in the wrong week. */
function lastCompletedWeek(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (today.getUTCDay() + 6) % 7;          // getUTCDay: 0=Sun
  const thisMonday = new Date(today.getTime() - sinceMonday * 86400000);
  const start = new Date(thisMonday.getTime() - 7 * 86400000);
  const end = new Date(thisMonday.getTime() - 86400000);    // the Sunday
  return { start: isoDay(start), end: isoDay(end) };
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function prettyRange(startISO, endISO) {
  const opts = { day: 'numeric', month: 'long' };
  const a = new Date(startISO + 'T00:00:00Z');
  const b = new Date(endISO + 'T00:00:00Z');
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = a.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : opts);
  return `${left} to ${b.toLocaleDateString('en-GB', opts)}`;
}

/* ── What the model is asked for ────────────────────────────────────────────
   Strict JSON rather than prose, so the page can lay it out as a person reads
   it — the note first, the things they said they'd do somewhere they can find
   them again — instead of one undifferentiated block. A model that ignores the
   format is handled below rather than retried.

   The content list is deliberately the one a human sponsor actually carries in
   their head between calls: what you kept coming back to, what helped, what you
   said you'd do. Not "topics discussed". */
const SYSTEM_PROMPT = [
  'You are writing a private end-of-week note from a recovery sponsor to the person they support.',
  'It is shown only to that person, on their own private page. Nobody else ever reads it.',
  '',
  'Write to them, as their sponsor. Second person, warm, plain, unhurried. Their sponsor has a name and you are writing as that person, not as a system generating a report.',
  '',
  'HARD RULES',
  '- Never praise them for the number of messages they sent or days they logged in. That is not recovery, and treating it as an achievement teaches them the wrong thing to optimise.',
  '- Never invent. If nothing repeated, return null for carried. If they committed to nothing, return an empty array. An empty field is always better than a plausible one.',
  '- Paraphrase, never quote more than a few of their own words back at them. A sentence they wrote at 3am can land very differently on a Monday.',
  '- No diagnosis, no medical or legal advice, no treatment recommendations.',
  '- Do not mention methods of self-harm or use, ever, even if they did.',
  '- No therapy jargon, no corporate summary language, no bullet-point voice. This is a note from a person.',
  '',
  'TONE, which you must choose and return',
  '- "hard": the week held a relapse, a slip, a crisis, a bereavement, or something close to one. Do NOT open with praise and do NOT tally anything. Name what happened plainly, without judgement and without softening it into nothing, and centre the note on the fact that they came back and are still here. If they described being in real danger, the nextWeek line points them at a human being, not a habit.',
  '- "quiet": they were mostly absent, or it was logistics and small talk. Say that honestly and without disappointment. A quiet week is not a failure and must not be written as one.',
  '- "steady": anything else.',
  '',
  'RETURN ONLY JSON, no code fence, no commentary, exactly this shape:',
  '{',
  '  "note": "2 to 4 sentences, the note itself",',
  '  "themes": ["what the week kept being about", "max 5, max 8 words each"],',
  '  "carried": "one sentence on the thing that came up more than once, or null",',
  '  "helped": ["things that visibly made it better for them", "max 3"],',
  '  "commitments": ["things they said they would do", "max 4, in their own terms"],',
  '  "milestone": "anything reached or marked this week, or null",',
  '  "nextWeek": "one sentence, one thing to carry forward. Gentle, specific, theirs not yours.",',
  '  "tone": "steady" | "hard" | "quiet"',
  '}',
].join('\n');

const TONES = ['steady', 'hard', 'quiet'];

/* Trust nothing that comes back. A model that returns eight themes, a string
   where an array belongs, or a tone it invented must not be able to break the
   page or widen what gets shown. */
function coerce(raw) {
  const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const arr = (v, n, max) =>
    (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

  const note = str(raw && raw.note, 1200);
  if (!note) return null; // without the note there is no summary worth showing

  return {
    note,
    themes: arr(raw.themes, 5, 80),
    carried: str(raw.carried, 400),
    helped: arr(raw.helped, 3, 160),
    commitments: arr(raw.commitments, 4, 200),
    milestone: str(raw.milestone, 200),
    nextWeek: str(raw.nextWeek, 400),
    tone: TONES.includes(raw.tone) ? raw.tone : 'steady',
  };
}

function parseModelJSON(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return coerce(JSON.parse(cleaned));
  } catch (e) {
    /* It ignored the format. The writing is probably still fine, and throwing it
       away to retry costs another Opus call for a person who is going to read
       one paragraph. Keep the prose as the note and leave every structured
       field empty rather than guessing at them. */
    const asNote = cleaned.slice(0, 1200).trim();
    return asNote ? coerce({ note: asNote, tone: 'steady' }) : null;
  }
}

/* ── The quiet-week card ────────────────────────────────────────────────────
   Written here, in code, with no model involved. There is nothing to analyse in
   two messages, and this is the honest thing to show instead of a summary that
   sounds like there was. */
function quietWeekCard({ sponsorName, messages, activeDays }) {
  const who = sponsorName || 'your sponsor';
  const note = messages === 0
    ? `We didn't talk this week. That's allowed, and it doesn't undo anything. I'm here when you want me, and there's no catching up to do first.`
    : `A quiet week between us, just ${messages} message${messages === 1 ? '' : 's'} across ${activeDays} day${activeDays === 1 ? '' : 's'}. That's not a failure and I'm not keeping score. Whenever you want to talk properly, I'm here.`;
  return {
    note,
    themes: [],
    carried: null,
    helped: [],
    commitments: [],
    milestone: null,
    nextWeek: `No task from me this week. Just message me when something comes up, even if it's small.`,
    tone: 'quiet',
    _by: who,
  };
}

/* Which of the three things to do with a week, given its counts.

   A named function purely so it can be tested, because the one bug this file
   has actually shipped was reading the wrong field here. `messages` is how many
   times they turned up; `readable` is how many of those we can still open. Only
   the second can be summarised, and passing stats where the two disagree is the
   regression test. */
function planWeek(stats) {
  const have = Number(stats && stats.readable) || 0;
  if (!have) return 'skip';
  return have < MIN_FOR_NARRATIVE ? 'quiet' : 'narrative';
}

/* ── Generate one person's week ─────────────────────────────────────────────
   Idempotent by construction. Returns what happened so the caller can tell the
   difference between "wrote a new one" and "somebody else already had", which
   is what stops two triggers sending two WhatsApp messages. */
async function ensureWeeklySummary(userId, opts = {}) {
  if (!db.enabled || !userId) return { status: 'skipped', reason: 'no-db' };

  const week = opts.week || lastCompletedWeek();

  // Cheap existence check first: the overwhelmingly common case is that the row
  // is already there, and that must not cost a query against messages.
  const existing = await db.getWeeklySummary(userId, week.start).catch(() => null);
  if (existing) return { status: 'exists', week, summary: existing };

  const activity = await db.getWeekActivity(userId, week.start, week.end).catch(() => null);
  const stats = activity || { messages: 0, readable: 0, activeDays: 0, days: [] };

  /* Everything below counts `readable`, never `messages`. See getWeekActivity:
     after somebody uses "start over", activity_days still remembers a busy week
     whose messages are gone, and deciding anything on that number means writing
     about a conversation nobody can read. */
  const have = stats.readable;
  const plan = planWeek(stats);

  /* Nobody who said nothing all week gets a row. A summary of silence is not
     worth a model call, and a nudge about it would land as a product noticing
     they went quiet, which is not the same thing as their sponsor noticing and
     is worse than saying nothing.

     This also covers the wiped week: they turned up, but they asked us to
     forget what was said, so there is correctly nothing to look back on. */
  if (plan === 'skip') return { status: 'skipped', reason: 'no-readable-messages', week };

  const profile = (await db.getProfile(userId).catch(() => null)) || {};
  const user = (await db.getUser(userId).catch(() => null)) || {};
  const sponsorName = profile.sponsorName || user.sponsor_name || '';
  const theirName = String(profile.name || user.name || '').trim().split(/\s+/)[0] || '';

  let payload;
  if (plan === 'quiet') {
    payload = quietWeekCard({ sponsorName, messages: have, activeDays: stats.activeDays });
  } else {
    payload = await writeNarrative({ userId, week, stats, sponsorName, theirName }).catch((e) => {
      console.error('[weekly] model call failed:', e.message);
      return null;
    });
    /* A model failure must not burn the week. No row is written, so the next
       trigger — the person opening their dashboard, tomorrow's cron — tries
       again against the same closed window and gets the same chance. */
    if (!payload) return { status: 'failed', reason: 'model', week };
  }

  /* The count shown on the card is `readable` too, so the number and the note
     can never disagree. Displaying the historical 15 next to a note written
     from 2 surviving messages tells somebody their sponsor read things it
     could not read. */
  const written = await db.saveWeeklySummary(userId, week.start, week.end, payload, {
    messages: have,
    activeDays: stats.activeDays,
    days: stats.days,
  }).catch((e) => {
    console.error('[weekly] save failed:', e.message);
    return null;
  });

  if (written === null) return { status: 'failed', reason: 'save', week };
  if (written === false) {
    /* Lost the race. Another trigger wrote this same week while we were talking
       to the model. Ours is discarded and, importantly, we do NOT go on to
       deliver: the winner is responsible for that. */
    const theirs = await db.getWeeklySummary(userId, week.start).catch(() => null);
    return { status: 'exists', week, summary: theirs };
  }

  console.log(`[weekly] wrote ${userId} for ${week.start}..${week.end} (${have} readable of ${stats.messages} logged, tone ${payload.tone})`);
  return { status: 'created', week, summary: { ...payload, week_start: week.start, week_end: week.end, stats } };
}

async function writeNarrative({ userId, week, stats, sponsorName, theirName }) {
  const rows = await db.getWeekMessages(userId, week.start, week.end, MAX_ROWS);
  if (!rows || !rows.length) return null;

  let transcript = rows
    .map((m) => `${m.role === 'user' ? 'Them' : 'You'}: ${m.content}`)
    .join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the END of the week, not the start: what somebody was carrying on
    // Sunday matters more to next week than what they said on Monday.
    transcript = '…(earlier in the week trimmed)…\n' + transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }

  /* Their long-term memory goes in as context but is explicitly NOT the
     subject. Without it a relapse in week one reads as new information in week
     six; with it treated as material, the note starts recapping their whole
     history back at them instead of their week. */
  const memory = await db.getMemory(userId).catch(() => null);

  const events = await db.getEvents(userId, 30).catch(() => []);
  const weekEvents = (events || [])
    .filter((e) => {
      const d = isoDay(new Date(e.created_at));
      return d >= week.start && d <= week.end;
    })
    .map((e) => e.event);

  const context = [
    sponsorName ? `Your name is ${sponsorName}.` : '',
    theirName ? `Their name is ${theirName}.` : '',
    `The week you are writing about is ${prettyRange(week.start, week.end)}.`,
    `They talked with you on ${stats.activeDays} of those 7 days.`,
    weekEvents.length ? `Account things that happened this week: ${weekEvents.join(', ')}.` : '',
    memory && memory.digest
      ? `BACKGROUND you already know about them from before this week — context only, do NOT summarise it back to them, the note is about this week:\n${memory.digest}`
      : '',
  ].filter(Boolean).join('\n');

  const resp = await client.messages.create({
    model: WEEKLY_MODEL,
    max_tokens: 1200,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    messages: [{
      role: 'user',
      content: `${context}\n\nTHIS WEEK'S CONVERSATION:\n${transcript}`,
    }],
  });

  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseModelJSON(text);
}

/* ── Delivery ───────────────────────────────────────────────────────────────
   ⚠️ WhatsApp only allows a free-form outbound message inside 24 hours of the
   person's last inbound one. Outside that window this send fails (Twilio 63016)
   unless it goes out as an approved template, and we have none for this.

   Which means the nudge is reliable for people who messaged recently and
   unreliable for exactly the people a quiet week is about. That is a real limit
   of the channel, not something to paper over, so every attempt records its
   outcome and the cron response reports the counts. The summary itself does not
   depend on any of this: it is already on their page either way. */
async function deliver(userId, payload, week, whatsapp) {
  if (!DELIVER) return { sent: false, reason: 'delivery-disabled' };
  if (!whatsapp || !whatsapp.sendTextReply) return { sent: false, reason: 'no-whatsapp' };

  const user = (await db.getUser(userId).catch(() => null)) || {};
  /* wa- ids first: that is the number Twilio itself told us the person messages
     from, and it is the form the existing outbound call at server.js already
     uses. users.phone is whatever they typed at registration and is the
     fallback, not the truth. */
  const phone = (userId.startsWith('wa-') ? userId.slice(3) : '') ||
    String(user.phone || '').trim();
  if (!phone) return { sent: false, reason: 'no-phone' };

  const token = await db.getOrCreateSettingsToken(userId).catch(() => null);
  if (!token) return { sent: false, reason: 'no-token' };

  const link = `${SITE_URL}/ai-sponsor-settings.html?t=${token}#week`;
  const theirName = String(user.name || '').trim().split(/\s+/)[0];
  const hi = theirName ? `${theirName}, ` : '';

  /* A hard week does not get a cheerful "here's your week in review". The
     wording changes with the tone for the same reason the note does. */
  const body = payload.tone === 'hard'
    ? `${hi}I've been thinking about your week. I wrote a few things down for you, only if you want them:\n\n${link}\n\nNo need to reply. I'm here either way.`
    : payload.tone === 'quiet'
      ? `${hi}quiet week between us, which is fine. I left you a short note here if you want it:\n\n${link}`
      : `${hi}I looked back over your week and wrote it down for you. It's here whenever you want it:\n\n${link}`;

  try {
    await whatsapp.sendTextReply(`whatsapp:${phone}`, body);
    await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
    return { sent: true };
  } catch (e) {
    /* The 24-hour window. 63016 was Twilio's code for it; 131047 is Meta's.
       Both are expected often enough that they must not read as a bug. */
    const outside = /63016|131047/.test(e.message || '');

    /* ⭐ AND THIS IS THE POINT OF THE WHOLE THING. Someone who has not written
       all week is exactly who a week in review is addressed to, and until the
       number moved to Meta there was no way to reach them: Twilio had no
       template support on our account, so the message simply died here.

       Now the warm free-text version goes to anyone still inside the window,
       and anyone outside it gets the approved template instead. Same link,
       same three tones, plainer words because Meta reviews every one. */
    if (outside) {
      const sent = await deliverTemplate(phone, payload, theirName, token);
      if (sent) {
        await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
        return { sent: true, via: 'template' };
      }
    }

    console.warn(`[weekly] delivery to ${userId} failed${outside ? ' (outside 24h window)' : ''}: ${e.message}`);
    await db.markWeeklyDelivered(userId, week.start, false, outside ? 'outside-24h' : String(e.message).slice(0, 200)).catch(() => {});
    return { sent: false, reason: outside ? 'outside-24h' : 'send-failed' };
  }
}

/* One approved template per tone, mirroring the free-text wording above. The
   names are fixed because Meta approves them by name; changing one means a new
   submission and another review. */
const WEEKLY_TEMPLATES = {
  hard:  'weekly_review_hard',
  quiet: 'weekly_review_quiet',
  good:  'weekly_review',
};

/* Returns true only if it actually sent. Every failure is swallowed and logged:
   this is already the fallback path, and there is nothing further to fall back
   to. A person not receiving a nudge is a missed warmth, not a broken product,
   and the summary is still waiting on their dashboard either way. */
async function deliverTemplate(phone, payload, theirName, token) {
  let metacloud;
  try { metacloud = require('./metacloud'); } catch { return false; }
  if (!metacloud.enabled || !metacloud.sendTemplate) return false;

  const name = WEEKLY_TEMPLATES[payload.tone] || WEEKLY_TEMPLATES.good;
  /* Meta rejects an empty variable, and plenty of people never gave a name, so
     it falls back to something a sponsor would actually say out loud. */
  const first = String(theirName || '').trim() || 'there';

  try {
    await metacloud.sendTemplate(`whatsapp:${phone}`, name, [first], `${token}#week`);
    console.log(`[weekly] delivered via template ${name}`);
    return true;
  } catch (err) {
    console.warn(`[weekly] template ${name} failed: ${err.message}`);
    return false;
  }
}

/* ── The sweep ──────────────────────────────────────────────────────────────
   Everyone who talked during the closed week and has no row for it yet. Batched
   so a single invocation on a small free instance cannot run for minutes; what
   it does not finish, the next trigger picks up, because "due" is defined by
   the database and not by anything held in this process. */
async function runSweep({ limit = 25, whatsapp = null, week = null } = {}) {
  if (!db.enabled) return { ok: false, reason: 'no-db' };

  const w = week || lastCompletedWeek();
  const due = await db.usersDueForWeekly(w.start, w.end, limit).catch((e) => {
    console.error('[weekly] due query failed:', e.message);
    return [];
  });

  const out = { week: w, considered: due.length, created: 0, skipped: 0, failed: 0, delivered: 0, notDelivered: {} };

  for (const userId of due) {
    const r = await ensureWeeklySummary(userId, { week: w });
    if (r.status === 'created') {
      out.created++;
      const d = await deliver(userId, r.summary, w, whatsapp);
      if (d.sent) out.delivered++;
      else out.notDelivered[d.reason] = (out.notDelivered[d.reason] || 0) + 1;
    } else if (r.status === 'failed') out.failed++;
    else out.skipped++;
  }

  if (out.created || out.failed) {
    console.log(`[weekly] sweep ${w.start}..${w.end}: ${out.created} written, ${out.delivered} delivered, ${out.failed} failed, ${out.skipped} skipped`);
  }
  return { ok: true, ...out };
}

/* Trigger 3: piggybacked on ordinary traffic. Anybody talking to the sponsor
   wakes the instance, and that is the cheapest scheduler this product has.
   Throttled hard, because it must never add latency to somebody's reply. */
let lastPiggyback = 0;
const PIGGYBACK_EVERY_MS = 60 * 60 * 1000;

function maybeSweep(whatsapp) {
  if (!db.enabled) return;
  const now = Date.now();
  if (now - lastPiggyback < PIGGYBACK_EVERY_MS) return;
  lastPiggyback = now;
  runSweep({ limit: 10, whatsapp }).catch((e) => console.error('[weekly] piggyback sweep failed:', e.message));
}

/* Trigger 4: while we happen to be awake. Genuinely best-effort — on the free
   tier this fires only during the minutes somebody else is already using the
   product, which is precisely why it is the last line of defence and not the
   design. unref() so it can never hold the process open. */
function startInterval(whatsapp) {
  if (!db.enabled) return null;
  const t = setInterval(() => {
    runSweep({ limit: 10, whatsapp }).catch((e) => console.error('[weekly] interval sweep failed:', e.message));
  }, 6 * 60 * 60 * 1000);
  if (t.unref) t.unref();
  return t;
}

module.exports = {
  lastCompletedWeek, prettyRange,
  ensureWeeklySummary, runSweep, maybeSweep, startInterval, deliver,
  DELIVER, MIN_FOR_NARRATIVE,
  // Exported for test-weekly.js. These are where a bad model response turns
  // into something the page renders, so they are the parts worth pinning down.
  _parseModelJSON: parseModelJSON, _coerce: coerce, _quietWeekCard: quietWeekCard,
  _planWeek: planWeek,
  _SYSTEM_PROMPT: SYSTEM_PROMPT, _WEEKLY_MODEL: WEEKLY_MODEL,
};
