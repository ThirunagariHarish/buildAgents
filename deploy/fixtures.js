// Synthetic market data for offline tests: writes fixture files that
// lib/data.js reads when SC_FIXTURES points at the directory.
const fs = require('fs');
const path = require('path');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

function series(seed, start, mu, sigma, days = 2520) {
  const r = rng(seed);
  const dates = [], close = [];
  let px = start;
  const d = new Date(Date.now() - days * 1.45 * 86400000);
  while (dates.length < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if ([0, 6].includes(d.getUTCDay())) continue;
    const jump = r() < 0.004 ? -0.05 * r() : 0;
    px *= Math.exp(mu / 252 - sigma ** 2 / 504 + sigma / Math.sqrt(252) * gauss(r) + jump);
    dates.push(d.toISOString().slice(0, 10)); close.push(Math.round(px * 100) / 100);
  }
  // End on today so the run sees fresh data.
  dates[dates.length - 1] = new Date().toISOString().slice(0, 10);
  return { dates, close };
}

function write(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const put = (name, v) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(v));
  const sym = { SPY: [1, 200, 0.1, 0.17], QQQ: [2, 110, 0.15, 0.22], NVDA: [3, 8, 0.6, 0.5], MSFT: [4, 50, 0.22, 0.26], SMH: [5, 60, 0.25, 0.3], 'BTC-USD': [6, 400, 0.7, 0.7], TLT: [7, 120, 0, 0.14], '^VIX': [8, 18, 0, 0.9] };
  for (const [s, [seed, a, mu, sig]] of Object.entries(sym)) put(`prices-${s.replace(/[^\w.-]/g, '_')}`, { ...series(seed, a, mu, sig), name: s, source: 'Fixture', symbol: s });
  const fred = (id, f) => { const pts = []; for (let i = 0; i < 72; i++) { const d = new Date(Date.now() - (72 - i) * 30 * 86400000); pts.push([d.toISOString().slice(0, 10), f(i)]); } put(`fred-${id}`, { id, name: id, points: pts, source: 'Fixture', url: `https://fred.stlouisfed.org/series/${id}` }); };
  fred('T10Y2Y', (i) => -0.8 + i * 0.02);
  fred('VIXCLS', (i) => 15 + (i % 7));
  fred('BAMLH0A0HYM2', (i) => 3.2 + (i > 66 ? 0.3 : 0));
  fred('UNRATE', (i) => 3.6 + (i > 60 ? (i - 60) * 0.06 : 0));
  fred('NFCI', () => -0.4);
  fred('ICSA', (i) => 220000 + i * 500);
  fred('FEDFUNDS', (i) => 5.3 - (i > 60 ? (i - 60) * 0.1 : 0));
  const now = Date.now();
  put('reddit', { source: 'Reddit', posts: [
    { text: 'Market is in a bubble, puts loaded, crash incoming', score: 120, at: now, url: 'https://www.reddit.com/r/stocks/1', where: 'r/stocks' },
    { text: 'Earnings beat across the board, rally continues', score: 300, at: now, url: 'https://www.reddit.com/r/stocks/2', where: 'r/stocks' },
    { text: 'Recession fears grow as layoffs rise', score: 80, at: now, url: 'https://www.reddit.com/r/investing/3', where: 'r/investing' },
    { text: 'Buying the dip, strong demand for AI chips', score: 50, at: now, url: 'https://www.reddit.com/r/investing/4', where: 'r/investing' },
  ] });
  put('stocktwits', { source: 'StockTwits', posts: [{ text: '$SPY to the moon 🚀', label: 'Bullish', at: now, url: 'https://stocktwits.com/message/1', where: '$SPY' }, { text: '$SPY rolling over', label: 'Bearish', at: now, url: 'https://stocktwits.com/message/2', where: '$SPY' }, { text: '$SPY calls', label: 'Bullish', at: now, url: 'https://stocktwits.com/message/3', where: '$SPY' }] });
  put('hn', { source: 'Hacker News', posts: [{ text: 'Is the AI capex boom sustainable?', score: 400, at: now, url: 'https://news.ycombinator.com/item?id=1', where: 'HN' }] });
  put('news', { source: 'Google News', posts: [{ text: 'Stocks rally to record as inflation cools', at: now, url: 'https://example.com/a', where: 'Reuters' }, { text: 'Strategist warns of bubble in tech shares', at: now, url: 'https://example.com/b', where: 'Bloomberg' }] });
  put('gdelt', { source: 'GDELT', points: Array.from({ length: 90 }, (_, i) => [new Date(now - (90 - i) * 86400000).toISOString().slice(0, 10), -1.2 + Math.sin(i / 9) * 0.4]) });
  put('sec-NVDA', { name: 'NVIDIA CORP', cik: '0001045810', source: 'SEC EDGAR', url: 'https://www.sec.gov/', revenueAnnual: [], netIncomeAnnual: [], revenueTTM: 1.6e11, netIncomeTTM: 8.5e10, epsTTM: 3.4, revenueYoY: 0.55, lastQuarter: '2026-07-31' });
  put('markets', { source: 'Polymarket, Kalshi, Manifold', markets: [{ venue: 'Polymarket', question: 'US recession in 2026?', p: 0.18, volume: 2400000, closes: '2026-12-31', url: 'https://polymarket.com/event/us-recession-in-2026', score: 0.67 }, { venue: 'Manifold', question: 'Will the S&P 500 drop 20% in 2026?', p: 0.09, volume: 5000, closes: '2026-12-31', url: 'https://manifold.markets/x/sp', playMoney: true, score: 0.5 }], errors: [] });
  put('feargreed', { source: 'CNN Fear & Greed', score: 46.1, rating: 'neutral', weekAgo: 43.7, monthAgo: 32.7, yearAgo: 30.1, history: [], url: 'https://www.cnn.com/markets/fear-and-greed' });
  put('wiki', { source: 'Wikipedia pageviews', title: 'Nvidia', points: Array.from({ length: 120 }, (_, i) => [new Date(now - (120 - i) * 864e5).toISOString().slice(0, 10), i > 112 ? 15000 : 6000]), url: 'https://en.wikipedia.org/wiki/Nvidia' });
  put('mastodon', { source: 'Mastodon', posts: [{ text: '$SPY looks heavy here, breadth is weak', score: 3, at: now, url: 'https://mastodon.social/@a/1', where: '#spy' }] });
  put('tickernews', { source: 'Yahoo Finance, Seeking Alpha', posts: [{ text: 'S&P 500 hits record as earnings beat', at: now, url: 'https://finance.yahoo.com/x', where: 'Yahoo Finance' }] });
  // A synthetic SPY option chain around the fixture's last price.
  const spy = JSON.parse(fs.readFileSync(path.join(dir, 'prices-SPY.json'), 'utf8'));
  const S = spy.close[spy.close.length - 1];
  const exp = (days) => { const d = new Date(now + days * 864e5); return { expiry: d.toISOString().slice(0, 10), days } };
  const N = (x) => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI / 8) * x * 1.6));
  const chainExp = [exp(30), exp(81), exp(200)].map((e) => {
    const sig = 0.18 * Math.sqrt(e.days / 365);
    const strikes = [];
    for (let k = Math.round(S * 0.5); k <= S * 1.5; k += Math.max(1, Math.round(S / 100))) {
      const d2 = Math.log(S / k) / sig - sig / 2;
      const put = Math.max(0.01, k * N(-d2) - S * N(-d2 - sig));
      strikes.push({ k, put, call: put + S - k, putVol: 100, callVol: 120, putOi: 1000, callOi: 900, putIv: 0.18, callIv: 0.18 });
    }
    return { ...e, strikes };
  });
  put('options-SPY', { root: 'SPY', spot: S, asOf: new Date().toISOString(), expiries: chainExp, source: 'Cboe delayed quotes' });
  return dir;
}

module.exports = { write, series };
if (require.main === module) console.log(write(process.argv[2] || path.join(require('os').tmpdir(), 'sc-fixtures')));
