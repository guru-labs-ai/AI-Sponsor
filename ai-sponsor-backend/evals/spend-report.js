/* What a test run cost, kept apart from what members cost.

   The test runners use the same Anthropic account as the live sponsor, so
   without this every test day looked like members suddenly costing ten or
   twenty times more (15 Nov: $122 on the bill, 31 member replies). Each
   runner calls start() once the code under test is loaded: from then on
   every Claude call it makes, the sponsor's replies and the judge's grading
   alike, is priced by spend.js into this tally instead of the live server's.

   finish() prints the total and files it on the dashboard as `testing`
   through /api/admin/spend. That needs ADMIN_API_KEY in the env (the same
   value as on Render). Without it the total is still printed, and the
   dashboard simply does not know about the run, which it says nothing about:
   so run it with the key whenever the run uses the live account. */
const path = require('path');

const REPORT_URL = process.env.SPEND_REPORT_URL || 'https://ai-sponsor-f7de.onrender.com/api/admin/spend';

function start(backendDir, label, judgeClient) {
  const spend = require(path.join(backendDir, 'spend.js'));
  const tally = new Map();
  spend.setSink((row) => {
    const key = `${row.kind}|${row.model}`;
    const t = tally.get(key) || { kind: row.kind, model: row.model, calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
    t.calls += row.calls; t.input += row.input; t.cacheWrite += row.cacheWrite;
    t.cacheRead += row.cacheRead; t.output += row.output; t.cost += row.cost;
    tally.set(key, t);
  });
  if (judgeClient) spend.instrument(judgeClient, 'judge');

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    const rows = [...tally.values()].map((r) => ({ ...r, kind: `test-${r.kind}` }));
    const total = rows.reduce((a, r) => a + r.cost, 0);
    console.log(`\nThis run cost $${total.toFixed(2)} on the Anthropic account (${rows.map((r) => `${r.kind} ${r.model} $${r.cost.toFixed(2)}`).join(', ') || 'no calls'})`);
    if (!rows.length) return;
    if (!process.env.ADMIN_API_KEY) {
      console.log('Not filed on the dashboard: set ADMIN_API_KEY to report test runs as testing.');
      return;
    }
    try {
      const res = await fetch(REPORT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY },
        body: JSON.stringify({ label, rows }),
      });
      const body = await res.json().catch(() => ({}));
      console.log(res.ok ? `Filed on the dashboard as testing: $${body.cost}` : `Could not file it on the dashboard: HTTP ${res.status} ${body.error || ''}`);
    } catch (e) {
      console.log(`Could not file it on the dashboard: ${e.message}`);
    }
  }
  return { finish, tally };
}

module.exports = { start };
