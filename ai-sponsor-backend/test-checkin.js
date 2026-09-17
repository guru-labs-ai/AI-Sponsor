/* The restraint, which is the only part of this worth testing. Run:
   node test-checkin.js

   A check-in that sends twice, or sends at 4am, or chases somebody who already
   ignored one, is worse than no check-in at all. These are the cases that
   protect against that. */
const path = require('path');
function stub(rel, exports) {
  const id = require.resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(expected === undefined ? actual : actual)}`);
  ok ? pass++ : fail++;
}

function world(candidates) {
  const sent = [], events = [];
  stub('./db.js', {
    enabled: true,
    quietCheckinCandidates: async () => candidates,
    recordEvent: async (id, ev) => { events.push({ id, ev }); },
    getOrCreateSettingsToken: async () => 'tok123',
  });
  const metacloud = {
    enabled: true,
    sendTemplate: async (phone, tpl, params, urlParam, code) => { sent.push({ phone, tpl, params, urlParam, code }); },
  };
  return { sent, events, metacloud };
}
function fresh() {
  delete require.cache[require.resolve('./checkin.js')];
  return require('./checkin.js');
}

(async () => {
  process.env.QUIET_CHECKIN = 'on';

  // Someone who usually writes at 14:00 UTC, swept at 14:00.
  let w = world([{ user_id: 'wa-+15551110000', name: 'Dara Nwosu', usual_hour: 14 }]);
  let c = fresh();
  let out = await c.runCheckinSweep({ metacloud: w.metacloud, now: new Date(Date.UTC(2026, 8, 1, 14)) });
  check('sends inside their usual hours', out.sent, 1);
  check('uses the check-in-on-request template, not free text', w.sent[0].tpl, 'checkin_requested');
  check('its button opens their settings on the sponsor pane', w.sent[0].urlParam, 'tok123#sponsor');
  check('passes their first name only', w.sent[0].params, ['Dara']);
  check('records the send', w.events.map(e => e.ev), ['quiet_checkin']);

  // Same person, swept at 03:00 UTC — the middle of their night.
  w = world([{ user_id: 'wa-+15551110000', name: 'Dara Nwosu', usual_hour: 14 }]);
  c = fresh();
  out = await c.runCheckinSweep({ metacloud: w.metacloud, now: new Date(Date.UTC(2026, 8, 1, 3)) });
  check('holds off outside their usual hours', [out.sent, out.skippedHour], [0, 1]);
  check('nothing sent at 3am', w.sent.length, 0);
  check('and nothing recorded, so they stay eligible', w.events.length, 0);

  // Hour maths has to wrap midnight: usual 23:00, now 01:00 is two hours apart.
  check('23:00 and 01:00 count as close', c.withinTheirHours(23, 1), true);
  check('14:00 and 03:00 do not', c.withinTheirHours(14, 3), false);
  check('no clear pattern means no restriction', c.withinTheirHours(null, 3), true);

  // A send that throws must not record the event, or they go quiet for 30 days
  // on a message that never arrived.
  w = world([{ user_id: 'wa-+15551110000', name: 'Dara', usual_hour: 14 }]);
  w.metacloud.sendTemplate = async () => { throw new Error('Meta said no'); };
  c = fresh();
  out = await c.runCheckinSweep({ metacloud: w.metacloud, now: new Date(Date.UTC(2026, 8, 1, 14)) });
  check('a failed send records nothing', [out.sent, out.failed, w.events.length], [0, 1, 0]);

  // No template sender at all: must not fall back to free text.
  w = world([{ user_id: 'wa-+15551110000', name: 'Dara', usual_hour: 14 }]);
  c = fresh();
  out = await c.runCheckinSweep({ metacloud: null, now: new Date(Date.UTC(2026, 8, 1, 14)) });
  check('no free-text fallback exists', [out.sent, w.sent.length], [0, 0]);

  // Off unless switched on.
  process.env.QUIET_CHECKIN = '';
  w = world([{ user_id: 'wa-+15551110000', name: 'Dara', usual_hour: 14 }]);
  c = fresh();
  out = await c.runCheckinSweep({ metacloud: w.metacloud });
  check('disabled by default', out, { ok: false, reason: 'checkin-disabled' });

  /* Mariam, Sep 17: the check-in is MARKETING in every language and WhatsApp
     does not deliver MARKETING to US numbers, so the query must leave +1 numbers
     out. Asserted on what is asked of the database, where the filter lives. */
  process.env.QUIET_CHECKIN = 'on';
  w = world([{ user_id: 'wa-+447700900123', name: 'Amelia', usual_hour: 14 }]);
  let asked = null;
  require.cache[require.resolve('./db.js')].exports.quietCheckinCandidates = async (opts) => {
    asked = opts;
    return [{ user_id: 'wa-+447700900123', name: 'Amelia', usual_hour: 14 }];
  };
  c = fresh();
  out = await c.runCheckinSweep({ metacloud: w.metacloud, now: new Date(Date.UTC(2026, 8, 1, 14)) });
  check('only people who asked for check-ins are considered', asked && asked.optedInOnly, true);
  check('while the English template is not an approved UTILITY, US numbers are left out', asked && asked.excludeUsNumbers, true);
  check('a UK number still gets its check-in', [out.sent, w.sent[0] && w.sent[0].tpl], [1, 'checkin_requested']);

  // The SQL itself: the clause and its parameter, read from db.js.
  const dbSrc = require('fs').readFileSync(require.resolve('./db.js'), 'utf8');
  check('the query carries the +1 filter', /\$5::boolean IS NOT TRUE OR u\.user_id NOT LIKE 'wa-\+1%'/.test(dbSrc), true);


  /* Once Meta approves the English checkin_requested as UTILITY, it reaches
     every number, so US numbers are included. */
  w = world([]);
  asked = null;
  require.cache[require.resolve('./db.js')].exports.quietCheckinCandidates = async (opts) => { asked = opts; return []; };
  w.metacloud.templateInfo = async () => ({ category: 'UTILITY', status: 'APPROVED' });
  c = fresh();
  await c.runCheckinSweep({ metacloud: w.metacloud, now: new Date(Date.UTC(2026, 8, 1, 14)) });
  check('with the English template approved as UTILITY, US numbers are included', asked && asked.excludeUsNumbers, false);

  /* -- Asking (Mariam, Sep 17: check-ins are on request) -- */
  const OFFER_AT = c.OFFER_AFTER_MESSAGES;
  check('offered once there is some conversation', c.offerDue({}, OFFER_AT), true);
  check('not in the first few messages', c.offerDue({}, OFFER_AT - 1), false);
  check('never twice', c.offerDue({ checkinOffered: '2026-09-17T10:00:00Z' }, 50), false);
  check('not to somebody who already said yes', c.offerDue({ checkinOptIn: true }, 50), false);
  check('not to somebody who already said no', c.offerDue({ checkinOptIn: false }, 50), false);
  process.env.QUIET_CHECKIN = '';
  const off = fresh();
  check('never while check-ins are switched off', off.offerDue({}, 50), false);
  process.env.QUIET_CHECKIN = 'on';
  c = fresh();

  const profiles = { 'wa-+15551110000': {}, 'reg-1': {} };
  const recorded = [];
  const fakeDb = {
    findAllIdentities: async () => Object.keys(profiles),
    saveProfile: async (id, change) => { profiles[id] = Object.assign({}, profiles[id], change); },
    recordEvent: async (id, ev, detail) => { recorded.push([ev, detail && detail.source]); },
  };
  await c.noteWish(fakeDb, 'wa-+15551110000', { checkins: 'start' }, {});
  check('a yes in chat is saved on every identity',
    [profiles['wa-+15551110000'].checkinOptIn, profiles['reg-1'].checkinOptIn], [true, true]);
  check('and recorded', recorded, [['checkin_opt_in', 'chat']]);
  await c.noteWish(fakeDb, 'wa-+15551110000', { checkins: 'start' }, { checkinOptIn: true });
  check('saying yes again writes nothing new', recorded.length, 1);
  await c.noteWish(fakeDb, 'wa-+15551110000', { checkins: 'none' }, { checkinOptIn: true });
  check('a message that is not about check-ins changes nothing', [recorded.length, profiles['reg-1'].checkinOptIn], [1, true]);
  await c.setWish(fakeDb, 'wa-+15551110000', false, 'settings');
  check('the settings switch turns it off everywhere',
    [profiles['wa-+15551110000'].checkinOptIn, profiles['reg-1'].checkinOptIn, recorded[1]], [false, false, ['checkin_opt_out', 'settings']]);
  check('a failed save never breaks the reply',
    await c.noteWish({ findAllIdentities: async () => { throw new Error('db down'); } }, 'x', { checkins: 'start' }, {}), null);
  check('the English check-in says it is the one they asked for', /you asked me to check in/.test(c.checkinText('Dara Nwosu')), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
