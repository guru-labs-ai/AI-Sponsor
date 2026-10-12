/* The 24-hour window is decided BEFORE sending now, not by catching 131047.

   On Meta's Cloud API a free-text send outside the window is accepted with a
   message id and refused minutes later by delivery receipt, so the old catch
   never ran and nobody outside the window got the template. These cases pin
   the new order: ask the DB first, template if closed, text if open, and the
   old text-first behaviour whenever the DB cannot tell.

   Run: node test-window24.js */
const w = require('./window24');
const t = require('./trialnotice');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      expected: ${e}\n      actual:   ${a}`);
  ok ? pass++ : fail++;
}

const NOW = Date.UTC(2026, 9, 11, 16, 47);
const H = 60 * 60 * 1000;
const dbAt = (when, seen = []) => ({
  getLastMessageAt: async (id) => { seen.push(id); return when; },
});

(async () => {
  /* ── The helper ─────────────────────────────────────────────────────────── */
  check('wrote an hour ago: open', await w.insideWindow(dbAt(new Date(NOW - H)), '+16193140675', NOW), true);
  check('wrote 22h ago: open', await w.insideWindow(dbAt(new Date(NOW - 22 * H)), '+16193140675', NOW), true);
  check('wrote 23.5h ago: treated as closed, an hour of margin', await w.insideWindow(dbAt(new Date(NOW - 23.5 * H)), '+16193140675', NOW), false);
  // Matt, Sunday 11 Oct: last wrote 8 Oct 00:46 UTC, review sent 11 Oct 16:47.
  check('Matt on 11 Oct: closed', await w.insideWindow(dbAt(new Date(Date.UTC(2026, 9, 8, 0, 46))), '+16193140675', NOW), false);
  check('never wrote on WhatsApp: closed', await w.insideWindow(dbAt(null), '+16193140675', NOW), false);

  const seen = [];
  await w.insideWindow(dbAt(null, seen), '16193140675', NOW);
  check('looks under the wa- id, adding the + if the stored phone lacks it', seen, ['wa-+16193140675']);

  check('DB error: cannot tell', await w.insideWindow({ getLastMessageAt: async () => { throw new Error('down'); } }, '+1', NOW), null);
  check('no helper on the db: cannot tell', await w.insideWindow({}, '+1', NOW), null);
  check('no phone: cannot tell', await w.insideWindow(dbAt(new Date(NOW)), '', NOW), null);

  /* ── The trial notice uses it ───────────────────────────────────────────── */
  const stubDb = (lastAt) => ({
    getEvents: async () => [],
    getOrCreateSettingsToken: async () => 'tok123',
    recordEvent: async () => {},
    getLastMessageAt: async () => lastAt,
  });
  const sender = () => { const calls = []; return { calls, sendTextReply: async (to, text) => { calls.push(to); return { messageId: 'wamid.t' }; } }; };
  const templater = (works = true) => { const calls = []; return { calls, enabled: true,
    sendTemplate: async (to, name) => { calls.push(name); if (!works) throw new Error('131042'); return { messageId: 'wamid.x' }; } }; };
  const base = { user: { user_id: 'reg-abc', name: 'Pamela D', phone: '+13125550100' },
    trialEndUnix: Date.UTC(2026, 9, 3) / 1000, siteUrl: 'https://getaisponsor.com' };

  {
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(new Date(Date.now() - 3 * 24 * H)), whatsapp, metacloud });
    check('trial notice, closed window: template', r, { sent: true, via: 'template' });
    check('and no free text is attempted (it would be accepted then refused)', whatsapp.calls.length, 0);
  }
  {
    const whatsapp = sender(), metacloud = templater();
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(new Date(Date.now() - H)), whatsapp, metacloud });
    check('trial notice, open window: the warm text', r, { sent: true, via: 'text' });
    check('and no template', metacloud.calls.length, 0);
  }
  {
    const whatsapp = sender(), metacloud = templater(false);
    const r = await t.notifyTrialEnding({ ...base, db: stubDb(null), whatsapp, metacloud });
    check('closed window and the template refused: says so, sends nothing else', r, { sent: false, reason: 'outside-24h' });
    check('still no text', whatsapp.calls.length, 0);
  }

  /* ── The weekly review checks it before its text send ───────────────────── */
  const src = fs.readFileSync(require.resolve('./weekly.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function deliver('), src.indexOf('async function deliverTemplate('));
  check('weekly deliver() asks about the window before the free-text send',
    fn.indexOf('window24.insideWindow(db, phone)') > -1 &&
    fn.indexOf('window24.insideWindow(db, phone)') < fn.indexOf('whatsapp.sendTextReply('), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
