/* ─── "Your trial ends in three days" ─────────────────────────────────────────
   Stripe fires customer.subscription.trial_will_end three days out. Until now
   that only wrote a tag onto a GHL contact, so the only people who ever learned
   anything from it were us.

   Which is the actual problem, not a missing nicety. Somebody starts a 30-day
   trial, talks to their sponsor for one evening, and a month later $5 lands on
   their statement under a company name they have never seen. That is how a
   chargeback starts, and on a recovery product it is a rotten thing to do to
   someone besides.

   ⚠️ THE 24-HOUR WINDOW IS THE WHOLE DIFFICULTY, exactly as it was for the
   weekly review. WhatsApp only allows free-form text within 24 hours of the
   person's last message, and somebody three days from the end of a trial they
   have forgotten about is precisely the person who has not written in weeks. So
   the warm version goes to anyone still inside the window and everyone else
   gets the approved `trial_ending` template. Without that fallback this would
   pass every test and reach almost nobody in production.

   It speaks as the service and says so in its first line. The sponsor carries a
   name the person chose for it, sometimes the name of someone they trust, and
   that voice does not get used to ask them for money.

   Everything is injected rather than required at the top, because the half of
   this worth testing is the branching, and that half should not need a
   database, a Meta token or a live Express app to run. */

const TRIAL_ENDING_TEMPLATE = 'trial_ending';

/* Meta's own code for "outside the 24-hour window" is 131047. 63016 was
   Twilio's and is kept because the number only moved in August and an old error
   string in a retry queue should still be understood. */
const OUTSIDE_WINDOW = /63016|131047/;

/* "29 September". Deliberately no year: it is always within the next few days,
   and a year makes it read like a contract rather than a note. UTC because the
   server is, and guessing somebody's timezone to save four hours of accuracy is
   how you tell a person in California their trial ended yesterday. */
function formatTrialEnd(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/* Kept separate and pure so the wording can be read, and argued about, without
   running anything. */
function trialEndingBody({ first, when, link }) {
  const hi = first ? `${first}, ` : '';
  return (
    `${hi}quick note about your account, not a message from your sponsor.\n\n` +
    `Your free 30 days ends on ${when}, and the $5 a month plan starts then. ` +
    `If you would rather it did not, you can stop it here:\n\n${link}\n\n` +
    `Either way, nothing changes about how you talk to me today.`
  );
}

/* Returns true only if it actually sent. Every failure is swallowed and logged:
   this is already the fallback path and there is nothing further to fall back
   to. A person not hearing from us is bad, but it is the summary page and the
   Stripe email that carry the fact, not this. */
async function sendTemplate({ metacloud, phone, first, when, token }) {
  /* Lazily required rather than imported at the top, the same way weekly.js
     does it, so this module stays loadable on a box with no Meta credentials
     and the tests can hand it a stub instead. */
  let mc = metacloud;
  if (!mc) { try { mc = require('./metacloud'); } catch { return false; } }
  if (!mc.enabled || !mc.sendTemplate) return false;
  try {
    /* Meta rejects an empty variable and plenty of people never gave a name, so
       it falls back to what a sponsor would say out loud. */
    await metacloud.sendTemplate(
      `whatsapp:${phone}`,
      TRIAL_ENDING_TEMPLATE,
      [String(first || '').trim() || 'there', when],
      `${token}#plan`
    );
    return true;
  } catch (err) {
    console.warn(`[trial-ending] template failed: ${err.message}`);
    return false;
  }
}

async function notifyTrialEnding({ user, trialEndUnix, db, whatsapp, metacloud, siteUrl }) {
  if (!user || !whatsapp || !db) return { sent: false, reason: 'not-configured' };

  /* wa- ids carry the number WhatsApp itself told us about, which beats
     whatever got typed into a registration form. Same order weekly.js uses, and
     it matters here because the Stripe event names the reg- row, not the wa-
     one, so the fallback is the path that actually runs. */
  const uid = String(user.user_id || '');
  const phone = (uid.startsWith('wa-') ? uid.slice(3) : '') || String(user.phone || '').trim();
  if (!phone) return { sent: false, reason: 'no-phone' };

  /* A billing message with no date in it is worse than no message at all, so an
     event arriving without trial_end is logged and dropped rather than guessed. */
  const when = formatTrialEnd(trialEndUnix);
  if (!when) {
    console.warn(`[trial-ending] ${uid} has no trial_end on the event, not sending`);
    return { sent: false, reason: 'no-trial-end' };
  }

  /* Stripe retries this webhook with backoff for ~3 days whenever anything
     downstream of it throws, so without a guard one failed GHL call turns into
     a second copy of a billing message. Keyed on the trial end date rather than
     on the event, so a genuinely new trial later still gets its own notice. */
  const key = String(trialEndUnix);
  const already = (await db.getEvents(uid, 20).catch(() => []))
    .some((e) => e.event === 'trial_ending_notified' && String((e.detail || {}).trialEnd || '') === key);
  if (already) return { sent: false, reason: 'already-sent' };

  const token = await db.getOrCreateSettingsToken(uid).catch(() => null);
  if (!token) return { sent: false, reason: 'no-token' };

  const first = String(user.name || '').trim().split(/\s+/)[0];
  const link = `${siteUrl}/ai-sponsor-settings.html?t=${token}#plan`;
  const body = trialEndingBody({ first, when, link });

  const mark = (via) =>
    db.recordEvent(uid, 'trial_ending_notified', { trialEnd: key, via }, 'stripe').catch(() => {});

  try {
    await whatsapp.sendTextReply(`whatsapp:${phone}`, body);
    await mark('text');
    return { sent: true, via: 'text' };
  } catch (e) {
    const outside = OUTSIDE_WINDOW.test(e.message || '');
    if (outside && await sendTemplate({ metacloud, phone, first, when, token })) {
      await mark('template');
      return { sent: true, via: 'template' };
    }
    console.warn(`[trial-ending] delivery to ${uid} failed${outside ? ' (outside 24h window)' : ''}: ${e.message}`);
    await db.recordEvent(uid, 'trial_ending_notify_failed', {
      trialEnd: key, reason: outside ? 'outside-24h' : String(e.message).slice(0, 200),
    }, 'stripe').catch(() => {});
    return { sent: false, reason: outside ? 'outside-24h' : 'send-failed' };
  }
}

module.exports = { notifyTrialEnding, formatTrialEnd, trialEndingBody, TRIAL_ENDING_TEMPLATE };
