/* Guards the conversation viewer's access control. Run: node test-viewer.js

   Offline. No database, no network beyond localhost: db is stubbed and the
   router runs in a real express app.

   Why this file exists. This feature reads the most sensitive data the company
   holds, from a PUBLIC repo, and every failure mode is silent:

   1. Reachable before anyone configured it.
   2. Content served to a request carrying no session.
   3. A session cookie that can be forged, or extended without the key.
   4. The key surviving in the address bar, where it reaches history, the
      referrer header and any screenshot of Matt's phone.
   5. A credential ending up in the page, which is what caused July.          */
const path = require('path');
const http = require('http');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
}
const group = (t) => console.log(`\n— ${t}`);

// Stub the database before viewer.js requires it.
const dbPath = require.resolve(path.resolve(__dirname, 'db.js'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    logAdminAccess: async () => {},
    listConversations: async () => ([
      { person: 'someone@example.com', name: 'Sam', access: 'Paid', messages: 2,
        first_at: '2026-08-20T10:00:00Z', last_at: '2026-08-30T10:00:00Z' },
    ]),
    getFullThread: async () => ([
      { role: 'user', content: 'i had a rough night', created_at: '2026-08-20T10:00:00Z' },
      { role: 'assistant', content: 'thanks for telling me', created_at: '2026-08-20T10:01:00Z' },
    ]),
  },
};

const express = require('express');
const VIEWER = path.resolve(__dirname, 'viewer.js');
const REAL_KEY = 'k'.repeat(48);

function load() {
  delete require.cache[require.resolve(VIEWER)];
  return require(VIEWER);
}

function serve(mod) {
  const app = express();
  app.use('/admin', mod.router);
  return http.createServer(app);
}

function request(server, url, { cookie } = {}) {
  return new Promise((resolve) => {
    const { port } = server.address();
    const req = http.request({
      host: '127.0.0.1', port, method: 'GET', path: url,
      headers: cookie ? { Cookie: cookie } : {},
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    req.end();
  });
}

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const close = (s) => new Promise((r) => s.close(r));

(async () => {
  group('unconfigured means unreachable, not unauthorized');
  delete process.env.VIEWER_KEY;
  const off = load();
  check('the module reports itself off', off.enabled, false);
  let s = serve(off); await listen(s);
  check('the page 404s', (await request(s, '/admin/')).status, 404);
  check('the data 404s too', (await request(s, '/admin/api/conversations')).status, 404);
  await close(s);

  process.env.VIEWER_KEY = REAL_KEY;
  const on = load();
  s = serve(on); await listen(s);

  group('nothing without the key, and no hint that anything is here');
  let r = await request(s, '/admin/');
  check('the bare page 404s', r.status, 404);
  check('no login screen to find', /password|sign in|login/i.test(r.body), false);
  check('conversation list 404s', (await request(s, '/admin/api/conversations')).status, 404);
  r = await request(s, '/admin/api/conversations');
  check('and nothing leaks in the refusal', /rough night|Sam|example\.com/.test(r.body), false);

  group('a wrong key is indistinguishable from no route');
  check('wrong key', (await request(s, '/admin/?k=' + 'x'.repeat(48))).status, 404);
  check('empty key', (await request(s, '/admin/?k=')).status, 404);
  check('a prefix of the real key', (await request(s, '/admin/?k=' + 'k'.repeat(20))).status, 404);

  group('the real link lets Matt in without typing anything');
  r = await request(s, '/admin/?k=' + REAL_KEY);
  check('it redirects', r.status, 302);
  check('to the bare path, so the key leaves the address bar', r.headers.location, '/admin/');
  const setCookie = String(r.headers['set-cookie'] || '');
  check('the cookie is httpOnly, so no script can read it', /HttpOnly/i.test(setCookie), true);
  check('it is Secure', /Secure/i.test(setCookie), true);
  check('it is scoped to /admin', /Path=\/admin/i.test(setCookie), true);
  check('the key is NOT in the cookie', setCookie.includes(REAL_KEY), false);

  const cookie = setCookie.split(';')[0];

  group('with a session, the data flows');
  check('the page renders', (await request(s, '/admin/', { cookie })).status, 200);
  r = await request(s, '/admin/api/conversations', { cookie });
  check('list is allowed', r.status, 200);
  const list = JSON.parse(r.body);
  check('one person', list.length, 1);
  check('the email is NOT handed to the browser', JSON.stringify(list).includes('example.com'), false);
  check('the id is opaque', /^[0-9a-f]{16}$/.test(list[0].id), true);

  r = await request(s, '/admin/api/conversations/' + list[0].id, { cookie });
  check('the thread is allowed', r.status, 200);
  check('oldest message first', JSON.parse(r.body).messages[0].content, 'i had a rough night');

  group('a forged or expired session is refused');
  check('tampered signature', (await request(s, '/admin/api/conversations',
    { cookie: `ais_viewer=${Date.now() + 60000}.${'0'.repeat(64)}` })).status, 404);
  check('an expiry pushed into the future without the key',
    (await request(s, '/admin/api/conversations',
      { cookie: `ais_viewer=${Date.now() + 9e9}.${cookie.split('.')[1]}` })).status, 404);
  check('an already expired session',
    (await request(s, '/admin/api/conversations', { cookie: 'ais_viewer=1.abc' })).status, 404);
  check('garbage', (await request(s, '/admin/api/conversations', { cookie: 'ais_viewer=x' })).status, 404);
  await close(s);

  group('rotating the key kills every link already sent');
  process.env.VIEWER_KEY = 'r'.repeat(48);
  const rotated = load();
  s = serve(rotated); await listen(s);
  check('yesterday\'s session no longer opens anything',
    (await request(s, '/admin/api/conversations', { cookie })).status, 404);
  check('and the old link no longer works',
    (await request(s, '/admin/?k=' + REAL_KEY)).status, 404);
  await close(s);

  group('the page in the public repo holds nothing worth finding');
  const html = fs.readFileSync(path.join(__dirname, 'viewer.html'), 'utf8');
  check('no key', html.includes('VIEWER_KEY') || html.includes(REAL_KEY), false);
  check('no admin key', /x-admin-key|ADMIN_API_KEY/i.test(html), false);
  check('no key-shaped literals', /(sk_live|xoxb-|pk_[0-9]{6,}_|EAA[A-Za-z0-9]{40,})/.test(html), false);
  check('it is noindex', /noindex/.test(html), true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
