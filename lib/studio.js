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

let emit = () => {};
const queue = [];
let current = null; // { type, postId, invId, label, agent, since, activity }
const today = () => new Date().toISOString().slice(0, 10);

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
    priorArt: list(j.priorArt, 10, (p) => ({ name: str(p && p.name, 120), what: str(p && p.what, 300), url: url(p && p.url) })).filter((p) => p.name),
    constraints: list(j.constraints, 8, (x) => str(x, 160)), imageQuery: str(j.imageQuery, 60), imagePages: list(j.imagePages, 4, url),
    sources: sources(j.sources),
  };
}
function cleanInvention(j, agentId) {
  return {
    id: store.id(), agent: agentId, at: Date.now(),
    title: str(j.title, 80) || 'Untitled', tagline: str(j.tagline, 220), insight: para(j.insight, 600),
    considered: list(j.considered, 4, (x) => str(x, 300)), changes: list(j.changes, 6, (x) => str(x, 240)), howItWorks: para(j.howItWorks, 2000),
    whyBetter: list(j.whyBetter, 6, (w) => ({ claim: str(w && w.claim, 200), metric: str(w && w.metric, 120) })).filter((w) => w.claim),
    materials: para(j.materials, 600), manufacturing: para(j.manufacturing, 900), targetCustomer: para(j.targetCustomer, 400),
    priceHint: str(j.priceHint, 80), unitCostHint: str(j.unitCostHint, 160),
    novelty: { closest: list(j.novelty && j.novelty.closest, 5, (c) => ({ name: str(c && c.name, 120), url: url(c && c.url), how: str(c && c.how, 300) })).filter((c) => c.name), verdict: para(j.novelty && j.novelty.verdict, 500) },
    risks: list(j.risks, 5, (x) => str(x, 240)), sketch: media.saveSvg(j.sketchSvg), sources: sources(j.sources), sourcing: null,
  };
}
function cleanSourcing(j) {
  const cost = (c = {}) => ({ total: num(c.total), materials: num(c.materials), processing: num(c.processing), packaging: num(c.packaging), toolingPerUnit: num(c.toolingPerUnit) });
  return {
    summary: para(j.summary, 600), productionRoute: list(j.productionRoute, 12, (x) => str(x, 240)),
    bom: list(j.bom, 15, (b) => ({ part: str(b && b.part, 80), material: str(b && b.material, 80), process: str(b && b.process, 80), unitCost: num(b && b.unitCost) })).filter((b) => b.part),
    unitCost: { at1k: cost(j.unitCost && j.unitCost.at1k), at10k: cost(j.unitCost && j.unitCost.at10k) },
    oneTime: list(j.oneTime, 8, (o) => ({ item: str(o && o.item, 140), cost: num(o && o.cost) })).filter((o) => o.item),
    landed: { freightPerUnit: num(j.landed && j.landed.freightPerUnit), dutyRate: str(j.landed && j.landed.dutyRate, 120), landedAt10k: num(j.landed && j.landed.landedAt10k) },
    pricing: { retail: num(j.pricing && j.pricing.retail), wholesale: num(j.pricing && j.pricing.wholesale), channelFeesPerUnit: num(j.pricing && j.pricing.channelFeesPerUnit), marginRetailPct: num(j.pricing && j.pricing.marginRetailPct), marginWholesalePct: num(j.pricing && j.pricing.marginWholesalePct), note: str(j.pricing && j.pricing.note, 300) },
    profitExample: str(j.profitExample, 400), moq: str(j.moq, 160), leadTime: str(j.leadTime, 240),
    clusters: list(j.clusters, 5, (c) => ({ place: str(c && c.place, 80), why: str(c && c.why, 300) })).filter((c) => c.place),
    suppliers: list(j.suppliers, 8, (s) => ({ name: str(s && s.name, 120), city: str(s && s.city, 60), makes: str(s && s.makes, 200), url: url(s && s.url), note: str(s && s.note, 200) })).filter((s) => s.name),
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
  try {
    if (job.type === 'cycle') await runCycle(job);
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
    setLive(null);
    setImmediate(pump);
  }
}

/** A new product: the Scout researches, then the three inventors. */
async function runCycle() {
  const s = store.settings();
  const recent = store.listPosts();
  const done = recent.map((p) => p.product && p.product.name).filter(Boolean);
  const category = s.focus && s.focusOnly ? s.focus : A.CATEGORIES[(recent.length + new Date().getUTCHours()) % A.CATEGORIES.length];
  // Counted as a run from the start, so a failure waits for the next slot instead of retrying at once.
  store.setSettings({ lastRunAt: Date.now() });
  const post = store.createPost({ status: 'researching', by: 'schedule', category });
  emit({ event: 'post', id: post.id });
  setLive({ type: 'cycle', postId: post.id, agent: 'scout', label: `Scout is looking for a product in ${category.toLowerCase()}`, activity: null, product: null });
  try {
    const r = await askJson({ system: A.SCOUT_SYSTEM, prompt: A.scoutPrompt({ category, avoid: done.slice(0, 150), focus: s.focus, today: today() }), model: s.models.scout, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
    const dossier = cleanDossier(r.json);
    if (!dossier.name) throw new Error('The Scout returned no product.');
    const sketch = media.saveSvg(r.json.sketchSvg);
    setLive({ label: `Scout found ${dossier.name}; fetching a photo`, product: dossier.name, activity: null });
    let image = null;
    try { image = await media.productPhoto(dossier); } catch {}
    store.patchPost(post.id, { product: dossier, image, sketch, status: 'inventing', costUsd: r.costUsd });
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

/** The three inventors reinvent a product, one after another, each seeing the others. */
async function inventRound(postId, { by, feedback = '', focusInvId = null, userId = null }) {
  const s = store.settings();
  const post = store.loadPost(postId);
  const previousTitles = (post.rounds || []).flatMap((r) => r.inventions.map((i) => i.title));
  const focusInv = focusInvId ? (post.rounds || []).flatMap((r) => r.inventions).find((i) => i.id === focusInvId) : null;
  const round = { id: store.id(), at: Date.now(), by, feedback: feedback || null, focusInvId, userId, inventions: [] };
  const earlier = [];
  for (const agentId of A.ORDER) {
    const ag = A.INVENTORS[agentId];
    setLive({ type: current ? current.type : 'round', postId, agent: agentId, label: `${ag.name}, ${ag.role.toLowerCase()}, is reinventing ${post.product.name.toLowerCase()}`, activity: null, product: post.product.name });
    try {
      const r = await askJson({ system: ag.system, prompt: A.inventorPrompt({ dossier: post.product, earlier, previousTitles, feedback, focusInv }), model: s.models.inventor, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
      const inv = cleanInvention(r.json, agentId);
      round.inventions.push(inv);
      earlier.push({ by: `${ag.name} (${ag.role})`, title: inv.title, insight: inv.insight, changes: inv.changes });
    } catch (e) {
      if (/usage limit|rate limit|429|logged in/i.test(e.message)) { if (round.inventions.length) saveRound(postId, round); throw e; }
      console.error(`${agentId} on ${postId}: ${e.message}`);
    }
    // Show each reinvention as soon as it exists.
    if (round.inventions.length) saveRound(postId, round);
  }
  if (!round.inventions.length) throw new Error('No inventor finished.');
  return round;
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
    const r = await askJson({ system: A.SOURCING_SYSTEM, prompt: A.sourcingPrompt({ dossier: post.product, inv }), model: s.models.sourcing, tools: ['WebSearch', 'WebFetch'], timeoutMs: 15 * 60 * 1000, onActivity: activity });
    setSourcing(post.id, inv.id, { status: 'ready', at: Date.now(), report: cleanSourcing(r.json) });
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

module.exports = { setEmitter: (fn) => { emit = fn; }, enqueue, live, due, nextRunAt, chat, isChatting, cleanDossier, cleanInvention, cleanSourcing, isBusy: () => busy || queue.length > 0 };
