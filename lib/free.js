// More free, keyless sources (each checked from the server; see deploy/peek.js):
// prediction markets (Polymarket, Manifold, Kalshi), CBOE delayed option
// chains, CNN and crypto Fear & Greed, the US Treasury yield curve, BLS,
// Wikipedia attention, Mastodon, Lemmy, and ticker news feeds (Yahoo,
// Seeking Alpha) plus the Federal Reserve's press releases.

const { get, cached, rssItems, fixture, FIX, DAY } = require('./data');

const H = 3600 * 1000;
const words = (q) => String(q || '').toLowerCase().match(/[a-z0-9$&.]{2,}/g) || [];
const STOP = new Set(['the', 'will', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'its', 'end', 'by', 'of', 'in', 'on', 'to', 'be', 'a', 'an', 'or']);
/** Share of the query's meaningful words found in a title (0..1). */
function overlap(query, title) {
  const q = words(query).filter((w) => !STOP.has(w));
  if (!q.length) return 0;
  const t = String(title || '').toLowerCase();
  return q.filter((w) => t.includes(w)).length / q.length;
}

// ---- prediction markets --------------------------------------------------------
async function polymarket(query) {
  const j = await get(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(query)}&limit_per_type=10&events_status=active`);
  const out = [];
  for (const ev of j.events || []) {
    if (ev.closed) continue;
    for (const m of (ev.markets || []).slice(0, 4)) {
      if (m.closed || m.active === false) continue;
      let prices = m.outcomePrices, outcomes = m.outcomes;
      try { if (typeof prices === 'string') prices = JSON.parse(prices); if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes); } catch { continue; }
      const yi = Array.isArray(outcomes) ? outcomes.findIndex((o) => /^yes$/i.test(o)) : 0;
      const p = Number(prices && prices[yi < 0 ? 0 : yi]);
      if (!Number.isFinite(p)) continue;
      out.push({ venue: 'Polymarket', question: m.question || ev.title, p, volume: Number(m.volume || ev.volume || 0), closes: (m.endDate || ev.endDate || '').slice(0, 10), url: `https://polymarket.com/event/${ev.slug}` });
    }
  }
  return out;
}
async function manifold(query) {
  const j = await get(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(query)}&limit=12&filter=open`);
  return (Array.isArray(j) ? j : []).filter((m) => m.outcomeType === 'BINARY' && !m.isResolved && Number.isFinite(m.probability))
    .map((m) => ({ venue: 'Manifold', question: m.question, p: m.probability, volume: Number(m.volume || 0), closes: m.closeTime ? new Date(m.closeTime).toISOString().slice(0, 10) : '', url: m.url, playMoney: true }));
}
// Kalshi has no text search: read its open economics/financial events (cached) and match titles.
async function kalshiEvents() {
  return cached('kalshi:events', 6 * H, async () => {
    const out = [];
    let cursor = '';
    for (let page = 0; page < 6; page++) {
      const j = await get(`https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&with_nested_markets=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const ev of j.events || []) {
        if (!/econ|financ|compan|crypto|tech|world/i.test(ev.category || '')) continue;
        for (const m of (ev.markets || []).slice(0, 6)) {
          const p = Number(m.last_price_dollars || (m.last_price != null ? m.last_price / 100 : NaN));
          if (!Number.isFinite(p) || p <= 0) continue;
          out.push({ venue: 'Kalshi', question: [ev.title, m.yes_sub_title || m.subtitle].filter(Boolean).join(': '), p, volume: Number(m.volume || 0), closes: String(m.close_time || '').slice(0, 10), url: `https://kalshi.com/markets/${String(ev.series_ticker || ev.event_ticker || '').toLowerCase()}` });
        }
      }
      cursor = j.cursor;
      if (!cursor) break;
    }
    return out;
  });
}
/** Open prediction markets related to the queries, best matches first. */
async function predictionMarkets(queries) {
  if (FIX) return fixture('markets');
  const qs = (queries || []).filter(Boolean).slice(0, 3);
  return cached(`pm:${qs.join('|')}`, 3 * H, async () => {
    const all = [];
    const errors = [];
    for (const q of qs) {
      for (const [name, fn] of [['Polymarket', polymarket], ['Manifold', manifold]]) {
        try { for (const m of await fn(q)) all.push({ ...m, score: overlap(q, m.question) }); } catch (e) { errors.push(`${name}: ${e.message}`); }
      }
    }
    try { const k = await kalshiEvents(); for (const q of qs) for (const m of k) { const sc = overlap(q, m.question); if (sc >= 0.5) all.push({ ...m, score: sc }); } } catch (e) { errors.push(`Kalshi: ${e.message}`); }
    const seen = new Set();
    const markets = all.filter((m) => m.score >= 0.34 && !seen.has(m.question) && seen.add(m.question))
      .sort((a, b) => b.score - a.score || (b.playMoney ? 0 : 1) - (a.playMoney ? 0 : 1) || b.volume - a.volume).slice(0, 8);
    return { source: 'Polymarket, Kalshi, Manifold', markets, errors };
  });
}

