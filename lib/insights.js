// Views across all of a person's scenarios: Today (what moved, what's
// coming), Markets (a pulse of the market, the watchlist, trending
// prediction markets) and the Track record (how good the calls were).

const fs = require('fs');
const path = require('path');
const store = require('./store');
const data = require('./data');
const free = require('./free');
const quant = require('./quant');
const { DATA } = require('./config');

// ---- per-person preferences ---------------------------------------------------------
const PREFS = path.join(DATA, 'prefs.json');
const DEFAULT_WATCH = ['SPY', 'QQQ', 'NVDA', 'BTC-USD'];
function allPrefs() { try { return JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch { return {}; } }
function prefs(userId) { return { digest: true, watchlist: DEFAULT_WATCH, ...(allPrefs()[userId] || {}) }; }
function setPrefs(userId, patch) {
  const all = allPrefs();
  all[userId] = { ...prefs(userId), ...patch };
  const t = `${PREFS}.tmp`;
  fs.writeFileSync(t, JSON.stringify(all), { mode: 0o600 });
  fs.renameSync(t, PREFS);
  return all[userId];
}

// ---- today -------------------------------------------------------------------------------
function today(userScenarios, userId) {
  const movers = [], catalysts = [], settled = [], evidence = [];
  let working = 0;
  for (const sc of userScenarios) {
    if (['running', 'queued', 'new'].includes(sc.status)) working++;
    if (sc.archived) continue;
    const h = sc.history || [];
    const last = h[h.length - 1];
    if (!last) continue;
    // Change since this person last opened it, else since the previous reading.
    const seenId = (sc.seen || {})[userId];
    const seenPoint = seenId ? h.find((x) => x.runId === seenId) : null;
    const base = seenPoint && seenPoint.runId !== last.runId ? seenPoint : h[h.length - 2];
    const title = sc.thesis ? sc.thesis.title : sc.claim;
    if (base) movers.push({ id: sc.id, title, p: last.p, from: base.p, change: Math.round((last.p - base.p) * 10) / 10, since: base.date, unseen: !!(seenPoint && seenPoint.runId !== last.runId) || !seenId });
    if (sc.status === 'resolved' && sc.resolved) settled.push({ id: sc.id, title, outcome: sc.resolved.outcome, why: sc.resolved.why, at: sc.latest ? sc.latest.at : sc.updatedAt });
    // New articles in this scenario's reading room.
    const rv = require('./reading').view(sc.id, userId, { limitDays: 3 });
    const fresh = rv.days.flatMap((d) => d.items).filter((x) => !x.read && x.stance !== 'context');
    if (fresh.length) evidence.push({ id: sc.id, title, unread: rv.unread, for: fresh.filter((x) => x.stance === 'for').length, against: fresh.filter((x) => x.stance === 'against').length, top: fresh.slice(0, 3).map((x) => ({ title: x.title, url: x.url, source: x.source, stance: x.stance, key: x.key })) });
    const run = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
    const r = run && run.analysts.find((a) => a.id === 'research');
    for (const c of (r && r.catalysts) || []) {
      if (c.date && c.date >= new Date().toISOString().slice(0, 10)) catalysts.push({ ...c, id: sc.id, title });
    }
  }
  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  catalysts.sort((a, b) => a.date.localeCompare(b.date));
  // The same event (an FOMC meeting) often shows up under several scenarios.
  const seen = new Map();
  for (const c of catalysts) { const k = `${c.date}|${c.event.toLowerCase().slice(0, 24)}`; if (!seen.has(k)) seen.set(k, { ...c, scenarios: [{ id: c.id, title: c.title }] }); else seen.get(k).scenarios.push({ id: c.id, title: c.title }); }
  return { movers: movers.slice(0, 8), catalysts: [...seen.values()].slice(0, 12), settled: settled.sort((a, b) => b.at - a.at).slice(0, 5), evidence: evidence.sort((a, b) => b.unread - a.unread).slice(0, 6), working, total: userScenarios.length };
}

// ---- markets --------------------------------------------------------------------------------
const PULSE = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['IWM', 'Small caps'], ['^VIX', 'Volatility (VIX)'], ['^TNX', '10-year yield'], ['GC=F', 'Gold'], ['CL=F', 'Crude oil'], ['BTC-USD', 'Bitcoin']];
function quote(series, name) {
  const c = series.close, n = c.length;
  const pick = (k) => (n > k ? c[n - 1] / c[n - 1 - k] - 1 : null);
  return { symbol: series.symbol, name: name || series.name, last: c[n - 1], d1: pick(1), m1: pick(21), y1: pick(252), spark: c.slice(-63), asOf: series.dates[n - 1] };
}
let pulseCache = null;
async function pulse() {
  if (pulseCache && Date.now() - pulseCache.at < 20 * 60 * 1000) return pulseCache;
  const soft = (p) => p.catch(() => null);
  const [quotes, fg, cfg, curve, pm] = await Promise.all([
    Promise.all(PULSE.map(([s, n]) => soft(data.prices(s).then((x) => quote(x, n))))),
    soft(free.fearGreed()), soft(free.cryptoFearGreed()), soft(free.treasuryCurve()),
    soft(free.predictionMarkets(['recession', 'fed rate cut', 'S&P 500'])),
  ]);
  let yc = null;
  if (curve && curve.points.length) {
    const pts = curve.points.slice(-260);
    const l = pts[pts.length - 1][1];
    yc = { date: pts[pts.length - 1][0], y2: l.y2, y10: l.y10, m3: l.m3, spread: Math.round((l.y10 - l.y2) * 100) / 100, spark: pts.map((p) => p[1].y10 - p[1].y2) };
  }
  pulseCache = { at: Date.now(), quotes: quotes.filter(Boolean), fearGreed: fg, cryptoFearGreed: cfg, curve: yc, markets: pm ? pm.markets.filter((m) => !m.playMoney).slice(0, 6) : [] };
  return pulseCache;
}
async function watchlist(symbols) {
  const out = await Promise.all(symbols.slice(0, 12).map((s) => data.prices(s).then((x) => quote(x)).catch(() => ({ symbol: s, error: true }))));
  for (const q of out) {
    if (q.error) continue;
    // A quick read of trend for the list: above or below the 200-day average.
    try { const ind = quant.indicators(await data.prices(q.symbol)); q.trend = ind.sma200 ? (ind.last > ind.sma200 ? 'up' : 'down') : null; q.fromHigh = ind.fromHigh; } catch {}
  }
  return out;
}

