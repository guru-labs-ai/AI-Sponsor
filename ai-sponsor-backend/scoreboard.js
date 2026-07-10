// Shared storage for the Guru team KPI scoreboard (weekly-scoreboard.html on
// GitHub Pages). The page is static, so edits used to die in each viewer's
// localStorage; these endpoints give everyone one shared board.
//
// Storage = a JSON file committed to the dashboard repo itself. No database
// needed, every save is versioned, and the repo is already the source of
// truth for the dashboards. Requires one env var:
//   SCOREBOARD_GITHUB_TOKEN — token with write access to the repo below

const GH_REPO = 'guru-labs-ai/Company-Brain';
const GH_PATH = 'scoreboard-data.json';
const GH_API = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;

const CACHE_MS = 30 * 1000;
let cache = { state: null, sha: null, ts: 0 };

function ghHeaders() {
  return {
    Authorization: `token ${process.env.SCOREBOARD_GITHUB_TOKEN}`,
    'User-Agent': 'Guru-Scoreboard',
    Accept: 'application/vnd.github.v3+json',
  };
}

async function ghRead() {
  const resp = await fetch(GH_API, { headers: ghHeaders() });
  if (resp.status === 404) return { state: null, sha: null };
  if (!resp.ok) throw new Error(`GitHub read failed: ${resp.status}`);
  const body = await resp.json();
  const state = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
  return { state, sha: body.sha };
}

async function ghWrite(state, sha) {
  const resp = await fetch(GH_API, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Scoreboard: shared save from the live board',
      content: Buffer.from(JSON.stringify(state, null, 1)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`GitHub write failed: ${resp.status}`);
  return (await resp.json()).content.sha;
}

// Merge two boards. Weeks match by name, products within a week match by
// name; whichever side touched a product more recently (updatedAt stamped by
// the page on every edit) wins that product. Weeks/products that exist on
// only one side are kept — nothing a PM added ever silently disappears.
function merge(base, incoming) {
  if (!base) return incoming;
  if (!incoming) return base;
  const out = JSON.parse(JSON.stringify(base));
  for (const inWeek of incoming.weeks || []) {
    const week = (out.weeks || []).find((w) => w.name === inWeek.name);
    if (!week) { out.weeks.push(inWeek); continue; }
    for (const inProd of inWeek.products || []) {
      const i = week.products.findIndex((p) => p.name === inProd.name);
      if (i === -1) { week.products.push(inProd); continue; }
      if ((inProd.updatedAt || 0) >= (week.products[i].updatedAt || 0)) week.products[i] = inProd;
    }
  }
  return out;
}

async function getScoreboard(req, res) {
  try {
    if (!cache.state || Date.now() - cache.ts > CACHE_MS) {
      const { state, sha } = await ghRead();
      cache = { state, sha, ts: Date.now() };
    }
    res.json({ state: cache.state });
  } catch (err) {
    console.error('[scoreboard] read error:', err.message);
    res.status(502).json({ error: 'could not load shared scoreboard' });
  }
}

async function postScoreboard(req, res) {
  // No auth by team decision (Jul 10): tiny team, unlisted URL, and every
  // save is a GitHub commit so any vandalism is one revert away.
  const incoming = req.body && req.body.state;
  if (!incoming || !Array.isArray(incoming.weeks)) {
    return res.status(400).json({ error: 'state.weeks missing' });
  }
  // Two attempts: a concurrent save changes the file sha, GitHub rejects with
  // 409, we re-read and re-merge so neither PM's edits are lost.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { state: current, sha } = await ghRead();
      const merged = merge(current, incoming);
      const newSha = await ghWrite(merged, sha);
      cache = { state: merged, sha: newSha, ts: Date.now() };
      return res.json({ state: merged });
    } catch (err) {
      if (attempt === 1) {
        console.error('[scoreboard] write error:', err.message);
        return res.status(502).json({ error: 'could not save shared scoreboard' });
      }
    }
  }
}

module.exports = { getScoreboard, postScoreboard };