// ---- options (CBOE delayed quotes) ----------------------------------------------
const CBOE_ROOT = { '^GSPC': '_SPX', '^SPX': '_SPX', '^NDX': '_NDX', '^RUT': '_RUT', '^VIX': '_VIX', '^DJI': '_DJX' };
/** Parse the chain into expiries: [{ expiry, days, strikes: [{ k, call: mid, put: mid, callVol, putVol, callOi, putOi, iv }] }]. */
async function optionChain(symbol) {
  if (FIX) return fixture(`options-${symbol}`);
  const root = CBOE_ROOT[symbol] || symbol;
  if (!/^_?[A-Z]{1,5}$/.test(root)) return null;
  return cached(`cboe:${root}`, 2 * H, async () => {
    const j = await get(`https://cdn.cboe.com/api/global/delayed_quotes/options/${root}.json`, { timeoutMs: 30000 });
    const opts = j?.data?.options || [];
    const spot = Number(j?.data?.current_price || j?.data?.close || 0);
    const byExp = new Map();
    for (const o of opts) {
      const m = String(o.option).match(/(\d{6})([CP])(\d{8})$/);
      if (!m) continue;
      const exp = `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
      const k = Number(m[3]) / 1000;
      const mid = o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : Number(o.last_trade_price || 0);
      if (!byExp.has(exp)) byExp.set(exp, new Map());
      const row = byExp.get(exp).get(k) || { k };
      if (m[2] === 'C') Object.assign(row, { call: mid, callVol: o.volume || 0, callOi: o.open_interest || 0, callIv: o.iv });
      else Object.assign(row, { put: mid, putVol: o.volume || 0, putOi: o.open_interest || 0, putIv: o.iv });
      byExp.get(exp).set(k, row);
    }
    const today = Date.now();
    const expiries = [...byExp.entries()].map(([expiry, rows]) => ({ expiry, days: Math.round((Date.parse(`${expiry}T21:00:00Z`) - today) / DAY), strikes: [...rows.values()].sort((a, b) => a.k - b.k) }))
      .filter((e) => e.days >= 1).sort((a, b) => a.days - b.days);
    return { root, spot, asOf: j.timestamp, expiries, source: 'Cboe delayed quotes' };
  });
}
/**
 * What the options market implies: P(price below level at an expiry) from the
 * slope of put prices across strikes (a digital-option approximation),
 * put/call volume and open interest, and at-the-money implied volatility.
 */
function optionRead(chain, { level, horizonDate }) {
  if (!chain || !chain.expiries.length) return null;
  const target = horizonDate ? Math.round((Date.parse(`${horizonDate}T21:00:00Z`) - Date.now()) / DAY) : 30;
  // The listed expiry nearest the deadline (not after it if one is close).
  const exp = chain.expiries.reduce((best, e) => (Math.abs(e.days - target) < Math.abs(best.days - target) ? e : best), chain.expiries[0]);
  const near = chain.expiries.find((e) => e.days >= 20) || chain.expiries[chain.expiries.length - 1];
  const spot = chain.spot || (() => { const s = near.strikes.filter((r) => r.call > 0 && r.put > 0).sort((a, b) => Math.abs(a.call - a.put) - Math.abs(b.call - b.put))[0]; return s ? s.k + s.call - s.put : null; })();
  let probBelow = null;
  if (level && spot) {
    const rows = exp.strikes.filter((r) => r.put > 0 && Number.isFinite(r.put));
    const lo = [...rows].reverse().find((r) => r.k <= level), hi = rows.find((r) => r.k >= level && r !== lo);
    if (lo && hi && hi.k > lo.k && (hi.k - lo.k) / level < 0.08) probBelow = Math.max(0, Math.min(1, (hi.put - lo.put) / (hi.k - lo.k)));
  }
  const sum = (arr, f) => arr.reduce((s, r) => s + (r[f] || 0), 0);
  const all = chain.expiries.slice(0, 6).flatMap((e) => e.strikes);
  const pcVol = sum(all, 'callVol') ? sum(all, 'putVol') / sum(all, 'callVol') : null;
  const pcOi = sum(all, 'callOi') ? sum(all, 'putOi') / sum(all, 'callOi') : null;
  const atm = spot ? near.strikes.reduce((b, r) => (Math.abs(r.k - spot) < Math.abs(b.k - spot) ? r : b), near.strikes[0]) : null;
  const atmIv = atm ? [atm.callIv, atm.putIv].filter((x) => x > 0 && x < 5).reduce((s, x, i, a) => s + x / a.length, 0) || null : null;
  // The whole curve: P(below K) at each strike, from neighbouring put prices.
  let curve = null;
  if (spot) {
    const rows = exp.strikes.filter((r) => r.put > 0 && r.k > spot * 0.55 && r.k < spot * 1.45);
    curve = [];
    for (let i = 1; i < rows.length; i++) { const dk = rows[i].k - rows[i - 1].k; if (dk <= 0 || dk / spot > 0.06) continue; curve.push({ k: (rows[i].k + rows[i - 1].k) / 2, p: Math.max(0, Math.min(1, (rows[i].put - rows[i - 1].put) / dk)) }); }
    // Prices are noisy: keep it monotone (a cumulative probability never falls).
    for (let i = 1; i < curve.length; i++) curve[i].p = Math.max(curve[i].p, curve[i - 1].p);
    if (curve.length > 60) { const step = Math.ceil(curve.length / 60); curve = curve.filter((_, i) => i % step === 0); }
    if (curve.length < 4) curve = null;
  }
  return { expiry: exp.expiry, days: exp.days, level, spot, probBelow, pcVol, pcOi, atmIv, ivExpiry: near.expiry, curve };
}

// ---- crowd mood indexes ------------------------------------------------------------
async function fearGreed() {
  if (FIX) return fixture('feargreed');
  return cached('cnn:fg', 3 * H, async () => {
    const j = await get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers: { Referer: 'https://www.cnn.com/' } });
    const f = j.fear_and_greed;
    return { source: 'CNN Fear & Greed', score: f.score, rating: f.rating, weekAgo: f.previous_1_week, monthAgo: f.previous_1_month, yearAgo: f.previous_1_year, history: (j.fear_and_greed_historical?.data || []).slice(-120).map((d) => [new Date(d.x).toISOString().slice(0, 10), d.y]), url: 'https://www.cnn.com/markets/fear-and-greed' };
  });
}
async function cryptoFearGreed() {
  if (FIX) return fixture('cryptofg');
  return cached('alt:fg', 3 * H, async () => {
    const j = await get('https://api.alternative.me/fng/?limit=60');
    const d = (j.data || []).map((x) => [new Date(Number(x.timestamp) * 1000).toISOString().slice(0, 10), Number(x.value), x.value_classification]).reverse();
    const last = d[d.length - 1];
    return { source: 'Crypto Fear & Greed (alternative.me)', score: last[1], rating: last[2], weekAgo: (d[d.length - 8] || [])[1], monthAgo: (d[d.length - 31] || [])[1], history: d.map((x) => [x[0], x[1]]), url: 'https://alternative.me/crypto/fear-and-greed-index/' };
  });
}

// ---- macro from the source ---------------------------------------------------------
/** US Treasury par yield curve, daily, this year and last: { points: [[date, {3m, 2y, 10y, 30y}]] }. */
async function treasuryCurve() {
  if (FIX) return fixture('treasury');
  return cached('ust:curve', 12 * H, async () => {
    const y = new Date().getUTCFullYear();
    const rows = [];
    for (const year of [y - 1, y]) {
      const csv = await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`, { as: 'text' });
      const lines = csv.trim().split('\n');
      const head = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
      const col = (name) => head.indexOf(name);
      for (const l of lines.slice(1)) {
        const c = l.split(',');
        const [m, d, yy] = c[0].split('/');
        rows.push([`${yy}-${m}-${d}`, { m3: Number(c[col('3 Mo')]), y2: Number(c[col('2 Yr')]), y10: Number(c[col('10 Yr')]), y30: Number(c[col('30 Yr')]) }]);
      }
    }
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    return { source: 'US Treasury', points: rows, url: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates' };
  });
}
/** BLS unemployment rate (public API v1, no key). */
async function blsUnemployment() {
  if (FIX) return fixture('bls');
  return cached('bls:unrate', 24 * H, async () => {
    const j = await get('https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000');
    const d = (j?.Results?.series?.[0]?.data || []).filter((x) => /^M\d\d$/.test(x.period) && x.period !== 'M13').map((x) => [`${x.year}-${x.period.slice(1)}-01`, Number(x.value)]).reverse();
    if (!d.length) throw new Error(j.message?.join(' ') || 'no data');
    return { source: 'BLS', points: d, url: 'https://data.bls.gov/timeseries/LNS14000000' };
  });
}

