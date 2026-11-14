/* Guards the time guard. Run: node test-time-guard.js
   Offline. Nothing here touches the network or the database.

   The "must fix" sentences are what the sponsor really wrote to a member in
   Oct-Nov 2026 about conversations two weeks and two months earlier (her name
   taken out). The "must not touch" ones are the ways a wrong fix would hurt:
   "tonight" that really is tonight. */
const { fixSameSitting } = require('./timeguard');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

const NOW = new Date(Date.UTC(2026, 10, 13, 20, 54));
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);
const daysAgo = (d) => hoursAgo(d * 24);
const fix = (reply, lastAt, msg = 'hey') => fixSameSitting(reply, lastAt, msg, NOW).text;

group('what it said to her, and must never say again after a gap');
check('two months later: "for a while tonight"',
  fix("We've been circling it for a while tonight, and I think you came back to the top of it on purpose.", daysAgo(60)),
  "We've been circling it for a while, and I think you came back to the top of it on purpose.");
check('two weeks later: "a night like this one"',
  fix('Yeah. That tracks after a night like this one.', daysAgo(14)),
  'Yeah. That tracks after all of this.');
check('twelve days later: "I kept guessing wrong tonight"',
  fix('Before you go, can I own something? I kept guessing wrong tonight when you needed me to just listen.', daysAgo(12)),
  'Before you go, can I own something? I kept guessing wrong last time when you needed me to just listen.');
check('"I got a lot wrong tonight"',
  fix('I got a lot wrong tonight, and I am sorry.', daysAgo(12)),
  'I got a lot wrong last time, and I am sorry.');
check('"me getting it wrong tonight"',
  fix('Is this about me getting it wrong tonight?', daysAgo(12)),
  'Is this about me getting it wrong last time?');
check('"earlier tonight", capitalised',
  fix('Earlier tonight you said the commercials were the safe one.', daysAgo(3)),
  'Last time you said the commercials were the safe one.');
check('"earlier today" after a day and a half',
  fix('You told me earlier today about the invoice.', hoursAgo(36)),
  'You told me last time about the invoice.');
check('after two days, "you said yesterday" is not yesterday',
  fix('Like you said yesterday, the numbers come first.', daysAgo(5)),
  'Like you said last time, the numbers come first.');

group('tonight that really is tonight: never touched');
check('inside the same sitting (1 hour)', fix('I kept guessing wrong tonight.', hoursAgo(1)), 'I kept guessing wrong tonight.');
check('they said tonight themselves', fix('You went to a meeting tonight. That is huge.', daysAgo(14), 'I went to a meeting tonight'), 'You went to a meeting tonight. That is huge.');
check('they mentioned today themselves', fix('I kept thinking about what you said earlier today.', daysAgo(3), 'Today was hard'), 'I kept thinking about what you said earlier today.');
check('a plan for tonight', fix('Get some rest tonight.', daysAgo(14)), 'Get some rest tonight.');
check('a question about tonight', fix('What are you doing tonight?', daysAgo(14)), 'What are you doing tonight?');
check('"I\'m here tonight"', fix("I'm here tonight, whatever you need.", daysAgo(14)), "I'm here tonight, whatever you need.");
check('"I was thinking of you tonight"', fix('I was thinking of you tonight.', daysAgo(14)), 'I was thinking of you tonight.');
check('a meeting tonight', fix('Did you make it to a meeting tonight?', daysAgo(3)), 'Did you make it to a meeting tonight?');
check('"yesterday" after only 20 hours is left alone', fix('Like you said yesterday, the numbers come first.', hoursAgo(20)), 'Like you said yesterday, the numbers come first.');
check('first message ever (no previous time)', fix('I kept guessing wrong tonight.', null), 'I kept guessing wrong tonight.');
check('a crisis line is never altered', fix('Call or text 988 tonight if it gets worse. I got it wrong tonight, I hear you.', daysAgo(14)), 'Call or text 988 tonight if it gets worse. I got it wrong last time, I hear you.');

group('it reports what it changed');
const r = fixSameSitting('Earlier tonight you said it. I kept guessing wrong tonight.', daysAgo(14), 'hi', NOW);
check('two changes reported', r.fixed.length, 2);
check('the first one, as said and as now', r.fixed[0], { said: 'Earlier tonight', now: 'Last time' });

group('wiring');
const server = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
const gsr = server.slice(server.indexOf('async function getSponsorReply'));
check('runs on every reply, with their previous message time and their words', gsr.includes('timeguard.fixSameSitting(rawReply, lastAt, message, new Date())'), true);
check('runs before the reply splits into spoken and read copies', gsr.indexOf('timeguard.fixSameSitting') < gsr.indexOf('voices.forSpeech(markerFree)'), true);
check('every change is logged', gsr.includes('[time-guard] corrected:'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
