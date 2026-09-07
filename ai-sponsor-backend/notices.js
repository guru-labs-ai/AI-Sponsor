/* ─── Account notices ────────────────────────────────────────────────────────
   Telling somebody what happened to their account, on the only channel we
   actually own.

   Why this exists, in one story. On 2 September somebody registered on the paid
   route because she was a beta member who had not been given her code yet. Nine
   minutes later she asked for her account to be deleted. An hour after that
   somebody on the team moved her to Beta and cancelled the trial, which was the
   right call. Nobody told her any of it. Four days later she wrote in asking us
   to cancel a subscription that had not existed since the day she signed up.

   Everything in that story was recorded: `account_events` has the move, Stripe
   has the cancellation, `deletion_requests` has the date. The only missing
   piece was a sentence sent to the person it happened to. This module is that
   sentence, and it is deliberately one module rather than a line bolted onto
   each caller, so the next thing we build cannot forget to send one.

   SCOPE, Mariam's call 7 Sep: this covers the moment somebody asks to be let
   go, and nothing else. Beta or paying only changes whether there is a card
   sentence to write. Both say the same four things: we have the request, the
   billing stopped the moment they asked, nothing has been removed yet and the
   sponsor still works, and they can call the whole thing off until the date.

   ⛔ DO NOT WRITE "that is everything switched off" OR "your access has ended".
   Both were in the first version and both were false. Asking to be deleted
   revokes nothing: the settings page says "nothing has been removed and your
   sponsor still works", the Privacy Policy promises the same, and the window
   exists precisely so a request made in a bad moment is not irreversible.
   Telling somebody their sponsor is gone when it is not is the cruellest
   possible way to be inaccurate on this product.

   Both give them two ways to take it back: their settings link, which does it
   themselves in one tap, and a reply, which reaches us. The link matters most
   for the people this is written for. Somebody who has already decided to leave
   should not have to compose a sentence to undo it.

   ⚠️ EMAIL IS NOT AN OPTION AND WILL NOT BE SOON. getaisponsor.com has
   receive-only MX, no DKIM and no DMARC, so a first send to a Gmail address
   arrives unauthenticated. WhatsApp is the channel these people chose and the
   only one that reaches them today.

   THE 24-HOUR WINDOW IS THE WHOLE DIFFICULTY, exactly as it was for the weekly
   review and the trial notice. Free-form text only reaches somebody who wrote
   to us in the last day, and the person who most needs an account notice is
   precisely the one who has not written in weeks. So every notice here has two
   forms: the warm one, and an approved template for everyone outside the
   window. A notice with no template is a notice that reaches nobody.

   The shape is lifted from trialnotice.js on purpose, including its trick of
   not asking whether the window is open. Meta is the only thing that knows, so
   we send, and treat 131047 coming back as the answer.
──────────────────────────────────────────────────────────────────────────── */

/* Meta's code for "outside the 24-hour window" is 131047. 63016 was Twilio's
   and is kept for the same reason trialnotice.js keeps it: the number only
   moved in August and an old error string should still be understood. */
const OUTSIDE_WINDOW = /63016|131047/;

/* "9 September". No year, same reasoning as the trial notice: these dates are
   always days away, and a year makes a note read like a contract. */
