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
//   4. an in-process interval: every 15 minutes while it is Sunday somewhere
//
// None of them is load-bearing for the summary itself: if the cron never fires
// for three days, it is still correct when it eventually gets written, because
// the window it describes closed days ago and cannot change. The WhatsApp nudge
// is different: it only goes out 9 to noon on their Sunday, so a sweep has to
// run inside that window, which is why 4 now runs every 15 minutes on Sundays
// (5 Nov, see startInterval).
//
// Double-firing is handled by the database, not by coordination: a UNIQUE
// (user_id, week_start) with ON CONFLICT DO NOTHING means two triggers racing
// produce one row, and the one that lost the race is told it lost, so it does
// not go on to send a second WhatsApp message. Generation and delivery are
// separately timestamped for the same reason — a crash in between must not cost
// the summary, and must not send the nudge twice.

const db = require('./db');
const tz = require('./timezones');
const language = require('./language');   // which language the note and nudge are in
const copy = require('./notice-copy');     // the nudge, card and templates in six other languages
const spelling = require('./spelling');    // American spelling on English notes
const window24 = require('./window24');    // text or template: is their 24-hour window open
const Anthropic = require('@anthropic-ai/sdk');

// Priced and filed with the server's other calls (spend.js); the sink is set in server.js.
const client = require('./spend').instrument(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), 'weekly');

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

/* People who wrote nothing all week get a "haven't heard from you" note too
   (Mariam, 26 Sep 2026), instead of being skipped. ON by default because that
   was her decision; set WEEKLY_SILENT=off to stop it without a code change. See
   db.usersQuietForWeekly for who counts and for every guard against pestering. */
const SILENT_ON = String(process.env.WEEKLY_SILENT || 'on').toLowerCase() !== 'off';
const SILENT_STOP_AFTER = 2;

/* ── The week ───────────────────────────────────────────────────────────────
   SUNDAY to SATURDAY, and always the last one that has fully CLOSED. Never the
   week in progress: a review of a week that is still happening is wrong the
   moment it is written, and would have to be regenerated, which breaks the
   whole "the row either exists or it doesn't" model that makes this survive a
   sleeping instance.

   It used to run Monday to Sunday, delivered on the Monday. Matt moved
   delivery to Sunday morning, on the grounds that Sunday is the day people
   put into their recovery. That forces the window to move with it: sending
   on Sunday morning while the old week still had Sunday left in it would
   have reviewed a day that had not happened. The week now ends on the
   Saturday night before the message, the last full day we can honestly
   describe.

   Boundaries stay in UTC. Delivery is per person and local, but the window
   itself has to be one shared thing, or two people talking to each other
   would have been shown different weeks. */
function lastCompletedWeek(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceSunday = today.getUTCDay();                    // getUTCDay: 0=Sun
  const thisSunday = new Date(today.getTime() - sinceSunday * 86400000);
  const start = new Date(thisSunday.getTime() - 7 * 86400000);
  const end = new Date(thisSunday.getTime() - 86400000);    // the Saturday
  return { start: isoDay(start), end: isoDay(end) };
}

/* How long they have been with their sponsor, said plainly for the note
   writer: a first week reads as an introduction (Mariam, 21 Nov). Empty when
   we do not know, so nothing is guessed. */
function isFirstWeek(joined, week) {
  const at = joined ? new Date(joined) : null;
  return !!at && !Number.isNaN(at.getTime()) && isoDay(at) >= week.start;
}

/* Words that only belong in a first week. "Your first week back at work" is
   not one of them, so only the relationship itself is matched. */
