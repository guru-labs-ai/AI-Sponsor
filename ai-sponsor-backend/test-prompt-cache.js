/* ─── The prompt is ordered so it can be cached ──────────────────────────────
   Run: node test-prompt-cache.js

   WHY. Prompt caching works on a PREFIX: everything up to the cache marker is
   reusable, and the first thing that changes ends it. The time block used to
   sit SECOND in the system blocks, and it carries the gap since they last
   wrote, so it changed on every message and nothing after it could ever be
   cached. The profile, the memory digest, the settings and the identity block
   were re-sent as fresh input every single time.

   Measured 9 Sep 2026 across 355 real replies: 8,340 uncached input tokens per
   reply against 5,634 cached, which is about 58% of what AI Sponsor costs.

   Verified against the real API after the change: 8,731 tokens served from
   cache on the second call with the volatile tail different.

   ⛔ AND THE ORDER IS NOT ONLY A COST DECISION. The identity block has to stay
   after the memory digest, because it exists to overrule a stale name when
   somebody renames their sponsor. Checked both orders against the model, 4/4
   correct each way, so the reorder cost nothing. These tests are here to stop
   that being undone by a later tidy-up.                                       */

const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const body = src.slice(
  src.indexOf('const systemBlocks = ['),
  src.indexOf('const response = await client.messages.create')
);
const at = (needle) => {
  const i = body.indexOf(needle);
  assert.ok(i >= 0, `not found in the prompt assembly: ${needle}`);
  return i;
};

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}

const MARKER = 'systemBlocks[systemBlocks.length - 1].cache_control';

console.log('\n── There is a cache marker, and it is an hour ──');

check('the marker exists', () => at(MARKER));

check('it is a 1 hour cache, not the 5 minute default', () => {
  const line = body.slice(at(MARKER), at(MARKER) + 130);
  assert.ok(/ttl: '1h'/.test(line), `marker line was: ${line.split('\n')[0]}`);
});

check('it marks whatever the last stable block turned out to be', () => {
  // Every stable block is conditional, so a thin profile can leave only the
  // master prompt. Marking a named block would crash or mark nothing.
  assert.ok(body.includes('systemBlocks[systemBlocks.length - 1]'),
    'the marker must be positional, not a named block');
});

console.log('\n── Stable things above the marker ──');

for (const [name, needle] of [
  ['the master prompt', 'text: MASTER_SYSTEM_PROMPT'],
  ['who they are', 'text: userContext'],
  ['the memory digest', 'text: memoryBlock'],
  ['their settings', 'text: settingsBlock'],
  ['the identity block', 'text: identityBlock'],
]) {
  check(`${name} is cached`, () => {
    assert.ok(at(needle) < at(MARKER), `${name} fell below the cache marker`);
  });
}

console.log('\n── Volatile things below it ──');

check('the time block is BELOW the marker', () => {
  // The whole reason the prefix was uncacheable. If this ever moves back up,
  // caching silently stops working and the bill roughly doubles.
  assert.ok(at('text: buildTimeBlock(lastAt)') > at(MARKER),
    'the time block is above the cache marker again, which kills all caching');
});

check('reactions are BELOW the marker', () => {
  assert.ok(at('text: reactionBlock') > at(MARKER),
    'a reaction arriving mid-conversation would invalidate the whole prefix');
});

console.log('\n── The rename fix is not sacrificed to caching ──');

check('the identity block still comes after the memory digest', () => {
  assert.ok(at('text: memoryBlock') < at('text: identityBlock'),
    'identity must stay after the digest, or a renamed sponsor answers to its old name');
});

check('the identity block still comes after the profile', () => {
  assert.ok(at('text: userContext') < at('text: identityBlock'));
});

check('the identity block is still the LAST stable block', () => {
  // It is what the marker lands on in the normal case, and it has to stay the
  // last thing that can overrule anything above it.
  const between = body.slice(at('text: identityBlock'), at(MARKER));
  assert.ok(!/systemBlocks\.push/.test(between),
    'something was inserted between the identity block and the cache marker');
});

console.log('\n── The length and question blocks stay per-message ──');

check('the length budget is not baked into the cached prefix', () => {
  const i = body.indexOf('HOW LONG THIS PARTICULAR REPLY SHOULD BE');
  if (i < 0) return;   // lives after this slice, which is fine
  assert.ok(i > at(MARKER), 'the per-reply length target must never be cached');
});

console.log(`\n${failed ? 'FAILED' : 'All good'}: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
