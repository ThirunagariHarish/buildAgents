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
const quant = require('./lib/quant');
const discover = require('./lib/discover');
const trends = require('./lib/trends');
const tripwires = require('./lib/tripwires');
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
  // A shared scenario: the app's page, with a title and description link previews can show.
  const pp = p.match(/^\/p\/([A-Za-z0-9_-]{8,16})$/);
  if (pp) {
    const sc = publicScenario(pp[1]);
    let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace(/(src|href)="\/?([a-zA-Z-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSION}"`);
    if (sc) {
      const last = (sc.history || []).slice(-1)[0];
      const t = `${sc.thesis.title}${last ? `: ${last.p}%` : ''}`;
      const dsc = `${sc.latest ? `${sc.latest.verdict}. ${sc.latest.call} ` : ''}Tested against real data every day on Run Scenario.`;
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(t)} | Run Scenario</title><meta property="og:title" content="${escHtml(t)}"><meta property="og:description" content="${escHtml(dsc)}"><meta property="og:type" content="article"><meta property="og:site_name" content="Run Scenario"><meta property="og:image" content="${BASE_URL}/icon-512.png"><meta name="twitter:card" content="summary">`).replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(dsc)}">`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  const rel = p === '/' ? '/index.html' : p;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Client-side routes fall back to the app.
    if (!path.extname(p)) return serveStatic(req, res, '/');
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="\/?([a-zA-Z-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSION}"`));
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
async function alert({ sc, run, prev, tripped }, reason) {
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
  const trips = tripped || [];
  if (trips.length && a.tripwire !== false) why.push(`${trips.length > 1 ? `${trips.length} tripwires were hit` : 'a tripwire was hit'}: ${trips.map((w) => w.label).join('; ')}`);
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
// Discover refreshes around midday and after the close (UTC), or on request.
let discovering = null;
function refreshDiscover() {
  if (discovering) return discovering;
  const owner = auth.admins().find((u) => u.primary);
  const existing = store.list().map((sc) => (sc.thesis ? sc.thesis.title : sc.claim));
  discovering = discover.refresh({ ai: canClaude(owner), existing })
    .then((r) => { emit({ event: 'discover' }); return r; })
    .catch((e) => { console.error(`discover: ${e.message}`); return null; })
    .finally(() => { discovering = null; });
  return discovering;
}
// Trends: at most three a day, written once the midday Discover pass is in.
let trending = null;
function buildTrends(force = false) {
  if (trending) return trending;
  const owner = auth.admins().find((u) => u.primary);
  trending = trends.build({ ai: canClaude(owner), force })
    .then((r) => { emit({ event: 'trends' }); return r; })
    .catch((e) => { console.error(`trends: ${e.message}`); return null; })
    .finally(() => { trending = null; });
  return trending;
}
function trendsDue(now = new Date()) {
  const dl = discover.latest();
  return now.getUTCHours() >= 13 && !trends.load(now.toISOString().slice(0, 10)) && dl && Date.now() - dl.at < 10 * 3600 * 1000;
}
/**
 * Between runs, every couple of hours: check each scenario's armed tripwires
 * against the latest prices and macro data. A trip emails the owner and has
 * the desk re-read the scenario (at most every 6 hours).
 */
let tripCheckAt = 0;
async function checkTripwires() {
  for (const sc of store.list()) {
    if (sc.archived || sc.status === 'resolved' || !(sc.tripwires || []).some((w) => w.state === 'armed')) continue;
    const r = await tripwires.check(sc.tripwires).catch(() => null);
    if (!r) continue;
    store.patch(sc.id, { tripwires: r.wires });
    if (!r.tripped.length) continue;
    emit({ event: 'scenario', id: sc.id });
    const rerun = !sc.lastTripRun || Date.now() - sc.lastTripRun > 6 * 3600 * 1000;
    if (rerun) { store.patch(sc.id, { lastTripRun: Date.now() }); enqueue(sc.id, 'tripwire'); }
    const u = auth.getUser(sc.ownerId);
    if (!u || !(sc.alerts || {}).email || (sc.alerts || {}).tripwire === false) continue;
    const lines = [sc.thesis.title, '', ...r.tripped.map((w) => `Tripwire hit: ${w.label}. ${w.kind === 'fred' ? (data.FRED_INFO[w.id] || w.id) : w.id} is at ${tripwires.fmt(w.hit.value)} (line ${w.op} ${tripwires.fmt(w.value)}, ${w.hit.date}). ${w.why}`), '', rerun ? 'The desk is re-reading the scenario now; the new reading follows.' : 'The desk re-reads it on its next run.', '', `Open it: ${BASE_URL}/#/s/${sc.id}`, '', 'Research, not financial advice. Turn tripwire emails off in the scenario\'s settings.'];
    mail.send({ to: u.email, subject: `Tripwire: ${r.tripped[0].label} (${sc.thesis.title})`, text: lines.join('\n') }).catch(() => {});
  }
}

