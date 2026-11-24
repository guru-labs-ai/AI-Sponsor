/* ─── What the sponsor knows about somebody's plan ────────────────────────────
   21 Nov review of the first AA WhatsApp group sign-ups: one of them asked "is
   this free or will it cost money" and the sponsor said "I honestly don't know
   the pricing". Nothing in its prompt said anything about plans or prices. On
   24 Nov Mariam said "we need this yes".

   Every line here repeats something a member can already read, so the sponsor
   never says more than the product has promised:
     · founding-member codes (AAFOUNDER, NAFOUNDER): the plan_question_free_until
       message Mariam approved on 21 Nov, "free until <date>. No card is needed.
       The regular price is $5 a month, but nothing is ever charged unless you
       choose to pay."
     · every other beta member: the plan pane of the settings page, "You are on
       free access. There is nothing to pay, no card is stored, and nothing will
       ever be taken from you." The six months stamped in beta_expires_at is
       NEVER said (Mariam, 3 Sep: off every surface a member can see), and
       neither is "forever": that is Matt's to promise, not the sponsor's.
     · paid plans: stripe.js, $5 a month or $49 a year, both opening with 30 days
       free. Their own date and amount are only on their plan page, so the
       sponsor sends the link rather than guessing.

   What happens when a founding code's free time ends is NOT decided (Matt, the
   day-60 thread, 19-20 Nov). The sponsor says it does not know yet, and never
   that it will stop or that they will be charged.

   Pure: rows in, lines out. db.getPlanFacts reads the rows. */

const PRICE_LINE = '$5 a month or $49 a year, and both start with 30 days free';

function bestAccess(rows) {
  const values = rows.map((r) => String((r && r.access) || '').trim());
  if (values.includes('Beta')) return 'Beta';
  if (values.includes('Paid')) return 'Paid';
  if (values.includes('Unpaid')) return 'Unpaid';
  return '';
}

/* "January 18": American order, like the Sunday summary (Mariam, 24 Nov:
   American English everywhere). A founding code runs 60 days, so the year is
   never in doubt. The day it ends in UTC, the same way the settings page
   prints plan dates, so the two never disagree by a day. */
function dayOf(d) {
  const t = new Date(d);
  if (isNaN(t)) return null;
  return t.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/* What they are on. One of:
     { kind: 'founding', until }   a code with its own length, e.g. AAFOUNDER
     { kind: 'beta' }              free access, no date ever given
     { kind: 'paid' }
     { kind: 'ended' }             had a subscription, it is over
     { kind: 'none' }              nothing on file (a WhatsApp-only arrival)
   Beta first, the same order access.js uses: somebody moved back to free
   access after cancelling is on free access. */
function planOf(rows, now = new Date()) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  const access = bestAccess(list);
  if (access === 'Beta') {
    const timed = list.filter((r) => r.beta_code && r.code_days && r.beta_expires_at)
      .map((r) => new Date(r.beta_expires_at)).filter((d) => !isNaN(d)).sort((a, b) => b - a)[0];
    if (timed && timed > now) return { kind: 'founding', until: dayOf(timed) };
    return { kind: 'beta' };
  }
  if (access === 'Paid') return { kind: 'paid' };
  if (list.some((r) => r.stripe_subscription_id)) return { kind: 'ended' };
  return { kind: 'none' };
}

/* The lines that go into the settings block. `planLink` is their own settings
   page opened at the plan section. Empty when there is nothing to say. */
function planLines(plan, planLink) {
  if (!plan) return [];
  const facts = {
    founding: [
      `- They joined through the WhatsApp group with a founding-member code, so AI Sponsor is free for them until ${plan.until}. No card is needed and none is stored.`,
      `- Give them the whole date, the day and the month (${plan.until}), never only the month.`,
      '- The regular price is $5 a month, but nothing is ever charged unless they choose to pay.',
      `- Say $5 a month as the regular price, never as what they will pay after ${plan.until}: you do not know that.`,
      `- If they ask what happens after ${plan.until}: you do not know yet. Say that simply, and that nothing is charged unless they choose to pay. Never guess, and never say it will stop working or that they will be charged.`,
    ],
    beta: [
      '- They are on free access as a founding beta member: there is nothing to pay, no card is stored, and nothing will ever be taken from them.',
      '- Never give an end date or a length of time, and never say "forever" or "for life". If they ask how long it lasts, be honest that you do not know, without making it sound either permanent or about to end, and that nothing is taken unless they choose to pay.',
      `- If they ask what it costs other people: ${PRICE_LINE}.`,
    ],
    paid: [
      `- They have a paid plan. The plans are ${PRICE_LINE}.`,
      `- Which one they are on, when the next payment is, and the button to stop paying are on their plan page: ${planLink}. You cannot see their date or amount, so never guess them: send the link.`,
    ],
    ended: [
      `- They had a paid plan and it has ended, so nothing more is being taken from their card. Their plan page shows it: ${planLink}.`,
      `- If they want to come back, or ask about a charge, a person can help them through that same page. The plans are ${PRICE_LINE}.`,
    ],
    none: [
      `- There is no plan on file for them. If they ask what it costs: ${PRICE_LINE}.`,
      '- Do not tell them what they personally owe or that it is free for them. For anything about their own account, a person can help through their settings page.',
    ],
  }[plan.kind];
  if (!facts) return [];
  return [
    '',
    'WHAT THEY ARE ON WITH AI SPONSOR. Only for when they ask about AI Sponsor itself: whether it is free, what it costs, how long it stays free, a card, paying, their plan, stopping it. Never bring any of this up yourself. Their own money (debts, bills, rent, spending, a spending plan) is not a question about AI Sponsor, and this does not exist then.',
    ...facts,
    'Answer it in a line or two, in your own words, then go back to whatever they were talking about. Charges, refunds and account problems are for a person, through their settings page: you cannot see or change payments.',
  ];
}

module.exports = { planOf, planLines, PRICE_LINE };
