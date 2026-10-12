// Deploy smoke test on live data, without Claude: SPY's indicators, the
// Monte Carlo for a 20% drawdown by year end, and the Hugging Face models.
const data = require('../lib/data');
const quant = require('../lib/quant');
const models = require('../lib/models');
(async () => {
  const s = await data.prices('SPY');
  const i = quant.indicators(s);
  console.log(`   SPY ${i.last.toFixed(2)} on ${i.asOf} (${s.source}): ${quant.pct(i.fromHigh)} from high, RSI ${i.rsi14.toFixed(0)}, vol ${quant.pct(i.vol20, 0)}`);
  const end = `${new Date().getUTCFullYear()}-12-31`;
  const sim = quant.simulate({ series: s, target: { type: 'drawdown', value: 0.2 }, horizonDays: quant.tradingDaysUntil(end), seed: 'smoke' });
  console.log(`   Monte Carlo: P(SPY falls 20% from its high by ${end}) = ${(sim.probability * 100).toFixed(1)}%`);
  const pl = await require('../lib/insights').pulse();
  console.log(`   Markets tab: ${pl.quotes.map((q) => `${q.symbol} ${q.last.toFixed(2)}`).join(', ')}; Fear & Greed ${pl.fearGreed ? Math.round(pl.fearGreed.score) : 'n/a'}; curve ${pl.curve ? pl.curve.spread : 'n/a'}; ${pl.markets.length} prediction markets`);
  const rd = require('../lib/reading');
  const [gn, tn] = await Promise.all([data.googleNews('stock market crash'), require('../lib/free').tickerNews('SPY')]);
  const cands = rd.candidates({ social: { news: gn, tickerNews: [tn] } }, [], { direction: 'down' });
  const sorted = await rd.sortAuto({ proposition: 'The S&P 500 falls 20%', direction: 'down', primary: 'SPY', keywords: ['stock market crash'], newsQuery: 'stock market crash' }, cands.slice(0, 30));
  const n = (st) => sorted.filter((x) => x.stance === st).length;
  console.log(`   Reading room (auto-sort, live news): ${cands.length} articles; ${n('for')} support, ${n('against')} against, ${n('context')} context, ${n('skip')} off-topic`);
  for (const x of sorted.filter((y) => y.stance !== 'skip').slice(0, 3)) console.log(`     ${x.stance.padEnd(8)} ${x.title.slice(0, 90)} (${x.source})`);
  if (await models.available()) {
    const t = Date.now();
    const f = await models.call('forecast', { series: [s.close.slice(-512)], horizon: 20 });
    const q = f.forecasts[0];
    console.log(`   Chronos-Bolt 20-day: median ${q.final[3].toFixed(2)}, 80% band ${q.final[1].toFixed(2)}–${q.final[5].toFixed(2)} (${Math.round((Date.now() - t) / 1000)}s)`);
    const st = await models.call('sentiment', { texts: ['Shares surge after record earnings beat', 'Company warns of layoffs as demand collapses'] });
    console.log(`   FinBERT: ${st.scores.join(', ')} (expect +, -)`);
  } else console.log('   models: not ready yet');
})().catch((e) => console.log(`   FAILED: ${e.message}`));
