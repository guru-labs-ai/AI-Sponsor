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
    return {
      name, group, ms: Date.now() - started,
      state: out.state, detail: out.detail,
      impact: out.impact || null, action: out.action || null,
    };
  } catch (e) {
    return {
      name, group, ms: Date.now() - started, state: 'warn',
      detail: `could not check: ${e.message}`,
      impact: 'Unknown. This check could not run, so this part of the product is unwatched rather than known to be fine.',
      action: 'Open the page again in a few minutes. If it keeps saying this, the check itself is broken and needs looking at.',
    };
  }
}

/* Every result can carry two extra things, and they only ever appear on the
   page when something is wrong:

     impact  who is hurt by this, in plain words
     action  the next thing a person should actually do

   Matt's ask, 9 Sep: "if there is an issue you send more details about it when
   somebody opens the link and reads it". A status page that says "Voice notes
   in: down" and stops has told you the least useful half. The half that
   matters is that people are sending voice notes and silently getting nothing
   back, and that the fix is a billing page rather than a deploy. */
const ok = (detail, extra) => ({ state: 'ok', detail, ...(extra || {}) });
const warn = (detail, extra) => ({ state: 'warn', detail, ...(extra || {}) });
const down = (detail, extra) => ({ state: 'down', detail, ...(extra || {}) });

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { r, body };
}

/* ── The checks ──────────────────────────────────────────────────────────── */

// The sponsor's brain. If this is down nobody gets a reply at all.
async function checkAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return down('no ANTHROPIC_API_KEY set', {
    impact: 'The sponsor cannot reply to anybody, on any channel. Total outage.',
    action: 'Set ANTHROPIC_API_KEY on the Render service.',
  });
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
  if (r.status === 401) return down(`key rejected: ${err}`, {
    impact: 'The sponsor cannot reply to anyone, on any channel. This is a total outage.',
    action: 'Check ANTHROPIC_API_KEY on Render and that the key still exists in the Anthropic console.',
  });
  if (r.status === 400 && /credit|balance|quota/i.test(err)) return down(`out of credit: ${err}`, {
    impact: 'The sponsor cannot reply to anyone. Everyone messaging gets the "I am having a moment" fallback.',
    action: 'Top up the Anthropic account. This is a billing page, not a deploy.',
  });
  if (r.status === 429) return warn(`rate limited: ${err}`);
  return warn(err);
}

/* Inbound voice notes. THE ONE THAT ACTUALLY DIED, so it is checked by using it
   rather than by asking whether the key exists. */
async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) return down('no OPENAI_API_KEY set, voice notes cannot be transcribed', {
    impact: 'Anyone sending a voice note gets the generic "I am having a moment" reply. Text keeps working, so this looks fine from outside. It is what cost us Sylvia on 1 September.',
    action: 'Set OPENAI_API_KEY on the Render service. Transcription is the one thing xAI cannot do, so there is no fallback.',
  });
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
    return down(`OUT OF CREDIT. Inbound voice notes are failing silently: ${err}`, {
      impact: 'Anyone sending a voice note gets the generic "I am having a moment" reply and no transcription. Text still works, so nothing looks broken from outside. This is exactly what cost us Sylvia on 1 September.',
      action: 'Top up the OpenAI account (org Guru AI, project Default). Auto-reload is OFF and the card on file has declined before, so check the card too.',
    });
  }
  if (r.status === 429) return warn(`rate limited: ${err}`);
  if (r.status === 404) return warn(`could not confirm billing (model unavailable): ${err}`);
  return warn(err);
}

// The voice the sponsor speaks in. Text still works without it.
async function checkXai() {
  if (!process.env.XAI_API_KEY) return warn('no XAI_API_KEY set, the sponsor cannot speak', {
    impact: 'The sponsor can read and reply but cannot send voice notes. Text is unaffected, so this is a lost feature rather than an outage.',
    action: 'Set XAI_API_KEY on the Render service.',
  });
  const r = await fetch('https://api.x.ai/v1/models', {
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  });
  if (r.ok) return ok('key valid');
  if (r.status === 401 || r.status === 403) return down(`key rejected (HTTP ${r.status})`);
  return warn(`HTTP ${r.status}`);
}

async function checkDatabase() {
  if (!db.enabled) return down('DATABASE_URL not set, nothing is being remembered', {
    impact: 'Nobody is remembered between messages. Every conversation restarts from nothing, and nothing is being saved.',
    action: 'Check DATABASE_URL on Render. Do not leave this running.',
  });
  const t = await db.ping();
  return ok(`answering in ${t}ms`);
}

