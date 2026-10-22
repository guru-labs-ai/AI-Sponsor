/* ─── Real meetings the sponsor can hand out ─────────────────────────────────
   Until 20 Oct the sponsor had no meeting data at all. Asked for a meeting it
   could only name a website, and asked "which meetings are good" it had nothing
   to work with. meetings-refresh.js builds meetings-data.json from the
   fellowships' own directories (rules and their reasons live there); this file
   is the read side: which of those meetings are next for this person, in their
   own time.

   Two guards, both because a wrong link is worse than none:
   - the block is only added when their message is about meetings, and it
     tells the sponsor to copy links exactly and never offer anything else
   - a list older than STALE_AFTER_DAYS is never shown. The sponsor gets the
     official finder instead, which is exactly where it was before this existed.

   Never throws. Anything unexpected returns '' and the reply goes out without
   meeting data, which is the old behaviour, not a failure.
──────────────────────────────────────────────────────────────────────────── */
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'meetings-data.json');
const STALE_AFTER_DAYS = 21;
const PER_PROGRAM = 6;

/* Covered programs, and how somebody's signup answer names them. Registration
   stores the short code; the long names are there for people who typed it.
   "S Anon" and "Chronic Pain Anon" are real answers, so Al-Anon matches whole. */
const PROGRAMS = {
  DA: { match: /^(da|debtors anonymous)$/i, label: 'Debtors Anonymous', finder: 'https://debtorsanonymous.org/meeting-info/' },
  BDA: { match: /^(bda|business debtors anonymous)$/i, label: 'Business Debtors Anonymous', finder: 'https://debtorsanonymous.org/meeting-info/' },
  WA: { match: /^(wa|workaholics anonymous)$/i, label: 'Workaholics Anonymous', finder: 'https://workaholics-anonymous.org/meetings/' },
  UA: { match: /^(ua|underearners anonymous)$/i, label: 'Underearners Anonymous', finder: 'https://underearnersanonymous.org/meetings-underearners-anonymous/' },
  ACA: { match: /^(aca|adult children of alcoholics( (and|&) dysfunctional families)?)$/i, label: 'Adult Children of Alcoholics', finder: 'https://adultchildren.org/meeting-search/' },
  'Al-Anon': { match: /^(al-?anon|al anon)$/i, label: 'Al-Anon', finder: 'https://al-anon.org/al-anon-meetings/find-an-al-anon-meeting/' },
  AA: { match: /^(aa|alcoholics anonymous)$/i, label: 'Alcoholics Anonymous', finder: 'https://www.aa.org/find-aa' },
  NA: { match: /^(na|narcotics anonymous)$/i, label: 'Narcotics Anonymous', finder: 'https://www.na.org/meetingsearch/' },
  OA: { match: /^(oa|overeaters anonymous)$/i, label: 'Overeaters Anonymous', finder: 'https://oa.org/find-a-meeting/' },
  SLAA: { match: /^(slaa|sex and love addicts anonymous)$/i, label: 'Sex and Love Addicts Anonymous', finder: 'https://slaafws.org/onlinemeetings/' },
};

/* Programs people sign up with that we hold no meetings for yet. For these the
   sponsor leads with the official finder, never with "I can't" (Mariam, 21 Oct:
   "What kind of a start is that?"). Every link was checked live on 21 Oct; a
   program without a checked link is named, never given a made-up one. Food
   Addicts Anonymous is left out on purpose: foodaddicts.org is a different
   fellowship (Food Addicts in Recovery Anonymous). */
