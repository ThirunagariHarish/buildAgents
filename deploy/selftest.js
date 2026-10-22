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

  // Sourcing on demand.
  studio.enqueue({ type: 'sourcing', invId: invs[0].id });
  await idle();
  const s = store.findInvention(invs[0].id).inv.sourcing;
  assert(s && s.status === 'ready' && s.report.unitCost.at10k.total === 0.52 && s.report.clusters.length === 2 && s.report.suppliers[0].url, JSON.stringify(s).slice(0, 300));
  ok(`sourcing: ${s.report.unitCost.at10k.total} a unit at 10k, retail ${s.report.pricing.retail}, ${s.report.clusters.map((c) => c.place).join(' & ')}`);

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
