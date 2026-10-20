/* ─── Refreshing the meeting list the sponsor is allowed to hand out ─────────
   Justyna asked her sponsor for a meeting on 12 Sep and was told it "can't pull
   up a live meeting list". So this builds one, and the whole point of it is
   that every row can be trusted: a wrong Zoom link handed to somebody who
   finally worked up the nerve to go to a meeting is worse than no link.

   Run by hand:  node meetings-refresh.js
   Writes meetings-data.json next to this file and prints what it kept, what it
   threw away and why. Nothing here touches the database or the live service.

   Sources are the fellowships' own directories, read fresh on every run:
     DA and BDA  debtorsanonymous.org virtual meeting search + each meeting's
                 own detail page (the list alone has no Zoom link)
     WA          workaholics-anonymous.org's published meetings JSON

   A meeting is only KEPT when all of this holds:
     - it meets weekly on a named day at a named time, in a time zone we can
       place exactly (an IANA name, so clock changes are handled)
     - it is online with a direct Zoom join link, and its passcode is either in
       that link or printed in the listing
     - nothing in its listing says to email or ask someone for the link or the
       password
     - it is in English
     - it is a recovery meeting, not an intergroup, GSR or business meeting
     - its listing was updated within MAX_LISTING_AGE_DAYS

   What this CANNOT check, and nobody should claim it does: whether the Zoom
   room still runs. Zoom gives no reliable public signal (tested 20 Oct: made-up
   meeting ids come back looking the same as real ones). The listing page link
   is kept with every meeting so the sponsor can always point at the official
   source, and the freshness rule above is the guard against dead groups.
──────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'meetings-data.json');
const MAX_LISTING_AGE_DAYS = 730;
const HEADERS = {
  // The directories 403 a script's default user agent; a browser one is fine.
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US',
};

const DA_LIST = 'https://www.debtorsanonymous.org/meeting-search-virtual/?mytz=Y&mytimezone=America%2FNew_York';
const DA_DETAIL = (mid) => `https://www.debtorsanonymous.org/meeting-search-detail/?mid=${mid}`;
const WA_JSON = 'https://workaholics-anonymous.org/wp-content/meetings/sfdc_transformed_json_n8n_no_unscheduled_FINAL.json';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* The DA directory names zones in its own words. Only the ones we can map with
   certainty are here; anything else is dropped, never guessed. */
const DA_ZONES = {
  'Eastern Time (US/CAN)': 'America/New_York',
  'Pacific Time (US/CAN)': 'America/Los_Angeles',
  'Central Time (US/CAN)': 'America/Chicago',
  'Mountain Time (US/CAN)': 'America/Denver',
  'Mountain Standard Time (AZ)': 'America/Phoenix',
  'Pacific Time (BC)': 'America/Vancouver',
  'Hawaii-Aleutian Standard Time': 'Pacific/Honolulu',
  'British Time': 'Europe/London',
  'Irish Time': 'Europe/Dublin',
  'Central European Time': 'Europe/Paris',
  'Moscow Time': 'Europe/Moscow',
  'Israel Time': 'Asia/Jerusalem',
  'Indian Standard Time': 'Asia/Kolkata',
  'Japan Standard Time': 'Asia/Tokyo',
  'Australia Eastern Time (NSW+Vic)': 'Australia/Sydney',
  'Australian Eastern Standard Time (Qsld)': 'Australia/Brisbane',
  'New Zealand Time': 'Pacific/Auckland',
  'Brasilia BRT': 'America/Sao_Paulo',
  'Argentina Time': 'America/Argentina/Buenos_Aires',
  'Columbia Time': 'America/Bogota',
  'Ecuador Time': 'America/Guayaquil',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Central Africa Time': 'Africa/Maputo',
  'East Africa Time': 'Africa/Nairobi',
  'Greenwich Mean Time (Iceland)': 'Atlantic/Reykjavik',
};

