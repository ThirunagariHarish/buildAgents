// Reinvent — an invention studio in your pocket. Every half hour a Scout
// researches one existing product and three inventors, each with a different
// method, reinvent it. Scroll the feed, save what you like, open a design for
// its China sourcing and economics, and talk to the studio to push it further.
//
// Zero dependencies (Node 22). Agents run on the owner's Claude Max login
// through the Claude Code CLI. Accounts are created by confirming an email.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const store = require('./lib/store');
const studio = require('./lib/studio');
const { INVENTORS } = require('./lib/agents');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'rv_session';

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
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, v, maxAge) => `${COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
const OUR_PROXIES = new Set(['2.25.157.104', '69.62.86.166']);
const isOurs = (ip) => { ip = String(ip || '').replace(/^::ffff:/, ''); return OUR_PROXIES.has(ip) || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fc)/i.test(ip); };
const clientIp = (req) => {
  const peer = String(req.socket.remoteAddress || '');
  if (!isOurs(peer)) return peer.replace(/^::ffff:/, '');
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isOurs(hops[i]) || i === 0) return hops[i].replace(/^::ffff:/, '');
  return peer.replace(/^::ffff:/, '');
};
// Everyone with a confirmed account can scroll, save and read. Talking to
// the studio, reinventing again and sourcing reports run on the owner's
// Claude plan, so they are for the owner and people the owner turns them on for.
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const VERSION = (() => { const h = crypto.createHash('sha256'); for (const f of fs.readdirSync(PUBLIC_DIR)) { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {} } return h.digest('hex').slice(0, 12); })();
function serveStatic(req, res, p) {
  const rel = p === '/' ? '/index.html' : p;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!path.extname(p)) return serveStatic(req, res, '/');
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="\/?([a-zA-Z-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSION}"`));
  fs.createReadStream(file).pipe(res);
}
function serveMedia(res, name) {
  const f = store.mediaPath(name);
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(f);
  // Sketches are agent-made SVG: shown as images, and locked down if opened directly.
  res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'private, max-age=31536000, immutable', ...(ext === '.svg' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}) });
  fs.createReadStream(f).pipe(res);
}

// ---- live updates (server-sent events) --------------------------------------------------------
const streams = new Map(); // res -> session token
function emit(payload) {
  for (const [res, token] of streams) {
    const u = auth.userForSession(token);
    if (!u || !allowed(u)) { streams.delete(res); try { res.end(); } catch {} continue; }
    if (payload.event === 'chat' && payload.userId !== u.id) continue;
    try { res.write(`data: ${JSON.stringify(payload.event === 'chat' ? { event: 'chat', id: payload.id } : payload)}\n\n`); } catch {}
  }
}
studio.setEmitter(emit);
setInterval(() => { for (const res of streams.keys()) { try { res.write(': ping\n\n'); } catch {} } }, 25000);

// ---- views ----------------------------------------------------------------------------------
const agentView = (id) => { const a = INVENTORS[id]; return a ? { id, name: a.name, role: a.role, method: a.method, color: a.color } : { id, name: id, role: '', method: '', color: '#888' }; };
function invSummary(inv) {
  return { id: inv.id, agent: agentView(inv.agent), title: inv.title, tagline: inv.tagline, sketch: inv.sketch, changes: inv.changes.slice(0, 3), whyBetter: inv.whyBetter.slice(0, 2), priceHint: inv.priceHint, sourcing: inv.sourcing ? inv.sourcing.status : null };
}
function postCard(p, savedIds) {
  const rounds = p.rounds || [];
  const last = rounds[rounds.length - 1];
  return {
    id: p.id, createdAt: p.createdAt, status: p.status, category: p.category,
    product: p.product ? { name: p.product.name, category: p.product.category, oneLiner: p.product.oneLiner, priceRange: p.product.priceRange, pains: p.product.pains.slice(0, 3).map((x) => x.pain) } : null,
    image: p.image ? { src: `/media/${p.image.file}`, credit: p.image.credit, source: p.image.source } : null,
    sketch: p.sketch ? `/media/${p.sketch}` : null,
    round: last ? { id: last.id, n: rounds.length, by: last.by, feedback: last.feedback, at: last.at } : null,
    rounds: rounds.length,
    inventions: last ? last.inventions.map((i) => ({ ...invSummary(i), sketch: i.sketch ? `/media/${i.sketch}` : null, saved: savedIds.has(i.id) })) : [],
  };
}
function postFull(p, savedIds) {
  return {
    ...postCard(p, savedIds), product: p.product,
    allRounds: (p.rounds || []).map((r, n) => ({ id: r.id, n: n + 1, by: r.by, feedback: r.feedback, at: r.at, inventions: r.inventions.map((i) => ({ ...i, agent: agentView(i.agent), sketch: i.sketch ? `/media/${i.sketch}` : null, saved: savedIds.has(i.id) })) })),
  };
}
const savedSet = (u) => new Set(store.saves(u.id).map((s) => s.invId));
function liveView() {
  const s = store.settings();
  return { live: studio.live(), paused: s.paused, intervalMin: s.intervalMin, nextRunAt: studio.nextRunAt(), holdUntil: s.holdUntil > Date.now() ? s.holdUntil : null, lastError: s.lastErrorAt && Date.now() - s.lastErrorAt < 6 * 3600 * 1000 ? s.lastError : null };
}

