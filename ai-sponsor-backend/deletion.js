/* ─── "Forget me" — full identity deletion (v1) ──────────────────────────────
   Spec agreed with Mariam in #ai-sponsor (Jul 2026):

   - Admin-run / on-request only. No user-facing trigger yet — that's blocked
     on the login work (86aj6vfqd). Written as a standalone function so the
     future button is a thin wrapper around deleteUserIdentity() below.

   - Strict order, because it matters:
       1. Stripe — cancel the subscription and CONFIRM it's cancelled before
          touching anything else. Purging first and cancelling after would
          reopen the exact hole the Stripe→GHL sync was built to close:
          someone still being billed with no record on our side to catch it.
       2. Our DB — messages, profile, activity_days, and the users row.
          Deleting the stats too (not just message content) is intentional —
          the north-star metric should reflect who's actually still here.
       3. GHL — delete the contact by its stored id. Never by search (the
          search index lags 30–45s, which risks acting on a stale/wrong
          contact). If the contact is shared with another product's tag,
          untag ours instead of deleting the whole contact.

   - Scope for v1: one identity per call — the exact user_id given (a
     reg-xxx web identity OR a wa-+phone WhatsApp identity). There's no join
     key yet linking a person's web and WhatsApp identities, so a request
     against one does not reach the other. That's a known gap for a later
     item, not something this handles.

   - No scheduled auto-purge. This module only ever runs on an explicit
     request; a retention policy for untouched accounts is a separate,
     deliberately deferred decision.

   Idempotent by design: safe to re-run after a partial failure. A missing
   subscription/contact/DB row at any step is treated as "nothing to do here",
   not an error — except the one case (Stripe cancel error) where "missing"
   is specifically NOT safe to treat as done. See resolveStripeForDeletion.
──────────────────────────────────────────────────────────────────────────── */

const db = require('./db');
const stripeModule = require('./stripe');
const ghl = require('./ghl');

// Tags that belong to AI Sponsor. Any tag on a GHL contact that doesn't match
// one of these means another product still has a legitimate reason to keep
// that contact around — so step 3 untags ours instead of deleting the record.
const OUR_TAG_PREFIXES = ['ai-sponsor', 'amends-tv'];
function isForeignTag(tag) {
  return !OUR_TAG_PREFIXES.some((p) => tag === p || tag.startsWith(p));
}

/* ── Step 1: Stripe — cancel and confirm ─────────────────────────────────── */
async function resolveStripeForDeletion(user) {
  const subscriptionId = user && user.stripe_subscription_id;
  if (!subscriptionId) {
    return { ok: true, detail: 'no_subscription_on_record' };
  }

  try {
    const status = await stripeModule.cancelSubscription(subscriptionId);
    if (status === 'canceled') return { ok: true, detail: 'cancelled_now' };
    // Stripe's synchronous response is supposed to be final — a non-canceled
    // status back from a successful cancel call is an anomaly, not a green
    // light. Stop and let a human look at it.
    return { ok: false, reason: `cancel call returned unexpected status "${status}"` };
  } catch (err) {
    // The cancel call itself failed. Per Mariam's correction: do NOT treat
    // "not found" as "fine, move on" — Stripe never hard-deletes
    // subscriptions, so a missing one usually means a wrong id or a
    // test/live key mismatch, not "already handled." The only safe read of
    // an error is one follow-up lookup to check the real status.
    try {
      const status = await stripeModule.getSubscriptionStatus(subscriptionId);
      if (status === 'canceled') return { ok: true, detail: 'already_cancelled' };
      return {
        ok: false,
        reason: `subscription exists with status "${status}" — cancel call failed: ${err.message}`,
      };
    } catch (lookupErr) {
      // Covers Stripe's "No such subscription" too — still not safe to proceed.
      return {
        ok: false,
        reason: `subscription lookup failed after cancel error: ${lookupErr.message}`,
      };
    }
  }
}

/* ── Step 3: GHL — delete by stored id, or untag if the contact is shared ──── */
async function resolveGhlForDeletion(user) {
  const contactId = user && user.ghl_contact_id;
  if (!contactId) return { action: 'none', detail: 'no_ghl_contact_on_record' };

  let contact;
  try {
    contact = await ghl.getContact(contactId);
  } catch (err) {
    if (err.statusCode === 404) return { action: 'none', detail: 'contact_already_gone' };
    throw err;
  }

  const tags = contact.tags || [];
  const foreignTags = tags.filter(isForeignTag);

  if (foreignTags.length > 0) {
    const ourTags = tags.filter((t) => !isForeignTag(t));
    if (ourTags.length > 0) await ghl.removeTags(contactId, ourTags);
    return { action: 'untagged', detail: contactId, removedTags: ourTags, keptForeignTags: foreignTags };
  }

  const deleted = await ghl.deleteContact(contactId);
  return { action: deleted ? 'deleted' : 'delete_failed', detail: contactId };
}

/* ── Orchestration ────────────────────────────────────────────────────────── */
async function deleteUserIdentity(userId, { requestedBy } = {}) {
  if (!userId) throw new Error('userId required');
  if (!db.enabled) throw new Error('DB not configured — refusing to delete without the source of truth.');

  const log = (msg) => console.log(`[delete-user] ${userId}: ${msg}`);
  log(`starting (requested by ${requestedBy || 'unknown'})`);

  const user = await db.getUser(userId);
  if (!user) {
    // No users row — still worth purging in case messages/profile exist
    // without one (shouldn't normally happen, but don't assume).
    log('no users row found — purging any orphaned messages/profile data anyway');
    await db.purgeUserData(userId);
    return {
      userId,
      stopped: false,
      stripe: { ok: true, detail: 'no_user_record' },
      db: 'purged_orphaned_only',
      ghl: { action: 'none', detail: 'no_user_record' },
    };
  }

  // Step 1 — Stripe. Gates everything else.
  const stripeResult = await resolveStripeForDeletion(user);
  log(`stripe: ${JSON.stringify(stripeResult)}`);
  if (!stripeResult.ok) {
    log('STOPPED — Stripe not confirmed cancelled. Nothing was deleted. Needs manual review.');
    return { userId, stopped: true, stripe: stripeResult };
  }

  // Step 2 — our DB.
  await db.purgeUserData(userId);
  log('db: purged messages, profile, activity_days, users row');

  // Step 3 — GHL. Uses the `user` object captured before the purge, since the
  // DB row (and its ghl_contact_id) is now gone.
  const ghlResult = await resolveGhlForDeletion(user);
  log(`ghl: ${JSON.stringify(ghlResult)}`);

  log('done');
  return { userId, stopped: false, stripe: stripeResult, db: 'purged', ghl: ghlResult };
}

module.exports = { deleteUserIdentity };
