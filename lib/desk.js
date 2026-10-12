// The desk: a strategist turns a claim into something measurable, a team of
// analysts each brings evidence and a lean, and a judge who argues both sides
// commits to one probability. Run once when a scenario is created and then
// every day; each run is compared with the last.

const crypto = require('crypto');
const data = require('./data');
const quant = require('./quant');
const macro = require('./macro');
const sentiment = require('./sentiment');
const models = require('./models');
const store = require('./store');
const { askJson } = require('./claude');
const { MODEL_FAST, MODEL_JUDGE } = require('./config');

const today = () => new Date().toISOString().slice(0, 10);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = (p) => Math.log(p / (1 - p));
const sigm = (x) => 1 / (1 + Math.exp(-x));
const pct = quant.pct;
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

const NEUTRAL_RULES = `You work on an independent research desk. Facts first: every statement must come from the data you are given or a source you can cite. Do not tell people what they want to hear. You do not know which outcome the person who asked hopes for, and it must not matter. Never give financial advice or tell anyone to buy or sell; describe evidence and probabilities.`;

// ---- 1. strategist -------------------------------------------------------------
async function frame(sc, onStep) {
  onStep('Strategist', 'Turning your claim into something measurable');
  const prompt = `Today is ${today()}.

A person wants this claim tracked and tested against data every day:

CLAIM: ${sc.claim}
${sc.facts ? `\nFACTS THEY GAVE (to be checked, not assumed true):\n${sc.facts}\n` : ''}
Turn it into a precise, neutral proposition that can be checked. Rules:
- Keep the claim's meaning. Don't soften or strengthen it. If it is vague ("crash", "bubble bursting"), pick the most common market definition and say so in assumptions (crash/bear market = 20% drawdown from the 52-week high; correction = 10%; "bubble bursting" for a theme = its main ETF or leaders falling 30%+ from their high).
- If no date is given, choose a sensible horizon (usually 6–12 months) and say so.
- Pick tradable Yahoo Finance symbols: indices via ETFs (SPY, QQQ, IWM, SMH, XLK, TLT, GLD, BITO) or tickers (NVDA), crypto as BTC-USD, futures like GC=F.
- target.type: "drawdown" (value = fraction, e.g. 0.2, measured on primary), "touch" (level + direction above/below, any time before the date), "close" (level + direction, on the date), "return" (value = fraction, e.g. 0.1 or -0.15, + direction above/below, from today to the date), "outperform" (primary beats "vs" by value, e.g. 0), or "none" when price alone can't settle it (an event, a policy, an earnings outcome).
- direction: "up" if YES is good for the primary instrument's price, "down" if YES is bad for it.
- macro: FRED series ids that matter (choose from T10Y2Y, T10Y3M, VIXCLS, BAMLH0A0HYM2, UNRATE, SAHMREALTIME, NFCI, ICSA, FEDFUNDS, DGS10, CPIAUCSL, UMCSENT, DCOILWTICO, DTWEXBGS, M2SL). 3–7 of them. Empty for a pure single-stock idea is fine.
- userFacts: each separate factual statement from the person's text, verbatim-ish, so analysts can check them one by one.
- baseRate: how often things like this have happened historically over a similar window, with a one-line why. Be honest when uncertain.

Reply with ONLY this JSON:
{"title":"≤60 chars","proposition":"one sentence","resolution":"Resolves YES if … ; NO if …","horizonDate":"YYYY-MM-DD","kind":"market|stock|compare|macro|crypto|event","direction":"up|down","primary":"SYMBOL","target":{"type":"…","value":0.2,"level":null,"direction":null,"vs":null},"instruments":[{"symbol":"…","why":"…"}],"macro":["…"],"newsQuery":"3–6 words for news search","keywords":["…"],"subreddits":["…"],"cashtags":["…"],"tech":true,"userFacts":["…"],"baseRate":{"p":0.15,"why":"…"},"assumptions":["…"],"followUps":["related questions worth tracking"]}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's strategist.`, model: MODEL_FAST, tools: ['WebSearch'], timeoutMs: 4 * 60 * 1000, onActivity: (a) => onStep('Strategist', a) });
  return { thesis: normalizeThesis(r.json), costUsd: r.costUsd };
}