/* What the sponsor is actually told to be. A truncated or empty prompt is the
   kind of failure that produces a plausible-sounding stranger rather than an
   error, so it is worth watching a number that should never move much. */
function checkMasterPrompt() {
  const len = String(ctx.masterPrompt || '').length;
  if (!len) return down('the master prompt is EMPTY, the sponsor has no instructions', {
    impact: 'The sponsor has no character, no crisis protocol and no boundaries. It would answer as a generic assistant to people in recovery.',
    action: 'Roll back the last deploy immediately. This is not something to debug while it is live.',
  });
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
  if (!process.env.STRIPE_SECRET_KEY) return warn('no STRIPE_SECRET_KEY set, nobody can pay', {
    impact: 'Nobody can start a paid trial. Beta users are unaffected because they never touch Stripe.',
    action: 'Set STRIPE_SECRET_KEY on the Render service.',
  });
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
  if (!process.env.GHL_API_TOKEN) return warn('no GHL_API_TOKEN set, registrations reach nobody', {
    impact: 'People can still register and use the sponsor, but nothing reaches the CRM, so the team cannot see them and Amends candidates are lost.',
    action: 'Set GHL_API_TOKEN on the Render service.',
  });
  const loc = process.env.GHL_LOCATION_ID || 'Mgfec8mT0vXxyhp9SizK';
  const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${loc}&limit=1`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  });
  if (r.ok) return ok('reachable, registrations can be filed');
  if (r.status === 401) return down('token rejected (HTTP 401), new registrations are not reaching GHL', {
    impact: 'People can still sign up and use the sponsor, but nobody lands in the CRM, so the team cannot see them and Amends candidates are lost.',
    action: 'Reissue the GHL private integration token and update GHL_API_TOKEN on Render.',
  });
  return warn(`HTTP ${r.status}`);
}

async function checkWhatsApp() {
  const token = process.env.META_WA_TOKEN;
  const id = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !id) return down('Meta WhatsApp is not configured, the number is not being answered', {
    impact: 'The channel almost everybody uses is dead. Messages are not arriving and none can be sent.',
    action: 'Set META_WA_TOKEN and META_WA_PHONE_NUMBER_ID on the Render service.',
  });
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
  /* YELLOW is the warning shot. RED is the one before Meta starts limiting how
     many people we can message first, which would take out the weekly review
     and every milestone message. Catching it at YELLOW is the whole point. */
  if (q === 'RED' || q === 'YELLOW') {
    return warn(`${line}. Meta has flagged message quality`, {
      impact: q === 'RED'
        ? 'Meta is close to limiting how many people the sponsor can message first. That would silently break the weekly review and the check-ins.'
        : 'Quality has slipped. If it reaches red, Meta starts limiting how many people we can message first.',
      action: 'Look at what we have been sending and how people have reacted to it. Blocks and "not useful" reports drive this rating.',
    });
  }
  return ok(line);
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

/* ── Seeing it coming ────────────────────────────────────────────────────────
   Matt, 9 Sep: "make sure that you actually catch all the problems of ai
   sponsor before any user is affected by it".

   Everything above answers "is this broken now". These answer "is something
   about to break", which is the only kind of check that can get in front of a
   person being hurt. They are the difference between telling you the WhatsApp
   token died and telling you it dies on Thursday.

   ⚠️ ONE THING CANNOT BE MADE PREDICTIVE AND IT IS WORTH SAYING SO. Neither
   Anthropic nor OpenAI expose a credit balance to an API key, only to a logged
   in browser session, so "the balance is getting low" is not knowable from
   here. The best we can do for those two is notice within six hours instead of
   two days. That is a real improvement and it is not prevention. */

/* The WhatsApp token, and when it dies.

   A Meta token expiring is a total, silent outage of the channel almost
   everybody uses, and it happens on a date that is knowable weeks ahead. */
async function checkMetaTokenLife() {
  const token = process.env.META_WA_TOKEN;
  if (!token) return down('Meta WhatsApp is not configured', {
    impact: 'Nobody can reach the sponsor on WhatsApp at all.',
    action: 'Set META_WA_TOKEN on the Render service.',
  });
  const { r, body } = await fetchJson(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}` +
    `&access_token=${encodeURIComponent(token)}`);
  if (!r.ok || !body.data) {
    return warn('could not read the token expiry from Meta', {
      impact: 'We cannot tell how long the WhatsApp channel has left.',
      action: 'Check the token by hand in Meta Business settings.',
    });
  }
  const d = body.data;
  if (d.is_valid === false) {
    return down(`Meta says this token is not valid: ${(d.error && d.error.message) || 'no reason given'}`, {
      impact: 'WhatsApp is down for everyone. Messages are not arriving and none can be sent.',
      action: 'Reissue the token in Meta Business settings and update META_WA_TOKEN on Render.',
    });
  }
  // expires_at 0 means a permanent token, which is what we want.
  if (!d.expires_at) return ok('permanent token, no expiry date');
  const days = Math.floor((d.expires_at * 1000 - Date.now()) / 864e5);
  if (days < 0) {
    return down('the WhatsApp token has EXPIRED', {
      impact: 'WhatsApp is down for everyone right now.',
      action: 'Reissue the token in Meta Business settings and update META_WA_TOKEN on Render.',
    });
  }
  if (days <= 14) {
    return warn(`the WhatsApp token expires in ${days} day${days === 1 ? '' : 's'}`, {
      impact: `On that day WhatsApp stops working for everyone, with no warning to them. ${days} days left.`,
      action: 'Reissue it in Meta Business settings and update META_WA_TOKEN on Render, before it lapses.',
    });
  }
  return ok(`token valid, ${days} days left`);
}

