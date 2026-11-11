/* Tests for steps.js: reading the sponsor's [[step: ...]] line, taking it out
   of the reply, and the record block it is shown. No database, no model.
   Run: node test-steps.js */
const steps = require('./steps');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

console.log('— reading the line');
check('all four parts', steps.parseMarker('DA | 4 | the resentment list, first column | write down three times money fear made a decision for you', 'DA'),
  { program: 'DA', step: 4, part: 'the resentment list, first column', work: 'write down three times money fear made a decision for you' });
check('no programme: the one on file is used', steps.parseMarker('1 | admitting powerlessness | write one time you tried to control it and could not', 'AA'),
  { program: 'AA', step: 1, part: 'admitting powerlessness', work: 'write one time you tried to control it and could not' });
check('several programmes on file: the first', steps.parseMarker('2 | coming to believe | none', 'DA, BDA, UA'),
  { program: 'DA', step: 2, part: 'coming to believe', work: null });
check('"none" means no piece of work, in other languages too', ['none', 'None.', '-', 'keine', 'nada', 'aucune', 'none yet', 'nothing for now'].map((w) => steps.parseMarker(`NA | 3 | deciding | ${w}`).work),
  [null, null, null, null, null, null, null, null]);
check('"Step 4" and "step four" are both step 4', [steps.stepNumber('Step 4'), steps.stepNumber('step four'), steps.stepNumber('4')], [4, 4, 4]);
check('outside 1 to 12 is not a step', [steps.parseMarker('AA | 13 | x | y'), steps.parseMarker('AA | 0 | x | y'), steps.parseMarker('AA | soon | x | y')], [null, null, null]);
check('a | inside the piece of work is kept', steps.parseMarker('OA | 4 | inventory | list three fears | and one hope').work, 'list three fears | and one hope');
check('quotes around a part are dropped', steps.parseMarker('AA | 1 | "admitting it" | none').part, 'admitting it');
check('long text is cut to 200', steps.parseMarker(`AA | 1 | x | ${'a'.repeat(400)}`).work.length, 200);

console.log('— taking it out of the reply');
const reply = 'Good, Sam. Here is your first piece: write down one time you tried to control your drinking and could not.\n\n[[step: AA | 1 | admitting powerlessness | write one time you tried to control it]]';
const got = steps.stepsIn(reply, 'AA');
check('the line is gone from what they see', got.clean, 'Good, Sam. Here is your first piece: write down one time you tried to control your drinking and could not.');
check('and its contents are read', got.step, { program: 'AA', step: 1, part: 'admitting powerlessness', work: 'write one time you tried to control it' });
check('no line: reply untouched, nothing to save', steps.stepsIn('How was your day?', 'AA'), { clean: 'How was your day?', step: null });
check('two lines: the last one wins', steps.stepsIn('a [[step: AA | 1 | done | none]] b [[step: AA | 2 | starting | read step two]]', 'AA').step.step, 2);
check('a broken line is still taken out', steps.stepsIn('Hi there [[step: AA | later | x]]', 'AA'), { clean: 'Hi there', step: null });
check('case and spacing do not matter', steps.stepsIn('ok [[ STEP : AA | 5 | admitting it | none ]]', 'AA').step.step, 5);
check('stripAll leaves nothing behind', steps.stripAll('Text.\n\n[[step: AA | 3 | x | y]]\n'), 'Text.');
check('a meeting-problem line is not touched', steps.stepsIn('x [[meeting-problem: https://zoom.us/j/1 | no one there]]').clean, 'x [[meeting-problem: https://zoom.us/j/1 | no one there]]');

console.log('— "I\'m on step 6", read from their own message');
check('said plainly, in several ways', [
  "I'm on step 6 with my human sponsor", 'im on step six', 'I am working step 4 right now', "I've been working on step 10",
  "I'm on my fourth step", 'currently on the 9th step', 'My sponsor and I are on step 3', "I'm starting step 1 tomorrow",
].map(steps.toldStep), [6, 6, 4, 10, 4, 9, 3, 1]);
check('not a person saying where they are', [
  'what is step 6 about?', 'my friend is on step 4', 'step 3 scares me', 'I did step 5 years ago', "I'm on 6 meds", 'I am on step 13', 'how many steps are there',
].map(steps.toldStep), [null, null, null, null, null, null, null]);

console.log('— what the sponsor is shown');
const block = steps.buildStepsBlock({ program: 'DA', step: 4, part: 'the resentment list', work: 'write down three times', workAt: '2026-11-06T10:00:00Z', since: '2026-11-02T09:00:00Z' });
check('programme, step, since, part, work with its date', [
  block.includes('Programme: DA'), block.includes('Step 4 of 12, since 2 November.'),
  block.includes('Where they are in it: the resentment list'),
  block.includes('The last piece of step work you gave them, on 6 November: write down three times'),
], [true, true, true, true]);
check('no open work says so', steps.buildStepsBlock({ program: 'AA', step: 2 }).includes('No piece of step work is open right now.'), true);
check('nothing saved: no block', [steps.buildStepsBlock(null), steps.buildStepsBlock({ step: null })], [null, null]);
check('the keeping rules show the exact line to write', steps.KEEPING_BLOCK.includes('[[step: <their programme> | <the step they are on now, 1 to 12>'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