function normalizeThesis(t) {
  const sym = (s) => String(s || '').trim().toUpperCase().slice(0, 15);
  const th = {
    title: short(t.title || t.proposition, 70), proposition: short(t.proposition, 400), resolution: short(t.resolution, 500),
    horizonDate: /^\d{4}-\d{2}-\d{2}$/.test(t.horizonDate) ? t.horizonDate : new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10),
    kind: t.kind || 'market', direction: t.direction === 'up' ? 'up' : 'down', primary: sym(t.primary) || 'SPY',
    target: { type: ['drawdown', 'touch', 'close', 'return', 'outperform', 'none'].includes(t.target?.type) ? t.target.type : 'none', value: Number.isFinite(+t.target?.value) ? +t.target.value : null, level: Number.isFinite(+t.target?.level) && t.target?.level !== null ? +t.target.level : null, direction: t.target?.direction === 'below' ? 'below' : 'above', vs: t.target?.vs ? sym(t.target.vs) : null },
    instruments: (t.instruments || []).map((i) => ({ symbol: sym(i.symbol || i), why: short(i.why, 120) })).filter((i) => i.symbol).slice(0, 6),
    macro: (t.macro || []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z0-9]{2,20}$/.test(x)).slice(0, 8),
    newsQuery: short(t.newsQuery || t.title, 80), keywords: (t.keywords || []).slice(0, 6).map((k) => short(k, 40)),
    subreddits: (t.subreddits || []).map((s) => String(s).replace(/^r\//, '')).filter((s) => /^\w{2,30}$/.test(s)).slice(0, 4),
    cashtags: (t.cashtags || []).map((s) => sym(String(s).replace(/^\$/, ''))).slice(0, 3), tech: !!t.tech,
    userFacts: (t.userFacts || []).map((f) => short(f, 300)).slice(0, 10),
    baseRate: t.baseRate && Number.isFinite(+t.baseRate.p) ? { p: clamp(+t.baseRate.p, 0.01, 0.99), why: short(t.baseRate.why, 300) } : null,
    assumptions: (t.assumptions || []).map((a) => short(a, 200)).slice(0, 5), followUps: (t.followUps || []).map((a) => short(a, 160)).slice(0, 4),
  };
  if (th.target.type === 'drawdown' && th.target.value) th.target.value = Math.abs(th.target.value) > 1 ? Math.abs(th.target.value) / 100 : Math.abs(th.target.value);
  if (th.target.type === 'return' && th.target.value && Math.abs(th.target.value) > 1) th.target.value /= 100;
  if (['touch', 'close'].includes(th.target.type) && !th.target.level) th.target.type = 'none';
  if (th.target.type === 'outperform' && !th.target.vs) th.target.type = 'none';
  // "A underperforms B" is an outperform target pointing down.
  if (th.target.type === 'outperform' && !['above', 'below'].includes(t.target?.direction)) th.target.direction = th.direction === 'down' ? 'below' : 'above';
  if (!th.instruments.some((i) => i.symbol === th.primary)) th.instruments.unshift({ symbol: th.primary, why: 'The claim is measured on this.' });
  if (th.target.vs && !th.instruments.some((i) => i.symbol === th.target.vs)) th.instruments.push({ symbol: th.target.vs, why: 'Compared against.' });
  return th;
}

// ---- 2. gather -----------------------------------------------------------------
async function gather(th, onStep) {
  const errors = [];
  const soft = (label, p) => p.catch((e) => { errors.push(`${label}: ${e.message}`); return null; });
  onStep('Data', `Prices for ${th.instruments.map((i) => i.symbol).join(', ')}`);
  const priceList = await Promise.all(th.instruments.map((i) => soft(`prices ${i.symbol}`, data.prices(i.symbol))));
  const prices = Object.fromEntries(th.instruments.map((i, k) => [i.symbol, priceList[k]]).filter((x) => x[1]));
  onStep('Data', `Macro series from FRED: ${(th.macro.length ? th.macro : ['none']).join(', ')}`);
  const fred = (await Promise.all(th.macro.map((id) => soft(`FRED ${id}`, data.fredSeries(id))))).filter(Boolean);
  onStep('Data', 'Reading Reddit, StockTwits, Hacker News, news and GDELT');
  const q = th.keywords[0] || th.newsQuery;
  const [rd, hn, gn, gd, xs, ...st] = await Promise.all([
    soft('Reddit', data.reddit(q, th.subreddits)),
    th.tech ? soft('Hacker News', data.hackernews(q)) : Promise.resolve(null),
    soft('Google News', data.googleNews(th.newsQuery)),
    soft('GDELT', data.gdeltTone(th.newsQuery)),
    soft('X', data.xSearch(th.cashtags.length ? th.cashtags.map((c) => `$${c}`).join(' OR ') : q)),
    ...th.cashtags.map((c) => soft(`StockTwits ${c}`, data.stocktwits(c))),
  ]);
  // Company filings for the primary, or else the first company among the instruments (ETFs have none).
  let fund = null;
  for (const sym of [th.primary, ...th.instruments.map((i) => i.symbol).filter((x) => x !== th.primary)].filter((x) => /^[A-Z]{1,5}$/.test(x)).slice(0, 3)) {
    const f = await data.fundamentals(sym).catch(() => null);
    if (f) { fund = { ...f, symbol: sym }; break; }
  }
  return { prices, fred, social: { reddit: rd, hn, news: gn, gdelt: gd, x: xs, stocktwits: st.filter(Boolean) }, fund, errors };
}

// ---- 3. analysts ---------------------------------------------------------------
// Each returns { id, name, icon, stance (-1 against the claim … +1 for it), confidence 0..1, headline, points: [{text, for?, source?, url?}], ... }

function quantAnalyst(sc, th, d) {
  const s = d.prices[th.primary];
  if (!s || th.target.type === 'none') return null;
  const H = quant.tradingDaysUntil(th.horizonDate);
  if (H < 1) return null;
  const vs = th.target.vs ? d.prices[th.target.vs] : null;
  if (th.target.type === 'outperform' && !vs) return null;
  const sim = quant.simulate({ series: s, vsSeries: vs, target: th.target, horizonDays: H, seed: `${sc.id}:${today()}` });
  if (!sim) return null;
  const hist = quant.historicalRate({ series: s, target: th.target, horizonDays: H });
  const p = sim.probability;
  const desc = describeTarget(th);
  const points = [
    { text: `${sim.paths.toLocaleString()} simulated paths over ${H} trading days, replaying ${th.primary}'s own past daily moves (fat tails included), volatility ${pct(sim.volUsed, 0)}/yr, drift ${pct(sim.driftUsed, 1)}/yr.`, source: 'Monte Carlo (block bootstrap)' },
    { text: `${desc} happened in ${(p * 100).toFixed(1)}% of paths.`, for: p >= 0.5 },
    { text: `Middle 50% of outcomes by ${th.horizonDate}: ${fmtPx(sim.quantiles.p25)}–${fmtPx(sim.quantiles.p75)} (now ${fmtPx(sim.last)}); 5–95%: ${fmtPx(sim.quantiles.p05)}–${fmtPx(sim.quantiles.p95)}.` },
  ];
  if (hist) points.push({ text: `History check: over ${hist.years} years of ${th.primary}, this happened in ${(hist.rate * 100).toFixed(0)}% of ${hist.windows} past windows of the same length.`, source: s.source });
  return { id: 'quant', name: 'Quant', icon: '🎲', probability: p, stance: clamp((p - 0.5) * 2, -1, 1), confidence: 0.6, headline: `${(p * 100).toFixed(0)}% chance by the numbers alone`, points, sim, hist };
}

