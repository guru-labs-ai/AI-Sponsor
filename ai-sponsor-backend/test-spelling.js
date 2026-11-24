/* Tests for spelling.js: British spellings become American in English text,
   and nothing else changes. No database, no model.
   Run: node test-spelling.js */
const { americanize, isEnglish } = require('./spelling');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

console.log('— what the sponsor copied back in the 24 Nov test');
check('favour', americanize("What's the favour they're asking?"), "What's the favor they're asking?");
check('favour, mid reply', americanize('The favour itself, or the fear of saying no?'), 'The favor itself, or the fear of saying no?');

console.log('— the words that matter most here');
check('programme and behaviour', americanize('Your programme is about your own behaviour today.'), 'Your program is about your own behavior today.');
check('plurals', americanize('Both programmes name the behaviours.'), 'Both programs name the behaviors.');
check('counsellor and counselling', americanize('A counsellor or some counselling could help.'), 'A counselor or some counseling could help.');
check('judgement and judgemental', americanize('No judgement here, and nobody is being judgemental.'), 'No judgment here, and nobody is being judgmental.');
check('-ise words', americanize('You realised it, you recognised it, and you apologised.'), 'You realized it, you recognized it, and you apologized.');
check('cancelled, travelling, centre', americanize('They cancelled while I was travelling to the centre.'), 'They canceled while I was traveling to the center.');
check('organisation', americanize('That organisation runs it.'), 'That organization runs it.');
check('spiralling', americanize('It feels like spiralling.'), 'It feels like spiraling.');

console.log('— capital letters');
check('start of the reply', americanize('Programme first, then the rest.'), 'Program first, then the rest.');
check('start of a later sentence', americanize('Okay. Behaviour is the word they use.'), 'Okay. Behavior is the word they use.');
check('start of a new line', americanize('Two things.\nHonour that.'), 'Two things.\nHonor that.');
check('a name in the middle of a sentence stays', americanize('Try the Rideau Centre group tonight.'), 'Try the Rideau Centre group tonight.');
check('a meeting name stays', americanize('The Harbour Group meets at 7.'), 'The Harbour Group meets at 7.');
check('all capitals stay', americanize('PROGRAMME'), 'PROGRAMME');

console.log('— nothing else changes');
check('a link is left exactly as it is', americanize('Here: https://example.org/centre/programme?colour=1 and the programme.'),
  'Here: https://example.org/centre/programme?colour=1 and the program.');
check('an email address too', americanize('Write to programme@example.org about the programme.'), 'Write to programme@example.org about the program.');
check('advise, exercise, promise, analysis are not touched', americanize('I advise exercise, I promise, after some analysis and two analyses.'),
  'I advise exercise, I promise, after some analysis and two analyses.');
check('emphasis the noun stays, emphasise the verb changes', americanize('No emphasis needed, just emphasise it.'), 'No emphasis needed, just emphasize it.');
check('American text is unchanged', americanize('Your program, your behavior, no judgment.'), 'Your program, your behavior, no judgment.');
check('words inside other words are safe', americanize('programmed, colourless? no: programmed'), 'programmed, colourless? no: programmed');
check('not a string comes back as it was', [americanize(null), americanize(''), americanize(5)], [null, '', 5]);

console.log('— which text it runs on');
check('English, or unknown', [isEnglish('en'), isEnglish(null), isEnglish(undefined), isEnglish('en-US')], [true, true, true, true]);
check('any other language: no', [isEnglish('de'), isEnglish('es'), isEnglish('fr')], [false, false, false]);

console.log('— the Sunday summary heading, American order');
const weekly = require('./weekly');
check('same month', weekly.prettyRange('2026-11-15', '2026-11-21'), 'November 15 to 21');
check('across two months', weekly.prettyRange('2026-11-29', '2026-12-05'), 'November 29 to December 5');
check('across the new year', weekly.prettyRange('2026-12-27', '2027-01-02'), 'December 27 to January 2');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
