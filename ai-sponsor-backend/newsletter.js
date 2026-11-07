/* ─── The newsletter, on the North Star page ─────────────────────────────────
   Mariam, 6 Nov 2026: "do we have our own metrics, who opened it, is it on
   North Star". The newsletter is built and sent from GHL, so its numbers live
   there and nowhere in our own DB. This reads them back, a few times a day,
   and hands the North Star endpoint totals per issue. No names or emails ever
   leave this file.

   How an issue is found:
   - GHL's campaign list (/emails/schedule) gives every send with its subject,
     time and size. An issue is a finished send whose subject starts with
     "The AI Sponsor newsletter" to at least MIN_LIST people. The team test
     sends reuse the same subject but go to two or three people, so the size is
     what tells them apart.
   - The message export (/conversations/messages/export) lists every email in a
     time window. The issue's own emails are the outbound campaign ones with
     its subject, sent within a day of it going out.
   - Each email's latest state (delivered, opened, clicked...) comes from
     /conversations/messages/email/{id}. It is the LATEST state only, so a
     click already includes the open before it.
   - Replies are the inbound emails whose subject carries the issue's subject
     ("Re: ..."), from after it went out.

   Who is left out: QA Guru's test inbox, the reserved test domains, everyone
   in EXCLUDED_PEOPLE (the team, kept out of every metric), and
   NEWSLETTER_EXCLUDED, for team members who get the newsletter but are not in
   EXCLUDED_PEOPLE. That second list exists so leaving someone out of the
   newsletter numbers does not also change the user counts on the same page.
   Both lists live in the Render env, never in this file: this repo is public.

   Opens are rough. Some mail apps open every email the moment it arrives, so
   an open is not proof a person read it. Clicks and replies are the honest
   signal, and the page says so. */

const { isQaTest } = require('./qatest');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = process.env.GHL_LOCATION_ID || 'Mgfec8mT0vXxyhp9SizK';

const SUBJECT_PREFIX = 'The AI Sponsor newsletter';
const MIN_LIST = 10;          // smaller sends are the team's test sends
const MAX_ISSUES = 8;         // newest first; older issues stop being fetched
const SEND_WINDOW_MS = 24 * 3600 * 1000;
const REFRESH_MS = 3 * 3600 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const CONCURRENCY = 2;        // GHL is shared with every other product; be gentle

// RFC 2606 reserved domains plus test.com: an address there is never a person.
const TEST_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com'];

function listFromEnv(name) {
  return String(process.env[name] || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@'));
}

function emailOf(v) {
  const s = Array.isArray(v) ? v[0] : v;
  const m = String(s || '').match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return m ? m[0].toLowerCase() : '';
}

function isLeftOut(email, excluded) {
  if (!email) return true;
  if (isQaTest(email)) return true;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (TEST_DOMAINS.includes(domain)) return true;
  return excluded.has(email);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghlGet(path) {
  const token = process.env.GHL_API_TOKEN;
  if (!token) throw new Error('GHL_API_TOKEN missing');
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${GHL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: 'application/json' },
    });
    if (resp.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(`GHL ${path.split('?')[0]} failed (${resp.status})`);
      err.statusCode = resp.status;
      throw err;
    }
    return json;
  }
  throw new Error(`GHL ${path.split('?')[0]} kept rate limiting`);
}

// The finished, full-size sends, newest first.
async function listIssues() {
  const json = await ghlGet(`/emails/schedule?locationId=${LOCATION_ID}&limit=100`);
  return (json.schedules || [])
    .filter((s) => s.status === 'complete'
      && typeof s.subject === 'string' && s.subject.startsWith(SUBJECT_PREFIX)
      && Number(s.totalCount) >= MIN_LIST && s.dateScheduled)
    .map((s) => ({ id: s.id, subject: s.subject, sentAt: Number(s.dateScheduled) }))
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, MAX_ISSUES);
}