function describeTarget(th) {
  const t = th.target;
  switch (t.type) {
    case 'drawdown': return `A ${(t.value * 100).toFixed(0)}% fall in ${th.primary} from its high`;
    case 'touch': return `${th.primary} reaching ${t.direction === 'below' ? '≤' : '≥'} ${t.level}`;
    case 'close': return `${th.primary} ending ${t.direction === 'below' ? 'below' : 'above'} ${t.level} on ${th.horizonDate}`;
    case 'return': return `${th.primary} returning ${t.direction === 'below' ? '≤' : '≥'} ${pct(t.value, 0)}`;
    case 'outperform': return `${th.primary} ${t.direction === 'below' ? 'trailing' : 'beating'} ${t.vs}${t.value ? ` by ${pct(t.value, 0)}` : ''}`;
    default: return th.proposition;
  }
}
const fmtPx = (x) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? x.toFixed(1) : x.toFixed(3));

function technicalAnalyst(th, d) {
  const syms = th.instruments.map((i) => i.symbol).filter((s) => d.prices[s]);
  if (!syms.length) return null;
  const sheets = syms.map((s) => ({ symbol: s, name: d.prices[s].name, source: d.prices[s].source, ind: quant.indicators(d.prices[s]) }));
  const main = sheets.find((x) => x.symbol === th.primary) || sheets[0];
  const ts = quant.technicalScore(main.ind);
  const sign = th.direction === 'up' ? 1 : -1;
  let stance = ts.score * sign;
  // For a comparison, what matters is the relative trend.
  let rel = null;
  if (th.target.type === 'outperform' && d.prices[th.target.vs]) {
    const other = sheets.find((x) => x.symbol === th.target.vs);
    if (other) {
      const r3 = (main.ind.ret3m || 0) - (other.ind.ret3m || 0), r12 = (main.ind.ret12m || 0) - (other.ind.ret12m || 0);
      rel = { r3, r12, corr: quant.correlation(d.prices[th.primary], d.prices[th.target.vs]) };
      stance = clamp((r3 / 0.1 * 0.5 + r12 / 0.2 * 0.3) * (th.target.direction === 'below' ? -1 : 1), -1, 1);
    }
  }
  const i = main.ind;
  const points = [
    { text: `${main.symbol} ${fmtPx(i.last)} (${i.asOf}): ${pct(i.fromHigh)} from its 52-week high, 1-year range ${fmtPx(i.lo52)}–${fmtPx(i.hi52)}.`, source: main.source },
    ...ts.parts.map((p) => ({ text: p.why, for: p.w === 0 ? undefined : p.w * sign > 0 })),
    { text: `Returns: 1 month ${pct(i.ret1m)}, 3 months ${pct(i.ret3m)}, 12 months ${pct(i.ret12m)}. Worst drop in the last year ${pct(i.maxDrawdown1y)}.` },
  ];
  if (rel) points.push({ text: `${th.primary} vs ${th.target.vs}: ${pct(rel.r3)} over 3 months, ${pct(rel.r12)} over 12 months${rel.corr !== null ? `; daily correlation ${rel.corr.toFixed(2)}` : ''}.`, for: (rel.r3 > 0) === (th.target.direction !== 'below') });
  for (const o of sheets.filter((x) => x !== main).slice(0, 4)) points.push({ text: `${o.symbol}: ${fmtPx(o.ind.last)}, ${pct(o.ind.fromHigh)} from high, 3m ${pct(o.ind.ret3m)}, ${o.ind.sma200 && o.ind.last > o.ind.sma200 ? 'above' : 'below'} its 200-day.` });
  const trendWord = ts.score > 0.25 ? 'an uptrend' : ts.score < -0.25 ? 'a downtrend' : 'a mixed trend';
  const effect = stance > 0.1 ? 'supports' : stance < -0.1 ? 'works against' : 'neither helps nor hurts';
  const headline = rel
    ? `${main.symbol} is ${rel.r3 >= 0 ? 'beating' : 'lagging'} ${th.target.vs} (${pct(rel.r3)} over 3 months, ${pct(rel.r12)} over 12), which ${effect} the claim`
    : `${main.symbol} is in ${trendWord} (${ts.score >= 0 ? '+' : ''}${ts.score.toFixed(2)}), which ${effect} the claim`;
  return {
    id: 'technical', name: 'Technicals', icon: '📈', stance, confidence: clamp(0.3 + Math.abs(ts.score) * 0.4, 0.3, 0.7),
    headline,
    points, sheets: sheets.map((x) => ({ symbol: x.symbol, name: x.name, last: x.ind.last, fromHigh: x.ind.fromHigh, ret3m: x.ind.ret3m, rsi: x.ind.rsi14, spark: d.prices[x.symbol].close.slice(-130) })),
  };
}

function macroAnalyst(th, d) {
  if (!d.fred.length) return null;
  const m = macro.read(d.fred);
  // Risk-off supports a "down" claim and works against an "up" one. Single
  // stocks and comparisons care less about the cycle.
  const sign = th.direction === 'down' ? 1 : -1;
  const weight = ['stock', 'compare', 'event'].includes(th.kind) ? 0.5 : 1;
  const stance = clamp(m.risk * sign * weight, -1, 1);
  return {
    id: 'macro', name: 'Macro', icon: '🏛️', stance, confidence: clamp(0.25 + Math.abs(m.risk) * 0.35, 0.25, 0.6) * weight + 0.05,
    headline: `Macro backdrop is ${m.risk > 0.25 ? 'risk-off' : m.risk < -0.15 ? 'supportive (risk-on)' : 'mixed'} (${m.risk >= 0 ? '+' : ''}${m.risk.toFixed(2)} on a −1 calm … +1 stressed scale)`,
    points: m.items.map((x) => ({ text: x.text, for: x.lean === 0 ? undefined : x.lean * sign > 0, source: 'FRED', url: x.url })),
    series: m.items.map((x) => ({ id: x.id, name: x.name, last: x.last, date: x.date, spark: x.spark })),
  };
}

