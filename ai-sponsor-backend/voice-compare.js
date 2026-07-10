// ─── Voice Comparison Relay (OpenAI Realtime vs xAI Grok Voice) ───────────────
// Internal test surface for Matt: voice-compare.html connects here via WebSocket
// and this module relays the OpenAI-compatible realtime protocol to the chosen
// provider. Keys never reach the browser, and the sponsor system prompt is
// injected SERVER-side so the page can't be repurposed for arbitrary prompts.
//
// Browser → wss://<backend>/api/voice/relay?provider=openai|xai&voice=<id> → provider WS.
// Both providers speak the same event protocol (xAI is OpenAI-compatible), so
// the only per-provider differences are the URL, auth, and session.update shape.

const WebSocket = require('ws');

// Hard cap per session so an abandoned tab can't run up per-minute audio billing.
const MAX_SESSION_MS = 10 * 60 * 1000;

// Voice IDs each provider currently supports. Kept as an explicit allow-list so
// a `voice` query param from the browser can only ever select a real, known
// voice — never get passed through to the provider unvalidated.
const VOICE_OPTIONS = {
  // OpenAI Realtime voices (per platform.openai.com/docs/guides/realtime-conversations).
  // marin/cedar are OpenAI's newest and recommended for best quality.
  openai: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
  // xAI Grok Voice — full current roster as of the 2026-07-06 expansion.
  // Tone tags noted for the ones most relevant to a recovery-support product:
  // carina (soft/empathetic/soothing - wellness/support), luna (gentle/patient/
  // nurturing - education/assistant), celeste (compassionate/confident/
  // reassuring - support/assistant), lux (grounded/calm/wise - wellness),
  // rigel (precise/professional/calm - assistant/support), naksh (warm/
  // thoughtful/wise - assistant/support). Full descriptions in docs.x.ai.
  xai: [
    'eve', 'ara', 'leo', 'rex', 'sal', // original five
    'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith',
    'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa',
    'sirius', 'lumen', 'castor', 'naksh', 'atlas',
  ],
};

const PROVIDERS = {
  openai: {
    enabled: () => !!process.env.OPENAI_API_KEY,
    url: () =>
      `wss://api.openai.com/v1/realtime?model=${process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'}`,
    headers: () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }),
    // GA realtime shape: audio config nested, voice under audio.output.
    sessionUpdate: (instructions, voice) => ({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions,
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            turn_detection: { type: 'server_vad' },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: voice || process.env.OPENAI_REALTIME_VOICE || 'marin',
          },
        },
      },
    }),
  },
  xai: {
    enabled: () => !!process.env.XAI_API_KEY,
    url: () =>
      `wss://api.x.ai/v1/realtime?model=${process.env.XAI_REALTIME_MODEL || 'grok-voice-latest'}`,
    headers: () => ({ Authorization: `Bearer ${process.env.XAI_API_KEY}` }),
    // Per docs.x.ai voice-agent: voice/instructions/turn_detection top-level.
    sessionUpdate: (instructions, voice) => ({
      type: 'session.update',
      session: {
        voice: voice || process.env.XAI_REALTIME_VOICE || 'eve',
        instructions,
        turn_detection: { type: 'server_vad' },
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24000 } },
          output: { format: { type: 'audio/pcm', rate: 24000 } },
        },
      },
    }),
  },
};

function enabledProviders() {
  return Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].enabled());
}

// Attach the WS relay to the existing HTTP server (the one app.listen returns).
function attach(server, instructions) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/api/voice/relay') {
      socket.destroy();
      return;
    }
    const provider = PROVIDERS[u.searchParams.get('provider')];
    if (!provider || !provider.enabled()) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    // Validate the requested voice against the allow-list for this provider.
    // Falls back to the provider's default (undefined -> env var -> hardcoded)
    // if the param is missing or not recognized, rather than erroring out.
    const providerName = u.searchParams.get('provider');
    const requestedVoice = u.searchParams.get('voice');
    const voice = VOICE_OPTIONS[providerName]?.includes(requestedVoice)
      ? requestedVoice
      : undefined;

    wss.handleUpgrade(req, socket, head, (client) => {
      relay(client, provider, instructions, voice);
    });
  });

  console.log(
    `Voice compare relay mounted. Providers enabled: ${enabledProviders().join(', ') || 'NONE (set OPENAI_API_KEY / XAI_API_KEY)'}`
  );
}

function relay(client, provider, instructions, voice) {
  const upstream = new WebSocket(provider.url(), { headers: provider.headers() });
  const pending = []; // client messages that arrive before upstream is open
  let closed = false;

  const killTimer = setTimeout(() => {
    safeSend(client, { type: 'relay.session_expired' });
    closeBoth();
  }, MAX_SESSION_MS);

  function closeBoth() {
    if (closed) return;
    closed = true;
    clearTimeout(killTimer);
    try { upstream.close(); } catch (e) { /* already closed */ }
    try { client.close(); } catch (e) { /* already closed */ }
  }

  function safeSend(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  upstream.on('open', () => {
    // The sponsor prompt is fixed server-side — first message, before any client input.
    upstream.send(JSON.stringify(provider.sessionUpdate(instructions, voice)));
    while (pending.length) upstream.send(pending.shift());
  });

  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });

  client.on('message', (data) => {
    const text = data.toString();
    // Block client-side session.update so the prompt/voice can't be overridden.
    try {
      if (JSON.parse(text).type === 'session.update') return;
    } catch (e) {
      return; // non-JSON frames are dropped
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else pending.push(text);
  });

  upstream.on('close', closeBoth);
  upstream.on('error', (err) => {
    console.error('[VoiceCompare] upstream error:', err.message);
    // 401/402/403 on the provider handshake = key/billing problem, not a bug —
    // say so, so testers don't chase a phantom outage (the xAI $0-credit case).
    const authish = /40[123]/.test(err.message || '');
    safeSend(client, {
      type: 'relay.error',
      message: authish
        ? 'This provider’s account isn’t funded/authorized yet — once credits are added it works with no other changes.'
        : 'Provider connection failed.',
    });
    closeBoth();
  });
  client.on('close', closeBoth);
  client.on('error', closeBoth);
}

module.exports = { attach, enabledProviders, VOICE_OPTIONS };