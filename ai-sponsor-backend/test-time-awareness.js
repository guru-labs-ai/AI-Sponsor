/* Guards the sponsor's sense of time. Run: node test-time-awareness.js

   Offline. Nothing here touches the network or the database.

   WHY THIS EXISTS. Until now nothing put a date in front of the model. The
   sponsor could not tell three days from three weeks, had no way to know a
   milestone was approaching, and would greet somebody returning after a
   fortnight exactly as it greeted somebody who messaged an hour ago. On a
   recovery product time is not metadata, it is most of the meaning: "three
   days" and "three months" are different facts about a person's life.

   The two things worth pinning down are the gap wording, because that is what
   the sponsor will say back to a real person, and the refusal to guess time of
   day, because a sponsor saying "tonight" at nine in the morning reads as a
   machine and undoes the thing this is for. */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const has = (name, haystack, needle) => check(name, String(haystack).includes(needle), true);
const group = (t) => console.log(`\n— ${t}`);
const src = (f) => fs.readFileSync(path.resolve(__dirname, f), 'utf8');

/* Lifted from source rather than copied, so the test cannot drift away from
   what actually runs. Same approach test-reactions.js uses. */
const server = src('server.js');
const body = server.slice(server.indexOf('const DAY_MS'), server.indexOf('// Persist a completed exchange'));
const { buildTimeBlock, describeGap } = new Function(`${body}; return { buildTimeBlock, describeGap };`)();

const NOW = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));           // Tue 25 Aug 2026
const ago = (days, hours = 0) =>
  new Date(NOW.getTime() - days * 86400000 - hours * 3600000);

(async () => {
  group('it knows what day it is');
  has('states the date in full', buildTimeBlock(null, NOW), 'Tuesday, 25 August 2026');

  group('how long since they last spoke');
  check('same conversation',   describeGap(ago(0, 1), NOW), 'a short time ago, in this same conversation');
  check('earlier today',       describeGap(ago(0, 5), NOW), 'earlier today');
  check('yesterday',           describeGap(ago(1), NOW),    'yesterday');
  check('three days',          describeGap(ago(3), NOW),    '3 days ago');
  check('a week',              describeGap(ago(8), NOW),    'about a week ago');
  check('three weeks',         describeGap(ago(20), NOW),   'about 3 weeks ago');
  check('over a month',        describeGap(ago(45), NOW),   'over a month ago');
  check('three months',        describeGap(ago(90), NOW),   '3 months ago');
  check('no history at all',   describeGap(null, NOW),      null);
  /* Clock skew must not produce "in -2 days". */
  check('a future timestamp is ignored', describeGap(new Date(NOW.getTime() + 86400000), NOW), null);

  group('the fortnight case, which is the whole reason for this');
  const fortnight = buildTimeBlock(ago(14), NOW);
  has('names the gap', fortnight, 'about 2 weeks ago');
  has('names the actual date', fortnight, 'Tuesday 11 August');
  has('invites acknowledging it', fortnight, 'There has been a real gap');

  group('short gaps are not treated as absence');
  const yesterday = buildTimeBlock(ago(1), NOW);
  has('says yesterday', yesterday, 'yesterday');
  check('no gap prompt after one day', yesterday.includes('There has been a real gap'), false);
  check('no gap prompt after four days', buildTimeBlock(ago(4), NOW).includes('There has been a real gap'), false);
  check('gap prompt from five days', buildTimeBlock(ago(5), NOW).includes('There has been a real gap'), true);

  group('first contact');
  const first = buildTimeBlock(null, NOW);
  has('says so plainly', first, 'first time this person has spoken to you');
  check('does not invent a previous message', first.includes('They last messaged you'), false);

  group('it must not guess their time of day');
  /* The server is UTC and has no idea where anyone is. A sponsor saying
     "tonight" at nine in the morning is worse than one that says nothing. */
  [buildTimeBlock(null, NOW), buildTimeBlock(ago(3), NOW)].forEach((b, i) => {
    has(`block ${i + 1} says the local time is unknown`, b, 'You do not know their local time of day');
    has(`block ${i + 1} forbids morning/afternoon/tonight`, b, 'Do not say morning, afternoon or tonight');
  });

  group('wiring');
  check('the block is actually sent to the model',
    server.includes("systemBlocks.push({ type: 'text', text: buildTimeBlock(lastAt) })"), true);
  check('last-contact time is read from the database',
    server.includes('db.getLastMessageAt(userId)'), true);
  /* If this ever throws, somebody loses their reply over a date line. */
  check('a database failure cannot block a reply',
    /db\.getLastMessageAt\(userId\)\.catch\(\(\) => null\)/.test(server), true);
  /* It changes daily and per person, so it must never sit inside the cached
     prefix or every conversation gets yesterday's date. */
  /* Compared inside getSponsorReply, not across the whole file: the
     persistExchange DEFINITION sits above it, so a file-wide indexOf compares
     against the wrong thing and passes or fails for the wrong reason. */
  const fn = server.slice(server.indexOf('async function getSponsorReply'));
  check('read before the turn is persisted, so the gap is the PREVIOUS contact',
    fn.indexOf('db.getLastMessageAt(userId)') < fn.indexOf('persistExchange(userId'), true);
  check('not marked for caching',
    /buildTimeBlock\(lastAt\) \}\);/.test(server) && !/buildTimeBlock\(lastAt\)[^)]*cache_control/.test(server), true);
  check('db exposes it', src('db.js').includes('getLastMessageAt,'), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