/* The certificate. An expired one is a browser warning on the landing page,
   which is the single worst thing a first-time visitor can meet. */
function checkTls(host) {
  return () => new Promise((resolve, reject) => {
    const tls = require('tls');
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) return resolve(warn('no certificate returned'));
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 864e5);
      if (days < 0) {
        return resolve(down(`the certificate EXPIRED ${Math.abs(days)} days ago`, {
          impact: 'Every visitor sees a full page browser security warning before the site.',
          action: 'GitHub Pages renews this automatically. If it has expired, re-check the custom domain settings in the repo.',
        }));
      }
      if (days <= 21) {
        return resolve(warn(`the certificate expires in ${days} days`, {
          impact: 'If it lapses, every visitor meets a browser security warning instead of the site.',
          action: 'Usually renews itself. Worth watching, and worth checking the custom domain settings if it gets under a week.',
        }));
      }
      resolve(ok(`valid for ${days} more days`));
    });
    socket.setTimeout(7000, () => { socket.destroy(); reject(new Error('TLS connection timed out')); });
    socket.on('error', reject);
  });
}

/* The domain itself. Ours expires 10 Jun 2027 and auto-renew has never been
   confirmed, which makes this exactly the kind of thing that takes a product
   off the internet on a Tuesday with nobody having done anything wrong. */
async function checkDomain() {
  /* Verisign is the registry for .com and answers directly. The rdap.org
     aggregator redirects and then 403s us, which would have left this check
     permanently amber and taught everyone to ignore an amber. */
  const { r, body } = await fetchJson(
    'https://rdap.verisign.com/com/v1/domain/GETAISPONSOR.COM',
    { headers: { Accept: 'application/rdap+json' } });
  if (!r.ok) return warn(`could not read the domain record (HTTP ${r.status})`, {
    impact: 'We cannot tell how long the domain has left.',
    action: 'Check the expiry in Namecheap by hand.',
  });
  const ev = (body.events || []).find((e) => e.eventAction === 'expiration');
  if (!ev) return warn('the domain record carries no expiry date');
  const days = Math.floor((new Date(ev.eventDate).getTime() - Date.now()) / 864e5);
  const when = new Date(ev.eventDate).toISOString().slice(0, 10);
  if (days < 0) {
    return down(`getaisponsor.com EXPIRED on ${when}`, {
      impact: 'The website, the registration flow and every link we have ever sent are dead.',
      action: 'Renew it in Namecheap immediately.',
    });
  }
  if (days <= 45) {
    return warn(`getaisponsor.com expires ${when}, in ${days} days`, {
      impact: 'On that date the site, registration and every link we have sent people stop working.',
      action: 'Renew it in Namecheap, and confirm auto-renew is actually on. It has never been verified.',
    });
  }
  return ok(`expires ${when}, ${days} days away`);
}

/* ⭐ THE OUTAGE NOTHING ELSE CAN SEE. If the Meta webhook is unsubscribed or
   the number deregistered, every other check still passes and messages just
   stop arriving. Silence is the only symptom it has. */
