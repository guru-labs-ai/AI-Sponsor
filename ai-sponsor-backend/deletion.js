/* ─── "Forget me" — full identity deletion (v1) ──────────────────────────────
   Spec agreed with Mariam in #ai-sponsor (Jul 2026):

   - SUPERSEDED, see "Orchestration" and "The sweep" below. This said admin-run
     only with no user-facing trigger, and both halves are now wrong: the
     settings page has had a Deactivate pane since Aug, and the sweep at the
     bottom of this file completes requests without anybody watching. Read the
     two sections at the end, not this list, for what actually happens.

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

   - Scope for v1: one identity per call. ALSO SUPERSEDED, Aug 11: link codes
     gave us the join key, and deleteUserIdentity now resolves every identity a
     person holds before it destroys any of them. Left here only because the
     gap was real and somebody reading old notes will come looking for it.

   - No scheduled auto-purge OF UNTOUCHED ACCOUNTS. Still true and still a
     deferred decision, waiting on a retention window from Matt. What IS
     scheduled now is the completion of requests people made themselves, which
     is a different thing: they asked, and the window only exists so they can
     take it back. See "The sweep".

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

/* ── Orchestration ──────────────────────────────────────────────────────────
   UPDATED AUG 11. The v1 note above says one identity per call, because when
   this was written a person's web and WhatsApp records had no join key and
   deleting one was the most anyone could do.

   That is no longer true, and leaving it would now be actively wrong. The
   website mirrors a registration onto wa-<E.164> so the sponsor knows them on
   WhatsApp, and link codes bind the two. Being two rows is the normal case, not
   an edge: two of the people in the database already are. Deleting one would
   leave the other holding their name, their programme and their reason for
   coming, which is not what "delete my data" means to the person asking.

   So every identity belonging to the person is resolved first, Stripe is
   confirmed for ALL of them before anything is destroyed, and each is then
   purged. Still idempotent, still stops rather than guesses. */
async function deleteUserIdentity(userId, { requestedBy } = {}) {
  if (!userId) throw new Error('userId required');
  if (!db.enabled) throw new Error('DB not configured — refusing to delete without the source of truth.');

  const log = (msg) => console.log(`[delete-user] ${userId}: ${msg}`);
  log(`starting (requested by ${requestedBy || 'unknown'})`);

  const identities = await db.findAllIdentities(userId);
  if (identities.length > 1) log(`this person holds ${identities.length} identities: ${identities.join(', ')}`);

  const users = [];
  for (const id of identities) {
    const u = await db.getUser(id);
    if (u) users.push(u);
  }

  if (!users.length) {
    // No users row anywhere — still worth purging in case messages or profile
    // rows exist without one (shouldn't normally happen, but don't assume).
    log('no users row found — purging any orphaned data anyway');
    await db.purgeUserData(userId);
    return {
      userId, identities, stopped: false,
      stripe: { ok: true, detail: 'no_user_record' },
      db: 'purged_orphaned_only',
      ghl: [{ action: 'none', detail: 'no_user_record' }],
    };
  }

  /* Step 1 — Stripe, for every identity, and BEFORE anything is destroyed.
     Checking them one at a time as we purge would risk deleting the first
     record and then stopping on a subscription found under the second, leaving
     the person half gone and still being billed. */
  for (const u of users) {
    const stripeResult = await resolveStripeForDeletion(u);
    log(`stripe (${u.user_id}): ${JSON.stringify(stripeResult)}`);
    if (!stripeResult.ok) {
      log('STOPPED — Stripe not confirmed cancelled. Nothing was deleted. Needs manual review.');
      return { userId, identities, stopped: true, stripe: stripeResult };
    }
  }

  // Step 2 — our DB, every identity.
  for (const id of identities) {
    await db.purgeUserData(id);
    log(`db: purged ${id}`);
  }

  /* Step 3 — GHL. Uses the user objects captured before the purge, since the
     rows and their ghl_contact_ids are now gone. Deduplicated, because the
     mirror deliberately copies one contact id onto both identities and deleting
     the same contact twice would report a spurious failure the second time. */
  const ghlResults = [];
  const seenContacts = new Set();
  for (const u of users) {
    if (u.ghl_contact_id && seenContacts.has(u.ghl_contact_id)) continue;
    if (u.ghl_contact_id) seenContacts.add(u.ghl_contact_id);
    const r = await resolveGhlForDeletion(u);
    log(`ghl (${u.user_id}): ${JSON.stringify(r)}`);
    ghlResults.push(r);
  }

  log('done');
  return { userId, identities, stopped: false, stripe: { ok: true }, db: 'purged', ghl: ghlResults };
}

