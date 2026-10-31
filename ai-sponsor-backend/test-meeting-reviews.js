/* Guards the page where a person checks a reported meeting. Run: node test-meeting-reviews.js

   Offline. db is stubbed and the router runs in a real express app on
   localhost. What it holds to:
   1. Nothing without the key, not even an admission the page exists.
   2. A check saved is a check that counts, straight away.
   3. A new link has to be a web link, so a typed "javascript:" never reaches
      anyone's chat.
   4. What a person said is shown as text, never run as part of the page.    */
const path = require('path');
const http = require('http');
const express = require('express');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

const DEAD = 'https://zoom.us/j/6100000040';
const saved = [];
const dbPath = require.resolve(path.resolve(__dirname, 'db.js'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    meetingReports: async () => [{ link: DEAD, what: '<script>alert(1)</script> nobody there', fix: 'new one https://zoom.us/j/6100000099', at: '2026-10-30T10:00:00Z' }],
    meetingChecks: async () => saved.slice().reverse(),
    addMeetingCheck: async (c) => { saved.push({ ...c, at: new Date().toISOString() }); },
  },
};
const meetings = require('./meetings');
meetings._setData({ generatedAt: '2026-10-26T11:17:00Z', meetings: [
  { id: 'aca-40', program: 'ACA', name: 'Dead Room ACA', days: [2], start: '09:00', zone: 'America/New_York', link: DEAD, meetingId: '6100000040', passcode: '123', source: 'https://example.org/m/40', sourceUpdated: '2026-10-01' },
] });

function load(env) {
  delete require.cache[require.resolve('./meeting-reviews')];
  const before = { ...process.env };
  delete process.env.MEETING_REVIEW_KEY; delete process.env.VIEWER_KEY;
  Object.assign(process.env, env);
  const mod = require('./meeting-reviews');
  process.env = before;
  return mod;
}

function serve(mod) {
  const app = express();
  app.use(mod.PATH, mod.router);
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
function req(server, method, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {} }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const form = (o) => new URLSearchParams(o).toString();

(async () => {
  group('no key set');
  const off = load({});
  const offServer = await serve(off);
  check('the page 404s', (await req(offServer, 'GET', '/meeting-reports/?k=')).status, 404);
  check('and there is no link for Slack', off.link(), null);
  offServer.close();

  group('with a key');
  const mod = load({ MEETING_REVIEW_KEY: 'k'.repeat(32) });
  const K = 'k'.repeat(32);
  let changed = 0;
  mod.setOnChange(async () => { changed++; });
  const server = await serve(mod);
  check('the Slack link carries the key', mod.link().endsWith(`/meeting-reports/?k=${K}`), true);
  check('a wrong key 404s', (await req(server, 'GET', `/meeting-reports/?k=${'x'.repeat(32)}`)).status, 404);
  check('no key 404s', (await req(server, 'GET', '/meeting-reports/')).status, 404);
  check('a key in other characters 404s, never throws', (await req(server, 'GET', `/meeting-reports/?k=${encodeURIComponent('é'.repeat(32))}`)).status, 404);
  const page = await req(server, 'GET', `/meeting-reports/?k=${K}`);
  check('the right key shows the reported meeting', [page.status, page.body.includes('Dead Room ACA'), page.body.includes('https://example.org/m/40')], [200, true, true]);
  check('what they said is text, never run', [page.body.includes('<script>alert(1)'), page.body.includes('&lt;script&gt;alert(1)&lt;/script&gt; nobody there')], [false, true]);
  check('the new link they gave is filled in, ready to save', page.body.includes('value="https://zoom.us/j/6100000099"'), true);
  check('never indexed', page.headers['x-robots-tag'], 'noindex, nofollow');

  group('saving a check');
  check('a wrong key saves nothing', [(await req(server, 'POST', '/meeting-reports/check', form({ k: 'x'.repeat(32), link: DEAD, verdict: 'gone' }))).status, saved.length], [404, 0]);
  check('an unknown answer is refused', (await req(server, 'POST', '/meeting-reports/check', form({ k: K, link: DEAD, verdict: 'maybe' }))).status, 400);
  check('new details with nothing in them are refused', (await req(server, 'POST', '/meeting-reports/check', form({ k: K, link: DEAD, verdict: 'fixed' }))).status, 400);
  check('a new link that is not a web link is refused', (await req(server, 'POST', '/meeting-reports/check', form({ k: K, link: DEAD, verdict: 'fixed', newLink: 'javascript:alert(1)' }))).status, 400);
  check('nothing was saved by any of those', saved.length, 0);
  const fixedRes = await req(server, 'POST', '/meeting-reports/check', form({ k: K, link: DEAD, verdict: 'fixed', newLink: 'https://zoom.us/j/6100000099', passcode: ' 555 ' }));
  check('new details are saved and the page comes back', [fixedRes.status, fixedRes.headers.location, saved.map((c) => [c.link, c.verdict, c.newLink, c.passcode])],
    [303, `/meeting-reports/?k=${K}`, [[DEAD, 'fixed', 'https://zoom.us/j/6100000099', '555']]]);
  check('and count straight away', changed, 1);
  const after = await req(server, 'GET', `/meeting-reports/?k=${K}`);
  check('once checked it leaves the list and shows as checked', [after.body.includes('Nothing to check right now.'), after.body.includes('New details saved')], [true, true]);
  check('it can be put back as listed', after.body.includes('Offer it as listed again'), true);
  await req(server, 'POST', '/meeting-reports/check', form({ k: K, link: DEAD, verdict: 'works', newLink: 'https://ignored.example' }));
  check('"it works" never keeps a new link', saved[1] && [saved[1].verdict, saved[1].newLink, saved[1].passcode], ['works', null, null]);
  server.close();

  group('a key made from the viewer\'s');
  const derived = load({ VIEWER_KEY: 'viewer-secret' });
  check('it is not the viewer key', [!!derived.link(), derived.link().includes('viewer-secret')], [true, false]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
