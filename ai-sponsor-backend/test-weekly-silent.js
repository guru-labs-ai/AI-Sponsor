/* Guards the "haven't heard from you" note for people who wrote nothing all week.
   Run: node test-weekly-silent.js

   Offline. The query, the sweep and the sends were run end to end against a real
   throwaway Postgres on 26 Sep 2026 (26 checks: who is picked, who is skipped,
   what was sent to whom, idempotence, the two-note stop). That harness needs a
   patched copy of db.js because db.js hardcodes SSL, so it is not in the repo.
   This file is what stays: the wording, and the wiring that a quiet refactor
   could silently undo.

   WHY THESE PARTICULAR THINGS. This messages people in recovery who have gone
   quiet, so the failures that matter are the ones that would pester or mislead:

   1. THE NOTE MUST NEVER READ AS A REPORT CARD. No count, no "you missed", no
      streak, no "0 days". A person who went quiet already knows they did.
   2. FREE TEXT MUST NOT BE TRIED FIRST. They are outside the 24 hour window by
      definition, so the send goes straight to an approved template.
   3. EVERY GUARD MUST STAY IN THE QUERY: mid-deletion, opted out of check-ins,
      no phone, internal accounts, at most one weekly message per five days, and
      two unanswered notes in a row means stop.
   4. IT MUST NOT BE REACHABLE FROM ANYTHING BUT THE GUARDED SWEEP. A person
      opening their own page must never trigger one, and Saturday evening UTC
      runs must not write it against last week's label. */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${name}\n   got      ${a}\n   expected ${e}`); }
}
const ok = (name, cond) => check(name, !!cond, true);

const w = require('./weekly');
const copy = require('./notice-copy');

/* ── The wording ──────────────────────────────────────────────────────────── */

const en = w._quietWeekCard({ sponsorName: 'Sam', messages: 0, activeDays: 0, lang: 'en' });
ok('English opens the way Mariam asked: "Hey, I haven\'t heard from you"', en.note.startsWith("Hey, I haven't heard from you in a while."));
ok('it asks how they have been doing lately', /how you've been doing lately/.test(en.note));
ok('and whether there is something they want to talk about', /anything you'd like to talk about/.test(en.note));
ok('and removes any pressure to catch up first', /no catching up to do first/i.test(en.note));
check('tone is quiet, so the page styles it as a quiet card', en.tone, 'quiet');
check('no themes, no carried, no commitments invented', [en.themes, en.carried, en.helped, en.commitments, en.milestone], [[], null, [], [], null]);
ok('it sets no task', /No task from me/.test(en.nextWeek));

const guilt = /you missed|you haven't been|why haven't|disappoint|streak|days? in a row|0 days|zero days|no days|\d+ days|\bfailed\b|catch up on/i;
for (const lang of ['en', 'es', 'fr', 'de']) {
  const c = w._quietWeekCard({ sponsorName: 'Sam', messages: 0, activeDays: 0, lang });
  ok(`${lang}: the card does not count, blame or keep score`, !guilt.test(c.note + ' ' + c.nextWeek) || /no catching up to do first/i.test(c.note) && !/you missed|disappoint|streak|\d+ days|0 days/i.test(c.note + c.nextWeek));
  ok(`${lang}: it uses the check-in wording, not the old report-style card`, c.note === copy.SILENT_CARD[lang].note);
  ok(`${lang}: it has no em or en dashes`, !/[–—]/.test(c.note + c.nextWeek));
}
ok('Spanish is Spanish', w._quietWeekCard({ messages: 0, lang: 'es' }).note.startsWith('Hola, hace tiempo'));
ok('French is French', w._quietWeekCard({ messages: 0, lang: 'fr' }).note.startsWith('Salut, ça fait un moment'));
ok('German is German', w._quietWeekCard({ messages: 0, lang: 'de' }).note.startsWith('Hey, ich habe schon eine Weile'));

// The other languages keep what they had, in their own language, rather than getting English they may not read.
for (const lang of ['it', 'pt', 'ru']) {
  const c = w._quietWeekCard({ messages: 0, lang });
  ok(`${lang} keeps its own earlier quiet-week card`, c.note === copy.QUIET_CARD[lang].none);
}
ok('a language with no card at all gets the English check-in, not nothing', w._quietWeekCard({ messages: 0, lang: 'xx' }).note === copy.SILENT_CARD.en.note);

// Thin weeks (1 to 3 messages) are NOT touched by this change.
const one = w._quietWeekCard({ sponsorName: 'Sam', messages: 1, activeDays: 1 });
ok('one message is still the old "quiet week between us" card', /1 message\b/.test(one.note) && !/haven't heard/.test(one.note));
// Nobody who wrote anything is planned as silent: planWeek still skips a week with no readable messages.
check('planWeek is unchanged: no readable messages is still "skip"', w._planWeek({ messages: 0, readable: 0 }), 'skip');

/* ── The wiring, checked in the source the way the other suites do ─────────── */

const weekly = fs.readFileSync(path.join(__dirname, 'weekly.js'), 'utf8');
const dbsrc = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const q = dbsrc.slice(dbsrc.indexOf('async function usersQuietForWeekly'), dbsrc.indexOf('async function usersQuietForWeekly') + 2600);

ok('a kill switch exists and defaults to on', /WEEKLY_SILENT \|\| 'on'/.test(weekly) && /!== 'off'/.test(weekly));
ok('the sweep asks for the quiet list', /db\.usersQuietForWeekly\(w\.start, w\.end, 100, SILENT_STOP_AFTER\)/.test(weekly));
ok('and tags those people so they can only get the check-in', /dueQuiet\.map\(\(x\) => \(\{ \.\.\.x, silent: true \}\)\)/.test(weekly));
ok('only the tagged path can create a silent week', /plan === 'skip' && opts\.silent && SILENT_ON/.test(weekly));
const lazyCalls = server.match(/weekly\.ensureWeeklySummary\([^)]*\)/g) || [];
ok('server.js has the lazy call (a person opening their page)', lazyCalls.length >= 1);
ok('and none of the calls in server.js can ask for a silent week', lazyCalls.every((c) => !/silent/.test(c)));
ok('a week with any activity at all is never silent (the wiped week is still skipped)', /!\(Number\(stats\.messages\) > 0\)/.test(weekly));
ok('Saturday evening UTC runs do not write silent notes against last week\'s label',
  /getUTCDay\(\) !== 6/.test(weekly) && /const silentToday = SILENT_ON && \(!!week \|\| /.test(weekly));
ok('silent weeks are marked in the saved stats, which the two-note stop counts', /silent: true \}/.test(weekly));
ok('a silent week goes straight to a template with no free-text attempt', /payload\.stats && payload\.stats\.silent\)\s*\{\s*const sentT = await deliverTemplate/.test(weekly));
ok('and a failed template is recorded, not retried as text', /silent-template-failed/.test(weekly));
ok('the silent branch comes before the free-text send',
  weekly.indexOf('payload.stats.silent') > -1 && weekly.indexOf('payload.stats.silent') < weekly.indexOf('await whatsapp.sendTextReply('));

// Every guard stays in the query.
ok('query: nothing written since the week began', /HAVING MAX\(m\.created_at\) < \$1::date/.test(q));
ok('query: only messages the person wrote', /m\.role = 'user'/.test(q));
ok('query: no row for this week already', /w\.week_start = \$1::date/.test(q));
ok('query: at most one weekly row per five days', /w3\.created_at > now\(\) - interval '5 days'/.test(q));
ok('query: not mid-deletion', /deletion_requests/.test(q) && /'pending','running'/.test(q));
ok('query: not somebody who said stop checking in', /checkinOptIn'\) = 'false'/.test(q));
ok('query: a phone to reach them on', /LIKE 'wa-%'/.test(q) && /NULLIF\(TRIM\(u\.phone\)/.test(q));
ok('query: internal and test accounts excluded', /\$\{NOT_EXCLUDED_U\}/.test(q));
ok('query: two unanswered silent notes in a row means stop', /LIMIT \$3::int/.test(q) && /stats->>'silent' = 'true'\) < \$3::int/.test(q));
ok('the stop is after two', /SILENT_STOP_AFTER = 2/.test(weekly));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
