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

  assert(r1.run.analysts.find((a) => a.id === 'options' && a.probability !== undefined), `options analyst reads the chain (${r1.run.errors.join('; ')})`);
  assert(r1.run.analysts.find((a) => a.id === 'markets'), 'prediction markets card');
  assert(r1.run.analysts.find((a) => a.id === 'social'), 'social pulse (Claude)');
  assert(r1.run.advocates && r1.run.advocates.yes.case.length, 'advocates ran');
  ok(`new sources: options ${(r1.run.analysts.find((a) => a.id === 'options').probability * 100).toFixed(0)}%, markets, social, advocates`);

  const lad = r1.run.analysts.find((a) => a.id === 'quant').ladder;
  assert(lad && lad.length >= 5 && lad.some((x) => x.claimed), 'odds ladder includes the claimed level');
  assert(lad.filter((x) => /Falls/.test(x.label)).every((x, i, a) => i === 0 || x.p <= a[i - 1].p + 0.5), 'bigger falls are less likely');
  ok(`odds ladder: ${lad.map((x) => `${x.label} ${x.p}%`).join(', ')}`);
  const r5 = await desk.run(sc.id, { depth: 'standard' });
  assert(!r5.run.analysts.some((a) => a.id === 'social') && !r5.run.advocates && r5.run.analysts.some((a) => a.id === 'research'), 'standard: research + judge only');
  const r6 = await desk.run(sc.id, { depth: 'quick' });
  assert(!r6.run.claude && r6.run.costUsd === 0, 'quick: no Claude');
  ok('depth: standard and quick');

  // Insights: today, record.
  const insights = require('../lib/insights');
  const tv = insights.today(store.list(), 'u1');
  assert(tv.total >= 2 && Array.isArray(tv.catalysts), 'today view');
  const fake = { ...store.load(sc.id), status: 'resolved', resolved: { outcome: 'no' }, history: [{ date: '2026-01-01', p: 20 }, { date: '2026-01-02', p: 10 }, { date: '2026-01-03', p: 1 }], myCalls: [{ date: '2026-01-01', p: 60 }] };
  const rec = insights.record([fake]);
  assert(Math.abs(rec.brier - (0.04 + 0.01) / 2) < 1e-9 && Math.abs(rec.myBrier - 0.36) < 1e-9, `brier ${rec.brier} ${rec.myBrier}`);
  ok(`track record: desk Brier ${rec.brier.toFixed(3)}, yours ${rec.myBrier.toFixed(2)}`);

  // Reading room: articles sorted for and against, with marks per person.
  const reading = require('../lib/reading');
  const rv = reading.view(sc.id, 'u1');
  const all = rv.days.flatMap((x) => x.items);
  assert(all.length >= 3 && all.some((x) => x.stance === 'for') && all.some((x) => x.stance === 'against'), `reading room sorted (${all.map((x) => x.stance).join(',')})`);
  assert(reading.mark(sc.id, 'u1', all[0].key, { read: true, saved: true }) && reading.view(sc.id, 'u1').saved.length === 1, 'mark read and save');
  assert(reading.unreadCount(sc.id, 'u1') === all.length - 1, 'unread count');
  ok(`reading room: ${all.length} articles (${all.filter((x) => x.stance === 'for').length} for, ${all.filter((x) => x.stance === 'against').length} against)`);

  // Voice: rules turn speech into Builder fields.
  const voice = require('../lib/voice');
  const v1 = voice.parseBuild('The S&P 500 crashes by the end of the year');
  assert(v1.symbol === 'SPY' && v1.move === 'drawdown' && v1.value === 20, JSON.stringify(v1));
  const v2 = voice.parseBuild('QQQ beats SPY by 5 percent by December 2027');
  assert(v2.move === 'beat' && v2.vs === 'SPY' && v2.value === 5 && v2.date === '2027-12-31', JSON.stringify(v2));
  const v3 = voice.parseBuild('Bitcoin hits 150000 in 6 months');
  assert(v3.symbol === 'BTC-USD' && v3.move === 'touchAbove' && v3.value === 150000, JSON.stringify(v3));
  ok('voice: spoken claims fill the builder');
  const tech = r1.run.analysts.find((a) => a.id === 'technical');
  assert(tech.chart && tech.chart.close.length > 200 && tech.sheet.bollinger && tech.sheet.seasonality.length === 12, 'technical chart and sheet');
  const qa = r1.run.analysts.find((a) => a.id === 'quant');
  assert(qa.fan && qa.fan.points.length === 24 && qa.fan.hist.length > 5 && Math.abs(qa.fan.hist.reduce((x, b) => x + b.share, 0) - 1) < 1e-6, 'quant fan and histogram');
  ok('agent pages: price chart, sheet, fan, histogram');

  // The free desk: a builder scenario run without Claude.
  const th2 = desk.buildThesis({ symbol: 'SPY', move: 'drawdown', value: 15, date: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) });
  const sc3 = store.create({ ownerId: 'u2', claim: th2.proposition }); store.patch(sc3.id, { thesis: th2 });
  const r4 = await desk.run(sc3.id, { claude: false });
  assert(!r4.run.claude && r4.run.costUsd === 0 && r4.run.judge.call.includes('%'), 'free desk pools without Claude');
  assert(!r4.run.analysts.some((a) => ['research', 'social'].includes(a.id)), 'no Claude analysts on the free desk');
  assert(reading.view(sc3.id, 'u2').days.flatMap((x) => x.items).every((x) => x.by === 'auto'), 'free desk sorts articles automatically');
  ok(`free desk: ${r4.run.probability}% ${r4.run.verdict}, no Claude`);
  const sc4 = store.create({ ownerId: 'u2', claim: 'free text claim' });
  await assert.rejects(desk.run(sc4.id, { claude: false }), /builder/);
  ok('free text without Claude asks for the builder');

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
