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
};

/* Programs people sign up with that we hold no meetings for yet. For these the
   sponsor leads with the official finder, never with "I can't" (Mariam, 21 Oct:
   "What kind of a start is that?"). Every link was checked live on 21 Oct; a
   program without a checked link is named, never given a made-up one. Food
   Addicts Anonymous is left out on purpose: foodaddicts.org is a different
   fellowship (Food Addicts in Recovery Anonymous). */
const OTHERS = {
  OA: { match: /^(oa|overeaters anonymous)$/i, mention: [/\bOA\b/, /\bovereaters anonymous\b|\boa(?=\s+(meetings?|groups?|zoom))/i], label: 'Overeaters Anonymous', finder: 'https://oa.org/find-a-meeting/' },
  SLAA: { match: /^(slaa|sex and love addicts anonymous)$/i, mention: [/\bslaa\b/i, /\bsex and love addicts anonymous\b/i], label: 'Sex and Love Addicts Anonymous', finder: 'https://slaafws.org/meetings/' },
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
};
function programsIn(text) {
  const t = String(text || '');
  return Object.keys(PROGRAMS).filter((key) => MENTIONS[key].some((re) => re.test(t)));
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
function buildMeetingsBlock({ message, programField, userZone, now = Date.now(), recentMessages = '', lastUserMessage = '' }) {
  try {
    const named = programsIn(message);
    /* A conversation about meetings carries on past the message that started
       it: "AA" answering "Which program?", "any more tomorrow?", "and Friday?".
       recentMessages is their previous message and the sponsor's reply (the
       sponsor's question alone is often just "Which program?", seen 21 Oct),
       so while either of those was about meetings, this turn gets the block. */
    if (!asksAboutMeetings(message) && !asksAboutMeetings(recentMessages)) return '';
    /* Which program, Mariam's rules (21 Oct):
       - named now (one or several): those, whatever they registered with,
         since people move between programs (Matt asked the same)
       - else named just before ("any more tomorrow?" after asking for AA)
       - else exactly one program on file: that one, straight away
       - else several on file: ask "Which program, or programs, are you
         looking for?" first
       - else nothing on file (started on WhatsApp): ask what programs they
         are looking for today, and that you will search
       Never open with "I can't". */
    const namedOthers = othersIn(message);
    const nowNamed = named.length || namedOthers.length;
    let programs = nowNamed ? named : programsIn(lastUserMessage);
    let others = nowNamed ? namedOthers : othersIn(lastUserMessage);
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
          `You can find real online meetings for ${ALL_LABELS}. Never open with what you cannot do.`,
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
        `If they also go to one of these, you can find real online meetings for it: ${ALL_LABELS}.`,
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
      ? `For ${stale.map((p) => PROGRAMS[p].label).join(' and ')}, do not name any specific meeting, time or link: your list for it is out of date. Lead with the official finder as the answer itself, warmly: ${finderFor(stale)}`
      : null;
    if (!fresh.length) return ['## RECOVERY MEETINGS', staleLine, ...otherLines].join('\n');

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
    if (!lines.length) {
      // Nothing at a sensible hour in the coming days: still something to give.
      const empty = fresh.map((p) => `For ${PROGRAMS[p].label}, none of your listed meetings falls at a sensible hour for them soon. Lead with the official finder as the answer itself, warmly: ${PROGRAMS[p].finder}`);
      return ['## RECOVERY MEETINGS', ...empty, ...(staleLine ? [staleLine] : []), ...otherLines, 'Never name a meeting, time, link or passcode that you were not given here.'].join('\n');
    }

    const checked = new Date(Math.min(...shown.map(checkedAt)))
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

    return [
      '## RECOVERY MEETINGS YOU CAN OFFER',
      'Use this only if they are asking about a recovery meeting. If "meeting" here means seeing a person, or anything else, ignore this section completely.',
      `These are upcoming online meetings for their program, taken from the official directories and checked on ${checked}. ${userZone ? 'The times are already in their own local time, and only ones at a sensible hour for them are listed.' : 'We do not know where they are, so each time is in the meeting\'s own time zone, as labelled.'}`,
      ...lines,
      ...(staleLine ? [staleLine] : []),
      ...otherLines,
      'How to use it:',
      '- Offer one to three that fit what they asked for, never the whole list.',
      '- Copy the name, time, link and passcode exactly as written here. Never change, shorten or make up a link, a time, a passcode or a meeting, and never offer one that is not on this list.',
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
  buildMeetingsBlock, asksAboutMeetings, programsOf, programsIn, nextStart, describeWhen, instantFor,
  offsetMinutes, STALE_AFTER_DAYS, PROGRAMS, OTHERS, othersIn,
  _setData(d) { cache = d; },
};
