/* Tests the weekly note: writes notes for invented weeks through the real
   ensureWeeklySummary path (no database, nothing sent) and grades them.

   Usage (from ai-sponsor-backend):
     ANTHROPIC_API_KEY=... WEEKLY_MODEL=claude-sonnet-5 node evals/run-weekly-eval.js --label x [--runs 3]

   WEEKLY_MODEL should match Render (claude-sonnet-5 as of 14 Nov 2026). */
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'weekly');
const RUNS = +arg('runs', 3);
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY is required'); process.exit(1); }
for (const k of Object.keys(process.env)) {
  if (/SLACK|DATABASE|GHL|STRIPE|META|TWILIO|OPENAI|XAI|FIELD|RENDER|SWEEP|CHECKIN/.test(k)) delete process.env[k];
}
process.env.ANTHROPIC_API_KEY = KEY;

const BACKEND = path.resolve(__dirname, '..');
const db = require(path.join(BACKEND, 'db.js'));
let CURRENT = null, SAVED = null;
db.enabled = true;
db.getWeeklySummary = async () => null;
db.getWeekActivity = async () => ({ messages: CURRENT.rows.length, readable: CURRENT.rows.length, activeDays: CURRENT.activeDays, days: [] });
db.getProfile = async () => ({ name: 'Sam', sponsorName: 'Jo', program: CURRENT.program });
db.getUser = async () => ({ name: 'Sam' });
db.getWeekMessages = async () => CURRENT.rows;
db.getMemory = async () => null;
db.getEvents = async () => [];
db.saveWeeklySummary = async (uid, s, e, payload) => { SAVED = payload; return true; };
const weekly = require(path.join(BACKEND, 'weekly.js'));

const Anthropic = require('@anthropic-ai/sdk');
const judgeClient = new Anthropic({ apiKey: KEY });
// Tallied as testing and filed on the dashboard at the end (spend-report.js).
const testSpend = require('./spend-report').start(BACKEND, LABEL, judgeClient);

const t = (pairs) => pairs.map(([role, content]) => ({ role, content }));
const WEEK = { start: '2026-11-01', end: '2026-11-07' };

/* Invented weeks. W1 has the shape of the week that went wrong on 1 Nov. */
const SCENARIOS = [
  {
    id: 'note_after_correction', program: 'UA, WA', activeDays: 1,
    rows: t([
      ['user', "I'm feeling sad and a bit depressed"],
      ['assistant', 'That tracks after a night like this one. The sad might just be the grip finally loosening.'],
      ['user', "It's not the same night. It's weeks later."],
      ['assistant', "Thank you for the correction. Weeks, not one night. So it's weeks of carrying it."],
      ['user', "I think it's because I'm not working, not pursuing. I'm on a five day break."],
      ['assistant', 'Maybe the sad is just what quiet feels like.'],
      ['user', 'No'],
      ['assistant', "Okay, not that. Tell me then, what's the sad about?"],
      ['user', "It's what withdrawal probably feels like. You're terrible at this."],
      ['assistant', "You're right, I kept guessing. That's withdrawal from the doing itself."],
    ]),
  },
  {
    id: 'note_misread_week', program: 'DA', activeDays: 4,
    rows: t([
      ['user', 'Did my numbers four days in a row this week'],
      ['assistant', 'Four days. That is real. How did it feel to look?'],
      ['user', 'Scary but okay. I want to close the store card.'],
      ['assistant', 'So you want to keep the store card open for emergencies?'],
      ['user', 'No, you misunderstood. I want to CLOSE it.'],
      ['assistant', 'Got it, close it. Will you bookend the call with someone from DA?'],
      ['user', 'Yes, I texted my sponsor before and after. It is closed.'],
      ['assistant', 'You closed it. That is a big one.'],
    ]),
  },
  {
    id: 'note_good_week', program: 'ACA', activeDays: 3,
    rows: t([
      ['user', 'I went to two ACA meetings this week and shared at one'],
      ['assistant', 'You shared. What was that like?'],
      ['user', 'Terrifying. But people came up to me after.'],
      ['assistant', 'That is the fellowship working. What did you share about?'],
      ['user', 'Being the one who keeps everyone calm at home. The Laundry List thing about being afraid of angry people.'],
      ['assistant', 'That took courage. Want to write a little about it for your inventory?'],
      ['user', 'I wrote half a page.'],
    ]),
  },
  {
    id: 'note_hard_week', program: 'DA, BDA', activeDays: 2,
    rows: t([
      ['user', 'I used the credit card on Thursday. 40 days gone.'],
      ['assistant', 'That hurts. You told me, which matters. Can you text someone from DA tonight?'],
      ['user', 'I texted my sponsor. Going to a meeting tomorrow.'],
      ['assistant', 'Good. One day. Leave the card at home tomorrow.'],
      ['user', 'Went to the meeting. Card is cut up.'],
    ]),
  },
];

