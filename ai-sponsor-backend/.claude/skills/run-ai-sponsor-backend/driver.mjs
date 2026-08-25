#!/usr/bin/env node
// Smoke driver for ai-sponsor-backend.
//
// Boots server.js, waits for the port, then probes each route and reports which
// subsystems are actually live. The server starts fine with almost no env vars
// and degrades silently per-subsystem, so "it booted" tells you very little —
// this driver exists to turn that silence into a readable matrix.
//
//   node driver.mjs              boot + probe + chat (chat costs Anthropic credits)
//   node driver.mjs --no-chat    boot + probe only, no model call, no spend
//   node driver.mjs --prod       probe https://ai-sponsor-f7de.onrender.com, boot nothing
//
// Exit 0 = every probe behaved as expected for the env vars present.
// Exit 1 = something broke in a way the env vars don't explain.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../..'); // .claude/skills/run-*/ -> backend root
const PROD = 'https://ai-sponsor-f7de.onrender.com';

const args = new Set(process.argv.slice(2));
const useProd = args.has('--prod');
const skipChat = args.has('--no-chat');
const PORT = process.env.PORT || 3001;
const base = useProd ? PROD : `http://localhost:${PORT}`;

const log = (...a) => console.log(...a);
const ok = (m) => log(`  PASS  ${m}`);
const warn = (m) => log(`  DEGRADED  ${m}`);
const bad = (m) => log(`  FAIL  ${m}`);

let failures = 0;

// Render's free tier cold-starts (~50s); local is instant.
async function get(path, ms = useProd ? 90000 : 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(base + path, { signal: ctl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e.message) };
  } finally {
    clearTimeout(t);
  }
}

async function post(path, body, ms = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: String(e.message) };
  } finally {
    clearTimeout(t);
  }
}

function startServer() {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      out += d.toString();
      // server.js prints this line last, after every subsystem has reported in.
      if (out.includes('AI Sponsor backend running on')) resolvePromise({ proc, out });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) =>
      reject(new Error(`server exited early (code ${code}):\n${out}`)),
    );
    setTimeout(() => reject(new Error(`server did not start in 20s:\n${out}`)), 20000);
  });
}

// server.js announces each disabled subsystem on boot. Parse those lines rather
// than re-deriving config, so the matrix reflects what the server actually did.
function subsystems(bootLog) {
  return {
    db: !/DB NOT configured/.test(bootLog),
    whatsapp: !/WhatsApp routes NOT mounted/.test(bootLog),
    voice: !/Providers enabled: NONE/.test(bootLog),
  };
}

async function main() {
  let proc = null;
  let bootLog = '';

  if (useProd) {
    log(`\nProbing PRODUCTION ${PROD} (Render free tier: first hit may take ~50s)\n`);
  } else {
    log(`\nBooting local server from ${BACKEND}\n`);
    const started = await startServer();
    proc = started.proc;
    bootLog = started.out;
    const s = subsystems(bootLog);
    log('Boot-time subsystems:');
    s.db ? ok('Postgres/Neon (DATABASE_URL set)') : warn('Postgres OFF — memory-only, history lost on restart');
    s.whatsapp ? ok('WhatsApp/Twilio') : warn('WhatsApp OFF — routes not mounted');
    s.voice ? ok('Voice relay') : warn('Voice OFF — set OPENAI_API_KEY / XAI_API_KEY');
    log('');
  }

  log('Probes:');

  // /health is the only route with no external dependency — if this fails,
  // nothing else is worth reading.
  const health = await get('/health');
  if (health.status === 200) {
    const j = JSON.parse(health.text);
    ok(`/health -> ${j.status}, voiceProviders=[${j.voiceProviders.join(',') || 'none'}]`);
  } else {
    bad(`/health -> ${health.status} ${health.text.slice(0, 120)}`);
    failures++;
  }

  // These two 503/502 without their API keys. That's correct degradation, not a
  // bug — so only an unexpected status counts as a failure.
  const ns = await get('/api/metrics/northstar');
  if (ns.status === 200) ok('/api/metrics/northstar -> 200 (GHL+Stripe live)');
  else if (ns.status === 503 && /not configured/i.test(ns.text))
    warn(`/api/metrics/northstar -> 503 (GHL_API_TOKEN missing — expected locally)`);
  else {
    bad(`/api/metrics/northstar -> ${ns.status} ${ns.text.slice(0, 120)}`);
    failures++;
  }

  const sb = await get('/api/scoreboard');
  if (sb.status === 200) ok('/api/scoreboard -> 200');
  else if (sb.status === 502)
    warn('/api/scoreboard -> 502 (SCOREBOARD_GITHUB_TOKEN missing — expected locally)');
  else {
    bad(`/api/scoreboard -> ${sb.status} ${sb.text.slice(0, 120)}`);
    failures++;
  }

  if (!useProd) {
    const userId = `driver-smoke-${Date.now()}`;
    const sess = await post('/api/session', {
      userId,
      profile: { name: 'Driver Smoke', sobrietyDate: '2026-01-01' },
    });
    if (sess.status === 200 && JSON.parse(sess.text).success) ok('/api/session -> saved profile');
    else {
      bad(`/api/session -> ${sess.status} ${sess.text.slice(0, 120)}`);
      failures++;
    }

    if (skipChat) {
      log('  SKIPPED  /api/chat (--no-chat)');
    } else {
      // The core product flow. Streams SSE; an auth failure arrives as a
      // data: {"error": ...} frame with HTTP 200, NOT as a non-2xx status —
      // so status alone will tell you it passed when it did not.
      const chat = await post('/api/chat', {
        userId,
        message: 'Smoke test. Reply with one short sentence.',
      });
      const errFrame = /data: \{"error"/.test(chat.text);
      if (chat.status === 200 && !errFrame && /data: \{"text"/.test(chat.text)) {
        const txt = [...chat.text.matchAll(/data: (\{"text".*?\})\n/g)]
          .map((m) => JSON.parse(m[1]).text)
          .join('');
        ok(`/api/chat -> streamed ${txt.length} chars: "${txt.slice(0, 60)}..."`);
      } else if (/invalid x-api-key|authentication_error/.test(chat.text)) {
        bad('/api/chat -> ANTHROPIC_API_KEY in .env is rejected (401 invalid x-api-key).');
        log('        The committed .env key is dead. Pull a live key from the Render');
        log('        dashboard (ai-sponsor-f7de > Environment) or console.anthropic.com,');
        log('        then: ANTHROPIC_API_KEY=sk-ant-... node driver.mjs');
        failures++;
      } else {
        bad(`/api/chat -> ${chat.status} ${chat.text.slice(0, 200)}`);
        failures++;
      }
    }
  }

  if (proc) {
    proc.kill();
    log('\nServer stopped.');
  }

  log(failures === 0 ? '\nAll probes behaved as expected.\n' : `\n${failures} probe(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\ndriver error:', e.message);
  process.exit(1);
});
