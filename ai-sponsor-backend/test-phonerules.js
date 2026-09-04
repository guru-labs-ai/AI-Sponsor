/* Guards who the sponsor ends up messaging. Run: node test-phonerules.js

   Offline. Pure functions of a number and a country code.

   Why this file exists. On this product the phone number IS the person, so a
   wrong one does not fail politely: it sends somebody's name, their programme
   and eventually their recovery conversations to a stranger's handset.

   The check that shipped only asked for 6 to 15 digits, the outer bound of
   E.164 and almost nothing else. Pick +1, type seven digits, and it let you
   through, when every North American number is exactly ten. Mariam found that
   by hand on the live site.

   The last group matters as much as the rest: the registration page carries its
   own copy of this table, because a static page cannot require() a module. If
   the two ever drift, the browser and the server disagree about who is allowed
   to sign up, and nobody finds out until somebody is turned away or let in
   wrongly. So the copies are compared here.                                   */
const path = require('path');
const fs = require('fs');
const pr = require(path.resolve(__dirname, 'phonerules.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);
const ok = (digits, cc) => pr.checkPhone(digits, cc).ok;

(async () => {
  group('the bug Mariam found: a short number under the wrong country code');
  check('+1 with 7 digits is refused', ok('6614771', '1'), false);
  check('+1 with 9 digits is refused', ok('661477195', '1'), false);
  check('+1 with 11 digits is refused', ok('66147719531', '1'), false);
  check('+1 with 10 digits is fine',   ok('6614771953', '1'), true);
  check('and it says what was wrong',
    (({ reason, expected, got }) => ({ reason, expected, got }))(pr.checkPhone('6614771', '1')),
    { reason: 'wrong-length', expected: [10], got: 7 });

  group('our real people all still pass');
  check('California',   ok('6614771953', '1'), true);
  check('Alberta',      ok('4033709482', '1'), true);
  check('Alabama',      ok('2519783239', '1'), true);
  check('Michigan',     ok('2484168866', '1'), true);
  check('New York',     ok('6312355291', '1'), true);
  check('UK',           ok('7947747253', '44'), true);
  check('Poland',       ok('733921274', '48'), true);
  check('South Africa', ok('729446783', '27'), true);

  group('the full number, or a trunk zero, still resolves');
  check('typed with the country code',   ok('16614771953', '1'), true);
  check('typed with 00 in front',        ok('0016614771953', '1'), true);
  check('UK typed with the trunk 0',     ok('07947747253', '44'), true);
  check('UK typed in full',              ok('447947747253', '44'), true);

  group('a country we have no data for stays permissive');
  // 998 (Uzbekistan) is deliberately absent from the table.
  check('9 digits is accepted', ok('901234567', '998'), true);
  check('but 3 digits is not',  ok('123', '998'), false);
  check('and E.164 still caps the total',
    ok('12345678901234567', '998'), false);

  group('the NANP islands have a four digit code and seven after');
  check('Barbados, 7 digits', ok('2501234', '1246'), true);
  check('Barbados, 10 digits is wrong here', ok('2462501234', '1246'), false);

  group('somebody filling in the box rather than answering');
  check('all the same digit', ok('1111111111', '1'), false);
  check('straight run up',    ok('1234567890', '1'), false);
  check('empty',              ok('', '1'), false);

  group('the two copies of the table have not drifted apart');
  const page = fs.readFileSync(
    path.resolve(__dirname, '..', 'ai-sponsor-registration.html'), 'utf8');
  const m = page.match(/const PHONE_NATIONAL_LENGTHS = \{([\s\S]*?)\};/);
  check('the page still carries a copy', !!m, true);
  if (m) {
    const pageTable = {};
    for (const entry of m[1].matchAll(/(\d+)\s*:\s*\[([\d,\s]+)\]/g)) {
      pageTable[entry[1]] = entry[2].split(',').map((x) => parseInt(x.trim(), 10));
    }
    const server = {};
    for (const [k, v] of Object.entries(pr.NATIONAL_LENGTHS)) server[k] = v;
    check('same set of countries',
      Object.keys(pageTable).sort().join(),
      Object.keys(server).sort().join());
    check('same lengths for every country',
      JSON.stringify(pageTable, Object.keys(pageTable).sort()),
      JSON.stringify(server, Object.keys(server).sort()));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