const OTHERS = {
  GA: { match: /^(ga|gamblers anonymous)$/i, mention: [/\bGA\b/, /\bgamblers anonymous\b|\bga(?=\s+(meetings?|groups?|zoom))/i], label: 'Gamblers Anonymous', finder: 'https://gamblersanonymous.org/find-a-meeting/' },
  MA: { match: /^marijuana anonymous$/i, mention: [/\bmarijuana anonymous\b/i], label: 'Marijuana Anonymous', finder: 'https://www.marijuana-anonymous.org/meetings' },
  'S-Anon': { match: /^s[- ]?anon\b/i, mention: [/\bs-?\s?anon\b/i], label: 'S-Anon', finder: 'https://sanon.org/find-a-meeting/' },
  EDA: { match: /^eating disorders anonymous$/i, mention: [/\beating disorders anonymous\b/i], label: 'Eating Disorders Anonymous', finder: 'https://eatingdisordersanonymous.org/meetings/' },
  CPA: { match: /^chronic pain anon(ymous)?$/i, mention: [/\bchronic pain anon(ymous)?\b/i], label: 'Chronic Pain Anonymous', finder: 'https://www.chronicpainanonymous.org/meetings' },
  CoDA: { match: /^(coda|co-dependents anonymous|codependents anonymous)$/i, mention: [/\bCoDA\b/, /\bco-?dependents anonymous\b/i], label: 'Co-Dependents Anonymous', finder: null },
};

// Broad on purpose: a false positive costs a few hundred tokens, a miss costs
// somebody a meeting. The block itself tells the sponsor to ignore it when
// "meeting" turns out to mean meeting a friend.
const ASKS = /\b(meetings?|zoom|home ?group|online group)\b/i;

let cache = null;
function load() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(data.meetings) || !data.generatedAt) return null;
    cache = data;
    return cache;
  } catch {
    return null;
  }
}

function asksAboutMeetings(text) {
  return ASKS.test(String(text || ''));
}

/* A program named in the message counts, whatever registration stored. People
   who started on WhatsApp have no program on file (5 of 42 on 21 Oct, Matt
   among them, whose test got no meetings at all), and anyone may ask about a
   second program. Short codes count in capitals anywhere, or in any case right
   before "meeting", so "da" or "wa" inside ordinary words never match. */
const BEFORE_MEETING = '(?=\\s+(meetings?|groups?|zoom))';
const MENTIONS = {
  DA: [/\bDA\b/, new RegExp(`(?<!business )\\bdebtors anonymous\\b|\\bda${BEFORE_MEETING}`, 'i')],
  BDA: [/\bBDA\b/, new RegExp(`\\bbusiness debtors anonymous\\b|\\bbda${BEFORE_MEETING}`, 'i')],
  WA: [/\bWA\b/, new RegExp(`\\bworkaholics anonymous\\b|\\bwa${BEFORE_MEETING}`, 'i')],
  UA: [/\bUA\b/, new RegExp(`\\bunderearners anonymous\\b|\\bua${BEFORE_MEETING}`, 'i')],
  ACA: [/\bACA\b/, new RegExp(`\\badult children of alcoholics\\b|\\baca${BEFORE_MEETING}`, 'i')],
  'Al-Anon': [/\bal-?\s?anon\b/i],
  AA: [/\bAA\b/, new RegExp(`\\balcoholics anonymous\\b|\\baa${BEFORE_MEETING}`, 'i')],
  NA: [/\bNA\b/, new RegExp(`\\bnarcotics anonymous\\b|\\bna${BEFORE_MEETING}`, 'i')],
  OA: [/\bOA\b/, new RegExp(`\\bovereaters anonymous\\b|\\boa${BEFORE_MEETING}`, 'i')],
  SLAA: [/\bslaa\b/i, /\bsex and love addicts anonymous\b/i],
};
/* Inside a conversation about meetings, people write "Ua?", "Bda?", "how about
   right now for da" and "al-anob" (21 Oct, Matt and Mariam). Short names then
   count in any case, and Al-Anon with a slipped last letter. Outside meeting
   talk the strict forms above still apply, so "da" in ordinary words is safe. */
