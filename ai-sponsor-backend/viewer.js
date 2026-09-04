/* ─── Conversation viewer (Matt only) ────────────────────────────────────────
   Matt asked for somewhere he can read the real threads while the first users
   are on the product: "it has to be from that and the watching the interaction
   of the people". He was doing this in Instagram DMs before. This is a reading
   surface, not a metrics dashboard.

   ── No password, by decision ──────────────────────────────────────────────
   Matt types nothing. He opens his link once and he is in for the day. The
   link carries a long random key, the server swaps it for a session cookie and
   the key drops out of the address bar so it does not linger in history or in
   a screenshot.

   That is not the same as leaving /admin open. /admin is one of the first paths
   any scanner tries, so an ungated one would be found by a bot rather than by
   bad luck, and this is the most sensitive data the company holds. With a key:
   nothing without it is even acknowledged, every read is logged, and if the
   link ever leaks, rotating one env var kills every copy of it at once.

   ── Why the rest is shaped like this ──────────────────────────────────────
   This repo is PUBLIC. In July a ClickUp key was found in our shipped HTML by
   an outside researcher, because a dashboard called an API straight from
   browser JS with the key embedded in the page. Same shape of feature, far more
   sensitive data, so it repeats none of it:

   1. The page ships with no key, no user ids and no content. Anyone reading
      this repo sees markup.
   2. The key is checked SERVER side and exchanged for an httpOnly cookie that
      no script on the page can read.
   3. Content is only ever fetched at runtime by an authenticated request, never
      baked into the HTML, which is what made the July pages leak.
   4. Unset VIEWER_KEY means the whole router 404s, so this cannot be reachable
      before someone deliberately configured it.

   Every read writes to admin_access_log, which is what the published privacy
   policy promises: "Access controls limiting who on our team can reach
   conversation data, and a record kept of each time it is accessed."
──────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const KEY = process.env.VIEWER_KEY || '';
const enabled = !!KEY;

const COOKIE = 'ais_viewer';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;  // a month, so he rarely re-taps

const router = express.Router();

/* Off unless a key is set. 404 rather than 401 so an unconfigured deploy does
   not even admit the route exists. */
router.use((req, res, next) => {
  if (!enabled) return res.status(404).end();
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

/* ── Session ─────────────────────────────────────────────────────────────────
   The cookie is `<expiry>.<hmac(expiry)>`. It carries no identity and no key,
   so it grants nothing once expired and cannot be edited to extend itself. */
const sign = (expiry) => crypto.createHmac('sha256', KEY).update(String(expiry)).digest('hex');

function issue(res) {
  const expiry = Date.now() + SESSION_MS;
  res.cookie(COOKIE, `${expiry}.${sign(expiry)}`, {
    httpOnly: true,          // no script can read it, unlike a key in the page
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MS,
    path: '/admin',
  });
}

function validSession(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!hit) return false;

  const [expiry, mac] = decodeURIComponent(hit.slice(COOKIE.length + 1)).split('.');
  if (!expiry || !mac) return false;
  if (!Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) return false;

  const a = Buffer.from(mac, 'utf8');
  const b = Buffer.from(sign(expiry), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Constant time, so a near-miss key cannot be found by timing the response.
function keyMatches(given) {
  const a = Buffer.from(String(given || '').padEnd(KEY.length).slice(0, KEY.length), 'utf8');
  const b = Buffer.from(KEY, 'utf8');
  return String(given || '').length === KEY.length && crypto.timingSafeEqual(a, b);
}

function requireSession(req, res, next) {
  const ok = validSession(req);
  db.logAdminAccess(`viewer:${req.path}`, req.params.id || null, ok, req.ip).catch(() => {});
  if (!ok) return res.status(404).end();   // same answer as an unconfigured route
  next();
}

/* ── The page ────────────────────────────────────────────────────────────────
   `/admin/?k=<key>` is the link Matt keeps. It sets the session and then
   redirects to the bare path, so the key stops being in the address bar, the
   browser history, the referrer, or a screenshot of his screen.

   Anything without a key and without a session gets a plain 404. There is no
   login screen to find and nothing that confirms the route exists.          */
router.get('/', (req, res) => {
  if (req.query.k !== undefined) {
    const ok = keyMatches(req.query.k);
    db.logAdminAccess('viewer:key', null, ok, req.ip).catch(() => {});
    if (!ok) return res.status(404).end();
    issue(res);
    return res.redirect('/admin/');
  }

  if (!validSession(req)) {
    db.logAdminAccess('viewer:page', null, false, req.ip).catch(() => {});
    return res.status(404).end();
  }

  db.logAdminAccess('viewer:page', null, true, req.ip).catch(() => {});
  res.sendFile(path.join(__dirname, 'viewer.html'));
});

/* ── Data ────────────────────────────────────────────────────────────────────
   The person key is an email or a phone number, so it never goes in a URL where
   it would land in access logs and browser history. The list hands out an opaque
   id instead, resolved back here. */
const idFor = (person) =>
  crypto.createHash('sha256').update(String(person)).digest('hex').slice(0, 16);

router.get('/api/conversations', requireSession, async (req, res) => {
  try {
    const rows = await db.listConversations();
    res.json(rows.map((r) => ({
      id: idFor(r.person),
      name: r.name || 'No name given',
      access: r.access || null,
      messages: r.messages,
      firstAt: r.first_at,
      lastAt: r.last_at,
    })));
  } catch (err) {
    console.error('[viewer] list failed:', err.message);
    res.status(500).json({ error: 'could not load conversations' });
  }
});

router.get('/api/conversations/:id', requireSession, async (req, res) => {
  try {
    const rows = await db.listConversations();
    const match = rows.find((r) => idFor(r.person) === req.params.id);
    if (!match) return res.status(404).json({ error: 'not found' });

    const thread = await db.getFullThread(match.person);
    res.json({
      name: match.name || 'No name given',
      /* null for anything written before the medium was recorded. Passed
         through as null rather than defaulted to 'text', because months of
         voice notes are sitting in those rows and calling them typing would be
         a made-up number on a screen somebody makes decisions from. */
      messages: (thread || []).map((m) => ({
        role: m.role, content: m.content, at: m.created_at, medium: m.medium || null,
      })),
      spoken: (thread || []).filter((m) => m.medium === 'voice').length,
      typed: (thread || []).filter((m) => m.medium === 'text').length,
      unknownMedium: (thread || []).filter((m) => !m.medium).length,
    });
  } catch (err) {
    console.error('[viewer] thread failed:', err.message);
    res.status(500).json({ error: 'could not load this conversation' });
  }
});

module.exports = { router, enabled };
