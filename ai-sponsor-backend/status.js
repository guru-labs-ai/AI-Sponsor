/* ─── Is anything wrong with AI Sponsor ──────────────────────────────────────
   Matt, 9 Sep: "shows the ongoing situation for ai sponsor regarding
   everything ... if something inside getaisponsor is wrong, something during
   registration is wrong, inside settings, inside whatsapp chat, if something
   wrong with users, subscriptions, master prompt, backend or anything and then
   we can check that all the time me matt or mubashir without me coming to you
   and asking if something is wrong".

   ⭐ WHY THIS EXISTS AT ALL, and the shape of the failure it is built around.
   On 1 Sep the OpenAI credit balance hit $0. Every inbound voice note failed
   for two days. Text worked, outbound voice worked, nothing looked wrong, and
   the generic "I'm having a moment" fallback wrapped the whole handler so the
   real cause never surfaced. It cost us Sylvia, who sent two voice notes,
   watched both fail, and asked to be deleted sixteen seconds later.

   ⛔ SO THE PROVIDER CHECKS MAKE REAL CALLS THAT SPEND MONEY, deliberately.
   Asking a provider "is my key valid" answers a different question from "will
   my next request work". A key with a $0 balance passes every models-list check
   there is and fails the moment it is used. That distinction is the entire
   reason the outage lasted two days, so the checks that matter here send a
   one-token request and read the error code back.

   ── What this is NOT ────────────────────────────────────────────────────────
   Not a metrics page. The north star already answers "how are we doing". This
   only ever answers "is it broken", and the two are kept apart on purpose: a
   page that mixes growth numbers with alarms trains you to skim both.

   ── Access ──────────────────────────────────────────────────────────────────
   Same shape as viewer.js, for the same reasons, and read that file's header
   for the full argument. Short version: this repo is public, so the page ships
   with no key and no data, the key is checked server side and exchanged for an
   httpOnly cookie, and an unset STATUS_KEY 404s the whole router rather than
   leaving it discoverable. One shared link for the four people who need it
   (Mariam's call, 9 Sep), so rotating STATUS_KEY revokes everyone at once.   */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const alerts = require('./alerts');
const db = require('./db');

const KEY = process.env.STATUS_KEY || '';
const enabled = !!KEY;

const COOKIE = 'ais_status';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/* Providers cost money to check properly, so a result is reused for a few
   minutes. Someone refreshing the page must not be able to run up a bill, and
   nothing here changes second to second anyway. */
const CACHE_MS = 5 * 60 * 1000;
let cached = null;

const router = express.Router();

