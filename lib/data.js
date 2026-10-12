// Data connectors, each with fallbacks and a disk cache. No keys are needed
// for the basics; optional keys (FRED, Reddit app, X, Hugging Face) make
// some sources more reliable. Every source records where a number came from,
// so analysts can cite it.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const CACHE = path.join(DATA, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const SEC_UA = `RunScenario/1.0 (${process.env.SC_ADMIN_EMAIL || 'harishkumart1994@gmail.com'})`;
const DAY = 24 * 3600 * 1000;

// Offline fixtures for tests: SC_FIXTURES=dir makes fetch read <dir>/<name>.json.
const FIX = process.env.SC_FIXTURES || '';

async function get(url, { headers = {}, timeoutMs = 20000, as = 'json', method = 'GET', body } = {}) {
  const r = await fetch(url, { method, body, headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!r.ok) throw Object.assign(new Error(`${new URL(url).host} said HTTP ${r.status}`), { status: r.status });
  return as === 'json' ? r.json() : r.text();
}

async function cached(key, ttlMs, fn) {
  const file = path.join(CACHE, `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - c.at < ttlMs) return c.value;
  } catch {}
  const value = await fn();
  try { fs.writeFileSync(file, JSON.stringify({ at: Date.now(), key, value })); } catch {}
  return value;
}

/** Try each source in order; return the first that works, with the failures noted. */
async function firstOf(attempts) {
  const errors = [];
  for (const [name, fn] of attempts) {
    try { const v = await fn(); if (v) return { ...v, tried: errors }; } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  throw Object.assign(new Error(errors.join('; ') || 'no source'), { tried: errors });
}

// ---- prices -----------------------------------------------------------------
function cleanSeries(dates, close) {
  const d = [], c = [];
  for (let i = 0; i < dates.length; i++) if (Number.isFinite(close[i]) && close[i] > 0 && (!d.length || dates[i] > d[d.length - 1])) { d.push(dates[i]); c.push(close[i]); }
  if (c.length < 60) throw new Error('too little history');
  return { dates: d, close: c };
}

async function yahoo(sym, host) {
  const j = await get(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=10y&interval=1d&includeAdjustedClose=true&events=div%2Csplit`);
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(j?.chart?.error?.description || 'no data');
  const adj = r.indicators?.adjclose?.[0]?.adjclose || r.indicators?.quote?.[0]?.close;
  const dates = r.timestamp.map((t) => new Date(t * 1000).toISOString().slice(0, 10));
  return { ...cleanSeries(dates, adj), name: r.meta?.longName || r.meta?.shortName || sym, currency: r.meta?.currency, type: r.meta?.instrumentType, source: 'Yahoo Finance' };
}

function stooqSymbol(sym) {
  const map = { '^GSPC': '^spx', '^IXIC': '^ndq', '^DJI': '^dji', '^NDX': '^ndx', '^RUT': '^rut', '^VIX': '^vix', 'BTC-USD': 'btcusd', 'ETH-USD': 'ethusd', 'GC=F': 'gc.f', 'CL=F': 'cl.f' };
  if (map[sym]) return map[sym];
  return /^[A-Z.]{1,6}$/.test(sym) ? `${sym.toLowerCase().replace('.', '-')}.us` : sym.toLowerCase();
}
async function stooq(sym) {
  const key = process.env.SC_STOOQ_KEY ? `&apikey=${encodeURIComponent(process.env.SC_STOOQ_KEY)}` : '';
  const csv = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol(sym))}&i=d${key}`, { as: 'text' });
  const rows = csv.trim().split('\n').slice(1).map((l) => l.split(','));
  if (!rows.length || rows[0].length < 5) throw new Error(csv.slice(0, 60).replace(/\s+/g, ' ') || 'empty');
  const cut = new Date(Date.now() - 10 * 365 * DAY).toISOString().slice(0, 10);
  const keep = rows.filter((r) => r[0] >= cut);
  return { ...cleanSeries(keep.map((r) => r[0]), keep.map((r) => Number(r[4]))), name: sym, source: 'Stooq' };
}
async function nasdaq(sym) {
  const from = new Date(Date.now() - 10 * 365 * DAY).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  for (const cls of ['stocks', 'etf', 'index']) {
    try {
      const j = await get(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=${cls}&fromdate=${from}&todate=${to}&limit=9999`, { headers: { Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } });
      const rows = j?.data?.tradesTable?.rows;
      if (!rows || !rows.length) continue;
      const parsed = rows.map((r) => { const [m, d, y] = r.date.split('/'); return [`${y}-${m}-${d}`, Number(String(r.close).replace(/[$,]/g, ''))]; }).reverse();
      return { ...cleanSeries(parsed.map((x) => x[0]), parsed.map((x) => x[1])), name: sym, source: 'Nasdaq' };
    } catch {}
  }
  throw new Error('no data');
}

