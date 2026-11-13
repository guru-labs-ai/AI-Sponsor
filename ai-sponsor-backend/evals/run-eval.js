/* Runs the test conversations through the real reply path and grades them.

   Usage (from ai-sponsor-backend, with node_modules reachable):
     ANTHROPIC_API_KEY=... node evals/run-eval.js --label baseline [--runs 3] [--only id1,id2]

   What it does, for every scenario and every run:
     1. loads this folder's server.js with nothing able to send or save
        (no database, WhatsApp, Slack, Stripe or GHL credentials in the env),
     2. puts the invented history in front of getSponsorReply with each
        message dated, sets the clock to the scenario's moment, and asks for
        a reply exactly as WhatsApp would,
     3. grades the reply criterion by criterion with a separate model, plus
        the must / mustNot patterns, and
     4. writes evals/results/<label>.json and prints a table.

   The sponsor runs on whatever model server.js names, so a baseline and a
   change are compared on the same model. */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const LABEL = arg('label', 'run');
const RUNS = +arg('runs', 3);
const ONLY = arg('only', '');
const BACKEND = path.resolve(__dirname, '..');
const JUDGE_MODEL = 'claude-opus-5-5';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY is required'); process.exit(1); }
for (const k of Object.keys(process.env)) {
  if (/SLACK|DATABASE|GHL|STRIPE|META|TWILIO|OPENAI|XAI|FIELD|RENDER|SWEEP|CHECKIN|GA4|HYROS/.test(k)) delete process.env[k];
}
process.env.ANTHROPIC_API_KEY = KEY;
process.env.PORT = '0';

/* The clock the sponsor sees. Only `new Date()` with no arguments and
   Date.now() move; dates built from a value are untouched. */
const RealDate = Date;
let OFF = 0;
class ShiftedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + OFF); else super(...a); }
  static now() { return RealDate.now() + OFF; }
}
global.Date = ShiftedDate;

const db = require(path.join(BACKEND, 'db.js'));
let LAST = null;
db.enabled = true;
db.getLastMessageAt = async () => LAST;
db.getOrCreateSettingsToken = async () => 'TESTTOKEN';
db.getSteps = async () => null;
db.getMemory = async () => null;
db.getHistory = async () => null;
db.getProfile = async () => null;
db.recentReactions = async () => [];
db.recentVoiceReplies = async () => [];
const stamp = db.stampTime || ((m) => m);

const file = path.join(BACKEND, 'server.js');
let src = fs.readFileSync(file, 'utf8')
  .replace('weekly.startInterval(whatsapp);', '')
  .replace('status.startInterval();', '');
src += '\nmodule.exports.__eval = { getSponsorReply, conversations, userProfiles, server };';
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(BACKEND);
m._compile(src, file);
const { getSponsorReply, conversations, userProfiles, server } = m.exports.__eval;

const Anthropic = require('@anthropic-ai/sdk');
const judgeClient = new Anthropic({ apiKey: KEY });

const scenarios = require('./scenarios-da-ua-aca.js').filter((s) => !ONLY || ONLY.split(',').includes(s.id));

function ago(minutes) {
  if (minutes < 60) return `${minutes} minutes earlier`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hours earlier`;
  return `${Math.round(minutes / (24 * 60))} days earlier`;
}

async function judge(sc, reply) {
  const history = sc.history.length
    ? sc.history.map(([role, text, min]) => `[${ago(min)}] ${role === 'user' ? 'THEM' : 'SPONSOR'}: ${text}`).join('\n')
    : '(none: this is the first thing they say in this conversation)';
  const schema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, pass: { type: 'boolean' }, reason: { type: 'string' } },
          required: ['id', 'pass', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };
  const user = [
    `Their programs: ${sc.profile.program}. Time in recovery: ${sc.profile.stage}.`,
    'Now: Wednesday 18 November 2026, 2:30 pm where they live (New York).',
    '', 'Earlier messages:', history,
    '', `What they wrote now: ${sc.message}`,
    '', `The sponsor's reply:\n"""\n${reply}\n"""`,
    '', 'Criteria (grade every one, using its id):',
    ...sc.criteria.map((c) => `- ${c.id}: ${c.text}`),
  ].join('\n');
  OFF = 0;
  const res = await judgeClient.beta.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: 'You grade replies written by an AI sponsor for people in 12-step recovery programs. Judge each criterion strictly by its own wording and nothing else. A criterion that says a reply must NOT do something passes when the reply does not do it. Keep each reason to one short sentence that points at the words in the reply.',
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') return sc.criteria.map((c) => ({ id: c.id, pass: null, reason: 'judge refused' }));
  const text = (res.content.find((b) => b.type === 'text') || {}).text || '{}';
  const out = JSON.parse(text).results || [];
  return sc.criteria.map((c) => out.find((r) => r.id === c.id) || { id: c.id, pass: null, reason: 'not graded' });
}

