/* ─── Who still has access ───────────────────────────────────────────────────
   Until now `access` was written and never read. A cancellation set somebody to
   Unpaid in our database and in GoHighLevel, and their sponsor carried on
   answering exactly as before, because nothing anywhere checked. Same for
   `beta_expires_at`: the six months Matt promised is recorded and enforced by
   nothing.

   ⛔ THE TRAP, AND WHY THIS RULE IS SHAPED THE WAY IT IS. "Unpaid" does not
   mean "did not pay". `whatsapp.js` stamps every brand new WhatsApp arrival
   Unpaid, because a phone number on its own tells us nothing about who they
   are. Run naively against the live database on 7 Sep 2026, a rule that blocks
   Unpaid would have cut off four people, three of them active that week and one
   of them mid-conversation that day, none of whom had ever cancelled anything.
   Nobody would have been blocked for actually lapsing, because nobody has.

   So this blocks only on positive evidence that access ENDED:

     · they had a subscription, it is over, and no identity is on beta
     · or they are on beta and the date on that beta has passed

   Everything else passes, including every unknown. On a product somebody talks
   to at 3am, the cost of wrongly staying open is that one person gets something
   free. The cost of wrongly closing is that somebody in trouble reaches for the
   one thing that answers and finds it gone. Those are not comparable, so this
   fails open, always, including when the database itself is unreachable.

   Off unless ACCESS_ENFORCEMENT=on. The switch exists because this is the first
   thing in the product that can take something away from somebody, and it
   should be turnable off in one action without a deploy.
──────────────────────────────────────────────────────────────────────────── */

const ON = String(process.env.ACCESS_ENFORCEMENT || '').toLowerCase() === 'on';

/* One a day at most. Somebody who writes six times in an evening is not told
   six times that their access has ended, which would read as nagging somebody
   who is already having a hard night. */
const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;

function bestAccess(rows) {
  const values = rows.map((r) => String((r && r.access) || '').trim()).filter(Boolean);
  if (values.includes('Beta')) return 'Beta';
  if (values.includes('Paid')) return 'Paid';
  if (values.includes('Unpaid')) return 'Unpaid';
  return '';
}

/* Returns { allowed, reason }. `allowed` is the only field callers should
   branch on, and it is true whenever we are not certain. */
async function accessState(userId, { db, now = new Date() } = {}) {
  if (!ON) return { allowed: true, reason: 'enforcement-off' };
  if (!db || !db.enabled || !userId) return { allowed: true, reason: 'no-db' };

  let rows = [];
  try {
    const ids = await db.findAllIdentities(userId);
    for (const id of ids) {
      const u = await db.getUser(id);
      if (u) rows.push(u);
    }
  } catch (err) {
    console.warn(`[access] could not read ${userId}, letting them through: ${err.message}`);
    return { allowed: true, reason: 'lookup-failed' };
  }
  if (!rows.length) return { allowed: true, reason: 'no-record' };

  const access = bestAccess(rows);

  if (access === 'Beta') {
    const ends = rows.map((r) => r.beta_expires_at).filter(Boolean)
      .map((d) => new Date(d)).sort((a, b) => b - a)[0];
    if (ends && ends < now) return { allowed: false, reason: 'beta-expired', on: ends };
    return { allowed: true, reason: 'beta' };
  }

  /* The distinction the whole rule turns on. Unpaid with a subscription on file
     is somebody whose subscription ended. Unpaid with none is somebody who
     arrived on WhatsApp and never registered, which is not a lapse. */
  if (access === 'Unpaid') {
    const everHadOne = rows.some((r) => r.stripe_subscription_id);
    if (everHadOne) return { allowed: false, reason: 'subscription-ended' };
    return { allowed: true, reason: 'never-registered' };
  }

  return { allowed: true, reason: access ? 'paid' : 'unknown' };
}

/* Not silence. Somebody writing to their sponsor and getting nothing back is
   the worst version of this, and it is what a naive gate does. They get one
   short message that says the sponsor is paused rather than gone, that what
   they have said is still here, and how to come back. */
function pausedText({ first, reason, link }) {
  const hi = first ? `${first}, ` : '';
  const why = reason === 'beta-expired'
    ? 'Your free access has come to an end'
    : 'Your subscription has ended';
  return (
    `${hi}quick note about your account, not a message from your sponsor.\n\n` +
    `${why}, so your sponsor is paused rather than gone. Everything you have told me is still here, exactly as it was.\n\n` +
    (link
      ? `You can start it again here whenever you want:\n\n${link}\n\nIf now is a bad moment, reply to this and a person will help.`
      : 'Reply to this message and a person will help you start it again.')
  );
}

/* True when we have already said this to them today. Read off account_events so
   it survives a restart, the same way the notices dedupe does. */
async function toldRecently(userId, { db, now = new Date() } = {}) {
  try {
    const events = await db.getEvents(userId, 10);
    const last = (events || []).find((e) => e.event === 'access_paused_notice');
    if (!last) return false;
    return (now - new Date(last.created_at)) < REMIND_EVERY_MS;
  } catch {
    // Cannot tell: say nothing rather than risk repeating it.
    return true;
  }
}

module.exports = { accessState, pausedText, toldRecently, enabled: ON, REMIND_EVERY_MS };
