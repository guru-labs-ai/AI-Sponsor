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
};
function programsIn(text) {
  const t = String(text || '');
  return Object.keys(PROGRAMS).filter((key) => MENTIONS[key].some((re) => re.test(t)));
}
const ALL_LABELS = Object.values(PROGRAMS).map((p) => p.label).join(', ');

// "DA, BDA, UA, ACA" -> ['DA', 'BDA']
function programsOf(programField) {
  const parts = String(programField || '').split(',').map((s) => s.trim()).filter(Boolean);
  return Object.keys(PROGRAMS).filter((key) => parts.some((p) => PROGRAMS[key].match.test(p)));
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

/* The next time this meeting starts, as an instant. A meeting that began up to
   ten minutes ago still counts: most rooms let people in for a while. */
function nextStart(meeting, now) {
  const [hh, mm] = meeting.start.split(':').map(Number);
  const today = dateIn(meeting.zone, now);
  let best = null;
  for (let k = -1; k <= 7; k++) {
    const day = new Date(Date.UTC(today.y, today.mo, today.d + k));
    if (!meeting.days.includes(day.getUTCDay())) continue;
    const t = instantFor(meeting.zone, day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (t >= now - 10 * 60000 && (best === null || t < best)) best = t;
  }
  return best;
}

// "today at 7:30pm", "tomorrow at 9am", "Thursday at 12:15pm"
function describeWhen(instant, zone, now) {
  const time = fmt('time', zone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(instant)).replace(':00', '').replace(' ', '').toLowerCase();
  const a = dateIn(zone, now);
  const b = dateIn(zone, instant);
  const gap = Math.round((Date.UTC(b.y, b.mo, b.d) - Date.UTC(a.y, a.mo, a.d)) / 86400000);
  const day = gap === 0 ? 'today'
    : gap === 1 ? 'tomorrow'
    : fmt('weekday', zone, { weekday: 'long' }).format(new Date(instant));
  if (instant < now) return `started ${Math.round((now - instant) / 60000)} minutes ago (${time})`;
  return `${day} at ${time}`;
}

/* Most meetings are American, so "the next four" for somebody in London were
   all at midnight or later (seen 20 Oct). When we know where they are, only
   meetings starting in their waking hours are offered, and no more than two on
   any one day, so there is a choice of days and not just tonight. */
const WAKING = { from: 7, to: 22 };
/* AA and Al-Anon have hundreds of meetings a day, so "the next two" were always
   the two starting this minute; asked for one tonight on 21 Oct, the sponsor
   could only offer 3:30pm and 3:55pm. Spread across the day instead. */
const PER_DAY = 3;
const MIN_GAP_MINUTES = 120;

function localHourAt(zone, instant) {
  return Number(fmt('gb-hour', zone, { hour: 'numeric', hour12: false })
    .format(new Date(instant))) % 24;
}

function upcoming(programs, now, data, userZone) {
  const out = {};
  for (const p of programs) {
    const soonest = data.meetings
      .filter((m) => m.program === p)
      .map((m) => ({ m, at: nextStart(m, now) }))
      .filter((x) => x.at !== null)
      .sort((a, b) => a.at - b.at);
    if (!userZone) { out[p] = soonest.slice(0, PER_PROGRAM); continue; }
    const perDay = {};
    const lastAt = {};
    out[p] = soonest.filter(({ at }) => {
      const h = localHourAt(userZone, at);
      if (h < WAKING.from || h >= WAKING.to) return false;
      const { y, mo, d } = dateIn(userZone, at);
      const key = `${y}-${mo}-${d}`;
      if ((perDay[key] || 0) >= PER_DAY) return false;
      if (lastAt[key] !== undefined && at - lastAt[key] < MIN_GAP_MINUTES * 60000) return false;
      perDay[key] = (perDay[key] || 0) + 1;
      lastAt[key] = at;
      return true;
    }).slice(0, PER_PROGRAM);
  }
  return out;
}

/* The system block, or '' when there is nothing to add. userZone is where they
   are (from their phone number); without it, times are given in each meeting's
   own zone and labelled as such, never silently converted to a guess. */
function buildMeetingsBlock({ message, programField, userZone, now = Date.now(), recentMessages = '' }) {
  try {
    const named = programsIn(message);
    /* "AA" on its own is an answer when the last exchange was about a meeting.
       recentMessages is their previous message and the sponsor's reply: the
       sponsor's question alone is often just "Which program?" (seen 21 Oct),
       so their own "can you find me a meeting?" has to count too. */
    const answering = named.length > 0 && asksAboutMeetings(recentMessages);
    if (!asksAboutMeetings(message) && !answering) return '';
    const programs = named.length ? named : programsOf(programField);
    if (!programs.length) {
      const onFile = String(programField || '').trim();
      return [
        '## RECOVERY MEETINGS',
        'Use this only if they are asking about a recovery meeting; otherwise ignore it.',
        onFile
          ? `On file they go to ${onFile}, and you cannot look up meetings for that yet. Say so plainly and point them to that program's official website. You can find real online meetings for ${ALL_LABELS}, if they also go to one of those.`
          : `You do not know which program they go to. Before naming any meeting, ask which program, in one short question. You can find real online meetings for ${ALL_LABELS}; once they say, you will have the meetings to offer. If theirs is not one of these, say you cannot look those up yet and point them to that program's official website.`,
        'Never name a meeting, time, link or passcode that you were not given here.',
      ].join('\n');
    }
    const data = load();
    const finderFor = (list) => [...new Set(list.map((p) => PROGRAMS[p].finder))].join(' and ');
    const finders = finderFor(programs);

    /* Each program carries its own check date, because one directory can fail
       while the others refresh. Files from before that have only generatedAt. */
    const checkedAt = (p) => Date.parse((data && data.checked && data.checked[p]) || (data && data.generatedAt));
    const isFresh = (p) => (now - checkedAt(p)) / 86400000 <= STALE_AFTER_DAYS;
    const fresh = data ? programs.filter(isFresh) : [];
    const stale = programs.filter((p) => !fresh.includes(p));
    const staleLine = stale.length
      ? `For ${stale.map((p) => PROGRAMS[p].label).join(' and ')}, your meeting list is out of date, so do not name any specific meeting, time or link for it. Send them to the official finder: ${finderFor(stale)}`
      : null;
    if (!fresh.length) return ['## RECOVERY MEETINGS', staleLine].join('\n');

    const lists = upcoming(fresh, now, data, userZone);
    const lines = [];
    const shown = [];
    for (const p of fresh) {
      if (!lists[p].length) continue;
      shown.push(p);
      lines.push(`${PROGRAMS[p].label}:`);
      for (const { m, at } of lists[p]) {
        const zone = userZone || m.zone;
        const when = describeWhen(at, zone, now) + (userZone ? '' : ` (${m.zone} time)`);
        const access = m.access ? `, ${m.access}` : '';
        const who = m.who ? `, ${m.who} only` : '';
        const pass = m.passcode ? `, passcode ${m.passcode}` : '';
        lines.push(`- "${m.name}", ${when}${access}${who}, ${m.link}${pass}`);
      }
    }
    if (!lines.length) return staleLine ? ['## RECOVERY MEETINGS', staleLine].join('\n') : '';

    const checked = new Date(Math.min(...shown.map(checkedAt)))
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

    return [
      '## RECOVERY MEETINGS YOU CAN OFFER',
      'Use this only if they are asking about a recovery meeting. If "meeting" here means seeing a person, or anything else, ignore this section completely.',
      `These are upcoming online meetings for their program, taken from the official directories and checked on ${checked}. ${userZone ? 'The times are already in their own local time, and only ones at a sensible hour for them are listed.' : 'We do not know where they are, so each time is in the meeting\'s own time zone, as labelled.'}`,
      ...lines,
      ...(staleLine ? [staleLine] : []),
      'How to use it:',
      '- Offer one to three that fit what they asked for, never the whole list.',
      '- Copy the name, time, link and passcode exactly as written here. Never change, shorten or make up a link, a time, a passcode or a meeting, and never offer one that is not on this list.',
      '- "Closed" means members only: the people the program is for. That is them, so a closed meeting is still theirs to go to.',
      '- A meeting marked "women only" or "men only" is only for people of that gender. Offer it only when you know it fits them; otherwise choose another.',
      `- These are online meetings only. If they want one in person, say you cannot look those up yet and send them to the official finder: ${finders}`,
      `- If the link does not open for them, or they want something else, the official finder has every meeting: ${finders}`,
      '- You cannot know what a room is like. If they ask which is good, say that plainly and suggest they try two and see which feels like home.',
    ].join('\n');
  } catch (e) {
    console.warn('[meetings] block skipped:', e.message);
    return '';
  }
}

module.exports = {
  buildMeetingsBlock, asksAboutMeetings, programsOf, programsIn, nextStart, describeWhen, instantFor,
  offsetMinutes, STALE_AFTER_DAYS, PROGRAMS,
  _setData(d) { cache = d; },
};
