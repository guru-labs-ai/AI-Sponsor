/* ─── Google Search Console: what people searched before clicking us ─────────
   Matt, 12 Nov 2026, on a sign-up that came from Google: "do we have more
   specific information on where from Google... search query etc".

   Google never tells a website what one person searched. Search Console is
   the only place the words exist, and only as totals: per day, per search,
   per page, never per visitor. So this answers "which searches bring people
   to us", not "what did this person type". The North Star page says so.

   Read only. A Google Cloud service account is added as a user on the
   getaisponsor.com property (Settings, Users and permissions, Restricted is
   enough) and its JSON key is set on Render:
     GSC_SERVICE_ACCOUNT_JSON  the key file's contents, raw or base64
     GSC_SITE_URL              optional, default https://getaisponsor.com/
                               (a URL-prefix property, verified 17 Jun 2026)
   Unset means weekly() returns null and the page shows nothing: no pretend
   numbers. No new package: the token is a JWT signed with Node's own crypto.
──────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');
const { pageLabel } = require('./db');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const CACHE_MS = 6 * 60 * 60 * 1000; // the numbers move once a day at most

/* Search Console finishes counting a day two to three days late. A window
   that ends today would show numbers that quietly grow after somebody has
   read them, so the week shown ends three days ago and stays put. */
const SETTLE_DAYS = 3;

let tokenCache = { token: null, exp: 0 };
let weekCache = { at: 0, key: '', data: null };

function siteUrl() {
  return process.env.GSC_SITE_URL || 'https://getaisponsor.com/';
}

function credentials() {
  const raw = (process.env.GSC_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const key = JSON.parse(text);
    return key.client_email && key.private_key ? key : null;
  } catch (e) {
    console.warn('[gsc] GSC_SERVICE_ACCOUNT_JSON is set but is not a readable key file');
    return null;
  }
}

function enabled() {
  return Boolean(credentials());
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the key: ${body.error_description || body.error || res.status}`);
  }
  tokenCache = { token: body.access_token, exp: now + (body.expires_in || 3600) };
  return tokenCache.token;
}

async function query(token, request) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl())}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    /* 403 here almost always means the service account was never added to
       the property, which is a setup step, not a bug. Said in those words. */
    const why = res.status === 403
      ? 'the service account is not a user on the Search Console property'
      : (body.error && body.error.message) || `HTTP ${res.status}`;
    throw new Error(`Search Console: ${why}`);
  }
  return body.rows || [];
}

const ymd = (d) => d.toISOString().slice(0, 10);
function windowEnding(end, days) {
  const to = new Date(end);
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: ymd(from), to: ymd(to) };
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch (e) { return String(url || ''); }
}

/* The last settled week, the week before it for movement, the searches and
   pages behind the clicks. Everything is a total; nothing names a person. */
async function weekly({ now = new Date() } = {}) {
  const key = credentials();
  if (!key) return null;

  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - SETTLE_DAYS);
  const week = windowEnding(end, 7);
  const prevEnd = new Date(end);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 7);
  const prev = windowEnding(prevEnd, 7);

  const cacheKey = `${week.from}:${week.to}`;
  if (weekCache.data && weekCache.key === cacheKey && Date.now() - weekCache.at < CACHE_MS) {
    return weekCache.data;
  }

  const token = await accessToken(key);
  const range = (w) => ({ startDate: w.from, endDate: w.to });
  const [total, before, searches, pages] = await Promise.all([
    query(token, range(week)),
    query(token, range(prev)),
    query(token, { ...range(week), dimensions: ['query'], rowLimit: 25 }),
    query(token, { ...range(week), dimensions: ['page'], rowLimit: 25 }),
  ]);

  const sum = (rows) => ({
    clicks: Math.round(rows[0]?.clicks || 0),
    impressions: Math.round(rows[0]?.impressions || 0),
  });
  const byClicks = (x, y) => (y.clicks - x.clicks) || (y.impressions - x.impressions);

  const data = {
    from: week.from,
    to: week.to,
    ...sum(total),
    // Average position in the results, 1 = top. Only meaningful with impressions.
    position: total[0]?.impressions ? Math.round(total[0].position * 10) / 10 : null,
    previous: { from: prev.from, to: prev.to, ...sum(before) },
    topSearches: searches
      .map((r) => ({ search: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions) }))
      .sort(byClicks).slice(0, 8),
    topPages: pages
      .map((r) => ({ page: pageLabel(pathOf(r.keys[0])) || r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions) }))
      .sort(byClicks).slice(0, 5),
  };
  weekCache = { at: Date.now(), key: cacheKey, data };
  return data;
}

module.exports = { weekly, enabled, _internals: { windowEnding, credentials, SETTLE_DAYS } };
