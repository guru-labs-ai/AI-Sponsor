// ─── Persistent store (Postgres) — the product's first real database ─────────
// Solves what RAM + GHL can't: actual per-day usage ("did they chat today?"),
// durable sign-up dates, and later cross-device login + conversation memory.
//
// Guarded like every optional module: no DATABASE_URL → everything no-ops and
// the server runs exactly as before. Point DATABASE_URL at a free Neon/Supabase
// Postgres and it comes alive on the next deploy (tables self-create at boot).

// Message content and memory digests are encrypted before they're written and
// decrypted on the way out — see fieldcrypto.js for what that does and doesn't
// protect. Pass-through when no key is configured.
const fc = require('./fieldcrypto');

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
    /* When somebody's free beta access runs out. Nothing enforces this and
       nothing should until Matt has decided what happens at the end: the point
       is that the date exists and can be seen, because "6 months free" was
       promised in the signup copy and was being counted by nobody. Stamped the
       first time an account becomes Beta and never moved afterwards, so a later
       write cannot quietly extend somebody's free run. */
    ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_expires_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_digest      TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS memory_digest_upto BIGINT DEFAULT 0;

    /* Was this said out loud or typed? The product has taken voice notes since
       August and transcribed them straight into the content column, throwing the fact
       away at the door. So nothing could tell afterwards, not the sponsor and
       not the dashboard, and Matt asked for exactly that split.

       Deliberately NULL for everything written before this existed. Those rows
       are unknown, not text, and anything reading this must say so rather than
       quietly counting months of voice notes as typing. */
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS medium TEXT;
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
    UPDATE beta_codes SET code = 'SPONSOR-BETA-USER', label = 'renamed shared beta code, Aug 2026'
      WHERE code = 'SPONSOR-7KX4Q9';
    INSERT INTO beta_codes (code, label) VALUES ('SPONSOR-BETA-USER', 'renamed shared beta code, Aug 2026')
      ON CONFLICT (code) DO NOTHING;
  `);
  // Every call to an admin-gated route (currently just /api/history/:userId,
  // which returns full decrypted conversation content) gets a row here —
  // success or failure, so a leaked/guessed ADMIN_API_KEY leaves a trail
  // instead of silently reading someone's history. Query directly in Neon;
  // no UI built for this yet.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_access_log (
      id         BIGSERIAL PRIMARY KEY,
      route      TEXT NOT NULL,
      target_id  TEXT,
      success    BOOLEAN NOT NULL,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  /* Links that let someone change their sponsor's name or voice from WhatsApp.
     The token stands in for their identity so the URL never has to carry their
     phone number: WhatsApp renders link previews, other people see their phone,
     and URLs end up in history and logs. On a recovery product that matters.

     In Postgres rather than memory on purpose. This backend sleeps on Render's
     free tier, and a link the sponsor sent an hour ago has to still work when
     the instance wakes up. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sponsor_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sponsor_tokens_user_idx ON sponsor_tokens (user_id);
  `);
  /* An append-only record of what people change about their own account.

     `profiles` only ever holds the current state, so a rename overwrites the old
     name and nothing anywhere knows it happened. A console line on Render is not
     a record either; it scrolls away. Support cannot answer "my sponsor's name
     changed and I didn't do it", nobody can see whether the picker is actually
     used, and a deactivation would leave no trace at all.

     Facts about the account only: what changed, from what, to what, when, and
     which door it came through. Never conversation content. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_events (
      id         BIGSERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      event      TEXT NOT NULL,
      detail     JSONB NOT NULL DEFAULT '{}',
      source     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS account_events_user_idx ON account_events (user_id, id DESC);
    CREATE INDEX IF NOT EXISTS account_events_time_idx ON account_events (created_at DESC);
  `);
  /* One-time codes that bind a registration to the number a WhatsApp message
     genuinely arrives from. See createLinkCode. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS link_codes (
      code          TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at    TIMESTAMPTZ NOT NULL,
      used_at       TIMESTAMPTZ,
      used_by_phone TEXT
    );
    CREATE INDEX IF NOT EXISTS link_codes_user_idx ON link_codes (user_id);
  `);
  /* One end-of-week note per person per week. See weekly.js for why this is a
     row rather than a scheduled job.

     The UNIQUE below is the entire concurrency design. This backend is woken by
     four independent triggers that can all decide the same week is due at the
     same moment, and rather than coordinate them, the database is allowed to
     settle it: the second writer gets ON CONFLICT DO NOTHING, is told it wrote
     nothing, and therefore knows not to send a second WhatsApp message.

     summary is encrypted — it is derived from conversation content and deserves
     exactly what the messages themselves get. stats is not: it holds counts
     only, and leaving it readable means a broken or rotated key still lets
     somebody answer "did this week generate at all". delivered_at is separate
     from created_at so a crash between writing and sending loses neither. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id           BIGSERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      week_start   DATE NOT NULL,
      week_end     DATE NOT NULL,
      summary      TEXT NOT NULL,
      stats        JSONB NOT NULL DEFAULT '{}',
      tone         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ,
      delivery_note TEXT,
      UNIQUE (user_id, week_start)
    );
    CREATE INDEX IF NOT EXISTS weekly_user_idx ON weekly_summaries (user_id, week_start DESC);
  `);
  /* Deletion requests, and the only record that survives the deletion itself.

     purgeUserData clears account_events along with everything else, which is
     correct (it holds their history) but it means the request to be deleted is
     destroyed by the deletion. Without a row that outlives the purge we can
     show that somebody asked and nothing more: not that we finished, not when.
     That is the half of the audit trail a privacy policy actually rests on.

     So this table is deliberately NOT in purgeUserData. What makes that safe is
     that user_id is pseudonymised on completion (see markDeletionDone): the row
     keeps the two timestamps and the outcome, and stops holding the phone
     number that a wa-<E.164> id otherwise is. Somebody who later asks "did you
     delete me" can still be answered by hashing their id and looking, which is
     the only question this table needs to answer after the fact.

     No reason column on purpose. The reason someone gives lives in GHL, where
     it can be acted on and deleted with the contact. Copying it here would put
     recovery detail in a third place and outlive the deletion that was asked
     for.

     PRIMARY KEY on user_id is the concurrency design, same as weekly_summaries:
     two clicks on the button cannot open two windows or send two alerts. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      user_id       TEXT PRIMARY KEY,
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      scheduled_for TIMESTAMPTZ NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      note          TEXT,
      source        TEXT
    );
    CREATE INDEX IF NOT EXISTS deletion_due_idx
      ON deletion_requests (scheduled_for) WHERE status = 'pending';
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
       access = COALESCE(NULLIF(EXCLUDED.access, ''), users.access),
       /* Six months from the first moment they became Beta. COALESCE means a
          repeat registration cannot reset the clock, and the CASE means a
          non-Beta write never stamps one. */
       beta_expires_at = COALESCE(
         users.beta_expires_at,
         CASE WHEN EXCLUDED.access = 'Beta' THEN now() + interval '6 months' END
       )`,
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

/* Who is on free access and when it runs out. Read-only on purpose: this
   answers "who needs a decision and by when", it does not make one. */
async function betaAccessRoster() {
  if (!enabled) return [];
  const r = await pool.query(
    `SELECT ${PERSON_KEY} AS person,
            MIN(name)            FILTER (WHERE name <> '') AS name,
            MIN(beta_expires_at) AS expires_at,
            (MIN(beta_expires_at)::date - now()::date) AS days_left
       FROM users
      WHERE access = 'Beta'
      GROUP BY 1
      ORDER BY expires_at NULLS LAST`
  );
  return r.rows;
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

/* One person's own numbers, for the overview on their settings page.

   Deliberately separate from getMetrics(), which answers "how is the product
   doing" for the team. This answers "how am I doing" for the person, and it is
   the only place their own figures are ever assembled. Counts only: no message
   content leaves the database here either. */
async function getPersonStats(userId) {
  if (!enabled || !userId) return null;
  const [msgs, days, user] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int n FROM messages WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT COUNT(*)::int AS active_days,
              MAX(day)::text AS last_day,
              COALESCE(SUM(messages), 0)::int AS counted_messages
         FROM activity_days WHERE user_id = $1`, [userId]),
    pool.query(`SELECT signup_date, last_active FROM users WHERE user_id = $1`, [userId]),
  ]);
  const u = user.rows[0] || {};
  const since = u.signup_date ? new Date(u.signup_date) : null;
  return {
    // Day 1 is the day they joined, not day 0.
    daysHere: since ? Math.max(1, Math.floor((Date.now() - since.getTime()) / 86400000) + 1) : null,
    joined: since ? since.toISOString().slice(0, 10) : null,
    messages: msgs.rows[0].n,
    activeDays: days.rows[0].active_days,
    lastActive: days.rows[0].last_day || (u.last_active ? new Date(u.last_active).toISOString().slice(0,10) : null),
  };
}