async function sentimentAnalyst(th, d, prev) {
  const s = d.social;
  const groups = [
    ['StockTwits', s.stocktwits.flatMap((x) => x.posts)],
    ['Reddit', s.reddit?.posts || []],
    ['X', s.x?.posts || []],
    ['Hacker News', s.hn?.posts || []],
    ['News headlines', s.news?.posts || []],
  ].filter((g) => g[1].length);
  if (!groups.length && !s.gdelt) return null;
  const scored = [];
  for (const [name, posts] of groups) scored.push({ name, ...(await sentiment.scorePosts(posts.slice(0, 80))) });
  // The crowd's lean on the primary instrument, weighted by how much each source says.
  const tot = scored.reduce((a, g) => a + g.bull + g.bear, 0);
  const net = tot ? scored.reduce((a, g) => a + g.net * (g.bull + g.bear), 0) / tot : 0;
  const sign = th.direction === 'up' ? 1 : -1;
  const agree = net * sign; // the crowd's mood vs the claim
  const tone = s.gdelt?.points || [];
  const toneNow = tone.length ? quant.mean(tone.slice(-7).map((x) => x[1])) : null;
  const toneBefore = tone.length > 30 ? quant.mean(tone.slice(-37, -7).map((x) => x[1])) : null;
  const points = scored.map((g) => ({ text: `${g.name}: ${g.n} posts this week, ${g.bull} bullish / ${g.bear} bearish / ${g.neutral} neutral${g.tagged ? ` (${g.tagged} tagged by their authors)` : ''}.`, for: g.bull + g.bear >= 5 ? (g.net * sign > 0) : undefined, source: g.method }));
  if (toneNow !== null) points.push({ text: `World news tone (GDELT) ${toneNow.toFixed(2)} this week${toneBefore !== null ? ` vs ${toneBefore.toFixed(2)} the month before (${toneNow > toneBefore ? 'warmer' : 'colder'})` : ''}.`, source: 'GDELT', for: toneBefore !== null ? ((toneNow - toneBefore) * sign > 0) : undefined });
  const extreme = Math.abs(net) > 0.6 && tot >= 20;
  if (extreme) points.push({ text: `The crowd is one-sided (${net > 0 ? 'bullish' : 'bearish'} ${Math.round(Math.abs(net) * 100)}%). Extreme agreement has often been a contrarian signal, so this counts for less.` });
  if (prev && Number.isFinite(prev.net)) points.push({ text: `Since the last run the crowd moved ${net > prev.net ? 'more bullish' : net < prev.net ? 'more bearish' : 'nowhere'} (${prev.net.toFixed(2)} → ${net.toFixed(2)}).` });
  const loudest = scored.flatMap((g) => g.posts.map((p) => ({ ...p, group: g.name }))).filter((p) => Math.abs(p.s) >= 0.4).sort((a, b) => (b.score || 0) - (a.score || 0) || Math.abs(b.s) - Math.abs(a.s)).slice(0, 6);
  // Sentiment is a weak predictor; it moves the needle a little.
  const stance = clamp(agree * (extreme ? 0.3 : 0.6), -1, 1);
  return {
    id: 'sentiment', name: 'Sentiment', icon: '🗣️', stance, confidence: clamp(0.15 + Math.min(tot, 200) / 200 * 0.25, 0.15, 0.4), net,
    headline: tot ? `The crowd is ${net > 0.2 ? 'bullish' : net < -0.2 ? 'bearish' : 'split'} on ${th.primary} (${Math.round((net + 1) * 50)}% bullish of ${tot} opinionated posts), ${agree > 0.15 ? 'agreeing with' : agree < -0.15 ? 'leaning against' : 'undecided on'} the claim` : 'Little chatter found this week',
    points, quotes: loudest.map((p) => ({ text: short(p.text, 220), s: p.s, where: p.where || p.group, url: p.url, group: p.group })), method: scored[0]?.method || 'word list',
  };
}

function fundamentalsAnalyst(th, d) {
  const f = d.fund;
  const px = f && d.prices[f.symbol];
  if (!f || !px) return null;
  const last = px.close[px.close.length - 1];
  const pe = f.epsTTM > 0 ? last / f.epsTTM : null;
  const margin = f.revenueTTM ? f.netIncomeTTM / f.revenueTTM : null;
  const sign = th.direction === 'up' ? 1 : -1;
  let s = 0;
  const points = [];
  if (f.revenueYoY !== null) { s += clamp(f.revenueYoY / 0.3, -1, 1) * 0.3; points.push({ text: `Revenue ${pct(f.revenueYoY)} year over year (quarter ending ${f.lastQuarter}). TTM revenue ${money(f.revenueTTM)}.`, for: f.revenueYoY * sign > 0, source: 'SEC EDGAR', url: f.url }); }
  if (margin !== null) { s += margin > 0.15 ? 0.15 : margin < 0 ? -0.2 : 0; points.push({ text: `Net margin ${pct(margin)} on the last four quarters (net income ${money(f.netIncomeTTM)}).`, source: 'SEC EDGAR', url: f.url }); }
  if (pe) { s += pe > 60 ? -0.25 : pe > 35 ? -0.1 : pe < 15 ? 0.1 : 0; points.push({ text: `Price/earnings ${pe.toFixed(1)} on trailing diluted EPS ${f.epsTTM.toFixed(2)}${pe > 40 ? ' — priced for a lot of growth' : ''}.`, for: (pe > 40 ? -1 : pe < 18 ? 1 : 0) * sign > 0 || undefined }); }
  else if (f.epsTTM !== null) points.push({ text: `Trailing EPS ${f.epsTTM?.toFixed(2)}: no earnings to price against.` });
  if (!points.length) return null;
  return { id: 'fundamentals', name: 'Fundamentals', icon: '🧾', stance: clamp(s * sign, -1, 1), confidence: 0.3, headline: `${f.symbol}${f.symbol !== th.primary ? ` (a leader in ${th.primary})` : ''}: ${f.revenueYoY !== null ? `revenue ${pct(f.revenueYoY, 0)} YoY` : 'filings read'}${pe ? `, P/E ${pe.toFixed(0)}` : ''}`, points };
}
const money = (x) => (x === null || x === undefined ? 'n/a' : Math.abs(x) >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : `$${(x / 1e6).toFixed(0)}M`);

async function researchAnalyst(sc, th, digest, onStep) {
  onStep('Research', 'Searching the news and checking your facts');
  const prompt = `Today is ${today()}.

PROPOSITION: ${th.proposition}
RESOLUTION: ${th.resolution}
${th.userFacts.length ? `\nSTATEMENTS THE ASKER MADE (check each one; they may be wrong):\n${th.userFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` : ''}
What the desk's own data already shows:
${digest}

Your job:
1. Search for the most important news and data from the last 2 weeks that bears on the proposition (earnings, guidance, macro releases, policy, flows, analyst moves, credible warnings). Prefer primary sources and reputable outlets; cite them.
2. Check every statement the asker made: true / false / partly / unverified, with a source.
3. List dated catalysts ahead (before ${th.horizonDate}) that could settle it.
4. Give your lean: stance −1 (evidence clearly against the proposition) … +1 (clearly for it), and confidence 0..1 in that lean.

Use at most 8 searches/fetches. Reply with ONLY JSON:
{"stance":0.0,"confidence":0.5,"headline":"one sentence","evidence":[{"text":"fact with number/date","for":true,"source":"outlet","url":"https://…","date":"YYYY-MM-DD"}],"factChecks":[{"claim":"…","verdict":"true|false|partly|unverified","detail":"what the data says","source":"…","url":"https://…"}],"catalysts":[{"date":"YYYY-MM-DD","event":"…","why":"…"}]}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's research analyst and fact-checker.`, model: MODEL_FAST, tools: ['WebSearch', 'WebFetch'], timeoutMs: 7 * 60 * 1000, onActivity: (a) => onStep('Research', a) });
  const j = r.json;
  return {
    analyst: {
      id: 'research', name: 'News & facts', icon: '📰', stance: clamp(+j.stance || 0, -1, 1), confidence: clamp(+j.confidence || 0.4, 0.1, 0.8), headline: short(j.headline, 220),
      points: (j.evidence || []).slice(0, 10).map((e) => ({ text: short(e.text, 300), for: typeof e.for === 'boolean' ? e.for : undefined, source: short(e.source, 60), url: safeUrl(e.url), date: e.date })),
      factChecks: (j.factChecks || []).slice(0, 10).map((f) => ({ claim: short(f.claim, 300), verdict: ['true', 'false', 'partly', 'unverified'].includes(f.verdict) ? f.verdict : 'unverified', detail: short(f.detail, 400), source: short(f.source, 60), url: safeUrl(f.url) })),
      catalysts: (j.catalysts || []).slice(0, 6).map((c) => ({ date: c.date, event: short(c.event, 140), why: short(c.why, 200) })),
    },
    costUsd: r.costUsd,
  };
}
const safeUrl = (u) => (/^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u).slice(0, 500) : null);

/** Pool the analysts' leans around the quant (or base-rate) anchor. */
function ensemble(th, analysts) {
  const q = analysts.find((a) => a.id === 'quant');
  const anchor = q ? q.probability : th.baseRate ? th.baseRate.p : 0.5;
  let shift = 0;
  for (const a of analysts) if (a.id !== 'quant') shift += a.stance * a.confidence * 0.8;
  shift = clamp(shift, -1.4, 1.4);
  const p = sigm(logit(clamp(anchor, 0.01, 0.99)) + shift);
  return { probability: p, anchor, anchorFrom: q ? 'the Monte Carlo' : th.baseRate ? 'the historical base rate' : 'a coin flip', shift };
}

function digestFor(th, analysts) {
  return analysts.map((a) => `- ${a.name}: ${a.headline}\n${a.points.slice(0, 7).map((p) => `   • ${p.text}`).join('\n')}`).join('\n');
}

