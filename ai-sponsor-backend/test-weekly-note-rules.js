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

console.log('\n— wiring');
const src = require('fs').readFileSync(require('path').join(__dirname, 'weekly.js'), 'utf8');
check('a slipped note is written once more, never more than twice', /attemptNo < 2 \? noteSlip\(payload\) : null/.test(src), true);
check('the prompt forbids both', src.includes('never about you') && src.includes('Never write tonight, today, this evening, right now or "this week"'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
