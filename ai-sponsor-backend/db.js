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
  console.log('DB connected — users + activity_days tables ready.');
}

// Called from /register (the only place that creates a user row).
async function upsertUser(u) {
  if (!enabled || !u || !u.userId) return;
  await pool.query(
    `INSERT INTO users (user_id, name, email, phone, ghl_contact_id, sponsor_name,
                        sponsor_style, program, stage, access)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id) DO UPDATE SET
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
     u.access || '']
  );
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

module.exports = {
  enabled, init, upsertUser, recordActivity, getMetrics,
  saveProfile, getProfile, appendMessages, getHistory,
};