/* ⭐ THE WEBHOOK ITSELF, asked of Meta rather than guessed at from silence.
   The check below used to infer "the webhook is dead" from nobody having
   messaged for a few hours, which is not the same claim and was wrong five
   times in three days. Meta will tell us directly which app it delivers this
   account's messages to, so we ask it. A WABA with nothing subscribed is the
   real version of the fault the silence check was reaching for: people message
   the number, Meta has nowhere to deliver it, and every other check stays
   green. */
async function checkWebhook() {
  const token = process.env.META_WA_TOKEN;
  const waba = process.env.META_WA_WABA_ID;
  if (!token || !waba) return down('cannot tell whether Meta is delivering messages to us', {
    impact: 'Unwatched. If the subscription were dropped, inbound WhatsApp would die silently.',
    action: 'Set META_WA_TOKEN and META_WA_WABA_ID on the Render service.',
  });
  const v = process.env.META_GRAPH_VERSION || 'v25.0';
  const { r, body } = await fetchJson(
    `https://graph.facebook.com/${v}/${waba}/subscribed_apps`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) {
    const err = (body.error && body.error.message) || `HTTP ${r.status}`;
    return warn(`could not read the subscription: ${err}`);
  }
  const apps = (body.data || [])
    .map((d) => (d.whatsapp_business_api_data || {}))
    .filter((a) => a.id);
  if (!apps.length) return down('no app is subscribed, so Meta has nowhere to deliver inbound messages', {
    impact: 'Everyone who writes to the sponsor gets silence. Nothing else looks wrong from in here, which is exactly what makes it dangerous.',
    action: 'Re-subscribe the app to the WhatsApp account, then send a message to the number to confirm a reply comes back.',
  });
  /* Named rather than counted, because the fault worth catching is somebody
     else's app holding the subscription, not the count being zero. */
  return ok(`delivering to ${apps.map((a) => a.name || a.id).join(', ')}`);
}

async function checkSilence() {
  if (!db.enabled) return warn('no database, so inbound traffic cannot be watched');
  const s = await db.inboundSilence();
  if (!s.lastAt) return warn('nobody has ever messaged us, so there is no normal to compare against');

  const hours = Math.floor(s.hoursQuiet);
  const normal = s.perDay;
  const pretty = hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)} days ago`;

  /* Scaled to how busy we normally are, so a quiet product does not alarm and a
     busy one is not allowed to go quiet unnoticed. Under roughly one message a
     day there is no meaningful signal here and it says so. */
  if (normal < 1) return ok(`last message ${pretty}, too quiet a product to read anything into a gap`);
  /* ⛔ SILENCE IS NOT A FAULT, and this check used to treat it as one. It
     measured the gap against a flat daily average with no idea what time it
     was, so at 02:20 and 10:19 UTC it was comparing a normal night against a
     24 hour mean. Five alerts in three days, two of them red with an @channel,
     every one of them wrong: Mariam messaged the number on 10 Sep and it
     answered, and it fired again the next morning with identical wording.

     ⚠️ An alert that is sometimes noise is an alert that gets muted, which
     costs us the real one. The question this was reaching for is answered
     properly by the webhook check above, so this reports what it knows and
     nothing more. It can no longer return 'down', which is what carries the
     @channel. */
  if (hours >= 24) {
    return warn(`nothing for ${pretty}, against about ${normal.toFixed(1)} a day normally`, {
      impact: 'A full day of quiet on a product this busy is worth a glance. It is not evidence of a fault on its own.',
      action: 'Read the webhook check first. If Meta is still delivering to us, send a message to the number yourself before assuming anything is broken.',
    });
  }
  return ok(`${s.today} today, last one ${pretty}`);
}

/* People whose access runs out shortly. They are real, the date is already
   known, and nobody should learn about it by being locked out mid-conversation. */
async function checkAccessExpiry() {
  if (!db.enabled) return warn('no database, so access expiry cannot be checked');
  const { soon, firstAt } = await db.accessExpiringSoon(30);
  if (!soon) return ok('nobody loses access in the next 30 days');
  const when = new Date(firstAt).toISOString().slice(0, 10);
  return warn(`${soon} ${soon === 1 ? 'person loses' : 'people lose'} access within 30 days, first on ${when}`, {
    impact: 'Access enforcement is currently OFF, so nothing actually cuts them off today. If it is ever switched on, these are the people it would silently lock out.',
    action: 'Decide what these people are told and when. This is a conversation to have before the date, not after.',
  });
}

/* Subscriptions in trouble. A failed payment is a person about to lose access
   who has not done anything wrong. */
async function checkBilling() {
  if (!process.env.STRIPE_SECRET_KEY) return warn('no STRIPE_SECRET_KEY set');
  const prices = [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_ANNUAL].filter(Boolean);
  if (!prices.length) return warn('no AI Sponsor price ids set, so nothing can be checked');
  const auth = { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } };
  let trouble = 0;
  for (const price of prices) {
    for (const status of ['past_due', 'unpaid', 'incomplete']) {
      const { r, body } = await fetchJson(
        `https://api.stripe.com/v1/subscriptions?limit=100&status=${status}&price=${encodeURIComponent(price)}`, auth);
      if (!r.ok) return warn('could not list subscriptions by status');
      trouble += (body.data || []).length;
    }
  }
  if (!trouble) return ok('no failed or stuck payments');
  return warn(`${trouble} subscription${trouble === 1 ? '' : 's'} with a payment problem`, {
    impact: `${trouble} ${trouble === 1 ? 'person is' : 'people are'} about to lose access over a card, not a choice.`,
    action: 'Open Stripe and look at each one. A failed card is usually worth a message before it lapses.',
  });
}