// Anything that means "you can't just click and join".
const ASK_FOR_ACCESS = /(e-?mail|contact|text|call|message|ask|request)[^.]{0,60}(password|passcode|link|zoom|access)|(password|passcode|link)[^.]{0,40}(by|via|on) (e-?mail|request)/i;
const NOT_WEEKLY = /\b(monthly|once a month|every other|bi-?weekly|fortnightly|(1st|2nd|3rd|4th|first|second|third|fourth|last) (\w+ )?(of (the|each|every) month))\b/i;
const SERVICE = /\b(intergroup|gsr|business meeting|service meeting|steering)\b/i;
// "Last updated" alone is not enough to keep a group whose own notes say it stopped.
const DORMANT = /\b(suspended|on hiatus|no longer meet|cancel+ed|closed until|temporarily closed|not meeting)\b/i;

async function get(url, as = 'text') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const clean = (s) => String(s || '')
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' | ')
  .replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&apos;|&#039;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#x28;/g, '(').replace(/&#x29;/g, ')')
  .replace(/[ \t]+/g, ' ')
  .replace(/(\s*\|\s*)+/g, ' | ')
  .trim();

// "07:30 pm" -> "19:30"
function to24(t) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(t).trim());
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function ageDays(date, now) {
  return (now - date) / 86400000;
}

/* ── DA and BDA ────────────────────────────────────────────────────────────
   The list gives the group number, the program (DA / BDA / Intergroup / GSR)
   and the time zone label. Everything else comes from the detail page, which
   is what the directory itself shows a member. */
