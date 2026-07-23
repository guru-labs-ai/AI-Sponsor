// ─── Persistent store (Postgres) — the product's first real database ─────────
// Solves what RAM + GHL can't: actual per-day usage ("did they chat today?"),
// durable sign-up dates, and later cross-device login + conversation memory.
//
// Guarded like every optional module: no DATABASE_URL → everything no-ops and
// the server runs exactly as before. Point DATABASE_URL at a free Neon/Supabase
// Postgres and it comes alive on the next deploy (tables self-create at boot).

const enabled = !!process.env.DATABASE_URL;

let pool = null;
if (enabled) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // hosted free tiers (Neon/Supabase) need SSL
    max: 3,                             // Render free tier — keep the pool tiny
  });
  pool.on('error', (err) => console.error('[DB] pool error:', err.message));
}

async function init() {
  if (!enabled) {
    console.log('DB NOT configured (DATABASE_URL missing) — running memory-only, as before.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id        TEXT PRIMARY KEY,
      name           TEXT,
      email          TEXT,
      phone          TEXT,
      ghl_contact_id TEXT,
      sponsor_name   TEXT,
      sponsor_style  TEXT,
      program        TEXT,
      stage          TEXT,
      access         TEXT,
      signup_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active    TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS activity_days (
      user_id  TEXT NOT NULL,
      day      DATE NOT NULL,
      messages INT  NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user_id    TEXT PRIMARY KEY,
      profile    JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_user_idx ON messages (user_id, id);
  `);
  // Added Jul 2026 with the Stripe→GHL sync. Separate from the CREATE above so
  // the existing live table picks them up (CREATE TABLE IF NOT EXISTS is a no-op
  // once the table exists). invoice.payment_failed only carries a Stripe customer
  // id, so stripe_customer_id is the only way back to the user.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
    CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id);
    -- How they found us. acquired_from is the resolved label the dashboard groups
    -- on; the raw utm/referrer are kept so a wrong label can always be re-derived
    -- rather than lost.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS acquired_from TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source    TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium    TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign  TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer      TEXT;
    -- Rolling long-term memory. We only ever send Claude the recent window of
    -- turns, so anything older would silently fall out of recall. memory_digest
    -- is a running summary of the durable facts (names, dates, triggers,
    -- commitments) from turns that have aged out of that window; _upto is the
    -- highest message id already folded in, so we never re-summarize a turn.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_digest      TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_digest_upto BIGINT DEFAULT 0;
  `);
  // Beta invite codes, server-side so they're not readable in the page source
  // and can be turned off without a deploy (just UPDATE active = false).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS beta_codes (
      code       TEXT PRIMARY KEY,
      active     BOOLEAN NOT NULL DEFAULT true,
      label      TEXT,
      redeemed   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO beta_codes (code, label) VALUES ('SPONSOR-7KX4Q9', 'original shared beta code')
      ON CONFLICT (code) DO NOTHING;
  `);
  console.log('DB connected — users + activity_days tables ready.');
}

/* Resolve "how did this person find us" to ONE label the dashboard can group on.
   utm_source wins when the link was tagged; otherwise the referring domain is
   mapped to a familiar name; a real browser visit with neither is genuinely
   Direct. Anything with no browser at all (a WhatsApp arrival, an import) is
   Unknown — NOT Direct, which would silently claim credit we haven't earned. */
const REFERRER_NAMES = [
  [/(^|\.)google\./, 'Google'], [/(^|\.)(facebook|fb)\./, 'Facebook'],
  [/(^|\.)instagram\./, 'Instagram'], [/(^|\.)(twitter|x)\.com$/, 'X/Twitter'],
  [/(^|\.)t\.co$/, 'X/Twitter'], [/(^|\.)reddit\./, 'Reddit'],
  [/(^|\.)linkedin\./, 'LinkedIn'], [/(^|\.)bing\./, 'Bing'],
  [/(^|\.)duckduckgo\./, 'DuckDuckGo'], [/(^|\.)youtube\./, 'YouTube'],
  [/(^|\.)tiktok\./, 'TikTok'], [/(^|\.)chatgpt\.com$/, 'ChatGPT'],
  [/(^|\.)openai\./, 'ChatGPT'], [/(^|\.)perplexity\./, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'],
];
function resolveSource(a) {
  if (!a || typeof a !== 'object') return 'Unknown';
  const utm = String(a.utmSource || '').trim();
  if (utm) return utm.charAt(0).toUpperCase() + utm.slice(1);
  const ref = String(a.referrer || '').trim().toLowerCase();
  if (ref) {
    for (const [re, name] of REFERRER_NAMES) if (re.test(ref)) return name;
    return ref;
  }
  // A browser was here (we know the landing page) but nothing referred them.
  return a.landing ? 'Direct' : 'Unknown';
}

// Called from /register (the only place that creates a user row).
async function upsertUser(u) {
  if (!enabled || !u || !u.userId) return;
  const a = u.attribution;
  await pool.query(
    `INSERT INTO users (user_id, name, email, phone, ghl_contact_id, sponsor_name,
                        sponsor_style, program, stage, access,
                        acquired_from, utm_source, utm_medium, utm_campaign, referrer)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (user_id) DO UPDATE SET
       acquired_from = COALESCE(users.acquired_from, EXCLUDED.acquired_from),
       utm_source    = COALESCE(NULLIF(users.utm_source, ''), EXCLUDED.utm_source),
       utm_medium    = COALESCE(NULLIF(users.utm_medium, ''), EXCLUDED.utm_medium),
       utm_campaign  = COALESCE(NULLIF(users.utm_campaign, ''), EXCLUDED.utm_campaign),
       referrer      = COALESCE(NULLIF(users.referrer, ''), EXCLUDED.referrer),
       name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
       email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), users.phone),
       ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, users.ghl_contact_id),
       sponsor_name = COALESCE(NULLIF(EXCLUDED.sponsor_name, ''), users.sponsor_name),
       sponsor_style = COALESCE(NULLIF(EXCLUDED.sponsor_style, ''), users.sponsor_style),
       program = COALESCE(NULLIF(EXCLUDED.program, ''), users.program),
       stage = COALESCE(NULLIF(EXCLUDED.stage, ''), users.stage),
       access = COALESCE(NULLIF(EXCLUDED.access, ''), users.access)`,
    [u.userId, u.name || '', u.email || '', u.phone || '', u.ghlContactId || null,
     u.sponsorName || '', u.sponsorStyle || '', u.program || '', u.stage || '',
     u.access || '',
     // Attribution is first-touch and immutable: only stamped when we have it,
     // and the COALESCE above never lets a later write overwrite it.
     a ? resolveSource(a) : null,
     (a && a.utmSource) || '', (a && a.utmMedium) || '',
     (a && a.utmCampaign) || '', (a && a.referrer) || '']
  );
}

/* ─── Stripe linkage (written by the Stripe webhook) ────────────────────────── */

// Remember which Stripe customer/subscription a user is, so later events that
// only carry a customer id (invoice.payment_failed) can find their way home.
async function linkSubscription(userId, { customerId, subscriptionId }) {
  if (!enabled || !userId) return;
  await pool.query(
    `UPDATE users SET stripe_customer_id = COALESCE($2, stripe_customer_id),
                      stripe_subscription_id = COALESCE($3, stripe_subscription_id)
     WHERE user_id = $1`,
    [userId, customerId || null, subscriptionId || null]
  );
}

async function findByStripeCustomer(customerId) {
  if (!enabled || !customerId) return null;
  const r = await pool.query(`SELECT * FROM users WHERE stripe_customer_id = $1 LIMIT 1`, [customerId]);
  return r.rows[0] || null;
}

async function getUser(userId) {
  if (!enabled || !userId) return null;
  const r = await pool.query(`SELECT * FROM users WHERE user_id = $1`, [userId]);
  return r.rows[0] || null;
}

async function setAccess(userId, access) {
  if (!enabled || !userId) return;
  await pool.query(`UPDATE users SET access = $2 WHERE user_id = $1`, [userId, access]);
}

// Called on every chat message — one row per user per day, message count bumped.
// Records activity for ANY session id (registered or anonymous); metrics join
// against users for registered-only stats.
async function recordActivity(userId) {
  if (!enabled || !userId) return;
  await pool.query(
    `INSERT INTO activity_days (user_id, day, messages) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET messages = activity_days.messages + 1`,
    [userId]
  );
  await pool.query(
    `UPDATE users SET last_active = now() WHERE user_id = $1`,
    [userId]
  );
}

// Save the onboarding profile. Merges: existing keys survive unless the incoming
// profile has a non-empty value for them (the standalone chat sends a slimmer
// profile than registration — it must never erase goals/whatBroughtYouHere).
async function saveProfile(userId, profile) {
  if (!enabled || !userId) return;
  const clean = {};
  Object.entries(profile || {}).forEach(([k, v]) => {
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (!empty) clean[k] = v;
  });
  await pool.query(
    `INSERT INTO profiles (user_id, profile) VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       profile = profiles.profile || EXCLUDED.profile,
       updated_at = now()`,
    [userId, JSON.stringify(clean)]
  );
}

async function getProfile(userId) {
  if (!enabled || !userId) return null;
  const r = await pool.query(`SELECT profile FROM profiles WHERE user_id = $1`, [userId]);
  return r.rows[0] ? r.rows[0].profile : null;
}

// Append chat turns. msgs = [{ role, content }, …]
async function appendMessages(userId, msgs) {
  if (!enabled || !userId || !msgs || !msgs.length) return;
  const values = [];
  const params = [];
  msgs.forEach((m, i) => {
    params.push(userId, m.role, String(m.content || ''));
    values.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
  });
  await pool.query(
    `INSERT INTO messages (user_id, role, content) VALUES ${values.join(',')}`,
    params
  );
}

/* ─── Rolling long-term memory ──────────────────────────────────────────────── */

async function getMemory(userId) {
  if (!enabled || !userId) return null;
  const r = await pool.query(
    'SELECT memory_digest, memory_digest_upto FROM users WHERE user_id = $1',
    [userId]
  );
  const row = r.rows[0];
  if (!row || !row.memory_digest) return null;
  return { digest: row.memory_digest, upto: Number(row.memory_digest_upto) || 0 };
}

async function saveMemory(userId, digest, upto) {
  if (!enabled || !userId) return;
  await pool.query(
    'UPDATE users SET memory_digest = $2, memory_digest_upto = $3 WHERE user_id = $1',
    [userId, digest, upto]
  );
}

/* Turns that have aged out of the recent window and haven't been summarized yet.
   Keeps the most recent `recentKeep` verbatim (those still go to Claude in full),
   returns older ones with id > sinceId, oldest-first, ready to fold into the
   digest. Also reports the total so the caller can decide it's worth a summary. */
async function getAgedOutMessages(userId, recentKeep, sinceId) {
  if (!enabled || !userId) return { rows: [], total: 0 };
  const total = (await pool.query(
    'SELECT COUNT(*)::int n FROM messages WHERE user_id = $1', [userId]
  )).rows[0].n;
  const r = await pool.query(
    `SELECT id, role, content FROM (
       SELECT id, role, content, ROW_NUMBER() OVER (ORDER BY id DESC) AS rn
       FROM messages WHERE user_id = $1
     ) t WHERE rn > $2 AND id > $3 ORDER BY id ASC`,
    [userId, recentKeep, sinceId]
  );
  return { rows: r.rows, total };
}

// Last `limit` turns in chronological order (Claude context cap lives here).
async function getHistory(userId, limit = 40) {
  if (!enabled || !userId) return null;
  const r = await pool.query(
    `SELECT role, content FROM (
       SELECT id, role, content FROM messages WHERE user_id = $1 ORDER BY id DESC LIMIT $2
     ) t ORDER BY id ASC`,
    [userId, limit]
  );
  return r.rows;
}

// North-star + usage aggregates for /api/metrics/northstar.
async function getMetrics() {
  if (!enabled) return null;
  const [users, activity, byDay] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::int AS registered,
             COUNT(*) FILTER (WHERE access = 'Paid')::int AS paid,
             COALESCE(SUM(GREATEST(0, (now()::date - signup_date::date))), 0)::int AS cumulative_days,
             COUNT(*) FILTER (WHERE last_active > now() - interval '7 days')::int AS active_last_7d
      FROM users`),
    pool.query(`
      SELECT COUNT(*)::int AS total_active_days,
             COUNT(DISTINCT a.user_id)::int AS users_who_chatted,
             COALESCE(SUM(a.messages), 0)::int AS total_messages
      FROM activity_days a
      JOIN users u ON u.user_id = a.user_id`),
    pool.query(`
      SELECT signup_date::date AS day, COUNT(*)::int AS n
      FROM users GROUP BY 1 ORDER BY 1`),
  ]);
  const signupsByDay = {};
  byDay.rows.forEach((r) => {
    signupsByDay[new Date(r.day).toISOString().slice(0, 10)] = r.n;
  });
  return { ...users.rows[0], ...activity.rows[0], signupsByDay };
}

