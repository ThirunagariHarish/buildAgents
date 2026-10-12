// Trends: once a day, the two or three things that matter most in markets,
// with a short analysis each. Built from what the desk already pulls (the
// day's most discussed claims, the busiest prediction markets, business
// headlines and the market's biggest moves), so nothing is fetched twice.
// Claude picks and writes them (with a few web searches to check numbers);
// without Claude the most discussed claims and biggest moves stand in.

const fs = require('fs');
const path = require('path');
const { DATA, MODEL_FAST } = require('./config');
const data = require('./data');
const quant = require('./quant');
const discover = require('./discover');
const { askJson } = require('./claude');

const DIR = path.join(DATA, 'trends');
fs.mkdirSync(DIR, { recursive: true });
const MAX = 3;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nodash = (s) => String(s || '').replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ', ');
const safeUrl = (u) => (/^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u).slice(0, 600) : null);
const today = () => new Date().toISOString().slice(0, 10);
const fileOf = (d) => path.join(DIR, `${d}.json`);

function load(date) { try { return JSON.parse(fs.readFileSync(fileOf(date), 'utf8')); } catch { return null; } }
function days(limit = 14) {
  return fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse().slice(0, limit).map(load).filter(Boolean);
}

/** The market's movers today among the pulse and the most-talked-about tickers. */
async function movers(symbols) {
  const out = [];
  for (const s of symbols) {
    try {
      const p = await data.prices(s);
      const c = p.close, n = c.length;
      out.push({ symbol: s, name: p.name, last: c[n - 1], d1: c[n - 1] / c[n - 2] - 1, m1: n > 21 ? c[n - 1] / c[n - 22] - 1 : null, asOf: p.dates[n - 1] });
    } catch {}
  }
  return out.sort((a, b) => Math.abs(b.d1) - Math.abs(a.d1));
}

/** Numbers for one trend's ticker, and the Monte Carlo's quick read on its claim. */
async function enrich(t) {
  const sym = t.build && t.build.symbol || (t.tickers || [])[0];
  if (!sym) return t;
  try {
    const p = await data.prices(sym);
    const c = p.close, n = c.length;
    t.market = { symbol: sym, last: c[n - 1], d1: c[n - 1] / c[n - 2] - 1, m1: n > 21 ? c[n - 1] / c[n - 22] - 1 : null, y1: n > 252 ? c[n - 1] / c[n - 253] - 1 : null, spark: c.slice(-66), asOf: p.dates[n - 1] };
    if (t.build && t.build.move && t.build.date) {
      const th = require('./desk').buildThesis(t.build);
      const H = quant.tradingDaysUntil(th.horizonDate);
      const vs = th.target.vs ? await data.prices(th.target.vs).catch(() => null) : null;
      const sim = H > 0 && th.target.type !== 'none' ? quant.simulate({ series: p, vsSeries: vs, target: th.target, horizonDays: H, seed: `trend:${today()}:${sym}`, paths: 2000 }) : null;
      if (sim) t.quick = { p: Math.round(sim.probability * 1000) / 10, claim: th.proposition };
    }
  } catch {}
  return t;
}

