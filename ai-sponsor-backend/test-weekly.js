/* Exercises the weekly review's two risky halves without touching a database,
   a model, or WhatsApp:

     1. the week window, which decides WHICH seven days a summary describes and
        is the thing that has to stay right while the instance sleeps through
        the moment a week rolls over
     2. everything that turns a model response into what the page renders, since
        that is the one place untrusted text becomes structure

   Run: node test-weekly.js */
const w = require('./weekly');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${e}\n      actual:   ${a}`);
  ok ? pass++ : fail++;
}

/* ── The window ───────────────────────────────────────────────────────────── */
const wk = (iso) => w.lastCompletedWeek(new Date(iso));

check('Tuesday reports the week that closed on Sunday',
  wk('2026-08-18T10:00:00Z'), { start: '2026-08-10', end: '2026-08-16' });

check('Monday 00:00:01, the week is available the instant it closes',
  wk('2026-08-17T00:00:01Z'), { start: '2026-08-10', end: '2026-08-16' });

/* The one that would be easy to get wrong: on Sunday the current week has NOT
   closed, so the answer must still be the week before. A summary of a week that
   is still happening would be wrong by Monday and would have to be rewritten,
   which breaks the "the row either exists or it doesn't" model entirely. */
check('Sunday 23:59 still reports the PREVIOUS week, not the one in progress',
  wk('2026-08-16T23:59:59Z'), { start: '2026-08-03', end: '2026-08-09' });

check('a week late still names the same window (sleeping instance catches up)',
  wk('2026-08-23T23:59:59Z'), { start: '2026-08-10', end: '2026-08-16' });

check('crossing into a new year', wk('2026-01-01T12:00:00Z'),
  { start: '2025-12-22', end: '2025-12-28' });

// Every window must be Monday..Sunday, checked across a full year of dates
// rather than the handful above.
let badShape = 0;
for (let i = 0; i < 400; i++) {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
  const r = w.lastCompletedWeek(d);
  const s = new Date(r.start + 'T00:00:00Z'), e = new Date(r.end + 'T00:00:00Z');
  if (s.getUTCDay() !== 1 || e.getUTCDay() !== 0) badShape++;
  if ((e - s) / 86400000 !== 6) badShape++;
  if (e >= d) badShape++; // never describes a day that hasn't finished
}
check('400 consecutive days all give a closed Mon..Sun window', badShape, 0);

/* ── Model output ─────────────────────────────────────────────────────────── */
const good = JSON.stringify({
  note: 'You had a hard Wednesday and you called it early.',
  themes: ['sleep', 'your brother'], carried: 'The row with your brother.',
  helped: ['walking before bed'], commitments: ['ring your brother'],
  milestone: null, nextWeek: 'Ring him.', tone: 'steady',
});

check('clean JSON survives intact',
  w._parseModelJSON(good).themes, ['sleep', 'your brother']);

check('a code fence is stripped rather than breaking the parse',
  w._parseModelJSON('```json\n' + good + '\n```').note,
  'You had a hard Wednesday and you called it early.');

/* Prose instead of JSON must not lose the writing. It becomes the note and
   every structured field stays empty, which is the honest degradation: no
   invented themes, no invented commitments. */
const prose = w._parseModelJSON('It was a steadier week than the last one.');
check('prose fallback keeps the note', prose.note, 'It was a steadier week than the last one.');
check('prose fallback invents no themes', prose.themes, []);
check('prose fallback invents no commitments', prose.commitments, []);
check('prose fallback claims no milestone', prose.milestone, null);

check('empty response yields nothing at all rather than a blank card',
  w._parseModelJSON(''), null);
check('JSON with no note is rejected',
  w._parseModelJSON('{"themes":["a"],"tone":"steady"}'), null);

/* A tone the model made up must not reach the page: the front end styles on it,
   and an unknown value would silently fall through to the confident blue on a
   week that might be anything but. */
check('an invented tone falls back to steady',
  w._coerce({ note: 'x', tone: 'celebratory' }).tone, 'steady');
check('a real tone is kept', w._coerce({ note: 'x', tone: 'hard' }).tone, 'hard');

// Arrays are clamped, so one runaway response cannot produce a page of chips.
check('themes are capped at 5',
  w._coerce({ note: 'x', themes: ['a','b','c','d','e','f','g'] }).themes.length, 5);
check('commitments are capped at 4',
  w._coerce({ note: 'x', commitments: ['1','2','3','4','5','6'] }).commitments.length, 4);

// Wrong types must not throw. A model returning a string where an array belongs
// is a bad week for one person, not a 500 for everybody.
check('a string where an array belongs becomes an empty array',
  w._coerce({ note: 'x', themes: 'sleep' }).themes, []);
check('nulls inside an array are dropped',
  w._coerce({ note: 'x', helped: ['walking', null, '', 'tea'] }).helped, ['walking', 'tea']);
check('a non-string note is rejected outright',
  w._coerce({ note: { text: 'hi' } }), null);
check('whitespace-only note is rejected',
  w._coerce({ note: '   ' }), null);

/* Markup is preserved here on purpose. This layer's job is shape, not escaping;
   the page escapes at render (escHTML). Pinning it means a future "helpful"
   strip here can't quietly become the only defence. */
check('markup is passed through untouched for the page to escape',
  w._coerce({ note: '<img src=x onerror=alert(1)>' }).note, '<img src=x onerror=alert(1)>');

/* ── Which path a week takes ──────────────────────────────────────────────────
   This shipped wrong once and is the regression that matters most.

   activity_days records that somebody turned up and clearConversation
   deliberately does not clear it, so after a "start over" the activity count
   still says 15 while the messages themselves are gone. The first version gated
   on that number and sent a model off to find themes in a week it could open
   two messages of. Found on real production data: a user with 15 logged and 2
   readable got a narrative written about a conversation that no longer existed. */
check('15 turned up but only 2 readable is a QUIET week, not a narrative',
  w._planWeek({ messages: 15, readable: 2, activeDays: 2 }), 'quiet');

check('a fully wiped week is skipped, not written about',
  w._planWeek({ messages: 52, readable: 0, activeDays: 5 }), 'skip');

check('a genuine busy week still gets the narrative',
  w._planWeek({ messages: 106, readable: 106, activeDays: 6 }), 'narrative');

check('exactly at the threshold is a narrative',
  w._planWeek({ messages: 4, readable: 4, activeDays: 1 }), 'narrative');
check('one under the threshold is quiet',
  w._planWeek({ messages: 3, readable: 3, activeDays: 1 }), 'quiet');

// The activity count must not be able to influence this at all, in either
// direction, so a missing or absurd `messages` changes nothing.
check('a huge activity count cannot promote a thin week',
  w._planWeek({ messages: 9999, readable: 1 }), 'quiet');
check('a missing activity count cannot demote a real week',
  w._planWeek({ readable: 40 }), 'narrative');
check('missing readable is treated as nothing to say',
  w._planWeek({ messages: 20 }), 'skip');

/* ── The quiet week ───────────────────────────────────────────────────────── */
const silent = w._quietWeekCard({ sponsorName: 'Sam', messages: 0, activeDays: 0 });
check('a silent week is tone quiet', silent.tone, 'quiet');
check('a silent week invents no themes', silent.themes, []);
check('a silent week sets no task', silent.nextWeek.includes('No task from me'), true);

const thin = w._quietWeekCard({ sponsorName: 'Sam', messages: 1, activeDays: 1 });
check('one message is singular, not "1 messages"', /1 message\b/.test(thin.note), true);
check('one day is singular', /1 day\b/.test(thin.note), true);

const two = w._quietWeekCard({ sponsorName: 'Sam', messages: 2, activeDays: 2 });
check('two messages pluralise', /2 messages across 2 days/.test(two.note), true);

/* The quiet card must never congratulate. This is the whole reason it is
   written in code rather than by a model.

   Matching a bare "score" here was wrong: the copy says "I'm not keeping
   score", which is the sentiment we want, and the first version of this test
   failed on the negation of the thing it was checking for. So praise is
   enumerated, and scoring is only a failure when it is NOT negated. */
const praise = /well done|great job|keep it up|proud of you|congrat|amazing|streak/i;
check('the quiet card never congratulates', praise.test(silent.note + thin.note), false);
check('the quiet card only mentions score to disclaim it',
  /keeping score/.test(thin.note) && !/not keeping score/.test(thin.note), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
