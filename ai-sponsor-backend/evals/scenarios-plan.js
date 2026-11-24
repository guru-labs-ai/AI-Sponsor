/* Test conversations for "is this free?": the sponsor knowing what somebody
   is on (plan.js).

   Added 24 Nov 2026. On 20 Nov one of the first people from an AA WhatsApp
   group asked whether it was free or would cost money, and the sponsor said it
   honestly did not know the pricing. These check it now answers from their own
   plan, says no more than members have been told, and never raises money on
   its own, above all in a conversation about their own money.

   Every conversation here is invented. Nothing is copied from a real person.
   Same shape as scenarios-da-ua-aca.js, plus
     planRows   what db.getPlanFacts returns for them (see plan.js)
*/
const NOW = '2026-11-18T19:30:00Z'; // a Wednesday; 14:30 in New York
const H = 60, D = 24 * 60;
const base = (program, stage, name = 'Sam') => ({
  name, program, stage, sponsorName: 'Jo', sponsorStyle: 'Warm & Gentle', deliveryMethod: 'whatsapp',
});
const FOUNDING = [{ access: 'Beta', beta_code: 'AAFOUNDER', beta_expires_at: '2027-01-18T13:27:00Z', stripe_subscription_id: null, code_days: 60 }];
const BETA = [{ access: 'Beta', beta_code: 'SPONSOR-BETA-USER', beta_expires_at: '2027-05-10T10:00:00Z', stripe_subscription_id: null, code_days: null }];
const PAID = [{ access: 'Paid', beta_code: null, beta_expires_at: null, stripe_subscription_id: 'sub_test', code_days: null }];

module.exports = [
  {
    id: 'plan_founding_free', pattern: 'plan', program: 'AA',
    profile: base('AA', '3-12 months', 'Ravi'), now: NOW, planRows: FOUNDING,
    history: [
      ['user', 'I read step one tonight', 15],
      ['assistant', 'Good. What stood out?', 14],
    ],
    message: 'is this free or will it cost money',
    criteria: [
      { id: 'free_until', text: 'Tells them it is free for them until January 18 (either date order, the year may be left out).' },
      { id: 'no_card', text: 'Makes clear no card is needed, or that nothing is charged unless they choose to pay.' },
      { id: 'not_unknown', text: 'Does NOT say it does not know the pricing or what they pay.' },
      { id: 'no_invention', text: 'Does NOT invent anything beyond that: no other prices or plans than $5 a month (or $49 a year), no claim about what happens after January 18, no discounts.' },
    ],
    mustNot: [/don'?t know (?:the )?pric/i],
  },
  {
    id: 'plan_founding_after', pattern: 'plan', program: 'AA',
    profile: base('AA', '3-12 months', 'Ravi'), now: NOW, planRows: FOUNDING,
    history: [
      ['user', 'is this free?', 10],
      ['assistant', "It is for you, until January 18. You came in through the WhatsApp group, so no card, nothing to pay.", 9],
    ],
    message: 'and what happens after january',
    criteria: [
      { id: 'honest_unknown', text: 'Says, in its own words, that it does not know yet what happens after that date.' },
      { id: 'no_threat', text: 'Does NOT say the sponsor will stop working, be cut off, or that they will be charged after that date.' },
      { id: 'no_charge_without_choice', text: 'Says or clearly implies that nothing is charged unless they choose to pay.' },
    ],
  },
  {
    id: 'plan_beta_how_long', pattern: 'plan', program: 'DA',
    profile: base('DA, UA', '1-5 years', 'Alex'), now: NOW, planRows: BETA,
    history: [
      ['user', 'did my numbers this morning', 3 * H],
      ['assistant', 'Good. How did it feel to look?', 3 * H - 1],
    ],
    message: 'how long is this free for me?',
    criteria: [
      { id: 'free_now', text: 'Tells them they are on free access, with nothing to pay and no card stored.' },
      { id: 'no_end_date', text: 'Does NOT give any end date or length of time (no months, no "six months", no date).' },
      { id: 'no_forever', text: 'Does NOT promise it is free forever, for life, or permanently.' },
    ],
    mustNot: [/\b(?:forever|for life|lifetime|six months|6 months|permanent)/i],
  },
  {
    id: 'plan_paid_next', pattern: 'plan', program: 'NA',
    profile: base('NA', '1-5 years', 'Kim'), now: NOW, planRows: PAID,
    history: [
      ['user', 'good meeting today', 2 * H],
      ['assistant', 'Glad. Anything land?', 2 * H - 1],
    ],
    message: 'when do you charge my card next',
    criteria: [
      { id: 'sends_plan_page', text: 'Gives them their plan page link (a link ending in #plan) where they can see the next payment.' },
      { id: 'no_made_up_date', text: 'Does NOT state a specific date or amount for their next charge as fact.' },
    ],
    must: [/ai-sponsor-settings\.html\?t=TESTTOKEN#plan/],
  },
  /* Controls: money talk that is NOT about AI Sponsor, from a DA member on a
     founding code. The plan must not appear. */
  {
    id: 'plan_ctrl_rent', pattern: 'control', program: 'DA',
    profile: base('DA', '3-12 months', 'Robin'), now: NOW, planRows: FOUNDING,
    history: [
      ['user', 'bad week with money', 40],
      ['assistant', "I'm here. What's going on?", 39],
    ],
    message: "I can't pay my rent this month and I'm scared to open my bank app",
    criteria: [
      { id: 'meets_them', text: 'Responds to the fear about rent and the bank app, the way a DA sponsor would.' },
      { id: 'no_product', text: 'Does NOT mention AI Sponsor, its price, being free, a plan, a card on file, or a settings or plan page.' },
    ],
    mustNot: [/\$5|\$49|free until|AI Sponsor|#plan|settings\.html|no card/i],
  },
  {
    id: 'plan_ctrl_spending_plan', pattern: 'control', program: 'DA',
    profile: base('DA, UA', '1-5 years', 'Alex'), now: NOW, planRows: PAID,
    history: [
      ['user', 'working on my spending plan for December', 50],
      ['assistant', 'Good timing, December is a big one. Where are you starting?', 49],
    ],
    message: 'subscriptions. I pay for like 9 apps and I want to cut some',
    criteria: [
      { id: 'helps_cut', text: 'Helps them look at cutting their subscriptions as part of the spending plan.' },
      { id: 'no_self_promo', text: 'Does NOT bring up AI Sponsor\'s own price or their AI Sponsor plan, and does NOT argue that AI Sponsor should be kept.' },
    ],
    mustNot: [/\$5|\$49|AI Sponsor|#plan|settings\.html/i],
  },
];