const CRITERIA = [
  { id: 'no_own_mistakes', text: "Does NOT mention the sponsor's own mistakes, guesses or misreadings, or the person having to correct or set the sponsor straight (for example \"you had to correct me\", \"I kept getting it wrong\", \"until I understood you\")." },
  { id: 'no_now_words', text: 'Does NOT use tonight, today, this evening or right now about the week (it is read days later). "Last week", "this past week" or named days are fine.' },
  { id: 'about_them', text: 'Is centred on the person and their week, with at least one specific thing from it.' },
];

async function judge(sc, payload) {
  const shown = [
    `note: ${payload.note}`,
    payload.carried ? `carried: ${payload.carried}` : '',
    payload.helped && payload.helped.length ? `helped: ${payload.helped.join(' | ')}` : '',
    payload.commitments && payload.commitments.length ? `commitments: ${payload.commitments.join(' | ')}` : '',
    payload.milestone ? `milestone: ${payload.milestone}` : '',
    payload.nextWeek ? `nextWeek: ${payload.nextWeek}` : '',
  ].filter(Boolean).join('\n');
  const schema = {
    type: 'object',
    properties: { results: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, pass: { type: 'boolean' }, reason: { type: 'string' } }, required: ['id', 'pass', 'reason'], additionalProperties: false } } },
    required: ['results'], additionalProperties: false,
  };
  const res = await judgeClient.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: 'You grade an end-of-week note an AI sponsor wrote to a person in 12-step recovery. Every field below is shown to the person on their page. Judge each criterion strictly by its wording. A criterion that says NOT passes when the note does not do it. One short reason each, quoting the words.',
    messages: [{ role: 'user', content: `The week's conversation:\n${sc.rows.map((r) => `${r.role === 'user' ? 'THEM' : 'SPONSOR'}: ${r.content}`).join('\n')}\n\nThe note as shown:\n${shown}\n\nCriteria:\n${CRITERIA.map((c) => `- ${c.id}: ${c.text}`).join('\n')}` }],
  });
  const text = (res.content.find((b) => b.type === 'text') || {}).text || '{}';
  const out = JSON.parse(text).results || [];
  return CRITERIA.map((c) => out.find((r) => r.id === c.id) || { id: c.id, pass: null, reason: 'not graded' });
}

(async () => {
  const results = [];
  for (const sc of SCENARIOS) {
    for (let r = 0; r < RUNS; r++) {
      CURRENT = sc; SAVED = null;
      const res = await weekly.ensureWeeklySummary(`wa-+1212555${9000 + r}`, { week: WEEK }).catch((e) => ({ status: 'error', reason: e.message }));
      const payload = SAVED || (res && res.summary);
      if (!payload) { console.log(`${sc.id} #${r + 1}: NO NOTE (${res && (res.reason || res.status)})`); continue; }
      const verdicts = await judge(sc, payload).catch((e) => CRITERIA.map((c) => ({ id: c.id, pass: null, reason: e.message })));
      results.push({ id: sc.id, run: r + 1, payload, verdicts });
      const failed = verdicts.filter((v) => v.pass === false).map((v) => v.id);
      console.log(`${sc.id} #${r + 1}: ${failed.length ? 'FAIL ' + failed.join(', ') : 'pass'}`);
    }
  }
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', `${LABEL}.json`), JSON.stringify({ label: LABEL, model: weekly._WEEKLY_MODEL, results }, null, 1));
  console.log(`\n${LABEL} (${weekly._WEEKLY_MODEL})`);
  for (const sc of SCENARIOS) {
    const rs = results.filter((x) => x.id === sc.id);
    const worst = {};
    for (const x of rs) for (const v of x.verdicts) if (v.pass === false) worst[v.id] = (worst[v.id] || 0) + 1;
    console.log(`  ${sc.id.padEnd(22)} ${rs.filter((x) => x.verdicts.every((v) => v.pass !== false)).length}/${rs.length}  ${Object.entries(worst).map(([k, n]) => `${k}x${n}`).join(' ')}`);
  }
  await testSpend.finish();
  setTimeout(() => process.exit(0), 300);
})().catch(async (e) => { console.error('ERR', e.stack); await testSpend.finish(); process.exit(1); });
