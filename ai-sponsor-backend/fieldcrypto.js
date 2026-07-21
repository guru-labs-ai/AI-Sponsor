/* ─── Field-level encryption for the sensitive stuff ─────────────────────────
   What this protects against: anyone who ends up holding the database — a
   leaked DATABASE_URL, a stolen backup, a support person clicking through the
   Neon console — reading people's recovery conversations. Postgres already
   encrypts the disk, but that key belongs to the host, so the host (and anyone
   with the connection string) reads plaintext. This keeps the key somewhere
   else entirely (Render env), so the database on its own is unreadable.

   What it does NOT do, and nobody should claim it does:
     - It is not end-to-end. The server necessarily sees plaintext: it has to
       send the conversation to Claude to get a reply.
     - Anthropic still receives every message, Twilio still carries WhatsApp,
       OpenAI still handles voice. Encrypting our column doesn't change that.
   The landing page's privacy wording needs to match this reality, not the
   other way round.

   Guarded like every optional module here: no FIELD_ENCRYPTION_KEY set and
   everything passes through untouched, so the server runs exactly as before.
   A key that IS set but malformed throws at boot — silently storing plaintext
   because someone fat-fingered a env var is the one failure we don't want.

   Format: "v1:<iv>:<authTag>:<ciphertext>", each part base64. AES-256-GCM, a
   fresh 12-byte IV per value, and the auth tag means tampering is detected
   rather than quietly decrypted into something else. The v1 prefix is what
   makes this safe to deploy onto an existing table: anything without it is
   read back as-is, so old plaintext rows keep working and get replaced with
   encrypted ones as they're written.
──────────────────────────────────────────────────────────────────────────── */

const crypto = require('crypto');

const PREFIX = 'v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/* Accepts base64 (44 chars) or hex (64 chars) — whichever the person setting
   it happens to generate. Must decode to exactly 32 bytes for AES-256. */
function parseKey(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex');
  } else {
    try {
      buf = Buffer.from(trimmed, 'base64');
    } catch {
      buf = null;
    }
  }
  if (!buf || buf.length !== 32) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be 32 bytes — 64 hex chars or 44 base64 chars. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  return buf;
}

const key = parseKey(process.env.FIELD_ENCRYPTION_KEY);
const enabled = !!key;

if (enabled) {
  console.log('Field encryption ON — message content and memory digests are encrypted at rest.');
} else {
  console.log('Field encryption OFF (FIELD_ENCRYPTION_KEY missing) — stored as plaintext, as before.');
}

/* Returns the value unchanged when there's no key, so callers don't branch. */
function encrypt(plain) {
  if (!enabled || plain === null || plain === undefined) return plain;
  const text = String(plain);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/* Returns null when a value can't be read — a wrong/rotated key, or tampering.
   Deliberately NOT throwing: a decrypt failure must not take the chat down for
   someone mid-conversation. Callers drop nulls and the person effectively
   starts fresh, which is recoverable; a 500 in the middle of a hard night is
   not. It logs loudly because silently losing history is exactly the kind of
   thing that should be noticed immediately. */
function decrypt(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (!text.startsWith(PREFIX)) return value; // pre-encryption row, or no key ever set
  if (!enabled) {
    console.error('[fieldcrypto] encrypted value found but FIELD_ENCRYPTION_KEY is not set — cannot read it.');
    return null;
  }
  try {
    const [, ivB64, tagB64, ctB64] = text.split(':');
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (e) {
    console.error('[fieldcrypto] decrypt failed (wrong key or tampered value):', e.message);
    return null;
  }
}

module.exports = { enabled, encrypt, decrypt };
