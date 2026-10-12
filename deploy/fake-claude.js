#!/usr/bin/env node
// A stand-in for `claude -p` in tests: answers each desk role with plausible
// JSON in the CLI's stream-json format.
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const sys = process.argv[process.argv.indexOf('--append-system-prompt') + 1] || '';
  let out;
  if (/strategist/.test(sys)) {
    const ai = /\bAI\b|semis|NVDA|Nvidia/.test(input.split("FACTS")[0]);
    out = ai
      ? { title: 'AI bubble bursts: semis fall 30%', proposition: 'The semiconductor ETF SMH falls at least 30% from its 52-week high within 6 months.', resolution: 'Resolves YES if SMH closes 30% or more below its highest close of the prior 52 weeks on any day before the deadline; NO otherwise.', horizonDate: new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10), kind: 'market', direction: 'down', primary: 'SMH', target: { type: 'drawdown', value: 0.3 }, instruments: [{ symbol: 'SMH', why: 'Semis' }, { symbol: 'NVDA', why: 'Leader' }, { symbol: 'QQQ', why: 'Tech' }], macro: ['T10Y2Y', 'VIXCLS', 'BAMLH0A0HYM2'], newsQuery: 'AI bubble semiconductors', keywords: ['AI bubble'], subreddits: ['stocks', 'investing'], cashtags: ['SMH', 'NVDA'], tech: true, userFacts: ['Nvidia trades at 60 times earnings', 'Hyperscalers are cutting AI capex'], baseRate: { p: 0.12, why: 'Semis fell 30%+ within 6 months in roughly 1 of 8 windows since 2000.' }, assumptions: ['"Bursting" read as a 30% fall in semis.'], followUps: ['NVDA underperforms the S&P 500 over 6 months'] }
      : { title: 'S&P 500 bear market by end of 2026', proposition: 'The S&P 500 falls 20% from its 52-week high before 2026-12-31.', resolution: 'Resolves YES if SPY closes 20% below its 52-week high on any day before 2026-12-31.', horizonDate: '2026-12-31', kind: 'market', direction: 'down', primary: 'SPY', target: { type: 'drawdown', value: 20 }, instruments: [{ symbol: 'SPY', why: 'S&P 500' }, { symbol: 'TLT', why: 'Bonds' }], macro: ['T10Y2Y', 'VIXCLS', 'BAMLH0A0HYM2', 'UNRATE', 'NFCI', 'ICSA', 'FEDFUNDS'], newsQuery: 'stock market crash', keywords: ['market crash'], subreddits: ['stocks'], cashtags: ['SPY'], tech: false, userFacts: ['Unemployment is rising fast'], baseRate: { p: 0.06, why: 'A 20% drawdown within ~3 months is rare outside recessions.' }, assumptions: ['Crash = 20% drawdown.'], followUps: ['The Fed cuts rates in December 2026'] };
  } else if (/research analyst/.test(sys)) {
    out = { stance: -0.2, confidence: 0.5, headline: 'Recent news leans against an imminent collapse, with real valuation risk.', evidence: [{ text: 'Q3 earnings growth came in at 9% year over year for the S&P 500.', for: false, source: 'FactSet', url: 'https://example.com/factset', date: '2026-10-09' }, { text: 'Forward P/E of 23 is in the top decile historically.', for: true, source: 'Reuters', url: 'https://example.com/reuters', date: '2026-10-08' }], factChecks: [{ claim: 'Unemployment is rising fast', verdict: 'partly', detail: 'Up 0.4 pts in 6 months to 4.3%; rising but not fast by historical standards.', source: 'BLS', url: 'https://www.bls.gov/' }], catalysts: [{ date: '2026-11-04', event: 'FOMC decision', why: 'A cut or hold sets the tone into year end.' }] };
  } else if (/judge/.test(sys)) {
    out = { probability: 14, verdict: 'Unlikely', call: 'A 20% fall before year end is unlikely: trend, credit and earnings don\'t show stress yet.', trend: 'steady', confidence: 'medium', bull: ['Valuations are stretched'], bear: ['Credit spreads are tight', 'Uptrend intact'], corrections: ['Unemployment is rising, but slowly.'], supports: ['Valuations are indeed high.'], watch: [{ signal: 'High-yield spread', threshold: 'above 4.5%', why: 'Credit leads equities.' }], changed: 'first run', summary: 'The numbers alone put it near 10%. Nothing in the news changes that much.' };
  } else if (/daily trends briefing/.test(sys)) {
    out = { trends: [
      { title: 'Bitcoin pushes toward record on ETF demand', category: 'Crypto', summary: 'Bitcoin rose 4% this week to $82,400 as spot ETFs took in $1.2B.', why: 'Crypto flows are a read on risk appetite.', bull: 'Steady ETF inflows absorb supply.', bear: 'Funding rates are stretched.', tickers: ['BTC-USD'], claim: 'Bitcoin trades above $100,000 by year end', build: { symbol: 'BTC-USD', move: 'touchAbove', value: 100000, vs: '', date: '2026-12-31' }, sources: [{ title: 'Reuters', url: 'https://example.com/r' }] },
      { title: 'Fed cut odds slip after hot jobs data', category: 'Rates', summary: 'Markets now price a 1% chance of an October cut.', why: 'Rates drive valuations.', bull: 'Inflation keeps cooling.', bear: 'Jobs stay strong.', tickers: ['^TNX'], claim: 'The 10-year yield trades above 5.5% within 3 months', build: { symbol: '^TNX', move: 'touchAbove', value: 5.5, vs: '', date: '2027-01-12' }, sources: [] },
    ] };
  } else if (/testable market claims/.test(sys)) {
    out = { claims: [{ claim: 'Bitcoin trades above $150,000 by the end of 2026', lean: 'bullish', category: 'Crypto', posts: [1, 3], why: 'ETF inflows and a weaker dollar', build: { symbol: 'BTC-USD', move: 'touchAbove', value: 150000, vs: '', date: '2026-12-31' } }, { claim: 'The S&P 500 enters a correction before year end', lean: 'bearish', category: 'Market', posts: [2], why: 'Valuations and rising yields', build: { symbol: 'SPY', move: 'drawdown', value: 10, vs: '', date: '2026-12-31' } }] };
  } else if (/spoken requests/.test(sys)) {
    out = { symbol: 'NVDA', move: 'drawdown', value: 30, vs: '', date: '2027-06-30' };
  } else if (/dictated speech/.test(sys)) {
    out = { claim: 'Nvidia falls 30% by June 2027.', facts: 'Valuations are stretched.\nCapex is slowing.' };
  } else if (/sort financial news/.test(sys)) {
    const n = (input.match(/^\d+\. /gm) || []).length;
    out = { items: Array.from({ length: n }, (_, k) => ({ i: k + 1, stance: ['for', 'against', 'context'][k % 3], why: 'Test reason for the sort.' })) };
  } else if (/social-media analyst/.test(sys)) {
    out = { stance: 0.1, confidence: 0.3, headline: 'Retail on X is nervous about valuations; fund managers mostly stay long.', narratives: ['Bubble talk is rising on X', 'Dip buyers remain active on Reddit'], posts: [{ text: 'This feels like 1999', who: '@someone', url: 'https://x.com/someone/status/1', lean: 'for', date: '2026-10-11' }] };
  } else if (/advocate/.test(sys)) {
    out = { case: [/bull/.test(sys) ? 'Valuations at 23x forward are in the top decile' : 'Credit spreads at 3.2% show no stress'], weakest: 'Timing is uncertain' };
  } else {
    out = { answer: 'In 2000–2002 the semiconductor index fell about 80% peak to trough.\n- It took 15 years to recover.', sources: [{ title: 'Example', url: 'https://example.com/x' }], track: 'SMH falls 50% from its high within 12 months' };
  }
  const text = JSON.stringify(out);
  process.stdout.write(`${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'test search' } }] } })}\n`);
  setTimeout(() => process.stdout.write(`${JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.01, is_error: false })}\n`), 300);
});