const LOOSE = {
  DA: /\bda\b/i, BDA: /\bbda\b/i, WA: /\bwa\b/i, UA: /\bua\b/i, ACA: /\baca\b/i,
  'Al-Anon': /\bal[- ]?an[oa][a-z]\b/i, AA: /\baa\b/i, NA: /\bna\b/i, OA: /\boa\b/i, SLAA: /\bslaa\b/i,
};
function programsIn(text, { loose = false } = {}) {
  const t = String(text || '');
  return Object.keys(PROGRAMS).filter((key) => MENTIONS[key].some((re) => re.test(t)) || (loose && LOOSE[key] && LOOSE[key].test(t)));
}
function othersIn(text) {
  const t = String(text || '');
  return Object.keys(OTHERS).filter((key) => OTHERS[key].mention.some((re) => re.test(t)));
}
const ALL_LABELS = Object.values(PROGRAMS).map((p) => p.label).join(', ');

const fieldParts = (programField) => String(programField || '').split(',').map((s) => s.trim()).filter(Boolean);
// "DA, BDA, UA, ACA" -> ['DA', 'BDA', 'UA', 'ACA']
function programsOf(programField) {
  const parts = fieldParts(programField);
  return Object.keys(PROGRAMS).filter((key) => parts.some((p) => PROGRAMS[key].match.test(p)));
}
function othersOf(programField) {
  const parts = fieldParts(programField);
  return Object.keys(OTHERS).filter((key) => parts.some((p) => OTHERS[key].match.test(p)));
}

/* Said in every meetings block, because three things went wrong on 21 Oct:
   the sponsor kept saying "I can't look up meetings" after it could (its own
   earlier replies in the chat said so), it said "no UA list" when it simply
   had not been handed UA, and it made up underearnersanonymous.com. */
const ALL_FINDERS = [
  ...Object.values(PROGRAMS).map((p) => `${p.label} ${p.finder}`),
  ...Object.values(OTHERS).filter((o) => o.finder).map((o) => `${o.label} ${o.finder}`),
].join('; ');
function standingLines() {
  return [
    `You can search real online meetings for: ${ALL_LABELS}. Never say you cannot look up meetings or schedules: you can. If earlier in this chat you said you could not, that has changed, so do not repeat it.`,
    'If they ask about one of these programs and its meetings are not listed here, never say you have no list for it: say you will look and ask them to name it once more (for example "Want UA meetings too? Just say UA and I\'ll search.").',
    `Never make up a website. The official meeting finders are: ${ALL_FINDERS}.`,
  ];
}

/* What the sponsor says for a program it holds no meetings for: the finder
   first, as the answer itself. */
function otherLine(key) {
  const o = OTHERS[key];
  return o.finder
    ? `For ${o.label}: you do not hold their meetings, but the official finder lists every one: ${o.finder}. Lead with that link as the answer itself, warmly (for example "Here's where ${o.label} lists all its meetings, today's included: ${o.finder}"). Do not open with what you cannot do.`
    : `For ${o.label}: you do not hold their meetings. Point them warmly to ${o.label}'s official website by name, as the answer itself; never make up a link, and do not open with what you cannot do.`;
}

/* Building an Intl formatter is the slow part, and with thousands of meetings
   a request would build tens of thousands of them. One per zone and kind. */
const formatters = new Map();
function fmt(kind, zone, options) {
  const key = `${kind}|${zone}`;
  let f = formatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(kind.startsWith('gb') ? 'en-GB' : 'en-US', { timeZone: zone, ...options }); formatters.set(key, f); }
  return f;
}

/* Minutes east of UTC for a zone at a given instant, from real DST rules.
   longOffset prints "GMT+01:00", or plain "GMT" at zero. */