function parseDaList(html) {
  const rows = html.split('<tr>').slice(1);
  const out = new Map();
  for (const row of rows) {
    const mid = (/mid=(\d+)/.exec(row) || [])[1];
    if (!mid || out.has(mid)) continue;
    const kind = (/\((DA|BDA|Intergroup|GSR) #\d+\)/.exec(row) || [])[1] || null;
    const zoneLabel = ((/<i style="font-size:12px;">([^<]+)<\/i>/.exec(row) || [])[1] || '').trim();
    const venue = clean((row.split('<!-- Venue column -->')[1] || '').split('</td>')[0]);
    out.set(mid, { mid, kind, zoneLabel, venue });
  }
  return [...out.values()];
}

function parseDaDetail(html) {
  const start = html.indexOf('Copy this link');
  const end = html.indexOf('Print page', start);
  if (start < 0 || end < 0) return null;
  const t = clean(html.slice(start, end));
  // The video block is what an online member uses; hybrid pages also carry a
  // face-to-face block first, with its own (usually identical) times.
  const video = t.includes('Video venue') ? t.slice(t.indexOf('Video venue')) : '';
  const when = /\| ((?:(?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,?)+) \| (\d{1,2}:\d{2} [ap]m) to (\d{1,2}:\d{2} [ap]m) \|/i.exec(video);
  // Listings are typed by hand: http://, a doubled slash before j/ and so on
  // all appear, and all of them open the same room once normalised.
  const found = /https?:\/\/((?:[a-z0-9]+\.)?zoom\.us)\/+j\/(\d{9,11})(\?pwd=[A-Za-z0-9._-]+)?/i.exec(video);
  const meetingId = ((/Meeting ID: \| ([\d ]+) \|/.exec(video) || [])[1] || '').replace(/\s/g, '') || null;
  /* No link but an id: the directory has given every member the id and the
     password to type into Zoom, and zoom.us/j/<id> is that same room. */
  const link = found
    ? `https://${found[1].toLowerCase()}/j/${found[2]}${found[3] || ''}`
    : (meetingId && /^\d{9,11}$/.test(meetingId) ? `https://zoom.us/j/${meetingId}` : null);
  const header = /\| ([^|]+?) \| (Open|Closed) ([A-Za-z.]+|Intergroup) meeting #(\d+) \|/.exec(t);
  const updated = /Information last updated ([A-Za-z]+ \d{1,2} \d{4})/.exec(t);
  return {
    text: t,
    name: header ? header[1].trim() : null,
    access: header ? header[2].toLowerCase() : null,
    group: header ? header[4] : null,
    language: ((/Primary language: \| ([^|]+) \|/.exec(t) || [])[1] || '').trim(),
    focus: ((/Meeting focus: \| ([^|]+) \|/.exec(t) || [])[1] || '').trim(),
    days: when ? when[1].split(',').filter(Boolean).map((d) => DAYS.indexOf(d)).filter((d) => d >= 0) : [],
    start: when ? to24(when[2]) : null,
    end: when ? to24(when[3]) : null,
    link,
    meetingId,
    passcode: ((/Password: \| ([^|]+?) \|/.exec(video) || [])[1] || '').trim() || null,
    updated: updated ? new Date(`${updated[1]} UTC`) : null,
  };
}

async function fromDa(now, rejected) {
  const list = parseDaList(await get(DA_LIST));
  const kept = [];
  const candidates = list.filter((r) => {
    if (!['DA', 'BDA'].includes(r.kind)) { rejected.push(['DA', r.mid, `service meeting (${r.kind || 'unknown type'})`]); return false; }
    if (!/video/i.test(r.venue)) { rejected.push(['DA', r.mid, `not on video (${r.venue || 'blank'})`]); return false; }
    if (!DA_ZONES[r.zoneLabel]) { rejected.push(['DA', r.mid, `time zone not mapped exactly (${r.zoneLabel || 'blank'})`]); return false; }
    return true;
  });

  // Polite: four at a time, the way a person clicking around would never be
  // faster than anyway.
  let i = 0;
  async function worker() {
    while (i < candidates.length) {
      const r = candidates[i++];
      let d;
      try {
        d = parseDaDetail(await get(DA_DETAIL(r.mid)));
      } catch (e) {
        rejected.push(['DA', r.mid, `detail page failed: ${e.message}`]);
        continue;
      }
      const why = daProblem(d, now);
      if (why) { rejected.push([r.kind, r.mid, why]); continue; }
      kept.push({
        id: `da-${r.mid}`,
        program: r.kind,
        name: d.name,
        days: d.days,
        start: d.start,
        end: d.end,
        zone: DA_ZONES[r.zoneLabel],
        link: d.link,
        meetingId: d.meetingId,
        passcode: /pwd=/.test(d.link) ? null : d.passcode,
        access: d.access,
        focus: d.focus,
        source: DA_DETAIL(r.mid),
        sourceUpdated: d.updated.toISOString().slice(0, 10),
      });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return kept;
}

function daProblem(d, now) {
  if (!d) return 'detail page had no meeting on it';
  if (!d.name || !d.access) return 'no name or open/closed on the page';
  if (SERVICE.test(d.name) || SERVICE.test(d.focus)) return 'service meeting';
  if (!/^english/i.test(d.language)) return `language is ${d.language || 'not stated'}`;
  if (!d.days.length || !d.start || !d.end) return 'no fixed day and time for the video meeting';
  if (!d.link) return 'no direct Zoom link';
  /* Some rooms need no passcode, but from the listing we cannot tell those from
     ones that left it off, and a link that stops at a passcode prompt is a
     dead end for the person holding it. */
  if (!/pwd=/.test(d.link) && !d.passcode) return 'no passcode in the link or the listing';
  if (ASK_FOR_ACCESS.test(d.text)) return 'listing says to ask someone for the link or password';
  if (NOT_WEEKLY.test(d.text)) return 'not weekly';
  if (DORMANT.test(d.text)) return 'listing says the meeting is paused or cancelled';
  if (!d.updated || Number.isNaN(d.updated.getTime())) return 'listing has no last-updated date';
  if (ageDays(d.updated, now) > MAX_LISTING_AGE_DAYS) return `listing last updated ${d.updated.toISOString().slice(0, 10)}`;
  return null;
}

/* ── WA ──────────────────────────────────────────────────────────────────────
   day 0 = Sunday, checked against meeting_day in each row's feedback_url.
   time is in the row's own timezone, which is already an IANA name. The
   conference_url is the directory's own redirect, whose code is the Zoom pwd:
   checked 23 Sep against three links that worked. */
async function fromWa(now, rejected) {
  const rows = await get(WA_JSON, 'json');
  const kept = [];
  for (const m of rows) {
    const id = m.slug || m.name;
    const why = waProblem(m, now);
    if (why) { rejected.push(['WA', id, why]); continue; }
    const u = new URL(m.conference_url.replace('redirect?', 'redirect/?'));
    const number = u.searchParams.get('number');
    const code = u.searchParams.get('code');
    kept.push({
      id: `wa-${m.slug}`,
      program: 'WA',
      name: m.name,
      days: [Number(m.day)],
      start: m.time,
      end: m.end_time || null,
      zone: m.timezone,
      link: `https://zoom.us/j/${number}?pwd=${code}`,
      meetingId: number,
      passcode: null,
      access: (m.types || []).includes('C') ? 'closed' : 'open',
      focus: '',
      source: m.url || 'https://workaholics-anonymous.org/meetings/',
      sourceUpdated: String(m.updated).slice(0, 10),
    });
  }
  return kept;
}

function waProblem(m, now) {
  const types = m.types || [];
  const notes = `${m.notes || ''} ${m.conference_url_notes || ''} ${m.group_notes || ''}`;
  const freq = decodeURIComponent((/meeting_frequency=([^&]*)/.exec(m.feedback_url || '') || [])[1] || '');
  if (!/workaholics-anonymous\.org\/meetings\/redirect\/?\?.*number=\d{9,11}/.test(m.conference_url || '')) return 'no direct Zoom link';
  if (!/[?&]code=[^&]+/.test(m.conference_url)) return 'no passcode in the link or the listing';
  if (!/\bActive=Active\b/.test(m.feedback_url || '')) return 'not marked active';
  if (freq !== 'Weekly') return `frequency is ${freq || 'not stated'}`;
  if (!types.includes('EN')) return 'not marked English';
  if (!Number.isInteger(Number(m.day)) || !/^\d{2}:\d{2}$/.test(m.time || '')) return 'no fixed day and time';
  try { new Intl.DateTimeFormat('en', { timeZone: m.timezone }); } catch { return `unknown time zone ${m.timezone}`; }
  if (SERVICE.test(m.name)) return 'service meeting';
  if (ASK_FOR_ACCESS.test(notes)) return 'listing says to ask someone for the link or password';
  if (DORMANT.test(notes)) return 'listing says the meeting is paused or cancelled';
  const updated = new Date(String(m.updated).replace(' ', 'T') + 'Z');
  if (Number.isNaN(updated.getTime())) return 'listing has no last-updated date';
  if (ageDays(updated, now) > MAX_LISTING_AGE_DAYS) return `listing last updated ${String(m.updated).slice(0, 10)}`;
  return null;
}

async function main() {
  const now = new Date();
  const rejected = [];
  const [da, wa] = await Promise.all([fromDa(now, rejected), fromWa(now, rejected)]);
  const meetings = [...da, ...wa].sort((a, b) => a.id.localeCompare(b.id));

  // A refresh that comes back thin is a broken scrape, not a quiet week.
  // Refuse to overwrite a good file with it.
  const count = (p) => meetings.filter((m) => m.program === p).length;
  const floor = { DA: 50, BDA: 15, WA: 10 };
  const short = Object.entries(floor).filter(([p, n]) => count(p) < n);
  if (short.length) {
    console.error(`Not writing: too few meetings for ${short.map(([p]) => `${p} (${count(p)})`).join(', ')}. The directory layout has probably changed.`);
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: now.toISOString(),
    rules: 'weekly, online with a direct Zoom link and a known passcode, English, no ask-for-access, not a service meeting, listing updated within ' + MAX_LISTING_AGE_DAYS + ' days',
    meetings,
  }, null, 1) + '\n');

  console.log(`Kept ${meetings.length}: DA ${count('DA')}, BDA ${count('BDA')}, WA ${count('WA')}`);
  const reasons = {};
  for (const [, , why] of rejected) {
    const key = why.replace(/\(.*\)|\d{4}-\d{2}-\d{2}|is .*/g, '').trim();
    reasons[key] = (reasons[key] || 0) + 1;
  }
  console.log(`Left out ${rejected.length}:`);
  for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${why}`);
  console.log(`Wrote ${path.basename(OUT)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { parseDaList, parseDaDetail, daProblem, waProblem, to24, DA_ZONES };
