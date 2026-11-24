/* Offline tests: the weekly note goes out as the message itself (Mariam,
   21 Nov 2026), split by the 24-hour window and by US numbers, with the
   one-off second messages. Nothing here touches a database or Meta: every
   outside call is replaced and recorded.

   Run: node test-weekly-note-text.js
*/

process.env.WEEKLY_DELIVER = 'true';
process.env.WEEKLY_AFTER_GAP_MS = '0';
process.env.WEEKLY_AFTER = JSON.stringify({
  'wa-+9779800000001': { week: '2026-11-15', template: 'plan_question_free_until_v2', params: ['18 January'], text: 'I was thinking about what you asked me.' },
  'wa-+4915200000002': { week: '2026-11-08', template: 'meetings_all_programs' },
});

const db = require('./db');
const language = require('./language');
const metacloud = require('./metacloud');
const w = require('./weekly');

let sent = [];
let lastWrote = {};          // wa- id -> last inbound time
let failTemplates = new Set();

db.getUser = async () => ({ name: 'Sam Test' });
db.getOrCreateSettingsToken = async () => 'tok123';
db.markWeeklyDelivered = async (u, wk, ok, why) => { sent.push({ kind: 'mark', ok, why }); };
db.appendMessages = async (u, msgs) => { sent.push({ kind: 'saved', text: msgs[0].content }); };
db.recordEvent = async (u, e) => { sent.push({ kind: 'event', e }); };
db.recordOutbound = async () => {};
db.getLastMessageAt = async (waId) => lastWrote[waId] || null;
language.languageOf = async () => 'en';
language.sendTemplateIn = async (mc, to, name) => { sent.push({ kind: 'old-template', name }); return { messageId: 'old' }; };
metacloud.enabled = true;
metacloud.sendTemplate = async (to, name, params) => {
  if (failTemplates.has(name)) throw new Error('refused');
  sent.push({ kind: 'template', name, params, to });
  return { messageId: 'm' };
};
const whatsapp = { sendTextReply: async (to, text) => { sent.push({ kind: 'text', to, text }); return { messageId: 't' }; } };

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
}

const week = { start: '2026-11-15', end: '2026-11-21' };
const written = { note: 'Hi Sam, last week you kept showing up.', nextWeek: 'Pick one meeting.', tone: 'steady', stats: { messages: 9 } };
const thin = { note: 'Hi Sam, last week was a quiet one between us.', nextWeek: 'No task from me this week. Just message me.', tone: 'quiet', stats: { messages: 2 } };
const silent = { note: "Hi Sam, I haven't heard from you in a while.", nextWeek: 'No task from me.', tone: 'quiet', stats: { messages: 0, silent: true } };
const recent = new Date(Date.now() - 60 * 60 * 1000);
const kinds = () => sent.filter((x) => x.kind === 'text' || x.kind === 'template' || x.kind === 'old-template').map((x) => x.kind + (x.name ? ':' + x.name : ''));

(async () => {
  console.log('— what they read');
  check('a written week: heading, note, one thing, reply line', w._noteMessage(written, week),
    '*Your week in summary, November 15 to 21*\n\nHi Sam, last week you kept showing up.\n\n*One thing for this week:* Pick one meeting.\n\nReply here any time.');
  check('a thin week drops the "No task from me" line', w._noteMessage(thin, week).includes('One thing'), false);
  check('a silent week is a check-in, not a summary', w._noteMessage(silent, week), "*Checking in*\n\nHi Sam, I haven't heard from you in a while.");
  check('no long dash anywhere in the wording', /[—–]/.test(w._noteMessage(written, week) + w._noteMessage(silent, week)), false);

  console.log('\n— which numbers count as US');
  check('a US number', w._isUSNumber('+14155550123'), true);
  check('a Canadian number (780) is not US', w._isUSNumber('+17805550123'), false);
  check('Germany is not US', w._isUSNumber('+4915200000002'), false);
  check('Nepal is not US', w._isUSNumber('+9779800000001'), false);

  console.log('\n— routing');
  sent = []; lastWrote = { 'wa-+995500000003': recent };
  let r = await w.deliver('wa-+995500000003', written, week, whatsapp);
  check('inside the window: the note as text', kinds(), ['text']);
  check('...and kept in their conversation', sent.some((x) => x.kind === 'saved' && x.text.startsWith('*Your week in summary')), true);
  check('...reported as text', r.via, 'text');

  sent = []; lastWrote = {};
  r = await w.deliver('wa-+995500000003', written, week, whatsapp);
  check('outside, not US, written week: the note template with three values', kinds(), ['template:week_in_summary_next']);
  check('...the values are the dates, the note and the one thing', sent.find((x) => x.kind === 'template').params, ['November 15 to 21', 'Hi Sam, last week you kept showing up.', 'Pick one meeting.']);

  sent = [];
  await w.deliver('wa-+995500000003', thin, week, whatsapp);
  check('outside, not US, thin week: the template without the one-thing line', kinds(), ['template:week_in_summary']);

  sent = [];
  await w.deliver('wa-+995500000003', silent, week, whatsapp);
  check('outside, not US, silent week: the check-in template with their name', [kinds(), sent.find((x) => x.kind === 'template').params], [['template:checking_in_note'], ['Sam']]);

  sent = [];
  r = await w.deliver('wa-+14155550123', written, week, whatsapp);
  check('outside, US: the old template with the page link, nothing else', kinds(), ['old-template:weekly_review']);
  check('...and the old message is not saved as if they had read the note', sent.some((x) => x.kind === 'saved'), false);

  sent = []; lastWrote = { 'wa-+14155550123': recent };
  await w.deliver('wa-+14155550123', written, week, whatsapp);
  check('inside the window, US: the note as text like everyone else', kinds(), ['text']);

  sent = []; lastWrote = {};
  await w.deliver('wa-+17805550123', written, week, whatsapp);
  check('outside, Canada: the new note template', kinds(), ['template:week_in_summary_next']);

  sent = []; failTemplates = new Set(['week_in_summary_next']);
  r = await w.deliver('wa-+995500000003', written, week, whatsapp);
  check('the note template refused: the old template instead, never nothing', kinds(), ['old-template:weekly_review']);
  check('...and it still counts as delivered', r.sent, true);
  failTemplates = new Set();

  console.log('\n— the one-off second messages');
  sent = []; lastWrote = {};
  await w.deliver('wa-+9779800000001', written, week, whatsapp);
  check('outside the window: note template, then the second template', kinds(), ['template:week_in_summary_next', 'template:plan_question_free_until_v2']);
  check('...with its value', sent.filter((x) => x.kind === 'template')[1].params, ['18 January']);
  check('...and its words kept in the conversation', sent.filter((x) => x.kind === 'saved').map((x) => x.text)[1], 'I was thinking about what you asked me.');

  sent = []; lastWrote = { 'wa-+9779800000001': recent };
  await w.deliver('wa-+9779800000001', written, week, whatsapp);
  check('inside the window: both as text', kinds(), ['text', 'text']);

  sent = []; lastWrote = {};
  await w.deliver('wa-+4915200000002', written, week, whatsapp);
  check('set for another week: no second message', kinds(), ['template:week_in_summary_next']);

  sent = [];
  await w.deliver('wa-+995500000003', written, week, whatsapp);
  check('nobody else ever gets a second message', kinds(), ['template:week_in_summary_next']);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
