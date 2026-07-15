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
  chatUserId:     'ut3yT8rCygCR5MDRhZqh', // TEXT — bridges GHL contact ↔ backend chat sessions
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
    data.chatUserId ? { id: FIELD_IDS.chatUserId, value: String(data.chatUserId) } : null,
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

/* ─── Stripe → GHL sync helpers ─────────────────────────────────────────────
   Used by the Stripe webhook so subscription state reaches the CRM. Tags are
   added/removed through the dedicated tag endpoints rather than PUT /contacts,
   because sending a `tags` array on the contact itself replaces the whole set —
   which would wipe unrelated tags like amends-tv off the same person.
──────────────────────────────────────────────────────────────────────────── */

async function ghlFetch(path, options) {
  const resp = await fetch(`${GHL_BASE}${path}`, { headers: headers(), ...options });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(json.message || `GHL ${path} failed (${resp.status})`);
    err.statusCode = resp.status;
    err.detail = json;
    throw err;
  }
  return json;
}

async function getContact(contactId) {
  const json = await ghlFetch(`/contacts/${contactId}`, { method: 'GET' });
  return json.contact || json;
}

async function addTags(contactId, tags) {
  if (!tags || !tags.length) return;
  await ghlFetch(`/contacts/${contactId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  });
}

async function removeTags(contactId, tags) {
  if (!tags || !tags.length) return;
  // A tag that isn't on the contact makes this 4xx — not worth failing a
  // webhook over, so treat removal as best-effort.
  await ghlFetch(`/contacts/${contactId}/tags`, {
    method: 'DELETE',
    body: JSON.stringify({ tags }),
  }).catch((e) => console.warn(`[GHL] removeTags ${tags.join(',')}: ${e.message}`));
}

async function setPaymentStatus(contactId, status) {
  if (!['Paid', 'Beta', 'Unpaid'].includes(status)) {
    throw new Error(`Invalid Payment Status "${status}" — GHL only accepts Paid/Beta/Unpaid`);
  }
  await ghlFetch(`/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify({ customFields: [{ id: FIELD_IDS.paymentStatus, value: status }] }),
  });
}

/* Find-or-create the contact behind a Stripe event.
   The webhook can land BEFORE the site ever registers this person: they pay on
   Stripe's page, and the browser redirect that triggers /register may be slow or
   may never happen (they close the tab). Somebody being charged must exist in the
   CRM regardless, so we upsert on email — GHL dedupes on it, and the fuller
   registration payload merges into the same contact whenever it arrives. */
async function upsertStripeContact({ email, userId }) {
  if (!email) {
    const err = new Error('Stripe event has no email — cannot resolve a GHL contact');
    err.statusCode = 400;
    throw err;
  }
  const customFields = [{ id: FIELD_IDS.paymentStatus, value: 'Paid' }];
  if (userId) customFields.push({ id: FIELD_IDS.chatUserId, value: String(userId) });
  const json = await ghlFetch('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId: LOCATION_ID,
      email,
      dnd: true, // same silence guardrail as every other AI Sponsor contact
      customFields,
      source: 'stripe-webhook',
    }),
  });
  return (json.contact || json).id;
}

// Save a support-form submission: upsert the contact (tagged ai-sponsor-support,
// DND like the rest) and attach a note with the subject + message.
async function submitSupport(data) {
  if (!data || !data.email) {
    const err = new Error('email required');
    err.statusCode = 400;
    throw err;
  }
  const { firstName, lastName } = splitName(data.name);
  const body = {
    locationId: LOCATION_ID,
    firstName,
    lastName,
    name: data.name || undefined,
    email: data.email,
    dnd: true,
    tags: ['ai-sponsor', 'ai-sponsor-support'],
    source: data.source || 'ai-sponsor-support-form',
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
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
  const contactId = (json.contact || json).id;
  if (contactId && (data.subject || data.message)) {
    await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        body: `[AI Sponsor Support]\nSubject: ${data.subject || '(none)'}\n\n${data.message || ''}`,
      }),
    }).catch(() => {});
  }
  return { contactId };
}

// Delete a contact (used by the smoke test to clean up).
async function deleteContact(contactId) {
  const resp = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  return resp.ok;
}

// List AI Sponsor SIGN-UPS (completed registrations) for the metrics endpoint.
// Only ai-sponsor-beta / ai-sponsor-paid count as sign-ups — support tickets and
// amends-tv applicants also live in this shared location but are not users.
// Returns aggregate-safe fields only (no names/emails leave the backend).
async function listSponsorContacts() {
  const out = [];
  let searchAfter = null;
  for (let page = 0; page < 10; page++) {
    const body = {
      locationId: LOCATION_ID,
      pageLimit: 100,
      filters: [
        {
          group: 'OR',
          filters: [
            { field: 'tags', operator: 'contains', value: ['ai-sponsor-beta'] },
            { field: 'tags', operator: 'contains', value: ['ai-sponsor-paid'] },
          ],
        },
      ],
    };
    if (searchAfter) body.searchAfter = searchAfter;
    const resp = await fetch(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json.message || `contact search failed (${resp.status})`);
    const contacts = json.contacts || [];
    contacts.forEach((c) => {
      out.push({ dateAdded: c.dateAdded, tags: c.tags || [] });
    });
    if (contacts.length < 100) break;
    searchAfter = contacts[contacts.length - 1].searchAfter;
    if (!searchAfter) break;
  }
  return out;
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
  submitSupport,
  deleteContact,
  listSponsorContacts,
  ensureAmendsField,
  buildContactBody,
  // Stripe → GHL sync
  getContact,
  addTags,
  removeTags,
  setPaymentStatus,
  upsertStripeContact,
  _maps: { PROGRAM_MAP, STAGE_MAP, DELIVERY_MAP, FIELD_IDS },
};