const FIRST_WEEK_CLAIM = /\b(?:our|this) first week\b|\bfirst week (?:together|with me|with you)\b|\bgetting to know (?:each other|one another)\b|\bfinding our footing\b|\bjust (?:met|started talking)\b|\bwe(?:'ve| have)? only just met\b/i;
function claimsFirstWeek(payload) {
  return FIRST_WEEK_CLAIM.test([payload.note, payload.nextWeek, payload.milestone].filter(Boolean).join('\n'));
}
function dropFirstWeekClaim(payload) {
  if (!payload || !payload.note || !FIRST_WEEK_CLAIM.test(payload.note)) return payload;
  const kept = payload.note.split(/(?<=[.!?])\s+/).filter((s) => !FIRST_WEEK_CLAIM.test(s));
  /* The greeting usually sits in the sentence that goes; it is put back by
     withGreeting for English, so only the claim is lost. */
  if (kept.length) payload.note = kept.join(' ');
  if (payload.milestone && FIRST_WEEK_CLAIM.test(payload.milestone)) payload.milestone = null;
  if (payload.nextWeek && FIRST_WEEK_CLAIM.test(payload.nextWeek)) payload.nextWeek = null;
  return payload;
}

function tenureLine(joined, week) {
  const at = joined ? new Date(joined) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  const day = isoDay(at);
  const said = at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  if (day >= week.start) return `This was their first week with you: they joined on ${said}.`;
  const weeks = Math.floor((Date.parse(`${week.end}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / (7 * 86400000)) + 1;
  return `They have been with you since ${said}, about ${weeks} weeks.`;
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

/* American order (Mariam, 24 Nov): "November 15 to 21", or "November 29 to
   December 5" across two months. It is the heading of the summary they get on
   WhatsApp and a value in its templates. */
function prettyRange(startISO, endISO) {
  const a = new Date(startISO + 'T00:00:00Z');
  const b = new Date(endISO + 'T00:00:00Z');
  const month = (d) => d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  return `${month(a)} ${a.getUTCDate()} to ${sameMonth ? '' : `${month(b)} `}${b.getUTCDate()}`;
}

function americanizeNote(payload) {
  for (const k of ['note', 'carried', 'milestone', 'nextWeek']) {
    if (typeof payload[k] === 'string') payload[k] = spelling.americanize(payload[k]);
  }
  for (const k of ['themes', 'helped', 'commitments']) {
    if (Array.isArray(payload[k])) payload[k] = payload[k].map((x) => spelling.americanize(x));
  }
}

/* ── What the model is asked for ────────────────────────────────────────────
   Strict JSON rather than prose, so the page can lay it out as a person reads
   it — the note first, the things they said they'd do somewhere they can find
   them again — instead of one undifferentiated block. A model that ignores the
   format is rejected below and retried, never shown.

   The content list is deliberately the one a human sponsor actually carries in
   their head between calls: what you kept coming back to, what helped, what you
   said you'd do. Not "topics discussed". */
const SYSTEM_PROMPT = [
  'You are writing a private end-of-week note from a recovery sponsor to the person they support.',
  'It is sent only to that person, as a WhatsApp message under the heading "Your week in summary", and kept on their own private page. Nobody else ever reads it.',
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
  /* 14 Nov 2026. A note told a long-standing member "You had to correct my
     guesses three times before I landed on what you actually meant", and said
     "tonight" about a talk it would be read about a week later. */
  '- The note is about them, never about you. Nowhere in note, carried, helped, commitments or nextWeek do you mention your own mistakes, guesses or misreadings, or their correcting you, not even as praise for them. Where they corrected something you said, write only what they actually meant, as if you had understood it from the start. If a conversation went badly, do not dwell on it.',
  '- The week is over when they read this, sometimes by a week. Never write tonight, today, this evening, right now or "this week". Say "last week", or name the day.',
  /* 21 Nov 2026, Mariam, reading real notes before they went out as messages:
     one told a member "honest when I asked you plainly whether you wanted to be
     here, you said yes", its lists called him "his", and it opened with "this
     note is about you". */
  '- Every field is written TO them: you and your. Never he, she, his, her or their name about them, in the note or in the lists. "Wrote your first Step One sentence", not "Wrote his first Step One sentence".',
  '- Never bring back the safety question or their answer to it: whether they want to be here, thoughts of ending their life or of not being around. Not even as praise. If the week held real danger, the hard tone covers it.',
  '- Open the way a sponsor would open a message. Never with a line about the note itself ("this note is about you", "here is your summary"): the heading already says what it is.',
  '- No long dashes (— or –) anywhere. Use a comma or a full stop.',
  '',
  /* 21 Nov 2026, Mariam: "a summary is more like overall", "not super extreme
     details", a first week is an introduction, and it is always about them. */
  'WHAT THE NOTE IS',
  '- Start with "Hi" and their first name, then a comma (in their language), and go straight on in the same sentence or the next.',
  '- Then 2 or 3 short sentences with the overall feeling of their week: how it seemed to go for them, and one thing you noticed in them. It is not a recap of the conversation.',
  '- Leave out the specifics they told you: substances, amounts, names of people, what they wrote down, step answers, quotes. It goes to their phone and can show on a lock screen.',
  '- Never say what the trouble was about either: not drinking, using, money, debt, food, sex, relationships, their business or their job problems, not the event that set it off. Describe how they met the week, not what happened in it. At most one light everyday touch that gives nothing away, like "a rushed morning".',
  '- If this was their first week with you, the note is a welcome: say it was your first week together and you are still getting to know each other, then the overall feel in a sentence. No verdict on them yet.',
  '- If they have been with you longer, you may mention it when it fits ("a few weeks in"), never as praise for showing up.',
  '- If they were NOT new this week, never call it a first week, never say you are getting to know each other or finding your footing. If you were not told when they joined, they are not new.',
  '- The note is always about them, never about you or the product: not what you can or cannot do, not links, features or how this works.',
  '- nextWeek is one short, gentle line, just as general: nothing on it that would expose them if someone else read it.',
  '',
  'TONE, which you must choose and return',
  '- "hard": the week held a relapse, a slip, a crisis, a bereavement, or something close to one. Do NOT open with praise and do NOT tally anything. Name what happened plainly, without judgment and without softening it into nothing, and center the note on the fact that they came back and are still here. If they described being in real danger, the nextWeek line points them at a human being, not a habit.',
  '- "quiet": they were mostly absent, or it was logistics and small talk. Say that honestly and without disappointment. A quiet week is not a failure and must not be written as one.',
  '- "steady": anything else.',
  '',
  'RETURN ONLY JSON, no code fence, no commentary, exactly this shape:',
  '{',
  '  "note": "Hi <first name>, then 2 or 3 short sentences: the overall feel of their week",',
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
/* A long dash reads as AI (Mariam), and the prompt only mostly prevents it.
   " — " between two thoughts becomes a comma; a bare one too. */
function noDashes(s) {
  return s.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').replace(/,\s*([.!?])/g, '$1');
}

function coerce(raw) {
  /* "None" is the model saying null in words (seen 21 Nov as a milestone), and
     the page would print it under a star. */
  const EMPTY = /^(?:none|null|n\/?a|nothing|-)\.?$/i;
  const str = (v, max) => (typeof v === 'string' && v.trim() && !EMPTY.test(v.trim())
    ? noDashes(v.trim()).slice(0, max) : null);
  const arr = (v, n, max) =>
    (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

  const note = str(raw && raw.note, 1200);
  if (!note) return null; // without the note there is no summary worth showing
  // The last line of defence against raw model output reaching a person's page:
  // a note that is itself JSON or a code fence is a broken reply, not writing.
  if (/^(\{|\[|```)/.test(note) || /"note"\s*:/.test(note)) return null;

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

/* Anything that is not a complete JSON object with a note is REJECTED, never
   shown. There used to be a prose fallback here that kept whatever came back as
   the note, and on 13 Sep it put two replies that had stopped mid-sentence on
   people's pages as raw code, starting `{ "note": "` and cut off halfway. The
   same fallback stamped those weeks "steady", so a hard week got the everyday
   WhatsApp wording. A missing note gets retried; a wrong one gets read. */
/* ── Two things a note must never do (14 Nov 2026) ───────────────────────────
   Tested on invented weeks with the old wording: 5 of 5 notes for a week where
   the person had to correct the sponsor said things like "I got some of my
   guesses wrong, and you called me on it", and 13 of 20 said "this week" to
   somebody who reads it days later. The prompt now forbids both and mostly
   gets it; this catches the rest so the note can be written once more.
   Returns why, or null. Looks at every field the page shows. */
const OWN_MISTAKE = /\b(?:my|mine)\b[^.!?\n]{0,25}\b(?:guess|guesses|guessing|guessed|mistakes?|misread(?:ing)?)\b|\bI\s+(?:got|had)\s+(?:it|that|some[^.!?\n]{0,20}|a lot[^.!?\n]{0,10})\s+wrong\b|\b(?:correct(?:ed|ing)?|called)\s+me\b|\bme\s+(?:keep\s+)?(?:missing|guessing)\b|\bthan mine\b|\bbefore I (?:could|understood|got it|caught up)\b|\bwhen I had it wrong\b|\bbetter than I (?:did|could)\b/i;
const NOW_WORDS = /\b(?:tonight|right now|this evening)\b/i;
/* 21 Nov 2026 (see the prompt): the safety question played back, the person
   written about as "his", a note that opens by describing itself. Only the
   lists are checked for he/his, because in the note itself "his" is usually
   somebody else (a father, a sponsor). */
const SAFETY_REPLAY = /\b(?:wanted to be here|want(?:ing)? to be here|not wanting to be here|ending your life|end your life|thoughts of (?:ending|not being|dying|suicide))\b|\bsuicid/i;
const THIRD_PERSON = /\b(?:he|she|his|her|him)\b/i;
const ABOUT_ITSELF = /^\W*(?:(?:hi|hey|hello)\s+)?(?:[A-Z][a-z]+,\s*)?(?:this (?:note|summary|message) is|here(?:'s| is) (?:your|the) (?:note|summary))/i;
// The note about the product instead of them (Chris's first notes, 21 Nov).
const ABOUT_PRODUCT = /\bwhat I (?:actually |really )?(?:am|can do|can and can'?t do|can and cannot do|can'?t do|cannot do)\b|\bwhat this (?:even |actually )?is\b|\bhow this works\b/i;

/* Every summary opens "Hi <name>," (Mariam, 21 Nov). The prompt asks for it;
   this makes it so in English, including on the cards written in code. Other
   languages are left to the prompt, since "Hi" in front of German or Spanish
   would be worse than no greeting. */
const GREETING = /^\s*(?:hi|hey|hello)\b/i;
function withGreeting(note, name) {
  const text = String(note || '').trim();
  const who = String(name || '').trim();
  // A greeting with no name ("Hey, I haven't heard from you") gets theirs.
  if (who && /^\s*(?:hi|hey|hello)\s*[,!.]\s*/i.test(text)) return text.replace(/^\s*(?:hi|hey|hello)\s*[,!.]\s*/i, `Hi ${who}, `);
  if (!text || GREETING.test(text)) return text;
  if (who && text.startsWith(`${who},`)) return `Hi ${text}`;
  const rest = /^I(?:\b|')/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
  return `Hi ${who || 'there'}, ${rest}`;
}
function noteSlip(payload) {
  const fields = [payload.note, payload.carried, payload.milestone, payload.nextWeek,
    ...(payload.helped || []), ...(payload.commitments || []), ...(payload.themes || [])]
    .filter(Boolean).join('\n');
  if (OWN_MISTAKE.test(fields)) return "talks about the sponsor's own guesses or mistakes";
  if (NOW_WORDS.test(fields)) return 'says tonight or right now to somebody reading it days later';
  if (SAFETY_REPLAY.test(fields)) return 'brings back the safety question';
  if (ABOUT_PRODUCT.test(fields)) return 'is about the sponsor, not them';
  const lists = [payload.milestone, ...(payload.helped || []), ...(payload.commitments || [])].filter(Boolean).join('\n');
  if (THIRD_PERSON.test(lists)) return 'writes about them as he or she';
  if (ABOUT_ITSELF.test(String(payload.note || ''))) return 'opens by describing the note';
  return null;
}

function parseModelJSON(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const attempt = (s) => { try { return coerce(JSON.parse(s)); } catch (e) { return null; } };
  const direct = attempt(cleaned);
  if (direct) return direct;
  // A sentence of commentary before or after the object is survivable; the
  // object itself still has to be whole.
  const open = cleaned.indexOf('{'), close = cleaned.lastIndexOf('}');
  return open !== -1 && close > open ? attempt(cleaned.slice(open, close + 1)) : null;
}

/* ── The quiet-week card ────────────────────────────────────────────────────
   Written here, in code, with no model involved. There is nothing to analyse in
   two messages, and this is the honest thing to show instead of a summary that
   sounds like there was. */
function quietWeekCard({ sponsorName, messages, activeDays, lang = 'en' }) {
  const who = sponsorName || 'your sponsor';

  /* Nothing at all this week: the check-in wording, not a report about a quiet
     week. Used for en/es/fr/de; anybody else keeps the older card in their own
     language below, or English where there is none. */
  if (messages === 0) {
    const s = copy.SILENT_CARD[lang] || (copy.QUIET_CARD[lang] ? null : copy.SILENT_CARD.en);
    if (s) {
      return {
        note: s.note,
        themes: [], carried: null, helped: [], commitments: [], milestone: null,
        nextWeek: s.nextWeek, tone: 'quiet', _by: who,
      };
    }
  }

  const translated = copy.QUIET_CARD[lang];
  if (translated) {
    return {
      note: messages === 0 ? translated.none : translated.some,
      themes: [], carried: null, helped: [], commitments: [], milestone: null,
      nextWeek: translated.nextWeek, tone: 'quiet', _by: who,
    };
  }
  const note = messages === 0
    ? `We didn't talk last week. That's allowed, and it doesn't undo anything. I'm here when you want me, and there's no catching up to do first.`
    /* No counts (21 Nov): "just 2 messages across 1 day" followed by "I'm not
       keeping score" was a score, and the summary is the overall feel. */
    : `Last week was a quiet one between us, and that's okay, it's not a failure. Whenever you want to talk properly, I'm here.`;
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
  let plan = planWeek(stats);

  /* THE OLD RULE, reversed 26 Sep 2026 by Mariam. This used to say: nobody who
     said nothing all week gets a row, because a nudge about silence "would land
     as a product noticing they went quiet, which is not the same thing as their
     sponsor noticing". She decided the opposite: a person who went quiet is
     exactly who should hear from their sponsor, once, without an agenda.

     Two things stay true. The wiped week is still skipped: they turned up but
     asked us to forget what was said, activity_days remembers that, and only a
     week with NO activity at all counts as silence. And only the sweep's own
     quiet list can ask for this (opts.silent), never a person opening their
     page, so it cannot be triggered by anything but the guarded query. */
  if (plan === 'skip' && opts.silent && SILENT_ON && !(Number(stats.messages) > 0)) plan = 'silent';
  if (plan === 'skip') return { status: 'skipped', reason: 'no-readable-messages', week };

  const profile = (await db.getProfile(userId).catch(() => null)) || {};
  const user = (await db.getUser(userId).catch(() => null)) || {};
  const sponsorName = profile.sponsorName || user.sponsor_name || '';
  const theirName = String(profile.name || user.name || '').trim().split(/\s+/)[0] || '';

  /* The language they talk to their sponsor in. The model writes the note in
     any of the sixteen; the card written in code exists in the notice six. */
  const lang = await language.languageOf(db, userId);

  /* When they first arrived, across every row they hold (website and WhatsApp
     are written separately), so the note can tell a first week from the
     tenth. A first week is a welcome, not a verdict (Mariam, 21 Nov). */
  let joined = user.signup_date ? new Date(user.signup_date) : null;
  try {
    const ids = typeof db.findAllIdentities === 'function' ? await db.findAllIdentities(userId) : [];
    for (const id of ids || []) {
      if (id === userId) continue;
      const other = await db.getUser(id).catch(() => null);
      const at = other && other.signup_date ? new Date(other.signup_date) : null;
      if (at && (!joined || at < joined)) joined = at;
    }
  } catch { /* the row we have is enough */ }

  let payload;
  if (plan === 'silent') {
    payload = quietWeekCard({ sponsorName, messages: 0, activeDays: 0, lang: language.noticeLanguage(lang) });
  } else if (plan === 'quiet') {
    payload = quietWeekCard({ sponsorName, messages: have, activeDays: stats.activeDays, lang: language.noticeLanguage(lang) });
  } else {
    payload = await writeNarrative({ userId, week, stats, sponsorName, theirName, lang, joined }).catch((e) => {
      console.error('[weekly] model call failed:', e.message);
      return null;
    });
    /* A model failure must not burn the week. No row is written, so the next
       trigger — the person opening their dashboard, tomorrow's cron — tries
       again against the same closed window and gets the same chance. */
    if (!payload) return { status: 'failed', reason: 'model', week };
  }
  // "Hi <name>," on every English note, the code-written cards included.
  if (language.noticeLanguage(lang) === 'en') payload.note = withGreeting(payload.note, theirName);
  // American spelling on English notes, every field they read (spelling.js).
  if (spelling.isEnglish(lang)) americanizeNote(payload);

  /* The count shown on the card is `readable` too, so the number and the note
     can never disagree. Displaying the historical 15 next to a note written
     from 2 surviving messages tells somebody their sponsor read things it
     could not read. */
  /* `silent: true` is the marker db.usersQuietForWeekly counts to stop after two
     unanswered notes, and what deliver() reads to skip the free-text attempt.
     No day strip for a silent week: "no days together" laid out as a chart
     reads as a report card, which is the opposite of the note. */
  const savedStats = plan === 'silent'
    ? { messages: 0, activeDays: 0, days: [], silent: true }
    : { messages: have, activeDays: stats.activeDays, days: stats.days };
  const written = await db.saveWeeklySummary(userId, week.start, week.end, payload, savedStats).catch((e) => {
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

  console.log(`[weekly] wrote ${userId} for ${week.start}..${week.end} (${plan === 'silent' ? 'silent week' : `${have} readable of ${stats.messages} logged`}, tone ${payload.tone})`);
  return { status: 'created', week, summary: { ...payload, week_start: week.start, week_end: week.end, stats: savedStats } };
}

async function writeNarrative({ userId, week, stats, sponsorName, theirName, lang = 'en', joined = null }) {
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
    tenureLine(joined, week),
    lang !== 'en' && language.LANGUAGE_NAMES[lang]
      ? `They talk to you in ${language.LANGUAGE_NAMES[lang]}. Write every text field of the JSON in ${language.LANGUAGE_NAMES[lang]}. "tone" stays one of the three English words.`
      : '',
    weekEvents.length ? `Account things that happened this week: ${weekEvents.join(', ')}.` : '',
    memory && memory.digest
      ? `BACKGROUND you already know about them from before this week — context only, do NOT summarize it back to them, the note is about this week:\n${memory.digest}`
      : '',
  ].filter(Boolean).join('\n');

  /* Two tries. If both come back unusable nothing is saved, so the week is not
     burned: the next trigger (their page opening, the next hourly sweep) tries
     again, and nobody is messaged about a note that does not exist. The stop
     reason is logged, never the content.

     max_tokens was 1200, which was the real cause of the 13 Sep breakage.
     Render sets WEEKLY_MODEL to claude-sonnet-5, which thinks by default, and
     thinking counts against max_tokens: the log showed stop_reason max_tokens
     with 0 to 656 characters of actual text. 16000 leaves room for the
     thinking and the note; a short note still costs only what it uses. */
  /* New only when we KNOW they joined inside this week. An unknown date counts
     as not new: calling somebody who has been here for months "new" is the
     mistake that must not happen, and a missing welcome costs nothing. */
  const firstWeek = isFirstWeek(joined, week);
  for (let attemptNo = 1; attemptNo <= 2; attemptNo++) {
    const resp = await client.messages.create({
      _who: userId,
      model: WEEKLY_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [{
        role: 'user',
        content: `${context}\n\nTHIS WEEK'S CONVERSATION:\n${transcript}`,
      }],
    });

    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const payload = parseModelJSON(text);
    /* A note that talks about the sponsor's own guesses, or says "tonight" to
       somebody reading it days later, is written once more (see noteSlip). The
       second one is kept whatever it says: a note is still worth more than no
       note, and the rules in the prompt hold most of the time on their own. */
    const slip = payload && attemptNo < 2
      ? (noteSlip(payload) || (!firstWeek && claimsFirstWeek(payload) ? 'calls a long-standing member new' : null))
      : null;
    if (slip) {
      console.warn(`[weekly] note for ${userId} ${slip}; writing it again`);
      continue;
    }
    /* Mariam, 21 Nov: "if the user is not a new user, never say this is our
       first week together". If the second note still says it, the sentence
       goes, rather than the claim. */
    if (payload && !firstWeek) dropFirstWeekClaim(payload);
    if (payload) return payload;
    console.warn(`[weekly] unusable reply for ${userId} (attempt ${attemptNo} of 2, stop_reason ${resp.stop_reason}, ${text.length} chars)`);
  }
  return null;
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
/* Remember that this message went out so its delivery receipt has somewhere to
   land. Only Meta ids are kept: a Twilio result has no wamid, and there is no
   receipt to wait for. Fire and forget, and it can never fail a delivery. */
function trackOutbound(userId, result, via) {
  const id = result && result.messageId;
  if (!id || typeof db.recordOutbound !== 'function') return;
  db.recordOutbound(userId, id, 'weekly', via).catch(() => {});
}

/* ── The note as a message: wording and routing ────────────────────────────
   On unless WEEKLY_NOTE_AS_TEXT=off, which puts back the old link message for
   everybody without a deploy. */
const NOTE_AS_TEXT = String(process.env.WEEKLY_NOTE_AS_TEXT || 'on').toLowerCase() !== 'off';
const NOTE_TEMPLATE = 'week_in_summary';            // heading + note
const NOTE_NEXT_TEMPLATE = 'week_in_summary_next';  // heading + note + one thing for this week
const CHECKIN_TEMPLATE = 'checking_in_note';        // somebody who did not write at all
// The code-written cards end on "No task from me", which needs no line of its own.
const NO_TASK = /^\s*no task from me/i;

function nextLine(payload) {
  const n = String((payload && payload.nextWeek) || '').trim();
  return n && !NO_TASK.test(n) ? n : '';
}

/* Exactly what they read. A bold line first, so it never starts out of
   context; one greeting (the note's own "Hi <name>,"); short paragraphs. */
function noteMessage(payload, week) {
  const note = String((payload && payload.note) || '').trim();
  if (payload && payload.stats && payload.stats.silent) return `*Checking in*\n\n${note}`;
  const next = nextLine(payload);
  return `*Your week in summary, ${prettyRange(week.start, week.end)}*\n\n${note}` +
    (next ? `\n\n*One thing for this week:* ${next}` : '') +
    '\n\nReply here any time.';
}

/* Meta does not deliver marketing templates to US numbers. Read from the
   number itself; a +1 number we cannot place counts as US, because the old
   template reaches everybody and the new one might reach nobody. */
function isUSNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!(digits.startsWith('1') && digits.length === 11)) return false;
  try {
    const at = require('./countries').place(digits);
    return !at.country || at.country === 'United States';
  } catch { return true; }
}

async function deliverNoteTemplate(phone, payload, week, theirName) {
  let metacloud;
  try { metacloud = require('./metacloud'); } catch { return false; }
  if (!metacloud.enabled || !metacloud.sendTemplate) return false;
  // Meta refuses a variable with a line break, a tab or four spaces in a row.
  const flat = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  let name;
  let params;
  if (payload.stats && payload.stats.silent) {
    name = CHECKIN_TEMPLATE;
    params = [flat(theirName) || 'there'];
  } else {
    const note = flat(payload.note);
    const next = flat(nextLine(payload));
    if (!note || note.length + next.length > 900) return false;
    name = next ? NOTE_NEXT_TEMPLATE : NOTE_TEMPLATE;
    params = next ? [prettyRange(week.start, week.end), note, next] : [prettyRange(week.start, week.end), note];
  }
  try {
    const sent = await metacloud.sendTemplate(`whatsapp:${phone}`, name, params, null, 'en_US');
    console.log(`[weekly] note delivered via ${name}${sent && sent.messageId ? ' ' + sent.messageId : ''}`);
    return sent || true;
  } catch (err) {
    console.warn(`[weekly] ${name} failed: ${err.message}`);
    return false;
  }
}

/* One-off second messages after somebody's note, set in the Render env so no
   member's number is ever in this public repo (21 Nov: Dipen's answer about the
   price, Chris's meetings link). WEEKLY_AFTER is JSON:
     { "<user id>": { "week": "2026-11-15", "template": "...", "params": [...], "text": "..." } }
   Sent only for that one week, right after that person's note: as text inside
   their window, as the template outside it. Kept in their conversation too. */
function afterFor(userId, week) {
  let all = {};
  try { all = JSON.parse(process.env.WEEKLY_AFTER || '{}') || {}; } catch { return null; }
  const a = all[userId];
  return a && a.week === week.start && (a.text || a.template) ? a : null;
}

async function sendAfter(userId, phone, week, insideWindowNow, whatsapp) {
  const a = afterFor(userId, week);
  if (!a) return false;
  await new Promise((r) => setTimeout(r, AFTER_GAP_MS));
  try {
    if (insideWindowNow && a.text) {
      await whatsapp.sendTextReply(`whatsapp:${phone}`, a.text);
    } else if (a.template) {
      const metacloud = require('./metacloud');
      await metacloud.sendTemplate(`whatsapp:${phone}`, a.template, a.params || [], null, 'en_US');
    } else {
      return false;
    }
    if (a.text) await db.appendMessages(userId, [{ role: 'assistant', content: a.text, medium: 'text' }]).catch(() => {});
    await db.recordEvent(userId, 'weekly_after_sent', { week: week.start, template: a.template || null }, 'weekly').catch(() => {});
    console.log(`[weekly] second message sent to ${userId}`);
    return true;
  } catch (err) {
    console.warn(`[weekly] second message to ${userId} failed: ${err.message}`);
    return false;
  }
}
const AFTER_GAP_MS = parseInt(process.env.WEEKLY_AFTER_GAP_MS || '3000', 10);

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
  /* The same name the note writer uses (profile first, then the registration
     row). This read only users.name, so anyone whose name is saved only in
     their profile got "Hi there". Spotted when Matt got "Hi there" on 22 Nov;
     his own name is not saved anywhere yet, so he keeps it until he registers. */
  const profile = (db.getProfile ? await db.getProfile(userId).catch(() => null) : null) || {};
  const theirName = String(profile.name || user.name || '').trim().split(/\s+/)[0];
  const hi = theirName ? `${theirName}, ` : '';

  const lang = language.noticeLanguage(await language.languageOf(db, userId));

  /* ── The note itself is the message (Mariam, 21 Nov 2026) ──────────────────
     "I just want the direct text message", no link. English only for now: the
     new templates exist in English, and everybody else keeps the path below.
     Who gets what:
       inside their 24-hour window  -> the note as plain text
       outside it, not a US number  -> the note in an approved template
       outside it, a US number      -> the old utility template with the page
                                       link, because Meta files the note
                                       templates as marketing and does not
                                       deliver marketing to US numbers at all
     Anything that does not go falls back to the old template, never to nothing. */
  if (NOTE_AS_TEXT && lang === 'en') {
    const text = noteMessage(payload, week);
    const inside = await window24.insideWindow(db, phone);
    let sentNote = null;
    let via = null;
    if (inside !== false) {
      try { sentNote = await whatsapp.sendTextReply(`whatsapp:${phone}`, text); via = 'text'; }
      catch (e) { console.warn(`[weekly] note as text to ${userId} failed: ${e.message}`); }
    }
    if (!sentNote && !isUSNumber(phone)) {
      sentNote = await deliverNoteTemplate(phone, payload, week, theirName);
      if (sentNote) via = 'note-template';
    }
    if (sentNote) {
      await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
      trackOutbound(userId, sentNote, via === 'text' ? 'text' : 'template');
      /* Kept in their conversation, so if they answer the note their sponsor
         knows what it said. */
      await db.appendMessages(userId, [{ role: 'assistant', content: text, medium: 'text' }]).catch(() => {});
      await sendAfter(userId, phone, week, via === 'text', whatsapp);
      return { sent: true, via };
    }
    const sentOld = await deliverTemplate(phone, payload, theirName, token, lang);
    if (sentOld) {
      await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
      trackOutbound(userId, sentOld, 'template');
      return { sent: true, via: 'template' };
    }
    await db.markWeeklyDelivered(userId, week.start, false, 'note-and-template-failed').catch(() => {});
    return { sent: false, reason: 'note-and-template-failed' };
  }

  /* A silent week: the person has not written since before the week began, so
     they are outside the 24 hour window by definition and a free-text send
     could only fail. Straight to an approved template, which is the only thing
     WhatsApp lets through, rather than trying text first and depending on how
     Meta chooses to refuse it. Which template is picked, and why it is a
     utility one for US numbers, is deliverTemplate's business. */
  if (payload.stats && payload.stats.silent) {
    const sentT = await deliverTemplate(phone, payload, theirName, token, lang);
    if (sentT) {
      await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
      trackOutbound(userId, sentT, 'template');
      return { sent: true, via: 'template', silent: true };
    }
    await db.markWeeklyDelivered(userId, week.start, false, 'silent-template-failed').catch(() => {});
    return { sent: false, reason: 'silent-template-failed' };
  }

  /* A hard week does not get a cheerful "here's your week in review". The
     wording changes with the tone for the same reason the note does. */
  const body = lang !== 'en'
    ? copy.weeklyBody(lang, payload.tone, { first: theirName, link })
    : payload.tone === 'hard'
    ? `${hi}I've been thinking about your week. I wrote a few things down for you, only if you want them:\n\n${link}\n\nNo need to reply. I'm here either way.`
    : payload.tone === 'quiet'
      ? `${hi}quiet week between us, which is fine. I left you a short note here if you want it:\n\n${link}`
      : `${hi}I looked back over your week and wrote it down for you. It's here whenever you want it:\n\n${link}`;

    /* One extra line, once, on the first weekly note after the policy went up.
       Matt asked for a "our privacy policy is updated, click here" rather than
       a separate broadcast, and this is the cheapest honest version: it rides a
       message already going out, needs nothing from Meta, and the link lands on
       the page that carries the notice.

       WARNING, free-text path ONLY. Anybody outside the 24-hour window gets the
       approved template instead, whose body Meta fixed and we cannot add to, so
       they meet the notice when they open the link rather than in the message.
       That is why the banner on the settings page is the real mechanism and
       this line is only the nudge. */
    const withNotice = PRIVACY_NOTICE
      ? body + (lang !== 'en' ? copy.WEEKLY[lang].privacy : PRIVACY_NOTICE_LINE)
      : body;

  /* Outside the window, go straight to the template. Trying text first does not
     work on Meta: the send is accepted and refused later, so the catch below
     never sees 131047. See window24.js. */
  if ((await window24.insideWindow(db, phone)) === false) {
    const sent = await deliverTemplate(phone, payload, theirName, token, lang);
    if (sent) {
      await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
      trackOutbound(userId, sent, 'template');
      return { sent: true, via: 'template' };
    }
    console.warn(`[weekly] delivery to ${userId} failed (outside 24h window, template refused)`);
    await db.markWeeklyDelivered(userId, week.start, false, 'outside-24h').catch(() => {});
    return { sent: false, reason: 'outside-24h' };
  }

  try {
    const sentMsg = await whatsapp.sendTextReply(`whatsapp:${phone}`, withNotice);
    await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
    trackOutbound(userId, sentMsg, 'text');
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
      const sent = await deliverTemplate(phone, payload, theirName, token, lang);
      if (sent) {
        await db.markWeeklyDelivered(userId, week.start, true, null).catch(() => {});
        trackOutbound(userId, sent, 'template');
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
/* Off by default. Matt wants to see the wording and the page before this goes
   near a real person, so it ships dark and is switched on after he has looked.
   Turn it off again once the cohort has been told: this is a one-time notice,
   not a permanent footer on every weekly note. */
const PRIVACY_NOTICE = String(process.env.WEEKLY_PRIVACY_NOTICE || '').toLowerCase() === 'on';
const PRIVACY_NOTICE_LINE = `

We have also updated our privacy policy, which explains what I keep and how to delete it. It is linked at the top of that page.`;

const WEEKLY_TEMPLATES = {
  hard:  'weekly_review_hard',
  quiet: 'weekly_review_quiet',
  good:  'weekly_review',
};

/* Mariam, Sep 17: everyone gets told their weekly note is there, in their own
   language, safely. Meta filed weekly_review_quiet and _hard as MARKETING in
   every language, and weekly_review too in German, French, Italian, Portuguese
   and Russian. WhatsApp does not deliver MARKETING templates to US numbers and
   caps them per person everywhere else (error 131049), and the cap fails
   silently. So a tone template is only used where Meta has it as an approved
   UTILITY template; otherwise this plain notice goes, which says only that the
   note is ready and links to it. The warmth is in the note itself, on the page.
   Submitted as UTILITY in all seven languages on Sep 17; the wording is in
   notice-copy.js (WEEKLY_READY) and, for English, here. */
const WEEKLY_READY_TEMPLATE = 'weekly_note_ready';

/* Meta filed weekly_note_ready as UTILITY in German and Portuguese and as
   MARKETING in French, Italian and Russian, while weekly_review went the other
   way: UTILITY in English and Spanish only. Nothing in the wording explains the
   split, so French, Italian and Russian readers were left with the English
   notice. This is a third wording for those three, as dry as a statement
   notice, submitted as UTILITY on Sep 17. It is tried after the other two, so a
   language that already has a warmer approved notice keeps it. */
const WEEKLY_SUMMARY_TEMPLATE = 'weekly_summary_ready';

/* Meta approved that one as UTILITY in Italian and Russian within the hour and
   called the French translation marketing for the third time. So French gets a
   fourth wording, leading with the account update itself and saying nothing
   about what is in the note. If this one is refused too, French needs the
   category review in WhatsApp Manager, which only a person can file. */
const WEEKLY_ACCOUNT_TEMPLATE = 'weekly_account_update';

/* The same plain notice in the nine languages the automatic messages did not
   speak until Sep 17. Its own name for the same reason as the others: Meta ties
   one category to a name, and weekly_note_ready already carries MARKETING
   translations. Wording is WEEKLY_READY[lang] in notice-copy-extra.js. */
const WEEKLY_NOTE_UPDATE_TEMPLATE = 'weekly_note_update';
const WEEKLY_READY_EN = 'Hi {{1}}, your weekly note from AI Sponsor is ready. You can read it on your account page with the button below.';

/* Returns true only if it actually sent. Every failure is swallowed and logged:
   this is already the fallback path, and there is nothing further to fall back
   to. A person not receiving a nudge is a missed warmth, not a broken product,
   and the summary is still waiting on their dashboard either way. */
async function deliverTemplate(phone, payload, theirName, token, lang = 'en') {
  let metacloud;
  try { metacloud = require('./metacloud'); } catch { return false; }
  if (!metacloud.enabled || !metacloud.sendTemplate) return false;

  const name = WEEKLY_TEMPLATES[payload.tone] || WEEKLY_TEMPLATES.good;
  /* Meta rejects an empty variable, and plenty of people never gave a name, so
     it falls back to something a sponsor would actually say out loud, in the
     language of the template it lands in. */
  const first = String(theirName || '').trim();

  try {
    /* The plain notice speaks as the service, so a missing name gets the
       service greeting ("Bonjour à vous"), not the sponsor's ("Salut toi"). */
    const sent = await language.sendTemplateIn(metacloud, `whatsapp:${phone}`, name, lang,
      (l, n) => [first || (n === WEEKLY_TEMPLATES[payload.tone] || n === WEEKLY_TEMPLATES.good
        ? copy.SPONSOR_NAME_FALLBACK[l]
        : copy.SERVICE_NAME_FALLBACK[l])],
      `${token}#week`,
      /* Meta's answer, Sep 17: it kept weekly_note_ready as UTILITY only in
         German and Portuguese, but weekly_review, the everyday wording, is
         UTILITY in English and Spanish. weekly_summary_ready then covers French,
         Italian and Russian. Each name is only used where Meta has that exact
         translation approved as UTILITY, so the warmest approved wording in
         each language wins, and English is the floor nobody should reach. */
      { mustArrive: true,
        alsoTry: [WEEKLY_READY_TEMPLATE, WEEKLY_SUMMARY_TEMPLATE, WEEKLY_ACCOUNT_TEMPLATE,
          WEEKLY_NOTE_UPDATE_TEMPLATE, WEEKLY_TEMPLATES.good] });
    console.log(`[weekly] delivered via template${sent && sent.messageId ? ' ' + sent.messageId : ''} (tone ${payload.tone || 'good'}, ${lang})`);
    /* Truthy either way, so every existing caller that only asks "did it send"
       is unchanged. The object carries the message id when there is one, which
       is what lets the delivery receipt be tied back to this send. */
    return sent || true;
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
async function runSweep({ limit = 25, whatsapp = null, week = null, ignoreWindow = false } = {}) {
  if (!db.enabled) return { ok: false, reason: 'no-db' };

  const w = week || lastCompletedWeek();
  const dueActive = await db.usersDueForWeekly(w.start, w.end, limit).catch((e) => {
    console.error('[weekly] due query failed:', e.message);
    return [];
  });

  /* And the people who wrote nothing: see db.usersQuietForWeekly. A separate
     list, tagged, so a quiet person can never be mistaken for an active one and
     is only ever given the check-in card. Not capped by `limit`: most of them
     are outside their own Sunday morning on any run, and that check costs
     nothing. */
  /* Not on a Saturday UTC unless a week was asked for by name. Those evening
     runs exist so Sydney's Sunday morning is covered, but the week they see is
     still the previous one, and a silent note written against last week's label
     would be a stale card. The same people are picked up from 00:00 UTC, when
     the week has flipped and they are still inside their own morning. */
  const silentToday = SILENT_ON && (!!week || new Date().getUTCDay() !== 6);
  const dueQuiet = silentToday
    ? await db.usersQuietForWeekly(w.start, w.end, 100, SILENT_STOP_AFTER).catch((e) => {
        console.error('[weekly] quiet query failed:', e.message);
        return [];
      })
    : [];
  const due = dueActive.concat(dueQuiet.map((x) => ({ ...x, silent: true })));

  const out = { week: w, considered: due.length, consideredSilent: dueQuiet.length,
                created: 0, createdSilent: 0, skipped: 0, failed: 0,
                delivered: 0, deliveredSilent: 0, waiting: 0, unplaceable: [], notDelivered: {} };

  for (const { userId, phone, silent } of due) {
    /* Wait for their own Sunday morning. This runs hourly, so Sydney is
       picked up when it is 9am there and California sixteen hours later,
       from the same schedule. Anyone we cannot place is held rather than
       guessed at: a confident 6am message about somebody's recovery week is
       worse than a late one. Where they told their sponsor they live beats
       their number (29 Oct: a Georgian number, living in Germany). */
    const saved = await savedZone(userId);
    if (!ignoreWindow && !insideTheirWindow(phone, new Date(), saved)) {
      out.waiting++;
      /* Two very different reasons to skip somebody, and only one of them
         resolves on its own. Not their morning yet is fine, a later run gets
         them. Cannot place them at all means they will be skipped every run
         forever, which is what happened to Bilal on a +92 number, so it is
         named rather than counted. */
      if (!tz.zoneFor(saved, phone)) out.unplaceable.push(userId);
      continue;
    }

    const r = await ensureWeeklySummary(userId, { week: w, silent: !!silent });
    if (r.status === 'created') {
      out.created++;
      if (silent) out.createdSilent++;
      const d = await deliver(userId, r.summary, w, whatsapp);
      if (d.sent) { out.delivered++; if (silent) out.deliveredSilent++; }
      else out.notDelivered[d.reason] = (out.notDelivered[d.reason] || 0) + 1;
    } else if (r.status === 'failed') out.failed++;
    else out.skipped++;
  }

  /* Loud on purpose. A permanent hold is a person who never hears from their
     sponsor again, and it used to be invisible inside a count. */
  if (out.unplaceable.length) {
    console.error(`[weekly] CANNOT PLACE ${out.unplaceable.length} user(s), they will be skipped every run until countries.js knows their country: ${out.unplaceable.join(', ')}`);
  }

  if (out.created || out.failed) {
    console.log(`[weekly] sweep ${w.start}..${w.end}: ${out.created} written (${out.createdSilent} silent), ${out.delivered} delivered (${out.deliveredSilent} silent), ${out.failed} failed, ${out.skipped} skipped`);
  }
  return { ok: true, ...out };
}

/* ── Their Sunday morning ───────────────────────────────────────────────────
   Matt: "they should all get it Sundays ... between 9 am - 12 pm there local
   time". Nine to noon on the Sunday where THEY are, which is not one moment
   and not even one day: 15:00 UTC is Monday morning in California and 1am on
   Tuesday in Sydney.

   False when we cannot place somebody, so they are held for a human to look
   at rather than messaged at a guessed hour. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 12;

function insideTheirWindow(phone, now = new Date(), saved = null) {
  const zone = tz.zoneFor(saved, phone);
  if (!zone) return false;
  if (tz.localDay(zone, now) !== 0) return false;      // 0 = Sunday, where they are
  const hour = tz.localHour(zone, now);
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

/* The zone they told their sponsor they live in (whatsapp.js saves it), or
   null. A failed read is null too, which is their number, as before. */
async function savedZone(userId) {
  if (typeof db.getProfile !== 'function') return null;
  const p = await db.getProfile(userId).catch(() => null);
  return tz.validZone(p && p.zone);
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

/* Trigger 4: the server's own clock, now the one that carries Sunday.
   Since 29 Oct the service is on a paid plan and never sleeps (Mubashir), so
   it can do what the free tier could not: look every 15 minutes while it is
   Sunday morning somewhere, which is Saturday 18:00 UTC (Sunday 9am in the
   Pacific islands) to the end of Sunday UTC, the same span the GitHub schedule
   asks for. The GitHub schedule stays as a backup, but on its own it is not
   enough. On 1 Nov GitHub skipped its runs from 05:52 to 13:05 and from 13:11
   to 18:24 UTC, so Europe's and the US East Coast's 9 to noon passed with no
   sweep at all: 10 reviews written against 42 the Sunday before. A missed
   window is a missed week, because the next run sees the week after.
   One sweep at a time: a slow one (each review is a model call) must not
   overlap the next. unref() so it can never hold the process open. */
const SWEEP_EVERY_MS = 15 * 60 * 1000;

function sundaySomewhere(now = new Date()) {
  return now.getUTCDay() === 0 || (now.getUTCDay() === 6 && now.getUTCHours() >= 18);
}

let sweeping = false;
function startInterval(whatsapp) {
  if (!db.enabled) return null;
  const t = setInterval(() => {
    if (sweeping || !sundaySomewhere()) return;
    sweeping = true;
    runSweep({ limit: 10, whatsapp })
      .catch((e) => console.error('[weekly] interval sweep failed:', e.message))
      .finally(() => { sweeping = false; });
  }, SWEEP_EVERY_MS);
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
  _planWeek: planWeek, _insideTheirWindow: insideTheirWindow, _sundaySomewhere: sundaySomewhere,
  _SYSTEM_PROMPT: SYSTEM_PROMPT, _WEEKLY_MODEL: WEEKLY_MODEL, _noteSlip: noteSlip,
  _withGreeting: withGreeting, _tenureLine: tenureLine,
  _noteMessage: noteMessage, _isUSNumber: isUSNumber, _afterFor: afterFor,
  _isFirstWeek: isFirstWeek, _claimsFirstWeek: claimsFirstWeek, _dropFirstWeekClaim: dropFirstWeekClaim,
  WEEKLY_TEMPLATES, WEEKLY_READY_TEMPLATE, WEEKLY_READY_EN,
};
