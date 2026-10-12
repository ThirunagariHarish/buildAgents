// Prints the start of each candidate free source's raw reply, from the
// server, so parsers are written against what the APIs really return.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://gamma-api.polymarket.com/public-search?q=recession&limit_per_type=3',
  'https://api.manifold.markets/v0/search-markets?term=recession&limit=3',
  'https://api.elections.kalshi.com/trade-api/v2/events?limit=3&status=open&with_nested_markets=true',
  'https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json',
  'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv',
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Nvidia/daily/20260901/20261010',
  'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30',
  'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=nvidia&limit=3',
  'https://mastodon.social/api/v1/timelines/tag/stocks?limit=3',
  'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000',
  'https://api.alternative.me/fng/?limit=3',
  'https://lemmy.world/api/v3/search?q=nvidia&type_=Posts&limit=3',
  'https://old.reddit.com/r/stocks/new.json?limit=3',
  'https://api.reddit.com/r/stocks/new?limit=3',
  'https://www.reddit.com/r/stocks/new/.rss',
  'https://stooq.pl/q/d/l/?s=spy.us&i=d',
  'https://query2.finance.yahoo.com/v7/finance/options/SPY',
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA&region=US&lang=en-US',
  'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=4&dateb=&owner=include&count=10&output=atom',
  'https://efts.sec.gov/LATEST/search-index?q=%22artificial%20intelligence%22&forms=8-K',
  'https://api.gdeltproject.org/api/v2/doc/doc?query=nvidia&mode=artlist&maxrecords=3&format=json&timespan=1d',
  'https://www.federalreserve.gov/feeds/press_all.xml',
  'https://www.investing.com/rss/news_25.rss',
  'https://seekingalpha.com/api/sa/combined/NVDA.xml',
];
(async () => {
  for (const u of urls) {
    const t = Date.now();
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(20000) });
      const txt = (await r.text()).replace(/\s+/g, ' ');
      console.log(`--- ${r.status} ${Date.now() - t}ms ${u.slice(0, 90)}\n${txt.slice(0, 700)}`);
    } catch (e) { console.log(`--- ERR ${e.message} ${u.slice(0, 90)}`); }
  }
})();
