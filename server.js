#!/usr/bin/env node
// Box — a multi-agent idea refinement room powered by your Claude subscription.
// Zero npm dependencies: plain Node http server + Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listIdeas, loadIdea, saveIdea, createIdea, deleteIdea, addMessage, renameIdea, promoteIdea } = require('./lib/store');
const { runIdea, pauseIdea, isRunning, currentSpeaker } = require('./lib/engine');
const { runPlanning, approvePlan, runBuild, completeProject, onOwnerMessage, resumeProject, pauseProject, projectRunning, projectSpeaker, deployStatus } = require('./lib/project');
const { getCrew } = require('./lib/crew');
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

const running = (id) => isRunning(id) || projectRunning(id);
const speaker = (id) => currentSpeaker(id) || projectSpeaker(id);

function ideaSummary(i) {
  return {
    id: i.id, title: i.title, status: running(i.id) ? 'running' : i.status,
    phase: i.phase || 'idea', stage: i.project?.stage || null,
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

// Sign-in: when BOX_PASSWORD is set, the API requires a session cookie,
// obtained once per device from POST /api/login. The page itself is public
// so it can show the sign-in screen.
const BOX_PASSWORD = process.env.BOX_PASSWORD || '';
const SESSION = BOX_PASSWORD ? crypto.createHmac('sha256', BOX_PASSWORD).update('box-session-v1').digest('hex') : '';
const loginAttempts = new Map(); // ip -> [timestamps]

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function isAuthed(req) {
  if (!BOX_PASSWORD) return true;
  const c = cookies(req).box_session;
  return !!c && sameSecret(c, SESSION);
}
function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `box_session=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// ---- server --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/session' && req.method === 'GET') {
      return json(res, 200, { loginRequired: !!BOX_PASSWORD, authed: isAuthed(req) });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const ip = clientIp(req);
      const recent = (loginAttempts.get(ip) || []).filter((t) => Date.now() - t < 10 * 60 * 1000);
      if (recent.length >= 10) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const body = await readBody(req).catch(() => ({}));
      if (!BOX_PASSWORD || sameSecret(body.password || '', BOX_PASSWORD)) {
        loginAttempts.delete(ip);
        res.setHeader('Set-Cookie', sessionCookie(req, SESSION, 365 * 24 * 3600));
        return json(res, 200, { ok: true });
      }
      loginAttempts.set(ip, [...recent, Date.now()]);
      return json(res, 401, { error: 'That password isn’t right.' });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/api/') && !isAuthed(req)) {
      return json(res, 401, { error: 'Sign in to continue.', login: true });
    }

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
    if (p === '/api/crew' && req.method === 'GET') return json(res, 200, getCrew());
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
        return json(res, 200, { ...idea, status: running(idea.id) ? 'running' : idea.status, speaker: speaker(idea.id), deployReady: deployStatus() });
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
        pauseProject(idea);
        removeUploads([...(idea.attachments || []), ...idea.messages.flatMap((x) => x.attachments || [])]);
        deleteIdea(idea.id);
        bus.broadcast({ event: 'ideas_changed', deleted: idea.id });
        return json(res, 200, { ok: true });
      }
      if (action === 'promote' && req.method === 'POST') {
        if (idea.phase === 'project') return json(res, 409, { error: 'Already a project.' });
        if (isRunning(idea.id)) return json(res, 409, { error: 'Wait for the debate to finish first.' });
        if (!idea.brief) return json(res, 409, { error: 'The idea needs a finished brief before it can be promoted.' });
        const msg = promoteIdea(idea);
        bus.publish(idea.id, { event: 'promoted', message: msg });
        bus.broadcast({ event: 'ideas_changed' });
        runPlanning(bus, idea); // the planning crew starts right away
        return json(res, 200, { ok: true, project: idea.project });
      }
      if (action === 'approve' && req.method === 'POST') {
        if (idea.phase !== 'project') return json(res, 409, { error: 'Only projects have a plan to approve.' });
        if (running(idea.id)) return json(res, 409, { error: 'Wait for the crew to finish first.' });
        try {
          const msg = approvePlan(bus, idea);
          bus.broadcast({ event: 'ideas_changed' });
          runBuild(bus, idea); // the build crew starts right away
          return json(res, 200, { ok: true, message: msg, stage: idea.project.stage });
        } catch (e) {
          return json(res, 409, { error: e.message });
        }
      }
      if (action === 'complete' && req.method === 'POST') {
        if (idea.phase !== 'project') return json(res, 409, { error: 'Only projects can be marked complete.' });
        if (running(idea.id)) return json(res, 409, { error: 'Wait for the crew to finish first.' });
        try {
          const msg = completeProject(bus, idea);
          bus.broadcast({ event: 'ideas_changed' });
          return json(res, 200, { ok: true, message: msg, stage: idea.project.stage });
        } catch (e) {
          return json(res, 409, { error: e.message });
        }
      }
      if (action === 'run' && req.method === 'POST') {
        const body = await readBody(req);
        if (running(idea.id)) return json(res, 409, { error: 'already running' });
        if (idea.phase === 'project') {
          try { resumeProject(bus, idea); } catch (e) { return json(res, 409, { error: e.message }); }
          return json(res, 202, { ok: true });
        }
        runIdea(bus, idea, { maxRounds: body.maxRounds, models: body.models }); // fire and forget
        return json(res, 202, { ok: true });
      }
      if (action === 'pause' && req.method === 'POST') {
        pauseIdea(idea);
        pauseProject(idea);
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
        // Feedback on a finished plan, a live site or a project in maintenance
        // sends the crew back to work on it.
        if (idea.phase === 'project') onOwnerMessage(bus, idea, text || 'See the attached files.');
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