// ---- 4. judge ------------------------------------------------------------------
async function judge(sc, th, analysts, ens, prev, onStep) {
  onStep('Judge', 'Weighing the bull and bear cases');
  const prevLine = prev ? `Yesterday's (${prev.date}) call: ${prev.probability}% — "${prev.call}". Move from it only as far as new evidence justifies; say what changed.` : 'This is the first run.';
  const research = analysts.find((a) => a.id === 'research');
  const prompt = `Today is ${today()}.

PROPOSITION: ${th.proposition}
RESOLUTION: ${th.resolution}
HORIZON: ${th.horizonDate}
${th.baseRate ? `BASE RATE (strategist): ${(th.baseRate.p * 100).toFixed(0)}% — ${th.baseRate.why}` : ''}
DESK CONSENSUS (mechanical pool of the analysts below, anchored on ${ens.anchorFrom} at ${(ens.anchor * 100).toFixed(1)}%): ${(ens.probability * 100).toFixed(1)}%

ANALYST REPORTS (stance −1 against … +1 for, with confidence):
${analysts.map((a) => `## ${a.name} — stance ${a.stance.toFixed(2)}, confidence ${a.confidence.toFixed(2)}${a.probability !== undefined ? `, probability ${(a.probability * 100).toFixed(1)}%` : ''}\n${a.headline}\n${a.points.map((p) => `- ${p.text}${p.source ? ` [${p.source}]` : ''}`).join('\n')}`).join('\n\n')}
${research && research.factChecks.length ? `\nFACT-CHECKS OF THE ASKER'S STATEMENTS:\n${research.factChecks.map((f) => `- "${f.claim}": ${f.verdict.toUpperCase()} — ${f.detail}`).join('\n')}` : ''}

${prevLine}

You are the judge. Process:
1. Write the strongest bull case (for YES) and the strongest bear case (for NO), with equal effort, from the reports only.
2. Start from the base rate / Monte Carlo, then adjust for the evidence. Price-based simulations know nothing about news: adjust them for real catalysts, but don't double count.
3. Commit. Give ONE probability (integer 1–99). No hedging language. If it is truly 45–55, call it a toss-up and say which side has the edge.
4. Say where it is trending versus the last run, and the 2–4 signals that would change your mind (with thresholds).
5. Correct the asker plainly where their facts are wrong, and credit them where they are right.

Reply with ONLY JSON:
{"probability":37,"verdict":"Unlikely|Leaning no|Toss-up|Leaning yes|Likely","call":"one decisive sentence a busy person reads","trend":"rising|falling|steady","confidence":"low|medium|high","bull":["…"],"bear":["…"],"corrections":["…"],"supports":["…"],"watch":[{"signal":"…","threshold":"…","why":"…"}],"changed":"what moved since the last run (or 'first run')","summary":"3–5 sentences, plain words"}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's judge: calibrated, decisive, unswayed by how the claim was phrased.`, model: MODEL_JUDGE, tools: [], timeoutMs: 6 * 60 * 1000 });
  const j = r.json;
  const p = clamp(Math.round(+j.probability || ens.probability * 100), 1, 99);
  return {
    judge: {
      probability: p, verdict: verdictOf(p), call: short(j.call, 260), trend: ['rising', 'falling', 'steady'].includes(j.trend) ? j.trend : 'steady', confidence: ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'medium',
      bull: (j.bull || []).slice(0, 5).map((x) => short(x, 260)), bear: (j.bear || []).slice(0, 5).map((x) => short(x, 260)),
      corrections: (j.corrections || []).slice(0, 5).map((x) => short(x, 300)), supports: (j.supports || []).slice(0, 5).map((x) => short(x, 300)),
      watch: (j.watch || []).slice(0, 4).map((w) => ({ signal: short(w.signal, 120), threshold: short(w.threshold, 120), why: short(w.why, 200) })),
      changed: short(j.changed, 400), summary: short(j.summary, 900),
    },
    costUsd: r.costUsd,
  };
}
const verdictOf = (p) => (p >= 70 ? 'Likely' : p >= 56 ? 'Leaning yes' : p > 44 ? 'Toss-up' : p > 30 ? 'Leaning no' : 'Unlikely');

// ---- resolution ------------------------------------------------------------------
/** Has a price target already settled? { outcome: 'yes'|'no', why } or null. */
function settle(sc, th, d) {
  const s = d.prices[th.primary];
  if (!s) return null;
  const start = new Date(sc.createdAt).toISOString().slice(0, 10);
  const i0 = s.dates.findIndex((x) => x >= start);
  if (i0 < 0) return null;
  const t = th.target;
  const pastHorizon = today() > th.horizonDate;
  const hEnd = s.dates.findIndex((x) => x > th.horizonDate);
  const end = hEnd < 0 ? s.close.length : hEnd;
  if (t.type === 'drawdown') {
    let peak = Math.max(...s.close.slice(Math.max(0, i0 - 252), i0 + 1));
    for (let i = i0; i < end; i++) { peak = Math.max(peak, s.close[i]); if (s.close[i] / peak - 1 <= -t.value) return { outcome: 'yes', why: `${th.primary} closed ${pct(s.close[i] / peak - 1)} from its high on ${s.dates[i]}.` }; }
  }
  if (t.type === 'touch') for (let i = i0; i < end; i++) if (t.direction === 'below' ? s.close[i] <= t.level : s.close[i] >= t.level) return { outcome: 'yes', why: `${th.primary} closed at ${fmtPx(s.close[i])} on ${s.dates[i]}.` };
  if (!pastHorizon) return null;
  const last = s.close[end - 1];
  if (t.type === 'close') return { outcome: (t.direction === 'below' ? last <= t.level : last >= t.level) ? 'yes' : 'no', why: `${th.primary} closed at ${fmtPx(last)} on ${s.dates[end - 1]}.` };
  if (t.type === 'return') { const rr = last / s.close[i0] - 1; return { outcome: (t.direction === 'below' ? rr <= t.value : rr >= t.value) ? 'yes' : 'no', why: `${th.primary} returned ${pct(rr)} from ${s.dates[i0]} to ${s.dates[end - 1]}.` }; }
  if (t.type === 'outperform' && d.prices[t.vs]) {
    const v = d.prices[t.vs];
    const j0 = v.dates.findIndex((x) => x >= start), jEnd = v.dates.findIndex((x) => x > th.horizonDate);
    if (j0 >= 0) {
      const ra = last / s.close[i0] - 1, rb = v.close[(jEnd < 0 ? v.close.length : jEnd) - 1] / v.close[j0] - 1;
      const yes = t.direction === 'below' ? ra - rb < -(t.value || 0) : ra - rb > (t.value || 0);
      return { outcome: yes ? 'yes' : 'no', why: `${th.primary} returned ${pct(ra)} vs ${t.vs} ${pct(rb)} from ${s.dates[i0]} to ${th.horizonDate}.` };
    }
  }
  if (t.type === 'drawdown' || t.type === 'touch') return { outcome: 'no', why: `The target wasn't reached by ${th.horizonDate}.` };
  return null;
}