// Every email in the location between two times. The location is shared with
// other products, so this is capped rather than trusted to be small.
async function exportEmails(fromMs, toMs) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 40; page++) {
    const q = `locationId=${LOCATION_ID}&channel=Email&limit=100`
      + `&startDate=${new Date(fromMs).toISOString()}&endDate=${new Date(toMs).toISOString()}`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const json = await ghlGet(`/conversations/messages/export?${q}`);
    out.push(...(json.messages || []));
    cursor = json.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/* A click is the last thing that can happen to an email we count, so once one
   is seen it is not asked about again. Everything else is re-read, because an
   email delivered this morning can still be opened tonight. */
const knownStatus = new Map();

async function statusOf(messageId) {
  if (knownStatus.get(messageId) === 'clicked') return 'clicked';
  const json = await ghlGet(`/conversations/messages/email/${messageId}`);
  const status = String((json.emailMessage || json).status || 'unknown').toLowerCase();
  knownStatus.set(messageId, status);
  return status;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const OPENED = new Set(['opened', 'clicked']);
const DID_NOT_ARRIVE = new Set(['failed', 'bounced', 'permanent_fail', 'rejected', 'undelivered']);
// How far an email got, for somebody sent more than one copy.
const RANK = { clicked: 5, opened: 4, unsubscribed: 3, delivered: 2, sent: 1 };

async function compute(now = Date.now()) {
  const excluded = new Set([...listFromEnv('EXCLUDED_PEOPLE'), ...listFromEnv('NEWSLETTER_EXCLUDED')]);
  const issues = await listIssues();
  if (!issues.length) return { updatedAt: new Date(now).toISOString(), issues: [], peopleWhoOpenedAny: 0 };

  const oldest = Math.min(...issues.map((i) => i.sentAt));
  const emails = await exportEmails(oldest - 5 * 60 * 1000, now);

  const openedAny = new Set();
  const out = [];
  for (const issue of issues) {
    const own = emails.filter((m) => m.direction === 'outbound' && m.source === 'campaign'
      && m.subject === issue.subject
      && Date.parse(m.dateAdded) >= issue.sentAt - 5 * 60 * 1000
      && Date.parse(m.dateAdded) <= issue.sentAt + SEND_WINDOW_MS);

    // One person, one count: if GHL ever sent somebody two, the further one
    // got (an open on either copy) is theirs.
    const byPerson = new Map();
    own.forEach((m) => {
      const who = emailOf(m.to);
      if (isLeftOut(who, excluded)) return;
      if (!byPerson.has(who)) byPerson.set(who, []);
      byPerson.get(who).push(m.id);
    });
    const people = [...byPerson.keys()];
    const statuses = await mapLimit([...byPerson.values()], CONCURRENCY, async (ids) => {
      let best = null;
      for (const id of ids) {
        const s = await statusOf(id).catch(() => 'unknown');
        if (best === null || (RANK[s] || 0) > (RANK[best] || 0)) best = s;
      }
      return best;
    });

    let opened = 0, clicked = 0, didNotArrive = 0, unsubscribed = 0;
    statuses.forEach((s, i) => {
      if (OPENED.has(s)) { opened++; openedAny.add(people[i]); }
      if (s === 'clicked') clicked++;
      if (DID_NOT_ARRIVE.has(s)) didNotArrive++;
      if (s === 'unsubscribed') unsubscribed++;
    });

    const repliedBy = new Set();
    emails.forEach((m) => {
      if (m.direction !== 'inbound') return;
      if (!String(m.subject || '').includes(issue.subject)) return;
      if (Date.parse(m.dateAdded) < issue.sentAt) return;
      const who = emailOf(m.from);
      if (!isLeftOut(who, excluded)) repliedBy.add(who);
    });

    out.push({
      sentAt: new Date(issue.sentAt).toISOString(),
      title: issue.subject.slice(SUBJECT_PREFIX.length).replace(/^[\s:–-]+/, '') || issue.subject,
      sent: people.length,
      didNotArrive,
      opened,
      clicked,
      replied: repliedBy.size,
      unsubscribed,
    });
  }

  return {
    updatedAt: new Date(now).toISOString(),
    issues: out,
    peopleWhoOpenedAny: openedAny.size,
  };
}

/* The North Star endpoint is cached for a minute and must stay fast, so it
   never waits on this. It takes whatever was last worked out, and a refresh
   runs in the background when that is older than REFRESH_MS. Until the first
   one finishes after a restart, the card says it is still counting. */
let cached = null;
let lastAttempt = 0;
let running = null;

function refresh() {
  if (running) return running;
  lastAttempt = Date.now();
  running = compute()
    .then((data) => { cached = data; })
    .catch((e) => console.error('[newsletter] refresh failed:', e.message))
    .finally(() => { running = null; });
  return running;
}

function getCached() {
  const age = cached ? Date.now() - Date.parse(cached.updatedAt) : Infinity;
  // A failed refresh waits RETRY_MS before the next try, rather than going
  // again on every page load.
  const due = age > REFRESH_MS && Date.now() - lastAttempt > RETRY_MS;
  if (due && process.env.GHL_API_TOKEN) refresh();
  return cached;
}

module.exports = { getCached, refresh, compute, _test: { emailOf, isLeftOut, listFromEnv, knownStatus } };
