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
const free = require('./free');
const store = require('./store');
const { askJson } = require('./claude');
const { MODEL_FAST, MODEL_JUDGE } = require('./config');

const today = () => new Date().toISOString().slice(0, 10);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = (p) => Math.log(p / (1 - p));
const sigm = (x) => 1 / (1 + Math.exp(-x));
const pct = quant.pct;
// No em or en dashes in anything shown to people: ranges get a hyphen, asides a comma.
const nodash = (s) => String(s || '').replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ', ');
const short = (s, n) => { s = nodash(String(s || '').replace(/\s+/g, ' ').trim()); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

const NEUTRAL_RULES = `You work on an independent research desk. Facts first: every statement must come from the data you are given or a source you can cite. Do not tell people what they want to hear. You do not know which outcome the person who asked hopes for, and it must not matter. Never give financial advice or tell anyone to buy or sell; describe evidence and probabilities. Write plainly; never use em dashes or en dashes.`;

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
{"title":"≤60 chars","proposition":"one sentence","resolution":"Resolves YES if … ; NO if …","horizonDate":"YYYY-MM-DD","kind":"market|stock|compare|macro|crypto|event","direction":"up|down","primary":"SYMBOL","target":{"type":"…","value":0.2,"level":null,"direction":null,"vs":null},"instruments":[{"symbol":"…","why":"…"}],"macro":["…"],"newsQuery":"3-6 words for news search","marketQueries":["2-4 word searches for related prediction markets (Polymarket/Kalshi), e.g. 'recession 2026', 'Nvidia market cap'"],"wiki":"the Wikipedia topic whose attention matters, e.g. 'Nvidia' or 'Recession'","keywords":["…"],"subreddits":["…"],"cashtags":["…"],"tech":true,"userFacts":["…"],"baseRate":{"p":0.15,"why":"…"},"assumptions":["…"],"followUps":["related questions worth tracking"]}`;
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
    marketQueries: (t.marketQueries || []).slice(0, 3).map((k) => short(k, 50)).filter(Boolean), wiki: short(t.wiki || '', 60),
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
  const fred = (await Promise.all(th.macro.map((id) => soft(`FRED ${id}`, data.fredSeries(id))))).filter(Boolean)
    .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i); // a Yahoo stand-in can cover two ids
  onStep('Data', 'Reading Reddit, StockTwits, Hacker News and the news');
  const q = th.keywords[0] || th.newsQuery;
  const [rd, hn, gn, gd, xs, ...st] = await Promise.all([
    soft('Reddit', data.reddit(q, th.subreddits)),
    th.tech ? soft('Hacker News', data.hackernews(q)) : Promise.resolve(null),
    soft('Google News', data.googleNews(th.newsQuery)),
    Promise.resolve(null), // GDELT refuses this server; its tone data is skipped
    soft('X', data.xSearch(th.cashtags.length ? th.cashtags.map((c) => `$${c}`).join(' OR ') : q)),
    ...th.cashtags.map((c) => soft(`StockTwits ${c}`, data.stocktwits(c))),
  ]);
  onStep('Data', 'Options, prediction markets, Fear & Greed, attention, Mastodon, Lemmy, headlines');
  const crypto = th.kind === 'crypto' || /-USD$/.test(th.primary);
  const [options, markets, fg, wiki, masto, lem, ...tn] = await Promise.all([
    crypto ? Promise.resolve(null) : soft('Options', free.optionChain(th.primary)),
    soft('Prediction markets', free.predictionMarkets(th.marketQueries && th.marketQueries.length ? th.marketQueries : [th.newsQuery])),
    soft('Fear & Greed', crypto ? free.cryptoFearGreed() : free.fearGreed()),
    soft('Wikipedia', free.wikiAttention(th.wiki || (th.keywords || [])[0])),
    soft('Mastodon', free.mastodon([...th.cashtags, ...(th.keywords || []).slice(0, 1).map((k) => k.split(' ')[0])])),
    soft('Lemmy', free.lemmy(q)),
    ...[...new Set([th.primary, ...th.cashtags])].slice(0, 2).map((c) => soft(`Headlines ${c}`, free.tickerNews(c))),
  ]);
  const fed = ['market', 'macro'].includes(th.kind) ? await soft('Fed', free.fedNews()) : null;
  // Company filings for the primary, or else the first company among the instruments (ETFs have none).
  let fund = null;
  for (const sym of [th.primary, ...th.instruments.map((i) => i.symbol).filter((x) => x !== th.primary)].filter((x) => /^[A-Z]{1,5}$/.test(x)).slice(0, 3)) {
    const f = await data.fundamentals(sym).catch(() => null);
    if (f) { fund = { ...f, symbol: sym }; break; }
  }
  return { prices, fred, social: { reddit: rd, hn, news: gn, gdelt: gd, x: xs, stocktwits: st.filter(Boolean), mastodon: masto, lemmy: lem, tickerNews: tn.filter(Boolean), fed }, fund, options, markets, fg, wiki, errors };
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
    { text: `Middle 50% of outcomes by ${th.horizonDate}: ${fmtPx(sim.quantiles.p25)} to ${fmtPx(sim.quantiles.p75)} (now ${fmtPx(sim.last)}); 5-95%: ${fmtPx(sim.quantiles.p05)} to ${fmtPx(sim.quantiles.p95)}.` },
  ];
  if (hist) points.push({ text: `History check: over ${hist.years} years of ${th.primary}, this happened in ${(hist.rate * 100).toFixed(0)}% of ${hist.windows} past windows of the same length.`, source: s.source });
  const ladder = oddsLadder(sc, th, s, vs, H);
  return { id: 'quant', name: 'Quant', icon: 'quant', ladder, probability: p, stance: clamp((p - 0.5) * 2, -1, 1), confidence: 0.6, headline: `${(p * 100).toFixed(0)}% chance by the numbers alone`, points, sim, hist };
}

/**
 * The same question at several levels (like a strike ladder on Kalshi): how
 * the odds change if the move is smaller or bigger than the one claimed.
 */
function oddsLadder(sc, th, s, vs, H) {
  const t = th.target;
  const last = s.close[s.close.length - 1];
  let steps;
  if (t.type === 'drawdown') steps = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4].map((v) => ({ target: { ...t, value: v }, label: `Falls ${Math.round(v * 100)}%`, v }));
  else if (t.type === 'return') { const sg = t.direction === 'below' ? -1 : 1; steps = [0.05, 0.1, 0.15, 0.2, 0.3, 0.5].map((v) => ({ target: { ...t, value: sg * v }, label: `${sg > 0 ? 'Gains' : 'Loses'} ${Math.round(v * 100)}%`, v: sg * v })); }
  else if (t.type === 'touch' || t.type === 'close') { const sg = t.direction === 'below' ? -1 : 1; steps = [0.03, 0.05, 0.1, 0.15, 0.2, 0.3].map((m) => { const lv = last * (1 + sg * m); return { target: { ...t, level: lv }, label: `${t.type === 'touch' ? 'Reaches' : 'Ends'} ${fmtPx(lv)}`, v: lv }; }); }
  else if (t.type === 'outperform') steps = [0, 0.05, 0.1, 0.2].map((m) => ({ target: { ...t, value: m }, label: `${t.direction === 'below' ? 'Trails' : 'Beats'} by ${Math.round(m * 100)}%+`, v: m }));
  else return null;
  // Put the claimed level in the ladder if it isn't one of the steps.
  const claimed = t.type === 'touch' || t.type === 'close' ? t.level : t.value;
  if (!steps.some((x) => Math.abs(x.v - claimed) < 1e-6)) steps.push({ target: t, label: 'Your level', v: claimed });
  steps.sort((a, b) => Math.abs(a.v) - Math.abs(b.v));
  return steps.map((x) => {
    const r = quant.simulate({ series: s, vsSeries: vs, target: x.target, horizonDays: H, seed: `${sc.id}:${today()}:ladder`, paths: 1500 });
    return { label: x.label, p: r ? Math.round(r.probability * 1000) / 10 : null, claimed: Math.abs(x.v - claimed) < 1e-6 };
  }).filter((x) => x.p !== null);
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
    { text: `${main.symbol} ${fmtPx(i.last)} (${i.asOf}): ${pct(i.fromHigh)} from its 52-week high, 1-year range ${fmtPx(i.lo52)} to ${fmtPx(i.hi52)}.`, source: main.source },
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
    id: 'technical', name: 'Technicals', icon: 'technical', stance, confidence: clamp(0.3 + Math.abs(ts.score) * 0.4, 0.3, 0.7),
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
    id: 'macro', name: 'Macro', icon: 'macro', stance, confidence: clamp(0.25 + Math.abs(m.risk) * 0.35, 0.25, 0.6) * weight + 0.05,
    headline: `The macro backdrop is ${m.risk > 0.25 ? 'stressed (risk-off)' : m.risk < -0.15 ? 'calm and supportive' : 'mixed'}: stress score ${m.risk >= 0 ? '+' : ''}${m.risk.toFixed(2)}, where -1 is calm and +1 is stressed`,
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
    ['News headlines', [...(s.news?.posts || []), ...(s.tickerNews || []).flatMap((x) => x.posts)]],
    ['Mastodon', s.mastodon?.posts || []],
    ['Lemmy', s.lemmy?.posts || []],
  ].filter((g) => g[1].length);
  if (!groups.length && !s.gdelt && !d.fg) return null;
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
  if (d.fg) {
    const f = d.fg;
    const mood = f.score >= 75 ? 'extreme greed' : f.score >= 55 ? 'greed' : f.score > 45 ? 'neutral' : f.score > 25 ? 'fear' : 'extreme fear';
    // Extremes have tended to precede reversals, so they lean against the crowd.
    const contra = f.score >= 75 ? -1 : f.score <= 25 ? 1 : 0; // +1 = good for prices ahead
    points.push({ text: `${f.source}: ${Math.round(f.score)} (${mood}), a week ago ${Math.round(f.weekAgo)}, a month ago ${Math.round(f.monthAgo)}.${contra ? ' Readings this extreme have often come before turns.' : ''}`, source: f.source, url: f.url, for: contra ? contra * sign > 0 : undefined });
  }
  if (d.wiki && d.wiki.points && d.wiki.points.length > 30) {
    const v = d.wiki.points.map((x) => x[1]);
    const recent = quant.mean(v.slice(-7)), base = quant.mean(v.slice(-97, -7));
    const ratio = base ? recent / base : 1;
    points.push({ text: `Public attention: the "${d.wiki.title}" Wikipedia page averaged ${Math.round(recent).toLocaleString('en-US')} views a day this week, ${ratio >= 1 ? `${ratio.toFixed(1)}x` : `${Math.round(ratio * 100)}% of`} its 3-month norm${ratio >= 2 ? '. Attention spikes like this often come with big moves either way' : ''}.`, source: 'Wikipedia pageviews', url: d.wiki.url });
  }
  const extreme = Math.abs(net) > 0.6 && tot >= 20;
  if (extreme) points.push({ text: `The crowd is one-sided (${net > 0 ? 'bullish' : 'bearish'} ${Math.round(Math.abs(net) * 100)}%). Extreme agreement has often been a contrarian signal, so this counts for less.` });
  if (prev && Number.isFinite(prev.net)) points.push({ text: `Since the last run the crowd moved ${net > prev.net ? 'more bullish' : net < prev.net ? 'more bearish' : 'nowhere'} (${prev.net.toFixed(2)} → ${net.toFixed(2)}).` });
  const loudest = scored.flatMap((g) => g.posts.map((p) => ({ ...p, group: g.name }))).filter((p) => Math.abs(p.s) >= 0.4).sort((a, b) => (b.score || 0) - (a.score || 0) || Math.abs(b.s) - Math.abs(a.s)).slice(0, 6);
  // Sentiment is a weak predictor; it moves the needle a little.
  const stance = clamp(agree * (extreme ? 0.3 : 0.6), -1, 1);
  return {
    id: 'sentiment', name: 'Sentiment', icon: 'sentiment', stance, confidence: clamp(0.15 + Math.min(tot, 200) / 200 * 0.25, 0.15, 0.4), net,
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
  if (pe) { s += pe > 60 ? -0.25 : pe > 35 ? -0.1 : pe < 15 ? 0.1 : 0; points.push({ text: `Price/earnings ${pe.toFixed(1)} on trailing diluted EPS ${f.epsTTM.toFixed(2)}${pe > 40 ? ', priced for a lot of growth' : ''}.`, for: (pe > 40 ? -1 : pe < 18 ? 1 : 0) * sign > 0 || undefined }); }
  else if (f.epsTTM !== null) points.push({ text: `Trailing EPS ${f.epsTTM?.toFixed(2)}: no earnings to price against.` });
  if (!points.length) return null;
  return { id: 'fundamentals', name: 'Fundamentals', icon: 'fundamentals', stance: clamp(s * sign, -1, 1), confidence: 0.3, headline: `${f.symbol}${f.symbol !== th.primary ? ` (a leader in ${th.primary})` : ''}: ${f.revenueYoY !== null ? `revenue ${pct(f.revenueYoY, 0)} YoY` : 'filings read'}${pe ? `, P/E ${pe.toFixed(0)}` : ''}`, points };
}
/** The target as a price level on the primary (for reading option prices), or null. */
function targetLevel(th, d) {
  const s = d.prices[th.primary];
  if (!s) return null;
  const last = s.close[s.close.length - 1];
  const t = th.target;
  if (t.type === 'drawdown') return { level: Math.max(...s.close.slice(-252)) * (1 - t.value), below: true, touch: true };
  if (t.type === 'touch') return { level: t.level, below: t.direction === 'below', touch: true };
  if (t.type === 'close') return { level: t.level, below: t.direction === 'below', touch: false };
  if (t.type === 'return') return { level: last * (1 + t.value), below: t.direction === 'below', touch: false };
  return null;
}

function optionsAnalyst(th, d) {
  const chain = d.options;
  if (!chain || !chain.expiries || !chain.expiries.length) return null;
  const tl = targetLevel(th, d);
  const r = free.optionRead(chain, { level: tl && tl.level, horizonDate: th.horizonDate });
  if (!r) return null;
  const points = [];
  let probability, stance = 0, confidence = 0.2;
  if (tl && r.probBelow !== null) {
    let p = tl.below ? r.probBelow : 1 - r.probBelow;
    // Touching a level at any time is roughly twice as likely as closing beyond it on one date.
    if (tl.touch) p = Math.min(0.98, p * 2);
    probability = p;
    stance = clamp((p - 0.5) * 2, -1, 1);
    confidence = Math.abs(r.days - quant.tradingDaysUntil(th.horizonDate) * 365 / 252) > 45 ? 0.3 : 0.5;
    points.push({ text: `Option prices for the ${r.expiry} expiry imply about a ${(r.probBelow * 100).toFixed(1)}% chance ${th.primary} is below ${fmtPx(tl.level)} then${tl.touch ? `, so roughly ${(p * 100).toFixed(0)}% that it touches that level at some point` : ''}.`, source: chain.source, for: p >= 0.5 });
    points.push({ text: 'Option-implied odds of a fall run a little high: investors pay extra for crash protection, so treat this as an upper bound for declines.' });
  }
  if (r.atmIv) {
    const rv = d.prices[th.primary] ? quant.indicators(d.prices[th.primary]).vol20 : null;
    points.push({ text: `Implied volatility ${(r.atmIv * 100).toFixed(0)}% (${r.ivExpiry} expiry)${rv ? ` vs ${(rv * 100).toFixed(0)}% realized over the last month: the market expects ${r.atmIv > rv * 1.25 ? 'more turbulence than lately' : r.atmIv < rv * 0.8 ? 'calmer days ahead' : 'about the same'}` : ''}.`, source: chain.source });
  }
  if (r.pcVol !== null) points.push({ text: `Put/call ratio ${r.pcVol.toFixed(2)} by volume, ${r.pcOi !== null ? r.pcOi.toFixed(2) : 'n/a'} by open interest${r.pcVol > 1.2 ? ': heavy hedging' : r.pcVol < 0.6 ? ': call-heavy, traders are leaning bullish' : ''}.`, source: chain.source, for: r.pcVol > 1.2 ? th.direction === 'down' : r.pcVol < 0.6 ? th.direction === 'up' : undefined });
  if (!points.length) return null;
  return { id: 'options', name: 'Options market', icon: 'options', ...(probability !== undefined ? { probability } : {}), stance, confidence, headline: probability !== undefined ? `Options price about ${(probability * 100).toFixed(0)}% for this outcome` : `Options: put/call ${r.pcVol ? r.pcVol.toFixed(2) : 'n/a'}, implied volatility ${r.atmIv ? `${(r.atmIv * 100).toFixed(0)}%` : 'n/a'}`, points };
}

function marketsAnalyst(th, d) {
  const m = d.markets && d.markets.markets;
  if (!m || !m.length) return null;
  return {
    id: 'markets', name: 'Prediction markets', icon: 'markets', stance: 0, confidence: 0,
    headline: `${m.length} open market${m.length > 1 ? 's' : ''} on related questions. The judge weighs only the ones that match.`,
    points: m.map((x) => ({ text: `${x.question}: ${(x.p * 100).toFixed(0)}% yes${x.closes ? `, closes ${x.closes}` : ''}${x.playMoney ? ' (play money)' : x.volume ? `, $${Math.round(x.volume).toLocaleString('en-US')} traded` : ''}.`, source: x.venue, url: x.url })),
    markets: m,
  };
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
      id: 'research', name: 'News & facts', icon: 'research', stance: clamp(+j.stance || 0, -1, 1), confidence: clamp(+j.confidence || 0.4, 0.1, 0.8), headline: short(j.headline, 220),
      points: (j.evidence || []).slice(0, 10).map((e) => ({ text: short(e.text, 300), for: typeof e.for === 'boolean' ? e.for : undefined, source: short(e.source, 60), url: safeUrl(e.url), date: e.date })),
      factChecks: (j.factChecks || []).slice(0, 10).map((f) => ({ claim: short(f.claim, 300), verdict: ['true', 'false', 'partly', 'unverified'].includes(f.verdict) ? f.verdict : 'unverified', detail: short(f.detail, 400), source: short(f.source, 60), url: safeUrl(f.url) })),
      catalysts: (j.catalysts || []).slice(0, 6).map((c) => ({ date: c.date, event: short(c.event, 140), why: short(c.why, 200) })),
    },
    costUsd: r.costUsd,
  };
}
const safeUrl = (u) => (/^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u).slice(0, 500) : null);

/** Pool the analysts' leans around the quant (or base-rate) anchor. */
// ---- Claude agents (owner's Claude login) -------------------------------------------
/** Reads X/Twitter, Reddit, YouTube and forums through web search (free on the Claude plan, unlike the X API). */
async function socialAnalyst(th, onStep) {
  onStep('Social', 'Reading X, Reddit, YouTube and forums');
  const prompt = `Today is ${today()}.

PROPOSITION: ${th.proposition}
Symbols: ${[th.primary, ...th.cashtags].map((c) => `$${c}`).join(' ')}. Topics: ${(th.keywords || []).join(', ')}.

Find what people are saying about this in the last 2 weeks on X/Twitter, Reddit, YouTube, StockTwits and finance forums. Search engines index social posts unevenly, so mix queries: plain ones ("Nvidia stock reaction this week", "NVDA retail traders sentiment"), site queries ("site:x.com NVDA", "site:reddit.com/r/stocks Nvidia"), and news articles that report social-media reaction or fund-manager surveys. At most 7 searches. If you truly find nothing recent, say so and set confidence to 0.1. Separate notable voices (fund managers, economists, well-known analysts) from retail chatter. Report the dominant narrative, the strongest contrarian take, and whether the mood is shifting. Quote only what you actually found, with links.

Reply with ONLY JSON:
{"stance":0.0,"confidence":0.3,"headline":"one sentence on the crowd's view of the proposition","narratives":["…"],"posts":[{"text":"short quote or paraphrase","who":"account or community","url":"https://…","lean":"for|against|neutral","date":"YYYY-MM-DD"}]}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's social-media analyst. Crowd mood is weak evidence; report it, don't amplify it.`, model: MODEL_FAST, tools: ['WebSearch', 'WebFetch'], timeoutMs: 6 * 60 * 1000, onActivity: (a) => onStep('Social', a) });
  const j = r.json;
  return {
    analyst: {
      id: 'social', name: 'Social pulse', icon: 'social', stance: clamp(+j.stance || 0, -1, 1) * 0.6, confidence: clamp(+j.confidence || 0.25, 0.1, 0.4), headline: short(j.headline, 220),
      points: (j.narratives || []).slice(0, 5).map((n) => ({ text: short(n, 260) })),
      quotes: (j.posts || []).slice(0, 8).map((p) => ({ text: short(p.text, 240), where: short(p.who, 50), url: safeUrl(p.url), s: p.lean === 'for' ? 0.6 * (th.direction === 'up' ? 1 : -1) : p.lean === 'against' ? -0.6 * (th.direction === 'up' ? 1 : -1) : 0, group: 'Social' })),
    },
    costUsd: r.costUsd,
  };
}

/** One side's advocate: the strongest honest case from the desk's evidence. */
async function advocate(side, th, digest, onStep) {
  onStep(side === 'yes' ? 'Bull' : 'Bear', `Building the strongest case for ${side.toUpperCase()}`);
  const prompt = `PROPOSITION: ${th.proposition}
RESOLUTION: ${th.resolution}

THE DESK'S EVIDENCE:
${digest}

Argue that the answer is ${side.toUpperCase()}. Use only the evidence above: cite the numbers. Then name the single weakest point in your own case. Reply with ONLY JSON:
{"case":["4-6 bullets, strongest first, each with a number from the evidence"],"weakest":"the honest weak spot"}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's ${side === 'yes' ? 'bull' : 'bear'} advocate. Make the best honest case; do not invent facts.`, model: MODEL_FAST, tools: [], timeoutMs: 4 * 60 * 1000 });
  return { case: (r.json.case || []).slice(0, 6).map((x) => short(x, 300)), weakest: short(r.json.weakest, 300), costUsd: r.costUsd };
}

