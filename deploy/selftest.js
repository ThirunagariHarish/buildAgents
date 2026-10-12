// Offline test of the whole desk: synthetic prices and macro, a fake Claude.
// Run: node deploy/selftest.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'));
process.env.SC_DATA_DIR = path.join(tmp, 'data');
process.env.SC_FIXTURES = require('./fixtures').write(path.join(tmp, 'fx'));
process.env.SC_CLAUDE_BIN = path.join(__dirname, 'fake-claude.js');
process.env.SC_PYTHON = '/nonexistent';
fs.chmodSync(process.env.SC_CLAUDE_BIN, 0o755);

const quant = require('../lib/quant');
const sentiment = require('../lib/sentiment');
const macro = require('../lib/macro');
const { parseJson } = require('../lib/claude');
const store = require('../lib/store');
const desk = require('../lib/desk');
const { series } = require('./fixtures');

let n = 0;
const ok = (name) => { n++; console.log(`  ok ${name}`); };

(async () => {
  // Quant: a random walk's chance of a 20% drawdown rises with horizon and volatility.
  const calm = { ...series(11, 100, 0.07, 0.12), name: 'calm' };
  const wild = { ...series(12, 100, 0.07, 0.45), name: 'wild' };
  const t = { type: 'drawdown', value: 0.2 };
  const p = (s, H) => quant.simulate({ series: s, target: t, horizonDays: H, seed: 'a' }).probability;
  assert(p(calm, 60) < p(calm, 500), 'longer horizon, more drawdowns');
  assert(p(calm, 250) < p(wild, 250), 'more volatility, more drawdowns');
  assert(p(wild, 250) > 0.3 && p(calm, 20) < 0.1, `sane ranges ${p(wild, 250)} ${p(calm, 20)}`);
  assert.strictEqual(p(calm, 120), p(calm, 120), 'seeded: same inputs, same answer');
  ok('Monte Carlo drawdown behaves');
  const last = calm.close[calm.close.length - 1];
  const up = quant.simulate({ series: calm, target: { type: 'close', level: last * 0.5, direction: 'above' }, horizonDays: 60, seed: 'b' }).probability;
  assert(up > 0.97, 'far-below level: nearly certain to be above');
  const out = quant.simulate({ series: wild, vsSeries: calm, target: { type: 'outperform', vs: 'calm', value: 0 }, horizonDays: 120, seed: 'c' }).probability;
  assert(out > 0.2 && out < 0.8, `outperform near a coin flip ${out}`);
  const under = quant.simulate({ series: wild, vsSeries: calm, target: { type: 'outperform', vs: 'calm', value: 0, direction: 'below' }, horizonDays: 120, seed: 'c' }).probability;
  assert(Math.abs(out + under - 1) < 0.01, `beat + trail = 1 (${out} + ${under})`);
  assert.strictEqual(desk.normalizeThesis({ direction: 'down', primary: 'NVDA', target: { type: 'outperform', vs: 'SPY', value: 0 } }).target.direction, 'below', 'underperform claim points down');
  ok('close and outperform targets');
  const ind = quant.indicators(calm);
  assert(ind.rsi14 > 0 && ind.rsi14 < 100 && ind.sma200 > 0 && ind.vol1y > 0.05 && ind.vol1y < 0.25, 'indicators');
  const hist = quant.historicalRate({ series: wild, target: t, horizonDays: 120 });
  assert(hist && hist.rate > 0 && hist.rate < 1, 'historical rate');
  ok('indicators and base rate');

  assert(sentiment.lexScore('Earnings beat, stock surges to record') > 0.3);
  assert(sentiment.lexScore('Shares plunge after guidance cut, recession fears') < -0.3);
  assert(sentiment.lexScore('not bullish at all') < 0);
  ok('sentiment word list');
  assert.deepStrictEqual(parseJson('Sure! ```json\n{"a": "b}", "c": [1]}\n``` done'), { a: 'b}', c: [1] });
  ok('JSON extraction');
  const th = desk.normalizeThesis({ title: 'x', proposition: 'p', resolution: 'r', horizonDate: '2027-01-01', primary: 'spy', target: { type: 'drawdown', value: 25 }, direction: 'down' });
  assert.strictEqual(th.target.value, 0.25); assert.strictEqual(th.primary, 'SPY');
  assert.strictEqual(desk.normalizeThesis({ target: { type: 'touch' } }).target.type, 'none', 'touch without level is not measurable');
  ok('thesis normalization');

  // The whole desk, twice (the second run diffs against the first).
  const events = [];
  const sc = store.create({ ownerId: 'u1', claim: 'Market might crash by the end of 2026', facts: 'Unemployment is rising fast.' });
  const r1 = await desk.run(sc.id, { emit: (e) => events.push(e) });
  assert(r1.run.probability >= 1 && r1.run.probability <= 99, 'probability');
  const ids = r1.run.analysts.map((a) => a.id);
  for (const id of ['quant', 'technical', 'macro', 'sentiment', 'research']) assert(ids.includes(id), `analyst ${id} (${ids.join(',')}) errors: ${r1.run.errors.join('; ')}`);
  assert(r1.sc.backfill.length > 10, 'backfill');
  assert(events.some((e) => e.event === 'progress' && e.step.who === 'Judge'), 'progress events');
  ok(`desk run 1: ${r1.run.probability}% ${r1.run.verdict}, desk consensus ${r1.run.ensemble}%, quant ${(r1.run.analysts[0].probability * 100).toFixed(1)}%`);
  const r2 = await desk.run(sc.id, {});
  assert.strictEqual(store.load(sc.id).history.length, 1, 'same day replaces the point');
  assert(Array.isArray(r2.run.changes));
  ok('desk run 2 replaces today\'s point and diffs');

  const sc2 = store.create({ ownerId: 'u1', claim: 'AI bubble is bursting, semis down 30%', facts: 'Nvidia trades at 60x earnings.' });
  const r3 = await desk.run(sc2.id, {});
  assert(r3.run.analysts.find((a) => a.id === 'fundamentals'), 'fundamentals from NVDA, the first company among the instruments');
  ok(`AI scenario: ${r3.run.probability}%`);

  // Settlement: a drawdown that already happened resolves YES.
  const s = store.load(sc.id);
  s.createdAt = Date.now() - 400 * 86400000;
  const crash = { ...calm, close: calm.close.map((x, i) => (i > calm.close.length - 30 ? x * 0.6 : x)) };
  const st = desk.settle(s, { ...s.thesis, primary: 'X', target: { type: 'drawdown', value: 0.2 } }, { prices: { X: crash } });
  assert(st && st.outcome === 'yes', 'settles yes');
  ok('settlement');

  const m = macro.read([{ id: 'T10Y2Y', name: 'c', points: [[new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10), -0.5], [new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10), 0.1], [new Date().toISOString().slice(0, 10), 0.3]] }]);
  assert(m.risk > 0, 'un-inverted curve reads risk-off');
  ok('macro rules');
  console.log(`selftest: ${n} passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(`selftest FAILED: ${e.stack || e.message}`); process.exit(1); });