// ---- server ----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  securityHeaders(req, res);
  try {
    if (p.startsWith('/api/') && crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });
    const ip = clientIp(req);

    // ---- accounts ----
    if (p === '/api/session' && req.method === 'GET') {
      const u = currentUser(req);
      return json(res, 200, { authed: !!u, allowed: allowed(u), claude: canClaude(u), owner: !!(u && u.primary), user: auth.publicUser(u), version: VERSION, openSignup: config.OPEN_SIGNUP });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const u = auth.login({ email: b.email, password: b.password, ip });
        res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(u, req.headers['user-agent']), 60 * 24 * 3600));
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
        let delivery = { sent: true };
        if (!duplicate && token) {
          delivery = await mail.send({ to: nu.email, subject: 'Confirm your email for Reinvent', text: `Hi ${nu.firstName},\n\nConfirm your email and choose a password with this link (24 hours):\n\n${BASE_URL}/#/reset/${token}\n\nIf you didn't sign up, ignore this email and nothing happens.\n` }).catch((e) => ({ sent: false, error: e.message }));
          for (const ad of auth.admins().filter((a) => a.primary)) mail.send({ to: ad.email, subject: `New Reinvent sign-up: ${nu.firstName} ${nu.lastName || ''}`.trim(), text: `${nu.firstName} ${nu.lastName || ''} (${nu.email}) signed up. They can scroll and save once they confirm their email. To let them talk to the studio and request sourcing reports, open ${BASE_URL}/#/people\n` }).catch(() => {});
        } else if (duplicate) {
          const r = auth.forgot({ email: nu.email, ip });
          if (r) delivery = await mail.send({ to: nu.email, subject: 'Your Reinvent account', text: `Hi ${nu.firstName},\n\nYou already have an account. Sign in at ${BASE_URL}, or set a new password here (24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n` }).catch((e) => ({ sent: false, error: e.message }));
        }
        if (!delivery.sent && mail.configured()) return json(res, 502, { error: 'Your account is saved, but the email could not be sent just now. Wait a minute, then use "Send it again".', saved: true });
        return json(res, 200, { ok: true, message: 'Check your inbox. We sent a link to confirm your email and choose a password. It works for 24 hours (check Spam and Promotions too).' });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not create the account.' }); }
    }
    if (p === '/api/forgot' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const r = auth.forgot({ email: b.email, ip });
        let delivery = { sent: true };
        if (r) delivery = await mail.send({ to: r.user.email, subject: r.user.status === 'unverified' ? 'Confirm your email for Reinvent' : 'Set your Reinvent password', text: `Hi ${r.user.firstName},\n\nUse this link to ${r.user.status === 'unverified' ? 'confirm your email and choose' : 'set'} your Reinvent password (24 hours; earlier links keep working too):\n\n${BASE_URL}/#/reset/${r.token}\n\nIf you didn't ask for this, ignore this email.\n` }).catch((e) => ({ sent: false, error: e.message }));
        else {
          const em = String(b.email || '').trim().toLowerCase();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em) && em.length <= 120 && !auth.limited(`forgot:none:${em}`, 1, 6 * 3600 * 1000) && !auth.listUsers().some((x) => x.email === em)) {
            delivery = await mail.send({ to: em, subject: 'Reinvent: no account with this email yet', text: `Hi,\n\nSomeone (hopefully you) asked to reset a Reinvent password for this address, but there is no Reinvent account with it yet. Reinvent accounts are separate from Box, Pocket Box and Run Scenario.\n\nCreate one here:\n\n${BASE_URL}/#/signup\n\nIf this wasn't you, ignore this email.\n` }).catch((e) => ({ sent: false, error: e.message }));
          }
        }
        if (!delivery.sent && mail.configured()) return json(res, 502, { error: 'The email could not be sent just now. Wait a minute and try again.' });
        return json(res, 200, { ok: true, message: 'If that address has an account, a link is on its way. Check Spam and Promotions too.' });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/reset' && req.method === 'GET') { const u = auth.tokenUser(url.searchParams.get('token')); return json(res, 200, { valid: !!u, email: u?.email || null }); }
    if (p === '/api/reset' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`reset:ip:${ip}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many attempts.' });
      try { const u = auth.resetPassword({ token: b.token, password: b.password }); return json(res, 200, { ok: true, email: u.email }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    if (!p.startsWith('/api/') && !p.startsWith('/media/')) return serveStatic(req, res, p);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (!allowed(user)) return json(res, 403, { error: 'Confirm your email first: open the link we sent you.' });
    if (p.startsWith('/media/')) return serveMedia(res, p.slice(7));

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`data: ${JSON.stringify({ event: 'live', live: studio.live() })}\n\n`);
      streams.set(res, cookies(req)[COOKIE]);
      req.on('close', () => streams.delete(res));
      return;
    }

    // ---- the feed ----
    if (p === '/api/feed' && req.method === 'GET') {
      const before = Number(url.searchParams.get('before')) || Infinity;
      const limit = Math.min(20, Number(url.searchParams.get('limit')) || 6);
      const saved = savedSet(user);
      const posts = store.listPosts().filter((x) => x.product && (x.rounds || []).length && x.createdAt < before);
      return json(res, 200, { posts: posts.slice(0, limit).map((x) => postCard(x, saved)), more: posts.length > limit, ...liveView() });
    }
    if (p === '/api/live' && req.method === 'GET') return json(res, 200, liveView());
    const pm = p.match(/^\/api\/posts\/([a-f0-9]{12})(\/[a-z]+)?$/);
    if (pm) {
      const post = store.loadPost(pm[1]);
      if (!post || !post.product) return json(res, 404, { error: 'No such product.' });
      const sub = pm[2] || '';
      if (sub === '' && req.method === 'GET') return json(res, 200, postFull(post, savedSet(user)));
      if (sub === '' && req.method === 'DELETE') {
        if (!user.primary) return json(res, 403, { error: 'Only the owner can remove products.' });
        store.removePost(post.id); emit({ event: 'post', id: post.id, removed: true });
        return json(res, 200, { ok: true });
      }
      if (sub === '/chat' && req.method === 'GET') return json(res, 200, { messages: store.chat(post.id, user.id), thinking: studio.isChatting(post.id, user.id), canChat: canClaude(user) });
      if (sub === '/chat' && req.method === 'POST') {
        if (!canClaude(user)) return json(res, 403, { error: 'Talking to the studio uses the owner\'s Claude plan. Ask the owner to turn it on for you.' });
        const b = await readBody(req);
        const text = String(b.text || '').trim();
        if (!text) return json(res, 400, { error: 'Write a message first.' });
        if (auth.limited(`chat:${user.id}`, 60, 3600 * 1000)) return json(res, 429, { error: 'That is a lot of messages this hour. Try again later.' });
        try { await studio.chat(post.id, user.id, text); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
        return json(res, 200, { messages: store.chat(post.id, user.id), thinking: true });
      }
      if (sub === '/reinvent' && req.method === 'POST') {
        if (!canClaude(user)) return json(res, 403, { error: 'New rounds use the owner\'s Claude plan. Ask the owner to turn it on for you.' });
        const b = await readBody(req);
        const feedback = String(b.feedback || '').trim().slice(0, 1500);
        if (feedback.length < 4) return json(res, 400, { error: 'Say what the inventors should do differently.' });
        if (auth.limited(`round:${user.id}`, 12, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of new rounds today. Try again tomorrow.' });
        const queued = studio.enqueue({ type: 'round', postId: post.id, feedback, focusInvId: b.invId || null, userId: user.id });
        return json(res, 200, { ok: true, queued, ...liveView() });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    const im = p.match(/^\/api\/inventions\/([a-f0-9]{12})\/(sourcing|save)$/);
    if (im) {
      const found = store.findInvention(im[1]);
      if (!found) return json(res, 404, { error: 'No such reinvention.' });
      if (im[2] === 'save' && req.method === 'POST') {
        const b = await readBody(req);
        const list = store.setSaved(user.id, found.post.id, found.inv.id, b.on !== false);
        return json(res, 200, { saved: list.some((s) => s.invId === found.inv.id), count: list.length });
      }
      if (im[2] === 'sourcing' && req.method === 'GET') return json(res, 200, { sourcing: found.inv.sourcing || null, canRun: canClaude(user) });
      if (im[2] === 'sourcing' && req.method === 'POST') {
        if (!canClaude(user)) return json(res, 403, { error: 'Sourcing reports use the owner\'s Claude plan. Ask the owner to turn it on for you.' });
        const b = await readBody(req);
        if (found.inv.sourcing && found.inv.sourcing.status === 'ready' && !b.again) return json(res, 200, { sourcing: found.inv.sourcing });
        if (auth.limited(`sourcing:${user.id}`, 20, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of sourcing reports today. Try again tomorrow.' });
        studio.enqueue({ type: 'sourcing', invId: found.inv.id, userId: user.id });
        return json(res, 200, { sourcing: { status: 'queued', at: Date.now() }, ...liveView() });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    if (p === '/api/saved' && req.method === 'GET') {
      const out = [];
      for (const s of store.saves(user.id)) {
        const post = store.loadPost(s.postId);
        const inv = post && (post.rounds || []).flatMap((r) => r.inventions).find((i) => i.id === s.invId);
        if (inv) out.push({ postId: post.id, product: post.product.name, image: post.image ? `/media/${post.image.file}` : null, savedAt: s.at, ...invSummary(inv), sketch: inv.sketch ? `/media/${inv.sketch}` : null });
      }
      return json(res, 200, { saved: out });
    }

    // ---- the studio (owner) ----
    if (p === '/api/studio' && req.method === 'GET') {
      const s = store.settings();
      return json(res, 200, { ...liveView(), focus: s.focus, models: s.models, isOwner: !!user.primary, products: store.listPosts().filter((x) => x.product).length });
    }
    if (p === '/api/studio' && req.method === 'POST') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner runs the studio.' });
      const b = await readBody(req);
      const patch = {};
      if ([30, 60, 120, 240, 480].includes(Number(b.intervalMin))) patch.intervalMin = Number(b.intervalMin);
      if (typeof b.paused === 'boolean') patch.paused = b.paused;
      if (typeof b.focus === 'string') patch.focus = b.focus.trim().slice(0, 200);
      if (b.models && typeof b.models === 'object') {
        const m = { ...store.settings().models };
        for (const k of ['scout', 'inventor', 'sourcing', 'chat']) if (['haiku', 'sonnet', 'opus'].includes(b.models[k])) m[k] = b.models[k];
        patch.models = m;
      }
      if (b.clearHold) patch.holdUntil = 0;
      store.setSettings(patch);
      emit({ event: 'live', live: studio.live() });
      return json(res, 200, liveView());
    }
    if (p === '/api/studio/run' && req.method === 'POST') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner runs the studio.' });
      const queued = studio.enqueue({ type: 'cycle' });
      return json(res, 200, { queued, ...liveView() });
    }

    // ---- people (owner) ----
    if (p === '/api/people' && req.method === 'GET') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner manages people.' });
      return json(res, 200, { people: auth.listUsers().map((x) => ({ id: x.id, name: x.name, email: x.email, status: x.status, role: x.role, primary: !!x.primary, claude: x.role === 'admin' || x.claude === true, saved: store.saves(x.id).length })) });
    }
    const pe = p.match(/^\/api\/people\/([a-f0-9]{12})(\/email)?$/);
    if (pe && req.method === 'POST') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner manages people.' });
      const b = await readBody(req).catch(() => ({}));
      try {
        if (pe[2]) {
          const t = auth.getUser(pe[1]);
          if (!t || t.primary) return json(res, 404, { error: 'No such person.' });
          const { token } = auth.relink(t.id);
          const confirm = t.status === 'unverified';
          const r = await mail.send({ to: t.email, subject: confirm ? 'Confirm your email for Reinvent' : 'Set your Reinvent password', text: `Hi ${t.firstName},\n\n${confirm ? 'Confirm your email and choose a password' : 'Set a new Reinvent password'} with this link (24 hours):\n\n${BASE_URL}/#/reset/${token}\n` }).catch((e) => ({ sent: false, error: e.message }));
          return json(res, 200, { sent: r.sent, error: r.error || null, link: r.sent ? null : `${BASE_URL}/#/reset/${token}` });
        }
        if (typeof b.claude === 'boolean') auth.setClaude(pe[1], b.claude);
        if (['approved', 'disabled'].includes(b.status)) auth.setStatus(pe[1], b.status);
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    return json(res, 404, { error: 'Not found.' });
  } catch (err) {
    console.error(`${req.method} ${p}: ${err.stack || err.message}`);
    return json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  }
});

// ---- schedule: a new product every interval (30 minutes by default) -----------------------------
function tick() { if (config.SCHEDULE && studio.due()) studio.enqueue({ type: 'cycle' }); }
setInterval(tick, 60 * 1000);
setTimeout(tick, 20 * 1000);

auth.ensureAdmin();
server.listen(PORT, () => console.log(`\n  Reinvent on http://localhost:${PORT} (public ${BASE_URL})\n`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });
