#!/usr/bin/env node
// Box — a multi-agent idea refinement room powered by your Claude subscription.
// Zero npm dependencies: plain Node http server + Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listIdeas, loadIdea, saveIdea, createIdea, deleteIdea, addMessage, renameIdea, promoteIdea, forkIdea, mergeIdeas } = require('./lib/store');
const { runIdea, runQuick, generateExtra, compareIdeas, trendTurn, EXTRAS, pauseIdea, isRunning, currentSpeaker } = require('./lib/engine');
const { runPlanning, approvePlan, runBuild, completeProject, onOwnerMessage, resumeProject, editTasks, revertTask, chooseDesign, pauseProject, projectRunning, projectSpeaker, deployStatus } = require('./lib/project');
const { getCrew } = require('./lib/crew');
const { getAgents, getDebateOrder, addAgent, removeAgent, updateAgent, installPreset, agentFromText, TEMPLATES, PRESETS, TRAITS } = require('./lib/agents');
const { saveUpload, getUpload, resolveIds, removeUploads, saveGenerated } = require('./lib/uploads');
const prefs = require('./lib/prefs');
const deployOps = require('./lib/deploy');
const { askClaude } = require('./lib/claude');
const { generateTitle } = require('./lib/title');
const push = require('./lib/push');
const { needsYouCount } = require('./lib/notify');
const { checkNames } = require('./lib/names');
const { zip } = require('./lib/zip');
const monitor = require('./lib/monitor');
const builder = require('./lib/builder');

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
    hasBrief: !!i.brief, tags: i.tags || [], archived: !!i.archived, template: i.template || null,
    score: i.scorecard?.avg ?? null, url: i.project?.url || null, uptime: i.project?.uptime ? { up: i.project.uptime.up, checkedAt: i.project.uptime.checkedAt } : null,
    tasks: i.project?.tasks ? { done: i.project.tasks.filter((t) => t.status === 'done').length, total: i.project.tasks.length } : null,
    forkedFrom: i.forkedFrom || null,
    lastActivity: i.messages.length ? i.messages[i.messages.length - 1].ts : i.createdAt,
  };
}

/** Agent time used, this calendar month and in total, from message durations. */
function usageStats() {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const t0 = monthStart.getTime();
  let monthMs = 0, totalMs = 0, monthTurns = 0;
  const byIdea = [];
  for (const i of listIdeas()) {
    let m = 0, all = 0;
    for (const msg of i.messages) {
      const d = msg.durationMs || 0;
      all += d;
      if (msg.ts >= t0) { m += d; monthTurns += 1; }
    }
    for (const t of i.project?.tasks || []) { const d = t.durationMs || 0; all += d; if ((t.finishedAt || 0) >= t0) m += d; }
    monthMs += m; totalMs += all;
    if (m) byIdea.push({ id: i.id, title: i.title, ms: m });
  }
  byIdea.sort((a, b) => b.ms - a.ms);
  return { monthMs, totalMs, monthTurns, byIdea: byIdea.slice(0, 10), monthStart: t0 };
}

