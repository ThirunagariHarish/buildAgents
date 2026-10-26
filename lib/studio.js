// The studio: one job at a time on the owner's Claude login.
//   cycle    — the Scout picks and researches a product, then the three
//              inventors reinvent it in turn (every 30 minutes by default)
//   round    — the inventors reinvent a product again, with the owner's feedback
//   sourcing — the China manufacturing and economics report for one reinvention
// Chat replies run outside the queue so they stay quick.

const store = require('./store');
const media = require('./media');
const A = require('./agents');
const { askJson, askClaude } = require('./claude');
const render = require('./render');
const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');
// While a job runs this file exists, so a deploy can wait for it instead of cutting it off.
const BUSY_FILE = path.join(DATA, '.busy');
const markBusy = (job) => { try { if (job) fs.writeFileSync(BUSY_FILE, `${job.type} ${new Date().toISOString()}`); else fs.rmSync(BUSY_FILE, { force: true }); } catch {} };

let emit = () => {};
const queue = [];
let current = null; // { type, postId, invId, label, agent, since, activity }
const today = () => new Date().toISOString().slice(0, 10);
/** What an agent actually did, shown as a receipt next to its work. */
const workOf = (r) => ({ searches: r.searches || 0, pages: r.pages || 0, minutes: Math.max(1, Math.round((r.durationMs || 0) / 60000)) });

