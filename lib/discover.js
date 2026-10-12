// Discover: the claims people are making online today, ready to test.
//
// Pulls the day's top posts from Reddit (investing communities), StockTwits'
// trending symbols, Mastodon, Hacker News, business headlines and the busiest
// prediction markets. With Claude, it extracts distinct, testable market
// claims ("Bitcoin breaks $100k by year end") with who is saying it and how
// loudly; without Claude, prediction-market questions and posts that read like
// predictions stand in. Refreshed twice a day and on request.

const fs = require('fs');
const path = require('path');
const { get, cached, rssItems, atomEntries, DAY } = require('./data');
const free = require('./free');
const voice = require('./voice');
const sentiment = require('./sentiment');
const { askJson } = require('./claude');
const { DATA, MODEL_FAST } = require('./config');

const FILE = path.join(DATA, 'discover.json');
const H = 3600 * 1000;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const nodash = (s) => String(s || '').replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[—–]\s*/g, ', ');
const safeUrl = (u) => (/^https?:\/\/[^\s"<>]+$/.test(String(u || '')) ? String(u).slice(0, 600) : null);
const SUBS = ['stocks', 'investing', 'wallstreetbets', 'StockMarket', 'economics', 'CryptoCurrency', 'options', 'SecurityAnalysis'];
const CATS = ['Market', 'Stock', 'Crypto', 'Macro', 'Rates', 'Commodities'];

// ---- sources -------------------------------------------------------------------------
async function redditTop() {
  return cached('disc:reddit', 3 * H, async () => {
    const xml = await get(`https://www.reddit.com/r/${SUBS.join('+')}/top/.rss?t=day&limit=60`, { as: 'text', headers: { 'User-Agent': 'RunScenario/1.0 (research; personal use)' } });
    return atomEntries(xml).filter((e) => e.title).map((e) => ({ platform: 'Reddit', where: e.where || 'Reddit', text: e.title, body: e.body.slice(0, 280), url: e.url, at: e.at }));
  });
}
async function stocktwitsTrending() {
  return cached('disc:st', 2 * H, async () => {
    const j = await get('https://api.stocktwits.com/api/2/trending/symbols.json');
    return (j.symbols || []).slice(0, 20).map((s) => ({ symbol: s.symbol, name: s.title, watchers: s.watchlist_count || 0 }));
  });
}
async function mastodonTop() {
  const r = await free.mastodon(['stocks', 'investing', 'economy']);
  return (r ? r.posts : []).map((p) => ({ platform: 'Mastodon', where: p.where, text: p.text.slice(0, 280), url: p.url, at: p.at, score: p.score }));
}
async function hnTop() {
  return cached('disc:hn', 3 * H, async () => {
    const since = Math.floor((Date.now() - 2 * DAY) / 1000);
    const j = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent('stock market OR recession OR fed OR bitcoin OR AI bubble')}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=30`);
    return (j.hits || []).map((h) => ({ platform: 'Hacker News', where: 'HN', text: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}`, at: h.created_at_i * 1000, score: h.points }));
  });
}
async function businessNews() {
  return cached('disc:news', 2 * H, async () => {
    const xml = await get('https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en', { as: 'text' });
    return rssItems(xml).slice(0, 40).map((i) => { const m = i.title.match(/^(.*) - ([^-]{2,60})$/); return { platform: 'News', where: m ? m[2] : i.where || 'News', text: m ? m[1] : i.title, url: i.url, at: i.at }; });
  });
}
/** The busiest open prediction markets on economy, finance and crypto. */
async function hotMarkets() {
  return cached('disc:pm', 2 * H, async () => {
    const out = [];
    try {
      const j = await get('https://gamma-api.polymarket.com/events?closed=false&active=true&order=volume24hr&ascending=false&limit=80');
      for (const ev of Array.isArray(j) ? j : []) {
        const tags = (ev.tags || []).map((t) => String(t.label || t.slug || '').toLowerCase());
        if (!tags.some((t) => /econ|financ|crypto|business|stock|fed|rate|inflation|tech|bitcoin|ai/.test(t))) continue;
        const m = (ev.markets || []).filter((x) => !x.closed).sort((a, b) => Number(b.volume24hr || 0) - Number(a.volume24hr || 0))[0];
        if (!m) continue;
        let prices = m.outcomePrices; try { if (typeof prices === 'string') prices = JSON.parse(prices); } catch { continue; }
        const p = Number(prices && prices[0]);
        if (!Number.isFinite(p)) continue;
        out.push({ venue: 'Polymarket', question: (ev.markets || []).length > 1 ? `${ev.title}: ${m.groupItemTitle || m.question}` : m.question || ev.title, p, volume24h: Number(ev.volume24hr || m.volume24hr || 0), closes: String(m.endDate || ev.endDate || '').slice(0, 10), url: `https://polymarket.com/event/${ev.slug}` });
      }
    } catch {}
    try {
      const k = await free.predictionMarkets(['S&P 500', 'recession', 'Fed rate', 'bitcoin', 'inflation']);
      for (const m of k.markets) if (!m.playMoney && !out.some((x) => x.question === m.question)) out.push({ ...m, volume24h: 0 });
    } catch {}
    return out.sort((a, b) => b.volume24h - a.volume24h).slice(0, 12);
  });
}