/* Wipe the conversation and start clean, keeping the account.

   The rolling memory digest goes with it. Leaving it would mean the sponsor
   "starting over" while still recalling everything that was said, which is
   worse than not offering the option at all: someone asking for a clean slate
   is usually asking to not be reminded.

   The weekly reviews go too, by exactly the same argument. They are written
   accounts of the conversation being erased, and leaving them would mean
   somebody who asked for a clean slate opens their dashboard to find last week
   narrated back at them in their sponsor's voice. That is the precise thing
   they just asked not to happen.

   Returns how many messages were removed, so it can be recorded and shown. */
async function clearConversation(userId) {
  if (!enabled || !userId) return 0;
  const r = await pool.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM weekly_summaries WHERE user_id = $1', [userId]);
  await pool.query(
    `UPDATE users SET memory_digest = NULL, memory_digest_upto = 0 WHERE user_id = $1`,
    [userId]
  );
  return r.rowCount || 0;
}

/* Remove one key from a profile.

   saveProfile merges, so it can set a field but never unset one: writing '' or
   null just gets stripped as empty and the old value survives. A one-shot flag
   like programChangedFrom needs actually deleting, or the sponsor would bring
   the change up in every message forever. */
async function clearProfileField(userId, key) {
  if (!enabled || !userId || !key) return;
  await pool.query(
    `UPDATE profiles SET profile = profile - $2, updated_at = now() WHERE user_id = $1`,
    [userId, key]
  );
}

/* ─── Deleting someone, properly ─────────────────────────────────────────────
   Every user-scoped table, in one transaction, so a failure halfway cannot
   leave somebody half-deleted.

   The list below is the whole point of this comment. When this was written the
   product had four user-scoped tables; it now has eight, and the four added
   since (sponsor_tokens, link_codes, account_events, weekly_summaries) all hold
   something real. A surviving sponsor_token still opens their settings page.
   account_events still holds their sponsor's name and every voice they picked.
   A surviving weekly_summaries row is the worst of them: it is an LLM's written
   account of what somebody said in the week they asked us to forget. If you add
   another table keyed on user_id, add it here in the same commit. */
