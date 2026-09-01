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
  });
  const metacloud = {
    enabled: true,
    sendTemplate: async (phone, tpl, params) => { sent.push({ phone, tpl, params }); },
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
  check('uses the template, not free text', w.sent[0].tpl, 'quiet_checkin');
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
