// Run Scenario — a research desk for market claims. You state a claim; a
// strategist makes it measurable, analysts gather data (prices, macro,
// crowd, news, filings), a judge commits to one probability, and the desk
// re-runs it every day so you can watch the claim firm up or fall apart.
//
// Zero dependencies (Node 22). Accounts come from Pocket Box.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const store = require('./lib/store');
const desk = require('./lib/desk');
const data = require('./lib/data');
const models = require('./lib/models');
const insights = require('./lib/insights');
const reading = require('./lib/reading');
const voice = require('./lib/voice');
const os = require('os');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'sc_session';

// ---- helpers ----------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit = 64000) {
  return new Promise((resolve, reject) => {
    let d = '', done = false;
    req.on('data', (c) => { if (done) return; d += c; if (d.length > limit) { done = true; reject(Object.assign(new Error('Too large.'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { if (done) return; done = true; try { resolve(d ? JSON.parse(d) : {}); } catch { reject(Object.assign(new Error('Not valid JSON.'), { status: 400 })); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, done = false;
    req.on('data', (c) => { if (done) return; n += c.length; if (n > limit) { done = true; reject(Object.assign(new Error('That recording is too long.'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, v, maxAge) => `${COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`;
const OUR_PROXIES = new Set(['2.25.157.104', '69.62.86.166']);
const isOurs = (ip) => { ip = String(ip || '').replace(/^::ffff:/, ''); return OUR_PROXIES.has(ip) || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fc)/i.test(ip); };
const clientIp = (req) => {
  const peer = String(req.socket.remoteAddress || '');
  if (!isOurs(peer)) return peer.replace(/^::ffff:/, '');
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isOurs(hops[i]) || i === 0) return hops[i].replace(/^::ffff:/, '');
  return peer.replace(/^::ffff:/, '');
};
// Anyone with a confirmed account can use the free desk (data, simulation,
// Hugging Face models). The Claude analysts run on the owner's Claude login,
// so they are for the owner and the people the owner turns them on for.
const allowed = (u) => !!u && u.status === 'approved';
const canClaude = (u) => !!u && (u.role === 'admin' || u.claude === true);
const currentUser = (req) => auth.userForSession(cookies(req)[COOKIE]);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function crossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin || '';
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  try { return new URL(origin).host !== host; } catch { return true; }
}

// ---- static -----------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const VERSION = (() => { const h = crypto.createHash('sha256'); for (const f of fs.readdirSync(PUBLIC_DIR)) { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {} } return h.digest('hex').slice(0, 12); })();
function serveStatic(req, res, p) {
  const rel = p === '/' ? '/index.html' : p;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Client-side routes fall back to the app.
    if (!path.extname(p)) return serveStatic(req, res, '/');
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="([a-z-]+\.(?:js|css))"/g, `$1="$2?v=${VERSION}"`));
  fs.createReadStream(file).pipe(res);
}

// ---- live updates -------------------------------------------------------------
const streams = new Map(); // res -> token
function emit(payload) {
  const sc = payload.id ? store.load(payload.id) : null;
  for (const [res, token] of streams) {
    const u = auth.userForSession(token);
    if (!u || !allowed(u)) { streams.delete(res); try { res.end(); } catch {} continue; }
    if (sc && sc.ownerId !== u.id && u.role !== 'admin') continue;
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {}
  }
}

// ---- the queue: one desk run at a time ------------------------------------------
const queue = [];
let busy = false;
function enqueue(id, reason) {
  if (queue.some((q) => q.id === id) || desk.isRunning(id)) return false;
  queue.push({ id, reason });
  const sc = store.load(id);
  if (sc && sc.status !== 'running') { store.patch(id, { status: 'queued' }); emit({ event: 'scenario', id }); }
  pump();
  return true;
}
async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    const sc0 = store.load(next.id);
    const r = await desk.run(next.id, { emit, reason: next.reason, claude: canClaude(sc0 && auth.getUser(sc0.ownerId)), depth: (sc0 && sc0.depth) || 'deep' });
    if (r) await alert(r, next.reason).catch((e) => console.error(`alert ${next.id}: ${e.message}`));
    if (next.reason === 'scheduled') batchDone = true;
  } catch (e) { console.error(`run ${next.id}: ${e.message}`); }
  busy = false;
  // When the scheduled batch is through, send each person one digest for the day.
  if (!queue.length && batchDone) { batchDone = false; digests().catch((e) => console.error(`digest: ${e.message}`)); }
  setImmediate(pump);
}
let batchDone = false;

/**
 * Email the owner when a run did something they asked to hear about: a big
 * move, a verdict flip, crossing their level, or the scenario settling.
 */
async function alert({ sc, run, prev }, reason) {
  const a = sc.alerts || {};
  if (!a.email) return;
  const why = [];
  if (sc.status === 'resolved' && a.settle !== false) why.push(`it settled ${sc.resolved ? sc.resolved.outcome.toUpperCase() : ''}`.trim());
  if (prev && reason !== 'new') {
    const dp = run.probability - prev.probability;
    if (Math.abs(dp) >= (a.move || 5)) why.push(`it moved ${dp > 0 ? 'up' : 'down'} ${Math.abs(dp)} points`);
    if (a.flip !== false && prev.verdict !== run.verdict) why.push(`the verdict changed from ${prev.verdict} to ${run.verdict}`);
    if (Number.isFinite(a.cross) && (prev.probability - a.cross) * (run.probability - a.cross) < 0) why.push(`it crossed your ${a.cross}% line`);
  }
  if (!why.length) return;
  const u = auth.getUser(sc.ownerId);
  if (!u) return;
  const dp = prev ? run.probability - prev.probability : 0;
  const lines = [
    sc.thesis.title, '',
    `${prev ? `${prev.probability}% to ` : ''}${run.probability}%, ${run.verdict}. You're getting this because ${why.join(' and ')}.`, '',
    run.call, '',
    ...(run.changes || []).slice(0, 6).map((c) => `- ${c.text}`), '',
    `Open it: ${BASE_URL}/#/s/${sc.id}`, '',
    'Research, not financial advice. Change alerts in the scenario\'s settings.',
  ];
  await mail.send({ to: u.email, subject: `${sc.thesis.title}: ${run.probability}%${prev ? ` (${dp >= 0 ? '+' : ''}${dp})` : ''}`, text: lines.join('\n') });
}

/** One email per person per day: every active scenario, biggest moves first. */
async function digests() {
  const date = new Date().toISOString().slice(0, 10);
  const byOwner = new Map();
  for (const sc of store.list()) { if (!byOwner.has(sc.ownerId)) byOwner.set(sc.ownerId, []); byOwner.get(sc.ownerId).push(sc); }
  for (const [uid, list] of byOwner) {
    const pr = insights.prefs(uid);
    const u = auth.getUser(uid);
    if (!u || !pr.digest || pr.lastDigest === date) continue;
    const active = list.filter((sc) => !sc.archived && (sc.history || []).length);
    if (!active.length) continue;
    const t = insights.today(list, uid);
    const lines = [`Your scenarios on ${date}`, ''];
    for (const sc of active.sort((a, b) => Math.abs(chg(b)) - Math.abs(chg(a)))) {
      const h = sc.history, last = h[h.length - 1];
      lines.push(`${last.p}%${h.length > 1 ? ` (${chg(sc) >= 0 ? '+' : ''}${chg(sc)})` : ''}  ${sc.thesis.title}${sc.status === 'resolved' ? `  [settled ${sc.resolved.outcome.toUpperCase()}]` : ''}`);
    }
    if (t.catalysts.length) lines.push('', 'Coming up', ...t.catalysts.slice(0, 5).map((c) => `${c.date}  ${c.event}`));
    lines.push('', `Open Run Scenario: ${BASE_URL}`, '', 'Turn this email off under You.');
    const r = await mail.send({ to: u.email, subject: `Run Scenario: ${active.length} scenario${active.length > 1 ? 's' : ''}, ${date}`, text: lines.join('\n') });
    if (r.sent) insights.setPrefs(uid, { lastDigest: date });
  }
}
const chg = (sc) => { const h = sc.history || []; return h.length > 1 ? Math.round((h[h.length - 1].p - h[h.length - 2].p) * 10) / 10 : 0; };

// ---- schedule ---------------------------------------------------------------------
// Slots in UTC: before the US open (13:00) and after the close (DAILY_HOUR_UTC).
const PRE_OPEN_UTC = 13;
function dueSlot(sc, now) {
  const date = now.toISOString().slice(0, 10), hour = now.getUTCHours();
  const slots = sc.schedule === 'twice' ? [PRE_OPEN_UTC, config.DAILY_HOUR_UTC] : ['daily', 'weekly'].includes(sc.schedule) ? [config.DAILY_HOUR_UTC] : [];
  const passed = slots.filter((h) => hour >= h).pop();
  if (passed === undefined) return null;
  const slot = `${date}@${String(passed).padStart(2, '0')}`;
  const last = sc.lastSlot || (sc.lastRunDate ? `${sc.lastRunDate}@${String(config.DAILY_HOUR_UTC).padStart(2, '0')}` : '');
  if (last >= slot) return null;
  if (sc.schedule === 'weekly' && sc.lastRunDate && Date.parse(date) - Date.parse(sc.lastRunDate) < 6.5 * 86400000) return null;
  return slot;
}
function tick() {
  const now = new Date();
  for (const sc of store.list()) {
    if (sc.archived || ['resolved', 'running', 'queued'].includes(sc.status) || !sc.thesis) continue;
    const slot = dueSlot(sc, now);
    if (!slot) continue;
    store.patch(sc.id, { lastSlot: slot });
    enqueue(sc.id, 'scheduled');
  }
}

// ---- views ---------------------------------------------------------------------
function card(sc, user = null) {
  const h = sc.history || [];
  const last = h[h.length - 1], prev = h[h.length - 2];
  return {
    id: sc.id, title: sc.thesis ? sc.thesis.title : sc.claim, claim: sc.claim, themeId: sc.themeId, parentId: sc.parentId, status: sc.status, error: sc.error,
    probability: last ? last.p : null, change: last && prev ? Math.round((last.p - prev.p) * 10) / 10 : null, verdict: sc.latest ? sc.latest.verdict : null,
    horizonDate: sc.thesis ? sc.thesis.horizonDate : null, spark: [...(sc.backfill || []).map((b) => b.p), ...h.map((x) => x.p)].slice(-40),
    updatedAt: sc.latest ? sc.latest.at : sc.createdAt, createdAt: sc.createdAt,
    archived: !!sc.archived, schedule: sc.schedule, depth: sc.depth || 'deep', myCall: (sc.myCalls || []).length ? sc.myCalls[sc.myCalls.length - 1].p : null,
    kind: sc.thesis ? sc.thesis.kind : null, primary: sc.thesis ? sc.thesis.primary : null,
    unread: user ? reading.unreadCount(sc.id, user.id) : 0,
  };
}
function fullView(sc, user) {
  const latest = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
  const seenId = (sc.seen || {})[user.id];
  let sinceVisit = null;
  if (latest && seenId && seenId !== latest.id) {
    const seenRun = store.loadRun(sc.id, seenId);
    if (seenRun) sinceVisit = { from: seenRun.date, fromP: seenRun.probability, changes: desk.diff(seenRun, latest) };
  }
  const runs = (sc.history || []).map((h) => ({ date: h.date, p: h.p, runId: h.runId }));
  const theme = store.list().filter((x) => x.themeId === sc.themeId && x.id !== sc.id).map(card);
  return { ...card(sc, user), thesis: sc.thesis, facts: sc.facts, history: sc.history, backfill: sc.backfill, questions: sc.questions, schedule: sc.schedule, alerts: sc.alerts, depth: sc.depth || 'deep', myCalls: sc.myCalls || [], resolved: sc.resolved || null, latest, sinceVisit, runs, theme, progress: desk.progress(sc.id), queued: queue.some((q) => q.id === sc.id) };
}
const mine = (u, sc) => !!sc && (sc.ownerId === u.id || u.role === 'admin');

/** How a scenario runs: frequency, depth, alerts. People without Claude always run Quick. */
function runOptions(b, user, sc = null) {
  const f = {};
  if (['twice', 'daily', 'weekly', 'off'].includes(b.schedule)) f.schedule = b.schedule;
  if (['quick', 'standard', 'deep'].includes(b.depth)) f.depth = canClaude(user) ? b.depth : 'quick';
  else if (!sc && !canClaude(user)) f.depth = 'quick';
  if (b.alerts && typeof b.alerts === 'object') {
    const a = b.alerts, cur = (sc && sc.alerts) || {};
    const cross = a.cross === null || a.cross === '' ? null : Number.isFinite(Number(a.cross)) ? Math.max(1, Math.min(99, Math.round(Number(a.cross)))) : cur.cross ?? null;
    f.alerts = { email: a.email !== undefined ? !!a.email : cur.email !== false, move: Math.max(1, Math.min(50, Number(a.move ?? cur.move) || 5)), flip: a.flip !== undefined ? !!a.flip : cur.flip !== false, settle: a.settle !== undefined ? !!a.settle : cur.settle !== false, cross };
  }
  return f;
}

let statusCache = null;
async function status(force) {
  if (!force && statusCache && Date.now() - statusCache.at < 3600 * 1000) return statusCache;
  statusCache = { at: Date.now(), sources: await data.probe(), models: (await models.available()) ? models.info() : null, mail: mail.configured(), daily: `${config.DAILY_HOUR_UTC}:00 UTC` };
  return statusCache;
}

// ---- server ----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  securityHeaders(req, res);
  try {
    if (p.startsWith('/api/') && crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });
    const ip = clientIp(req);
    if (p === '/api/session' && req.method === 'GET') {
      const u = currentUser(req);
      return json(res, 200, { authed: !!u, allowed: allowed(u), claude: canClaude(u), owner: !!(u && u.primary), user: auth.publicUser(u), version: VERSION, openSignup: config.OPEN_SIGNUP });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const u = auth.login({ email: b.email, password: b.password, ip });
        res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(u, req.headers['user-agent']), 30 * 24 * 3600));
        return json(res, 200, { ok: true, allowed: allowed(u) });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Sign-in failed.' }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      auth.destroySession(cookies(req)[COOKIE]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/signup' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (!config.OPEN_SIGNUP) return json(res, 403, { error: 'Sign-up is closed right now.' });
      try {
        const { user: nu, duplicate, token } = auth.signup({ ...b, ip });
        if (!duplicate && token) {
          mail.send({ to: nu.email, subject: 'Confirm your email for Run Scenario', text: `Hi ${nu.firstName},\n\nConfirm your email and choose a password with this link (one use, 24 hours):\n\n${BASE_URL}/#/reset/${token}\n\nIf you didn't sign up, ignore this email and nothing happens.\n` }).catch(() => {});
          for (const ad of auth.admins().filter((a) => a.primary)) mail.send({ to: ad.email, subject: `New Run Scenario sign-up: ${nu.firstName} ${nu.lastName}`, text: `${nu.firstName} ${nu.lastName} (${nu.email}) signed up. They can use the free desk once they confirm their email. To give them the Claude desk, open ${BASE_URL}/#/people\n` }).catch(() => {});
        } else if (duplicate) {
          // Same reply either way; the inbox owner gets a sign-in or reset link.
          const r = auth.forgot({ email: nu.email, ip });
          if (r) mail.send({ to: nu.email, subject: 'Your Run Scenario account', text: `Hi ${nu.firstName},\n\nYou already have an account. Sign in at ${BASE_URL}, or set a new password here (one use, 24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n` }).catch(() => {});
        }
        return json(res, 200, { ok: true, message: 'Check your inbox. We sent a link to confirm your email and set your password. It works once, for 24 hours (check Spam too).' });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not create the account.' }); }
    }
    if (p === '/api/forgot' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const r = auth.forgot({ email: b.email, ip });
        if (r) mail.send({ to: r.user.email, subject: 'Set your Run Scenario password', text: `Hi ${r.user.firstName},\n\nUse this link to set your Run Scenario password (one use, 24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n\nIf you didn't ask for this, ignore this email.\n` }).catch(() => {});
        return json(res, 200, { ok: true, message: 'If that address has an account, a link is on its way. Check Spam too.' });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/reset' && req.method === 'GET') { const u = auth.tokenUser(url.searchParams.get('token')); return json(res, 200, { valid: !!u, email: u?.email || null }); }
    if (p === '/api/reset' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`reset:ip:${ip}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many attempts.' });
      try { const u = auth.resetPassword({ token: b.token, password: b.password }); return json(res, 200, { ok: true, email: u.email }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (!allowed(user)) return json(res, 403, { error: 'Confirm your email first.' });
    return await api(req, res, p, url, user);
  } catch (e) {
    console.error(`${req.method} ${p}: ${e.stack || e.message}`);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server.' });
  }
});

async function api(req, res, p, url, user) {
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ event: 'hello', version: VERSION })}\n\n`);
    streams.set(res, cookies(req)[COOKIE]);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); streams.delete(res); });
    return;
  }
  if (p === '/api/status' && req.method === 'GET') return json(res, 200, await status(url.searchParams.get('fresh') === '1'));
  if (p === '/api/people' && req.method === 'GET') {
    if (!user.primary) return json(res, 403, { error: 'Only the owner manages people.' });
    return json(res, 200, { people: auth.listUsers().map((x) => ({ id: x.id, name: x.name, email: x.email, status: x.status, role: x.role, primary: !!x.primary, claude: x.role === 'admin' || x.claude === true, createdAt: x.createdAt, scenarios: store.list().filter((sc) => sc.ownerId === x.id).length })) });
  }
  const pm = p.match(/^\/api\/people\/([a-f0-9]{12})$/);
  if (pm && req.method === 'POST') {
    if (!user.primary) return json(res, 403, { error: 'Only the owner manages people.' });
    const b = await readBody(req);
    try {
      if (typeof b.claude === 'boolean') auth.setClaude(pm[1], b.claude);
      if (['approved', 'disabled'].includes(b.status)) auth.setStatus(pm[1], b.status);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  // ---- voice ----
  if (p === '/api/transcribe' && req.method === 'POST') {
    // 16 kHz mono 16-bit PCM from the browser, up to about 60 seconds.
    if (!(await models.available())) return json(res, 503, { error: 'Speech-to-text on the server is still being installed. Try Chrome or Safari, which have it built in.' });
    if (auth.limited(`stt:${user.id}`, 60, 3600 * 1000)) return json(res, 429, { error: 'Too many recordings this hour.' });
    const buf = await readBuffer(req, 2 * 1024 * 1024);
    if (buf.length < 3200) return json(res, 400, { error: 'That was too short to hear anything.' });
    const file = path.join(os.tmpdir(), `sc-voice-${crypto.randomBytes(6).toString('hex')}.pcm`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    try { const r = await models.call('transcribe', { path: file }, 180000); const text = /[a-z0-9]/i.test(r.text || '') ? r.text.replace(/(\s*\.){3,}/g, '.').trim() : ''; return json(res, 200, { text, model: r.model }); }
    catch (e) { return json(res, 500, { error: `Couldn't transcribe: ${e.message.slice(0, 160)}` }); }
    finally { fs.rm(file, { force: true }, () => {}); }
  }
  if (p === '/api/voice/tidy' && req.method === 'POST') {
    const b = await readBody(req);
    const text = String(b.text || '').trim().slice(0, 2000);
    const mode = b.mode === 'build' ? 'build' : 'describe';
    if (text.length < 3) return json(res, 400, { error: 'Say a little more.' });
    if (canClaude(user) && !auth.limited(`tidy:${user.id}`, 80, 3600 * 1000)) {
      try { return json(res, 200, { ...(await voice.tidy(text, mode)), by: 'claude' }); } catch {}
    }
    return json(res, 200, mode === 'build' ? { ...voice.parseBuild(text), by: 'rules' } : { claim: text, facts: '', by: 'none' });
  }
  if (p === '/api/today' && req.method === 'GET') return json(res, 200, insights.today(store.list().filter((sc) => sc.ownerId === user.id), user.id));
  if (p === '/api/record' && req.method === 'GET') return json(res, 200, insights.record(store.list().filter((sc) => sc.ownerId === user.id)));
  if (p === '/api/pulse' && req.method === 'GET') {
    const [pl, wl] = await Promise.all([insights.pulse(), insights.watchlist(insights.prefs(user.id).watchlist)]);
    return json(res, 200, { ...pl, watchlist: wl });
  }
  if (p === '/api/prefs' && req.method === 'GET') return json(res, 200, insights.prefs(user.id));
  if (p === '/api/prefs' && req.method === 'POST') {
    const b = await readBody(req);
    const patch = {};
    if (typeof b.digest === 'boolean') patch.digest = b.digest;
    if (Array.isArray(b.watchlist)) patch.watchlist = [...new Set(b.watchlist.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[\^A-Z0-9.=\-]{1,15}$/.test(x)))].slice(0, 12);
    return json(res, 200, insights.setPrefs(user.id, patch));
  }
  if (p === '/api/scenarios' && req.method === 'GET') {
    const list = store.list().filter((sc) => mine(user, sc)).map((sc) => card(sc, user)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json(res, 200, { scenarios: list, running: queue.length + (busy ? 1 : 0) });
  }
  if (p === '/api/scenarios' && req.method === 'POST') {
    const b = await readBody(req);
    let thesis = null;
    if (b.build) { try { thesis = desk.buildThesis(b.build); } catch (e) { return json(res, 400, { error: e.message }); } }
    else if (!canClaude(user)) return json(res, 403, { error: 'Use the builder: pick the asset, the move and the date.' });
    const claim = String(b.claim || (thesis && thesis.proposition) || '').trim().slice(0, 600);
    const facts = String(b.facts || '').trim().slice(0, 3000);
    if (claim.length < 6) return json(res, 400, { error: 'Say the claim in a sentence.' });
    if (auth.limited(`create:${user.id}`, 30, 24 * 3600 * 1000)) return json(res, 429, { error: 'That\'s a lot of new scenarios today. Try again tomorrow.' });
    const parent = b.parentId ? store.load(b.parentId) : null;
    const sc = store.create({ ownerId: user.id, claim, facts, themeId: parent && mine(user, parent) ? parent.themeId : null, parentId: parent ? parent.id : null });
    store.patch(sc.id, { ...(thesis ? { thesis } : {}), ...runOptions(b.options || {}, user) });
    if (Number.isFinite(Number(b.myCall)) && b.myCall !== '' && b.myCall !== null) store.patch(sc.id, { myCalls: [{ date: new Date().toISOString().slice(0, 10), p: Math.max(1, Math.min(99, Math.round(Number(b.myCall)))) }] });
    enqueue(sc.id, 'new');
    return json(res, 200, { id: sc.id });
  }
  const m = p.match(/^\/api\/scenarios\/([a-z0-9]{10,16})(\/[\w/-]+)?$/);
  if (!m) return json(res, 404, { error: 'Not found.' });
  const sc = store.load(m[1]);
  if (!mine(user, sc)) return json(res, 404, { error: 'No such scenario.' });
  const sub = m[2] || '';
  if (sub === '' && req.method === 'GET') return json(res, 200, fullView(sc, user));
  if (sub === '' && req.method === 'DELETE') { store.remove(sc.id); return json(res, 200, { ok: true }); }
  if (sub === '' && req.method === 'PATCH') {
    const b = await readBody(req);
    const f = runOptions(b, user, sc);
    if (typeof b.archived === 'boolean') f.archived = b.archived;
    return json(res, 200, card(store.patch(sc.id, f)));
  }
  if (sub === '/call' && req.method === 'POST') {
    // The person's own probability, kept beside the desk's (one per day).
    const b = await readBody(req);
    const pv = Number(b.p);
    if (!Number.isFinite(pv) || pv < 1 || pv > 99) return json(res, 400, { error: 'Pick a number from 1 to 99.' });
    const date = new Date().toISOString().slice(0, 10);
    const fresh = store.load(sc.id);
    fresh.myCalls = [...(fresh.myCalls || []).filter((x) => x.date !== date), { date, p: Math.round(pv) }];
    store.save(fresh);
    return json(res, 200, { myCalls: fresh.myCalls });
  }
  const am = sub.match(/^\/agent\/([a-z]{3,20})$/);
  if (am && req.method === 'GET') {
    // One analyst's latest report, and how its lean moved run by run.
    const latest = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
    const analyst = latest && latest.analysts.find((a) => a.id === am[1]);
    if (!analyst) return json(res, 404, { error: 'That analyst has no report for this scenario yet.' });
    const byDate = new Map();
    for (const rid of store.runIds(sc.id)) {
      const r = store.loadRun(sc.id, rid);
      const a = r && r.analysts.find((x) => x.id === am[1]);
      if (a) byDate.set(r.date, { date: r.date, stance: Math.round(a.stance * 100) / 100, confidence: Math.round(a.confidence * 100) / 100, p: a.probability !== undefined ? Math.round(a.probability * 1000) / 10 : null });
    }
    return json(res, 200, { analyst, runDate: latest.date, history: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  if (sub === '/reading' && req.method === 'GET') return json(res, 200, reading.view(sc.id, user.id));
  if (sub === '/reading' && req.method === 'POST') {
    const b = await readBody(req);
    const patch = {};
    if (typeof b.read === 'boolean') patch.read = b.read;
    if (typeof b.saved === 'boolean') patch.saved = b.saved;
    if (!reading.mark(sc.id, user.id, b.all ? '*' : String(b.key || ''), patch)) return json(res, 404, { error: 'No such article.' });
    return json(res, 200, { ok: true });
  }
  if (sub === '/seen' && req.method === 'POST') {
    if (sc.latest) { const fresh = store.load(sc.id); fresh.seen = { ...(fresh.seen || {}), [user.id]: sc.latest.id }; store.save(fresh); }
    return json(res, 200, { ok: true });
  }
  if (sub === '/run' && req.method === 'POST') {
    if (auth.limited(`run:${sc.id}`, 6, 3600 * 1000)) return json(res, 429, { error: 'It has run a lot this hour. Try later.' });
    // A scenario whose framing failed starts over from the claim.
    if (sc.status === 'error' && !sc.latest) store.patch(sc.id, { thesis: null });
    return json(res, 200, { queued: enqueue(sc.id, 'manual') });
  }
  const rm = sub.match(/^\/runs\/([\w-]{6,40})$/);
  if (rm && req.method === 'GET') { const r = store.loadRun(sc.id, rm[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'No such run.' }); }
  if (sub === '/ask' && req.method === 'POST') {
    const b = await readBody(req);
    const q = String(b.q || '').trim().slice(0, 600);
    if (q.length < 4) return json(res, 400, { error: 'Ask a question.' });
    if (!canClaude(user)) return json(res, 403, { error: 'Questions use the Claude desk, which the owner turns on per person.' });
    if (auth.limited(`ask:${user.id}`, 40, 24 * 3600 * 1000)) return json(res, 429, { error: 'Too many questions today.' });
    const item = { id: crypto.randomBytes(5).toString('hex'), q, at: Date.now(), status: 'thinking', steps: [] };
    const fresh = store.load(sc.id); fresh.questions = [...(fresh.questions || []), item].slice(-40); store.save(fresh);
    json(res, 200, item);
    const update = (fields) => { const s = store.load(sc.id); if (!s) return; s.questions = s.questions.map((x) => (x.id === item.id ? { ...x, ...fields } : x)); store.save(s); emit({ event: 'question', id: sc.id, qid: item.id }); };
    desk.ask(store.load(sc.id), q, (step) => emit({ event: 'qstep', id: sc.id, qid: item.id, text: step }))
      .then((a) => update({ status: 'done', answer: a.answer, sources: a.sources, track: a.track }))
      .catch((e) => update({ status: 'error', answer: `Couldn't answer: ${e.message.slice(0, 200)}` }));
    return;
  }
  return json(res, 404, { error: 'Not found.' });
}

// ---- start -----------------------------------------------------------------------------
auth.ensureAdmin();
// Runs cut off by a restart go back in the queue.
for (const sc of store.list()) if (['running', 'queued'].includes(sc.status)) { store.patch(sc.id, { status: sc.latest ? 'ready' : 'new' }); enqueue(sc.id, 'resume'); }
setInterval(tick, 10 * 60 * 1000);
setTimeout(tick, 30 * 1000);
server.listen(PORT, () => console.log(`\n  Run Scenario on http://localhost:${PORT} (public ${BASE_URL})\n`));