// ---- 5. what changed -------------------------------------------------------------
function diff(prev, run) {
  if (!prev) return [];
  const out = [];
  const dp = run.probability - prev.probability;
  if (dp) out.push({ kind: 'probability', text: `Probability ${dp > 0 ? 'up' : 'down'} ${Math.abs(dp)} pts: ${prev.probability}% → ${run.probability}%`, up: dp > 0 });
  if (prev.verdict !== run.verdict) out.push({ kind: 'verdict', text: `Verdict changed: ${prev.verdict} → ${run.verdict}` });
  const pa = Object.fromEntries((prev.analysts || []).map((a) => [a.id, a]));
  for (const a of run.analysts) {
    const b = pa[a.id];
    if (!b) { out.push({ kind: 'analyst', text: `${a.name} joined: ${a.headline}` }); continue; }
    const ds = a.stance - b.stance;
    if (Math.abs(ds) >= 0.15) out.push({ kind: 'analyst', text: `${a.name} turned ${ds > 0 ? 'more supportive' : 'more skeptical'} (${b.stance.toFixed(2)} → ${a.stance.toFixed(2)}): ${a.headline}`, up: ds > 0 });
    if (a.id === 'quant' && b.probability !== undefined && Math.abs(a.probability - b.probability) >= 0.03) out.push({ kind: 'analyst', text: `Monte Carlo moved ${(b.probability * 100).toFixed(0)}% → ${(a.probability * 100).toFixed(0)}%`, up: a.probability > b.probability });
  }
  const oldEv = new Set(((pa.research || {}).points || []).map((p) => p.text.slice(0, 60)));
  for (const p of ((run.analysts.find((a) => a.id === 'research') || {}).points || [])) if (!oldEv.has(p.text.slice(0, 60))) out.push({ kind: 'news', text: p.text, url: p.url, up: p.for });
  const oldFc = Object.fromEntries((((pa.research || {}).factChecks) || []).map((f) => [f.claim, f.verdict]));
  for (const f of ((run.analysts.find((a) => a.id === 'research') || {}).factChecks || [])) if (oldFc[f.claim] && oldFc[f.claim] !== f.verdict) out.push({ kind: 'fact', text: `Fact-check on "${short(f.claim, 80)}" is now ${f.verdict} (was ${oldFc[f.claim]})` });
  return out.slice(0, 14);
}

// ---- the whole run -----------------------------------------------------------------
const running = new Map(); // scenarioId -> { steps: [] }
const isRunning = (id) => running.has(id);
const progress = (id) => running.get(id) || null;