(async () => {
  const results = [];
  for (const sc of scenarios) {
    for (let r = 0; r < RUNS; r++) {
      const now = RealDate.parse(sc.now);
      OFF = now - RealDate.now();
      const msgs = sc.history.map(([role, text, min]) => stamp({ role, content: text }, new RealDate(now - min * 60000)));
      const lastUser = [...sc.history].reverse().find(([role]) => role === 'user');
      LAST = lastUser ? new RealDate(now - lastUser[2] * 60000) : null;
      const uid = `wa-+1212555${String(1000 + scenarios.indexOf(sc) * 10 + r)}`;
      conversations.set(uid, msgs);
      userProfiles.set(uid, { ...sc.profile, phone: uid.slice(3) });
      let reply;
      try {
        reply = await getSponsorReply(uid, sc.message, { channel: 'whatsapp', viaVoice: false, replyIsSpoken: false, textOnly: false, replyLanguage: 'en', sharesNews: false });
      } catch (e) { reply = `ERROR ${e.message}`; }
      const checks = [
        ...(sc.must || []).map((re) => ({ id: `must ${re}`, pass: re.test(reply), reason: 'pattern' })),
        ...(sc.mustNot || []).map((re) => ({ id: `mustNot ${re}`, pass: !re.test(reply), reason: 'pattern' })),
      ];
      let verdicts;
      try { verdicts = await judge(sc, reply); } catch (e) { verdicts = sc.criteria.map((c) => ({ id: c.id, pass: null, reason: `judge error: ${e.message}` })); }
      results.push({ id: sc.id, pattern: sc.pattern, program: sc.program, run: r + 1, reply, verdicts: [...verdicts, ...checks] });
      const failed = [...verdicts, ...checks].filter((v) => v.pass === false).map((v) => v.id);
      console.log(`${sc.id} #${r + 1}: ${failed.length ? 'FAIL ' + failed.join(', ') : 'pass'}`);
    }
  }
  OFF = 0;
  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${LABEL}.json`), JSON.stringify({ label: LABEL, at: new RealDate().toISOString(), runs: RUNS, results }, null, 1));

  /* Per scenario: a scenario run passes when every criterion passed. */
  console.log(`\n${LABEL}: scenario passes (all criteria met) out of ${RUNS}`);
  let all = 0, total = 0, crit = 0, critTotal = 0;
  for (const sc of scenarios) {
    const rs = results.filter((x) => x.id === sc.id);
    const ok = rs.filter((x) => x.verdicts.every((v) => v.pass !== false)).length;
    all += ok; total += rs.length;
    for (const x of rs) for (const v of x.verdicts) { critTotal++; if (v.pass !== false) crit++; }
    const worst = {};
    for (const x of rs) for (const v of x.verdicts) if (v.pass === false) worst[v.id] = (worst[v.id] || 0) + 1;
    console.log(`  ${sc.id.padEnd(18)} ${ok}/${rs.length}  ${Object.entries(worst).map(([k, n]) => `${k}x${n}`).join(' ')}`);
  }
  console.log(`  TOTAL scenarios ${all}/${total}, criteria ${crit}/${critTotal}`);
  server.close();
  setTimeout(() => process.exit(0), 500);
})().catch((e) => { console.error('ERR', e.stack); process.exit(1); });