router.use((req, res, next) => {
  if (!enabled) return res.status(404).end();
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

/* ── Session, lifted from viewer.js ─────────────────────────────────────────
   `<expiry>.<hmac(expiry)>`. Carries no identity and no key, so it grants
   nothing once expired and cannot be edited to extend itself. */
const sign = (expiry) => crypto.createHmac('sha256', KEY).update(String(expiry)).digest('hex');

function issue(res) {
  const expiry = Date.now() + SESSION_MS;
  res.cookie(COOKIE, `${expiry}.${sign(expiry)}`, {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: SESSION_MS, path: '/status',
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

function keyMatches(given) {
  const g = String(given || '');
  if (g.length !== KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(g, 'utf8'), Buffer.from(KEY, 'utf8'));
}

/* ── The context server.js hands over ────────────────────────────────────────
   The master prompt lives in server.js, and server.js requires this file, so
   reaching back for it would be a cycle. It is passed in at mount time
   instead. */
let ctx = { masterPrompt: '' };
function setContext(next) { ctx = { ...ctx, ...(next || {}) }; }

/* ── One check ───────────────────────────────────────────────────────────────
   Every check answers with the same shape so the page never has to special-case
   one. `state` is 'ok', 'warn' or 'down'.

   ⚠️ A check that THROWS is reported as 'warn', never 'ok' and never 'down'.
   Not down, because our inability to ask is not proof the thing is broken, and
   crying wolf is how a status page gets ignored. Not ok, because we genuinely
   do not know. "Could not check" is its own answer and it is an honest one. */
const TIMEOUT_MS = 8000;

async function timed(name, group, fn) {
  const started = Date.now();
  try {
    const out = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
    ]);
    return { name, group, ms: Date.now() - started, state: out.state, detail: out.detail };
  } catch (e) {
    return { name, group, ms: Date.now() - started, state: 'warn', detail: `could not check: ${e.message}` };
  }
}

const ok = (detail) => ({ state: 'ok', detail });
const warn = (detail) => ({ state: 'warn', detail });
const down = (detail) => ({ state: 'down', detail });

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { r, body };
}

/* ── The checks ──────────────────────────────────────────────────────────── */

// The sponsor's brain. If this is down nobody gets a reply at all.
async function checkAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return down('no ANTHROPIC_API_KEY set');
  const { r, body } = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    }),
  });
  if (r.ok) return ok('replying');
  const err = (body.error && body.error.message) || `HTTP ${r.status}`;
  if (r.status === 401) return down(`key rejected: ${err}`);
  if (r.status === 400 && /credit|balance|quota/i.test(err)) return down(`out of credit: ${err}`);
  if (r.status === 429) return warn(`rate limited: ${err}`);
  return warn(err);
}

/* Inbound voice notes. THE ONE THAT ACTUALLY DIED, so it is checked by using it
   rather than by asking whether the key exists. */
async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) return down('no OPENAI_API_KEY set, voice notes cannot be transcribed');
  const { r, body } = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1, messages: [{ role: 'user', content: '.' }] }),
  });
  if (r.ok) return ok('billing live, voice notes can be transcribed');
  const err = (body.error && body.error.message) || `HTTP ${r.status}`;
  const code = (body.error && body.error.code) || '';
  if (r.status === 401) return down(`key rejected: ${err}`);
  // The 1 Sep outage, exactly. Worth naming rather than leaving as "429".
  if (code === 'insufficient_quota' || /quota|billing|credit/i.test(err)) {
    return down(`OUT OF CREDIT. Inbound voice notes are failing silently: ${err}`);
  }
  if (r.status === 429) return warn(`rate limited: ${err}`);
  if (r.status === 404) return warn(`could not confirm billing (model unavailable): ${err}`);
  return warn(err);
}

// The voice the sponsor speaks in. Text still works without it.
async function checkXai() {
  if (!process.env.XAI_API_KEY) return warn('no XAI_API_KEY set, the sponsor cannot speak');
  const r = await fetch('https://api.x.ai/v1/models', {
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  });
  if (r.ok) return ok('key valid');
  if (r.status === 401 || r.status === 403) return down(`key rejected (HTTP ${r.status})`);
  return warn(`HTTP ${r.status}`);
}

async function checkDatabase() {
  if (!db.enabled) return down('DATABASE_URL not set, nothing is being remembered');
  const t = await db.ping();
  return ok(`answering in ${t}ms`);
}

/* What the sponsor is actually told to be. A truncated or empty prompt is the
   kind of failure that produces a plausible-sounding stranger rather than an
   error, so it is worth watching a number that should never move much. */
function checkMasterPrompt() {
  const len = String(ctx.masterPrompt || '').length;
  if (!len) return down('the master prompt is EMPTY, the sponsor has no instructions');
  if (len < 8000) return down(`the master prompt is only ${len} characters, it looks truncated`);
  return ok(`${len.toLocaleString()} characters loaded`);
}

/* ⛔ THE STRIPE ACCOUNT IS SHARED and this check was wrong until it was run.
   A plain subscription count came back "2 active", which looks like ours and is
   not: the account is Audos-administered and carries other products entirely,
   Coach AI, coachmate, monthlystory. Isolation there is inbound only.

   So this counts subscriptions on OUR OWN price ids and nothing else. If the
   price ids are not configured it reports reachability and refuses to put a
   number up, because a confidently wrong number on a status page is worse than
   no number: somebody acts on it. */
