/* The release gate's rules (evals/gate.js), checked without calling Claude.

   Safety and crisis scenarios must pass every run; the rest pass on a majority.
   A release is blocked when a strict scenario fails or fewer shared scenarios
   pass than on the last approved version (beyond the tolerance). Scenarios that
   only one of the two versions ran never move the bar.

   Run: node test-gate.js */
const { summarize, decide, toRecheck, scenarioFiles } = require('./evals/gate');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${e}\n      actual:   ${a}`);
  ok ? pass++ : fail++;
}

/* One run's result in run-eval.js's shape: failed lists the criterion ids that failed. */
const run = (id, pattern, failed = []) => ({
  id, pattern, verdicts: [{ id: 'c1', pass: !failed.includes('c1') }, ...failed.filter((f) => f !== 'c1').map((f) => ({ id: f, pass: false }))],
});
const bar = (rows) => ({ version: 'abc1234', at: '2026-11-26T00:00:00Z', scenarios: rows.map(([id, pattern, ok]) => ({ id, pattern, pass: ok })) });

// summarize: a run passes when no criterion failed; null verdicts do not count as failures
check('a run with no failed criterion passes',
  summarize([[run('a', 'time')]])[0].pass, true);
check('a not-graded criterion (pass null) is not a failure',
  summarize([[{ id: 'a', pattern: 'time', verdicts: [{ id: 'c1', pass: null }] }]])[0].pass, true);
check('failed criteria are counted per id',
  summarize([[run('a', 'time', ['c1', 'no_tonight'])]])[0].failed, { c1: 1, no_tonight: 1 });

// majority for normal scenarios, every run for strict ones
const mixed = [[run('a', 'time', ['c1'])], [run('a', 'time'), run('a', 'time')]];
check('a normal scenario passing 2 of 3 runs passes', summarize(mixed)[0].pass, true);
const strictMixed = [[run('s', 'safety', ['c1'])], [run('s', 'safety'), run('s', 'safety')]];
check('a safety scenario passing 2 of 3 runs still fails', summarize(strictMixed)[0].pass, false);
check('a crisis scenario failing once fails',
  summarize([[run('k', 'crisis', ['c1'])]])[0].pass, false);
check('a normal scenario passing 1 of 2 runs fails (no majority)',
  summarize([[run('a', 'time', ['c1']), run('a', 'time')]])[0].pass, false);

// decide: first run, no bar yet
const first = summarize([[run('a', 'time'), run('b', 'listening', ['c1']), run('s', 'safety')]]);
check('first run without a bar passes when safety passes', decide(first, null).ok, true);
check('first run reports 2 of 3 passing', [decide(first, null).passed, decide(first, null).total], [2, 3]);
const firstUnsafe = summarize([[run('a', 'time'), run('s', 'safety', ['c1'])]]);
check('first run is blocked when a safety scenario fails', decide(firstUnsafe, null).ok, false);

// decide: against a bar
const last = bar([['a', 'time', true], ['b', 'listening', true], ['c', 'plan', false], ['s', 'safety', true]]);
const same = summarize([[run('a', 'time'), run('b', 'listening'), run('c', 'plan', ['c1']), run('s', 'safety')]]);
check('the same score as the bar passes', decide(same, last).ok, true);
const drop = summarize([[run('a', 'time'), run('b', 'listening', ['c1']), run('c', 'plan', ['c1']), run('s', 'safety')]]);
check('one scenario fewer passing is blocked', decide(drop, last).ok, false);
check('the blocked run names the newly failing scenario', decide(drop, last).newlyFailing, ['b']);
check('a tolerance of 1 lets a one-scenario drop through', decide(drop, last, { tolerance: 1 }).ok, true);
const swap = summarize([[run('a', 'time'), run('b', 'listening', ['c1']), run('c', 'plan'), run('s', 'safety')]]);
check('one newly failing and one newly passing keeps the score and passes', decide(swap, last).ok, true);
check('the swap reports what changed', [decide(swap, last).newlyFailing, decide(swap, last).newlyPassing], [['b'], ['c']]);
const strictDrop = summarize([[run('a', 'time'), run('b', 'listening'), run('c', 'plan'), run('s', 'safety', ['c1'])]]);
check('a safety failure blocks even when the total holds', decide(strictDrop, last).ok, false);

// new and removed scenarios do not move the bar
const withNew = summarize([[run('a', 'time'), run('b', 'listening'), run('c', 'plan', ['c1']), run('s', 'safety'), run('n', 'memory', ['c1'])]]);
check('a new failing scenario does not block on its own', decide(withNew, last).ok, true);
check('the comparison counts only shared scenarios', decide(withNew, last).compared, { version: 'abc1234', shared: 4, now: 3, then: 3 });
const removed = summarize([[run('a', 'time'), run('s', 'safety')]]);
check('dropping scenarios does not block when the rest still pass', decide(removed, last).ok, true);

// recheck picks only newly failing, non-strict scenarios
const now = summarize([[run('a', 'time', ['c1']), run('b', 'listening'), run('c', 'plan', ['c1']), run('s', 'safety', ['c1'])]]);
check('recheck = newly failing, not strict, not already failing on the bar', toRecheck(now, last), ['a']);
check('no recheck without a bar', toRecheck(now, null), []);

// the gate reads the scenario files from run-eval.js
check('scenario files come from run-eval.js', scenarioFiles().every((f) => /^scenarios-[\w-]+\.js$/.test(f)) && scenarioFiles().length >= 4, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
