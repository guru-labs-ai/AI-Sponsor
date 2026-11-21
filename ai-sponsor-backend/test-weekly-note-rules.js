/* Guards the two things a weekly note must never do. Run: node test-weekly-note-rules.js
   Offline. The "caught" lines are what notes actually said in test runs on
   14 Nov 2026 (invented weeks); the "clean" ones are notes that must go out. */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test';
const weekly = require('./weekly');
const slip = weekly._noteSlip;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const note = (fields) => Object.assign({ note: 'Sam, last week you did the work.', helped: [], commitments: [], themes: [] }, fields);
const caught = (name, fields) => check(`caught: ${name}`, slip(note(fields)) !== null, true);
const clean = (name, fields) => check(`clean: ${name}`, slip(note(fields)), null);

console.log('\n— the sponsor talking about its own mistakes');
caught('"I got some of my guesses wrong, and you called me on it"', { note: 'I got some of my guesses wrong, and you called me on it, which mattered.' });
caught('"That\'s a sharper read than mine was"', { note: "You named it yourself. That's a sharper read than mine was." });
caught('"instead of settling for my first guess"', { note: "I'm glad you pushed back instead of settling for my first guess." });
caught('in the helped list: "correcting my guesses until it got closer to true"', { helped: ['correcting my guesses until it got closer to true'] });
caught('"I had to be corrected twice"', { note: 'I had to be corrected twice before I understood what you were telling me.' });
caught('"You named what you wanted clearly when I had it wrong"', { note: 'You named what you wanted clearly when I had it wrong.' });
caught('"you named it yourself before I could"', { note: 'You named it yourself before I could.' });
caught('"you named it yourself, better than I did"', { note: "You'd named it yourself, better than I did." });
caught('"without me guessing at it first" in nextWeek', { nextWeek: 'Notice the sad without me guessing at it first.' });

console.log('\n— read days later');
caught('"tonight"', { note: "I don't have an answer for you tonight." });
caught('"right now" in carried', { carried: 'Not working or pursuing anything right now.' });

console.log('\n— notes that must go out as written');
clean('a plain good week', { note: 'Sam, last week you went to two meetings and shared at one. That took courage.', helped: ['sharing at the meeting'] });
clean('growth named on its own terms', { note: 'You named it yourself: withdrawal from the doing. That is a sharp, honest read on yourself.' });
clean('a hard week', { note: 'Thursday was hard, and you told someone the same day. You went to a meeting on Friday and cut the card up.' });
clean('"my" in an ordinary sentence', { note: 'It was good to hear from you, and my door stays open.' });
clean('"today" is not on the list (it can be the day the note is about)', { nextWeek: 'Pick one day and look at the numbers, even if only for ten minutes.' });

console.log('\n— 21 Nov: what Mariam read in the first real notes');
caught('the safety question played back', { note: 'You were honest when I asked you plainly whether you wanted to be here, you said yes.' });
caught('"his" in the milestone', { milestone: 'Wrote his first Step One sentence.' });
caught('"her" in what helped', { helped: ['calling her sister before the meeting'] });
caught('a note that describes itself', { note: 'Dipen, this note is about you. You did real work.' });
caught('a note about the sponsor, not them', { note: 'Hi Chris, last week was mostly you figuring out what I can and can\'t do.' });
clean('"his" in the note itself is somebody else', { note: 'Hi Sam, your dad called and you picked up when he did.' });

console.log('\n— "Hi <name>," on every English note');
check('added in front of a note without one', weekly._withGreeting('Last week was a steady one.', 'Dipen'), 'Hi Dipen, last week was a steady one.');
check('a note that starts with their name gets "Hi"', weekly._withGreeting('Dipen, you sat with something hard.', 'Dipen'), 'Hi Dipen, you sat with something hard.');
check('a note that already greets is left alone', weekly._withGreeting("Hey Chris, it's Kai.", 'Chris'), "Hey Chris, it's Kai.");
check('"I" stays a capital', weekly._withGreeting("I'm glad you came back.", 'Sam'), "Hi Sam, I'm glad you came back.");
check('no name known: "Hi there"', weekly._withGreeting('We didn\'t talk this week.', ''), "Hi there, we didn't talk this week.");

console.log('\n— how long they have been here');
const wk = { start: '2026-11-15', end: '2026-11-21' };
check('joined inside the week: a first week', /^This was their first week with you: they joined on Thursday 19 November\.$/.test(weekly._tenureLine('2026-11-19T16:44:00Z', wk)), true);
check('joined in September: weeks counted', weekly._tenureLine('2026-09-03T10:00:00Z', wk), 'They have been with you since Thursday 3 September, about 12 weeks.');
check('no date: nothing guessed', weekly._tenureLine(null, wk), '');

console.log('\n— a long-standing member is never called new (Mariam, 21 Nov)');
check('joined inside the week: new', weekly._isFirstWeek('2026-11-19T16:44:00Z', wk), true);
check('joined in September: not new', weekly._isFirstWeek('2026-09-03T10:00:00Z', wk), false);
check('no join date: not new', weekly._isFirstWeek(null, wk), false);
check('"this was our first week together" is a first-week claim', weekly._claimsFirstWeek({ note: "Hi Sarah, this was our first week together, so we're still getting to know each other." }), true);
check('"getting to know each other" on its own is one too', weekly._claimsFirstWeek({ note: 'We are still getting to know each other.' }), true);
check('"your first week back at work" is not', weekly._claimsFirstWeek({ note: 'Hi Sam, it was your first week back at work.' }), false);
const old = weekly._dropFirstWeekClaim({ note: "Hi Sarah, this was our first week together, so we're still getting to know each other. You kept showing up even when it was hard. That counts." });
check('the claim is cut and the rest kept', old.note, 'You kept showing up even when it was hard. That counts.');
check('...and the greeting comes back in code', weekly._withGreeting(old.note, 'Sarah'), 'Hi Sarah, you kept showing up even when it was hard. That counts.');
const src2 = require('fs').readFileSync(require('path').join(__dirname, 'weekly.js'), 'utf8');
check('a long-standing member called new is written once more', /!firstWeek && claimsFirstWeek\(payload\)/.test(src2), true);
check('and if it still says so, the sentence goes', /if \(payload && !firstWeek\) dropFirstWeekClaim\(payload\)/.test(src2), true);

console.log('\n— a field that says None is empty');
check('milestone "None" is not printed', weekly._coerce({ note: 'Hi.', milestone: 'None', tone: 'quiet' }).milestone, null);
check('long dashes become commas', weekly._coerce({ note: 'quick — a link, a hello.', tone: 'quiet' }).note, 'quick, a link, a hello.');

console.log('\n— wiring');
const src = require('fs').readFileSync(require('path').join(__dirname, 'weekly.js'), 'utf8');
check('a slipped note is written once more, never more than twice', /attemptNo < 2\s*\?\s*\(noteSlip\(payload\)/.test(src) && /attemptNo <= 2/.test(src), true);
check('the prompt forbids both', src.includes('never about you') && src.includes('Never write tonight, today, this evening, right now or "this week"'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
