#!/usr/bin/env node
// Box — a multi-agent idea refinement room powered by your Claude subscription.
// Zero npm dependencies: plain Node http server + Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { listIdeas, loadIdea, saveIdea, createIdea, deleteIdea, addMessage, renameIdea } = require('./lib/store');
const { runIdea, pauseIdea, isRunning, currentSpeaker } = require('./lib/engine');
const { getAgents, getDebateOrder, addAgent, removeAgent } = require('./lib/agents');
const { saveUpload, getUpload, resolveIds, removeUploads } = require('./lib/uploads');
const { generateTitle } = require('./lib/title');

const PORT = Number(process.env.BOX_PORT || 3400);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- SSE bus: one stream per open page, carrying events for every idea ----
const clients = new Set();
function send(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}
const bus = {
  publish(ideaId, payload) { send({ ...payload, ideaId }); },
  broadcast(payload) { send(payload); },
};

function agentList() {
  const order = ['orchestrator', ...getDebateOrder()];
  const agents = getAgents();
  return order.map((id) => agents[id]).filter(Boolean).map(({ system, ...a }) => a);
}

// ---- helpers -------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function ideaSummary(i) {
  return {
    id: i.id, title: i.title, status: isRunning(i.id) ? 'running' : i.status,
    round: i.round, maxRounds: i.maxRounds, createdAt: i.createdAt, messageCount: i.messages.length,
    hasBrief: !!i.brief,
    lastActivity: i.messages.length ? i.messages[i.messages.length - 1].ts : i.createdAt,
  };
}

function nameIdea(idea) {
  generateTitle(idea.text)
    .then((title) => {
      if (idea.titleSource !== 'auto' || !loadIdea(idea.id)) return;
      renameIdea(idea, title, 'generated');
      bus.publish(idea.id, { event: 'renamed', title });
    })
    .catch(() => {}); // keep the provisional title
}

// Optional HTTP Basic auth (set BOX_PASSWORD to enable; any username works).
const BOX_PASSWORD = process.env.BOX_PASSWORD || '';
function checkAuth(req, res) {
  if (!BOX_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const decoded = Buffer.from(h.slice(6), 'base64').toString();
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (pass.length === BOX_PASSWORD.length &&
        require('crypto').timingSafeEqual(Buffer.from(pass), Buffer.from(BOX_PASSWORD))) {
      return true;
    }
  }
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Box"', 'Content-Type': 'text/plain' });
  res.end('Authentication required');
  return false;
}

// ---- server --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (!checkAuth(req, res)) return;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ event: 'hello' })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    // Layout report from the client, read back by the deploy script.
    if (p === '/api/diag' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const file = path.join(__dirname, 'data', 'diag.json');
      let list = [];
      try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      list = [{ at: new Date().toISOString(), ...body }, ...list].slice(0, 5);
      fs.writeFileSync(file, JSON.stringify(list, null, 1).slice(0, 20000));
      return json(res, 200, { ok: true });
    }

    // ---- agents ----
    if (p === '/api/agents' && req.method === 'GET') return json(res, 200, agentList());
    if (p === '/api/agents' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const agent = addAgent(body);
        bus.broadcast({ event: 'agents_changed' });
        return json(res, 201, agent);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    const am = p.match(/^\/api\/agents\/([a-z0-9-]+)$/);
    if (am && req.method === 'DELETE') {
      try {
        removeAgent(am[1]);
        bus.broadcast({ event: 'agents_changed' });
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // ---- uploads ----
    if (p === '/api/uploads' && req.method === 'POST') {
      try {
        const meta = await saveUpload(req, { name: url.searchParams.get('name'), type: req.headers['content-type'] });
        return json(res, 201, meta);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    const um = p.match(/^\/api\/uploads\/([a-f0-9]{16})$/);
    if (um && req.method === 'GET') {
      const u = getUpload(um[1]);
      if (!u) return json(res, 404, { error: 'file not found' });
      res.writeHead(200, {
        'Content-Type': u.meta.type,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${encodeURIComponent(u.meta.name)}"`,
      });
      return fs.createReadStream(u.path).pipe(res);
    }

    // ---- ideas ----
    if (p === '/api/ideas' && req.method === 'GET') {
      return json(res, 200, listIdeas().map(ideaSummary));
    }
    if (p === '/api/ideas' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      const attachments = resolveIds(body.attachments);
      if (!text && !attachments.length) return json(res, 400, { error: 'Describe your idea first.' });
      const maxRounds = Math.min(4, Math.max(1, Number(body.maxRounds) || 2));
      const idea = createIdea({
        title: body.title, text: text || 'See the attached files.', attachments, maxRounds,
      });
      if (idea.titleSource === 'auto') nameIdea(idea);
      if (body.autostart !== false) runIdea(bus, idea, { maxRounds });
      bus.broadcast({ event: 'ideas_changed' });
      return json(res, 201, idea);
    }

    const m = p.match(/^\/api\/ideas\/([a-f0-9]+)(?:\/([a-z]+))?$/);
    if (m) {
      const idea = loadIdea(m[1]);
      if (!idea) return json(res, 404, { error: 'idea not found' });
      const action = m[2];

      if (!action && req.method === 'GET') {
        return json(res, 200, { ...idea, status: isRunning(idea.id) ? 'running' : idea.status, speaker: currentSpeaker(idea.id) });
      }
      if (!action && req.method === 'PATCH') {
        const body = await readBody(req);
        const title = String(body.title || '').trim();
        if (!title) return json(res, 400, { error: 'Title cannot be empty.' });
        renameIdea(idea, title, 'user');
        bus.publish(idea.id, { event: 'renamed', title: idea.title });
        return json(res, 200, { ok: true, title: idea.title });
      }
      if (!action && req.method === 'DELETE') {
        pauseIdea(idea);
        removeUploads([...(idea.attachments || []), ...idea.messages.flatMap((x) => x.attachments || [])]);
        deleteIdea(idea.id);
        bus.broadcast({ event: 'ideas_changed', deleted: idea.id });
        return json(res, 200, { ok: true });
      }
      if (action === 'run' && req.method === 'POST') {
        const body = await readBody(req);
        if (isRunning(idea.id)) return json(res, 409, { error: 'already running' });
        runIdea(bus, idea, { maxRounds: body.maxRounds, models: body.models }); // fire and forget
        return json(res, 202, { ok: true });
      }
      if (action === 'pause' && req.method === 'POST') {
        pauseIdea(idea);
        return json(res, 202, { ok: true });
      }
      if (action === 'message' && req.method === 'POST') {
        // User steers the room; agents see this in the transcript next turn.
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        const attachments = resolveIds(body.attachments);
        if (!text && !attachments.length) return json(res, 400, { error: 'Write something or attach a file.' });
        const msg = addMessage(idea, {
          agentId: 'user', kind: 'user', round: idea.round,
          summary: (text || 'Attached files').slice(0, 140), content: text || 'See the attached files.',
          attachments,
        });
        bus.publish(idea.id, { event: 'message', message: msg });
        return json(res, 201, msg);
      }
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    return serveStatic(res, p);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// Recover ideas stuck in "running" from a previous process.
for (const i of listIdeas()) {
  if (i.status === 'running') { i.status = 'paused'; saveIdea(i); }
}

server.listen(PORT, () => {
  console.log(`\n  📦 Box is running → http://localhost:${PORT}\n`);
  console.log('  Agents speak through the Claude Code CLI using your Claude subscription.');
  console.log('  No API key. No SDK. Just `claude -p` under the hood.\n');
});
