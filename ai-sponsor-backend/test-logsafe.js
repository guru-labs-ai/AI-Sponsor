/* What our logs may say about a person. Run: node test-logsafe.js

   Offline. Two parts:
   1. maskPhone keeps the last four digits of anything shaped like a phone
      number and leaves other ids alone.
   2. whatsapp.js never puts what somebody said, or what the sponsor said back,
      into a log line, and never logs a full phone number. Read from the source,
      so a new log line that brings it back fails here before it ships.        */
const path = require('path');
const fs = require('fs');
const { maskPhone } = require(path.resolve(__dirname, 'logsafe.js'));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n-- ${t}`);

group('maskPhone');
check('Twilio WhatsApp sender', maskPhone('whatsapp:+923001234567'), '…4567');
check('E.164', maskPhone('+15555550123'), '…0123');
check('WhatsApp user id', maskPhone('wa-+447700900123'), '…0123');
check('spaces and dashes', maskPhone('+1 555-555-0188'), '…0188');
check('web user id unchanged', maskPhone('user_8f3a2c9d'), 'user_8f3a2c9d');
check('uuid unchanged', maskPhone('3f2b8c1e-9a4d-4e2f-8b7c-1d2e3f4a5b6c'), '3f2b8c1e-9a4d-4e2f-8b7c-1d2e3f4a5b6c');
check('empty', maskPhone(''), '(none)');
check('undefined', maskPhone(undefined), '(none)');
check('too short to be a phone', maskPhone('12345'), '12345');

group('whatsapp.js log lines');
const src = fs.readFileSync(path.resolve(__dirname, 'whatsapp.js'), 'utf8');
// Each console call with its template, joined across line breaks.
const calls = src.match(/console\.(log|warn|error|info)\(([\s\S]*?)\);/g) || [];
// The words themselves, or a slice of them. Their length is fine.
const CONTENT = /\$\{\s*(userMessageText|replyText|messageBody|text)\s*\}|(userMessageText|replyText|messageBody)\)?\s*\.\s*(slice|substring|substr)\(/;
const leaks = calls.filter((c) => CONTENT.test(c));
check('no log line prints message or reply text', leaks, []);
const rawPhone = calls.filter((c) => /\$\{(fromPhone|realPhone)\}/.test(c));
check('no log line prints a full phone number', rawPhone, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
