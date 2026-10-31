/* ─── Checking meetings people said did not work ─────────────────────────────
   Matt, 30 Oct: users report a meeting in the chat, "AI Sponsor identifies the
   meeting, logs the issue, and flags it for verification. Once confirmed, we
   correct or remove the listing and use the updated information in future
   recommendations."

   The report and the hiding were already there (meetings.meetingProblemsIn,
   meetings.hiddenFrom). This is the person in the middle: one page listing
   every reported meeting nobody has checked yet, with its link and its
   official listing side by side, and three answers:
   - it works: offer it again
   - it has stopped: never offer it again (until its directory updates it)
   - the details have changed: offer it with the new link or passcode

   Nothing here is about who reported it, only the meeting and the few words
   the sponsor wrote down, the same as the Slack alert shows. So the gate is a
   key in the link, like a shared document link, and the key is its own: it
   opens this page and nothing else, never the conversations.

   New details somebody typed in a chat are never offered to anyone until a
   person has saved them here.
──────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const meetings = require('./meetings');

/* Its own key, or one made from the viewer's, so it works without another env
   var. Made with a one-way hash, so this link never gives away the viewer's. */
const KEY = process.env.MEETING_REVIEW_KEY
  || (process.env.VIEWER_KEY ? crypto.createHmac('sha256', process.env.VIEWER_KEY).update('meeting-reviews').digest('hex').slice(0, 32) : '');
const BASE = process.env.RENDER_EXTERNAL_URL || 'https://ai-sponsor-f7de.onrender.com';
const PATH = '/meeting-reports';
const VERDICTS = ['works', 'gone', 'fixed'];

/* The link that goes in the Slack alert, or null while no key is set. */
const link = () => (KEY ? `${BASE}${PATH}/?k=${KEY}` : null);