// ---- attention -------------------------------------------------------------------------
/** Daily Wikipedia pageviews for the article that best matches the name: a measure of public attention. */
async function wikiAttention(name) {
  if (FIX) return fixture('wiki');
  if (!name) return null;
  return cached(`wiki:${name}`, 12 * H, async () => {
    const s = await get(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(name)}&limit=1&namespace=0&format=json`);
    const title = s && s[1] && s[1][0];
    if (!title) return null;
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
    const j = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/daily/${fmt(new Date(Date.now() - 180 * DAY))}/${fmt(new Date())}`);
    const pts = (j.items || []).map((x) => [`${x.timestamp.slice(0, 4)}-${x.timestamp.slice(4, 6)}-${x.timestamp.slice(6, 8)}`, x.views]);
    return { source: 'Wikipedia pageviews', title, points: pts, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` };
  });
}

// ---- more crowd and news ------------------------------------------------------------------
const stripHtml = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
async function mastodon(tags) {
  if (FIX) return fixture('mastodon');
  const ts = (tags || []).map((t) => String(t).replace(/[^\w]/g, '').toLowerCase()).filter(Boolean).slice(0, 3);
  if (!ts.length) return null;
  return cached(`masto:${ts.join(',')}`, 3 * H, async () => {
    const posts = [];
    for (const t of ts) {
      const j = await get(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(t)}?limit=30`);
      for (const p of j || []) if (p.language === 'en' || !p.language) posts.push({ text: stripHtml(p.content).slice(0, 500), score: (p.favourites_count || 0) + (p.reblogs_count || 0), at: Date.parse(p.created_at), url: p.url, where: `#${t}` });
    }
    return { source: 'Mastodon', posts: posts.filter((p) => Date.now() - p.at < 14 * DAY) };
  });
}
async function lemmy(query) {
  if (FIX) return fixture('lemmy');
  return cached(`lemmy:${query}`, 3 * H, async () => {
    const j = await get(`https://lemmy.world/api/v3/search?q=${encodeURIComponent(query)}&type_=Posts&sort=New&limit=30`, { timeoutMs: 25000 });
    return { source: 'Lemmy', posts: (j.posts || []).map((x) => ({ text: `${x.post.name}. ${String(x.post.body || '').slice(0, 300)}`, score: x.counts?.score || 0, at: Date.parse(x.post.published), url: x.post.ap_id || x.post.url, where: 'Lemmy' })).filter((p) => Date.now() - p.at < 14 * DAY) };
  });
}
/** Headlines for one ticker from Yahoo Finance and Seeking Alpha feeds. */
async function tickerNews(symbol) {
  if (FIX) return fixture('tickernews');
  const sym = String(symbol || '').replace(/^\^/, '');
  if (!/^[A-Z.\-=]{1,10}$/.test(sym)) return null;
  return cached(`tnews:${sym}`, 3 * H, async () => {
    const posts = [];
    const add = (items, where) => { for (const i of items) if (i.title) posts.push({ text: i.title, at: i.at, url: i.url, where }); };
    try { add(rssItems(await get(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`, { as: 'text' })), 'Yahoo Finance'); } catch {}
    try { add(rssItems(await get(`https://seekingalpha.com/api/sa/combined/${encodeURIComponent(sym)}.xml`, { as: 'text' })), 'Seeking Alpha'); } catch {}
    if (!posts.length) throw new Error('no headlines');
    return { source: 'Yahoo Finance, Seeking Alpha', posts: posts.filter((p) => !p.at || Date.now() - p.at < 14 * DAY).slice(0, 50) };
  });
}
/** The Federal Reserve's latest press releases (policy statements, minutes, speeches). */
async function fedNews() {
  if (FIX) return fixture('fed');
  return cached('fed:press', 6 * H, async () => {
    const items = rssItems(await get('https://www.federalreserve.gov/feeds/press_all.xml', { as: 'text' }));
    return { source: 'Federal Reserve', posts: items.slice(0, 12).map((i) => ({ text: i.title, at: i.at, url: i.url, where: 'federalreserve.gov' })) };
  });
}

module.exports = { predictionMarkets, optionChain, optionRead, fearGreed, cryptoFearGreed, treasuryCurve, blsUnemployment, wikiAttention, mastodon, lemmy, tickerNews, fedNews, overlap };