async function purgeUserData(userId) {
  if (!enabled || !userId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM messages WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM weekly_summaries WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM activity_days WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM sponsor_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM link_codes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM account_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ── The deletion queue ──────────────────────────────────────────────────────
   A request does not delete anything. It opens a window, and the sweep in
   deletion.js closes it. See the table comment in init() for why the row
   outlives the person it was about.

   The window exists for one reason and it is not caution: people ask for this
   in a bad moment. On a recovery product somebody wiping everything at 2am and
   wanting it back on Thursday is a normal week, not an edge case. */
async function requestDeletion(userId, { graceDays = 7, source = null } = {}) {
  if (!enabled || !userId) return null;
  /* DO UPDATE rather than DO NOTHING, but only out of a finished state. A
     second click while one is already pending must not slide the date; a fresh
     request after they changed their mind, or after one stopped for review,
     must open a new window. */
  const r = await pool.query(
    `INSERT INTO deletion_requests (user_id, scheduled_for, source)
     VALUES ($1, now() + ($2 || ' days')::interval, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET requested_at = now(), scheduled_for = EXCLUDED.scheduled_for,
           status = 'pending', started_at = NULL, completed_at = NULL,
           note = NULL, source = EXCLUDED.source
       WHERE deletion_requests.status IN ('cancelled', 'stopped')
     RETURNING user_id, requested_at, scheduled_for, status`,
    [userId, String(graceDays), source]
  );
  if (r.rows[0]) return { ...r.rows[0], opened: true };
  // No row back means one is already pending, or already completed.
  const existing = await getDeletionRequest(userId);
  return existing ? { ...existing, opened: false } : null;
}

async function getDeletionRequest(userId) {
  if (!enabled || !userId) return null;
  const r = await pool.query(
    `SELECT user_id, requested_at, scheduled_for, status, completed_at, note
       FROM deletion_requests WHERE user_id = $1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function cancelDeletion(userId) {
  if (!enabled || !userId) return false;
  const r = await pool.query(
    `UPDATE deletion_requests SET status = 'cancelled', completed_at = now()
      WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  return r.rowCount > 0;
}

/* Claims one due row at a time. FOR UPDATE SKIP LOCKED so two triggers waking
   the instance together cannot both take the same person, which on this table
   would mean running an irreversible purge twice. */
async function claimDueDeletion() {
  if (!enabled) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT user_id, requested_at, scheduled_for FROM deletion_requests
        WHERE status = 'pending' AND scheduled_for <= now()
        ORDER BY scheduled_for
        LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    if (!r.rows[0]) { await client.query('COMMIT'); return null; }
    await client.query(
      `UPDATE deletion_requests SET status = 'running', started_at = now()
        WHERE user_id = $1`,
      [r.rows[0].user_id]
    );
    await client.query('COMMIT');
    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* Closes the row. On a completed deletion the id is replaced by a one-way hash
   so the proof survives without the phone number inside a wa-<E.164> id.
   Anything that did not complete keeps its real id, because a human has to be
   able to find it and finish the job. */
async function markDeletionDone(userId, status, note = null) {
  if (!enabled || !userId) return;
  const finalId = status === 'completed' ? pseudonymise(userId) : userId;
  await pool.query(
    `UPDATE deletion_requests
        SET status = $2, completed_at = now(), note = $3, user_id = $4
      WHERE user_id = $1`,
    [userId, status, note, finalId]
  );
}

function pseudonymise(userId) {
  const salt = process.env.FIELD_ENCRYPTION_KEY || '';
  const h = require('crypto').createHash('sha256').update(salt + userId).digest('hex');
  return `deleted-${h.slice(0, 32)}`;
}

/* Anything left mid-flight when the instance died. 'running' is only ever set
   inside claimDueDeletion, so a row still in it after the instance restarted
   was interrupted, not in progress. Put it back rather than leave it stuck. */
async function releaseStaleDeletions(olderThanMinutes = 30) {
  if (!enabled) return 0;
  const r = await pool.query(
    `UPDATE deletion_requests SET status = 'pending', started_at = NULL
      WHERE status = 'running'
        AND (started_at IS NULL OR started_at < now() - ($1 || ' minutes')::interval)`,
    [String(olderThanMinutes)]
  );
  return r.rowCount;
}

/* Retention: accounts nobody has touched for the window, that still hold raw
   messages. The Privacy Policy commits to this in writing, so it has to be a
   thing the code actually does rather than a thing we mean to do.

   Deliberately NOT the same as deleting somebody. The policy draws the line at
   the verbatim conversation: raw messages go, the rolling digest on users
   stays, so a person who comes back after a year is still recognised instead of
   meeting a stranger. Their profile, streak and account survive too.

   last_active IS NOT NULL because somebody who never spoke has nothing to purge
   and should not be counted as aged out. */
async function retentionCandidates({ months = 12, limit = 5 } = {}) {
  if (!enabled) return [];
  const r = await pool.query(
    `SELECT u.user_id, u.last_active
       FROM users u
      WHERE u.last_active IS NOT NULL
        AND u.last_active < now() - ($1 || ' months')::interval
        AND EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.user_id)
        AND NOT EXISTS (SELECT 1 FROM deletion_requests d
                         WHERE d.user_id = u.user_id AND d.status IN ('pending','running'))
      ORDER BY u.last_active
      LIMIT $2`,
    [String(months), limit]
  );
  return r.rows;
}

/* The verbatim conversation and the week notes derived from it. Everything that
   makes the person recognisable is left alone on purpose: the users row, the
   digest it carries, the profile and the activity days.

   Returns how many rows went, so the caller can record a real number rather
   than "done". */
async function purgeMessagesOnly(userId) {
  if (!enabled || !userId) return { messages: 0, weeklies: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query('DELETE FROM messages WHERE user_id = $1', [userId]);
    const w = await client.query('DELETE FROM weekly_summaries WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return { messages: m.rowCount, weeklies: w.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* Who has gone quiet, and who we have already left alone.

   Every clause here exists to stop this pestering somebody. In order:

   - BETWEEN 5 and 14 days. Someone at 40 days has not gone quiet, they have
     gone, and a chirpy "how are you" six weeks later is worse than silence.
   - No check-in since their LAST message. This one clause does two jobs: it
     stops a second message on day 6, and it means somebody who ignored the
     first check-in never gets another. Not replying is an answer.
   - None in 30 days at all, so a person who dips in and out is not checked on
     every fortnight.
   - Not mid-deletion. Somebody leaving should not be asked how they are.
   - They have actually talked before. Never messaging is a different problem
     and a warm check-in is the wrong tool for it.

   usual_hour is the hour of day THEY normally write, so the message does not
   arrive at four in the morning. We hold no timezone for anyone, and their own
   history is a better guess than ours. */
async function quietCheckinCandidates({ quietDays = 5, giveUpDays = 14, cooloffDays = 30, limit = 5 } = {}) {
  if (!enabled) return [];
  const r = await pool.query(
    `SELECT u.user_id, u.name, u.last_active,
            (SELECT EXTRACT(HOUR FROM m2.created_at)::int
               FROM messages m2 WHERE m2.user_id = u.user_id
              GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) AS usual_hour
       FROM users u
      WHERE u.user_id LIKE 'wa-%'
        AND u.last_active IS NOT NULL
        AND u.last_active <  now() - ($1 || ' days')::interval
        AND u.last_active >  now() - ($2 || ' days')::interval
        AND EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.user_id)
        AND NOT EXISTS (SELECT 1 FROM deletion_requests d
                         WHERE d.user_id = u.user_id AND d.status IN ('pending','running'))
        AND NOT EXISTS (SELECT 1 FROM account_events e
                         WHERE e.user_id = u.user_id AND e.event = 'quiet_checkin'
                           AND e.created_at > u.last_active)
        AND NOT EXISTS (SELECT 1 FROM account_events e
                         WHERE e.user_id = u.user_id AND e.event = 'quiet_checkin'
                           AND e.created_at > now() - ($3 || ' days')::interval)
      ORDER BY u.last_active
      LIMIT $4`,
    [String(quietDays), String(giveUpDays), String(cooloffDays), limit]
  );
  return r.rows;
}

/* Every identity belonging to the same person.

   One human is routinely two rows now: reg-<uuid> from the website and
   wa-<E.164> from WhatsApp, because registration mirrors the profile onto the
   phone key so their sponsor knows them. When the deletion path was written
   those two were unlinked and deleting one was all anyone could do. Today it
   would delete half of somebody and leave the other half holding their name,
   their programme and their reason for coming, which is not what "delete my
   data" means to the person asking.

   Matched on email and phone both, because this is the opposite situation to
   findPersonId: there the risk was a typo pulling in a stranger, here the risk
   is leaving part of someone behind. Callers must still confirm identity before
   asking for this. */
async function findAllIdentities(userId) {
  if (!enabled || !userId) return userId ? [userId] : [];
  const seed = await pool.query(`SELECT email, phone FROM users WHERE user_id = $1`, [userId]);
  const s = seed.rows[0];
  if (!s) return [userId];
  const email = (s.email || '').trim();
  const phone = (s.phone || '').trim();
  if (!email && !phone) return [userId];
  const r = await pool.query(
    `SELECT user_id FROM users
      WHERE ($1 <> '' AND LOWER(email) = LOWER($1))
         OR ($2 <> '' AND phone = $2)`,
    [email, phone]
  );
  const ids = r.rows.map((x) => x.user_id);
  if (!ids.includes(userId)) ids.push(userId);
  return ids;
}

/* ─── Proving a phone number really belongs to them ─────────────────────────
   A number typed into a form is a claim. The number a WhatsApp message arrives
   from is a fact: Twilio reports the real sender, and nobody can forge it by
   mistyping a digit.

   So the code travels OUTWARD. It is generated at the end of registration,
   carried in the prefilled message on the wa.me link, and comes back to us on
   their first message. Claiming it binds that registration to the number the
   message actually came from, whatever they typed earlier.

   Sending a code TO the number was the obvious design and does not work here:
   WhatsApp cannot message anyone cold without an approved template, and the
   sponsor's own number has a REJECTED A2P campaign, so a US verification SMS
   from it would be filtered. The only SMS-capable number is a different one
   entirely, which would deliver a code from a stranger.

   Ambiguous characters left out so nobody has to squint at O against 0. */
const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LINK_CODE_HOURS = 72;

async function createLinkCode(userId) {
  if (!enabled || !userId) return null;
  const bytes = require('crypto').randomBytes(6);
  const code = [...bytes].map((b) => LINK_CODE_ALPHABET[b % LINK_CODE_ALPHABET.length]).join('');
  await pool.query(
    `INSERT INTO link_codes (code, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
    [code, userId, String(LINK_CODE_HOURS)]
  );
  return code;
}

/* Single use, and the claim is the write: an UPDATE with used_at IS NULL in the
   WHERE means two messages arriving at once cannot both claim the same code. */
async function claimLinkCode(code, phone) {
  if (!enabled || !code || !phone) return null;
  const r = await pool.query(
    `UPDATE link_codes SET used_at = now(), used_by_phone = $2
      WHERE code = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [String(code).toUpperCase(), phone]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

/* ─── Account change log ────────────────────────────────────────────────────
   Append-only. Written whenever someone changes something about their own
   account, so the change survives beyond a log line and can be answered for
   later. Fire-and-forget at every call site: failing to record a rename must
   never be the reason the rename itself fails. */
async function recordEvent(userId, event, detail, source) {
  if (!enabled || !userId || !event) return;
  await pool.query(
    `INSERT INTO account_events (user_id, event, detail, source)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [userId, event, JSON.stringify(detail || {}), source || null]
  );
}

/* Has this person had this event at all. Used for one-time things like the
   privacy notice, where the question is "were they told", not "how often". */
async function hasEvent(userId, event) {
  if (!enabled || !userId || !event) return false;
  const r = await pool.query(
    'SELECT 1 FROM account_events WHERE user_id = $1 AND event = $2 LIMIT 1',
    [userId, event]
  );
  return r.rowCount > 0;
}

async function getEvents(userId, limit = 50) {
  if (!enabled || !userId) return [];
  const r = await pool.query(
    `SELECT event, detail, source, created_at FROM account_events
      WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

/* Has this person been here before?

   The browser mints a fresh reg-<uuid> on every visit, so a returning person
   arrives looking brand new even when the email is character-for-character the
   same. That is how Matt ended up as three separate users with his history and
   profile split across them.

   Matches on email ONLY, deliberately. Matching on phone as well seemed helpful
   and was dangerous: nobody verifies a typed number, so one wrong digit landed
   the person on a stranger's row and they would have carried on writing into
   that stranger's account. Email at least belongs to whoever is sitting there,
   and a typo'd one simply creates a new person rather than hijacking an
   existing one. Caught by the wrong-number test, not by reasoning.

   Preference order when several rows match: a reg- row first, because that is
   the identity the website's own chat runs on, then the oldest, because that is
   where the longest history lives. Returns null for genuinely new people. */
async function findPersonId({ email }) {
  if (!enabled) return null;
  const e = (email || '').trim();
  if (!e) return null;
  const r = await pool.query(
    `SELECT user_id FROM users
      WHERE LOWER(email) = LOWER($1)
      ORDER BY (user_id LIKE 'reg-%') DESC, signup_date ASC
      LIMIT 1`,
    [e]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
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

/* ─── "Change your sponsor" links ───────────────────────────────────────────
   One live token per person, reused until it expires, so the sponsor can hand
   out the same link twice without collecting tokens. 30 days is long enough
   that a link found later still works, short enough that an old one in someone
   else's chat history stops being usable. Worst case if a link does leak is a
   renamed sponsor: no account access, no personal data, nothing to read. */
const SETTINGS_TOKEN_DAYS = 30;

async function getOrCreateSettingsToken(userId) {
  if (!enabled || !userId) return null;
  const existing = await pool.query(
    `SELECT token FROM sponsor_tokens WHERE user_id = $1 AND expires_at > now()
     ORDER BY expires_at DESC LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0].token;

  const token = require('crypto').randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO sponsor_tokens (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, String(SETTINGS_TOKEN_DAYS)]
  );
  return token;
}

async function resolveSettingsToken(token) {
  if (!enabled || !token) return null;
  const r = await pool.query(
    `SELECT user_id FROM sponsor_tokens WHERE token = $1 AND expires_at > now()`,
    [token]
  );
  return r.rows[0] ? r.rows[0].user_id : null;
}

// Append chat turns. msgs = [{ role, content }, …]
async function appendMessages(userId, msgs) {
  if (!enabled || !userId || !msgs || !msgs.length) return;
  const values = [];
  const params = [];
  msgs.forEach((m, i) => {
    // 'voice' or 'text'. Anything else, including undefined, is stored as NULL
    // so an unknown medium can never be mistaken for a known one.
    const medium = m.medium === 'voice' || m.medium === 'text' ? m.medium : null;
    params.push(userId, m.role, fc.encrypt(String(m.content || '')), medium);
    values.push(`($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`);
  });
  await pool.query(
    `INSERT INTO messages (user_id, role, content, medium) VALUES ${values.join(',')}`,
    params
  );
}

/* Decrypt a batch of message rows on the way out. A row we can't read (wrong
   or rotated key) is DROPPED rather than passed on: sending ciphertext to
   Claude would produce a confused reply, and an empty string isn't a valid
   message. Losing history is bad; a broken conversation for someone who needed
   to talk is worse. fieldcrypto logs every failure. */
function decryptRows(rows) {
  const out = [];
  let unreadable = 0;
  for (const row of rows) {
    const content = fc.decrypt(row.content);
    if (content === null) { unreadable++; continue; }
    out.push({ ...row, content });
  }
  if (unreadable) {
    console.error(`[DB] ${unreadable} message(s) could not be decrypted and were skipped.`);
  }
  return out;
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
  // An unreadable digest is treated as "no digest yet" rather than an error —
  // the recent window still reaches Claude, so the conversation keeps working.
  const digest = fc.decrypt(row.memory_digest);
  if (digest === null) return null;
  return { digest, upto: Number(row.memory_digest_upto) || 0 };
}

/* ─── A rename has to reach the notes too ────────────────────────────────────
   Bilal renamed his sponsor, and it kept answering with the old name some of
   the time. Adding a block that says "your name is X" was not enough on its
   own, because the stored digest still said the old one in its own words. Two
   confident statements in the same prompt, and which one wins comes out
   differently on different samples, which is exactly the "sometimes" he saw.

   So the contradiction is removed rather than argued with. Whole words only, so
   renaming a sponsor to "Al" cannot turn "always" into "Always" further down
   the note. Returns whether anything actually changed, for the log. */
async function renameInMemory(userId, from, to) {
  if (!enabled || !userId || !from || !to || from === to) return false;
  const m = await getMemory(userId);
  if (!m || !m.digest) return false;
  const escaped = String(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  if (!re.test(m.digest)) return false;
  await saveMemory(userId, m.digest.replace(re, to), m.upto);
  return true;
}

async function saveMemory(userId, digest, upto) {
  if (!enabled || !userId) return;
  await pool.query(
    'UPDATE users SET memory_digest = $2, memory_digest_upto = $3 WHERE user_id = $1',
    [userId, fc.encrypt(digest), upto]
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
  return { rows: decryptRows(r.rows), total };
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
  return decryptRows(r.rows);
}

/* When did this person last say anything, before the message being answered
   right now? getSponsorReply calls this BEFORE persistExchange writes the
   current turn, so it is genuinely the previous contact and not this one.

   The sponsor had no sense of time at all until this existed. Two weeks could
   pass and it would carry on as though the conversation had never paused,
   which on a recovery product is the difference between "good to hear from
   you" and "it's been a couple of weeks, how have you been". */
async function getLastMessageAt(userId) {
  if (!enabled || !userId) return null;
  /* role = 'user' ONLY. The messages table holds both sides, so without this
     filter the "last message" is usually the sponsor's own reply, and the
     answer to "when did this person last write to me" is wrong in both places
     that ask it: the gap shown to the model, and the burst detection that
     decides whether to quote. */
  const r = await pool.query(
    "SELECT created_at FROM messages WHERE user_id = $1 AND role = 'user' ORDER BY id DESC LIMIT 1",
    [userId]
  );
  return (r.rows[0] && r.rows[0].created_at) || null;
}

/* One person can hold several rows in `users`, for two separate reasons, and
   counting rows therefore overstates how many people exist.

   Registering twice makes a second row. The browser mints a fresh reg-<uuid>
   per visit and /register keys on it, so nothing recognises a returning person
   even when the email matches exactly. Matt alone is three rows.

   And every web registrant with a phone number is deliberately written twice:
   once as reg-<uuid> and once as wa-<E.164>, so their sponsor knows them when
   they message WhatsApp. That mirror is doing its job, but it is not a second
   person.

   PERSON_KEY collapses both: email first because it survives someone changing
   their number, then phone, and only then the row id for the WhatsApp walk-ups
   who have neither. Used for every count that answers "how many people". */
const PERSON_KEY = `LOWER(COALESCE(NULLIF(email, ''), NULLIF(phone, ''), user_id))`;

/* ─── People who are not customers ──────────────────────────────────────────
   Mariam and her husband use the product themselves. They are not users of a
   business, and their conversations are personal, so they should not sit in a
   metric Matt reads or on the page where he reads other people's threads. Same
   applies to any internal or test account: Bilal's QA runs put 138 messages
   into a product with 33 people in it, which moves every average he looks at.

   The identifiers live in the Render env and NEVER in this file. This repo is
   public, and putting somebody's personal email in it to exclude them from a
   report would be a worse privacy failure than the one being fixed.

   Set EXCLUDED_PEOPLE to a comma-separated list of emails or phone numbers,
   matched against the same PERSON_KEY everything else groups on, so a person
   with a website row and a WhatsApp row goes with both. */
const EXCLUDED = String(process.env.EXCLUDED_PEOPLE || '')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean)
  /* Inlined into SQL below, so anything that is not plainly an email or a phone
     number is dropped rather than trusted. These come from our own env, but a
     value that reaches a query without being checked is a habit worth not
     having. */
  .filter((x) => {
    const safe = /^[a-z0-9@._+-]+$/.test(x);
    if (!safe) console.error(`[db] ignoring unsafe EXCLUDED_PEOPLE entry: ${JSON.stringify(x)}`);
    return safe;
  });

// Appended to any query that groups or counts by person. Empty when nobody is
// excluded, so the SQL is unchanged in that case.
/* Some people we need to exclude were here before we recorded an email, so
   there is nothing stable to match on but the name they gave. EXCLUDED_NAMES
   handles those, matched exactly and case-insensitively.

   A blunter instrument than an email, deliberately kept separate from it: a
   real person who happens to share the name would be hidden from every metric
   without anyone noticing. Use it for the handful of internal accounts that
   have no better identifier, prefer EXCLUDED_PEOPLE whenever an email exists,
   and the count is logged at boot so this cannot quietly grow. */
const EXCLUDED_NAMES = String(process.env.EXCLUDED_NAMES || '')
  .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  .filter((x) => {
    const safe = /^[a-z0-9 .'-]+$/.test(x);
    if (!safe) console.error(`[db] ignoring unsafe EXCLUDED_NAMES entry: ${JSON.stringify(x)}`);
    return safe;
  });

/* A person is excluded if ANY of their rows carries an excluded name, because
   the website row and the WhatsApp row are the same human. */
const nameClause = (col) => EXCLUDED_NAMES.length
  ? ` AND ${col} NOT IN (SELECT ${PERSON_KEY} FROM users
        WHERE LOWER(TRIM(COALESCE(name, ''))) IN (${EXCLUDED_NAMES.map((n) => `'${n}'`).join(', ')}))`
  : '';

/* The same condition for queries that join users as `u`, where a bare `email`
   would be ambiguous. */
const PERSON_KEY_U = `LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id))`;
/* The condition, for whichever column holds the person key in a given query.
   One helper so a new query cannot accidentally filter on emails but not names. */
function notExcluded(col) {
  let sql = '';
  if (EXCLUDED.length) sql += ` AND ${col} NOT IN (${EXCLUDED.map((e) => `'${e}'`).join(', ')})`;
  sql += nameClause(col);
  return sql;
}
const NOT_EXCLUDED = notExcluded(PERSON_KEY);
const NOT_EXCLUDED_U = notExcluded(PERSON_KEY_U);

if (EXCLUDED.length || EXCLUDED_NAMES.length) {
  console.log(`[db] excluding ${EXCLUDED.length} identifier(s) and ${EXCLUDED_NAMES.length} name(s) from metrics and the reader`);
}

// North-star + usage aggregates for /api/metrics/northstar.
async function getMetrics() {
  if (!enabled) return null;
  const [users, activity, byDay] = await Promise.all([
    pool.query(`
      SELECT COUNT(DISTINCT ${PERSON_KEY})::int AS registered,
             COUNT(DISTINCT ${PERSON_KEY}) FILTER (WHERE access = 'Paid')::int AS paid,
             COALESCE((
               /* One row per PERSON, not per row in users. Registration mirrors
                  people onto reg- and wa- ids, so somebody with three rows was
                  contributing three lifetimes to this total every single day.
                  Measured Aug 19: 192 the old way against 119 the honest way,
                  a 38% overstatement, on the number printed on the front of
                  getaisponsor.com. MIN(signup_date) because the honest answer
                  to "how long have they been here" is the first time they
                  arrived, not the last time a duplicate row was written. */
               SELECT SUM(GREATEST(0, (now()::date - first_signup::date)))
               FROM (SELECT ${PERSON_KEY} AS person, MIN(signup_date) AS first_signup
                     FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) people
             ), 0)::int AS cumulative_days,
             COUNT(DISTINCT ${PERSON_KEY}) FILTER (WHERE last_active > now() - interval '7 days')::int AS active_last_7d
      FROM users WHERE true${NOT_EXCLUDED}`),
    pool.query(`
      /* Same double count, quieter: activity_days is keyed by user_id, so one
         person turning up on one day under two mirrored ids counted twice. A
         day somebody showed up is one day, however many rows they own. */
      SELECT COUNT(DISTINCT (LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id)), a.day))::int AS total_active_days,
             COUNT(DISTINCT LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id)))::int AS users_who_chatted,
             COALESCE(SUM(a.messages), 0)::int AS total_messages
      FROM activity_days a
      JOIN users u ON u.user_id = a.user_id
      WHERE true${NOT_EXCLUDED_U}`),
    pool.query(`
      SELECT signup_date::date AS day, COUNT(DISTINCT ${PERSON_KEY})::int AS n
      FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1 ORDER BY 1`),
  ]);
  /* ── What actually happened in the last 7 days ──────────────────────────
     Everything above is cumulative, which is exactly the complaint: a total
     that only ever rises cannot tell you whether this week was good. Matt's
     ask was week on week movement, so the window is computed here rather than
     inferred by whoever is rendering it. Same de-duplication as the totals:
     one person turning up under two mirrored ids is one person, one day. */
  const week = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM (
         SELECT DISTINCT LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id)) AS person, a.day
         FROM activity_days a JOIN users u ON u.user_id = a.user_id
         WHERE true${NOT_EXCLUDED_U} AND a.day > now()::date - 7) d)                              AS active_days_7d,
      (SELECT COUNT(DISTINCT LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id)))::int
         FROM activity_days a JOIN users u ON u.user_id = a.user_id
         WHERE true${NOT_EXCLUDED_U} AND a.day > now()::date - 7)                                 AS people_who_showed_7d,
      (SELECT COALESCE(SUM(a.messages), 0)::int
         FROM activity_days a JOIN users u ON u.user_id = a.user_id
         WHERE true${NOT_EXCLUDED_U} AND a.day > now()::date - 7)                                 AS messages_7d,
      (SELECT COUNT(*)::int FROM (
         SELECT ${PERSON_KEY} AS person, MIN(signup_date) AS first_signup
         FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) p
       WHERE p.first_signup > now() - interval '7 days')                AS signups_7d`);

  const signupsByDay = {};
  byDay.rows.forEach((r) => {
    signupsByDay[new Date(r.day).toISOString().slice(0, 10)] = r.n;
  });
  return { ...users.rows[0], ...activity.rows[0], ...week.rows[0], signupsByDay };
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

  /* ⚠️ Every count here is per PERSON, not per row in users.
     These used to be COUNT(*) FROM users, which counted rows. One human holds
     two rows (reg- from the website, wa- from WhatsApp), so on 2 Sep 2026 the
     access split read Beta 44 / Paid 4 / Unpaid 3, totalling 51 against 27 real
     people, and the paid figure was exactly double the truth. Matt asked for
     paid vs unpaid in the weekly post, so this had to be right before it could
     be published rather than after somebody acted on it. */
  const [program, stage, access, channel, msgsByDay, source] = await Promise.all([
    // program is stored comma-joined ("AA, NA") — one person can be in several,
    // so this legitimately sums to more than the number of people.
    pool.query(`
      SELECT trim(p) AS k, COUNT(DISTINCT ${PERSON_KEY})::int AS n
      FROM users, unnest(string_to_array(NULLIF(program, ''), ',')) AS p
      WHERE true${NOT_EXCLUDED}
      GROUP BY 1 ORDER BY n DESC, 1`),
    /* One value per person. Their rows can disagree, because the website row is
       written at signup and the WhatsApp one later, so the most complete answer
       wins over a blank rather than being averaged into 'unknown'. */
    pool.query(`
      SELECT COALESCE(NULLIF(stage, ''), 'unknown') AS k, COUNT(*)::int AS n
      FROM (SELECT ${PERSON_KEY} AS person, MAX(NULLIF(stage, '')) AS stage
            FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) p
      GROUP BY 1 ORDER BY n DESC`),
    /* Access is ranked, not picked at random: somebody holding a Beta row and a
       Paid row is a paying customer. Reading it any other way would undercount
       revenue, which is the one direction that must never happen quietly. */
    pool.query(`
      SELECT access AS k, COUNT(*)::int AS n
      FROM (
        SELECT ${PERSON_KEY} AS person,
               CASE MAX(CASE access WHEN 'Paid'   THEN 3
                                    WHEN 'Unpaid' THEN 2
                                    WHEN 'Beta'   THEN 1 ELSE 0 END)
                 WHEN 3 THEN 'Paid' WHEN 2 THEN 'Unpaid'
                 WHEN 1 THEN 'Beta' ELSE 'unknown' END AS access
        FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1
      ) p
      GROUP BY 1 ORDER BY n DESC`),
    /* Channel is the one breakdown that SHOULD sum to more than the headcount:
       the same person really does use both the website and WhatsApp, and that
       is worth seeing. Distinct people per channel, not rows. */
    pool.query(`
      SELECT k, COUNT(DISTINCT person)::int AS n FROM (
        SELECT ${PERSON_KEY} AS person,
               CASE
                 WHEN user_id LIKE 'reg-%'  THEN 'Website'
                 WHEN user_id LIKE 'wa-%'   THEN 'WhatsApp'
                 WHEN user_id LIKE 'web-%'  THEN 'Web chat only'
                 ELSE 'Other'
               END AS k
        FROM users WHERE true${NOT_EXCLUDED}
      ) c GROUP BY 1 ORDER BY n DESC`),
    pool.query(`
      SELECT day::text AS k, SUM(messages)::int AS n
      FROM activity_days
      WHERE day >= CURRENT_DATE - INTERVAL '29 days'
      GROUP BY 1 ORDER BY 1`),
    // How they found us. Pre-attribution rows are genuinely Unknown — never
    // fold them into Direct, which would credit a channel we can't evidence.
    pool.query(`
      SELECT COALESCE(source, 'Unknown') AS k, COUNT(*)::int AS n
      FROM (SELECT ${PERSON_KEY} AS person, MAX(NULLIF(acquired_from, '')) AS source
            FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) p
      GROUP BY 1 ORDER BY n DESC, 1`),
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

// Fire-and-forget: a failure to write the audit row must never block or fail
// the admin request itself, so errors are swallowed here (and logged) rather
// than thrown.
async function logAdminAccess(route, targetId, success, ip) {
  if (!enabled) return;
  try {
    await pool.query(
      `INSERT INTO admin_access_log (route, target_id, success, ip) VALUES ($1, $2, $3, $4)`,
      [route, targetId || null, success, ip || null]
    );
  } catch (err) {
    console.error('[DB] failed to write admin_access_log:', err.message);
  }
}

/* ─── Weekly review ─────────────────────────────────────────────────────────
   Storage for the end-of-week note. The logic lives in weekly.js; this is only
   the reading and writing.

   Every window here is [start, end] INCLUSIVE of both days, expressed as
   `< end + 1 day` so a message sent at 23:50 on the Sunday belongs to the week
   it was actually sent in. An exclusive end date would silently drop the last
   day of every week, which is the day most worth having. */

// The week's turns, oldest first, for the model to read.
async function getWeekMessages(userId, startDay, endDay, limit = 500) {
  if (!enabled || !userId) return [];
  const r = await pool.query(
    `SELECT id, role, content, created_at FROM messages
      WHERE user_id = $1
        AND created_at >= $2::date
        AND created_at <  ($3::date + INTERVAL '1 day')
      ORDER BY id ASC LIMIT $4`,
    [userId, startDay, endDay, limit]
  );
  return decryptRows(r.rows);
}

/* Counts for the week, plus the per-day shape the page draws as seven dots.
   Every day in the window is returned, including the zeros: the gaps are the
   informative part, and letting the front end infer them from missing keys is
   how a week with no Wednesday quietly becomes a six-day week.

   TWO DIFFERENT COUNTS, and conflating them is a real bug that shipped once.

   activity_days is the record of turning up, and clearConversation deliberately
   leaves it alone: somebody wiping the conversation should not also erase the
   fact that they showed up, which the north-star numbers are built on. So after
   a "start over" activity_days still says 15 messages while the messages table
   holds none of them.

   `readable` is the only honest answer to "how much can actually be summarised",
   because it counts the rows a summariser can still open. Gate on `readable`;
   the first version gated on the activity count and therefore sent a model off
   to find themes in a week it could only read two messages of, which is the
   exact fabrication the threshold exists to stop. `activeDays` stays from
   activity_days, because they really were there. */
async function getWeekActivity(userId, startDay, endDay) {
  if (!enabled || !userId) return { messages: 0, readable: 0, activeDays: 0, days: [] };
  const [act, msg] = await Promise.all([
    pool.query(
      `SELECT day::text AS day, messages FROM activity_days
        WHERE user_id = $1 AND day >= $2::date AND day <= $3::date
        ORDER BY day ASC`,
      [userId, startDay, endDay]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM messages
        WHERE user_id = $1
          AND created_at >= $2::date
          AND created_at <  ($3::date + INTERVAL '1 day')`,
      [userId, startDay, endDay]),
  ]);
  const got = Object.fromEntries(act.rows.map((x) => [x.day, x.messages]));
  const days = [];
  const start = new Date(startDay + 'T00:00:00Z');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, messages: got[d] || 0 });
  }
  return {
    messages: days.reduce((a, b) => a + b.messages, 0), // turned up, historical
    readable: msg.rows[0].n,                            // still summarisable
    activeDays: days.filter((d) => d.messages > 0).length,
    days,
  };
}

/* Returns true if THIS call created the row, false if somebody else already
   had, null on a real error. The caller uses that three-way answer to decide
   whether it owns delivery — see the UNIQUE note on the table. */
async function saveWeeklySummary(userId, weekStart, weekEnd, payload, stats) {
  if (!enabled || !userId) return null;
  const r = await pool.query(
    `INSERT INTO weekly_summaries (user_id, week_start, week_end, summary, stats, tone)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (user_id, week_start) DO NOTHING
     RETURNING id`,
    [userId, weekStart, weekEnd, fc.encrypt(JSON.stringify(payload)),
     JSON.stringify(stats || {}), payload.tone || null]
  );
  return r.rowCount > 0;
}

function hydrateWeekly(row) {
  if (!row) return null;
  const plain = fc.decrypt(row.summary);
  // An unreadable summary is treated as absent, exactly as getMemory does: the
  // pane shows "not yet", which is survivable. Handing the page ciphertext is not.
  if (plain === null) return null;
  let payload;
  try { payload = JSON.parse(plain); } catch (e) { return null; }
  return {
    ...payload,
    weekStart: row.week_start instanceof Date ? row.week_start.toISOString().slice(0, 10) : String(row.week_start),
    weekEnd: row.week_end instanceof Date ? row.week_end.toISOString().slice(0, 10) : String(row.week_end),
    stats: row.stats || {},
    createdAt: row.created_at,
    delivered: !!row.delivered_at,
  };
}

// weekStart omitted = their most recent one, which is what the page opens on.
async function getWeeklySummary(userId, weekStart) {
  if (!enabled || !userId) return null;
  const r = weekStart
    ? await pool.query(
        `SELECT * FROM weekly_summaries WHERE user_id = $1 AND week_start = $2::date`,
        [userId, weekStart])
    : await pool.query(
        `SELECT * FROM weekly_summaries WHERE user_id = $1 ORDER BY week_start DESC LIMIT 1`,
        [userId]);
  return hydrateWeekly(r.rows[0]);
}

// Just the dates, for the "earlier weeks" picker. Never decrypts anything.
async function listWeeklySummaries(userId, limit = 12) {
  if (!enabled || !userId) return [];
  const r = await pool.query(
    `SELECT week_start::text AS start, week_end::text AS "end", tone
       FROM weekly_summaries WHERE user_id = $1
      ORDER BY week_start DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

async function markWeeklyDelivered(userId, weekStart, ok, note) {
  if (!enabled || !userId) return;
  await pool.query(
    `UPDATE weekly_summaries
        SET delivered_at = CASE WHEN $3 THEN now() ELSE delivered_at END,
            delivery_note = $4
      WHERE user_id = $1 AND week_start = $2::date`,
    [userId, weekStart, !!ok, note || null]
  );
}

/* Everyone who spoke during the closed week and has no row for it yet.

   Driven off `messages` rather than `users` on purpose: the question is who had
   a week worth reviewing, not who exists. Somebody who registered and never
   said anything is correctly absent from this, and so costs nothing. */
async function usersDueForWeekly(weekStart, weekEnd, limit = 25) {
  if (!enabled) return [];
  /* The phone comes back with the id now. Matt asked for these to land between
     9am and noon in each person's own morning, and their number is the only
     thing we hold that says where they are. See timezones.js. */
  const r = await pool.query(
    `SELECT m.user_id, MAX(u.phone) AS phone
       FROM messages m
       LEFT JOIN users u ON u.user_id = m.user_id
       LEFT JOIN weekly_summaries w
         ON w.user_id = m.user_id AND w.week_start = $1::date
      WHERE m.created_at >= $1::date
        AND m.created_at <  ($2::date + INTERVAL '1 day')
        AND w.id IS NULL
      GROUP BY m.user_id
      ORDER BY COUNT(*) DESC
      LIMIT $3`,
    [weekStart, weekEnd, limit]
  );
  return r.rows.map((x) => ({ userId: x.user_id, phone: x.phone || '' }));
}

/* ─── Where everybody is ─────────────────────────────────────────────────────
   Matt: "lets add also country to this also from the phone number prefix and
   state in the USA also based on their phone number that will be a super
   interesting metric to track as well."

   One phone per PERSON, not per row, or somebody holding a website row and a
   WhatsApp row counts twice and the map is wrong by the same 22 people the
   access split was wrong by. The number itself never leaves the server: the
   caller turns it into a country and a state and only those are published. */
async function phonesByPerson() {
  if (!enabled) return [];
  const r = await pool.query(
    `SELECT ${PERSON_KEY} AS person, MAX(NULLIF(phone, '')) AS phone
       FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1`
  );
  return r.rows.filter((x) => x.phone);
}

/* ─── Week on week ───────────────────────────────────────────────────────────
   Matt: "does it have a WoW % increase across all the metrics we're tracking
   which i think for sure we should be doing".

   Everything else in getMetrics is either cumulative or a single 7-day window,
   and neither answers "was this week better than last". This returns both
   windows so the comparison is computed once, here, against the same
   de-duplicated definitions the totals use, rather than by whoever renders it.

   Windows are the last 7 days and the 7 before that. Deliberately rolling
   rather than calendar weeks: the post can then run on any day and still
   compare like with like.                                                    */
async function getWeekOverWeek() {
  if (!enabled) return null;
  const person = `LOWER(COALESCE(NULLIF(u.email, ''), NULLIF(u.phone, ''), u.user_id))`;

  const r = await pool.query(`
    WITH win AS (SELECT now()::date - 7 AS this_start, now()::date - 14 AS prev_start)
    SELECT
      /* new people */
      (SELECT COUNT(*)::int FROM (
         SELECT ${PERSON_KEY} AS p, MIN(signup_date) AS f FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) s, win
       WHERE s.f::date > win.this_start)                                    AS signups_now,
      (SELECT COUNT(*)::int FROM (
         SELECT ${PERSON_KEY} AS p, MIN(signup_date) AS f FROM users WHERE true${NOT_EXCLUDED} GROUP BY 1) s, win
       WHERE s.f::date > win.prev_start AND s.f::date <= win.this_start)     AS signups_prev,

      /* people who actually turned up */
      (SELECT COUNT(DISTINCT ${person})::int FROM activity_days a
         JOIN users u ON u.user_id = a.user_id, win
       WHERE true${NOT_EXCLUDED_U} AND a.day > win.this_start)                                        AS people_now,
      (SELECT COUNT(DISTINCT ${person})::int FROM activity_days a
         JOIN users u ON u.user_id = a.user_id, win
       WHERE true${NOT_EXCLUDED_U} AND a.day > win.prev_start AND a.day <= win.this_start)            AS people_prev,

      /* days somebody showed up, the north-star input */
      (SELECT COUNT(*)::int FROM (
         SELECT DISTINCT ${person} AS p, a.day FROM activity_days a
           JOIN users u ON u.user_id = a.user_id, win
         WHERE true${NOT_EXCLUDED_U} AND a.day > win.this_start) d)                                   AS days_now,
      (SELECT COUNT(*)::int FROM (
         SELECT DISTINCT ${person} AS p, a.day FROM activity_days a
           JOIN users u ON u.user_id = a.user_id, win
         WHERE true${NOT_EXCLUDED_U} AND a.day > win.prev_start AND a.day <= win.this_start) d)       AS days_prev,

      /* messages */
      (SELECT COALESCE(SUM(a.messages), 0)::int FROM activity_days a
         JOIN users u ON u.user_id = a.user_id, win
       WHERE true${NOT_EXCLUDED_U} AND a.day > win.this_start)                                        AS messages_now,
      (SELECT COALESCE(SUM(a.messages), 0)::int FROM activity_days a
         JOIN users u ON u.user_id = a.user_id, win
       WHERE true${NOT_EXCLUDED_U} AND a.day > win.prev_start AND a.day <= win.this_start)            AS messages_prev
  `);
  return r.rows[0];
}

/* ─── Money that actually moved ──────────────────────────────────────────────
   Read from account_events, which the Stripe webhook appends to, rather than
   from Stripe directly: this is the record of what we were told and acted on,
   and it survives a Stripe outage.

   Deliberately separate from anything counting trials. Matt asked to track
   "sales" where the card has gone through but the payment has not, and the DRM
   Zapier alert already made the mistake of printing a $0 trial as a sale. These
   two numbers must never be added together or share a label.                 */
async function getCollected() {
  if (!enabled) return { allTimeCents: 0, last7dCents: 0, payments: 0 };
  const r = await pool.query(`
    SELECT
      COALESCE(SUM((detail->>'amount')::bigint), 0)::bigint AS all_time_cents,
      COALESCE(SUM((detail->>'amount')::bigint)
               FILTER (WHERE created_at > now() - interval '7 days'), 0)::bigint AS last_7d_cents,
      COUNT(*)::int AS payments
    FROM account_events
    WHERE event = 'payment_succeeded'
      AND detail->>'amount' ~ '^[0-9]+$'`);
  const row = r.rows[0] || {};
  return {
    allTimeCents: Number(row.all_time_cents || 0),
    last7dCents: Number(row.last_7d_cents || 0),
    payments: Number(row.payments || 0),
  };
}

/* ─── Reading real conversations (the admin viewer) ──────────────────────────
   Matt asked for somewhere he can read the actual threads while the first users
   are on the product, so he can feel how the sponsor is landing and adjust the
   prompt from what he sees. He was doing this in Instagram DMs before.

   Both functions group on PERSON_KEY rather than user_id, and that is the whole
   point. One human signs up on the web and again on WhatsApp, so they hold two
   user_id rows. Listing by user_id would show the same person twice, each with
   half their conversation, which is exactly the wrong thing to hand someone who
   is trying to read a thread from the first message forward.                  */

// The list: one row per person, newest conversation first. No message content.
async function listConversations(limit = 200) {
  if (!enabled) return [];
  const r = await pool.query(
    `WITH u AS (
       SELECT user_id, ${PERSON_KEY} AS person, name, access FROM users
     ), m AS (
       SELECT user_id, COUNT(*)::int AS n,
              MIN(created_at) AS first_at, MAX(created_at) AS last_at
       FROM messages GROUP BY user_id
     )
     SELECT u.person,
            MAX(u.name)   AS name,
            MAX(u.access) AS access,
            COALESCE(SUM(m.n), 0)::int AS messages,
            MIN(m.first_at) AS first_at,
            MAX(m.last_at)  AS last_at
     FROM u LEFT JOIN m ON m.user_id = u.user_id
     WHERE true${notExcluded('u.person')}
     GROUP BY u.person
     HAVING COALESCE(SUM(m.n), 0) > 0
     ORDER BY MAX(m.last_at) DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/* One person's whole conversation, oldest first, across every user_id they
   hold. No limit: "from the first message through to where they're at" was the
   ask, so a 40-message window would answer a different question. */
async function getFullThread(person) {
  if (!enabled || !person) return null;
  const r = await pool.query(
    `SELECT role, content, created_at, medium
     FROM messages
     WHERE user_id IN (SELECT user_id FROM users WHERE ${PERSON_KEY} = $1${NOT_EXCLUDED})
     ORDER BY created_at ASC, id ASC`,
    [person]
  );
  return decryptRows(r.rows);
}

module.exports = {
  listConversations, getFullThread, getWeekOverWeek, getCollected, phonesByPerson,
  getLastMessageAt,
  enabled, init, upsertUser, recordActivity, getMetrics, getBreakdowns,
  // Exported so the Slack alerts label a signup's source with the SAME rule the
  // dashboard groups on. Two implementations would eventually disagree.
  resolveSource,
  saveProfile, getProfile, appendMessages, getHistory, findPersonId,
  recordEvent, getEvents, hasEvent, clearConversation, getPersonStats,
  createLinkCode, claimLinkCode,
  purgeUserData, findAllIdentities,
  quietCheckinCandidates, betaAccessRoster,
  retentionCandidates, purgeMessagesOnly,
  requestDeletion, getDeletionRequest, cancelDeletion,
  claimDueDeletion, markDeletionDone, releaseStaleDeletions,
  clearProfileField,
  getOrCreateSettingsToken, resolveSettingsToken,
  linkSubscription, findByStripeCustomer, getUser, setAccess,
  getMemory, saveMemory, renameInMemory, getAgedOutMessages, redeemBetaCode, logAdminAccess,
  getWeekMessages, getWeekActivity, saveWeeklySummary, getWeeklySummary,
  listWeeklySummaries, markWeeklyDelivered, usersDueForWeekly,
};