/** Daily closes for ~10 years: { dates[], close[], name, source }. Cached for 6 hours. */
async function prices(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!/^[\^A-Z0-9.=\-]{1,15}$/.test(sym)) throw new Error(`Bad symbol: ${symbol}`);
  if (FIX) return fixture(`prices-${sym}`);
  return cached(`prices:${sym}`, 6 * 3600 * 1000, () => firstOf([
    ['Yahoo', () => yahoo(sym, 'query1.finance.yahoo.com')],
    ['Yahoo 2', () => yahoo(sym, 'query2.finance.yahoo.com')],
    ['Stooq', () => stooq(sym)],
    ['Nasdaq', () => nasdaq(sym)],
  ]).then(({ tried, ...v }) => ({ ...v, symbol: sym })));
}

// ---- macro (FRED) -----------------------------------------------------------
const FRED_INFO = {
  T10Y2Y: '10-year minus 2-year Treasury spread', T10Y3M: '10-year minus 3-month Treasury spread', VIXCLS: 'VIX (S&P 500 implied volatility)',
  BAMLH0A0HYM2: 'High-yield credit spread', UNRATE: 'Unemployment rate', FEDFUNDS: 'Fed funds rate', DGS10: '10-year Treasury yield',
  NFCI: 'Chicago Fed financial conditions', ICSA: 'Initial jobless claims', CPIAUCSL: 'Consumer prices (CPI)', DCOILWTICO: 'WTI crude oil',
  DTWEXBGS: 'Trade-weighted US dollar', SAHMREALTIME: 'Sahm recession indicator', UMCSENT: 'Consumer sentiment (Michigan)', M2SL: 'M2 money supply',
};
async function fredSeries(id) {
  id = String(id).toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(id)) throw new Error(`Bad FRED id ${id}`);
  if (FIX) return fixture(`fred-${id}`);
  return cached(`fred:${id}`, 12 * 3600 * 1000, async () => {
    const start = new Date(Date.now() - 6 * 365 * DAY).toISOString().slice(0, 10);
    const r = await firstOf([
      ...(process.env.SC_FRED_KEY ? [['FRED API', async () => {
        const j = await get(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${process.env.SC_FRED_KEY}&file_type=json&observation_start=${start}`);
        return { points: j.observations.filter((o) => o.value !== '.').map((o) => [o.date, Number(o.value)]) };
      }]] : []),
      ['FRED CSV', async () => {
        const csv = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, { as: 'text' });
        const rows = csv.trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[1] && r[1] !== '.' && Number.isFinite(Number(r[1])));
        if (!rows.length) throw new Error(csv.slice(0, 60));
        return { points: rows.map((r) => [r[0], Number(r[1])]) };
      }],
    ]);
    return { id, name: FRED_INFO[id] || id, points: r.points, source: 'FRED (St. Louis Fed)', url: `https://fred.stlouisfed.org/series/${id}` };
  });
}

// ---- crowd and news ---------------------------------------------------------
let redditToken = null;
async function redditAuth() {
  const id = process.env.SC_REDDIT_ID, secret = process.env.SC_REDDIT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.exp > Date.now()) return redditToken.value;
  const j = await get('https://www.reddit.com/api/v1/access_token', { method: 'POST', body: 'grant_type=client_credentials', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RunScenario/1.0' } });
  redditToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return redditToken.value;
}
async function reddit(query, subs = []) {
  if (FIX) return fixture('reddit');
  return cached(`reddit:${query}:${subs.join(',')}`, 3 * 3600 * 1000, async () => {
    const token = await redditAuth().catch(() => null);
    const base = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const headers = token ? { Authorization: `Bearer ${token}`, 'User-Agent': 'RunScenario/1.0' } : { 'User-Agent': 'RunScenario/1.0 (research)' };
    const paths = subs.length ? subs.slice(0, 4).map((s) => `/r/${encodeURIComponent(s)}/search.json?restrict_sr=1&`) : ['/search.json?'];
    const posts = [];
    for (const p of paths) {
      const j = await get(`${base}${p}q=${encodeURIComponent(query)}&sort=new&t=week&limit=40`, { headers });
      for (const c of j?.data?.children || []) {
        const d = c.data;
        posts.push({ text: `${d.title}. ${String(d.selftext || '').slice(0, 400)}`, score: d.score, comments: d.num_comments, at: d.created_utc * 1000, url: `https://www.reddit.com${d.permalink}`, where: `r/${d.subreddit}` });
      }
    }
    return { source: 'Reddit', posts };
  });
}
async function stocktwits(symbol) {
  if (FIX) return fixture('stocktwits');
  return cached(`st:${symbol}`, 3 * 3600 * 1000, async () => {
    const sym = String(symbol).replace(/^\^/, '').replace('-USD', '.X');
    const j = await get(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`);
    return { source: 'StockTwits', posts: (j.messages || []).map((m) => ({ text: m.body, label: m.entities?.sentiment?.basic || null, at: Date.parse(m.created_at), url: `https://stocktwits.com/message/${m.id}`, where: `$${sym}` })) };
  });
}
async function hackernews(query) {
  if (FIX) return fixture('hn');
  return cached(`hn:${query}`, 3 * 3600 * 1000, async () => {
    const since = Math.floor((Date.now() - 7 * DAY) / 1000);
    const j = await get(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=40`);
    return { source: 'Hacker News', posts: (j.hits || []).map((h) => ({ text: h.title, score: h.points, comments: h.num_comments, at: h.created_at_i * 1000, url: `https://news.ycombinator.com/item?id=${h.objectID}`, where: 'HN' })) };
  });
}
function rssItems(xml) {
  const out = [];
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : ''; };
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) out.push({ title: tag(m[1], 'title'), url: tag(m[1], 'link'), at: Date.parse(tag(m[1], 'pubDate')) || null, where: tag(m[1], 'source') });
  return out;
}
async function googleNews(query) {
  if (FIX) return fixture('news');
  return cached(`gn:${query}`, 3 * 3600 * 1000, async () => {
    const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=en-US&gl=US&ceid=US:en`, { as: 'text' });
    return { source: 'Google News', posts: rssItems(xml).slice(0, 40).map((i) => ({ text: i.title, at: i.at, url: i.url, where: i.where || 'news' })) };
  });
}
/** GDELT: average tone of world news coverage on the query, daily, last 3 months. */
async function gdeltTone(query) {
  if (FIX) return fixture('gdelt');
  return cached(`gdelt:${query}`, 12 * 3600 * 1000, async () => {
    const j = await get(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=timelinetone&timespan=3m&format=json`, { timeoutMs: 30000 });
    const pts = (j?.timeline?.[0]?.data || []).map((d) => [String(d.date).slice(0, 8).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'), Number(d.value)]);
    if (!pts.length) throw new Error('no tone data');
    return { source: 'GDELT', points: pts };
  });
}
/** X (Twitter) recent search, only with a paid API bearer token (SC_X_BEARER). */
async function xSearch(query) {
  const bearer = process.env.SC_X_BEARER;
  if (!bearer) return null;
  return cached(`x:${query}`, 6 * 3600 * 1000, async () => {
    const j = await get(`https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(`${query} -is:retweet lang:en`)}&max_results=60&tweet.fields=created_at,public_metrics`, { headers: { Authorization: `Bearer ${bearer}` } });
    return { source: 'X', posts: (j.data || []).map((t) => ({ text: t.text, score: t.public_metrics?.like_count || 0, at: Date.parse(t.created_at), url: `https://x.com/i/web/status/${t.id}`, where: 'X' })) };
  });
}

// ---- fundamentals (SEC EDGAR) -------------------------------------------------
async function secCik(ticker) {
  const map = await cached('sec:tickers', 7 * DAY, () => get('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_UA } }));
  const t = String(ticker).toUpperCase();
  const hit = Object.values(map).find((x) => x.ticker === t);
  return hit ? { cik: String(hit.cik_str).padStart(10, '0'), name: hit.title } : null;
}
async function fundamentals(ticker) {
  if (FIX) return fixture(`sec-${ticker}`);
  const c = await secCik(ticker);
  if (!c) return null; // ETFs, indices, crypto
  const facts = await cached(`sec:facts:${c.cik}`, DAY, () => get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`, { headers: { 'User-Agent': SEC_UA }, timeoutMs: 30000 }));
  const g = facts?.facts?.['us-gaap'] || {};
  const series = (names, unit = 'USD') => {
    for (const n of names) { const u = g[n]?.units?.[unit]; if (u && u.length) return u; }
    return [];
  };
  const dur = (x) => (Date.parse(x.end) - Date.parse(x.start)) / DAY;
  const annual = (rows) => {
    const byEnd = new Map();
    for (const r of rows) if (r.form === '10-K' && r.start && dur(r) > 350 && dur(r) < 380) byEnd.set(r.end, r.val);
    return [...byEnd.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-4);
  };
  const quarterly = (rows) => {
    const byEnd = new Map();
    for (const r of rows) if (r.start && dur(r) > 80 && dur(r) < 100) byEnd.set(r.end, r.val);
    return [...byEnd.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  };
  const revRows = series(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
  const niRows = series(['NetIncomeLoss']);
  const epsRows = series(['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares');
  const rq = quarterly(revRows), nq = quarterly(niRows), eq = quarterly(epsRows);
  const ttm = (q) => (q.length >= 4 ? q.slice(-4).reduce((s, x) => s + x[1], 0) : null);
  const yoy = (q) => (q.length >= 5 && q[q.length - 5][1] ? q[q.length - 1][1] / q[q.length - 5][1] - 1 : null);
  return {
    name: c.name, cik: c.cik, source: 'SEC EDGAR', url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}`,
    revenueAnnual: annual(revRows), netIncomeAnnual: annual(niRows),
    revenueTTM: ttm(rq), netIncomeTTM: ttm(nq), epsTTM: ttm(eq), revenueYoY: yoy(rq), lastQuarter: rq.length ? rq[rq.length - 1][0] : null,
  };
}

function fixture(name) {
  const f = path.join(FIX, `${name.replace(/[^\w.-]/g, '_')}.json`);
  if (!fs.existsSync(f)) throw new Error(`no fixture ${name}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** Which sources answer from this server right now (for the deploy log and the status page). */
async function probe() {
  const checks = [
    ['Yahoo prices', () => yahoo('SPY', 'query1.finance.yahoo.com').then((r) => `${r.close.length} days`)],
    ['Stooq prices', () => stooq('SPY').then((r) => `${r.close.length} days`)],
    ['Nasdaq prices', () => nasdaq('SPY').then((r) => `${r.close.length} days`)],
    ['FRED', () => fredSeries('T10Y2Y').then((r) => `${r.points.length} points`)],
    ['Reddit', () => reddit('stock market').then((r) => `${r.posts.length} posts`)],
    ['StockTwits', () => stocktwits('SPY').then((r) => `${r.posts.length} posts`)],
    ['Hacker News', () => hackernews('AI').then((r) => `${r.posts.length} posts`)],
    ['Google News', () => googleNews('stock market').then((r) => `${r.posts.length} headlines`)],
    ['GDELT', () => gdeltTone('stock market').then((r) => `${r.points.length} days`)],
    ['SEC EDGAR', () => fundamentals('AAPL').then((r) => (r ? `revenue TTM ${r.revenueTTM}` : 'no CIK'))],
    ...(process.env.SC_X_BEARER ? [['X', () => xSearch('$SPY').then((r) => `${r.posts.length} posts`)]] : []),
  ];
  const out = [];
  for (const [name, fn] of checks) {
    const t = Date.now();
    try { out.push({ name, ok: true, detail: await fn(), ms: Date.now() - t }); } catch (e) { out.push({ name, ok: false, detail: e.message.slice(0, 120), ms: Date.now() - t }); }
  }
  return out;
}

module.exports = { prices, fredSeries, FRED_INFO, reddit, stocktwits, hackernews, googleNews, gdeltTone, xSearch, fundamentals, probe, cached, rssItems };
