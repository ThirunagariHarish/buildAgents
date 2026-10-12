# Run Scenario

A research desk for market claims, at https://scenario.cashflowus.com.

You state a claim ("the market might crash by the end of 2026", "the AI bubble is bursting", "NVDA beats MSFT over 6 months"), optionally with your own facts. Then:

1. **Strategist** (Claude) turns it into a measurable proposition: an instrument, a target (drawdown, level, return, outperformance, or an event), a deadline, the macro series and crowd sources to watch, and a base rate.
2. **Analysts** each bring evidence and a lean, from −1 (against) to +1 (for), with a confidence:
   - **Quant**: 4,000-path block-bootstrap Monte Carlo of the instrument's own history, a historical base rate and, when installed, a Chronos-Bolt forecast.
   - **Technicals**: trend, momentum, RSI, MACD and the volatility regime.
   - **Macro**: FRED rules such as yield-curve inversion and un-inversion, the Sahm rule, credit spreads, VIX, claims and financial conditions.
   - **Sentiment**: StockTwits, Reddit, Hacker News, news headlines, GDELT tone and X (with a key), scored by FinBERT or a finance word list.
   - **Fundamentals**: SEC EDGAR revenue growth, margins and P/E.
   - **News & facts**: Claude with web search; it fact-checks each of your statements.
3. **Judge** (Claude, strongest model) argues both sides from the reports only and commits to one probability, a verdict and what would change it.

Every day after the US close the desk re-runs each scenario. The dashboard shows:

- the probability over time (Kalshi-style), plus a price-only model replay of the past 3 months;
- what changed since your last look;
- the analysts' cards and your facts, checked;
- both cases and upcoming catalysts;
- follow-up questions, which can become new scenarios in the same theme.

Price targets settle themselves when hit or when the deadline passes.

Research, not financial advice.

## Run locally

```
SC_DATA_DIR=./data SC_ADMIN_PASSWORD=... node server.js        # http://localhost:3402
node deploy/selftest.js                                         # offline test (synthetic data, fake Claude)
```

## Optional keys (GitHub secrets)

| Secret | What it adds |
| --- | --- |
| `SCENARIO_FRED_KEY` | FRED's official API instead of the public CSV |
| `SCENARIO_REDDIT_ID` / `SCENARIO_REDDIT_SECRET` | Reddit app-only OAuth (more reliable from servers) |
| `SCENARIO_X_BEARER` | X (Twitter) recent search (paid API) |
| `SCENARIO_STOOQ_KEY` | Stooq price fallback |