/* ─── Who they are / what they're doing ─────────────────────────────────────
   Replaces the June-22 "GHL reporting dashboard" spec (86aj5mrtp), which asked
   for qualified leads / meetings booked / pipeline value — a lead-gen funnel
   that doesn't exist in this product. Nobody books a meeting to get a $5 AI
   sponsor. These are the questions the product can actually answer, and Matt
   asked for exactly them on the Jul 14 call: what program they're in, where
   they came from, how many messages people are doing per day.

   Aggregates only — never names, emails or message content. Recovery
   conversations do not leave the database.                                   */
async function getBreakdowns() {
  if (!enabled) return null;
  const [program, stage, access, channel, msgsByDay, source] = await Promise.all([
    // program is stored comma-joined ("AA, NA") — one person can be in several
    pool.query(`
      SELECT trim(p) AS k, COUNT(*)::int AS n
      FROM users, unnest(string_to_array(NULLIF(program, ''), ',')) AS p
      GROUP BY 1 ORDER BY n DESC, 1`),
    pool.query(`
      SELECT COALESCE(NULLIF(stage, ''), 'unknown') AS k, COUNT(*)::int AS n
      FROM users GROUP BY 1 ORDER BY n DESC`),
    pool.query(`
      SELECT COALESCE(NULLIF(access, ''), 'unknown') AS k, COUNT(*)::int AS n
      FROM users GROUP BY 1 ORDER BY n DESC`),
    // user_id prefix is the channel: reg- web registration, wa- WhatsApp,
    // web- anonymous web chat (never registered), beta- imported no-phone
    pool.query(`
      SELECT CASE
               WHEN user_id LIKE 'reg-%'  THEN 'Website'
               WHEN user_id LIKE 'wa-%'   THEN 'WhatsApp'
               WHEN user_id LIKE 'web-%'  THEN 'Web chat only'
               ELSE 'Other'
             END AS k, COUNT(*)::int AS n
      FROM users GROUP BY 1 ORDER BY n DESC`),
    pool.query(`
      SELECT day::text AS k, SUM(messages)::int AS n
      FROM activity_days
      WHERE day >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY 1 ORDER BY 1`),
    // How they found us. Pre-attribution rows are genuinely Unknown — never
    // fold them into Direct, which would credit a channel we can't evidence.
    pool.query(`
      SELECT COALESCE(NULLIF(acquired_from, ''), 'Unknown') AS k, COUNT(*)::int AS n
      FROM users GROUP BY 1 ORDER BY n DESC, 1`),
  ]);
  const toObj = (rows) => Object.fromEntries(rows.map((r) => [r.k, r.n]));
  return {
    byProgram: toObj(program.rows),
    byStage: toObj(stage.rows),
    byAccess: toObj(access.rows),
    byChannel: toObj(channel.rows),
    bySource: toObj(source.rows),
    messagesByDay: toObj(msgsByDay.rows),
  };
}

