'use strict';
const { spawn, exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

let apiRef = null;
let serveProc = null;
let servePort = null;
let serveUrl = null;

function getRandomHighPort() {
  return 32000 + Math.floor(Math.random() * 10000);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let i = 0; i < 20; i++) {
    const p = getRandomHighPort();
    if (await isPortFree(p)) return p;
  }
  return getRandomHighPort();
}

function waitForServe(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryFetch = async () => {
      if (Date.now() - start > timeoutMs) return reject(new Error('opencode serve timeout'));
      try {
        // Try health endpoint or just fetch root
        const res = await fetch(url + '/doc').catch(() => null);
        if (res && res.ok) return resolve();
        const res2 = await fetch(url + '/', { method: 'GET' }).catch(() => null);
        if (res2 && (res2.ok || res2.status === 404)) return resolve();
      } catch {}
      setTimeout(tryFetch, 300);
    };
    tryFetch();
  });
}

function listModelsViaCLI() {
  return new Promise((resolve, reject) => {
    exec('opencode models', { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      resolve(lines);
    });
  });
}

async function onLoad(api) {
  apiRef = api;
  api.log.info('opencode-provider onLoad');
}

async function onEnable(api) {
  apiRef = api;
  api.log.info('opencode-provider onEnable - spawning opencode serve on random high port');

  // 1. Find free high port and spawn opencode serve
  servePort = await findFreePort();
  serveUrl = `http://127.0.0.1:${servePort}`;
  api.log.info(`spawning opencode serve --port ${servePort}`);

  serveProc = spawn('opencode', ['serve', '--port', String(servePort)], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serveProc.stdout.on('data', (buf) => {
    const txt = buf.toString().slice(0, 500);
    api.log.debug(`opencode serve stdout: ${txt.slice(0,200)}`);
  });
  serveProc.stderr.on('data', (buf) => {
    const txt = buf.toString().slice(0, 500);
    api.log.debug(`opencode serve stderr: ${txt.slice(0,200)}`);
  });
  serveProc.on('exit', (code) => {
    api.log.warn(`opencode serve exited code=${code}`);
  });

  // 2. Wait until serving confirmed
  try {
    await waitForServe(serveUrl, 20000);
    api.log.info(`opencode serve confirmed at ${serveUrl}`);
  } catch (e) {
    api.log.error(`opencode serve failed to start: ${e.message}`);
    throw e;
  }

  // 3. Spawn subprocess that lists all models
  let models = [];
  try {
    models = await listModelsViaCLI();
    api.log.info(`opencode models listed: ${models.join(', ').slice(0,300)}`);
  } catch (e) {
    api.log.warn(`opencode models list failed: ${e.message}, using defaults`);
    models = ['opencode/big-pickle', 'opencode/muse-spark-1.2-contributor-free', 'opencode/nemotron-3-ultra-free'];
  }

  if (!models.length) {
    models = ['opencode/big-pickle'];
  }

  // Also add default Nexus AI models placeholder - will be replaced after we see opencode's models
  // For now add the opencode ones
  const modelObjects = models.map(id => ({
    id,
    description: `OpenCode model ${id} via opencode serve (${servePort})`
  }));

  // 4. Register provider that uses opencode serve API for chat
  // This provider will be used for all opencode models
  api.providers.register({
    id: 'opencode',
    name: 'OpenCode',
    description: `OpenCode serve at ${serveUrl} - streaming supported`,
    capabilities: { streaming: true, tools: true, vision: false, mcp: true },
    models: modelObjects,
    chat: async ({ messages, tools, temperature, maxTokens, signal, onEvent, model }) => {
      // Use the spawned serve's API
      // OpenCode serve API: POST /session/:id/message with streaming via SSE
      // For simplicity, we use the same logic as the opencode-ws-bridge but directly via HTTP
      const modelToUse = model || 'opencode/big-pickle';
      // Create a session if needed
      // We will create a new session per chat and send the messages
      const sessionRes = await fetch(`${serveUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'cf-ai-chat-provider' }),
        signal
      });
      if (!sessionRes.ok) throw new Error(`Failed to create opencode session: ${sessionRes.status}`);
      const session = await sessionRes.json();
      const sessionId = session.id;

      // Extract provider/model
      const [providerId, modelId] = String(modelToUse).split('/');
      const payload = {
        parts: [{ type: 'text', text: messages[messages.length - 1]?.content?.[0]?.text || messages[messages.length - 1]?.content || '' }],
        agent: 'build',
        model: { providerID: providerId || 'opencode', modelID: modelId || 'big-pickle' }
      };
      // Simplified: just send last user message as prompt
      // For full history, we would need to convert messages, but this is a demo provider
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      let promptText = '';
      if (lastUser) {
        if (typeof lastUser.content === 'string') promptText = lastUser.content;
        else if (Array.isArray(lastUser.content)) {
          promptText = lastUser.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
        } else promptText = String(lastUser.content);
      }
      if (!promptText) promptText = 'hello';

      const msgRes = await fetch(`${serveUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: promptText }],
          agent: 'build',
          model: { providerID: providerId || 'opencode', modelID: modelId || 'big-pickle' }
        }),
        signal
      });
      if (!msgRes.ok) {
        const txt = await msgRes.text().catch(()=>'');
        throw new Error(`opencode message failed ${msgRes.status}: ${txt.slice(0,300)}`);
      }
      const data = await msgRes.json();
      // data.parts contains response
      let fullText = '';
      for (const p of data.parts || []) {
        if (p.type === 'text' && p.text) fullText += p.text;
      }
      if (!fullText) fullText = JSON.stringify(data).slice(0,500);

      // Stream it back in chunks to support streaming
      if (onEvent) {
        for (const chunk of fullText.match(/.{1,20}/g) || [fullText]) {
          if (signal?.aborted) break;
          onEvent({ type: 'text', text: chunk });
          await new Promise(r => setTimeout(r, 15));
        }
        return { done: true, usage: {} };
      } else {
        return { content: fullText, usage: {} };
      }
    }
  });

  // Also add a specific Nexus AI provider placeholder (user asked for Nexus AI mod next)
  // For now we just log that we saw the models and are ready to make Nexus mod
  api.log.info(`opencode provider registered with ${modelObjects.length} models, ready for Nexus AI mod`);

  // Persist serve info for potential other mods
  await api.storage.writeFile('serve-info.json', JSON.stringify({ url: serveUrl, port: servePort, models }, null, 2));
}

async function onDisable(api) {
  api.log.info('opencode-provider onDisable');
  if (serveProc) {
    try {
      const { execSync } = require('child_process');
      try { execSync(`taskkill /pid ${serveProc.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    } catch {}
    try { serveProc.kill(); } catch {}
    serveProc = null;
  }
}

async function onUnload(api) {
  (api || apiRef).log.info('opencode-provider onUnload');
  if (serveProc) {
    try { serveProc.kill(); } catch {}
    serveProc = null;
  }
}

module.exports = { onLoad, onEnable, onDisable, onUnload };