// ---- cleaning what the agents return ----------------------------------------------------
const str = (v, n = 600) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const para = (v, n = 2000) => String(v == null ? '' : v).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const url = (u) => (/^https?:\/\/[^\s"<>]{3,600}$/.test(String(u || '')) ? String(u) : null);
const list = (v, n, f) => (Array.isArray(v) ? v : []).slice(0, n).map(f).filter((x) => x && (typeof x !== 'object' || Object.values(x).some(Boolean)));
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
const sources = (v) => list(v, 12, (s) => (url(s && s.url) ? { title: str(s.title, 140) || new URL(s.url).hostname, url: s.url } : null));

function cleanDossier(j) {
  return {
    name: str(j.name, 80), category: str(j.category, 60), oneLiner: str(j.oneLiner, 300), howItWorks: para(j.howItWorks, 1200),
    parts: list(j.parts, 12, (x) => str(x, 80)), materials: list(j.materials, 10, (x) => str(x, 80)), manufacturing: para(j.manufacturing, 800),
    priceRange: str(j.priceRange, 80), brands: list(j.brands, 10, (x) => str(x, 60)), market: str(j.market, 300),
    pains: list(j.pains, 8, (p) => ({ pain: str(p && p.pain, 200), evidence: str(p && p.evidence, 300), url: url(p && p.url) })).filter((p) => p.pain),
    currentBest: list(j.currentBest, 4, (c) => ({ name: str(c && c.name, 120), year: num(c && c.year), price: str(c && c.price, 40), url: url(c && c.url), whatsNew: str(c && c.whatsNew, 300) })).filter((c) => c.name),
    baseline: para(j.baseline, 900),
    priorArt: list(j.priorArt, 10, (p) => ({ name: str(p && p.name, 120), what: str(p && p.what, 300), url: url(p && p.url) })).filter((p) => p.name),
    constraints: list(j.constraints, 8, (x) => str(x, 160)), imageQuery: str(j.imageQuery, 60), imagePages: list(j.imagePages, 4, url),
    sources: sources(j.sources),
  };
}
function cleanInvention(j, agentId) {
  return {
    id: store.id(), agent: agentId, at: Date.now(),
    title: str(j.title, 80) || 'Untitled', tagline: str(j.tagline, 220), insight: para(j.insight, 600),
    problem: str(j.problem, 60), fix: str(j.fix, 70), lever: str(j.lever, 30).toLowerCase(), principle: str(j.principle, 160),
    ruledOut: list(j.ruledOut, 4, (x) => str(x, 200)),
    feasibility: j.feasibility && num(j.feasibility.score) ? { score: Math.max(1, Math.min(10, Math.round(num(j.feasibility.score)))), why: str(j.feasibility.why, 300) } : null,
    patentQuery: str(j.patentQuery, 120), renderPrompt: str(j.renderPrompt, 900),
    considered: list(j.considered, 4, (x) => str(x, 300)), changes: list(j.changes, 6, (x) => str(x, 240)), howItWorks: para(j.howItWorks, 2000),
    whyBetter: list(j.whyBetter, 6, (w) => ({ claim: str(w && w.claim, 200), metric: str(w && w.metric, 120), basis: /^sourced/i.test(str(w && w.basis, 20)) && url(w && w.url) ? 'sourced' : 'estimate', url: url(w && w.url) })).filter((w) => w.claim),
    materials: para(j.materials, 600), manufacturing: para(j.manufacturing, 900), targetCustomer: para(j.targetCustomer, 400),
    priceHint: str(j.priceHint, 80), unitCostHint: str(j.unitCostHint, 160),
    novelty: { closest: list(j.novelty && j.novelty.closest, 5, (c) => ({ name: str(c && c.name, 120), url: url(c && c.url), how: str(c && c.how, 300) })).filter((c) => c.name), verdict: para(j.novelty && j.novelty.verdict, 500) },
    risks: list(j.risks, 5, (x) => str(x, 240)), sketch: media.saveSvg(j.sketchSvg), sources: sources(j.sources), sourcing: null,
  };
}
// The opportunity score shows its working: five 1-10 sub-scores and fixed weights.
const OPPORTUNITY_WEIGHTS = { demand: 0.3, margin: 0.25, competition: 0.15, manufacturability: 0.15, ipRisk: 0.15 };
function cleanOpportunity(o) {
  if (!o || typeof o !== 'object') return null;
  const parts = {};
  for (const k of Object.keys(OPPORTUNITY_WEIGHTS)) { const v = num(o[k]); if (v) parts[k] = { score: Math.max(1, Math.min(10, Math.round(v))), why: str(o.why && o.why[k], 240) }; }
  if (Object.keys(parts).length < 3) return null;
  let total = 0, weight = 0;
  for (const [k, w] of Object.entries(OPPORTUNITY_WEIGHTS)) if (parts[k]) { total += parts[k].score * w; weight += w; }
  return { score: Math.round((total / weight) * 10) / 10, parts, weights: OPPORTUNITY_WEIGHTS };
}
function cleanSourcing(j) {
  const cost = (c = {}) => ({ total: num(c.total), materials: num(c.materials), processing: num(c.processing), packaging: num(c.packaging), toolingPerUnit: num(c.toolingPerUnit) });
  return {
    summary: para(j.summary, 600), productionRoute: list(j.productionRoute, 12, (x) => str(x, 240)),
    bom: list(j.bom, 15, (b) => ({ part: str(b && b.part, 80), material: str(b && b.material, 80), process: str(b && b.process, 80), unitCost: num(b && b.unitCost) })).filter((b) => b.part),
    unitCost: { at1k: cost(j.unitCost && j.unitCost.at1k), at10k: cost(j.unitCost && j.unitCost.at10k) },
    oneTime: list(j.oneTime, 8, (o) => ({ item: str(o && o.item, 140), cost: num(o && o.cost) })).filter((o) => o.item),
    landed: { freightPerUnit: num(j.landed && j.landed.freightPerUnit), hts: str(j.landed && j.landed.hts, 30), dutyRate: str(j.landed && j.landed.dutyRate, 120), dutyAsOf: str(j.landed && j.landed.dutyAsOf, 20), landedAt10k: num(j.landed && j.landed.landedAt10k) },
    samples: j.samples ? { costPerSample: num(j.samples.costPerSample), rounds: num(j.samples.rounds), note: str(j.samples.note, 300) } : null,
    toolingRange: j.toolingRange ? { low: num(j.toolingRange.low), high: num(j.toolingRange.high), note: str(j.toolingRange.note, 300) } : null,
    route: j.route ? { recommended: /odm/i.test(str(j.route.recommended, 10)) ? 'ODM' : /oem/i.test(str(j.route.recommended, 10)) ? 'OEM' : '', why: str(j.route.why, 400), closestOdm: j.route.closestOdm && str(j.route.closestOdm.name, 140) ? { name: str(j.route.closestOdm.name, 140), url: url(j.route.closestOdm.url) } : null, odmWeeks: num(j.route.odmWeeks), oemWeeks: num(j.route.oemWeeks) } : null,
    opportunity: cleanOpportunity(j.opportunity),
    techPack: j.techPack ? Object.fromEntries(['dimensions', 'materialSpec', 'finish', 'packaging', 'aql', 'volume'].map((k) => [k, str(j.techPack[k], 300)])) : null,
    rfq: j.rfq && str(j.rfq.en, 10) ? { en: para(j.rfq.en, 2500), zh: para(j.rfq.zh, 2500), screening: list(j.rfq.screening, 6, (x) => str(x, 240)) } : null,
    pricing: { retail: num(j.pricing && j.pricing.retail), wholesale: num(j.pricing && j.pricing.wholesale), channelFeesPerUnit: num(j.pricing && j.pricing.channelFeesPerUnit), marginRetailPct: num(j.pricing && j.pricing.marginRetailPct), marginWholesalePct: num(j.pricing && j.pricing.marginWholesalePct), note: str(j.pricing && j.pricing.note, 300) },
    profitExample: str(j.profitExample, 400), moq: str(j.moq, 160), leadTime: str(j.leadTime, 240),
    clusters: list(j.clusters, 5, (c) => ({ place: str(c && c.place, 80), why: str(c && c.why, 300) })).filter((c) => c.place),
    suppliers: list(j.suppliers, 8, (s) => ({ name: str(s && s.name, 120), city: str(s && s.city, 60), makes: str(s && s.makes, 200), type: /factory|manufactur/i.test(str(s && s.type, 40)) ? 'factory' : /trad/i.test(str(s && s.type, 40)) ? 'trading company' : 'unknown', url: url(s && s.url), note: str(s && s.note, 200) })).filter((s) => s.name),
    searchLinks: list(j.searchLinks, 6, (s) => (url(s && s.url) ? { site: str(s.site, 40), url: s.url } : null)),
    certifications: list(j.certifications, 8, (x) => str(x, 160)),
    ipCheck: { note: para(j.ipCheck && j.ipCheck.note, 500), links: list(j.ipCheck && j.ipCheck.links, 4, url) },
    nextSteps: list(j.nextSteps, 8, (x) => str(x, 240)), confidence: str(j.confidence, 240), sources: sources(j.sources),
  };
}

// ---- live status ---------------------------------------------------------------------------
function setLive(fields) {
  current = fields ? { ...(current || {}), ...fields, since: fields.type ? Date.now() : (current && current.since) || Date.now() } : null;
  emit({ event: 'live', live: live() });
}
function live() {
  if (!current) return null;
  const { type, postId, invId, label, agent, since, activity, product } = current;
  return { type, postId, invId, label, agent, since, activity, product, queued: queue.length };
}
const activity = (what) => { if (current) { current.activity = what; emit({ event: 'live', live: live() }); } };

// ---- jobs -----------------------------------------------------------------------------------
function enqueue(job) {
  const key = JSON.stringify([job.type, job.postId || '', job.invId || '']);
  if (queue.some((j) => JSON.stringify([j.type, j.postId || '', j.invId || '']) === key) || (current && JSON.stringify([current.type, current.postId || '', current.invId || '']) === key)) return false;
  queue.push(job);
  emit({ event: 'live', live: live() });
  pump();
  return true;
}
let busy = false;
async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  markBusy(job);
  try {
    if (job.type === 'cycle') await runCycle(job);
    else if (job.type === 'animate') await runAnimate(job);
    else if (job.type === 'round') await runRound(job);
    else if (job.type === 'sourcing') await runSourcing(job);
    store.setSettings({ failures: 0 });
  } catch (e) {
    console.error(`${job.type} failed: ${e.message}`);
    const s = store.settings();
    const limit = /usage limit|rate limit|429|overloaded|exceeded/i.test(e.message);
    // A usage limit or repeated failures: rest for a while instead of hammering the plan.
    store.setSettings({ failures: s.failures + 1, holdUntil: limit || s.failures + 1 >= 3 ? Date.now() + (limit ? 90 : 60) * 60 * 1000 : s.holdUntil, lastError: str(e.message, 300), lastErrorAt: Date.now() });
  } finally {
    busy = false;
    markBusy(null);
    setLive(null);
    setImmediate(pump);
  }
}

/** A new product: the Scout researches, then the three inventors. */
async function runCycle() {
  const s = store.settings();
  const recent = store.listPosts();
  const done = recent.map((p) => p.product && p.product.name).filter(Boolean);
  // Every other product comes from a niche people follow (the one served longest ago); the rest rotate through categories.
  const niches = followedNiches();
  const useNiche = !(s.focus && s.focusOnly) && niches.length && (s.cycles || 0) % 2 === 0;
  const served = s.nicheServed || {};
  const niche = useNiche ? niches.sort((a, b) => (served[a.key] || 0) - (served[b.key] || 0) || b.count - a.count)[0] : null;
  const category = s.focus && s.focusOnly ? s.focus : niche ? niche.name : A.CATEGORIES[(recent.length + new Date().getUTCHours()) % A.CATEGORIES.length];
  store.setSettings({ cycles: (s.cycles || 0) + 1, ...(niche ? { nicheServed: { ...served, [niche.key]: Date.now() } } : {}) });
  // Counted as a run from the start, so a failure waits for the next slot instead of retrying at once.
  store.setSettings({ lastRunAt: Date.now() });
  const post = store.createPost({ status: 'researching', by: 'schedule', category, ...(niche ? { niche: niche.name } : {}) });
  emit({ event: 'post', id: post.id });
  setLive({ type: 'cycle', postId: post.id, agent: 'scout', label: `Scout is looking for a product in ${category.toLowerCase()}`, activity: null, product: null });
  try {
    const r = await askJson({ system: A.SCOUT_SYSTEM, prompt: A.scoutPrompt({ category, avoid: done.slice(0, 150), focus: s.focus, today: today(), niche: niche ? niche.name : '' }), model: s.models.scout, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
    const dossier = cleanDossier(r.json);
    if (!dossier.name) throw new Error('The Scout returned no product.');
    const sketch = media.saveSvg(r.json.sketchSvg);
    setLive({ label: `Scout found ${dossier.name}; fetching a photo`, product: dossier.name, activity: null });
    let image = null;
    try { image = await media.productPhoto(dossier); } catch {}
    store.patchPost(post.id, { product: dossier, image, sketch, status: 'inventing', costUsd: r.costUsd, work: workOf(r) });
    emit({ event: 'post', id: post.id });
    await inventRound(post.id, { by: 'schedule' });
  } catch (e) {
    const p = store.loadPost(post.id);
    // A post with no product and no reinventions is noise: remove it.
    if (p && !p.product) store.removePost(post.id); else if (p) store.patchPost(post.id, { status: (p.rounds || []).length ? 'ready' : 'error', error: str(e.message, 300) });
    emit({ event: 'post', id: post.id });
    throw e;
  }
}

/** Niches confirmed people follow, with how many follow each. */
function followedNiches() {
  const m = {};
  for (const u of require('./auth').listUsers()) {
    if (u.status !== 'approved') continue;
    for (const n of u.niches || []) { const key = n.toLowerCase(); m[key] = m[key] || { key, name: n, count: 0 }; m[key].count++; }
  }
  return Object.values(m);
}

/** The three inventors reinvent a product, one after another, each seeing the others. */
async function inventRound(postId, { by, feedback = '', focusInvId = null, userId = null }) {
  const s = store.settings();
  const post = store.loadPost(postId);
  const previousTitles = (post.rounds || []).flatMap((r) => r.inventions.map((i) => i.title));
  const focusInv = focusInvId ? (post.rounds || []).flatMap((r) => r.inventions).find((i) => i.id === focusInvId) : null;
  const demand = demandText(post);
  const round = { id: store.id(), at: Date.now(), by, feedback: feedback || null, focusInvId, userId, inventions: [] };
  const summary = (inv, agentId) => ({ by: `${A.INVENTORS[agentId].name} (${A.INVENTORS[agentId].role})`, lever: inv.lever, fix: inv.fix, title: inv.title, insight: inv.insight, changes: inv.changes });
  const invent = async (agentId, earlier, tooClose = '') => {
    const ag = A.INVENTORS[agentId];
    setLive({ type: current ? current.type : 'round', postId, agent: agentId, label: `${ag.name}, ${ag.role.toLowerCase()}, is ${tooClose ? 'taking a different direction on' : 'reinventing'} ${post.product.name.toLowerCase()}`, activity: null, product: post.product.name });
    const r = await askJson({ system: ag.system, prompt: A.inventorPrompt({ dossier: post.product, earlier, previousTitles, feedback, focusInv, tooClose, demand }), model: s.models.inventor, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
    return { ...cleanInvention(r.json, agentId), work: workOf(r) };
  };
  const earlier = [];
  for (const agentId of A.ORDER) {
    try {
      const inv = await invent(agentId, earlier);
      round.inventions.push(inv);
      earlier.push(summary(inv, agentId));
    } catch (e) {
      if (/usage limit|rate limit|429|logged in/i.test(e.message)) { if (round.inventions.length) saveRound(postId, round); throw e; }
      console.error(`${agentId} on ${postId}: ${e.message}`);
    }
    // Show each reinvention as soon as it exists.
    if (round.inventions.length) saveRound(postId, round);
  }
  if (!round.inventions.length) throw new Error('No inventor finished.');
  // A quick reviewer makes sure the three are really different; at most one redo per round.
  if (round.inventions.length >= 2) {
    try {
      const clash = await reviewDistinct(round.inventions, s);
      if (clash) {
        const i = clash.later;
        const agentId = round.inventions[i].agent;
        const others = round.inventions.filter((_, k) => k !== i).map((inv) => summary(inv, inv.agent));
        const redo = await invent(agentId, others, `It repeated "${round.inventions[clash.earlier].title}": ${clash.why}`);
        redo.redoOf = round.inventions[i].title;
        round.inventions[i] = redo;
        round.review = { redid: agentId, why: clash.why };
        saveRound(postId, round);
      } else round.review = { redid: null };
    } catch (e) {
      if (/usage limit|rate limit|429|logged in/i.test(e.message)) throw e;
      console.error(`distinct review on ${postId}: ${e.message}`);
    }
  }
  // A realistic picture of each design (an image service, not Claude; failures are fine).
  if (render.config().provider !== 'off') {
    for (const inv of round.inventions) {
      try { inv.render = { ...(await render.renderInvention(inv, post.product.name)), at: Date.now() }; saveRound(postId, round); }
      catch (e) { console.error(`render ${inv.id}: ${e.message}`); }
    }
  }
  // Then each design gets its "how it works" loop (optional, owner's switch).
  if (store.settings().animate !== false) {
    for (const inv of round.inventions) {
      try {
        const file = await animate(post.product.name, inv);
        if (file) { inv.anim = file; saveRound(postId, round); }
      } catch (e) {
        if (/usage limit|rate limit|429|logged in/i.test(e.message)) throw e;
        console.error(`animate ${inv.id}: ${e.message}`);
      }
    }
  }
  return round;
}

/** The Animator: an 8-second SMIL loop from the inventor's concept sheet. */
async function animate(productName, inv) {
  const s = store.settings();
  const ag = A.INVENTORS[inv.agent];
  setLive({ type: current ? current.type : 'animate', agent: 'animator', label: `The Animator is showing how ${inv.title} works`, activity: null, product: productName });
  let sketchSvg = '';
  try { const f = inv.sketch && store.mediaPath(inv.sketch); if (f) sketchSvg = fs.readFileSync(f, 'utf8'); } catch {}
  const r = await askClaude({ system: A.ANIMATOR_SYSTEM, prompt: A.animatorPrompt({ inv, productName, sketchSvg }), model: s.models.animator || 'sonnet', tools: [], timeoutMs: 10 * 60 * 1000 });
  if (!/<animate|<set\b/i.test(r.text)) throw new Error(`no animation from the Animator (${ag ? ag.name : inv.agent})`);
  const file = media.saveSvg(r.text, { animated: true });
  if (!file) throw new Error('the animation did not survive cleaning');
  const kept = fs.readFileSync(store.mediaPath(file), 'utf8');
  if (!/<animate|<set\b/i.test(kept)) throw new Error('the animation lost its motion in cleaning');
  return file;
}
async function runAnimate(job) {
  const found = store.findInvention(job.invId);
  if (!found) throw new Error('No such reinvention.');
  setLive({ type: 'animate', postId: found.post.id, invId: found.inv.id, label: `The Animator is showing how ${found.inv.title} works`, product: found.post.product.name, activity: null });
  const file = await animate(found.post.product.name, found.inv);
  const p = store.loadPost(found.post.id);
  for (const r of p.rounds || []) for (const inv of r.inventions) if (inv.id === job.invId) inv.anim = file;
  store.savePost(p);
  emit({ event: 'post', id: p.id, invId: job.invId });
}

const REVIEW_SYSTEM = `You review one round of an invention studio. Three inventors each reinvented the same product with a different lever (mechanism, interaction, system). Your only job: say whether a LATER design is essentially the same idea as an EARLIER one (same core principle or same product a shopper would see as the same thing). Different features on the same core idea count as the same. Be strict but fair: different ideas that share a material or a minor feature are fine.`;
async function reviewDistinct(inventions, s) {
  const list = inventions.map((inv, i) => `${i}. [${inv.lever || inv.agent}] "${inv.title}": ${inv.fix || inv.tagline} | ${inv.insight} | changes: ${(inv.changes || []).slice(0, 4).join('; ')}`).join('\n');
  const r = await askJson({ system: REVIEW_SYSTEM, prompt: `${list}\n\nReply with ONLY JSON: {"same": [{"later": 2, "earlier": 0, "why": "one sentence"}]} listing only real duplicates (later > earlier), or {"same": []}.`, model: (s.models && s.models.reviewer) || 'haiku', tools: [], timeoutMs: 3 * 60 * 1000 });
  const same = (Array.isArray(r.json && r.json.same) ? r.json.same : []).find((x) => Number.isInteger(x.later) && Number.isInteger(x.earlier) && x.later > x.earlier && x.later < inventions.length);
  return same ? { later: same.later, earlier: same.earlier, why: str(same.why, 300) } : null;
}

/** What people in the app said they would buy, for the inventors and the analyst. */
function demandText(post, onlyInvId = null) {
  const lines = [];
  for (const r of post.rounds || []) for (const inv of r.inventions || []) {
    if (onlyInvId && inv.id !== onlyInvId) continue;
    const d = store.demand(inv.id);
    if (d.count) lines.push(`"${inv.title}": ${d.count} would buy${d.median ? `, median price $${d.median}` : ''}`);
  }
  return lines.join('; ');
}

function saveRound(postId, round) {
  const p = store.loadPost(postId);
  const i = (p.rounds || []).findIndex((r) => r.id === round.id);
  if (i >= 0) p.rounds[i] = round; else p.rounds = [...(p.rounds || []), round];
  p.status = 'ready';
  store.savePost(p);
  emit({ event: 'post', id: postId });
}

async function runRound(job) {
  const p = store.loadPost(job.postId);
  if (!p || !p.product) throw new Error('No such product.');
  setLive({ type: 'round', postId: p.id, label: `The inventors are taking another pass at ${p.product.name.toLowerCase()}`, product: p.product.name, activity: null });
  await inventRound(p.id, { by: 'feedback', feedback: job.feedback, focusInvId: job.focusInvId, userId: job.userId });
}

async function runSourcing(job) {
  const s = store.settings();
  const found = store.findInvention(job.invId);
  if (!found) throw new Error('No such reinvention.');
  const { post, inv } = found;
  setLive({ type: 'sourcing', postId: post.id, invId: inv.id, agent: 'sourcing', label: `Pricing and sourcing ${inv.title} in China`, product: post.product.name, activity: null });
  setSourcing(post.id, inv.id, { status: 'running', at: Date.now() });
  try {
    const r = await askJson({ system: A.SOURCING_SYSTEM, prompt: A.sourcingPrompt({ dossier: post.product, inv, demand: demandText(post, inv.id) }), model: s.models.sourcing, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
    setSourcing(post.id, inv.id, { status: 'ready', at: Date.now(), report: cleanSourcing(r.json), work: workOf(r) });
  } catch (e) {
    setSourcing(post.id, inv.id, { status: 'error', at: Date.now(), error: str(e.message, 300) });
    throw e;
  }
}
function setSourcing(postId, invId, value) {
  const p = store.loadPost(postId);
  for (const r of p.rounds || []) for (const inv of r.inventions) if (inv.id === invId) inv.sourcing = value;
  store.savePost(p);
  emit({ event: 'post', id: postId, invId });
}

// ---- chat ------------------------------------------------------------------------------------
const chatting = new Set();
async function chat(postId, userId, text) {
  const key = `${postId}:${userId}`;
  if (chatting.has(key)) throw Object.assign(new Error('Still answering your last message.'), { status: 409 });
  const p = store.loadPost(postId);
  if (!p || !p.product) throw Object.assign(new Error('No such product.'), { status: 404 });
  chatting.add(key);
  store.addChat(postId, userId, { role: 'user', text: str(text, 2000) });
  emit({ event: 'chat', id: postId, userId });
  (async () => {
    try {
      const history = store.chat(postId, userId).slice(-12).map((m) => `${m.role === 'user' ? 'OWNER' : 'YOU'}: ${m.text}`).join('\n\n');
      const designs = (p.rounds || []).flatMap((r, ri) => r.inventions.map((i) => `[round ${ri + 1}] ${A.INVENTORS[i.agent].name}'s "${i.title}": ${i.tagline} ${i.insight} Changes: ${i.changes.join('; ')}. Price ${i.priceHint}, unit cost ${i.unitCostHint}.${i.sourcing && i.sourcing.report ? ` Sourcing: ${i.sourcing.report.summary}` : ''}`)).join('\n');
      const r = await askClaude({ system: A.CHAT_SYSTEM, model: store.settings().models.chat, tools: ['WebSearch', 'WebFetch'], timeoutMs: 6 * 60 * 1000, prompt: `THE PRODUCT: ${p.product.name}. ${p.product.oneLiner}\nPains: ${p.product.pains.map((x) => x.pain).join('; ')}\n\nTHE STUDIO'S REINVENTIONS:\n${designs || '(none yet)'}\n\nCONVERSATION SO FAR:\n${history}\n\nReply to the owner's last message.` });
      let reply = r.text.trim();
      const m = reply.match(/^SUGGEST_ROUND:\s*(.+)$/im);
      const suggest = m ? str(m[1], 400) : null;
      if (m) reply = reply.replace(m[0], '').trim();
      store.addChat(postId, userId, { role: 'assistant', text: para(reply, 4000), suggest });
    } catch (e) {
      store.addChat(postId, userId, { role: 'assistant', text: `I couldn't answer just now (${str(e.message, 160)}). Try again in a minute.`, error: true });
    } finally {
      chatting.delete(key);
      emit({ event: 'chat', id: postId, userId });
    }
  })();
}
const isChatting = (postId, userId) => chatting.has(`${postId}:${userId}`);

// ---- schedule ------------------------------------------------------------------------------
function due(now = Date.now()) {
  const s = store.settings();
  if (s.paused || now < (s.holdUntil || 0) || busy || queue.length) return false;
  return now - (s.lastRunAt || 0) >= s.intervalMin * 60 * 1000;
}
function nextRunAt() {
  const s = store.settings();
  if (s.paused) return null;
  return Math.max((s.lastRunAt || 0) + s.intervalMin * 60 * 1000, s.holdUntil || 0, Date.now());
}

/** After a restart: nothing is running, so tidy work that was cut off mid-way. */
function recover() {
  markBusy(null);
  let fixed = 0;
  for (const p of store.listPosts()) {
    let changed = false;
    if (!p.product) { store.removePost(p.id); fixed++; continue; }
    if (p.status === 'researching' || p.status === 'inventing') {
      p.status = (p.rounds || []).length ? 'ready' : 'error';
      if (p.status === 'error') p.error = 'Interrupted by a restart.';
      changed = true;
    }
    for (const r of p.rounds || []) for (const inv of r.inventions || []) {
      if (inv.sourcing && inv.sourcing.status === 'running') { inv.sourcing = { status: 'error', at: Date.now(), error: 'Interrupted by a restart. Try again.' }; changed = true; }
    }
    if (changed) { store.savePost(p); fixed++; }
  }
  return fixed;
}

/** A picture on demand (outside the Claude queue: it only calls the image service). */
const rendering = new Set();
async function renderNow(invId) {
  if (rendering.has(invId)) return false;
  const found = store.findInvention(invId);
  if (!found) throw Object.assign(new Error('No such reinvention.'), { status: 404 });
  rendering.add(invId);
  emit({ event: 'post', id: found.post.id, invId });
  (async () => {
    let result = null, error = null;
    try { result = { ...(await render.renderInvention(found.inv, found.post.product.name)), at: Date.now() }; } catch (e) { error = e.message; }
    rendering.delete(invId);
    const p = store.loadPost(found.post.id);
    for (const r of p.rounds || []) for (const inv of r.inventions) if (inv.id === invId) { if (result) { inv.render = result; delete inv.renderError; } else inv.renderError = String(error).slice(0, 300); }
    store.savePost(p);
    emit({ event: 'post', id: p.id, invId });
  })();
  return true;
}
const isRendering = (invId) => rendering.has(invId);
/** After an upgrade: pictures for designs that have none yet, one at a time, newest first. */
async function renderMissing(limit = 60) {
  if (render.config().provider === 'off') return 0;
  let done = 0;
  for (const p of store.listPosts()) for (const r of p.rounds || []) for (const inv of r.inventions || []) {
    if (done >= limit || inv.render || inv.renderError) continue;
    try {
      const res = { ...(await render.renderInvention(inv, p.product.name)), at: Date.now() };
      const fresh = store.loadPost(p.id);
      for (const r2 of fresh.rounds || []) for (const i2 of r2.inventions) if (i2.id === inv.id) i2.render = res;
      store.savePost(fresh); emit({ event: 'post', id: p.id, invId: inv.id }); done++;
    } catch (e) {
      console.error(`render (backfill) ${inv.id}: ${e.message}`);
      if (/key|switched off|answered 4(01|03|29)/i.test(e.message)) return done;
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return done;
}

module.exports = { renderMissing, renderNow, isRendering, recover, setEmitter: (fn) => { emit = fn; }, enqueue, live, due, nextRunAt, chat, isChatting, cleanDossier, cleanInvention, cleanSourcing, isBusy: () => busy || queue.length > 0 };