// Validate a beta code and count the redemption. Returns true only if the code
// exists and is active. Unknown/killed codes return false.
async function redeemBetaCode(code) {
  if (!enabled || !code) return false;
  const r = await pool.query(
    `UPDATE beta_codes SET redeemed = redeemed + 1
       WHERE code = $1 AND active = true RETURNING code`,
    [code]
  );
  return r.rowCount > 0;
}

/* ─── "Forget me" — v1 full purge of one identity's data ─────────────────────
   Spec agreed with Mariam (Jul 2026): admin-run/on-request only, one identity
   per call (a single user_id — no cross-identity linking yet), no scheduled
   auto-purge. This is step 2 of the deletion flow in deletion.js — it must
   only ever be called AFTER the Stripe subscription is confirmed cancelled,
   otherwise a purge here would erase the only record tying a still-billing
   Stripe customer back to a person.

   Deletes messages, profile, activity_days, and the users row itself (which
   also drops signup_date, last_active, stripe/GHL linkage, and memory_digest —
   there is nothing left to remember about this identity). Wrapped in a
   transaction so a failure partway through can't leave a half-deleted user.
   Safe to re-run: DELETE on a already-gone row is a no-op, not an error. */
async function purgeUserData(userId) {
  if (!enabled || !userId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM messages WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM activity_days WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  enabled, init, upsertUser, recordActivity, getMetrics, getBreakdowns,
  saveProfile, getProfile, appendMessages, getHistory,
  linkSubscription, findByStripeCustomer, getUser, setAccess,
  getMemory, saveMemory, getAgedOutMessages, redeemBetaCode,
  purgeUserData,
};
