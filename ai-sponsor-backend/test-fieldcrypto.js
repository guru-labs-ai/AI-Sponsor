/* Exercises fieldcrypto in a child process per scenario, since the key is read
   once at require time. Run: node test-fieldcrypto.js */
const { execFileSync } = require('child_process');
const path = require('path');

const MOD = path.resolve(__dirname, 'fieldcrypto.js');
const KEY = require('crypto').randomBytes(32).toString('base64');
const OTHER = require('crypto').randomBytes(32).toString('base64');

/* The module logs its on/off state at require time, so take only the last line
   — that's what the script under test actually printed. */
function run(script, env) {
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
  const lines = out.split(/\r?\n/);
  return lines[lines.length - 1];
}

const load = `const fc=require(${JSON.stringify(MOD)});`;
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}

const SECRET = "My daughter Marnie's birthday is Tuesday and her mum won't let me see her.";

// 1. round trip
check('round-trips the exact text',
  run(`${load}console.log(fc.decrypt(fc.encrypt(${JSON.stringify(SECRET)})))`, { FIELD_ENCRYPTION_KEY: KEY }),
  SECRET);

// 2. ciphertext doesn't leak the plaintext
const ct = run(`${load}console.log(fc.encrypt(${JSON.stringify(SECRET)}))`, { FIELD_ENCRYPTION_KEY: KEY });
check('stored value is prefixed + unreadable',
  String(ct.startsWith('v1:') && !ct.includes('Marnie')), 'true');

// 3. a different key cannot read it
check('wrong key returns null, does not throw',
  run(`${load}console.log(String(fc.decrypt(${JSON.stringify(ct)})))`, { FIELD_ENCRYPTION_KEY: OTHER }),
  'null');

// 4. tampering is detected (flip a char in the ciphertext body)
const parts = ct.split(':');
parts[3] = parts[3][0] === 'A' ? 'B' + parts[3].slice(1) : 'A' + parts[3].slice(1);
check('tampered value returns null (auth tag works)',
  run(`${load}console.log(String(fc.decrypt(${JSON.stringify(parts.join(':'))})))`, { FIELD_ENCRYPTION_KEY: KEY }),
  'null');

// 5. pre-encryption plaintext rows still read back fine
check('legacy plaintext passes through unchanged',
  run(`${load}console.log(fc.decrypt("just an old plaintext row"))`, { FIELD_ENCRYPTION_KEY: KEY }),
  'just an old plaintext row');

// 6. no key at all = untouched passthrough (server behaves exactly as before)
check('no key: encrypt is a no-op',
  run(`${load}console.log(fc.encrypt(${JSON.stringify(SECRET)}))`, { FIELD_ENCRYPTION_KEY: '' }),
  SECRET);
check('no key: enabled is false',
  run(`${load}console.log(String(fc.enabled))`, { FIELD_ENCRYPTION_KEY: '' }),
  'false');

// 7. encrypted value with no key = null (loud), never ciphertext handed onward
check('no key but encrypted row: returns null',
  run(`${load}console.log(String(fc.decrypt(${JSON.stringify(ct)})))`, { FIELD_ENCRYPTION_KEY: '' }),
  'null');

// 8. malformed key fails loudly at boot rather than silently storing plaintext
let threw = 'no';
try { run(`${load}console.log('loaded')`, { FIELD_ENCRYPTION_KEY: 'too-short' }); }
catch { threw = 'yes'; }
check('malformed key throws at boot', threw, 'yes');

// 9. hex keys work too
const hex = require('crypto').randomBytes(32).toString('hex');
check('accepts a hex key',
  run(`${load}console.log(fc.decrypt(fc.encrypt("hello")))`, { FIELD_ENCRYPTION_KEY: hex }),
  'hello');

// 10. same text twice = different ciphertext (fresh IV, no pattern leak)
const a = run(`${load}console.log(fc.encrypt("same"))`, { FIELD_ENCRYPTION_KEY: KEY });
const b = run(`${load}console.log(fc.encrypt("same"))`, { FIELD_ENCRYPTION_KEY: KEY });
check('identical text encrypts differently each time', String(a !== b), 'true');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