function formatDay(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/* Every notice opens by saying it is not the sponsor talking. The sponsor
   carries a name the person chose for it, sometimes the name of someone they
   trust, and that voice does not get used for billing. Same opener as the
   trial notice so the two read as coming from the same place. */
function opener(first) {
  return `${first ? `${first}, ` : ''}quick note about your account, not a message from your sponsor.`;
}

/* ─── The catalogue ──────────────────────────────────────────────────────────
   Kept as pure functions so the wording can be read, and argued about, without
   a database, a Meta token or a running server. Each entry is:

     body          what somebody inside the 24-hour window reads
     template      the approved template name for everyone else
     templateText  that template's exact approved body, kept here so the code
                   and what Meta holds cannot drift apart unnoticed
     buttonText    the label on the template's URL button, which carries the
                   settings link a template body cannot hold inline

   ⚠️ CHANGING APPROVED WORDING: edit the template through Meta's API, do not
   delete and recreate it. Meta refuses a new template under a name whose old
   version is still being deleted ("Message template language is being
   deleted"), and the deletion is not quick. That is why these carry _v2: the
   first pair had to be abandoned mid-fix.
     params        the variables that template takes, in order

   The template says less than the body on purpose. Meta approves a fixed shape
   once, so it has to hold for every person it is ever sent to, while the body
   can use what we know about this one.
──────────────────────────────────────────────────────────────────────────── */
const NOTICES = {
  /* Somebody on free beta access asking to be let go. No card was ever
     involved, so the only thing to say is what happens to what they told us,
     and by when they can still take it back. */
  leaving_beta: {
    template: 'leaving_beta_v2',
    templateText:
      'Hi {{1}}, a quick note about your account, not a message from your sponsor. '
      + 'We have your request to delete your account and everything in it, and it will be done on {{2}}. '
      + 'Nothing has been removed yet and your sponsor keeps working exactly as before until then. '
      + 'You can stop it with the button below, or by replying here, any time before that date.',
    buttonText: 'Keep my account',
    params: ({ first, when }) => [first || 'there', when],
    body: ({ first, when, link }) =>
      `${opener(first)}

` +
      `We have your request to delete your account and everything in it. It will be done on ${when}.

` +
      'Nothing has been removed yet, and your sponsor keeps working exactly as before until then. ' +
      /* No link is better than a broken one: if the token could not be minted
         the reply still works, so the message says that instead of printing a
         dead url at somebody who is already leaving. */
      (link
        ? `You can stop it yourself here, any time before that date:

${link}

` +
          'Or just reply to this message and we will do it for you. Either way you will not have lost anything.'
        : 'Just reply to this message any time before that date and we will stop it, and you will not have lost anything.'),
  },

  /* The same thing for somebody who gave us a card. The billing sentence comes
     first because it is the one they are worried about: "will I be charged
     again" is a different question from "what happens to what I told you", and
     a message that only answers the second reads as dodging the first. */
  leaving_paid: {
    template: 'leaving_paid_v2',
    templateText:
      'Hi {{1}}, a quick note about your account, not a message from your sponsor. '
      + 'Your subscription is cancelled straight away, so nothing more will be taken from your card. '
      + 'We also have your request to delete your account and everything in it, and it will be done on {{2}}. '
      + 'Nothing has been removed yet and your sponsor keeps working exactly as before until then. '
      + 'You can stop it with the button below, or by replying here, any time before that date.',
    buttonText: 'Keep my account',
    params: ({ first, when }) => [first || 'there', when],
    body: ({ first, when, link }) =>
      `${opener(first)}

` +
      'Your subscription is cancelled straight away, so nothing more will be taken from your card. ' +
      `We also have your request to delete your account and everything in it, and that will be done on ${when}.

` +
      'Nothing has been removed yet, and your sponsor keeps working exactly as before until then. ' +
      /* No link is better than a broken one: if the token could not be minted
         the reply still works, so the message says that instead of printing a
         dead url at somebody who is already leaving. */
      (link
        ? `You can stop it yourself here, any time before that date:

${link}

` +
          'Or just reply to this message and we will do it for you. Either way you will not have lost anything.'
        : 'Just reply to this message any time before that date and we will stop it, and you will not have lost anything.'),
  },
};

/* The number Meta told us about beats the one somebody typed into a form, so a
   wa- id wins over users.phone. Same order weekly.js and the deletion sweep
   use, and it matters here because a Stripe event names the reg- row. */
function phoneFor(user) {
  const uid = String((user && user.user_id) || '');
  return (uid.startsWith('wa-') ? uid.slice(3) : '') || String((user && user.phone) || '').trim();
}

/* ─── Sending one ────────────────────────────────────────────────────────────
   Returns { sent, via } or { sent:false, reason }, and never throws: a notice
   failing must not take down the cancellation, deletion or webhook that caused
   it. Everything that happens is written to account_events, so "did she get
   told" is answerable with a row rather than a memory.

   `key` makes it idempotent. Stripe retries a failing webhook for about three
   days, and without a guard one failed GHL call downstream turns into a second
   copy of a billing message. Pass something stable for the thing that happened
   (a subscription id, a deletion date); the same kind with a different key is a
   genuinely new event and gets its own notice.
──────────────────────────────────────────────────────────────────────────── */
async function sendNotice({
  user, kind, params = {}, key = null,
  db, whatsapp, metacloud, source = 'notices',
}) {
  const spec = NOTICES[kind];
  if (!spec) throw new Error(`unknown notice "${kind}"`);
  if (!user || !db || !whatsapp) return { sent: false, reason: 'not-configured' };

  const uid = String(user.user_id || '');
  const phone = phoneFor(user);
  if (!phone) return { sent: false, reason: 'no-phone' };

  const dedupeKey = key === null ? null : String(key);
  if (dedupeKey) {
    const already = (await db.getEvents(uid, 30).catch(() => []))
      .some((e) => e.event === 'notice_sent'
        && (e.detail || {}).kind === kind
        && String((e.detail || {}).key || '') === dedupeKey);
    if (already) return { sent: false, reason: 'already-sent' };
  }

  const first = String(user.name || '').trim().split(/\s+/)[0];
  const filled = Object.assign({ first }, params);
  const mark = (via) =>
    db.recordEvent(uid, 'notice_sent', { kind, key: dedupeKey, via }, source).catch(() => {});

  try {
    await whatsapp.sendTextReply(`whatsapp:${phone}`, spec.body(filled));
    await mark('text');
    return { sent: true, via: 'text' };
  } catch (err) {
    const outside = OUTSIDE_WINDOW.test(err.message || '');
    if (outside && await sendViaTemplate({ metacloud, phone, spec, filled })) {
      await mark('template');
      return { sent: true, via: 'template' };
    }
    console.warn(`[notice] ${kind} to ${uid} failed${outside ? ' (outside 24h window)' : ''}: ${err.message}`);
    await db.recordEvent(uid, 'notice_failed', {
      kind, key: dedupeKey,
      reason: outside ? 'outside-24h' : String(err.message).slice(0, 200),
    }, source).catch(() => {});
    return { sent: false, reason: outside ? 'outside-24h' : 'send-failed' };
  }
}

/* Lazily required rather than imported at the top, the same way weekly.js and
   trialnotice.js do it, so this module stays loadable on a box with no Meta
   credentials and the tests can hand it a stub. */
async function sendViaTemplate({ metacloud, phone, spec, filled }) {
  let mc = metacloud;
  if (!mc) { try { mc = require('./metacloud'); } catch { return false; } }
  if (!mc.enabled || !mc.sendTemplate) return false;
  try {
    // Meta rejects an empty variable, and plenty of people never gave a name.
    const params = spec.params(filled).map((v) => String(v == null ? '' : v).trim() || 'there');
    /* A template body cannot carry a URL inline, so the settings link rides the
       template's own button. The suffix is everything after ?t= in the approved
       url, which is how trial_ending already does it. */
    await mc.sendTemplate(`whatsapp:${phone}`, spec.template, params, filled.linkSuffix || null);
    return true;
  } catch (err) {
    console.warn(`[notice] template ${spec.template} failed: ${err.message}`);
    return false;
  }
}

module.exports = { sendNotice, NOTICES, formatDay, opener };