const SITE = 'https://getaisponsor.com';

async function runChecks() {
  const results = await Promise.all([
    timed('Sponsor replies', 'The sponsor', checkAnthropic),
    timed('Master prompt', 'The sponsor', async () => checkMasterPrompt()),
    timed('Voice notes in', 'The sponsor', checkOpenAI),
    timed('Sponsor speaks', 'The sponsor', checkXai),

    timed('WhatsApp number', 'WhatsApp', checkWhatsApp),
    timed('WhatsApp token life', 'WhatsApp', checkMetaTokenLife),
    timed('WhatsApp webhook', 'WhatsApp', checkWebhook),
    timed('People still talking', 'WhatsApp', checkSilence),

    timed('Database', 'Backend', checkDatabase),
    timed('Domain', 'Backend', checkDomain),
    timed('Certificate', 'Backend', checkTls('getaisponsor.com')),

    timed('Landing page', 'Website', pageCheck('', SITE, null)),
    timed('Registration', 'Website', pageCheck('', `${SITE}/ai-sponsor-registration.html`, 'beta')),
    timed('Settings page', 'Website', pageCheck('', `${SITE}/ai-sponsor-settings.html`, null)),
    // Both are promised by the published privacy policy, so a 404 is a real problem.
    timed('Privacy policy', 'Website', pageCheck('', `${SITE}/privacy.html`, null)),
    timed('Terms', 'Website', pageCheck('', `${SITE}/terms.html`, null)),

    timed('Payments', 'Money', checkStripe),
    timed('Failed payments', 'Money', checkBilling),
    timed('GHL (registrations)', 'Money', checkGhl),
    timed('Access running out', 'Money', checkAccessExpiry),
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

/* ⭐ THE KEYED LINK, and the reasoning that used to sit here was wrong. It
   posted the bare path so the key would not repeat through the channel
   history, assuming everyone who needs this already holds a cookie. THE COOKIE
   IS PER DEVICE. Matt opened the keyed link on one machine, read an alert on
   his phone, and got the "you need your own link" screen at the single moment
   the link had to work. The key has sat in this channel since the 9 Sep test
   message, so repeating it exposes nothing that is not already there, and an
   alert nobody can open is worth less than a tidy history. */
const SITE_STATUS_LINK = `https://ai-sponsor-f7de.onrender.com/status/?k=${encodeURIComponent(KEY)}`;

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
    /* The same "what this means / what to do" the page shows. Somebody reading
       this on a phone at night should not have to open a link to find out
       whether it can wait until morning. */
    ...bad.flatMap((c) => [
      `${c.state === 'down' ? '🔴' : '🟠'} *${c.name}* (${c.group})`,
      `> ${c.detail}`,
      c.impact ? `> *What this means:* ${c.impact}` : null,
      c.action ? `> *What to do:* ${c.action}` : null,
      '',
    ].filter((l) => l !== null)),
    `<${SITE_STATUS_LINK}|Open the status page> · checked ${new Date(data.checkedAt).toUTCString()}`,
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