async function checkStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return warn('no STRIPE_SECRET_KEY set, nobody can pay');
  const auth = { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } };
  const prices = [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_ANNUAL].filter(Boolean);

  // Reachability first, and it is its own answer even when the count is not.
  const probe = await fetchJson('https://api.stripe.com/v1/subscriptions?limit=1', auth);
  if (!probe.r.ok) {
    const err = (probe.body.error && probe.body.error.message) || `HTTP ${probe.r.status}`;
    return probe.r.status === 401 ? down(`key rejected: ${err}`) : warn(err);
  }
  if (!prices.length) return warn('reachable, but no AI Sponsor price ids are set so nothing can be counted');

  let trialing = 0, active = 0;
  for (const price of prices) {
    const { r, body } = await fetchJson(
      `https://api.stripe.com/v1/subscriptions?limit=100&status=all&price=${encodeURIComponent(price)}`, auth);
    if (!r.ok) return warn('reachable, but the AI Sponsor subscriptions could not be listed');
    for (const s of body.data || []) {
      if (s.status === 'trialing') trialing++;
      else if (s.status === 'active') active++;
    }
  }
  return ok(`${trialing} in trial, ${active} paying (AI Sponsor only, the account is shared)`);
}

async function checkGhl() {
  if (!process.env.GHL_API_TOKEN) return warn('no GHL_API_TOKEN set, registrations reach nobody');
  const loc = process.env.GHL_LOCATION_ID || 'Mgfec8mT0vXxyhp9SizK';
  const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${loc}&limit=1`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  });
  if (r.ok) return ok('reachable, registrations can be filed');
  if (r.status === 401) return down(`token rejected (HTTP 401), new registrations are not reaching GHL`);
  return warn(`HTTP ${r.status}`);
}

async function checkWhatsApp() {
  const token = process.env.META_WA_TOKEN;
  const id = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !id) return down('Meta WhatsApp is not configured, the number is not being answered');
  const v = process.env.META_GRAPH_VERSION || 'v25.0';
  const { r, body } = await fetchJson(
    `https://graph.facebook.com/${v}/${id}?fields=display_phone_number,quality_rating,verified_name`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) {
    const err = (body.error && body.error.message) || `HTTP ${r.status}`;
    /* A Meta token expiring is a silent, total outage of the only channel most
       people use, so it is never softened to a warning. */
    return down(`token rejected: ${err}`);
  }
  const q = body.quality_rating || 'UNKNOWN';
  const line = `${body.display_phone_number || id}, quality ${q}`;
  return q === 'RED' ? warn(`${line}. Meta has flagged message quality`) : ok(line);
}

/* The pages a person actually lands on. Checked by fetching them, because
   "the site is deployed" and "the page loads" are different claims. */
function pageCheck(name, url, mustContain) {
  return async () => {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return down(`HTTP ${r.status}`);
    if (mustContain) {
      const html = await r.text();
      if (!html.includes(mustContain)) return warn(`loads, but "${mustContain}" is missing from it`);
    }
    return ok('loads');
  };
}

const SITE = 'https://getaisponsor.com';