/* ── The sweep ───────────────────────────────────────────────────────────────
   What closes the loop. Before this, a request raised a Slack ping and then
   waited on a human remembering: the person had been told "someone on the team
   will delete your data and confirm", and nothing in the system made that true.

   OFF UNLESS DELETION_SWEEP=on. Everything else in this product fails safe by
   doing nothing; this one destroys data, so it does not begin because a deploy
   happened. Somebody turns it on deliberately.

   Ordering that matters:

   1. The phone is read BEFORE the purge. Afterwards there is no users row to
      read it from, and the confirmation would have nowhere to go.
   2. The confirmation is sent AFTER the purge succeeds, never before. Telling
      somebody their data is gone and then stopping on a Stripe error would be
      a lie we cannot take back.
   3. A stopped deletion messages nobody and keeps its real id. deleteUserIdentity
      stops rather than guesses, and a human has to be able to find that row.

   Batched and claimed one at a time, same reasoning as the weekly sweep: a free
   instance must not run for minutes, and what this one does cannot be done
   twice. */
const SWEEP_ON = String(process.env.DELETION_SWEEP || '').toLowerCase() === 'on';

function confirmationText(theirName) {
  const hi = theirName ? `${theirName}, ` : '';
  return `${hi}this is done. Everything you told me has been deleted, and I do not have any of it any more.

If you ever want to start again, you can, and I will not know you from before. No need to reply to this one.`;
}

async function runDeletionSweep({ limit = 5, whatsapp = null, notify = null } = {}) {
  if (!SWEEP_ON) return { ok: false, reason: 'sweep-disabled' };
  if (!db.enabled) return { ok: false, reason: 'no-db' };

  await db.releaseStaleDeletions().catch((e) =>
    console.error('[delete-sweep] release stale failed:', e.message));

  const out = { considered: 0, completed: 0, stopped: 0, failed: 0 };

  for (let i = 0; i < limit; i++) {
    let row;
    try {
      row = await db.claimDueDeletion();
    } catch (e) {
      console.error('[delete-sweep] claim failed:', e.message);
      break;
    }
    if (!row) break;
    out.considered++;

    const userId = row.user_id;
    /* Read before destroying. wa- ids carry the number Meta itself told us the
       person writes from; users.phone is whatever they typed and is the
       fallback. Same rule as weekly delivery. */
    const user = (await db.getUser(userId).catch(() => null)) || {};
    const phone = (userId.startsWith('wa-') ? userId.slice(3) : '') ||
      String(user.phone || '').trim();
    const theirName = String(user.name || '').trim().split(/\s+/)[0];

    let result;
    try {
      result = await deleteUserIdentity(userId, { requestedBy: 'deletion-sweep' });
    } catch (err) {
      out.failed++;
      await db.markDeletionDone(userId, 'stopped', `threw: ${err.message}`).catch(() => {});
      if (notify) notify({ userId, status: 'failed', note: err.message }).catch(() => {});
      continue;
    }

    if (result.stopped) {
      out.stopped++;
      const note = (result.stripe && result.stripe.reason) || 'stopped, see logs';
      await db.markDeletionDone(userId, 'stopped', note).catch(() => {});
      if (notify) notify({ userId, status: 'stopped', note }).catch(() => {});
      continue;
    }

    out.completed++;
    await db.markDeletionDone(userId, 'completed', null).catch((e) =>
      console.error('[delete-sweep] mark completed failed:', e.message));

    /* Best effort, and deliberately after the row is closed. If the message
       fails the deletion still happened, and retrying it would mean keeping
       the number in order to try again, which is the opposite of the ask. */
    if (phone && whatsapp && whatsapp.sendTextReply) {
      try {
        await whatsapp.sendTextReply(`whatsapp:${phone}`, confirmationText(theirName));
      } catch (e) {
        console.warn(`[delete-sweep] confirmation not delivered to ${userId}: ${e.message}`);
      }
    }
    if (notify) notify({ userId, status: 'completed' }).catch(() => {});
  }

  if (out.considered) {
    console.log(`[delete-sweep] ${out.completed} completed, ${out.stopped} stopped, ${out.failed} failed`);
  }
  return { ok: true, ...out };
}

/* Piggybacked on ordinary traffic, exactly like weekly.js. Render spins this
   service down, so anybody talking to the sponsor is the most dependable
   scheduler the product has. Throttled so it never sits between a message and
   its reply. */
let lastSweep = 0;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

function maybeSweep(whatsapp, notify) {
  if (!SWEEP_ON || !db.enabled) return;
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  runDeletionSweep({ limit: 3, whatsapp, notify })
    .catch((e) => console.error('[delete-sweep] piggyback failed:', e.message));
}

module.exports = { deleteUserIdentity, runDeletionSweep, maybeSweep, enabled: SWEEP_ON };