async function withClaude(ctx) {
  const prompt = `Today is ${today()}. You are writing the day's market trends briefing: the ${MAX} things that matter most right now, no more. Pick fewer if only two are worth it. Prefer what is both loud (people are talking) and real (prices, odds or data are moving). Skip noise.

MOST DISCUSSED CLAIMS ONLINE TODAY (from Reddit, Hacker News, Mastodon, news):
${ctx.claims.map((c, i) => `C${i + 1}. ${c.claim} [${c.lean}, ${c.buzz} posts; ${c.why}]`).join('\n') || 'none'}

BUSIEST PREDICTION MARKETS:
${ctx.markets.map((m, i) => `M${i + 1}. ${m.question}: ${Math.round(m.p * 100)}% (${m.venue}${m.volume24h ? `, $${Math.round(m.volume24h).toLocaleString('en-US')} today` : ''})`).join('\n') || 'none'}

BIGGEST MOVES TODAY:
${ctx.movers.map((m) => `${m.symbol} ${m.last.toFixed(2)} (${(m.d1 * 100).toFixed(1)}% today, ${m.m1 !== null ? (m.m1 * 100).toFixed(1) : 'n/a'}% this month)`).join('\n')}

TOP BUSINESS HEADLINES:
${ctx.news.slice(0, 25).map((h) => `- ${h.text} (${h.where})`).join('\n')}

Check the key numbers with web search (at most 4 searches). For each trend give:
- title: 8 words max, plain
- category: Market, Stock, Crypto, Macro, Rates or Commodities
- summary: 2-3 sentences on what is happening, with numbers
- why: one sentence on why it matters for markets
- bull: the strongest case one way, one sentence; bear: the other way, one sentence
- tickers: 1-3 Yahoo tickers most affected
- claim: one testable sentence with a date that this trend implies
- build: if one ticker's price settles the claim, {"symbol":"","move":"drawdown|down|up|touchBelow|touchAbove|below|above|beat|trail","value":0,"vs":"","date":"YYYY-MM-DD"}, else null
- sources: up to 3 {"title":"","url":"https://..."} you actually used

Never use em dashes. Be neutral and factual. Reply with ONLY JSON: {"trends":[{"title":"","category":"","summary":"","why":"","bull":"","bear":"","tickers":[""],"claim":"","build":null,"sources":[]}]}`;
  const r = await askJson({ prompt, system: 'You are the editor of an independent research desk\'s daily trends briefing. Short, factual, neutral; numbers over adjectives; no advice.', model: MODEL_FAST, tools: ['WebSearch', 'WebFetch'], timeoutMs: 6 * 60 * 1000 });
  return (r.json.trends || []).slice(0, MAX).map((t) => ({
    title: nodash(clean(t.title)).slice(0, 90), category: clean(t.category) || 'Market', summary: nodash(clean(t.summary)).slice(0, 600), why: nodash(clean(t.why)).slice(0, 240),
    bull: nodash(clean(t.bull)).slice(0, 240), bear: nodash(clean(t.bear)).slice(0, 240), tickers: (t.tickers || []).map((x) => String(x).toUpperCase().slice(0, 12)).filter((x) => /^[\^A-Z0-9.=\-]{1,12}$/.test(x)).slice(0, 3),
    claim: nodash(clean(t.claim)).slice(0, 220), build: t.build && t.build.symbol ? t.build : null,
    sources: (t.sources || []).map((s) => ({ title: clean(s.title).slice(0, 120), url: safeUrl(s.url) })).filter((s) => s.url).slice(0, 3), by: 'claude',
  }));
}

function withoutClaude(ctx) {
  const out = ctx.claims.slice(0, 2).map((c) => ({
    title: c.claim.split(/[,.]/)[0].slice(0, 80), category: c.category, summary: `${c.buzz} post${c.buzz > 1 ? 's' : ''} today make this claim (${c.lean}). ${c.why}`, why: '', bull: '', bear: '',
    tickers: c.build ? [c.build.symbol] : [], claim: c.claim, build: c.build, sources: (c.sources || []).slice(0, 3).map((s) => ({ title: s.text, url: s.url })), by: 'auto',
  }));
  const m = ctx.movers[0];
  if (m && Math.abs(m.d1) > 0.015) out.push({ title: `${m.symbol} ${m.d1 > 0 ? 'jumps' : 'drops'} ${(Math.abs(m.d1) * 100).toFixed(1)}%`, category: 'Market', summary: `${m.name || m.symbol} moved ${(m.d1 * 100).toFixed(1)}% today to ${m.last.toFixed(2)}, ${m.m1 !== null ? `${(m.m1 * 100).toFixed(1)}% over the month` : ''}.`, why: 'The biggest move among the markets the desk watches.', bull: '', bear: '', tickers: [m.symbol], claim: '', build: null, sources: [], by: 'auto' });
  return out.slice(0, MAX);
}

/** Write today's trends (at most three). force replaces an existing set. */
async function build({ ai, force = false, inject = null } = {}) {
  const date = today();
  const existing = load(date);
  if (existing && !force) return existing;
  const d = inject || discover.latest() || { claims: [], markets: [], tickers: { trending: [], mentioned: [] } };
  const syms = [...new Set(['SPY', 'QQQ', 'IWM', '^VIX', '^TNX', 'GC=F', 'CL=F', 'BTC-USD', ...(d.tickers ? d.tickers.mentioned.slice(0, 6).map((t) => t.symbol) : [])])];
  const ctx = { claims: (d.claims || []).slice(0, 12), markets: (d.markets || []).slice(0, 8), movers: (inject && inject.movers) || (await movers(syms)).slice(0, 8), news: (inject && inject.news) || (await discover.businessNews().catch(() => [])) };
  let trends = [];
  if (ai) { try { trends = await withClaude(ctx); } catch (e) { console.error(`trends: ${e.message}`); } }
  if (!trends.length) trends = withoutClaude(ctx);
  for (const t of trends) await enrich(t);
  const out = { date, at: Date.now(), trends, from: { claims: ctx.claims.length, markets: ctx.markets.length, headlines: ctx.news.length, movers: ctx.movers.length }, by: trends[0] ? trends[0].by : 'auto' };
  fs.writeFileSync(fileOf(date), JSON.stringify(out));
  return out;
}

module.exports = { build, load, days, MAX };