// ---- making claims -------------------------------------------------------------------
async function withClaude(posts, existing) {
  const list = posts.slice(0, 110).map((p, i) => `${i + 1}. [${p.platform}${p.where && p.where !== p.platform ? ` ${p.where}` : ''}] ${p.text}`).join('\n');
  const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. Below are today's top posts and headlines from investing communities and the news.

${list}

Find the distinct, testable market claims people are making or arguing about today: predictions about prices, indexes, rates, the economy, crypto or a company's stock, which could be checked against market data by a date. Merge posts that make the same claim. Skip pure news with no prediction, memes, questions with no view, and anything already tracked: ${existing.slice(0, 30).map((x) => `"${x}"`).join(', ') || 'none'}.

For each claim (up to 14, most discussed first) give:
- claim: one neutral sentence with a timeframe (if none is given, use the one most implied, e.g. "by year end")
- lean: "bullish" or "bearish" for the asset it is about
- category: one of ${CATS.join(', ')}
- posts: the numbers of the posts making it
- why: one short line on why people are saying it now (12 words max)
- build: if it is measurable on one ticker's price, {"symbol":"Yahoo ticker","move":"drawdown|down|up|touchBelow|touchAbove|below|above|beat|trail","value":number,"vs":"ticker or empty","date":"YYYY-MM-DD"}, else null

Never use em dashes. Reply with ONLY JSON: {"claims":[{"claim":"","lean":"","category":"","posts":[1],"why":"","build":null}]}`;
  const r = await askJson({ prompt, system: 'You find testable market claims in social media for an independent research desk. Neutral: report what people claim, not whether it is right.', model: MODEL_FAST, tools: [], timeoutMs: 4 * 60 * 1000 });
  return (r.json.claims || []).slice(0, 14).map((c) => {
    const src = (c.posts || []).map((n) => posts[Number(n) - 1]).filter(Boolean);
    return {
      claim: nodash(clean(c.claim)).slice(0, 220), lean: c.lean === 'bearish' ? 'bearish' : 'bullish', category: CATS.includes(c.category) ? c.category : 'Market', why: nodash(clean(c.why)).slice(0, 140),
      buzz: src.length, platforms: [...new Set(src.map((p) => p.platform))], sources: src.slice(0, 4).map((p) => ({ text: p.text.slice(0, 160), where: p.where, platform: p.platform, url: safeUrl(p.url) })).filter((x) => x.url),
      build: c.build && c.build.symbol ? c.build : null, by: 'claude',
    };
  }).filter((c) => c.claim.length > 10);
}
const PREDICTS = /\b(will|going to|gonna|is about to|headed (to|for)|could (hit|reach|crash|fall)|by (end of|year end|20\d\d|q[1-4])|crash|bubble|moon|to \$?\d|bottom(ed)? (is|in)|top is in|recession)\b/i;
async function withoutClaude(posts) {
  const cands = posts.filter((p) => PREDICTS.test(p.text) && voice.findSymbols(p.text).length).slice(0, 30);
  const scored = await sentiment.scorePosts(cands.map((p) => ({ text: p.text })));
  return cands.map((p, i) => {
    const b = voice.parseBuild(p.text);
    const sym = voice.findSymbols(p.text)[0];
    return { claim: p.text.slice(0, 200), lean: scored.posts[i].s >= 0 ? 'bullish' : 'bearish', category: /BTC|ETH|-USD/.test(sym) ? 'Crypto' : /SPY|QQQ|IWM|DIA/.test(sym) ? 'Market' : 'Stock', why: `Posted on ${p.where}.`, buzz: 1, platforms: [p.platform], sources: [{ text: p.text.slice(0, 160), where: p.where, platform: p.platform, url: safeUrl(p.url) }].filter((x) => x.url), build: b.symbol && b.move ? { ...b, date: b.date || new Date(Date.now() + 182 * DAY).toISOString().slice(0, 10) } : null, by: 'auto' };
  }).slice(0, 12);
}

/** Gather and rebuild today's list. ai: let Claude extract the claims. */
async function refresh({ ai, existing = [], inject = null } = {}) {
  const errors = [];
  const soft = (name, p) => p.catch((e) => { errors.push(`${name}: ${e.message}`); return []; });
  // Tests pass their own posts instead of fetching.
  const [rd, ms, hn, news, tickers, markets] = inject ? [inject.posts, [], [], [], inject.tickers || [], inject.markets || []] : await Promise.all([soft('Reddit', redditTop()), soft('Mastodon', mastodonTop()), soft('Hacker News', hnTop()), soft('News', businessNews()), soft('StockTwits', stocktwitsTrending()), soft('Prediction markets', hotMarkets())]);
  const posts = [...rd, ...hn, ...ms.slice(0, 20), ...news].filter((p) => p.text && p.text.length > 15);
  let claims = [];
  if (ai && posts.length) { try { claims = await withClaude(posts, existing); } catch (e) { errors.push(`Claude: ${e.message}`); } }
  if (!claims.length) claims = await withoutClaude(posts);
  // Which tickers people mention most across the posts (plus StockTwits' trending list).
  const counts = new Map();
  for (const p of posts) for (const s of new Set(voice.findSymbols(p.text))) counts.set(s, (counts.get(s) || 0) + 1);
  const mentioned = [...counts.entries()].filter(([s]) => s.length >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([symbol, n]) => ({ symbol, mentions: n }));
  const out = { at: Date.now(), claims, markets, tickers: { trending: tickers.slice(0, 15), mentioned }, sources: { reddit: rd.length, mastodon: ms.length, hn: hn.length, news: news.length }, by: claims[0] ? claims[0].by : 'auto', errors };
  const t = `${FILE}.tmp`;
  fs.writeFileSync(t, JSON.stringify(out));
  fs.renameSync(t, FILE);
  return out;
}
function latest() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } }

module.exports = { refresh, latest, redditTop, stocktwitsTrending, hotMarkets, businessNews };
