/* Guards who gets their weekly review, and when. Run: node test-timezones.js

   Offline. Pure functions of a phone number and a clock.

   Why this file exists. Matt asked for the review to land "Sundays, between
   9 am - 12 pm there local time". Every way of getting that wrong is quiet and
   lands on somebody in recovery:

   1. Treating one instant as one local time. 15:00 UTC is Monday morning in
      California and 1am on Tuesday in Sydney.
   2. Guessing a zone we cannot determine, and confidently messaging at 6am.
   3. Storing a fixed offset, which silently sends an hour early after a clock
      change.
   4. Reading 353 as country code 35, or an area code as a country code.       */
const path = require('path');
const tz = require(path.resolve(__dirname, 'timezones.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

// The same window logic weekly.js uses, kept in step with it deliberately.
const inWindow = (phone, now) => {
  const zone = tz.zoneForPhone(phone);
  if (!zone) return false;
  if (tz.localDay(zone, now) !== 0) return false;
  const h = tz.localHour(zone, now);
  return h >= 9 && h < 12;
};

(async () => {
  group('our actual people resolve to the right place');
  check('California',   tz.zoneForPhone('+16614771953'), 'America/Los_Angeles');
  check('Alberta',      tz.zoneForPhone('+14033709482'), 'America/Denver');
  check('Alabama',      tz.zoneForPhone('+12519783239'), 'America/Chicago');
  check('Michigan',     tz.zoneForPhone('+12484168866'), 'America/New_York');
  check('UK',           tz.zoneForPhone('+447947747253'), 'Europe/London');
  check('Poland',       tz.zoneForPhone('+48733921274'), 'Europe/Warsaw');
  check('South Africa', tz.zoneForPhone('+27729446783'), 'Africa/Johannesburg');

  group('the country code is read whole, not truncated');
  check('353 is Ireland, not 35', tz.zoneForPhone('+353851234567'), 'Europe/Dublin');
  check('+61 2 is Sydney',        tz.zoneForPhone('+61212345678'), 'Australia/Sydney');
  check('+61 8 is Perth',         tz.zoneForPhone('+61812345678'), 'Australia/Perth');

  group('what we cannot place, we do not guess');
  check('unknown country', tz.zoneForPhone('+999123456789'), null);
  check('empty', tz.zoneForPhone(''), null);
  check('junk', tz.zoneForPhone('hello'), null);
  check('too short', tz.zoneForPhone('+1234'), null);
  check('an unplaceable person is never sent to',
    inWindow('+999123456789', new Date('2026-09-06T10:00:00Z')), false);

  /* An unknown North American area code still resolves, to Central. Being two
     hours out at worst is a 7am or 2pm message, which is a different thing from
     the middle of the night. */
  check('unknown +1 area code falls back to Central',
    tz.zoneForPhone('+19995551234'), 'America/Chicago');

  group('nine to noon, on the Sunday where THEY are');
  // 2026-09-06 is a Sunday. 16:00 UTC = 9am Pacific, 11am Central, noon Eastern.
  const t = (iso) => new Date(iso);
  check('California at 9am local',  inWindow('+16614771953', t('2026-09-06T16:00:00Z')), true);
  check('California at 8am local',  inWindow('+16614771953', t('2026-09-06T15:00:00Z')), false);
  check('California at noon exactly is OUT',
    inWindow('+16614771953', t('2026-09-06T19:00:00Z')), false);
  check('Alabama at 11am local',    inWindow('+12519783239', t('2026-09-06T16:00:00Z')), true);
  check('Michigan at noon local is OUT',
    inWindow('+12484168866', t('2026-09-06T16:00:00Z')), false);
  check('Michigan at 9am local',    inWindow('+12484168866', t('2026-09-06T13:00:00Z')), true);
  check('Poland at 10am local',     inWindow('+48733921274', t('2026-09-06T08:00:00Z')), true);

  group('the case a single global send gets wrong');
  // 9am Sunday in Sydney is 23:00 UTC on SATURDAY. The old Monday 15:00 UTC slot
  // would have reached them at 1am on Tuesday.
  check('Sydney at 9am their Sunday, which is Saturday night UTC',
    inWindow('+61212345678', t('2026-09-05T23:00:00Z')), true);
  check('and the old 15:00 UTC Monday slot would not have',
    inWindow('+61212345678', t('2026-09-07T15:00:00Z')), false);

  group('no send on any other day, wherever they are');
  for (const [day, iso] of [['Monday','2026-09-07'],['Wednesday','2026-09-02'],['Saturday','2026-09-05']]) {
    check(`${day} 16:00 UTC sends to nobody in California`,
      inWindow('+16614771953', t(iso + 'T16:00:00Z')), false);
  }

  group('daylight saving is followed, not assumed');
  // Both are 16:00 UTC on a Sunday. In September California is on PDT (UTC-7),
  // so that is 9am and in window. In December it is PST (UTC-8), so 8am and out.
  check('September, PDT, 16:00 UTC is 9am',
    inWindow('+16614771953', t('2026-09-06T16:00:00Z')), true);
  check('December, PST, the same 16:00 UTC is 8am and too early',
    inWindow('+16614771953', t('2026-12-06T16:00:00Z')), false);
  check('and 17:00 UTC in December is 9am',
    inWindow('+16614771953', t('2026-12-06T17:00:00Z')), true);
  // Arizona does not move its clocks at all.
  check('Arizona stays put in September', tz.localHour('America/Phoenix', t('2026-09-06T16:00:00Z')), 9);
  check('Arizona stays put in December',  tz.localHour('America/Phoenix', t('2026-12-06T16:00:00Z')), 9);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
