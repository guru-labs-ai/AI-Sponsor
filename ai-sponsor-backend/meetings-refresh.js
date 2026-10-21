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
     AA          the Online Intergroup of AA's directory (aa-intergroup.org),
                 the JSON its own meeting list app loads
     Al-Anon     the World Service Office's electronic meeting finder JSON
     ACA         adultchildren.org's meeting search, online meetings only
     UA          the public Google Calendar behind UA's "Virtual Meetings"
                 page (UA's main list is in-person meetings)
     NA          NA's world meeting list (BMLT, tomato.na-bmlt.org), virtual
                 and hybrid meetings

   One directory failing or coming back thin no longer stops the rest. That
   program keeps its last good meetings AND the date they were checked, so the
   sponsor's 21-day guard (meetings.js) still retires them on time.

   A meeting is only KEPT when all of this holds:
     - it meets weekly on a named day at a named time, in a time zone we can
       place exactly (an IANA name, so clock changes are handled)
     - it is online with a direct Zoom join link, and its passcode is either in
       that link or printed in the listing
     - nothing in its listing says to email or ask someone for the link or the
       password
     - it is in English
     - it is a recovery meeting, not an intergroup, GSR or business meeting
     - its listing was updated within MAX_LISTING_AGE_DAYS. Al-Anon's finder
       publishes no such date, so for Al-Anon this one rests on the World
       Service Office keeping its own list (members report problems to it)

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
// The AA data file's name is baked into the list app's script; read it from
// there so a rename does not silently freeze us on an old file.
const AA_APP_SCRIPT = 'https://oml.code4recovery.org/online-meeting-list.js';
const AA_JSON_LAST_KNOWN = 'https://data.aa-intergroup.org/6436f5a3f03fdecef8459055.json';
const ALANON_JSON = 'https://wso.al-anon.org/apps/meeting-finder/meetings.json';
const ALANON_SOURCE = 'https://al-anon.org/al-anon-meetings/electronic-meetings/';
const ACA_PAGE = 'https://adultchildren.org/meeting-search/';
const ACA_SEARCH = 'https://adultchildren.org/wp-json/wsom/v1/meeting-search/';
const UA_ICS = 'https://calendar.google.com/calendar/ical/underearnersanonymouscalendar%40gmail.com/public/basic.ics';
const UA_PAGE = 'https://underearnersanonymous.org/meetings-underearners-anonymous/';
/* NA's world list (BMLT). venue_type 2 = virtual, 3 = hybrid; the newer
   venue_types[] filter returns nothing, so it is asked one weekday at a time. */
const NA_FIELDS = 'id_bigint,weekday_tinyint,venue_type,start_time,duration_time,time_zone,formats,lang_enum,meeting_name,comments,virtual_meeting_link,virtual_meeting_additional_info';
const NA_URL = (weekday, venueType) => `https://tomato.na-bmlt.org/main_server/client_interface/json/?switcher=GetSearchResults&weekdays[]=${weekday}&meeting_key=venue_type&meeting_key_value=${venueType}&data_field_key=${NA_FIELDS}`;
const NA_SOURCE = 'https://www.na.org/meetingsearch/';

// The least each directory has ever legitimately had, with room to spare. Fewer
// means the layout changed, not that groups vanished overnight.
const FLOOR = { DA: 50, BDA: 15, WA: 10, AA: 400, 'Al-Anon': 200, ACA: 100, UA: 20, NA: 800 };

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
const ASK_FOR_ACCESS = /(e-?mail|contact|text|call|message|ask|request)[^.]{0,60}(password|passcode|link|zoom|access)|(password|passcode|link)[^.]{0,40}(by|via|on) (e-?mail|request)|(password|passcode)\s*[:#-]?\s*\|?\s*(e-?mail|contact|text|call|ask|request|dm|pm|message)\b/i;
const NOT_WEEKLY = /\b(monthly|once a month|every other|bi-?weekly|fortnightly|(1st|2nd|3rd|4th|first|second|third|fourth|last) (\w+ )?(of (the|each|every) month))\b/i;
// NA's list carries its service bodies' own meetings too ("Policy Review
// Subcommittee", area and regional service committees, H&I, PR).
const SERVICE = /\b(intergroup|gsr|business meeting|service meeting|steering|sub-?committee|committee|area service|regional service|asc|rsc|h&i|public relations)\b/i;
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

function knownZone(zone) {
  if (!zone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

/* A Zoom room from free text: a join link if there is one, else a meeting id
   that the text itself calls a Zoom or meeting id. A bare 10-digit number is
   never taken, because phone numbers look exactly like that. */
const ZOOM_LINK = /https?:\/\/((?:[a-z0-9]+\.)?zoom\.us)\/+j\/(\d{9,11})(\?pwd=[A-Za-z0-9._-]+)?/i;
const ZOOM_ID = /(?:zoom(?:\s*meeting)?(?:\s*(?:id|i\.d\.))?|meeting\s*id|\bid)\s*(?:#|:|no\.?|number)?\s*\|?\s*(\d{3}[\s-]?\d{3,4}[\s-]?\d{3,5})(?!\d)/i;
function zoomFrom(raw, { allowId = true } = {}) {
  const text = String(raw || '');
  /* The raw text first: an href keeps the whole link, pwd and all, even when
     the visible copy of it is broken up by markup (UA's calendar has
     "j/<u></u>8147<u></u>9436405?pwd=<u></u>Q7vM..."). */
  const found = ZOOM_LINK.exec(text) || ZOOM_LINK.exec(clean(text));
  if (found) return { link: `https://${found[1].toLowerCase()}/j/${found[2]}${found[3] || ''}`, meetingId: found[2] };
  if (!allowId) return null;
  const id = ((ZOOM_ID.exec(clean(text)) || [])[1] || '').replace(/\D/g, '');
  return /^\d{9,11}$/.test(id) ? { link: `https://zoom.us/j/${id}`, meetingId: id } : null;
}

/* "Passcode: ACASydney", "Password 135048", "PW: 019634", "access code 646293".
   Web addresses are taken out first, so a pwd= token inside a link is never
   read as something to type. Without a colon the word after it must carry a
   digit, or "the password for the meeting" would read as a passcode of "for";
   and "Passcode: Email us" is an instruction, not a passcode. */
const URLS = /https?:\/\/[^\s"'<>|]+/gi;
const NOT_A_PASSCODE = /^(e-?mail|call|text|send|request|requested|see|available|contact|ask|dm|pm|message|provided|given|required|upon|sent|below|above|none|n\/a|na|tba|tbd|same|the|is|will|not|please|in|on|by|for|all|at|from|if|when|to|needed|listed|posted|shared|emailed|link|zoom|meeting|chat|group|website|here|check|follow|use|enter|type|no|yes|embedded|included|protected|private)$/i;
function passcodeFrom(raw) {
  const text = clean(String(raw || '').replace(URLS, ' '));
  const m = /(?:pass\s?code|password|\bpw\b|\bpwd\b(?=\s*:)|access\s+code)\s*(is\b)?\s*([:#])?\s*\|?\s*([A-Za-z0-9!@$%^&*._+-]{3,20})/i.exec(text);
  if (!m) return null;
  const code = m[3].replace(/[.,;:)]+$/, '');
  if (code.length < 3 || NOT_A_PASSCODE.test(code)) return null;
  if (!m[1] && !m[2] && !/\d/.test(code)) return null;
  return code;
}

// Who a meeting is for, when the directory says it is for one gender only.
function whoFrom({ types = [], text = '' }) {
  const t = types.map((x) => String(x).toLowerCase());
  if (t.some((x) => /^(w|women|women[- ]only)$/.test(x)) || /\bwomen[- ]only\b/i.test(text)) return 'women';
  if (t.some((x) => /^(m|men|men[- ]only)$/.test(x)) || /\bmen[- ]only\b/i.test(text)) return 'men';
  return null;
}

// ACA lists an "ACA Teen (Ages 12 to 18)" meeting; no adult is sent to one.
const TEEN = /\b(teens?|alateen|ages 12)\b/i;

// The rules every directory shares, on whatever free text it publishes.
function textProblem(name, text) {
  if (TEEN.test(name)) return 'teen meeting';
  if (SERVICE.test(name)) return 'service meeting';
  if (ASK_FOR_ACCESS.test(text)) return 'listing says to ask someone for the link or password';
  if (NOT_WEEKLY.test(text)) return 'not weekly';
  if (DORMANT.test(text)) return 'listing says the meeting is paused or cancelled';
  return null;
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

/* ── AA ──────────────────────────────────────────────────────────────────────
   The Online Intergroup's directory in the shared Meeting Guide format: day 0
   = Sunday, time in the row's own IANA timezone, types EN / O / C / W / M. */
async function aaJsonUrl() {
  try {
    const found = /https:\/\/data\.aa-intergroup\.org\/[a-f0-9]+\.json/.exec(await get(AA_APP_SCRIPT));
    if (found) return found[0];
  } catch { /* fall through to the last file we saw */ }
  return AA_JSON_LAST_KNOWN;
}

const aaNotes = (m) => `${m.notes || ''} ${m.conference_url_notes || ''} ${m.group_notes || ''}`;

function aaProblem(m, now) {
  const types = m.types || [];
  if (!m.slug) return 'no listing id';
  const zoom = zoomFrom(m.conference_url || '', { allowId: false });
  if (!zoom) return 'no direct Zoom link';
  if (!/pwd=/.test(zoom.link) && !passcodeFrom(aaNotes(m))) return 'no passcode in the link or the listing';
  if (!types.includes('EN')) return 'not marked English';
  const day = Number(m.day);
  if (!Number.isInteger(day) || day < 0 || day > 6 || !/^\d{2}:\d{2}$/.test(m.time || '')) return 'no fixed day and time';
  if (!knownZone(m.timezone)) return `unknown time zone ${m.timezone || '(none)'}`;
  const why = textProblem(`${m.name} ${m.group || ''}`, clean(aaNotes(m)));
  if (why) return why;
  const updated = new Date(String(m.updated || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(updated.getTime())) return 'listing has no last-updated date';
  if (ageDays(updated, now) > MAX_LISTING_AGE_DAYS) return `listing last updated ${String(m.updated).slice(0, 10)}`;
  return null;
}

async function fromAa(now, rejected) {
  const rows = await get(await aaJsonUrl(), 'json');
  const kept = [];
  for (const m of rows) {
    const why = aaProblem(m, now);
    if (why) { rejected.push(['AA', m.slug, why]); continue; }
    const zoom = zoomFrom(m.conference_url, { allowId: false });
    const types = m.types || [];
    kept.push({
      id: `aa-${m.slug}`,
      program: 'AA',
      name: m.name,
      days: [Number(m.day)],
      start: m.time,
      end: m.end_time || null,
      zone: m.timezone,
      link: zoom.link,
      meetingId: zoom.meetingId,
      passcode: /pwd=/.test(zoom.link) ? null : passcodeFrom(aaNotes(m)),
      access: types.includes('C') ? 'closed' : types.includes('O') ? 'open' : null,
      who: whoFrom({ types }),
      focus: '',
      source: m.url || 'https://aa-intergroup.org/meetings/',
      sourceUpdated: String(m.updated).slice(0, 10),
    });
  }
  return kept;
}

/* ── Al-Anon ─────────────────────────────────────────────────────────────────
   One row per meeting time: "times" is "Tuesday 08:15 PM" in the row's own
   IANA timezone. A group meeting twice a week is two rows with one wso_id. */
function alAnonWhen(times) {
  const m = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) (\d{1,2}:\d{2} [AP]M)$/i.exec(String(times || '').trim());
  if (!m) return null;
  return { day: DAYS.findIndex((d) => d.toLowerCase() === m[1].toLowerCase()), start: to24(m[2]) };
}

function alAnonProblem(m) {
  const notes = clean(m.notes);
  if (m.is_24_7) return 'runs around the clock, no fixed time';
  const zoom = zoomFrom(m.url || '', { allowId: false });
  if (!zoom) return 'no direct Zoom link';
  if (!/pwd=/.test(zoom.link) && !String(m.meeting_password || '').trim()) return 'no passcode in the link or the listing';
  if (!/\bEnglish\b/i.test(m.languages || '')) return `language is ${m.languages || 'not stated'}`;
  if (!alAnonWhen(m.times)) return 'no fixed day and time';
  if (!knownZone(m.timezone)) return `unknown time zone ${m.timezone || '(none)'}`;
  return textProblem(m.name, notes);
}

async function fromAlAnon(now, rejected) {
  const rows = await get(ALANON_JSON, 'json');
  const kept = [];
  const seen = new Set();
  for (const m of rows) {
    const why = alAnonProblem(m);
    if (why) { rejected.push(['Al-Anon', m.wso_id, why]); continue; }
    const { day, start } = alAnonWhen(m.times);
    const id = `alanon-${m.wso_id}-${day}-${start.replace(':', '')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const zoom = zoomFrom(m.url, { allowId: false });
    const types = m.types || [];
    kept.push({
      id,
      program: 'Al-Anon',
      name: m.name,
      days: [day],
      start,
      end: null,
      zone: m.timezone,
      link: zoom.link,
      meetingId: zoom.meetingId,
      passcode: /pwd=/.test(zoom.link) ? null : String(m.meeting_password).trim(),
      // Al-Anon's own words: closed is families and friends only.
      access: types.some((t) => /only$/i.test(t)) ? 'closed' : types.some((t) => /welcome/i.test(t)) ? 'open' : null,
      who: whoFrom({ types }),
      focus: '',
      source: ALANON_SOURCE,
      sourceUpdated: null,
    });
  }
  return kept;
}

/* ── ACA ─────────────────────────────────────────────────────────────────────
   The site's own search, asked for online meetings, 30 to a page. It wants
   the nonce its search page hands every visitor. DayCode 1 = Sunday (from the
   site's getMeetingDay). The Zoom details are typed into Location by hand, and
   often only virtualInfo carries the actual link. */
async function acaRows() {
  const page = await fetch(ACA_PAGE, { headers: HEADERS });
  const html = await page.text();
  const nonce = (/wsomMeetingSearch\s*=\s*\{[^}]*"nonce":"([a-f0-9]+)"/.exec(html) || [])[1];
  if (!nonce) throw new Error('ACA search page carried no nonce');
  const cookie = (page.headers.getSetCookie ? page.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  const rows = [];
  for (let p = 1, pages = 1; p <= pages && p <= 100; p++) {
    const body = new URLSearchParams([['page', String(p)], ['m_type[]', 'online'], ['Timezone', 'America/New_York'], ['showEditLink', 'false']]);
    const res = await fetch(ACA_SEARCH, {
      method: 'POST',
      body,
      headers: {
        ...HEADERS, 'X-WP-Nonce': nonce, 'X-Requested-With': 'XMLHttpRequest', Referer: ACA_PAGE,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!res.ok) throw new Error(`ACA search page ${p}: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.results)) throw new Error(`ACA search page ${p}: no results`);
    rows.push(...data.results);
    pages = Number(data.pages) || 1;
    await new Promise((r) => setTimeout(r, 400));
  }
  return rows;
}

// Raw, markup and all: zoomFrom and passcodeFrom need the hrefs.
const acaText = (m) => `${m.virtualInfo || ''} | ${m.Location || ''} | ${m.Notes || ''} | ${m.other_notes || ''}`;

function acaProblem(m, now) {
  const text = acaText(m);
  if (!String(m.MeetName || '').trim()) return 'no meeting name';
  if (TEEN.test(m.Type || '')) return 'teen meeting';
  if (m.LangValue !== 'English') return `language is ${m.LangValue || 'not stated'}`;
  const day = Number(m.DayCode);
  if (!(day >= 1 && day <= 7) || !to24(m.Time_Local)) return 'no fixed day and time';
  if (!knownZone(m.Timezone)) return `unknown time zone ${m.Timezone || '(none)'}`;
  const zoom = zoomFrom(text);
  if (!zoom) return 'no direct Zoom link';
  if (!/pwd=/.test(zoom.link) && !passcodeFrom(text)) return 'no passcode in the link or the listing';
  const why = textProblem(m.MeetName, clean(text));
  if (why) return why;
  const updated = new Date(String(m.LastUpdate || '').slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(updated.getTime())) return 'listing has no last-updated date';
  if (ageDays(updated, now) > MAX_LISTING_AGE_DAYS) return `listing last updated ${String(m.LastUpdate).slice(0, 10)}`;
  return null;
}

function acaMeeting(m) {
  const text = acaText(m);
  const zoom = zoomFrom(text);
  return {
    // One listing (SID) can meet on several days; the search returns a row each.
    id: `aca-${m.SID}-${Number(m.DayCode) - 1}-${to24(m.Time_Local).replace(':', '')}`,
    program: 'ACA',
    // The search escapes quotes in names ("Tony A\'s Steps").
    name: clean(String(m.MeetName).replace(/\\+(['"])/g, '$1')),
    days: [Number(m.DayCode) - 1],
    start: to24(m.Time_Local),
    end: null,
    zone: m.Timezone,
    link: zoom.link,
    meetingId: zoom.meetingId,
    passcode: /pwd=/.test(zoom.link) ? null : passcodeFrom(text),
    access: m.OpenClosed === 'C' ? 'closed' : m.OpenClosed === 'O' ? 'open' : null,
    who: whoFrom({ text: m.Type || '' }),
    focus: String(m.Focus || '').replace(/,\s*$/, ''),
    source: ACA_PAGE,
    sourceUpdated: String(m.LastUpdate).slice(0, 10),
  };
}

async function fromAca(now, rejected) {
  const kept = [];
  for (const m of await acaRows()) {
    const why = acaProblem(m, now);
    if (why) { rejected.push(['ACA', m.SID, why]); continue; }
    kept.push(acaMeeting(m));
  }
  return kept;
}

/* ── UA ──────────────────────────────────────────────────────────────────────
   UA's online meetings live in the Google Calendar its Virtual Meetings page
   embeds. Each meeting is a recurring event; only plain weekly series that
   have not ended are used, and edited single dates (RECURRENCE-ID) are skipped
   rather than guessed at. Descriptions are free text, often with the Zoom link
   wrapped in a google.com/url redirect. */
const ICS_DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// UA's calendar carries Italian, French and other groups; the event says so.
const NOT_ENGLISH = /\b(italia|italian|italiano|español|espanol|spanish|deutsch|german-speaking|français|francais|french-speaking|português|portugues|russian|русск|polski|svenska|nederlands|hebrew|japanese|farsi|persian|arabic|日本語)\b/i;
/* A group in a country without daylight saving that books its calendar in New
   York time moves by an hour twice a year, and says so in words the calendar
   cannot act on ("until Nov. 1 when it will be from 9:00am"). */
const SHIFTS_WITH_DST = /daylight sav/i;

function parseIcs(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  return unfolded.split('BEGIN:VEVENT').slice(1).map((block) => {
    const props = {};
    for (const line of block.split('END:VEVENT')[0].split(/\r?\n/)) {
      const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
      if (m && !(m[1] in props)) props[m[1]] = { params: m[2], value: m[3] };
    }
    return props;
  });
}

const icsText = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

// DTSTART;TZID=America/New_York:20260119T230000 -> zone, date, time
function icsWhen(prop) {
  if (!prop) return null;
  const v = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(Z?)$/.exec(prop.value);
  if (!v) return null;
  const zone = v[6] ? 'UTC' : (/TZID=([^;:]+)/.exec(prop.params) || [])[1] || null;
  return { zone, y: +v[1], mo: +v[2] - 1, d: +v[3], time: `${v[4]}:${v[5]}` };
}

// Raw, markup and all (zoomFrom and passcodeFrom need the hrefs).
function uaEventText(e) {
  const raw = `${icsText(e.DESCRIPTION && e.DESCRIPTION.value)} | ${icsText(e.LOCATION && e.LOCATION.value)}`;
  // google.com/url?q=<the real link>&sa=... -> the real link
  return raw.replace(/https?:\/\/www\.google\.com\/url\?q=([^&\s"<]+)[^\s"<]*/gi, (_, u) => {
    try { return decodeURIComponent(u); } catch { return u; }
  });
}

function uaProblem(e, now) {
  if (e['RECURRENCE-ID']) return 'a one-off change to a single date';
  if (/CANCELLED/i.test((e.STATUS || {}).value || '')) return 'cancelled';
  const rule = (e.RRULE || {}).value || '';
  if (!/FREQ=WEEKLY/.test(rule)) return 'not weekly';
  if (/INTERVAL=(?!1\b)\d+/.test(rule)) return 'not weekly';
  if (/COUNT=/.test(rule)) return 'series ends after a set number of meetings';
  const until = /UNTIL=(\d{8})/.exec(rule);
  if (until && until[1] < new Date(now).toISOString().slice(0, 10).replace(/-/g, '')) return 'series has ended';
  if (/BYDAY=[^;]*\d/.test(rule)) return 'not weekly';
  const start = icsWhen(e.DTSTART);
  if (!start) return 'no fixed day and time';
  if (!knownZone(start.zone)) return `unknown time zone ${start.zone || '(none)'}`;
  const name = icsText((e.SUMMARY || {}).value).trim();
  if (!name) return 'no meeting name';
  const text = uaEventText(e);
  if (NOT_ENGLISH.test(`${name} ${clean(text)}`)) return 'not in English';
  if (SHIFTS_WITH_DST.test(text)) return 'listing says its time moves with daylight saving';
  const zoom = zoomFrom(text);
  if (!zoom) return 'no direct Zoom link';
  if (!/pwd=/.test(zoom.link) && !passcodeFrom(text)) return 'no passcode in the link or the listing';
  const why = textProblem(name, clean(text));
  if (why) return why;
  const mod = /^(\d{4})(\d{2})(\d{2})T/.exec(((e['LAST-MODIFIED'] || e.DTSTAMP) || {}).value || '');
  if (!mod) return 'listing has no last-updated date';
  const updated = new Date(Date.UTC(+mod[1], +mod[2] - 1, +mod[3]));
  if (ageDays(updated, now) > MAX_LISTING_AGE_DAYS) return `listing last updated ${updated.toISOString().slice(0, 10)}`;
  return null;
}

function uaMeeting(e) {
  const rule = e.RRULE.value;
  const start = icsWhen(e.DTSTART);
  const end = icsWhen(e.DTEND);
  const byDay = (/BYDAY=([A-Z,]+)/.exec(rule) || [])[1];
  const days = byDay
    ? byDay.split(',').map((d) => ICS_DAYS[d]).filter((d) => d !== undefined)
    : [new Date(Date.UTC(start.y, start.mo, start.d)).getUTCDay()];
  const text = uaEventText(e);
  const zoom = zoomFrom(text);
  const name = icsText(e.SUMMARY.value).trim();
  const mod = /^(\d{4})(\d{2})(\d{2})/.exec(((e['LAST-MODIFIED'] || e.DTSTAMP) || {}).value || '');
  return {
    id: `ua-${String((e.UID || {}).value || '').split('@')[0]}`,
    program: 'UA',
    name,
    days: [...new Set(days)].sort(),
    start: start.time,
    end: end && end.zone === start.zone ? end.time : null,
    zone: start.zone,
    link: zoom.link,
    meetingId: zoom.meetingId,
    passcode: /pwd=/.test(zoom.link) ? null : passcodeFrom(text),
    access: null,
    who: /\bwomen\b/i.test(name) ? 'women' : /\bmen('s)?\b/i.test(name) ? 'men' : null,
    focus: '',
    source: UA_PAGE,
    sourceUpdated: mod ? `${mod[1]}-${mod[2]}-${mod[3]}` : null,
  };
}

async function fromUa(now, rejected) {
  const kept = [];
  const seen = new Set();
  for (const e of parseIcs(await get(UA_ICS))) {
    const id = String((e.UID || {}).value || '?');
    const why = uaProblem(e, now);
    if (why) { rejected.push(['UA', id, why]); continue; }
    const m = uaMeeting(e);
    // The same group is sometimes in the calendar twice; one entry is enough.
    const key = `${m.link}|${m.days.join(',')}|${m.start}`;
    if (seen.has(key) || !m.days.length) continue;
    seen.add(key);
    kept.push(m);
  }
  return kept;
}

/* ── NA ──────────────────────────────────────────────────────────────────────
   weekday_tinyint 1 = Sunday (BMLT). start_time "HH:MM:SS" in the row's own
   IANA time_zone, which is blank on about a sixth of rows: those are dropped,
   never guessed. Zoom details live in virtual_meeting_link and the free-text
   virtual_meeting_additional_info ("Zoom ID 919-108-6501 PW 091999"). formats
   carry O / C (open / closed) and W / M (women / men). Like Al-Anon, the list
   publishes no last-updated date. */
async function naRows() {
  const byId = new Map();
  for (const venueType of [2, 3]) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      for (const m of await get(NA_URL(weekday, venueType), 'json')) byId.set(m.id_bigint, m);
    }
  }
  return [...byId.values()];
}

const naText = (m) => `${m.virtual_meeting_link || ''} | ${m.virtual_meeting_additional_info || ''} | ${m.comments || ''}`;

function naProblem(m) {
  const text = naText(m);
  if ((m.lang_enum || 'en') !== 'en') return `language is ${m.lang_enum}`;
  const day = Number(m.weekday_tinyint);
  if (!(day >= 1 && day <= 7) || !/^\d{2}:\d{2}/.test(m.start_time || '')) return 'no fixed day and time';
  if (!knownZone(m.time_zone)) return `unknown time zone ${m.time_zone || '(none)'}`;
  if (!String(m.meeting_name || '').trim()) return 'no meeting name';
  const zoom = zoomFrom(text);
  if (!zoom) return 'no direct Zoom link';
  if (!/pwd=/.test(zoom.link) && !passcodeFrom(text)) return 'no passcode in the link or the listing';
  return textProblem(m.meeting_name, clean(text));
}

function naMeeting(m) {
  const text = naText(m);
  const zoom = zoomFrom(text);
  const formats = String(m.formats || '').split(',');
  return {
    id: `na-${m.id_bigint}`,
    program: 'NA',
    name: clean(m.meeting_name),
    days: [Number(m.weekday_tinyint) - 1],
    start: m.start_time.slice(0, 5),
    end: null,
    zone: m.time_zone,
    link: zoom.link,
    meetingId: zoom.meetingId,
    passcode: /pwd=/.test(zoom.link) ? null : passcodeFrom(text),
    access: formats.includes('C') ? 'closed' : formats.includes('O') ? 'open' : null,
    who: whoFrom({ types: formats }),
    focus: '',
    source: NA_SOURCE,
    sourceUpdated: null,
  };
}

async function fromNa(now, rejected) {
  const kept = [];
  for (const m of await naRows()) {
    const why = naProblem(m);
    if (why) { rejected.push(['NA', m.id_bigint, why]); continue; }
    kept.push(naMeeting(m));
  }
  return kept;
}

const SOURCES = [
  { programs: ['DA', 'BDA'], run: fromDa },
  { programs: ['NA'], run: fromNa },
  { programs: ['WA'], run: fromWa },
  { programs: ['AA'], run: fromAa },
  { programs: ['Al-Anon'], run: fromAlAnon },
  { programs: ['ACA'], run: fromAca },
  { programs: ['UA'], run: fromUa },
];

/* Decides, program by program, what goes into the file: this run's meetings
   when the directory answered with a believable number, otherwise the last
   good ones with their original check date. Pure, so the tests can run it. */
function assemble(results, previous, now) {
  const checked = {};
  const meetings = [];
  const problems = [];
  for (const { programs, found, error } of results) {
    for (const p of programs) {
      const mine = error ? [] : found.filter((m) => m.program === p);
      if (!error && mine.length >= FLOOR[p]) {
        meetings.push(...mine);
        checked[p] = now.toISOString();
        continue;
      }
      const old = previous && Array.isArray(previous.meetings) ? previous.meetings.filter((m) => m.program === p) : [];
      const oldChecked = previous && ((previous.checked && previous.checked[p]) || (old.length ? previous.generatedAt : null));
      problems.push(`${p}: ${error || `only ${mine.length} meetings (expected at least ${FLOOR[p]})`}; ${old.length && oldChecked ? `kept the ${old.length} from ${oldChecked.slice(0, 10)}` : 'nothing to fall back on'}`);
      if (old.length && oldChecked) {
        meetings.push(...old);
        checked[p] = oldChecked;
      }
    }
  }
  meetings.sort((a, b) => a.id.localeCompare(b.id));
  return { meetings, checked, problems };
}

async function main() {
  const now = new Date();
  const rejected = [];
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }

  const results = await Promise.all(SOURCES.map(async (s) => {
    try { return { programs: s.programs, found: await s.run(now, rejected) }; } catch (e) { return { programs: s.programs, error: e.message }; }
  }));
  const { meetings, checked, problems } = assemble(results, previous, now);
  const freshlyChecked = Object.values(checked).filter((iso) => iso === now.toISOString()).length;
  if (!freshlyChecked) {
    console.error(`Not writing: no directory answered properly.\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: now.toISOString(),
    checked,
    rules: 'weekly, online with a direct Zoom link and a known passcode, English, no ask-for-access, not a service meeting, listing updated within ' + MAX_LISTING_AGE_DAYS + ' days (Al-Anon publishes no such date)',
    meetings,
  }, null, 1) + '\n');

  const count = (p) => meetings.filter((m) => m.program === p).length;
  console.log(`Kept ${meetings.length}: ${Object.keys(FLOOR).map((p) => `${p} ${count(p)}`).join(', ')}`);
  // Shown as a yellow warning on the GitHub Actions run, so a quietly broken
  // directory is visible without failing the others.
  for (const p of problems) console.log(`::warning::${p}`);
  const reasons = {};
  for (const [prog, , why] of rejected) {
    const key = `${prog}: ${why.replace(/\(.*\)|\d{4}-\d{2}-\d{2}|is .*|zone .*/g, '').trim()}`;
    reasons[key] = (reasons[key] || 0) + 1;
  }
  console.log(`Left out ${rejected.length}:`);
  for (const [why, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${why}`);
  console.log(`Wrote ${path.basename(OUT)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  parseDaList, parseDaDetail, daProblem, waProblem, to24, DA_ZONES,
  zoomFrom, passcodeFrom, whoFrom, aaProblem, alAnonProblem, alAnonWhen, acaProblem, acaMeeting,
  parseIcs, uaProblem, uaMeeting, assemble, FLOOR, naProblem, naMeeting,
};
