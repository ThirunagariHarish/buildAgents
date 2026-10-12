// Macro read from FRED series, by rules that have a track record. Each rule
// says what it saw and which way it leans: positive = risk-off (bad for
// stocks), negative = risk-on. Nothing here is a forecast on its own; the
// judge weighs it with everything else.

const last = (pts) => pts[pts.length - 1];
const at = (pts, daysAgo) => {
  const t = Date.parse(last(pts)[0]) - daysAgo * 86400000;
  for (let i = pts.length - 1; i >= 0; i--) if (Date.parse(pts[i][0]) <= t) return pts[i];
  return pts[0];
};
const f = (x, d = 2) => Number(x).toFixed(d);

const RULES = {
  T10Y2Y(p) {
    const v = last(p)[1];
    const minYear = Math.min(...p.filter((x) => Date.parse(x[0]) > Date.now() - 400 * 86400000).map((x) => x[1]));
    if (v < 0) return { lean: 0.4, text: `Yield curve (10y-2y) is inverted at ${f(v)} pts. Inversions have preceded every US recession since the 1970s, with long and variable lags.` };
    if (minYear < 0) return { lean: 0.5, text: `Yield curve has un-inverted (now ${f(v)}, was ${f(minYear)} within a year). Historically, recessions often began after the curve re-steepened.` };
    return { lean: -0.1, text: `Yield curve is positive at ${f(v)} pts: no inversion signal.` };
  },
  T10Y3M(p) {
    const v = last(p)[1];
    return v < 0 ? { lean: 0.35, text: `10y-3m curve inverted at ${f(v)} (the NY Fed's recession-model input).` } : { lean: -0.1, text: `10y-3m curve positive at ${f(v)}.` };
  },
  VIXCLS(p) {
    const v = last(p)[1], m = at(p, 30)[1];
    if (v >= 30) return { lean: 0.45, text: `VIX ${f(v, 1)}: fear is high (was ${f(m, 1)} a month ago).` };
    if (v >= 22) return { lean: 0.2, text: `VIX ${f(v, 1)}: above its long-run ~19 (was ${f(m, 1)} a month ago).` };
    if (v < 14) return { lean: -0.1, text: `VIX ${f(v, 1)}: very calm. Calm can persist, but it also means little hedging is priced in.` };
    return { lean: -0.05, text: `VIX ${f(v, 1)}: normal range (was ${f(m, 1)} a month ago).` };
  },
  BAMLH0A0HYM2(p) {
    const v = last(p)[1], m = at(p, 60)[1];
    const ch = v - m;
    if (v >= 6) return { lean: 0.5, text: `High-yield credit spread ${f(v)}%: credit markets are stressed.` };
    if (ch >= 0.75) return { lean: 0.35, text: `High-yield spread widened ${f(ch)} pts in 2 months to ${f(v)}%: credit is starting to worry.` };
    if (v < 3.5) return { lean: -0.2, text: `High-yield spread tight at ${f(v)}%: credit markets see little default risk.` };
    return { lean: 0, text: `High-yield spread ${f(v)}% (${ch >= 0 ? '+' : ''}${f(ch)} in 2 months): unremarkable.` };
  },
  UNRATE(p) {
    const avg3 = (i) => (p[i][1] + p[i - 1][1] + p[i - 2][1]) / 3;
    const n = p.length - 1;
    if (n < 15) return null;
    const now = avg3(n);
    let low = Infinity; for (let i = n - 12; i < n; i++) low = Math.min(low, avg3(i));
    const sahm = now - low;
    if (sahm >= 0.5) return { lean: 0.5, text: `Sahm rule triggered: 3-month unemployment average is ${f(sahm)} pts above its 12-month low (unemployment ${f(p[n][1], 1)}%).` };
    if (sahm >= 0.3) return { lean: 0.25, text: `Unemployment is drifting up: ${f(sahm)} pts above its 12-month low (Sahm trigger is 0.5). Now ${f(p[n][1], 1)}%.` };
    return { lean: -0.1, text: `Unemployment ${f(p[n][1], 1)}%, stable (${f(sahm)} pts above its 12-month low).` };
  },
  SAHMREALTIME(p) { const v = last(p)[1]; return v >= 0.5 ? { lean: 0.5, text: `Sahm recession indicator at ${f(v)} (≥0.5 has marked recessions).` } : { lean: v >= 0.3 ? 0.2 : -0.1, text: `Sahm recession indicator at ${f(v)} (trigger 0.5).` }; },
  NFCI(p) { const v = last(p)[1]; return { lean: v > 0 ? 0.3 : -0.1, text: `Financial conditions index ${f(v)} (${v > 0 ? 'tighter than average' : 'looser than average'}).` }; },
  ICSA(p) {
    const v = last(p)[1], m = at(p, 90)[1];
    const ch = v / m - 1;
    return { lean: ch > 0.15 ? 0.3 : ch < -0.05 ? -0.1 : 0, text: `Initial jobless claims ${Math.round(v / 1000)}k (${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(0)}% vs 3 months ago).` };
  },
  FEDFUNDS(p) { const v = last(p)[1], y = at(p, 365)[1]; return { lean: v - y > 0.5 ? 0.2 : v - y < -0.5 ? -0.15 : 0, text: `Fed funds ${f(v)}% (${v - y >= 0 ? '+' : ''}${f(v - y)} over the year: ${v > y ? 'tightening' : v < y ? 'easing' : 'on hold'}).` }; },
  DGS10(p) { const v = last(p)[1], m = at(p, 90)[1]; return { lean: v - m > 0.5 ? 0.2 : 0, text: `10-year yield ${f(v)}% (${v - m >= 0 ? '+' : ''}${f(v - m)} in 3 months).` }; },
  UMCSENT(p) { const v = last(p)[1]; return { lean: v < 60 ? 0.1 : 0, text: `Consumer sentiment ${f(v, 1)} (long-run average ~85).` }; },
  CPIAUCSL(p) { const y = at(p, 365)[1]; const v = last(p)[1]; const inf = v / y - 1; return { lean: inf > 0.035 ? 0.15 : 0, text: `CPI inflation ${(inf * 100).toFixed(1)}% over the year.` }; },
};

/** Read the series that have rules. Returns { risk (-1..1), items: [{id, name, lean, text, last, date, url}] }. */
function read(seriesList) {
  const items = [];
  for (const s of seriesList) {
    if (!s || !s.points || s.points.length < 3) continue;
    const rule = RULES[s.id];
    const r = rule ? rule(s.points) : null;
    const [date, value] = last(s.points);
    items.push({ id: s.id, name: s.name, lean: r ? r.lean : 0, text: r ? r.text : `${s.name}: ${value} (${date}).`, last: value, date, url: s.url, spark: s.points.slice(-120).map((x) => x[1]) });
  }
  const ruled = items.filter((i) => RULES[i.id]);
  const risk = ruled.length ? Math.max(-1, Math.min(1, ruled.reduce((a, i) => a + i.lean, 0) / Math.sqrt(ruled.length) / 0.9)) : 0;
  return { risk, items };
}

const DEFAULT_SERIES = ['T10Y2Y', 'VIXCLS', 'BAMLH0A0HYM2', 'UNRATE', 'NFCI', 'ICSA', 'FEDFUNDS'];

module.exports = { read, RULES, DEFAULT_SERIES };