/** The verdict without Claude: the pooled probability and the strongest points on each side. */
function mechanicalJudge(th, analysts, ens, prev) {
  const p = clamp(Math.round(ens.probability * 100), 1, 99);
  const pts = analysts.flatMap((a) => a.points.map((x) => ({ ...x, w: a.confidence, who: a.name })));
  const top = (f) => pts.filter((x) => x.for === f).sort((a, b) => b.w - a.w).slice(0, 4).map((x) => `${x.who}: ${x.text}`);
  const lead = [...analysts].filter((a) => a.confidence > 0).sort((a, b) => Math.abs(b.stance * b.confidence) - Math.abs(a.stance * a.confidence))[0];
  const dp = prev ? p - prev.probability : 0;
  return {
    probability: p, verdict: verdictOf(p), trend: dp >= 3 ? 'rising' : dp <= -3 ? 'falling' : 'steady', confidence: 'low',
    call: `${verdictOf(p)} at ${p}%, pooled from ${analysts.length} data analysts${lead ? `. ${lead.name} weighs most: ${/^[A-Z][a-z]/.test(lead.headline) ? lead.headline.charAt(0).toLowerCase() + lead.headline.slice(1) : lead.headline}` : ''}.`,
    bull: top(true), bear: top(false), corrections: [], supports: [], watch: [],
    changed: prev ? `Pooled probability ${prev.probability}% to ${p}%.` : 'first run',
    summary: `This reading uses the data analysts only, anchored on ${ens.anchorFrom} at ${(ens.anchor * 100).toFixed(0)}% and shifted by the other analysts' evidence.`,
  };
}

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
async function judge(sc, th, analysts, ens, prev, onStep, advocates = null, model = MODEL_JUDGE) {
  onStep('Judge', 'Weighing the bull and bear cases');
  const prevLine = prev ? `Yesterday's (${prev.date}) call: ${prev.probability}%: "${prev.call}". Move from it only as far as new evidence justifies; say what changed.` : 'This is the first run.';
  const research = analysts.find((a) => a.id === 'research');
  const prompt = `Today is ${today()}.

PROPOSITION: ${th.proposition}
RESOLUTION: ${th.resolution}
HORIZON: ${th.horizonDate}
${th.baseRate ? `BASE RATE (strategist): ${(th.baseRate.p * 100).toFixed(0)}%: ${th.baseRate.why}` : ''}
DESK CONSENSUS (mechanical pool of the analysts below, anchored on ${ens.anchorFrom} at ${(ens.anchor * 100).toFixed(1)}%): ${(ens.probability * 100).toFixed(1)}%

ANALYST REPORTS (stance −1 against … +1 for, with confidence):
${analysts.map((a) => `## ${a.name} — stance ${a.stance.toFixed(2)}, confidence ${a.confidence.toFixed(2)}${a.probability !== undefined ? `, probability ${(a.probability * 100).toFixed(1)}%` : ''}\n${a.headline}\n${a.points.map((p) => `- ${p.text}${p.source ? ` [${p.source}]` : ''}`).join('\n')}`).join('\n\n')}
${research && research.factChecks.length ? `\nFACT-CHECKS OF THE ASKER'S STATEMENTS:\n${research.factChecks.map((f) => `- "${f.claim}": ${f.verdict.toUpperCase()} — ${f.detail}`).join('\n')}` : ''}

${advocates ? `THE BULL ADVOCATE'S CASE FOR YES:\n${advocates.yes.case.map((x) => `- ${x}`).join('\n')}\nIts admitted weak spot: ${advocates.yes.weakest}\n\nTHE BEAR ADVOCATE'S CASE FOR NO:\n${advocates.no.case.map((x) => `- ${x}`).join('\n')}\nIts admitted weak spot: ${advocates.no.weakest}\n` : ''}
${prevLine}

You are the judge. Process:
1. ${advocates ? 'Weigh the two advocates\' cases against the reports. Keep the strongest 3-5 points from each side (fix any that overstate the evidence).' : 'Write the strongest bull case (for YES) and the strongest bear case (for NO), with equal effort, from the reports only.'}
2. Start from the base rate / Monte Carlo, then adjust for the evidence. Price-based simulations know nothing about news: adjust them for real catalysts, but don't double count.
3. Commit. Give ONE probability (integer 1-99). No hedging language. If it is truly 45-55, call it a toss-up and say which side has the edge. Option-implied odds and real-money prediction markets that match the proposition are strong evidence; loosely related markets are context only.
4. Say where it is trending versus the last run, and the 2-4 signals that would change your mind (with thresholds).
5. Correct the asker plainly where their facts are wrong, and credit them where they are right.

Reply with ONLY JSON:
{"probability":37,"verdict":"Unlikely|Leaning no|Toss-up|Leaning yes|Likely","call":"one decisive sentence a busy person reads","trend":"rising|falling|steady","confidence":"low|medium|high","bull":["…"],"bear":["…"],"corrections":["…"],"supports":["…"],"watch":[{"signal":"…","threshold":"…","why":"…"}],"changed":"what moved since the last run (or 'first run')","summary":"3–5 sentences, plain words"}`;
  const r = await askJson({ prompt, system: `${NEUTRAL_RULES} You are the desk's judge: calibrated, decisive, unswayed by how the claim was phrased.`, model, tools: [], timeoutMs: 6 * 60 * 1000 });
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

/**
 * depth: quick = data analysts only (no Claude after framing); standard =
 * plus research and a Sonnet judge; deep = plus social pulse, bull and bear
 * advocates and an Opus judge.
 */
async function run(scId, { emit = () => {}, reason = 'manual', claude = true, depth = 'deep' } = {}) {
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
      if (!claude) throw new Error('This scenario needs the builder (asset, move and date) because the Claude desk is off for this account.');
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
          q.points.push({ text: `Chronos-Bolt forecast for ${f.horizon} trading days ahead: median ${fmtPx(at(0.5))}, 80% band ${fmtPx(at(0.1))} to ${fmtPx(at(0.9))} (now ${fmtPx(s.close[s.close.length - 1])}).`, source: fc.model });
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
    onStep('Options', 'Reading what option prices imply');
    const op = optionsAnalyst(th, d); if (op) analysts.push(op);
    const mk = marketsAnalyst(th, d); if (mk) analysts.push(mk);
    const settled = settle(sc, th, d);
    let advocates = null;
    const ai = claude && depth !== 'quick';
    if (ai && !settled) {
      // Research and social run side by side, then the two advocates, then the judge.
      const [rsch, soc] = await Promise.all([
        researchAnalyst(sc, th, digestFor(th, analysts), onStep).catch((e) => { d.errors.push(`Research: ${e.message}`); return null; }),
        depth === 'deep' ? socialAnalyst(th, onStep).catch((e) => { d.errors.push(`Social: ${e.message}`); return null; }) : null,
      ]);
      for (const r of [rsch, soc]) if (r) { analysts.push(r.analyst); cost += r.costUsd; }
      if (depth === 'deep') {
        const digest = digestFor(th, analysts);
        const [y, n] = await Promise.all([advocate('yes', th, digest, onStep).catch(() => null), advocate('no', th, digest, onStep).catch(() => null)]);
        if (y && n) { advocates = { yes: y, no: n }; cost += y.costUsd + n.costUsd; }
      }
    }
    // The reading room: today's articles, sorted for and against.
    let readingSum = null;
    try {
      onStep('Reading', ai ? 'Sorting today\'s articles for and against the claim' : 'Sorting today\'s articles');
      readingSum = await require('./reading').update(sc, th, d, analysts, { ai });
      cost += readingSum.costUsd;
    } catch (e) { d.errors.push(`Reading: ${e.message}`); }
    const ens = ensemble(th, analysts);
    let jr;
    if (settled) {
      const p = settled.outcome === 'yes' ? 99 : 1;
      jr = { judge: { probability: p, verdict: settled.outcome === 'yes' ? 'Resolved YES' : 'Resolved NO', call: settled.why, trend: 'steady', confidence: 'high', bull: [], bear: [], corrections: [], supports: [], watch: [], changed: 'The claim has settled.', summary: settled.why }, costUsd: 0 };
    } else if (!ai) {
      onStep('Desk', claude ? 'Pooling the analysts (Quick run: no Claude judge)' : 'Pooling the analysts (the Claude judge is off for this account)');
      jr = { judge: mechanicalJudge(th, analysts, ens, prev), costUsd: 0 };
    } else {
      try { jr = await judge(sc, th, analysts, ens, prev && { date: prev.date, probability: prev.probability, call: prev.call }, onStep, advocates, depth === 'deep' ? MODEL_JUDGE : MODEL_FAST); } catch (e) {
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
      models: { sentiment: s ? s.method : null, forecast: q && q.forecast ? q.forecast.model : null, judge: settled || !ai ? null : depth === 'deep' ? MODEL_JUDGE : MODEL_FAST },
      claude: ai, depth: ai ? depth : 'quick', advocates, reading: readingSum ? { added: readingSum.added, ...readingSum.counts } : null,
    };
    runRec.changes = diff(prev, runRec);
    store.saveRun(scId, runRec);
    sc = store.load(scId);
    // One point per day on the chart: a re-run the same day replaces it.
    const history = sc.history.filter((h) => h.date !== date);
    history.push({ date, p: runRec.probability, ens: runRec.ensemble, q: q ? Math.round(q.probability * 1000) / 10 : null, runId: runRec.id });
    const latest = { id: runRec.id, date, at: runRec.at, probability: runRec.probability, verdict: runRec.verdict, call: runRec.call, trend: jr.judge.trend };
    sc = store.patch(scId, { history, latest, status: settled ? 'resolved' : 'ready', resolved: settled || null, lastRunDate: date });
    onStep('Desk', `Done: ${runRec.probability}%, ${runRec.verdict}`);
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

// ---- the builder: a measurable scenario without Claude --------------------------------
const MOVES = {
  drawdown: 'falls from its 52-week high by', below: 'closes below', above: 'closes above', touchBelow: 'trades down to', touchAbove: 'trades up to',
  up: 'gains at least', down: 'loses at least', beat: 'beats', trail: 'trails',
};
/**
 * build: { symbol, move: drawdown|touchBelow|touchAbove|below|above|up|down|beat|trail, value (percent or price), vs, date }
 */
const nice = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function buildThesis(b) {
  const sym = String(b.symbol || '').trim().toUpperCase();
  if (!/^[\^A-Z0-9.=\-]{1,15}$/.test(sym)) throw new Error('Pick a ticker, like SPY, NVDA or BTC-USD.');
  const move = String(b.move || '');
  if (!MOVES[move]) throw new Error('Pick what should happen.');
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today()) throw new Error('Pick a deadline in the future.');
  const v = Number(b.value);
  // The comparison ticker only matters for beat/trail.
  const vs = ['beat', 'trail'].includes(move) ? String(b.vs || '').trim().toUpperCase() : '';
  let target, direction, text;
  if (move === 'drawdown') { if (!(v > 0 && v < 100)) throw new Error('Enter the fall as a percent, like 20.'); target = { type: 'drawdown', value: v / 100 }; direction = 'down'; text = `${sym} falls ${v}% from its 52-week high`; }
  else if (['below', 'above', 'touchBelow', 'touchAbove'].includes(move)) {
    if (!(v > 0)) throw new Error('Enter the price level.');
    const below = /below|Below/.test(move);
    target = { type: move.startsWith('touch') ? 'touch' : 'close', level: v, direction: below ? 'below' : 'above' }; direction = below ? 'down' : 'up';
    text = move.startsWith('touch') ? `${sym} trades ${below ? 'down' : 'up'} to ${v}` : `${sym} closes ${below ? 'below' : 'above'} ${v} on the deadline`;
  } else if (move === 'up' || move === 'down') {
    if (!(v > 0 && v < 1000)) throw new Error('Enter the move as a percent, like 15.');
    target = { type: 'return', value: (move === 'up' ? 1 : -1) * v / 100, direction: move === 'up' ? 'above' : 'below' }; direction = move;
    text = `${sym} ${move === 'up' ? 'gains' : 'loses'} at least ${v}% by the deadline`;
  } else {
    if (!/^[\^A-Z0-9.=\-]{1,15}$/.test(vs) || vs === sym) throw new Error('Pick the ticker to compare against.');
    const by = v > 0 && v < 500 ? v : 0;
    target = { type: 'outperform', vs, value: by / 100, direction: move === 'beat' ? 'above' : 'below' }; direction = move === 'beat' ? 'up' : 'down';
    text = `${sym} ${move === 'beat' ? 'beats' : 'trails'} ${vs}${by ? ` by ${by}%+` : ''}`;
  }
  const crypto = /-USD$/.test(sym);
  const index = /^\^/.test(sym) || ['SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI'].includes(sym);
  return normalizeThesis({
    title: text, proposition: `${text} by ${nice(date)}.`, resolution: `Resolves YES if ${text} on or before ${nice(date)} (daily closes); NO otherwise.`,
    horizonDate: date, kind: crypto ? 'crypto' : target.type === 'outperform' ? 'compare' : index ? 'market' : 'stock', direction, primary: sym, target,
    instruments: [{ symbol: sym, why: 'Measured on this.' }, ...(vs ? [{ symbol: vs, why: 'Compared against.' }] : []), ...(index || crypto ? [] : [{ symbol: 'SPY', why: 'The market as a whole.' }])],
    macro: crypto ? ['DTWEXBGS', 'DGS10', 'VIXCLS'] : ['T10Y2Y', 'VIXCLS', 'BAMLH0A0HYM2', 'UNRATE', 'NFCI', 'FEDFUNDS'],
    newsQuery: sym.replace(/-USD$/, '').replace(/^\^/, ''), marketQueries: [sym.replace(/-USD$/, '').replace(/^\^/, '')], keywords: [sym.replace(/-USD$/, '')],
    subreddits: crypto ? ['CryptoCurrency', 'Bitcoin'] : ['stocks', 'investing', 'StockMarket'], cashtags: [sym.replace(/^\^/, '')], tech: false,
    userFacts: [], baseRate: null, assumptions: ['Built with the scenario builder; measured on daily closes.'], followUps: [],
  });
}

module.exports = { buildThesis, run, ask, isRunning, progress, frame, normalizeThesis, ensemble, diff, settle, verdictOf, describeTarget, quantAnalyst, technicalAnalyst, macroAnalyst, sentimentAnalyst, fundamentalsAnalyst };