/** Links the researchers cited, across every idea. */
function sourceLibrary() {
  const out = [];
  const seen = new Set();
  for (const i of listIdeas()) {
    for (const m of i.messages) {
      if (m.kind !== 'research' && m.kind !== 'doc') continue;
      const re = /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g;
      let x;
      while ((x = re.exec(m.content || ''))) {
        const key = `${i.id}|${x[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let host = '';
        try { host = new URL(x[2]).hostname.replace(/^www\./, ''); } catch {}
        out.push({ ideaId: i.id, ideaTitle: i.title, agentId: m.agentId, title: x[1], url: x[2], host, ts: m.ts });
      }
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function searchAll(q) {
  const needle = q.toLowerCase();
  const hits = [];
  const snip = (text) => {
    const i = text.toLowerCase().indexOf(needle);
    if (i < 0) return null;
    return text.slice(Math.max(0, i - 60), i + needle.length + 80).replace(/\s+/g, ' ');
  };
  for (const i of listIdeas()) {
    if (i.title.toLowerCase().includes(needle) || (i.text || '').toLowerCase().includes(needle)) hits.push({ ideaId: i.id, ideaTitle: i.title, where: 'idea', snippet: snip(i.title) || snip(i.text) });
    if (i.brief && i.brief.toLowerCase().includes(needle)) hits.push({ ideaId: i.id, ideaTitle: i.title, where: 'brief', snippet: snip(i.brief) });
    for (const d of Object.values(i.project?.docs || {})) if ((d.content || '').toLowerCase().includes(needle)) hits.push({ ideaId: i.id, ideaTitle: i.title, where: d.title, docKey: d.key, snippet: snip(d.content) });
    let n = 0;
    for (const m of i.messages) {
      if (n >= 3) break;
      if ((m.content || '').toLowerCase().includes(needle)) { hits.push({ ideaId: i.id, ideaTitle: i.title, where: m.agentName || m.agentId, messageId: m.id, snippet: snip(m.content) }); n += 1; }
    }
  }
  return hits.slice(0, 60);
}

function exportAll() {
  const entries = [];
  for (const i of listIdeas()) {
    const dir = `${i.project?.slug || i.id}`;
    entries.push({ name: `${dir}/idea.json`, data: JSON.stringify(i, null, 2), mtime: i.createdAt });
    if (i.brief) entries.push({ name: `${dir}/brief.md`, data: i.brief });
    for (const d of Object.values(i.project?.docs || {})) entries.push({ name: `${dir}/docs/${d.key}.md`, data: d.content, mtime: d.updatedAt });
    for (const e of Object.values(i.extras || {})) entries.push({ name: `${dir}/extras/${e.kind}.md`, data: e.content, mtime: e.ts });
    if (i.project?.prototype) { const u = getUpload(i.project.prototype.id); if (u) entries.push({ name: `${dir}/prototype.html`, data: fs.readFileSync(u.path) }); }
    const transcript = i.messages.map((m) => `## ${m.agentName || m.agentId} · ${m.kind} · round ${m.round} · ${new Date(m.ts).toISOString()}\n\n${m.content}\n`).join('\n');
    entries.push({ name: `${dir}/transcript.md`, data: `# ${i.title}\n\n${i.text}\n\n${transcript}` });
  }
  try { entries.push({ name: 'agents.json', data: fs.readFileSync(path.join(__dirname, 'data', 'agents.json')) }); } catch {}
  return zip(entries);
}

/** Fetch the pages linked in an idea's text and attach their readable text. */
async function ingestUrls(text) {
  const urls = [...new Set((String(text).match(/https?:\/\/[^\s)>\]]+/g) || []).slice(0, 3))];
  const out = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Box/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !/text\/html|text\/plain/.test(ct)) continue;
      let html = (await r.text()).slice(0, 2_000_000);
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || u;
      const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/li>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim().slice(0, 30000);
      if (body.length < 200) continue;
      out.push(saveGenerated({ name: `${title.trim().slice(0, 60) || 'page'}.txt`, type: 'text/plain', content: `Source: ${u}\nTitle: ${title.trim()}\n\n${body}` }));
    } catch {}
  }
  return out;
}