function offsetMinutes(zone, instant) {
  const name = fmt('offset', zone, { timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
}

// The instant at which it is y-mo-d hh:mm on the wall clock in `zone`.
function instantFor(zone, y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo, d, hh, mm);
  let t = guess - offsetMinutes(zone, guess) * 60000;
  // Second pass settles the hour either side of a clock change.
  t = guess - offsetMinutes(zone, t) * 60000;
  return t;
}

// The calendar date in `zone` at `instant`, as numbers.
function dateIn(zone, instant) {
  const parts = Object.fromEntries(fmt('date', zone, { year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month) - 1, d: Number(parts.day) };
}

/* "in 1 hour 34 minutes", for a meeting starting within twelve hours, so the
   sponsor has a sense of how soon it is without doing clock sums. */
function startsIn(instant, now) {
  const mins = Math.round((instant - now) / 60000);
  if (mins <= 0 || mins >= 12 * 60) return '';
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (mm) parts.push(`${mm} minute${mm === 1 ? '' : 's'}`);
  return `in ${parts.join(' ')}`;
}

/* Every time this meeting starts in the coming week, as instants. A meeting
   that began up to ten minutes ago still counts: most rooms let people in for
   a while. */
function starts(meeting, now) {
  const [hh, mm] = meeting.start.split(':').map(Number);
  const today = dateIn(meeting.zone, now);
  const out = [];
  for (let k = -1; k <= 7; k++) {
    const day = new Date(Date.UTC(today.y, today.mo, today.d + k));
    if (!meeting.days.includes(day.getUTCDay())) continue;
    const t = instantFor(meeting.zone, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (t >= now - 10 * 60000 && t < now + 8 * 86400000) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

// The next time this meeting starts, as an instant, or null.
function nextStart(meeting, now) {
  const all = starts(meeting, now);
  return all.length ? all[0] : null;
}

// "7:30pm", "9am"
function clock(instant, zone) {
  return fmt('time', zone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(instant)).replace(':00', '').replace(' ', '').toLowerCase();
}

/* "today, Friday 23 October, at 9am", "Monday 26 October at 7am". The day and
   date are always written out. On 22 Oct, just after midnight in Pakistan, our
   "tomorrow" meant Saturday, but the sponsor counted it from its own date (still
   Thursday in UTC) and offered a Saturday meeting for Friday. `relative` is off
   when the zone is the meeting's and not theirs: their "today" is unknown. */
function describeWhen(instant, zone, now, { relative = true } = {}) {
  const time = clock(instant, zone);
  const date = fmt('gb-longdate', zone, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(instant));
  if (instant < now) return `started ${Math.round((now - instant) / 60000)} minutes ago (${date}, ${time})`;
  const a = dateIn(zone, now);
  const b = dateIn(zone, instant);
  const gap = Math.round((Date.UTC(b.y, b.mo, b.d) - Date.UTC(a.y, a.mo, a.d)) / 86400000);
  const rel = !relative ? '' : gap === 0 ? 'today' : gap === 1 ? 'tomorrow' : '';
  return rel ? `${rel}, ${date}, at ${time}` : `${date} at ${time}`;
}

/* Some directories put the schedule in the name ("22:22 Presents: The Wheel of
   Surrender - Daily 9:00 PM PST"). On 22 Oct the sponsor took that 9pm as the
   time in Pakistan, where the meeting is at 9am. A schedule tag at the end of a
   name is dropped; a time anywhere else is part of the name and stays, and the
   block tells the sponsor a time in a name is never their time. */
const DAYWORD = '(?:daily|every ?day|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?)';
const CLOCK = '\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)';
const ZONEWORD = '(?:[ECMP][SD]?T|GMT|UTC|BST|CET|CEST|AEST|AEDT|UK|eastern|central|mountain|pacific)(?:\\s+time)?';
const SCHEDULE_TAIL = [
  new RegExp(`\\s*[-–|]\\s*(?:${DAYWORD}\\s+)?${CLOCK}(?:\\s*\\(?${ZONEWORD}\\)?)?\\s*$`, 'i'),
  new RegExp(`\\s*\\([^()]*${CLOCK}[^()]*\\)\\s*$`, 'i'),
  new RegExp(`\\s+${DAYWORD}\\s+${CLOCK}\\s*${ZONEWORD}\\s*$`, 'i'),
];
function cleanName(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  for (const re of SCHEDULE_TAIL) {
    const shorter = n.replace(re, '').trim();
    if (shorter.length >= 4) n = shorter;
  }
  return n;
}

// Weekdays named in a message, as 0 (Sunday) to 6: "what about Saturday?"
const WEEKDAY_NAMES = [/\bsundays?\b/i, /\bmondays?\b/i, /\btues(day)?s?\b/i, /\bwed(nesday|s)s?\b/i, /\bthurs(day)?s?\b/i, /\bfridays?\b/i, /\bsaturdays?\b/i];
function weekdaysIn(text) {
  const t = String(text || '');
  return WEEKDAY_NAMES.map((re, i) => (re.test(t) ? i : -1)).filter((i) => i >= 0);
}

/* Most meetings are American, so "the next four" for somebody in London were
   all at midnight or later (seen 20 Oct). When we know where they are, only
   meetings starting in their waking hours are offered. */
const WAKING = { from: 7, to: 22 };
/* AA and Al-Anon have hundreds of meetings a day, so "the next two" were always
   the two starting this minute (21 Oct), and the earliest three of a day were
   7am, 9am and 11:30am, so asked for one after 7pm on 22 Oct the sponsor had
   none to give. Each of their days is cut into four parts and the first meeting
   in each part is offered, so morning, midday, afternoon and evening all have
   one. A program with few meetings fills the rest, two hours apart. */
const DAY_PARTS = [[7, 11], [11, 15], [15, 19], [19, 22]];
const PER_DAY = 4;
const MIN_GAP_MINUTES = 120;
// Today and the next day that has meetings, plus any weekday they name.
const DAYS_SHOWN = 2;

const LATE_NIGHT_WINDOW_MS = 2 * 3600000;
const inWaking = (hour) => hour >= WAKING.from && hour < WAKING.to;

function localHourAt(zone, instant) {
  return Number(fmt('gb-hour', zone, { hour: 'numeric', hour12: false })
    .format(new Date(instant))) % 24;
}

/* One day's picks. Within a part of the day an open meeting comes before a
   women- or men-only one, which the sponsor may only offer when it fits them. */
function spreadDay(list) {
  const picked = [];
  for (const [from, to] of DAY_PARTS) {
    const inPart = list.filter((x) => x.h >= from && x.h < to);
    const first = inPart.find((x) => !x.m.who) || inPart[0];
    if (first) picked.push(first);
  }
  for (const x of list) {
    if (picked.length >= PER_DAY) break;
    if (picked.every((p) => Math.abs(p.at - x.at) >= MIN_GAP_MINUTES * 60000)) picked.push(x);
  }
  return picked.sort((a, b) => a.at - b.at);
}

function upcoming(programs, now, data, userZone, askedDays = []) {
  const out = {};
  for (const p of programs) {
    const mine = data.meetings.filter((m) => m.program === p);
    if (!userZone) {
      out[p] = mine
        .map((m) => ({ m, at: nextStart(m, now) }))
        .filter((x) => x.at !== null)
        .sort((a, b) => a.at - b.at)
        .slice(0, PER_PROGRAM);
      continue;
    }
    const days = new Map(); // their calendar day -> its meetings in waking hours, in time order
    const all = mine.flatMap((m) => starts(m, now).map((at) => ({ m, at }))).sort((a, b) => a.at - b.at);
    for (const x of all) {
      const h = localHourAt(userZone, x.at);
      if (!inWaking(h)) continue;
      const { y, mo, d } = dateIn(userZone, x.at);
      const key = `${y}-${mo}-${d}`;
      if (!days.has(key)) days.set(key, { weekday: new Date(Date.UTC(y, mo, d)).getUTCDay(), list: [] });
      days.get(key).list.push({ ...x, h });
    }
    /* Up late (10pm to 7am for them), somebody asking for a meeting may need
       one now, not at a sensible hour tomorrow. Then the next two starting
       within two hours are offered too, whatever the hour. */
    const nowHour = localHourAt(userZone, now);
    const late = nowHour < WAKING.from || nowHour >= WAKING.to;
    const night = late
      ? all.filter((x) => x.at <= now + LATE_NIGHT_WINDOW_MS && !inWaking(localHourAt(userZone, x.at)))
      : [];
    // Open before women- or men-only, and not two starting at the same time.
    const soonest = [];
    for (const x of [...night.filter((n) => !n.m.who), ...night.filter((n) => n.m.who)]) {
      if (soonest.length >= 2) break;
      if (soonest.every((s) => Math.abs(s.at - x.at) >= 30 * 60000)) soonest.push(x);
    }
    soonest.sort((a, b) => a.at - b.at);
    out[p] = [...soonest, ...[...days.values()]
      .filter((day, i) => i < DAYS_SHOWN || askedDays.includes(day.weekday))
      .flatMap((day) => spreadDay(day.list))];
  }
  return out;
}

/* Meetings the sponsor already gave them, found by Zoom link or meeting ID in
   the chat. Asked about one later ("I couldn't find that passcode"), it needs
   the meeting in front of it. On 22 Oct it did not have it: the meeting had
   started twenty minutes before, so it was off the list, and the follow-up
   named no program, so the sponsor was asking "which program?". It said it
   could not verify details that were right. */
function alreadyGiven(text, data) {
  const t = String(text || '');
  if (!t || !data) return [];
  const digits = t.replace(/[\s-]/g, '');
  return data.meetings.filter((m) => t.includes(m.link) || (m.meetingId && digits.includes(m.meetingId))).slice(0, 6);
}

/* One meeting as the sponsor sees it. Time first, then the name, so a time
   inside a name is never read as theirs. "Listed as" and the source are there
   so that, questioned, the sponsor can show where a meeting comes from. */
function meetingLine(m, at, userZone, now) {
  const when = userZone ? describeWhen(at, userZone, now) : `${describeWhen(at, m.zone, now, { relative: false })} ${m.zone} time`;
  const soon = startsIn(at, now);
  const fields = [soon ? `${when} (${soon})` : when, `"${cleanName(m.name)}"`];
  if (userZone) fields.push(`listed as ${fmt('weekday', m.zone, { weekday: 'long' }).format(new Date(at))} ${clock(at, m.zone)} ${m.zone} time`);
  if (m.access) fields.push(m.access);
  if (m.who) fields.push(`${m.who} only`);
  fields.push(m.link);
  if (m.passcode) fields.push(`passcode ${m.passcode}`);
  if (m.source) fields.push(`source ${m.source}`);
  return `- ${fields.join(' | ')}`;
}

/* The system block, or '' when there is nothing to add. userZone is where they
   are (from their phone number); without it, times are given in each meeting's
   own zone and labelled as such, never silently converted to a guess. */
function buildMeetingsBlock({ message, programField, userZone, now = Date.now(), recentMessages = '', lastUserMessage = '', earlierChat = '' }) {
  try {
    const meetingTalk = asksAboutMeetings(message) || asksAboutMeetings(recentMessages);
    const named = programsIn(message, { loose: meetingTalk });
    /* A conversation about meetings carries on past the message that started
       it: "AA" answering "Which program?", "any more tomorrow?", "and Friday?".
       recentMessages is their previous message and the sponsor's reply (the
       sponsor's question alone is often just "Which program?", seen 21 Oct),
       so while either of those was about meetings, this turn gets the block. */
    if (!meetingTalk) return '';
    /* Which program, Mariam's rules (21 Oct):
       - named now (one or several): those, whatever they registered with,
         since people move between programs (Matt asked the same)
       - else named just before ("any more tomorrow?" after asking for AA)
       - else the program of a meeting it just gave them, which they are now
         asking about (Bilal's QA, 22 Oct)
       - else exactly one program on file: that one, straight away
       - else several on file: ask "Which program, or programs, are you
         looking for?" first
       - else nothing on file (started on WhatsApp): ask what programs they
         are looking for today, and that you will search
       Never open with "I can't". */
    const data = load();
    /* Each program carries its own check date, because one directory can fail
       while the others refresh. Files from before that have only generatedAt. */
    const checkedAt = (p) => Date.parse((data && data.checked && data.checked[p]) || (data && data.generatedAt));
    const isFresh = (p) => (now - checkedAt(p)) / 86400000 <= STALE_AFTER_DAYS;
    const asked = alreadyGiven(`${message}\n${recentMessages}`, data).filter((m) => isFresh(m.program));
    const namedOthers = othersIn(message);
    const nowNamed = named.length || namedOthers.length;
    let programs = nowNamed ? named : programsIn(lastUserMessage, { loose: true });
    let others = nowNamed ? namedOthers : othersIn(lastUserMessage);
    if (!programs.length && !others.length && asked.length) programs = [...new Set(asked.map((m) => m.program))];
    if (!programs.length && !others.length) {
      const fileCovered = programsOf(programField);
      const fileOthers = othersOf(programField);
      if (fileCovered.length + fileOthers.length === 1) {
        programs = fileCovered;
        others = fileOthers;
      } else {
        const onFile = [...fileCovered.map((p) => PROGRAMS[p].label), ...fileOthers.map((k) => OTHERS[k].label)];
        return [
          '## RECOVERY MEETINGS',
          'Use this only if they are asking about a recovery meeting; otherwise ignore it.',
          onFile.length
            ? `They signed up with several programs (${onFile.join(', ')}). Before naming any meeting, ask which program, or programs, they are looking for, in one short, warm question (for example "Which program, or programs, are you looking for?"). Once they say, you will have the meetings.`
            : 'They have not said which program, and none is on file. Before naming any meeting, ask what program, or programs, they are looking for today and say you will search, in one short, warm line (for example "What programs are you looking for today? I\'ll search for you."). Once they say, you will have the meetings.',
          ...standingLines(),
          'Never name a meeting, time, link or passcode that you were not given here.',
        ].join('\n');
      }
    }
    const otherLines = others.map(otherLine);
    if (!programs.length) {
      return [
        '## RECOVERY MEETINGS',
        'Use this only if they are asking about a recovery meeting; otherwise ignore it.',
        ...otherLines,
        ...standingLines(),
        'Never name a meeting, time, link or passcode that you were not given here.',
      ].join('\n');
    }
    const finderFor = (list) => [...new Set(list.map((p) => PROGRAMS[p].finder))].join(' and ');
    const finders = finderFor(programs);
    const fresh = data ? programs.filter(isFresh) : [];
    const stale = programs.filter((p) => !fresh.includes(p));
    const staleLine = stale.length
      ? `For ${stale.map((p) => PROGRAMS[p].label).join(' and ')}, do not name any specific meeting, time or link: your list for it is out of date. Lead with the official finder as the answer itself, warmly: ${finderFor(stale)}`
      : null;
    if (!fresh.length) return ['## RECOVERY MEETINGS', staleLine, ...otherLines, ...standingLines()].join('\n');

    const lists = upcoming(fresh, now, data, userZone, weekdaysIn(message));
    const lines = [];
    const shown = [];
    for (const p of fresh) {
      if (!lists[p].length) continue;
      shown.push(p);
      lines.push(`${PROGRAMS[p].label}:`);
      for (const { m, at } of lists[p]) lines.push(meetingLine(m, at, userZone, now));
    }
    /* Ones it gave them earlier in the chat and not listed above, shown at the
       time that just passed if it began in the last three hours ("started 20
       minutes ago"), otherwise at the next one. */
    const listed = new Set(fresh.flatMap((p) => lists[p].map((x) => `${x.m.id}@${x.at}`)));
    const given = alreadyGiven(`${message}\n${recentMessages}\n${earlierChat}`, data)
      .filter((m) => isFresh(m.program))
      .map((m) => ({ m, at: starts(m, now - 3 * 3600000).filter((t) => t <= now).pop() || nextStart(m, now) }))
      .filter(({ m, at }) => at && !listed.has(`${m.id}@${at}`));
    const givenLines = given.map(({ m, at }) => meetingLine(m, at, userZone, now));
    const givenSection = givenLines.length
      ? ['Meetings you already gave them in this chat, as listed (if they ask about one, this is it):', ...givenLines]
      : [];
    if (!lines.length && !givenLines.length) {
      // Nothing at a sensible hour in the coming days: still something to give.
      const empty = fresh.map((p) => `For ${PROGRAMS[p].label}, none of your listed meetings falls at a sensible hour for them soon. Lead with the official finder as the answer itself, warmly: ${PROGRAMS[p].finder}`);
      return ['## RECOVERY MEETINGS', ...empty, ...(staleLine ? [staleLine] : []), ...otherLines, ...standingLines(), 'Never name a meeting, time, link or passcode that you were not given here.'].join('\n');
    }

    const checked = new Date(Math.min(...[...shown, ...given.map((g) => g.m.program)].map(checkedAt)))
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

    return [
      '## RECOVERY MEETINGS YOU CAN OFFER',
      'Use this only if they are asking about a recovery meeting. If "meeting" here means seeing a person, or anything else, ignore this section completely.',
      `These are upcoming online meetings for their program, read from each meeting's official listing on ${checked}.`,
      userZone
        ? `Where they are (${userZone}, from their phone number) it is now ${describeWhen(now, userZone, now, { relative: false }).replace(' at ', ', ')}. Each line starts with the meeting's day, date and time for them, already worked out, and how soon it starts. ${inWaking(localHourAt(userZone, now)) ? 'Only ones at a sensible hour for them are listed.' : 'They are up late, so the first ones are the next meetings starting within two hours, whatever the hour, in case they need one now; the rest are at a sensible hour.'} Use that day and date exactly as written; never work out a day yourself from "today" or "tomorrow". "Listed as" is the day and time the directory gives, in the meeting's own time zone.`
        : 'We do not know where they are, so each time is in the meeting\'s own time zone, as labelled.',
      ...lines,
      ...givenSection,
      ...(staleLine ? [staleLine] : []),
      ...otherLines,
      ...standingLines(),
      'How to use it:',
      '- Offer one to three that fit what they asked for, never the whole list.',
      '- Copy the name, time, link and passcode exactly as written here. Never change, shorten or make up a link, a time, a passcode or a meeting, and never offer one that is not on this list.',
      '- A meeting\'s name can contain a day, time or time zone (for example "Daily 9:00 PM PST"). That is part of its name, in the meeting\'s own time zone, never its time for them.',
      `- If they question a meeting, do not take it back: every detail here was on its official listing when it was checked on ${checked}. Never say you cannot verify it, that it is unconfirmed, or that you should not have shared it. Give them its source link, its listed day and time, and that date. Not finding a detail on the listing does not make it wrong: listings often write a meeting ID with spaces (819 9042 4358), and some sources are a directory page where they search for the meeting by name, so tell them that. Only if they say the listing now shows something different (another day, time, link or passcode) do you thank them, go with the listing, and point them to the official finder.`,
      '- "Closed" means members only: the people the program is for. That is them, so a closed meeting is still theirs to go to.',
      '- A meeting marked "women only" or "men only" is only for people of that gender. Offer it only when you know it fits them; otherwise choose another.',
      `- These are online meetings only. If they want one in person, give them the official finder, which lists in-person meetings too: ${finders}`,
      `- If the link does not open for them, or they want something else, the official finder has every meeting: ${finders}`,
      '- You cannot know what a room is like. If they ask which is good, say that plainly and suggest they try two and see which feels like home.',
    ].join('\n');
  } catch (e) {
    console.warn('[meetings] block skipped:', e.message);
    return '';
  }
}

module.exports = {
  buildMeetingsBlock, asksAboutMeetings, programsOf, programsIn, nextStart, starts, describeWhen, instantFor,
  cleanName, weekdaysIn, alreadyGiven, startsIn,
  offsetMinutes, STALE_AFTER_DAYS, PROGRAMS, OTHERS, othersIn,
  _setData(d) { cache = d; },
};
