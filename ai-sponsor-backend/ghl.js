// ─── GoHighLevel (GHL) contact sync for AI Sponsor ──────────────────────────
// Saves each website registration into the "Conscious AI" GHL location as a
// contact, mapping onboarding answers onto the custom fields Abdul set up.
//
// IMPORTANT — SILENCED BY DESIGN (dnd: true):
// The GHL location is SHARED with ~80 other-product workflows (Academy,
// Accelerator, webinars, etc.). To guarantee an AI Sponsor contact can never be
// messaged by one of those workflows, every contact we create is flagged
// Do-Not-Disturb across all channels. AI Sponsor never messages people through
// GHL (our chat runs over Twilio/our backend), so this costs us nothing and is
// reversible per-contact later. This is our own guardrail — no GHL admin needed.
//
// Config comes from env (keeps the token OUT of the repo):
//   GHL_API_TOKEN     — Private Integration token (required)
//   GHL_LOCATION_ID   — defaults to the known Conscious AI location
//   GHL_AMENDS_FIELD_ID — custom field id for "Amends - who" (optional; auto-
//                         created on first boot if missing and a token is set)

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = process.env.GHL_LOCATION_ID || 'Mgfec8mT0vXxyhp9SizK';

// Custom field ids (from Abdul's GHL setup — verified via the API).
const FIELD_IDS = {
  program:        'B6UQyDVaT4Mx5u6DDPQa', // CHECKBOX (multi)
  recoveryStage:  'a0ZkVb3dTSda1Slyx2UL', // SINGLE_OPTIONS
  deliveryMethod: 'YHvDIM8wdZEiUhsrfYVx', // SINGLE_OPTIONS
  paymentStatus:  '8IuJgDL10gGOW8SsbDZv', // SINGLE_OPTIONS
};

// Registration form value -> GHL option value.
const PROGRAM_MAP = {
  DA: 'Debtors Anonymous (DA)',
  BDA: 'Business Debtors Anonymous (BDA)',
  UA: 'Underearners Anonymous (UA)',
  AA: 'Alcoholics Anonymous (AA)',
  'Al-Anon': 'Al-Anon / Alateen',
  NA: 'Narcotics Anonymous (NA)',
  OA: 'Overeaters Anonymous (OA)',
  GA: 'Gamblers Anonymous (GA)',
  ACA: 'Adult Children of Alcoholics (ACA)',
  SLAA: 'Sex and Love Addicts Anonymous (SLAA)',
  WA: 'Workaholics Anonymous (WA)',
  Unsure: 'New / Not Sure',
};

// Form has 6 stages, GHL has 4 buckets.
const STAGE_MAP = {
  'Just starting out': 'New',
  'Under 3 months': 'Early Recovery',
  '3-12 months': 'Early Recovery',
  '1-5 years': 'Mid Recovery',
  '5+ years': 'Long-term Recovery',
  'Starting over': 'New',
};

const DELIVERY_MAP = { whatsapp: 'WhatsApp', web: 'Web Chat', webchat: 'Web Chat' };

function token() {
  const t = process.env.GHL_API_TOKEN;
  if (!t) {
    const err = new Error('GHL not configured (GHL_API_TOKEN missing)');
    err.statusCode = 503;
    throw err;
  }
  return t;
}

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Split a full name into first/last for GHL (which prefers the split fields).
function splitName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function mapPrograms(program) {
  const codes = Array.isArray(program)
    ? program
    : String(program || '').split(',').map((s) => s.trim()).filter(Boolean);
  return codes.map((c) => PROGRAM_MAP[c] || c).filter(Boolean);
}

// Build the GHL contact body from the registration payload.
function buildContactBody(data) {
  const { firstName, lastName } = splitName(data.name);
  const programs = mapPrograms(data.program);
  const stage = STAGE_MAP[data.stage] || undefined;
  const delivery = DELIVERY_MAP[(data.delivery || '').toLowerCase()] || undefined;

  // Payment status -> field value + the ownership tag.
  const rawStatus = (data.paymentStatus || '').toLowerCase();
  let paymentStatus = 'Unpaid';
  if (rawStatus === 'beta' || data.betaCode) paymentStatus = 'Beta';
  else if (rawStatus === 'paid') paymentStatus = 'Paid';

  const tags = ['ai-sponsor'];
  if (paymentStatus === 'Beta') tags.push('ai-sponsor-beta');
  else if (paymentStatus === 'Paid') tags.push('ai-sponsor-paid');
  if (data.amendsInterest) tags.push('amends-tv');

  const customFields = [
    programs.length ? { id: FIELD_IDS.program, value: programs } : null,
    stage ? { id: FIELD_IDS.recoveryStage, value: stage } : null,
    delivery ? { id: FIELD_IDS.deliveryMethod, value: delivery } : null,
    { id: FIELD_IDS.paymentStatus, value: paymentStatus },
  ].filter(Boolean);

  // "Amends - who" free text — only if we have a field id for it.
  const amendsFieldId = process.env.GHL_AMENDS_FIELD_ID;
  if (amendsFieldId && data.amendsWho) {
    customFields.push({ id: amendsFieldId, value: String(data.amendsWho) });
  }

  const body = {
    locationId: LOCATION_ID,
    firstName,
    lastName,
    name: data.name || undefined,
    email: data.email || undefined,
    phone: data.phone || undefined,
    dnd: true, // <-- silence: no GHL workflow can message this contact
    tags,
    customFields,
    source: data.source || 'ai-sponsor-registration',
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return body;
}

// Upsert (create or update, deduped on email/phone) a registration into GHL.
async function registerContact(data) {
  if (!data || (!data.email && !data.phone)) {
    const err = new Error('email or phone required');
    err.statusCode = 400;
    throw err;
  }
  const body = buildContactBody(data);
  const resp = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(json.message || `GHL upsert failed (${resp.status})`);
    err.statusCode = resp.status;
    err.detail = json;
    throw err;
  }
  const contact = json.contact || json;
  return { contactId: contact.id, isNew: json.new, tags: contact.tags };
}

// Delete a contact (used by the smoke test to clean up).
async function deleteContact(contactId) {
  const resp = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  return resp.ok;
}

// One-time: ensure the "Amends - who" custom field exists; returns its id.
async function ensureAmendsField() {
  if (process.env.GHL_AMENDS_FIELD_ID) return process.env.GHL_AMENDS_FIELD_ID;
  const resp = await fetch(`${GHL_BASE}/locations/${LOCATION_ID}/customFields`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: 'Amends - who', dataType: 'LARGE_TEXT' }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.message || `create field failed (${resp.status})`);
  const field = json.customField || json;
  return field.id;
}

module.exports = {
  registerContact,
  deleteContact,
  ensureAmendsField,
  buildContactBody,
  _maps: { PROGRAM_MAP, STAGE_MAP, DELIVERY_MAP, FIELD_IDS },
};
