---
name: run-ai-sponsor-backend
description: Run, launch, start, boot, smoke-test, or debug the AI Sponsor backend (Express API on port 3001 — chat, registration, north-star metrics, scoreboard, voice relay). Use when asked to run the backend locally, check which subsystems are live, test an endpoint, or verify a change works against the real running server.
---

# Run the AI Sponsor backend

Express API behind the AI Sponsor product. `server.js` mounts chat (`/api/chat`,
Claude-backed SSE), registration (`/register` → GoHighLevel), north-star metrics,
the shared KPI scoreboard, Stripe checkout, WhatsApp, and a voice-relay
WebSocket. Production runs on Render at `https://ai-sponsor-f7de.onrender.com`;
the GitHub Pages frontend in the parent repo points at that URL.

Driven by `.claude/skills/run-ai-sponsor-backend/driver.mjs` — it boots the
server, probes every route, and prints which subsystems are live. **Start there,
not with `node server.js`.** All paths below are relative to `ai-sponsor-backend/`.

**The thing to understand first:** `server.js` reads ~24 env vars but `.env`
holds only two. It boots fine regardless — every subsystem degrades *silently*
and independently. "It started" tells you almost nothing about what works. The
driver exists to turn that silence into a readable matrix.

## Prerequisites

Node 24 / npm 11 (verified on `v24.14.1` / `11.11.0`). No other system packages.

```bash
npm install
```

## Run (agent path)

```bash
node .claude/skills/run-ai-sponsor-backend/driver.mjs --no-chat
```

Boots the server, probes it, tears it down. Exit 0 = every probe behaved as
expected for the env vars present. Verified output on a stock checkout:

```
Boot-time subsystems:
  DEGRADED  Postgres OFF — memory-only, history lost on restart
  DEGRADED  WhatsApp OFF — routes not mounted
  DEGRADED  Voice OFF — set OPENAI_API_KEY / XAI_API_KEY
Probes:
  PASS  /health -> ok, voiceProviders=[none]
  DEGRADED  /api/metrics/northstar -> 503 (GHL_API_TOKEN missing — expected locally)
  DEGRADED  /api/scoreboard -> 502 (SCOREBOARD_GITHUB_TOKEN missing — expected locally)
  PASS  /api/session -> saved profile
  SKIPPED  /api/chat (--no-chat)
```

`DEGRADED` is the correct local state, not a failure — those routes need keys
that aren't in `.env`. Only `FAIL` means something broke.

Modes:

| Command | Does |
|---|---|
| `node .claude/skills/run-ai-sponsor-backend/driver.mjs --no-chat` | Boot + probe. No model call, **no spend**. Use this by default. |
| `node .claude/skills/run-ai-sponsor-backend/driver.mjs` | Adds the real `/api/chat` streaming call. Costs Anthropic credits. Needs a live key (see below). |
| `node .claude/skills/run-ai-sponsor-backend/driver.mjs --prod` | Probes Render instead of booting locally. Boots nothing, spends nothing. |

`--prod` against the live deployment, verified:

```
  PASS  /health -> ok, voiceProviders=[openai,xai]
  PASS  /api/metrics/northstar -> 200 (GHL+Stripe live)
  PASS  /api/scoreboard -> 200
```

Use `--prod` to see what a fully-configured instance looks like — it's the
reference for what "everything on" means.

### To exercise the chat flow

**This is a local-only problem — production chat works.** The deployed site calls
Render (`ai-sponsor-chat.html` hardcodes the Render URL), and Render has its own
live key set in its dashboard. Nothing below affects users. Don't "fix" prod.

`.env`'s `ANTHROPIC_API_KEY` is **dead** — `401 invalid x-api-key`, confirmed by
calling `api.anthropic.com` directly with it, server not involved. The file was
last written 2026-06-10 and has drifted; later keys went to Render, not here.
Chat cannot run *locally* until you supply a live key. Get one from the Render
dashboard (`ai-sponsor-f7de` → Environment) or console.anthropic.com, then:

```bash
ANTHROPIC_API_KEY=sk-ant-... node .claude/skills/run-ai-sponsor-backend/driver.mjs
```

Don't write the key back into `.env` — it's gitignored, but this directory is a
clone of a repo that publishes to GitHub Pages.

## Run (human path)

```bash
node server.js
```

Serves on `http://localhost:3001` and prints its route list. Useful when you
want the server *held open* to hit by hand; the driver kills it after probing.
Ctrl-C to stop. Verified by hand:

```bash
curl -s http://localhost:3001/health
# {"status":"ok","service":"ai-sponsor-backend","voiceProviders":[]}
```

## Gotchas

- **A dead API key returns HTTP 200.** `/api/chat` sets up the SSE stream
  *before* calling Claude, so auth failures arrive as a `data: {"error": ...}`
  frame inside a 200 response. Checking the status code alone reports success on
  a completely broken chat. The driver greps the body for the error frame; do
  the same in any test you write against this route.
- **The `.env` in this repo is not a working config.** It has `ANTHROPIC_API_KEY`
  (dead) and `PORT`. The other ~22 vars — `DATABASE_URL`, `GHL_API_TOKEN`,
  `STRIPE_SECRET_KEY`, `SCOREBOARD_GITHUB_TOKEN`, `TWILIO_*`, `OPENAI_API_KEY`,
  `XAI_API_KEY` — live only on Render. `.env.example` documents just one of them,
  so it is not a checklist of what you need.
- **No DB means no memory.** Without `DATABASE_URL` the server holds profiles and
  conversation history in a RAM `Map`. Restarting wipes it, and the "sponsor
  remembers you" behavior — the product's whole point — cannot be tested locally.
  Anything about durable memory has to be checked against `--prod` or a real
  `DATABASE_URL`.
- **`POST /api/scoreboard` writes to GitHub.** It commits to the Company-Brain
  repo. The driver only ever issues the `GET`. Don't casually POST it.
- **`/api/metrics/northstar` caches for 10 minutes** (`server.js:379`). After
  changing metrics logic, a re-probe can return the old numbers — restart the
  server rather than assuming your change didn't take.
- **Render free tier cold-starts.** The first `--prod` probe can take ~50s. The
  driver allows 90s; a hand-rolled `curl` without `-m` may look like a hang.
- **The model is pinned to `claude-opus-4-6` in three separate places** —
  `server.js:344`, `server.js:609`, and `server.js:673`. That is a valid, active
  model, not a bug: just an older Opus than the current `claude-opus-4-8`. If a
  model upgrade ever is the task, all three have to change together, and only the
  one at 673 is on the `/api/chat` path the driver exercises — a partial edit will
  smoke-test clean while leaving two call sites behind.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/api/chat` → `401 invalid x-api-key` | The `.env` key is dead. Pass a live `ANTHROPIC_API_KEY` inline (above). |
| `EADDRINUSE` on 3001 | An earlier server is still up. `netstat -ano \| grep ":3001"`, then `Stop-Process -Id <pid> -Force` (PowerShell). |
| `/api/metrics/northstar` → 503 `GHL not configured` | Expected locally — no `GHL_API_TOKEN`. Use `--prod` to see it return real data. |
| `/api/scoreboard` → 502 | Expected locally — no `SCOREBOARD_GITHUB_TOKEN`. |
| driver: `server exited early` | Read the captured boot log it prints — the server's own stack trace is in there. |