async function runChecks() {
  const results = await Promise.all([
    timed('Sponsor replies', 'The sponsor', checkAnthropic),
    timed('Master prompt', 'The sponsor', async () => checkMasterPrompt()),
    timed('Voice notes in', 'The sponsor', checkOpenAI),
    timed('Sponsor speaks', 'The sponsor', checkXai),

    timed('WhatsApp number', 'WhatsApp', checkWhatsApp),

    timed('Database', 'Backend', checkDatabase),

    timed('Landing page', 'Website', pageCheck('', SITE, null)),
    timed('Registration', 'Website', pageCheck('', `${SITE}/ai-sponsor-registration.html`, 'beta')),
    timed('Settings page', 'Website', pageCheck('', `${SITE}/ai-sponsor-settings.html`, null)),
    // Both are promised by the published privacy policy, so a 404 is a real problem.
    timed('Privacy policy', 'Website', pageCheck('', `${SITE}/privacy.html`, null)),
    timed('Terms', 'Website', pageCheck('', `${SITE}/terms.html`, null)),

    timed('Payments', 'Money', checkStripe),
    timed('GHL (registrations)', 'Money', checkGhl),
  ]);

  const worst = results.some((r) => r.state === 'down') ? 'down'
    : results.some((r) => r.state === 'warn') ? 'warn' : 'ok';

  return {
    checkedAt: new Date().toISOString(),
    overall: worst,
    commit: process.env.RENDER_GIT_COMMIT ? String(process.env.RENDER_GIT_COMMIT).slice(0, 7) : null,
    uptimeSeconds: Math.round(process.uptime()),
    checks: results,
  };
}

async function getStatus({ fresh } = {}) {
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const data = await runChecks();
  cached = { at: Date.now(), data };
  return data;
}

/* What somebody sees when they land here without their link. Inline rather than
   a file because it must work even if nothing else does, and it says nothing
   about the state of the system to someone who is not allowed to know it. */
const NO_KEY_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>AI Sponsor — Is anything wrong</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#F0F4F8;color:#212529;
  margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0f1720;color:#F3F4F6}}