function tick() {
  const now = new Date();
  if (Date.now() - tripCheckAt > 2 * 3600 * 1000) { tripCheckAt = Date.now(); checkTripwires().catch((e) => console.error(`tripwires: ${e.message}`)); }
  if (trendsDue(now) && !discovering) buildTrends();
  const dl = discover.latest();
  if (!dl || (Date.now() - dl.at > 6 * 3600 * 1000 && [12, 13, 21, 22].includes(now.getUTCHours()))) refreshDiscover();
  for (const sc of store.list()) {
    if (sc.archived || ['resolved', 'running', 'queued'].includes(sc.status) || !sc.thesis) continue;
    const slot = dueSlot(sc, now);
    if (!slot) continue;
    store.patch(sc.id, { lastSlot: slot });
    enqueue(sc.id, 'scheduled');
  }
}

// ---- views ---------------------------------------------------------------------
/** Read a typed claim with the rule parser, then price it: Monte Carlo, base rate and look-alike setups. */
async function tryClaim(b) {
  let build = b.build && typeof b.build === 'object' ? { ...b.build } : null;
  const text = String(b.text || '').trim().slice(0, 300);
  if (!build) {
    if (text.length < 4) throw Object.assign(new Error('Type a claim, like "Nvidia falls 30% by June".'), { status: 400 });
    const norm = text.replace(/\bdoubles?\b/i, 'rises 100%').replace(/\bhalves\b|\bhalf its value\b/i, 'falls 50%').replace(/\b(crash(es)?|collapses?)\b(?!.*\d+\s*%)/i, 'falls 20%');
    build = voice.parseBuild(norm);
    if (!build.date && /year[- ]?end|end of (the )?year|this year/i.test(text)) { const y = new Date().getUTCFullYear(); build.date = `${Date.now() > Date.parse(`${y}-11-30`) ? y + 1 : y}-12-31`; }
  }
  if (!build.symbol || !build.move) throw Object.assign(new Error(build.symbol ? `Got ${build.symbol}. Now say the move: "falls 20%", "above 300", "beats the S&P 500".` : 'Name the asset and the move, like "Apple falls 20% by June" or "Bitcoin above 150k by 2027".'), { status: 422, guess: build });
  if (!build.date) build.date = new Date(Date.now() + 182 * 864e5).toISOString().slice(0, 10);
  const th = desk.buildThesis(build);
  if (th.target.type === 'none') throw Object.assign(new Error('That one needs the full desk. Try a price move, like "falls 20%" or "above 300".'), { status: 422, guess: build });
  const H = quant.tradingDaysUntil(th.horizonDate);
  if (H < 2) throw Object.assign(new Error('Pick a date at least a few days out.'), { status: 422, guess: build });
  const s = await data.prices(th.primary).catch(() => null);
  if (!s) throw Object.assign(new Error(`No price history for ${th.primary}. Try a well-known ticker.`), { status: 422, guess: build });
  const vs = th.target.vs ? await data.prices(th.target.vs).catch(() => null) : null;
  const sim = quant.simulate({ series: s, vsSeries: vs, target: th.target, horizonDays: H, seed: `try:${th.proposition}:${new Date().toISOString().slice(0, 10)}`, paths: 3000 });
  if (!sim) throw Object.assign(new Error('Not enough history to simulate that.'), { status: 422, guess: build });
  const an = th.target.type === 'outperform' ? null : quant.analogs({ series: s, target: th.target, horizonDays: H });
  const hist = quant.historicalRate({ series: s, target: th.target, horizonDays: H });
  const c = s.close;
  return {
    build: { symbol: build.symbol, move: build.move, value: build.value, vs: build.vs || '', date: th.horizonDate },
    title: th.title, proposition: th.proposition, horizonDate: th.horizonDate, symbol: th.primary, name: s.name || th.primary,
    p: Math.round(sim.probability * 1000) / 10, paths: sim.paths, days: H, last: c[c.length - 1], spark: c.slice(-130), asOf: s.dates[s.dates.length - 1],
    range: { p25: sim.quantiles.p25, p75: sim.quantiles.p75 },
    analogs: an ? { k: an.k, hits: an.hits, rate: an.rate, medianFwd: an.medianFwd, since: an.since, horizonDays: an.horizonDays } : null,
    base: hist ? { rate: hist.rate, years: hist.years } : null,
  };
}