// Constant time, so a near-miss key cannot be found by timing the response.
function keyMatches(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(KEY);
  return !!KEY && a.length === b.length && crypto.timingSafeEqual(a, b);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const httpLink = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
const firstLink = (s) => (String(s || '').match(/https?:\/\/[^\s<>"']+/i) || [''])[0];
const VERDICT_WORDS = { works: 'Works, offered again', gone: 'Stopped, not offered', fixed: 'New details saved' };

/* Called after a check is saved, so the sponsor stops (or starts) offering it
   straight away instead of in five minutes. Set by server.js. */
let onChange = () => {};

const router = express.Router();

router.use((req, res, next) => {
  if (!KEY) return res.status(404).end();
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});

function meetingCard(m, said, k) {
  const fix = said.map((r) => r.fix).find(Boolean) || '';
  // Two forms, so Enter in the new link box can only ever save the new details.
  const hidden = `<input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="link" value="${esc(meetings.listedLink(m))}">`;
  const when = `${(m.days || []).map((d) => DAYS[d]).join(', ')} ${m.start || ''} ${String(m.zone || '').replace(/_/g, ' ')} time`;
  return `<section class="card">
  <h2>${esc(meetings.cleanName(m.name))}</h2>
  <p class="meta">${esc(m.program)} · ${esc(when)}</p>
  <ul class="said">${said.map((r) => `<li><b>${esc(day(r.at))}</b> ${esc(r.what || 'did not work')}${r.fix ? `<br><span class="fix">Right details they gave: ${esc(r.fix)}</span>` : ''}</li>`).join('')}</ul>
  <p>Meeting: <a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.link)}</a>${m.passcode ? ` · passcode ${esc(m.passcode)}` : ''}</p>
  ${m.source ? `<p>Official listing: <a href="${esc(m.source)}" target="_blank" rel="noopener">open it</a>${m.sourceUpdated ? ` (updated ${esc(day(m.sourceUpdated))})` : ''}</p>` : ''}
  <form method="post" action="${PATH}/check">${hidden}
    <div class="row"><button name="verdict" value="works">It works</button><button name="verdict" value="gone" class="stop">It has stopped</button></div>
  </form>
  <details${fix ? ' open' : ''}><summary>The details have changed</summary>
    <form method="post" action="${PATH}/check">${hidden}<input type="hidden" name="verdict" value="fixed">
      <label>New link<input name="newLink" inputmode="url" value="${esc(firstLink(fix))}" placeholder="https://"></label>
      <label>New passcode<input name="passcode" value=""></label>
      <p class="hint">Only save details you have seen on the official listing, or that you opened yourself.</p>
      <button>Save the new details</button>
    </form>
  </details>
</section>`;
}

router.get('/', async (req, res) => {
  if (!keyMatches(req.query.k)) return res.status(404).end();
  try {
    const [reports, checked] = await Promise.all([db.meetingReports(meetings.REPORT_DAYS), db.meetingChecks()]);
    meetings.setChecks(checked);
    const data = meetings.load() || { meetings: [] };
    const byLink = new Map(data.meetings.map((m) => [meetings.listedLink(m), m]));
    const latest = new Map();
    for (const c of checked) if (!latest.has(c.link)) latest.set(c.link, c);
    // Open: reported since its last check, or never checked, and still on our list.
    const open = new Map();
    for (const r of reports) {
      const c = latest.get(r.link);
      if (!byLink.has(r.link) || (c && Date.parse(c.at) >= Date.parse(r.at))) continue;
      if (!open.has(r.link)) open.set(r.link, []);
      open.get(r.link).push(r);
    }
    const recent = [...latest.values()].slice(0, 20);
    const k = String(req.query.k);
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Meetings to check</title>
<style>
  :root { --ink:#16233a; --muted:#5b6678; --line:#dfe3ea; --bg:#f6f7f9; --card:#fff; --go:#1f6f4a; --stop:#a33a2b; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e8ecf3; --muted:#a3adbd; --line:#2c3445; --bg:#11151d; --card:#1a2030; --go:#5fc79a; --stop:#f08a7a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width:640px; margin:0 auto; padding:20px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:18px; margin:0 0 2px; } h3 { font-size:16px; margin:28px 0 8px; }
  .lead, .meta, .hint, .empty { color:var(--muted); } .meta { margin:0 0 8px; font-size:14px; } .hint { font-size:13px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin:14px 0; }
  .said { margin:0 0 10px; padding-left:18px; } .fix { color:var(--go); }
  a { color:inherit; word-break:break-all; }
  .row { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 8px; }
  button { font:inherit; padding:10px 14px; border-radius:8px; border:1px solid var(--go); background:var(--go); color:#fff; cursor:pointer; }
  button.stop { background:transparent; color:var(--stop); border-color:var(--stop); }
  button.small { padding:4px 10px; font-size:14px; background:transparent; color:var(--ink); border-color:var(--line); }
  details { margin-top:6px; } summary { cursor:pointer; color:var(--muted); }
  label { display:block; margin:10px 0; font-size:14px; } input { display:block; width:100%; margin-top:4px; padding:10px; font:inherit; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); }
  .done { padding:0; list-style:none; } .done li { padding:8px 0; border-top:1px solid var(--line); font-size:14px; }
  .done form { display:inline; }
</style></head>
<body><main>
<h1>Meetings to check</h1>
<p class="lead">People told their sponsor these did not work. The sponsor stops offering each one until somebody checks it here. Open the meeting and its official listing, then choose.</p>
${open.size ? [...open].map(([l, said]) => meetingCard(byLink.get(l), said, k)).join('\n') : '<p class="empty">Nothing to check right now.</p>'}
${recent.length ? `<h3>Checked recently</h3><ul class="done">${recent.map((c) => {
  const m = byLink.get(c.link);
  return `<li><b>${esc(m ? meetings.cleanName(m.name) : c.link)}</b> · ${esc(VERDICT_WORDS[c.verdict] || c.verdict)}, ${esc(day(c.at))}${c.newLink ? ` · ${esc(c.newLink)}` : ''}${c.passcode ? ` · passcode ${esc(c.passcode)}` : ''}
  ${c.verdict !== 'works' ? `<form method="post" action="${PATH}/check"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="link" value="${esc(c.link)}"><button class="small" name="verdict" value="works">Offer it as listed again</button></form>` : ''}</li>`;
}).join('')}</ul>` : ''}
</main></body></html>`);
  } catch (e) {
    console.warn('[meeting-reviews] page failed:', e.message);
    res.status(500).type('text').send('Could not load the reports. Try again in a minute.');
  }
});

router.post('/check', express.urlencoded({ extended: false }), async (req, res) => {
  const b = req.body || {};
  if (!keyMatches(b.k)) return res.status(404).end();
  const verdict = String(b.verdict || '');
  const listed = String(b.link || '').trim();
  const newLink = String(b.newLink || '').trim() || null;
  const passcode = String(b.passcode || '').trim().slice(0, 40) || null;
  if (!VERDICTS.includes(verdict) || !httpLink(listed)) return res.status(400).type('text').send('That did not look right. Go back and try again.');
  if (verdict === 'fixed' && (!(newLink || passcode) || (newLink && !httpLink(newLink)))) {
    return res.status(400).type('text').send('Add a new link starting with https://, or a new passcode. Go back and try again.');
  }
  try {
    await db.addMeetingCheck({ link: listed, verdict, newLink: verdict === 'fixed' ? newLink : null, passcode: verdict === 'fixed' ? passcode : null });
    console.log(`[meeting-reviews] ${verdict}: ${listed}`);
    await onChange();
    res.redirect(303, `${PATH}/?k=${encodeURIComponent(b.k)}`);
  } catch (e) {
    console.warn('[meeting-reviews] check not saved:', e.message);
    res.status(500).type('text').send('Could not save that. Try again in a minute.');
  }
});

module.exports = { router, link, PATH, setOnChange(fn) { onChange = fn || (() => {}); } };