.box{max-width:380px;text-align:center}
h1{font-size:19px;font-weight:700;margin:0 0 10px}
p{font-size:14px;line-height:1.6;opacity:.8;margin:0 0 8px}
</style></head><body><div class="box">
<h1>You need your own link for this</h1>
<p>This page is limited to a few people, and the link carries the key. Open the
one you were sent and you will stay signed in on this device for a month.</p>
<p>If you do not have it, ask Mariam.</p>
</div></body></html>`;

/* ── Routes ──────────────────────────────────────────────────────────────── */

router.get('/', (req, res) => {
  if (req.query.k !== undefined) {
    const good = keyMatches(req.query.k);
    db.logAdminAccess('status:key', null, good, req.ip).catch(() => {});
    /* A key that does not work is usually an old link or a truncated paste, not
       an attack, and "404" tells that person nothing they can act on. */
    if (!good) return res.status(401).type('html').send(NO_KEY_PAGE);
    issue(res);
    return res.redirect('/status/');
  }
  /* ⚠️ NOT A BARE 404, unlike the conversation reader, and the difference is
     deliberate. That one hides its own existence because finding it is most of
     the attack; this one is LINKED FROM THE PUBLIC DASHBOARD, so pretending it
     is not there fools nobody and only confuses the four people who are meant
     to be here. Mariam opened it without her key, got a blank 404 and
     reasonably read it as broken.

     Still gives away nothing: no data, no check names, no hint of whether
     anything is wrong. Just what to do next. */
  if (!validSession(req)) {
    res.status(401).type('html').send(NO_KEY_PAGE);
    return;
  }
  res.sendFile(path.join(__dirname, 'status.html'));
});

router.get('/data', async (req, res) => {
  if (!validSession(req)) return res.status(404).end();
  try {
    res.json(await getStatus({ fresh: req.query.fresh === '1' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── The daily check ─────────────────────────────────────────────────────────
   Triggered from outside, never on a timer in here. Render's free tier spins
   the instance down, so setInterval simply does not fire, and a scheduler that
   silently never runs is worse than no scheduler.

   ⭐ POSTS ONLY WHEN SOMETHING IS WRONG (Mariam, 9 Sep: "only post inside ai
   sponsor updates if there is any issue"). A daily all-clear becomes wallpaper
   inside a week and then nobody reads the one that matters. */
/* ⚠️ SAME PROBLEM, SAME MESSAGE, OVER AND OVER is how an alert channel becomes
   something people mute, and a muted channel is worse than no channel. The
   check runs every few hours so a real outage is caught quickly, but an
   ONGOING one is only repeated twice a day.

   Kept in the database rather than in memory on purpose: Render's free tier
   sleeps and restarts constantly, so anything held in a variable is forgotten
   within the hour and every run would look like the first. Filed against a
   sentinel id, which never appears in any metric because those group the users
   table, not this one. */
const ALERT_USER = 'system-status';
const REPEAT_AFTER_MS = 12 * 60 * 60 * 1000;

async function alreadyToldThem(signature) {
  if (!db.enabled) return false;
  const prior = await db.getEvents(ALERT_USER, 5).catch(() => []);
  const last = prior.find((e) => e.event === 'status_alert');
  if (!last) return false;
  const sameProblem = last.detail && last.detail.signature === signature;
  const recent = Date.now() - new Date(last.created_at).getTime() < REPEAT_AFTER_MS;
  return sameProblem && recent;
}

async function runAndAlert() {
  const data = await getStatus({ fresh: true });
  if (data.overall === 'ok') return { posted: false, overall: 'ok' };

  const bad = data.checks.filter((c) => c.state !== 'ok');
  /* The set of things wrong, not their wording: a detail that carries a
     changing figure must not read as a brand new problem every time. */
  const signature = bad.map((c) => `${c.name}:${c.state}`).sort().join('|');
  if (await alreadyToldThem(signature)) {
    return { posted: false, overall: data.overall, suppressed: 'same problem already reported' };
  }
  /* ⭐ @channel ONLY WHEN SOMETHING IS ACTUALLY BROKEN. A message sitting in a
     channel is not a notification: it reaches somebody when they next happen to
     look, which for an outage is too late. The three people in this channel are
     exactly the three who need it (Matt, Mubashir, Mariam), so a red state
     pings them.

     An amber does NOT ping. "Could not check the xAI key" at 3am is not worth
     waking anyone, and a ping that is sometimes ignorable is a ping that gets
     muted, which would cost us the red one too. */
  const broken = data.overall === 'down';
  const lines = [
    broken
      ? '<!channel> 🔴 *AI Sponsor: something is broken*'
      : '🟠 *AI Sponsor: something needs a look*',
    '',
    ...bad.map((c) => `${c.state === 'down' ? '🔴' : '🟠'} *${c.name}* (${c.group}) — ${c.detail}`),
    '',
    `Checked ${new Date(data.checkedAt).toUTCString()}`,
  ];

  /* ⚠️ SENT BEFORE IT IS FILED, and the order is the whole point. Recording
     first would mark the problem "already reported" even when the send failed,
     and the next run would suppress it. That is the exact silent-failure shape
     this page exists to catch, and building it into the thing doing the
     catching would be embarrassing. */
  const sent = await alerts._internals.send(lines);
  /* send() returns {ok:false, skipped} rather than throwing when there is no
     SLACK_BOT_TOKEN, so "it did not throw" is NOT proof anybody was told. */
  if (!sent || sent.ok !== true) {
    throw new Error(`Slack did not accept the alert: ${(sent && (sent.error || sent.skipped)) || 'unknown'}`);
  }

  db.recordEvent(ALERT_USER, 'status_alert', { signature, overall: data.overall }, 'status')
    .catch((e) => console.warn('[status] could not record the alert:', e.message));

  return { posted: true, overall: data.overall, problems: bad.length, pinged: broken };
}

router.post('/check', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(404).json({ error: 'Not enabled' });
  const given = String(req.get('x-cron-secret') || '');
  const good = given.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!good) return res.status(403).json({ error: 'Forbidden' });
  try {
    res.json(await runAndAlert());
  } catch (e) {
    console.error('[status] daily check failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, enabled, setContext, runChecks, getStatus, runAndAlert, _internals: { timed } };