/** Browse a project's repository: a directory listing or a text file. */
function repoBrowse(slug, rel) {
  const root = builder.repoDir(slug);
  const target = path.normalize(path.join(root, rel || ''));
  if (!target.startsWith(root)) throw new Error('Outside the repository.');
  if (!fs.existsSync(target)) throw new Error('Not found.');
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    const items = fs.readdirSync(target).filter((n) => !['.git', 'node_modules', '.next', 'dist', '.venv', '__pycache__'].includes(n))
      .map((n) => { const s = fs.statSync(path.join(target, n)); return { name: n, dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs }; })
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    return { path: path.relative(root, target), dir: true, items };
  }
  if (st.size > 200 * 1024) return { path: path.relative(root, target), dir: false, tooBig: true, size: st.size };
  const buf = fs.readFileSync(target);
  const binary = buf.subarray(0, 1000).some((b) => b === 0);
  return { path: path.relative(root, target), dir: false, size: st.size, binary, content: binary ? null : buf.toString('utf8') };
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

    // ---- push notifications (home-screen app) ----
    if (p === '/api/push/key' && req.method === 'GET') {
      return json(res, 200, { publicKey: push.publicKey(), devices: push.count(), needsYou: needsYouCount() });
    }
    if (p === '/api/push/subscribe' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const devices = push.subscribe(body.subscription, { ua: req.headers['user-agent'] });
        return json(res, 201, { ok: true, devices });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (p === '/api/push/unsubscribe' && req.method === 'POST') {
      const body = await readBody(req);
      push.unsubscribe(String(body.endpoint || ''));
      return json(res, 200, { ok: true, devices: push.count() });
    }
    if (p === '/api/push/test' && req.method === 'POST') {
      const r = await push.broadcast({ title: 'Box notifications are on', body: 'You’ll hear when something needs you or finishes.', tag: 'test', url: '/', badge: needsYouCount() });
      return json(res, 200, { ok: true, ...r });
    }

    // ---- library, search, overview, export ----
    if (p === '/api/templates' && req.method === 'GET') return json(res, 200, Object.entries(TEMPLATES).map(([id, t]) => ({ id, name: t.name, emoji: t.emoji, hint: t.hint })));
    if (p === '/api/sources' && req.method === 'GET') return json(res, 200, sourceLibrary());
    if (p === '/api/search' && req.method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim();
      return json(res, 200, q.length < 2 ? [] : searchAll(q));
    }
    if (p === '/api/overview' && req.method === 'GET') {
      const ideas = listIdeas();
      return json(res, 200, {
        needsYou: needsYouCount(), running: ideas.filter((i) => running(i.id)).length,
        live: ideas.filter((i) => i.project?.url).length, projects: ideas.filter((i) => i.phase === 'project').length,
        ideas: ideas.filter((i) => (i.phase || 'idea') === 'idea').length, usage: usageStats(),
      });
    }
    if (p === '/api/prefs' && req.method === 'GET') return json(res, 200, prefs.load());
    if (p === '/api/prefs' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.about !== undefined) prefs.setAbout(body.about);
      if (body.progressPush !== undefined) prefs.setOption('progressPush', body.progressPush);
      return json(res, 200, prefs.load());
    }
    if (p === '/api/prefs/knowledge' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, prefs.addKnowledge(body.attachments || []));
    }
    const km = p.match(/^\/api\/prefs\/knowledge\/([a-f0-9]{16})$/);
    if (km && req.method === 'DELETE') return json(res, 200, prefs.removeKnowledge(km[1]));
    if (p === '/api/compare' && req.method === 'POST') {
      const body = await readBody(req);
      const a = loadIdea(String(body.a || '')), b = loadIdea(String(body.b || ''));
      if (!a || !b || a.id === b.id) return json(res, 400, { error: 'Pick two different ideas.' });
      try { return json(res, 201, await compareIdeas(bus, a, b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === '/api/merge' && req.method === 'POST') {
      const body = await readBody(req);
      const a = loadIdea(String(body.a || '')), b = loadIdea(String(body.b || ''));
      if (!a || !b || a.id === b.id) return json(res, 400, { error: 'Pick two different ideas.' });
      const idea = mergeIdeas(a, b, { title: body.title });
      runIdea(bus, idea, { maxRounds: idea.maxRounds });
      bus.broadcast({ event: 'ideas_changed' });
      return json(res, 201, idea);
    }
    if (p === '/api/polish' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (text.length < 20) return json(res, 400, { error: 'Nothing to polish yet.' });
      try {
        const r = await askClaude({ model: 'haiku', system: 'You clean up dictated speech into clear written text. Keep every idea and detail; remove filler, false starts and repetition; fix punctuation; keep the speaker\'s voice and first person. Reply with the cleaned text only.', prompt: text, timeoutMs: 60000 });
        return json(res, 200, { text: r.text.trim() });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === '/api/export' && req.method === 'GET') {
      const body = exportAll();
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length, 'Content-Disposition': `attachment; filename="box-export-${new Date().toISOString().slice(0, 10)}.zip"` });
      return res.end(body);
    }

    // ---- agents ----
    if (p === '/api/agents' && req.method === 'GET') return json(res, 200, agentList());
    if (p === '/api/agents/presets' && req.method === 'GET') {
      const names = new Set(Object.values(getAgents()).map((a) => a.name.toLowerCase()));
      return json(res, 200, { presets: PRESETS.map((x) => ({ ...x, installed: names.has(x.name.toLowerCase()) })), traits: Object.keys(TRAITS) });
    }
    if (p === '/api/agents/from-text' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const agent = await agentFromText(body);
        bus.broadcast({ event: 'agents_changed' });
        return json(res, 201, agent);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    const pm2 = p.match(/^\/api\/agents\/presets\/([a-z0-9-]+)$/);
    if (pm2 && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        const agent = installPreset(pm2[1], body.model);
        bus.broadcast({ event: 'agents_changed' });
        return json(res, 201, agent);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
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
    if (am && req.method === 'PATCH') {
      const body = await readBody(req);
      try {
        const agent = updateAgent(am[1], body);
        bus.broadcast({ event: 'agents_changed' });
        return json(res, 200, agent);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
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
      if (/https?:\/\//.test(text)) attachments.push(...await ingestUrls(text));
      const maxRounds = Math.min(4, Math.max(1, Number(body.maxRounds) || 2));
      const idea = createIdea({
        title: body.title, text: text || 'See the attached files.', attachments, maxRounds,
        template: TEMPLATES[body.template] ? body.template : null,
        tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 8) : [],
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
        if (body.title !== undefined) {
          const title = String(body.title || '').trim();
          if (!title) return json(res, 400, { error: 'Title cannot be empty.' });
          renameIdea(idea, title, 'user');
          bus.publish(idea.id, { event: 'renamed', title: idea.title });
        }
        if (Array.isArray(body.tags)) { idea.tags = body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 8); saveIdea(idea); }
        if (body.archived !== undefined) { idea.archived = !!body.archived; saveIdea(idea); }
        if (body.watch !== undefined) { idea.watch = !!body.watch; saveIdea(idea); }
        if (body.customDomain !== undefined && idea.project) {
          const d = String(body.customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
          if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return json(res, 400, { error: 'That does not look like a domain name.' });
          idea.project.customDomain = d || null;
          if (idea.project.deploy) idea.project.deploy.preparedAt = null; // DevOps rewrites the manifests next deploy
          saveIdea(idea);
        }
        if (body.tags !== undefined || body.archived !== undefined) bus.broadcast({ event: 'ideas_changed' });
        return json(res, 200, { ok: true, title: idea.title, tags: idea.tags || [], archived: !!idea.archived, watch: !!idea.watch, customDomain: idea.project?.customDomain || null });
      }
      if (action === 'design' && req.method === 'POST') {
        const body = await readBody(req);
        if (idea.phase !== 'project') return json(res, 409, { error: 'Not a project.' });
        try { return json(res, 200, { ok: true, message: chooseDesign(bus, idea, String(body.choice || '').toUpperCase()) }); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'env' && req.method === 'POST') {
        const body = await readBody(req);
        if (!idea.project?.deploy) return json(res, 409, { error: 'The project has not been prepared for deployment yet.' });
        const name = String(body.name || '').trim();
        if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(name)) return json(res, 400, { error: 'Variable names are UPPER_CASE.' });
        const d = idea.project.deploy;
        d.env = d.env || {};
        d.env[name] = String(body.value ?? '');
        d.envJson = { ...(d.envJson || {}), [name]: d.envJson?.[name] ?? null };
        d.missing = (d.missing || []).filter((k) => k !== name);
        saveIdea(idea);
        let applied = false;
        if (idea.project.url && deployOps.ready()) {
          try { await deployOps.updateEnv(idea.project.slug, d.env); applied = true; } catch (e) { return json(res, 500, { error: `Saved, but the cluster update failed: ${e.message}` }); }
        }
        return json(res, 200, { ok: true, applied, missing: d.missing, names: Object.keys(d.env).filter((k) => !k.startsWith('__')) });
      }
      if (action === 'logs' && req.method === 'GET') {
        if (!idea.project?.url || !deployOps.ready()) return json(res, 409, { error: 'Logs are available once the project is live and Box has cluster access.' });
        try { return json(res, 200, { logs: await deployOps.logs(idea.project.slug, Number(url.searchParams.get('lines')) || 200) }); } catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (action === 'offline' && req.method === 'POST') {
        const body = await readBody(req);
        if (!idea.project?.url || !deployOps.ready()) return json(res, 409, { error: 'Available once the project is live and Box has cluster access.' });
        try {
          await deployOps.setOffline(idea.project.slug, !!body.offline);
          idea.project.offline = !!body.offline;
          saveIdea(idea);
          const msg = addMessage(idea, { agentId: 'system', kind: 'system', round: idea.round, summary: body.offline ? 'Taken offline' : 'Back online', content: body.offline ? 'The site is scaled to zero; visitors get an error page until it is brought back.' : 'The site is running again.' });
          bus.publish(idea.id, { event: 'message', message: msg });
          return json(res, 200, { ok: true, offline: idea.project.offline });
        } catch (e) { return json(res, 500, { error: e.message }); }
      }
      if (action === 'watch' && req.method === 'POST') {
        if (!idea.brief) return json(res, 409, { error: 'Trend watch needs a finished brief.' });
        if (running(idea.id)) return json(res, 409, { error: 'Wait for the room to finish first.' });
        trendTurn(bus, idea).catch(() => {});
        return json(res, 202, { ok: true });
      }
      if (action === 'fork' && req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const fork = forkIdea(idea, body.messageId, { title: body.title });
        bus.broadcast({ event: 'ideas_changed' });
        return json(res, 201, fork);
      }
      if (action === 'quick' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) return json(res, 400, { error: 'Ask something first.' });
        if (running(idea.id)) return json(res, 409, { error: 'Wait for the room to finish first.' });
        if (idea.phase === 'project') return json(res, 409, { error: 'Quick questions go to the idea room, not the build crew.' });
        const msg = addMessage(idea, { agentId: 'user', kind: 'user', quick: true, toAgent: body.agentId || null, round: idea.round, summary: text.slice(0, 140), content: text });
        bus.publish(idea.id, { event: 'message', message: msg });
        runQuick(bus, idea, { question: text, agentId: body.agentId || null });
        return json(res, 202, { ok: true, message: msg });
      }
      if (action === 'devil' && req.method === 'POST') {
        if (idea.phase === 'project') return json(res, 409, { error: 'The project is past the debate.' });
        if (running(idea.id)) return json(res, 409, { error: 'already running' });
        if (!idea.messages.some((m) => m.kind === 'kickoff')) return json(res, 409, { error: 'Run the debate first.' });
        runIdea(bus, idea, { mode: 'devil' });
        return json(res, 202, { ok: true });
      }
      if (action === 'extras' && req.method === 'POST') {
        const body = await readBody(req);
        if (!EXTRAS[body.kind]) return json(res, 400, { error: 'Unknown document type.' });
        try {
          const doc = await generateExtra(bus, idea, body.kind);
          return json(res, 201, doc);
        } catch (e) { return json(res, 409, { error: e.message }); }
      }
      if (action === 'names' && req.method === 'GET') {
        const name = String(url.searchParams.get('name') || '').trim() || ((idea.brief || '').match(/^#\s+([^\n—:-]+)/m) || [])[1] || idea.title;
        return json(res, 200, await checkNames(name.trim()));
      }
      if (action === 'tasks' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.action === 'revert') {
          try { return json(res, 200, { ok: true, task: await revertTask(bus, idea, body.taskId, { requeue: !!body.requeue }), tasks: idea.project.tasks }); } catch (e) { return json(res, 400, { error: e.message }); }
        }
        try { return json(res, 200, { ok: true, tasks: editTasks(bus, idea, body) }); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (action === 'files' && req.method === 'GET') {
        if (!idea.project?.slug) return json(res, 404, { error: 'No repository yet.' });
        try {
          const r = repoBrowse(idea.project.slug, url.searchParams.get('path') || '');
          if (url.searchParams.get('explain') && r.content) {
            const x = await askClaude({ model: 'sonnet', system: 'You explain source files to a non-engineer product owner: what the file does, how it fits the app, and anything risky or unfinished. Plain language, under 250 words, markdown with short headings.', prompt: `FILE ${r.path}:\n\n${r.content.slice(0, 60000)}`, timeoutMs: 2 * 60 * 1000 });
            r.explanation = x.text.trim();
          }
          return json(res, 200, r);
        } catch (e) { return json(res, 404, { error: e.message }); }
      }
      if (action === 'check' && req.method === 'POST') {
        if (!idea.project?.url) return json(res, 409, { error: 'Not live yet.' });
        const r = await monitor.probe(idea.project.url);
        return json(res, 200, r);
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

// Restarts (deploys, crashes) must not strand a working crew. On SIGTERM we
// ask every run to stop after its current turn, wait for that, and mark the
// idea to resume; on startup, anything marked (or left "running" by a crash)
// is resumed automatically.
for (const i of listIdeas()) {
  if (i.status === 'running') { i.status = 'paused'; i.autoResume = true; saveIdea(i); }
}
setTimeout(() => {
  for (const i of listIdeas()) {
    if (!i.autoResume) continue;
    i.autoResume = false;
    saveIdea(i);
    try {
      if (i.phase === 'project') resumeProject(bus, i);
      else if (i.messages.some((m) => m.kind === 'kickoff') && !i.brief) runIdea(bus, i);
      else if (i.brief && i.messages[i.messages.length - 1]?.kind === 'user') runIdea(bus, i);
      console.log(`  resumed ${i.title}`);
    } catch (e) { console.error(`resume ${i.id}: ${e.message}`); }
  }
}, 8000);

let shuttingDown = false;
async function gracefulStop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const active = listIdeas().filter((i) => running(i.id));
  for (const i of active) { i.autoResume = true; saveIdea(i); pauseIdea(i); pauseProject(i); }
  console.log(`\n  ${signal}: ${active.length} run(s) finishing their current turn before restart…`);
  const deadline = Date.now() + 14 * 60 * 1000;
  while (Date.now() < deadline && listIdeas().some((i) => running(i.id))) await new Promise((r) => setTimeout(r, 2000));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => gracefulStop('SIGTERM'));
process.on('SIGINT', () => gracefulStop('SIGINT'));

monitor.start(bus);

server.listen(PORT, () => {
  console.log(`\n  📦 Box is running → http://localhost:${PORT}\n`);
  console.log('  Agents speak through the Claude Code CLI using your Claude subscription.');
  console.log('  No API key. No SDK. Just `claude -p` under the hood.\n');
});