// ---- track record ----------------------------------------------------------------------------
/**
 * Scores settled scenarios. Brier = (p - outcome)^2, 0 is perfect, 0.25 is a
 * coin flip forever. The desk's score averages every daily reading; "you"
 * averages the calls the person recorded.
 */
function record(userScenarios) {
  const rows = [];
  const buckets = Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, n: 0, yes: 0 }));
  for (const sc of userScenarios) {
    if (sc.status !== 'resolved' || !sc.resolved) continue;
    const y = sc.resolved.outcome === 'yes' ? 1 : 0;
    // Readings before settlement (the settling reading itself is 1 or 99).
    const h = (sc.history || []).slice(0, -1);
    if (!h.length) continue;
    const brier = h.reduce((s, x) => s + (x.p / 100 - y) ** 2, 0) / h.length;
    for (const x of h) { const b = buckets[Math.min(9, Math.floor(x.p / 10))]; b.n++; b.yes += y; }
    const mine = (sc.myCalls || []);
    const myBrier = mine.length ? mine.reduce((s, x) => s + (x.p / 100 - y) ** 2, 0) / mine.length : null;
    rows.push({ id: sc.id, title: sc.thesis ? sc.thesis.title : sc.claim, outcome: sc.resolved.outcome, first: h[0].p, last: h[h.length - 1].p, readings: h.length, brier, myBrier, myLast: mine.length ? mine[mine.length - 1].p : null });
  }
  const avg = (k) => { const v = rows.map((r) => r[k]).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const open = userScenarios.filter((sc) => sc.status !== 'resolved' && !sc.archived && (sc.history || []).length).map((sc) => ({ id: sc.id, title: sc.thesis ? sc.thesis.title : sc.claim, p: sc.history[sc.history.length - 1].p, mine: (sc.myCalls || []).length ? sc.myCalls[sc.myCalls.length - 1].p : null }));
  return { settled: rows, brier: avg('brier'), myBrier: avg('myBrier'), calibration: buckets.filter((b) => b.n).map((b) => ({ range: `${b.lo}-${b.lo + 10}%`, n: b.n, hit: b.yes / b.n })), open };
}

module.exports = { prefs, setPrefs, today, pulse, watchlist, record, DEFAULT_WATCH };
