/* Exercises the trial-ending notice without a database, a Meta token or a
   running server.

   The branching is the whole risk here. The message itself is three sentences,
   but it has to reach somebody who has not opened WhatsApp in a month, and the
   path that carries it to them is the fallback rather than the obvious one. So
   the cases that matter are the failures: outside the 24-hour window, a Stripe
   retry arriving twice, an event with no date on it.

   Run: node test-trial-ending.js */
const t = require('./trialnotice');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${e}\n      actual:   ${a}`);
  ok ? pass++ : fail++;
}
function ok(name, cond) { check(name, !!cond, true); }

/* ── The date ─────────────────────────────────────────────────────────────── */

// Lindsay's real trial end, the first one this code will ever run against.
check('formats a trial end as a plain day and month',
  t.formatTrialEnd(Date.UTC(2026, 8, 29, 3, 49) / 1000), '29 September');

check('a missing trial end is null, never a guess', t.formatTrialEnd(null), null);
check('zero is treated as missing, not as 1970', t.formatTrialEnd(0), null);

/* Late-UTC times are where a timezone slip would show: 23:30 UTC on the 29th is
   already the 30th in Sydney and still the 29th for us. The date we promise has
   to be the date Stripe charges on, which is UTC. */
check('a late-evening UTC trial end keeps its own date',
  t.formatTrialEnd(Date.UTC(2026, 8, 29, 23, 30) / 1000), '29 September');

/* ── The wording ──────────────────────────────────────────────────────────── */

const body = t.trialEndingBody({ first: 'Lindsay', when: '29 September', link: 'https://x/y?t=abc#plan' });
ok('opens with their name', body.startsWith('Lindsay, '));
ok('says plainly it is not the sponsor talking', /not a message from your sponsor/.test(body));
ok('names the date the money moves', body.includes('29 September'));
ok('names the price', body.includes('$5 a month'));
ok('carries the link that can stop it', body.includes('https://x/y?t=abc#plan'));
ok('does not pressure them to stay', !/don't miss|act now|hurry|last chance/i.test(body));

const noName = t.trialEndingBody({ first: '', when: '29 September', link: 'https://x' });
ok('somebody who never gave a name still gets a clean sentence',
  noName.startsWith('quick note about your account'));

/* ── Delivery ─────────────────────────────────────────────────────────────── */

const stubDb = (events = []) => ({
  getEvents: async () => events,
  getOrCreateSettingsToken: async () => 'tok123',
  recordEvent: async (uid, event, detail) => { events.push({ event, detail }); },
});
const sender = (err) => {
  const calls = [];
  return {
    calls,
    sendTextReply: async (to, text) => {
      calls.push({ to, text });
      if (err) throw new Error(err);
    },
  };
};
const templater = (works = true) => {
  const calls = [];
  return {
    calls,
    enabled: true,
    sendTemplate: async (to, name, params, urlParam) => {
      calls.push({ to, name, params, urlParam });
      if (!works) throw new Error('template rejected');
      return { messageId: 'wamid.x' };
    },
  };
};

const base = { user: { user_id: 'reg-abc', name: 'Lindsay Jacobi', phone: '+19739780447' },
  trialEndUnix: Date.UTC(2026, 8, 29, 3, 49) / 1000, siteUrl: 'https://getaisponsor.com' };

(async () => {
  // Inside the 24-hour window: the warm version, no template.
  {
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(), whatsapp, metacloud });
    check('inside the window it sends free text', r, { sent: true, via: 'text' });
    check('and sends it to the registration phone', whatsapp.calls[0].to, 'whatsapp:+19739780447');
    check('and never touches the template', metacloud.calls.length, 0);
  }

  // Outside it, which is the case that actually matters.
  {
    const whatsapp = sender('Meta error 131047: outside window'), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(), whatsapp, metacloud });
    check('outside the window it falls back to the template', r, { sent: true, via: 'template' });
    check('the template is the approved name', metacloud.calls[0].name, 'trial_ending');
    check('with their first name and the date as the two variables',
      metacloud.calls[0].params, ['Lindsay', '29 September']);
    check('and their own settings token on the button',
      metacloud.calls[0].urlParam, 'tok123#plan');
  }

  // Twilio's old code for the same thing, still understood.
  {
    const whatsapp = sender('63016 outside window'), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(), whatsapp, metacloud });
    check("Twilio's old window code still routes to the template", r, { sent: true, via: 'template' });
  }

  // A send failure that is NOT the window must not spend a template on itself.
  {
    const whatsapp = sender('connection reset'), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(), whatsapp, metacloud });
    check('an unrelated failure reports itself as one', r, { sent: false, reason: 'send-failed' });
    check('and does not fall back to the template', metacloud.calls.length, 0);
  }

  // Both paths gone.
  {
    const whatsapp = sender('131047'), metacloud = templater(false);
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(), whatsapp, metacloud });
    check('when the template fails too it says which wall it hit',
      r, { sent: false, reason: 'outside-24h' });
  }

  /* Stripe retries this webhook for ~3 days if anything downstream throws. A
     second copy of a billing message is the one failure here a person would
     actually notice. */
  {
    const events = [{ event: 'trial_ending_notified', detail: { trialEnd: String(base.trialEndUnix), via: 'text' } }];
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(events), whatsapp, metacloud });
    check('a Stripe retry does not send it twice', r, { sent: false, reason: 'already-sent' });
    check('and sends nothing at all', whatsapp.calls.length + metacloud.calls.length, 0);
  }

  // A different trial end is a different notice, not a duplicate.
  {
    const events = [{ event: 'trial_ending_notified', detail: { trialEnd: '111', via: 'text' } }];
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(events), whatsapp, metacloud });
    check('a later trial gets its own notice', r, { sent: true, via: 'text' });
  }

  // The wa- row carries the number in its id.
  {
    const whatsapp = sender(), metacloud = templater();
    await t.notifyTrialEnding({
      ...base, user: { user_id: 'wa-+19739780447', name: 'Lindsay' },
      db: stubDb(), whatsapp, metacloud,
    });
    check('a wa- id is trusted over anything typed into a form',
      whatsapp.calls[0].to, 'whatsapp:+19739780447');
  }

  // Nothing to send to, and nothing to say.
  {
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({
      ...base, user: { user_id: 'reg-abc', name: 'X' }, db: stubDb(), whatsapp, metacloud });
    check('no phone means no send', r, { sent: false, reason: 'no-phone' });
  }
  {
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, trialEndUnix: null, db: stubDb(), whatsapp, metacloud });
    check('an event with no date sends nothing rather than guessing',
      r, { sent: false, reason: 'no-trial-end' });
    check('and stays silent on both channels', whatsapp.calls.length + metacloud.calls.length, 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
