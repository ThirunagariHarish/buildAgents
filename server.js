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
// Administrators run the studio and the admin panel; only the owner (primary) changes who is an administrator.
const isAdmin = (u) => !!u && (u.primary || u.role === 'admin');
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
{ const n = studio.recover(); if (n) console.log(`tidied ${n} post(s) cut off by a restart`); }
setInterval(() => { for (const res of streams.keys()) { try { res.write(': ping\n\n'); } catch {} } }, 25000);

// ---- views ----------------------------------------------------------------------------------
const agentView = (id) => { const a = INVENTORS[id]; return a ? { id, name: a.name, role: a.role, method: a.method, color: a.color } : { id, name: id, role: '', method: '', color: '#888' }; };
function invSummary(inv, uid = null) {
  return { id: inv.id, agent: agentView(inv.agent), title: inv.title, tagline: inv.tagline, problem: inv.problem || '', fix: inv.fix || '', lever: inv.lever || '', feasibility: inv.feasibility ? inv.feasibility.score : null, sketch: inv.sketch, anim: inv.anim ? `/media/${inv.anim}` : null, changes: inv.changes.slice(0, 4), whyBetter: inv.whyBetter.slice(0, 2), priceHint: inv.priceHint, sourcing: inv.sourcing ? inv.sourcing.status : null, demand: store.demand(inv.id, uid) };
}
/** How much research stands behind a product: shown as chips on the original. */
function evidence(prod) {
  if (!prod) return null;
  const links = [...(prod.pains || []), ...(prod.priorArt || []), ...(prod.sources || [])].map((x) => x.url).filter(Boolean);
  return { pains: (prod.pains || []).filter((x) => x.url).length, priorArt: (prod.priorArt || []).length, patents: links.filter((u) => /patents\.google|patentimages|uspto|espacenet|wipo/.test(u)).length, reviews: links.filter((u) => /amazon\.|reddit\.|review|forum|walmart|target\.com|homedepot/.test(u)).length, sources: new Set(links).size };
}
function postCard(p, savedIds, uid = null) {
  const rounds = p.rounds || [];
  const last = rounds[rounds.length - 1];
  return {
    id: p.id, createdAt: p.createdAt, status: p.status, category: p.category,
    product: p.product ? { name: p.product.name, category: p.product.category, oneLiner: p.product.oneLiner, priceRange: p.product.priceRange, pains: p.product.pains.slice(0, 3).map((x) => x.pain) } : null,
    evidence: evidence(p.product), picks: store.picks(p.id, uid), work: p.work || null, niche: p.niche || null,
    currentBest: p.product && p.product.currentBest && p.product.currentBest[0] ? p.product.currentBest[0] : null,
    image: p.image ? { src: `/media/${p.image.file}`, credit: p.image.credit, source: p.image.source } : null,
    sketch: p.sketch ? `/media/${p.sketch}` : null,
    round: last ? { id: last.id, n: rounds.length, by: last.by, feedback: last.feedback, at: last.at } : null,
    rounds: rounds.length,
    inventions: last ? last.inventions.map((i) => ({ ...invSummary(i, uid), sketch: i.sketch ? `/media/${i.sketch}` : null, saved: savedIds.has(i.id) })) : [],
  };
}
function postFull(p, savedIds, uid = null) {
  return {
    ...postCard(p, savedIds, uid), product: p.product,
    allRounds: (p.rounds || []).map((r, n) => ({ id: r.id, n: n + 1, by: r.by, feedback: r.feedback, at: r.at, review: r.review || null, inventions: r.inventions.map((i) => ({ ...i, agent: agentView(i.agent), sketch: i.sketch ? `/media/${i.sketch}` : null, anim: i.anim ? `/media/${i.anim}` : null, saved: savedIds.has(i.id), demand: store.demand(i.id, uid) })) })),
  };
}
/** Inventor showdown: total picks and products won, per inventor. */
function scoreboard() {
  const board = Object.fromEntries(Object.keys(INVENTORS).map((k) => [k, { ...agentView(k), picks: 0, wins: 0 }]));
  const all = store.allPicks();
  for (const [postId, m] of Object.entries(all)) {
    const post = store.loadPost(postId);
    if (!post) continue;
    const agentOf = Object.fromEntries((post.rounds || []).flatMap((r) => r.inventions.map((i) => [i.id, i.agent])));
    const counts = {};
    for (const invId of Object.values(m)) { const a = agentOf[invId]; if (a && board[a]) { board[a].picks++; counts[a] = (counts[a] || 0) + 1; } }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (top.length && (top.length === 1 || top[0][1] > top[1][1])) board[top[0][0]].wins++;
  }
  return Object.values(board);
}
/** Does a product belong to one of someone's niches? The niche it was made for, or every word of the niche in its description. */
const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'in', 'on', 'a', 'an', 'my', 'gear', 'products', 'stuff', 'things']);
function matchesNiche(post, niches) {
  if (!niches || !niches.length || !post.product) return false;
  const pn = String(post.niche || '').toLowerCase();
  const text = [post.product.name, post.product.category, post.product.oneLiner, post.category, ...(post.product.currentBest || []).map((c) => c.name)].join(' ').toLowerCase();
  return niches.some((n) => {
    const l = n.toLowerCase();
    if (pn && pn === l) return true;
    if (text.includes(l)) return true;
    const words = l.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
    return words.length > 0 && words.every((w) => text.includes(w.replace(/s$/, '')));
  });
}
const NICHE_SUGGESTIONS = ['Home espresso', 'Camping', 'Baby gear', 'Kitchen tools', 'Home gym', 'Gardening', 'Pet care', 'Cycling', 'Travel', 'Desk setup', 'Cleaning', 'Elderly care', 'Kids and school', 'Outdoor cooking', 'Bathroom', 'Storage and organising', 'Fishing', 'Running', 'Crafts and sewing', 'Car accessories'];
/** Niches people already follow first, then the starter list. */
function popularNiches() {
  const counts = {};
  for (const u of auth.listUsers()) for (const n of u.niches || []) { const k = n.toLowerCase(); counts[k] = counts[k] || { n, c: 0 }; counts[k].c++; }
  const used = Object.values(counts).sort((a, b) => b.c - a.c).map((x) => x.n);
  return [...new Set([...used, ...NICHE_SUGGESTIONS].map((x) => x))].filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).slice(0, 24);
}
/** The admin panel: who uses the app and how, plus totals. */
function adminView(viewer) {
  const day = 24 * 3600 * 1000, now = Date.now();
  const people = auth.listUsers().map((u) => {
    const a = store.activity(u.id) || {};
    const inviter = u.invitedBy ? auth.getUser(u.invitedBy) : null;
    return {
      id: u.id, name: u.name || u.email, email: u.email, status: u.status, role: u.role, primary: !!u.primary, admin: !!u.primary || u.role === 'admin', claude: u.role === 'admin' || u.claude === true,
      niches: u.niches || [], joinedAt: u.createdAt || null, invitedBy: inviter ? inviter.firstName || inviter.email : null,
      lastSeen: a.lastSeen || null, activeDays30: (a.days || []).filter((d) => now - Date.parse(d) < 30 * day).length, views: a.views || 0, ...store.usage(u.id),
    };
  }).sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
  const confirmed = people.filter((x) => x.status === 'approved');
  const sum = (k) => people.reduce((t, x) => t + (x[k] || 0), 0);
  return {
    viewerIsOwner: !!viewer.primary,
    stats: {
      people: confirmed.length, invitedWaiting: people.filter((x) => x.status === 'unverified').length,
      activeToday: people.filter((x) => x.lastSeen && now - x.lastSeen < day).length, active7: people.filter((x) => x.lastSeen && now - x.lastSeen < 7 * day).length,
      products: store.listPosts().filter((x) => x.product).length, views: sum('views'), saves: sum('saves'), buys: sum('buys'), picks: sum('picks'), chats: sum('chats'),
    },
    people,
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
      return json(res, 200, { authed: !!u, allowed: allowed(u), claude: canClaude(u), owner: isAdmin(u), primary: !!(u && u.primary), user: auth.publicUser(u), version: VERSION, openSignup: config.OPEN_SIGNUP });
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
      try {
        const u = auth.resetPassword({ token: b.token, password: b.password });
        const pend = store.takePending(u.id);
        if (pend && pend.admin) { try { auth.setRole(u.id, 'admin'); } catch {} }
        return json(res, 200, { ok: true, email: u.email });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    if (!p.startsWith('/api/') && !p.startsWith('/media/')) return serveStatic(req, res, p);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (!allowed(user)) return json(res, 403, { error: 'Confirm your email first: open the link we sent you.' });
    if (p.startsWith('/media/')) return serveMedia(res, p.slice(7));
    store.touch(user.id);

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
      const forMe = url.searchParams.get('for') === 'me';
      const niches = (auth.getUser(user.id) || {}).niches || [];
      const posts = store.listPosts().filter((x) => x.product && (x.rounds || []).length && x.createdAt < before && (!forMe || matchesNiche(x, niches)));
      return json(res, 200, { posts: posts.slice(0, limit).map((x) => postCard(x, saved, user.id)), more: posts.length > limit, niches, ...liveView() });
    }
    if (p === '/api/live' && req.method === 'GET') return json(res, 200, liveView());
    const pm = p.match(/^\/api\/posts\/([a-f0-9]{12})(\/[a-z]+)?$/);
    if (pm) {
      const post = store.loadPost(pm[1]);
      if (!post || !post.product) return json(res, 404, { error: 'No such product.' });
      const sub = pm[2] || '';
      if (sub === '' && req.method === 'GET') { store.touch(user.id, 'views'); return json(res, 200, postFull(post, savedSet(user), user.id)); }
      if (sub === '/pick' && req.method === 'POST') {
        const b = await readBody(req);
        const ids = new Set((post.rounds || []).flatMap((r) => r.inventions.map((i) => i.id)));
        if (b.invId && !ids.has(b.invId)) return json(res, 400, { error: 'No such reinvention.' });
        return json(res, 200, { picks: store.setPick(user.id, post.id, b.invId || null) });
      }
      if (sub === '' && req.method === 'DELETE') {
        if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators can remove products.' });
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
    const im = p.match(/^\/api\/inventions\/([a-f0-9]{12})\/(sourcing|save|buy|animate)$/);
    if (im) {
      const found = store.findInvention(im[1]);
      if (!found) return json(res, 404, { error: 'No such reinvention.' });
      if (im[2] === 'save' && req.method === 'POST') {
        const b = await readBody(req);
        const list = store.setSaved(user.id, found.post.id, found.inv.id, b.on !== false);
        return json(res, 200, { saved: list.some((s) => s.invId === found.inv.id), count: list.length });
      }
      if (im[2] === 'animate' && req.method === 'POST') {
        if (!canClaude(user)) return json(res, 403, { error: 'Animations use the owner\'s Claude plan. Ask the owner to turn it on for you.' });
        if (auth.limited(`animate:${user.id}`, 30, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of animations today. Try again tomorrow.' });
        const queued = studio.enqueue({ type: 'animate', invId: found.inv.id, userId: user.id });
        return json(res, 200, { queued, ...liveView() });
      }
      if (im[2] === 'buy' && req.method === 'POST') {
        const b = await readBody(req);
        const price = b.off ? null : Number(b.price) || 0;
        return json(res, 200, { demand: store.setBuy(user.id, found.inv.id, price) });
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
        if (inv) out.push({ postId: post.id, product: post.product.name, image: post.image ? `/media/${post.image.file}` : null, savedAt: s.at, ...invSummary(inv, user.id), sketch: inv.sketch ? `/media/${inv.sketch}` : null });
      }
      return json(res, 200, { saved: out });
    }

    // ---- the studio (owner) ----
    if (p === '/api/studio' && req.method === 'GET') {
      const s = store.settings();
      return json(res, 200, { ...liveView(), focus: s.focus, animate: s.animate !== false, models: s.models, isOwner: isAdmin(user), products: store.listPosts().filter((x) => x.product).length, scoreboard: scoreboard() });
    }
    if (p === '/api/studio' && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators run the studio.' });
      const b = await readBody(req);
      const patch = {};
      if ([30, 60, 120, 240, 480].includes(Number(b.intervalMin))) patch.intervalMin = Number(b.intervalMin);
      if (typeof b.paused === 'boolean') patch.paused = b.paused;
      if (typeof b.animate === 'boolean') patch.animate = b.animate;
      if (typeof b.focus === 'string') patch.focus = b.focus.trim().slice(0, 200);
      if (b.models && typeof b.models === 'object') {
        const m = { ...store.settings().models };
        for (const k of ['scout', 'inventor', 'reviewer', 'animator', 'sourcing', 'chat']) if (['haiku', 'sonnet', 'opus'].includes(b.models[k])) m[k] = b.models[k];
        patch.models = m;
      }
      if (b.clearHold) patch.holdUntil = 0;
      store.setSettings(patch);
      emit({ event: 'live', live: studio.live() });
      return json(res, 200, liveView());
    }
    if (p === '/api/studio/run' && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators run the studio.' });
      const queued = studio.enqueue({ type: 'cycle' });
      return json(res, 200, { queued, ...liveView() });
    }

    // ---- your profile ----
    if (p === '/api/profile' && req.method === 'GET') {
      const me = auth.publicUser(auth.getUser(user.id));
      return json(res, 200, { user: me, popular: popularNiches(), admin: isAdmin(user) });
    }
    if (p === '/api/profile' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, { user: auth.setProfile(user.id, b) }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    // ---- the admin panel ----
    if (p === '/api/admin' && req.method === 'GET') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators see this.' });
      return json(res, 200, adminView(user));
    }
    if (p === '/api/admin/invite' && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators invite people.' });
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`invite:${user.id}`, 40, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of invitations today. Try again tomorrow.' });
      try {
        const r = auth.invite({ email: b.email, firstName: b.name, invitedBy: user.id });
        if (b.admin === true && user.primary && !r.existing) { /* promoted once they confirm */ store.setPending(r.user.id, { admin: true }); }
        if (b.claude === true) auth.setClaude(r.user.id, true);
        const link = `${BASE_URL}/#/reset/${r.token}`;
        const who = user.firstName || 'The Reinvent team';
        const d = await mail.send({ to: r.user.email, subject: `${who} invited you to Reinvent`, text: `Hi ${r.user.firstName},\n\n${who} invited you to Reinvent: every half hour, one everyday product and three ways to reinvent it, with what it would cost to make.\n\nChoose a password to get in (link works for 24 hours):\n\n${link}\n\nOn iPhone, open it in Safari and use Share, then Add to Home Screen, to keep it like an app.\n` }).catch((e) => ({ sent: false, error: e.message }));
        return json(res, 200, { sent: !!d.sent, error: d.error || null, link: d.sent ? null : link, existing: r.existing });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    // ---- people (administrators) ----
    if (p === '/api/people' && req.method === 'GET') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators manage people.' });
      return json(res, 200, { people: auth.listUsers().map((x) => ({ id: x.id, name: x.name, email: x.email, status: x.status, role: x.role, primary: !!x.primary, claude: x.role === 'admin' || x.claude === true, saved: store.saves(x.id).length })) });
    }
    const pe = p.match(/^\/api\/people\/([a-f0-9]{12})(\/email)?$/);
    if (pe && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators manage people.' });
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
        if (b.role) {
          if (!user.primary) return json(res, 403, { error: 'Only the owner makes or removes administrators.' });
          auth.setRole(pe[1], b.role === 'admin' ? 'admin' : 'user');
        }
        if (b.remove === true) {
          if (!user.primary) return json(res, 403, { error: 'Only the owner removes people.' });
          if (pe[1] === user.id) return json(res, 400, { error: 'You cannot remove yourself.' });
          if (!auth.deleteUser(pe[1])) return json(res, 400, { error: 'That account cannot be removed.' });
          return json(res, 200, { ok: true });
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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { store.flushActivity(); } catch {} server.close(); process.exit(0); });