/** A scenario its owner chose to share, by its public id. */
function publicScenario(pid) { return store.list().find((x) => x.public && x.publicId === pid && x.thesis) || null; }
/** What a public page shows: the claim, every dated reading (fingerprinted), the call, the tripwires and the look-alikes. Nothing about the owner but a first name. */
function publicView(sc) {
  const run = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
  const q = run && (run.analysts || []).find((a) => a.id === 'quant');
  const owner = auth.getUser(sc.ownerId);
  const th = sc.thesis;
  return {
    id: sc.publicId, title: th.title, proposition: th.proposition, resolution: th.resolution, horizonDate: th.horizonDate, kind: th.kind, primary: th.primary,
    createdAt: sc.createdAt, sealedFrom: new Date(sc.createdAt).toISOString().slice(0, 10), by: owner ? owner.firstName : null,
    history: (sc.history || []).map((h) => ({ date: h.date, p: h.p, hash: h.hash || null })), backfill: sc.backfill || [],
    latest: run ? { date: run.date, probability: run.probability, verdict: run.verdict, call: run.call, confidence: run.judge.confidence, bull: (run.judge.bull || []).slice(0, 3), bear: (run.judge.bear || []).slice(0, 3), claude: !!run.claude, analysts: (run.analysts || []).length } : null,
    resolved: sc.resolved || null,
    analogs: q && q.analogs ? (({ picks, now, ...rest }) => rest)(q.analogs) : null,
    tripwires: (sc.tripwires || []).map((w) => ({ label: w.label, state: w.state, kind: w.kind, id: w.id, op: w.op, value: w.value, last: w.last || null, hit: w.hit || null })),
  };
}
const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    public: !!sc.public, publicId: sc.public ? sc.publicId : null,
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
  return { ...card(sc, user), thesis: sc.thesis, facts: sc.facts, history: sc.history, backfill: sc.backfill, questions: sc.questions, schedule: sc.schedule, alerts: sc.alerts, depth: sc.depth || 'deep', myCalls: sc.myCalls || [], resolved: sc.resolved || null, tripwires: sc.tripwires || [], latest, sinceVisit, runs, theme, progress: desk.progress(sc.id), queued: queue.some((q) => q.id === sc.id) };
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
    f.alerts = { email: a.email !== undefined ? !!a.email : cur.email !== false, move: Math.max(1, Math.min(50, Number(a.move ?? cur.move) || 5)), flip: a.flip !== undefined ? !!a.flip : cur.flip !== false, settle: a.settle !== undefined ? !!a.settle : cur.settle !== false, cross, tripwire: a.tripwire !== undefined ? !!a.tripwire : cur.tripwire !== false };
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
        let starter = null;
        if (b.starter && typeof b.starter === 'object') {
          const st = b.starter;
          const clean = { symbol: String(st.symbol || '').slice(0, 15), move: String(st.move || '').slice(0, 12), value: Number(st.value) || 0, vs: String(st.vs || '').slice(0, 15), date: String(st.date || '').slice(0, 10) };
          try { const th = desk.buildThesis(clean); starter = { ...clean, proposition: th.proposition }; } catch { starter = null; }
        }
        const { user: nu, duplicate, token } = auth.signup({ ...b, ip, starter });
        if (!duplicate && token) {
          mail.send({ to: nu.email, subject: starter ? 'Confirm your email to start watching your claim' : 'Confirm your email for Run Scenario', text: `Hi ${nu.firstName},\n\n${starter ? `Your claim is ready to watch:\n\n  "${starter.proposition}"\n\nConfirm your email and choose a password with this link, and the desk starts on it straight away` : 'Confirm your email and choose a password with this link'} (one use, 24 hours):\n\n${BASE_URL}/#/reset/${token}\n\nIf you didn't sign up, ignore this email and nothing happens.\n` }).catch(() => {});
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
      try {
        const u = auth.resetPassword({ token: b.token, password: b.password });
        // The claim they tested before signing up becomes their first scenario.
        let starterId = null;
        const st = allowed(u) ? auth.takeStarter(u.id) : null;
        if (st) {
          try {
            const th = desk.buildThesis(st);
            const sc = store.create({ ownerId: u.id, claim: th.proposition });
            store.patch(sc.id, { thesis: th, ...runOptions({}, u) });
            enqueue(sc.id, 'new');
            starterId = sc.id;
          } catch (e) { console.error(`starter for ${u.id}: ${e.message}`); }
        }
        return json(res, 200, { ok: true, email: u.email, starter: starterId });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    // The front page: test a claim before having an account. Data desk only (never Claude), rate-limited.
    if (p === '/api/try' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`try:${ip}`, 30, 3600 * 1000)) return json(res, 429, { error: 'That\'s a lot of tests for one hour. Create an account to keep going.' });
      try { return json(res, 200, await tryClaim(b)); } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not test that claim right now.', ...(e.guess ? { guess: e.guess } : {}) }); }
    }
    if (p === '/api/public-trends' && req.method === 'GET') {
      const day = trends.days(1)[0];
      return json(res, 200, { date: day ? day.date : null, trends: day ? day.trends.map((t) => ({ title: t.title, category: t.category, symbol: t.market ? t.market.symbol : null, d1: t.market ? t.market.d1 : null, spark: t.market ? t.market.spark.slice(-40) : null, claim: t.claim, build: t.build || null, p: t.quick ? t.quick.p : null })) : [] });
    }
    const pub = p.match(/^\/api\/public\/([A-Za-z0-9_-]{8,16})$/);
    if (pub && req.method === 'GET') {
      if (auth.limited(`public:${ip}`, 120, 3600 * 1000)) return json(res, 429, { error: 'Too many requests.' });
      const sc = publicScenario(pub[1]);
      return sc ? json(res, 200, publicView(sc)) : json(res, 404, { error: 'This page is private or no longer shared.' });
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
  if (p === '/api/discover' && req.method === 'GET') {
    const d = discover.latest();
    if (!d && !discovering) refreshDiscover();
    if (!d) return json(res, 200, { pending: true });
    const mineClaims = store.list().filter((sc) => sc.ownerId === user.id).map((sc) => ({ id: sc.id, t: `${sc.claim} ${sc.thesis ? sc.thesis.title : ''}`.toLowerCase() }));
    const words = (x) => (x.toLowerCase().match(/[a-z0-9$]{3,}/g) || []);
    const tracked = (c) => { const w = words(c.claim); const hit = mineClaims.find((m) => w.length && w.filter((x) => m.t.includes(x)).length / w.length > 0.7); return hit ? hit.id : null; };
    return json(res, 200, { ...d, claims: d.claims.map((c) => ({ ...c, tracked: tracked(c) })), refreshing: !!discovering });
  }
  if (p === '/api/trends' && req.method === 'GET') {
    if (!trending && trendsDue()) buildTrends();
    return json(res, 200, { days: trends.days(14), building: !!trending, max: trends.MAX, nextAt: `${String(13).padStart(2, '0')}:00 UTC` });
  }
  if (p === '/api/trends/rebuild' && req.method === 'POST') {
    if (!user.primary) return json(res, 403, { error: 'Only the owner can rewrite today\'s trends.' });
    if (auth.limited('trends:rebuild', 1, 3 * 3600 * 1000)) return json(res, 429, { error: 'Trends were rewritten recently. They are limited to keep them to the few that matter.' });
    if (!discover.latest() || Date.now() - discover.latest().at > 6 * 3600 * 1000) await refreshDiscover();
    buildTrends(true);
    return json(res, 202, { building: true });
  }
  if (p === '/api/discover/refresh' && req.method === 'POST') {
    if (auth.limited('discover:refresh', 2, 30 * 60 * 1000)) return json(res, 429, { error: 'It refreshed recently. Try again in a little while.' });
    refreshDiscover();
    return json(res, 202, { refreshing: true });
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
    if (typeof b.public === 'boolean' && sc.thesis) {
      f.public = b.public;
      if (b.public && !sc.publicId) f.publicId = crypto.randomBytes(8).toString('base64url');
      if (b.public) f.history = desk.sealHistory((sc.history || []).map((h) => ({ ...h })), sc.thesis, sc.createdAt);
    }
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
