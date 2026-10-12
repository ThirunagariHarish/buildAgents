// Deterministic numbers: technical indicators and a Monte Carlo estimate of
// how likely a price claim is to come true by its date.
//
// The simulation is a "filtered historical" block bootstrap: it replays real
// stretches of the instrument's own daily returns (fat tails, crashes and
// all), rescaled so today's volatility counts more for short horizons, with
// the drift shrunk toward a plain market return so a stock that tripled
// last decade isn't assumed to triple again. A fixed seed per scenario and
// day keeps the number from wobbling on noise alone.

const TD = 252;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logRets = (c) => c.slice(1).map((x, i) => Math.log(x / c[i]));

function sma(c, n) { return c.length >= n ? mean(c.slice(-n)) : null; }
function ema(arr, n) { const k = 2 / (n + 1); let e = arr[0]; const out = [e]; for (let i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); } return out; }
function rsi(c, n = 14) {
  if (c.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function macd(c) {
  if (c.length < 60) return null;
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = e12.map((x, i) => x - e26[i]);
  const signal = ema(line.slice(26), 9);
  const hist = line[line.length - 1] - signal[signal.length - 1];
  return { line: line[line.length - 1], signal: signal[signal.length - 1], hist };
}
const ret = (c, n) => (c.length > n ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);

/** The indicator sheet for one series. */
function indicators(series) {
  const c = series.close;
  const last = c[c.length - 1];
  const r = logRets(c);
  const yr = c.slice(-TD);
  const hi52 = Math.max(...yr), lo52 = Math.min(...yr);
  const ath = Math.max(...c);
  const s50 = sma(c, 50), s200 = sma(c, 200);
  const s200prev = c.length >= 220 ? mean(c.slice(-220, -20)) : null;
  return {
    last, asOf: series.dates[series.dates.length - 1],
    sma50: s50, sma200: s200, sma200Rising: s200 && s200prev ? s200 > s200prev : null,
    rsi14: rsi(c.slice(-300)), macd: macd(c.slice(-300)),
    ret1m: ret(c, 21), ret3m: ret(c, 63), ret6m: ret(c, 126), ret12m: ret(c, TD), ret5d: ret(c, 5),
    vol20: sd(r.slice(-20)) * Math.sqrt(TD), vol1y: sd(r.slice(-TD)) * Math.sqrt(TD), volLong: sd(r) * Math.sqrt(TD),
    hi52, lo52, ath, fromHigh: last / hi52 - 1, fromAth: last / ath - 1,
    maxDrawdown1y: (() => { let peak = yr[0], dd = 0; for (const x of yr) { peak = Math.max(peak, x); dd = Math.min(dd, x / peak - 1); } return dd; })(),
  };
}

/** Trend/momentum read, -1 (bearish) to +1 (bullish), with the reasons. */
function technicalScore(ind) {
  const parts = [];
  const add = (w, why) => parts.push({ w, why });
  if (ind.sma200) add(ind.last > ind.sma200 ? 0.25 : -0.25, `Price is ${ind.last > ind.sma200 ? 'above' : 'below'} its 200-day average (${pct(ind.last / ind.sma200 - 1)})`);
  if (ind.sma50 && ind.sma200) add(ind.sma50 > ind.sma200 ? 0.15 : -0.15, ind.sma50 > ind.sma200 ? '50-day average is above the 200-day (uptrend structure)' : '50-day average is below the 200-day ("death cross" structure)');
  if (ind.sma200Rising !== null) add(ind.sma200Rising ? 0.1 : -0.1, `200-day average is ${ind.sma200Rising ? 'rising' : 'falling'}`);
  if (ind.ret3m !== null) add(clamp(ind.ret3m / 0.15, -1, 1) * 0.2, `3-month return ${pct(ind.ret3m)}`);
  if (ind.ret12m !== null && ind.ret1m !== null) add(clamp((ind.ret12m - ind.ret1m) / 0.3, -1, 1) * 0.1, `12-month momentum (skipping the last month) ${pct(ind.ret12m - ind.ret1m)}`);
  if (ind.macd) add(ind.macd.hist > 0 ? 0.08 : -0.08, `MACD is ${ind.macd.hist > 0 ? 'above' : 'below'} its signal line`);
  if (ind.rsi14 !== null) {
    if (ind.rsi14 > 70) add(-0.08, `RSI ${ind.rsi14.toFixed(0)}: overbought, pullbacks are common from here`);
    else if (ind.rsi14 < 30) add(0.08, `RSI ${ind.rsi14.toFixed(0)}: oversold, bounces are common from here`);
    else parts.push({ w: 0, why: `RSI ${ind.rsi14.toFixed(0)}: neutral` });
  }
  if (ind.vol20 > 1.5 * ind.vol1y) add(-0.1, `Volatility is elevated: ${pct(ind.vol20, 0)} annualized vs ${pct(ind.vol1y, 0)} over the year`);
  else if (ind.vol20 < 0.7 * ind.vol1y) parts.push({ w: 0, why: `Volatility is calm: ${pct(ind.vol20, 0)} vs ${pct(ind.vol1y, 0)} over the year` });
  return { score: clamp(parts.reduce((s, p) => s + p.w, 0), -1, 1), parts };
}

function pct(x, d = 1) { return x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`; }

function tradingDaysUntil(date, from = new Date()) {
  const days = (Date.parse(`${date}T21:00:00Z`) - from.getTime()) / 86400000;
  return Math.round(days * TD / 365);
}

/**
 * P(the target is met by the horizon), from simulated paths.
 * target: { type: drawdown|touch|close|return|outperform, value?, level?, direction?: above|below, vs? }
 */
function simulate({ series, vsSeries = null, target, horizonDays, seed = 'x', paths = 4000, asOfIndex = null }) {
  const end = asOfIndex === null ? series.close.length : asOfIndex + 1;
  const c = series.close.slice(Math.max(0, end - TD * 10), end);
  let r = logRets(c);
  let rv = null;
  if (target.type === 'outperform') {
    // Pair the two series' returns day by day.
    const idx = new Map(vsSeries.dates.map((d, i) => [d, i]));
    const dates = series.dates.slice(Math.max(0, end - TD * 10), end);
    const a = [], b = [];
    for (let i = 1; i < dates.length; i++) {
      const j = idx.get(dates[i]), j0 = idx.get(dates[i - 1]);
      if (j === undefined || j0 === undefined) continue;
      a.push(Math.log(c[i] / c[i - 1])); b.push(Math.log(vsSeries.close[j] / vsSeries.close[j0]));
    }
    r = a; rv = b;
  }
  if (r.length < 120 || horizonDays < 1) return null;
  const H = Math.min(horizonDays, TD * 5);
  // Volatility: today's counts fully for a month, then fades into the long run.
  const longSd = sd(r), recentSd = sd(r.slice(-20));
  const w = Math.min(1, 30 / H);
  const scale = Math.sqrt(w * recentSd ** 2 + (1 - w) * longSd ** 2) / longSd;
  // Drift: shrink the instrument's own history toward ~6%/yr.
  const prior = Math.log(1.06) / TD;
  const drift = 0.3 * mean(r) + 0.7 * prior;
  const m = mean(r);
  const step = (x) => (x - m) * scale + drift;
  const stepV = rv ? ((mv) => (x) => (x - mv) * scale + (0.3 * mv + 0.7 * prior))(mean(rv)) : null;
  const rand = rng(seedOf(seed));
  const last = c[c.length - 1];
  const peak0 = Math.max(...c.slice(-TD));
  const BLOCK = 10;
  let hits = 0;
  const finals = [];
  for (let p = 0; p < paths; p++) {
    let lp = 0, lv = 0, peak = Math.log(peak0 / last), hit = false, minDd = 0;
    let i = Math.floor(rand() * r.length);
    for (let t = 0; t < H; t++) {
      if (t % BLOCK === 0 || i >= r.length) i = Math.floor(rand() * r.length);
      lp += step(r[i]);
      if (rv) lv += stepV(rv[i]);
      i++;
      if (lp > peak) peak = lp;
      const dd = Math.exp(lp - peak) - 1;
      if (dd < minDd) minDd = dd;
      if (target.type === 'drawdown' && dd <= -Math.abs(target.value)) hit = true;
      if (target.type === 'touch') { const px = last * Math.exp(lp); if (target.direction === 'below' ? px <= target.level : px >= target.level) hit = true; }
    }
    const px = last * Math.exp(lp);
    if (target.type === 'close') hit = target.direction === 'below' ? px <= target.level : px >= target.level;
    if (target.type === 'return') { const rr = Math.exp(lp) - 1; hit = target.direction === 'below' ? rr <= target.value : rr >= target.value; }
    if (target.type === 'outperform') { const gap = Math.exp(lp) - Math.exp(lv); hit = target.direction === 'below' ? gap < -(target.value || 0) : gap > (target.value || 0); }
    if (hit) hits++;
    finals.push(px);
  }
  finals.sort((a, b) => a - b);
  const q = (x) => finals[Math.floor(x * (finals.length - 1))];
  return {
    probability: hits / paths, paths, horizonDays: H, last,
    quantiles: { p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) },
    volUsed: longSd * scale * Math.sqrt(TD), driftUsed: drift * TD,
  };
}

/** How the base rate of the target looked over history: share of past windows of the same length where it happened. */
function historicalRate({ series, target, horizonDays }) {
  const c = series.close;
  const H = Math.min(horizonDays, TD * 5);
  if (!['drawdown', 'return'].includes(target.type) || c.length < H + TD) return null;
  let n = 0, hit = 0;
  for (let s = TD; s + H < c.length; s += 5) {
    n++;
    if (target.type === 'drawdown') {
      let peak = Math.max(...c.slice(s - TD, s + 1)), h = false;
      for (let t = s; t <= s + H; t++) { peak = Math.max(peak, c[t]); if (c[t] / peak - 1 <= -Math.abs(target.value)) { h = true; break; } }
      if (h) hit++;
    } else {
      const rr = c[s + H] / c[s] - 1;
      if (target.direction === 'below' ? rr <= target.value : rr >= target.value) hit++;
    }
  }
  return n >= 20 ? { rate: hit / n, windows: n, years: +(c.length / TD).toFixed(1) } : null;
}

/** The model's probability on each of the past ~3 months (for a chart that starts with history). */
function backfill({ series, vsSeries, target, horizonDate, seed }) {
  const out = [];
  const n = series.close.length;
  for (let k = 63; k >= 0; k -= 3) {
    const i = n - 1 - k;
    if (i < 300) continue;
    const date = series.dates[i];
    const H = tradingDaysUntil(horizonDate, new Date(`${date}T21:00:00Z`));
    // Price levels move with the market; drawdown/return/outperform targets are relative, so replaying them is fair.
    const sim = simulate({ series, vsSeries, target, horizonDays: H, seed: `${seed}:${date}`, paths: 1500, asOfIndex: i });
    if (sim) out.push({ date, p: Math.round(sim.probability * 1000) / 10 });
  }
  return out;
}

/** Correlation of daily returns over the last year (for comparisons). */
function correlation(a, b) {
  const idx = new Map(b.dates.map((d, i) => [d, i]));
  const x = [], y = [];
  const from = Math.max(1, a.dates.length - TD);
  for (let i = from; i < a.dates.length; i++) {
    const j = idx.get(a.dates[i]), j0 = idx.get(a.dates[i - 1]);
    if (j === undefined || j0 === undefined) continue;
    x.push(Math.log(a.close[i] / a.close[i - 1])); y.push(Math.log(b.close[j] / b.close[j0]));
  }
  if (x.length < 60) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

module.exports = { indicators, technicalScore, simulate, historicalRate, backfill, correlation, tradingDaysUntil, pct, mean, sd, clamp };
