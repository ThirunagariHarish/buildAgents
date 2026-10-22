// Offline test of the studio: a fake Claude, no photos, a scratch data folder.
// Run: node deploy/selftest.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-test-'));
process.env.RV_DATA_DIR = path.join(tmp, 'data');
process.env.RV_CLAUDE_BIN = path.join(__dirname, 'fake-claude.js');
process.env.RV_NO_PHOTOS = '1';
process.env.RV_SCHEDULE = '0';
fs.chmodSync(process.env.RV_CLAUDE_BIN, 0o755);

const store = require('../lib/store');
const studio = require('../lib/studio');
const media = require('../lib/media');
const events = [];
studio.setEmitter((e) => events.push(e));
const idle = async (ms = 20000) => { const t = Date.now(); await new Promise((r) => setTimeout(r, 50)); while (studio.isBusy()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)); } };
let n = 0;
const ok = (m) => { n++; console.log(`  ok ${m}`); };

(async () => {
  // The SVG cleaner keeps drawings and drops anything active.
  const dirty = '<svg onload="x()"><script>alert(1)</script><rect width="5" height="5" fill="url(#g)"/><image href="https://e/x.png"/><a href="javascript:x"><circle r="2"/></a><use href="https://e"/><text x="1">ok</text></svg>';
  const clean = media.cleanSvg(dirty);
  assert(clean && !/script|onload|image|javascript|https:\/\/e/.test(clean) && /<rect/.test(clean) && /xmlns=/.test(clean), clean);
  assert.strictEqual(media.cleanSvg('<div>no svg</div>'), null);
  ok('SVG sketches are cleaned');

  // A full cycle: the Scout, then three inventors in turn.
  studio.enqueue({ type: 'cycle' });
  await idle();
  const posts = store.listPosts();
  assert.strictEqual(posts.length, 1);
  const p = posts[0];
  assert(p.product && p.product.name === 'Measuring spoons' && p.product.pains.length === 3, JSON.stringify(p.product).slice(0, 200));
  assert(p.status === 'ready' && p.rounds.length === 1 && p.rounds[0].inventions.length === 3);
  const invs = p.rounds[0].inventions;
  assert.deepStrictEqual(invs.map((i) => i.agent), ['engineer', 'designer', 'futurist']);
  assert.strictEqual(new Set(invs.map((i) => i.title)).size, 3, 'three different designs');
  for (const i of invs) {
    assert(i.sketch, `${i.title} has a sketch`);
    const svg = fs.readFileSync(store.mediaPath(i.sketch), 'utf8');
    assert(!/<script/i.test(svg), 'no scripts in stored sketches');
  }
  assert(p.sketch, 'the original gets a fallback drawing');
  assert(events.some((e) => e.event === 'live' && e.live && /Scout/.test(e.live.label)) && events.some((e) => e.event === 'live' && e.live && /Kenji/.test(e.live.label)), 'live status names who is working');
  ok(`cycle: ${p.product.name} → ${invs.map((i) => i.title).join(' / ')}`);
  assert(invs[0].problem && invs[0].fix && invs[0].lever === 'mechanism' && invs[1].lever === 'interaction' && invs[0].feasibility.score === 8, 'problem, fix, lever and feasibility kept');
  assert(invs[0].whyBetter[1].basis === 'sourced' && invs[0].whyBetter[0].basis === 'estimate', 'metrics say whether they are sourced');
  assert(p.rounds[0].review && p.rounds[0].review.redid === 'futurist' && invs[2].redoOf, 'the reviewer sends a repeat back once');
  ok('reviewer: a design too close to a colleague is redone once');

  // Sourcing on demand.
  studio.enqueue({ type: 'sourcing', invId: invs[0].id });
  await idle();
  const s = store.findInvention(invs[0].id).inv.sourcing;
  assert(s && s.status === 'ready' && s.report.unitCost.at10k.total === 0.52 && s.report.clusters.length === 2 && s.report.suppliers[0].url, JSON.stringify(s).slice(0, 300));
  ok(`sourcing: ${s.report.unitCost.at10k.total} a unit at 10k, retail ${s.report.pricing.retail}, ${s.report.clusters.map((c) => c.place).join(' & ')}`);
  const o = s.report.opportunity;
  assert(o && o.score >= 7.3 && o.score <= 7.4 && Object.keys(o.parts).length === 5 && o.weights.demand === 0.3, JSON.stringify(o));
  assert(s.report.route.recommended === 'ODM' && s.report.rfq.zh && s.report.rfq.screening.length && s.report.suppliers[0].type === 'factory' && s.report.landed.hts === '3924.10.40' && s.report.landed.dutyAsOf, 'route, RFQ, supplier type and duty date');
  ok(`make it: opportunity ${o.score}/10, ${s.report.route.recommended}, RFQ in English and Chinese`);

  // Chat, with a suggested direction pulled out of the reply.
  await studio.chat(p.id, 'u1', 'Which one works in a spice jar?');
  const t0 = Date.now();
  while (studio.isChatting(p.id, 'u1') && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
  const msgs = store.chat(p.id, 'u1');
  assert(msgs.length === 2 && msgs[1].role === 'assistant' && /spice jar/.test(msgs[1].suggest) && !/SUGGEST_ROUND/.test(msgs[1].text), JSON.stringify(msgs));
  ok('chat answers and suggests a direction');

  // A new round from feedback keeps the first.
  studio.enqueue({ type: 'round', postId: p.id, feedback: msgs[1].suggest, userId: 'u1' });
  await idle();
  const p2 = store.loadPost(p.id);
  assert(p2.rounds.length === 2 && p2.rounds[1].by === 'feedback' && p2.rounds[1].inventions.length === 3 && p2.rounds[1].feedback);
  ok('feedback round adds a second set of three');

  // Saves.
  store.setSaved('u1', p.id, invs[1].id, true);
  assert.strictEqual(store.saves('u1')[0].invId, invs[1].id);
  store.setSaved('u1', p.id, invs[1].id, false);
  assert.strictEqual(store.saves('u1').length, 0);
  ok('save and unsave');

  // Demand: "I'd buy this" with a price, and "Whose fix wins?".
  store.setBuy('u1', invs[0].id, 12); store.setBuy('u2', invs[0].id, 16); store.setBuy('u3', invs[0].id, 0);
  let d = store.demand(invs[0].id, 'u2');
  assert(d.count === 3 && d.median === 14 && d.mine === 16, JSON.stringify(d));
  store.setBuy('u2', invs[0].id, null);
  assert.strictEqual(store.demand(invs[0].id).count, 2);
  store.setPick('u1', p.id, invs[1].id); store.setPick('u2', p.id, invs[1].id); store.setPick('u3', p.id, invs[0].id);
  const pk = store.picks(p.id, 'u3');
  assert(pk.total === 3 && pk.counts[invs[1].id] === 2 && pk.mine === invs[0].id, JSON.stringify(pk));
  ok('demand: buy intent with a median price, and picks per product');

  // A restart mid-job leaves nothing stuck.
  const stuck = store.createPost({ status: 'researching' });
  store.patchPost(p.id, { status: 'inventing' });
  const fixed = studio.recover();
  assert(fixed === 2 && !store.loadPost(stuck.id) && store.loadPost(p.id).status === 'ready', `recover fixed ${fixed}`);
  ok('restart: half-made posts are tidied');

  // The schedule respects the interval and pauses.
  store.setSettings({ lastRunAt: Date.now(), paused: false, intervalMin: 30 });
  assert(!studio.due());
  store.setSettings({ lastRunAt: Date.now() - 31 * 60 * 1000 });
  assert(studio.due());
  store.setSettings({ paused: true });
  assert(!studio.due());
  ok('schedule: every 30 minutes, pausable');

  console.log(`selftest: ${n} passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('selftest FAILED:', e); process.exit(1); });
