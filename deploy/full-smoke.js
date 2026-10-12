// One full desk run on live data with every Claude agent, in a scratch data
// directory (the owner's scenarios are untouched). Runs when deploy/FULL_SMOKE exists.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.SC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-smoke-'));
// Reuse the live cache so the run doesn't refetch everything.
const store = require('../lib/store');
const desk = require('../lib/desk');
(async () => {
  const t = Date.now();
  const sc = store.create({ ownerId: 'smoke', claim: 'The AI bubble bursts: Nvidia trails the S&P 500 over the next 6 months', facts: 'Nvidia trades at over 60 times earnings. Hyperscalers are cutting AI capex.' });
  const r = await desk.run(sc.id, { claude: true, emit: (e) => { if (e.event === 'progress') console.log(`   ${Math.round((Date.now() - t) / 1000)}s ${e.step.who}: ${e.step.text}`); } });
  const th = store.load(sc.id).thesis;
  console.log(`   THESIS: ${th.proposition} | target ${JSON.stringify(th.target)} | markets ${JSON.stringify(th.marketQueries)}`);
  console.log(`   RESULT: ${r.run.probability}% ${r.run.verdict} (pool ${r.run.ensemble}%), ${Math.round(r.run.durationMs / 1000)}s, $${r.run.costUsd}`);
  console.log(`   CALL: ${r.run.call}`);
  for (const a of r.run.analysts) console.log(`   - ${a.name}: lean ${a.stance.toFixed(2)} conf ${a.confidence.toFixed(2)}${a.probability !== undefined ? ` p ${(a.probability * 100).toFixed(0)}%` : ''} | ${a.headline.slice(0, 140)}`);
  console.log(`   ADVOCATES: ${r.run.advocates ? 'yes ' + r.run.advocates.yes.case.length + ' / no ' + r.run.advocates.no.case.length : 'none'}`);
  console.log(`   ERRORS: ${r.run.errors.join(' | ') || 'none'}`);
  fs.rmSync(process.env.SC_DATA_DIR, { recursive: true, force: true });
})().catch((e) => console.log(`   FAILED: ${e.stack || e.message}`));