async function run(scId, { emit = () => {}, reason = 'manual' } = {}) {
  if (running.has(scId)) return null;
  const state = { steps: [], started: Date.now() };
  running.set(scId, state);
  const onStep = (who, text) => { const s = { who, text: short(text, 140), at: Date.now() }; state.steps.push(s); if (state.steps.length > 60) state.steps.shift(); emit({ event: 'progress', id: scId, step: s }); };
  let cost = 0;
  try {
    let sc = store.load(scId);
    if (!sc) throw new Error('No such scenario.');
    store.patch(scId, { status: 'running', error: null });
    emit({ event: 'scenario', id: scId });
    if (!sc.thesis) {
      const f = await frame(sc, onStep);
      cost += f.costUsd;
      sc = store.patch(scId, { thesis: f.thesis });
    }
    const th = sc.thesis;
    const prevId = sc.latest && sc.latest.id;
    const prev = prevId ? store.loadRun(scId, prevId) : null;
    const d = await gather(th, onStep);
    if (!Object.keys(d.prices).length && th.target.type !== 'none') onStep('Data', `No prices could be fetched: ${d.errors.slice(0, 2).join('; ')}`);
    onStep('Quant', 'Simulating thousands of paths to the deadline');
    const analysts = [];
    const q = quantAnalyst(sc, th, d);
    if (q) {
      analysts.push(q);
      // A Hugging Face time-series model (Chronos-Bolt) as a second opinion, when installed.
      if (await models.available()) {
        onStep('Quant', 'Asking Chronos-Bolt (Hugging Face) for a forecast');
        try {
          const s = d.prices[th.primary];
          const fc = await models.call('forecast', { series: [s.close.slice(-1024)], horizon: Math.min(64, quant.tradingDaysUntil(th.horizonDate)) });
          const f = fc.forecasts[0];
          const L = f.levels, fin = f.final;
          const at = (lv) => fin[L.indexOf(lv)];
          q.forecast = { model: fc.model, horizon: f.horizon, median: f.median_path, low: f.low_path, high: f.high_path };
          q.points.push({ text: `Chronos-Bolt forecast for ${f.horizon} trading days ahead: median ${fmtPx(at(0.5))}, 80% band ${fmtPx(at(0.1))}–${fmtPx(at(0.9))} (now ${fmtPx(s.close[s.close.length - 1])}).`, source: fc.model });
        } catch (e) { d.errors.push(`Chronos: ${e.message}`); }
      }
    }
    if (sc.backfill.length === 0 && q) {
      try { store.patch(scId, { backfill: quant.backfill({ series: d.prices[th.primary], vsSeries: th.target.vs ? d.prices[th.target.vs] : null, target: th.target, horizonDate: th.horizonDate, seed: sc.id }) }); } catch {}
    }
    onStep('Technicals', 'Reading trend, momentum and volatility');
    const t = technicalAnalyst(th, d); if (t) analysts.push(t);
    onStep('Macro', 'Checking the cycle: curve, credit, jobs, volatility');
    const m = macroAnalyst(th, d); if (m) analysts.push(m);
    onStep('Sentiment', 'Scoring what the crowd is saying');
    const prevSent = prev && (prev.analysts || []).find((a) => a.id === 'sentiment');
    const s = await sentimentAnalyst(th, d, prevSent); if (s) analysts.push(s);
    const fa = fundamentalsAnalyst(th, d); if (fa) analysts.push(fa);
    const settled = settle(sc, th, d);
    try {
      const rsch = await researchAnalyst(sc, th, digestFor(th, analysts), onStep);
      analysts.push(rsch.analyst); cost += rsch.costUsd;
    } catch (e) { d.errors.push(`Research: ${e.message}`); }
    const ens = ensemble(th, analysts);
    let jr;
    if (settled) {
      const p = settled.outcome === 'yes' ? 99 : 1;
      jr = { judge: { probability: p, verdict: settled.outcome === 'yes' ? 'Resolved YES' : 'Resolved NO', call: settled.why, trend: 'steady', confidence: 'high', bull: [], bear: [], corrections: [], supports: [], watch: [], changed: 'The claim has settled.', summary: settled.why }, costUsd: 0 };
    } else {
      try { jr = await judge(sc, th, analysts, ens, prev && { date: prev.date, probability: prev.probability, call: prev.call }, onStep); } catch (e) {
        d.errors.push(`Judge: ${e.message}`);
        const p = Math.round(ens.probability * 100);
        jr = { judge: { probability: clamp(p, 1, 99), verdict: verdictOf(p), call: `The judge was unavailable; this is the desk's mechanical consensus.`, trend: 'steady', confidence: 'low', bull: [], bear: [], corrections: [], supports: [], watch: [], changed: '', summary: '' }, costUsd: 0 };
      }
    }
    cost += jr.costUsd;
    const date = today();
    const runRec = {
      id: `${date}-${crypto.randomBytes(3).toString('hex')}`, at: Date.now(), date, reason,
      probability: jr.judge.probability, verdict: jr.judge.verdict, call: jr.judge.call, judge: jr.judge,
      ensemble: Math.round(ens.probability * 1000) / 10, anchor: Math.round(ens.anchor * 1000) / 10, anchorFrom: ens.anchorFrom,
      analysts, errors: d.errors, costUsd: Math.round(cost * 1000) / 1000, durationMs: Date.now() - state.started,
      sources: Object.values(d.prices).map((p) => p.source).filter((v, i, a) => a.indexOf(v) === i),
      models: { sentiment: s ? s.method : null, forecast: q && q.forecast ? q.forecast.model : null, judge: settled ? null : MODEL_JUDGE },
    };
    runRec.changes = diff(prev, runRec);
    store.saveRun(scId, runRec);
    sc = store.load(scId);
    // One point per day on the chart: a re-run the same day replaces it.
    const history = sc.history.filter((h) => h.date !== date);
    history.push({ date, p: runRec.probability, ens: runRec.ensemble, q: q ? Math.round(q.probability * 1000) / 10 : null, runId: runRec.id });
    const latest = { id: runRec.id, date, at: runRec.at, probability: runRec.probability, verdict: runRec.verdict, call: runRec.call, trend: jr.judge.trend };
    sc = store.patch(scId, { history, latest, status: settled ? 'resolved' : 'ready', resolved: settled || null, lastRunDate: date });
    onStep('Desk', `Done: ${runRec.probability}% — ${runRec.verdict}`);
    emit({ event: 'scenario', id: scId, done: true });
    return { sc, run: runRec, prev };
  } catch (e) {
    store.patch(scId, { status: store.load(scId)?.latest ? 'ready' : 'error', error: e.message.slice(0, 400) });
    onStep('Desk', `Stopped: ${e.message}`);
    emit({ event: 'scenario', id: scId, error: e.message });
    throw e;
  } finally {
    running.delete(scId);
  }
}

// ---- follow-up questions -----------------------------------------------------------
async function ask(sc, question, onStep = () => {}) {
  const runRec = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
  const ctx = runRec ? `Latest desk call (${runRec.date}): ${runRec.probability}% ${runRec.verdict}. ${runRec.judge.summary}\n${digestFor(sc.thesis, runRec.analysts)}` : 'No desk run yet.';
  const prompt = `Today is ${today()}.

The person is tracking this scenario: ${sc.thesis ? sc.thesis.proposition : sc.claim}
${ctx}

Their follow-up question: ${question}

Answer it with facts: search if you need current information (at most 5 searches), cite sources, give numbers. Be direct and short (under 220 words), correct them if the question rests on a wrong premise, and don't give buy/sell advice. If the question is itself a claim worth tracking daily, suggest it as a new scenario in one sentence.

Reply with ONLY JSON: {"answer":"plain text, may use - bullets","sources":[{"title":"…","url":"https://…"}],"track":"claim to track, or empty"}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's analyst answering a follow-up.`, model: MODEL_FAST, tools: ['WebSearch', 'WebFetch'], timeoutMs: 5 * 60 * 1000, onActivity: (a) => onStep(a) });
  return { answer: String(r.json.answer || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000), sources: (r.json.sources || []).slice(0, 6).map((s) => ({ title: short(s.title, 100), url: safeUrl(s.url) })).filter((s) => s.url), track: short(r.json.track || '', 200), costUsd: r.costUsd };
}

module.exports = { run, ask, isRunning, progress, frame, normalizeThesis, ensemble, diff, settle, verdictOf, describeTarget, quantAnalyst, technicalAnalyst, macroAnalyst, sentimentAnalyst, fundamentalsAnalyst };
