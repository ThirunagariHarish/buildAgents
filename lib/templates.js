// Ready-made agents. Each lives in lib/templates/<id>/ as a normal agent
// package (agent.json, agent.js, evals) plus template.json: what the gallery
// shows and the few fields the owner fills in.
//
// Installing one does what a custom build does at the end, with no model
// calls: it creates the agent's repository, runs the same eval gate, then
// signs and releases it. So a template agent is tested and signed exactly
// like a crew-built one, and costs nothing to make.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const ws = require('./workspace');
const settings = require('./settings');
const packages = require('./packages');
const { validateManifest } = require('./kit/core');

const DIR = path.join(__dirname, 'templates');
const read = (...p) => fs.readFileSync(path.join(DIR, ...p), 'utf8');

function ids() { return fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'template.json'))).sort(); }

function load(id) {
  if (!ids().includes(id)) return null;
  const meta = JSON.parse(read(id, 'template.json'));
  const manifest = JSON.parse(read(id, 'agent.json'));
  return { id, meta, manifest };
}

/** What the gallery shows. */
function list() {
  return ids().map((id) => {
    const { meta, manifest } = load(id);
    return { id, ...meta, permissions: manifest.permissions, description: manifest.description };
  });
}

/** Apply the owner's choice of time, days or interval to the template's triggers. */
function applyWhen(manifest, spec, when = {}) {
  if (!spec) return manifest;
  if (spec.type === 'schedule') {
    const t = manifest.triggers.find((x) => x.type === 'schedule');
    if (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(when.at || ''))) t.at = when.at;
    if (t && Array.isArray(when.days) && when.days.length) t.days = when.days.filter((d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(d));
    if (t && Array.isArray(when.days) && !when.days.length) delete t.days;
  }
  if (spec.type === 'interval') {
    const t = manifest.triggers.find((x) => x.type === 'interval');
    const n = Number(when.minutes);
    if (t && (spec.choices || []).includes(n)) t.minutes = n;
  }
  return manifest;
}

/**
 * Install a template for a person. `values` fill its fields; `when` sets the
 * schedule; `live` starts it notifying right away (it is already tested).
 */
async function install(user, id, { values = {}, when = {}, live = true, title, runsOn = 'cloud' } = {}) {
  const t = load(id);
  if (!t) throw Object.assign(new Error('No such template.'), { status: 404 });
  const manifest = applyWhen(JSON.parse(JSON.stringify(t.manifest)), t.meta.when, when);
  const problems = validateManifest(manifest);
  if (problems.length) throw Object.assign(new Error(problems.join(' ')), { status: 400 });

  // Check the owner's values before creating anything.
  const filled = {};
  for (const f of t.meta.fields || []) {
    const v = values[f.key] !== undefined && values[f.key] !== '' ? values[f.key] : f.default;
    if (v !== undefined && v !== '') filled[f.key] = v;
    else if (!f.optional) throw Object.assign(new Error(`${f.label} is needed.`), { status: 400 });
  }

  const a = store.createAgent({ ownerId: user.id, idea: `${t.meta.name}: ${t.meta.summary}` });
  a.title = String(title || t.meta.name).slice(0, 40);
  a.icon = t.meta.icon;
  a.fromTemplate = id;
  a.runsOn = runsOn === 'phone' ? 'phone' : 'cloud';
  a.brief = `# ${t.meta.name}\n\nInstalled from the ready-made "${t.meta.name}" agent. ${manifest.description}`;
  a.stage = 'building';
  a.status = 'running';
  store.saveAgent(a);
  try { settings.set(a.id, manifest, filled); } catch (e) { store.deleteAgent(a.id); throw e; }
  try {
    await ws.ensureRepo(a.id, { readme: `# ${a.title}\n\nA Pocket Box agent from the "${t.meta.name}" template.\n` });
    const dir = ws.repoDir(a.id);
    const u = ws.buildUser();
    const put = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); if (u) { try { fs.chownSync(p, u.uid, u.gid); } catch {} } };
    put('agent.json', `${JSON.stringify(manifest, null, 2)}\n`);
    put('agent.js', read(id, 'agent.js'));
    for (const f of fs.readdirSync(path.join(DIR, id, 'evals'))) put(`evals/${f}`, read(id, 'evals', f));
    await ws.commitAll(a.id, `Install the ${t.meta.name} template`);
    const report = await ws.runEvals(a.id);
    if (!report.ok) throw new Error(`The template's checks did not pass: ${[...(report.problems || []), ...(report.scenarios || []).filter((s) => !s.pass).map((s) => s.name)].join('; ')}`);
    await require('./crew').release(store.loadAgent(a.id), report, 'building', { quiet: true });
    if (live) packages.setChannel(a.id, 'live');
    const fresh = store.loadAgent(a.id);
    fresh.title = a.title;
    if (live) { fresh.release = { ...(fresh.release || {}), channel: 'live' }; fresh.stage = 'live'; }
    const trig = manifest.triggers.find((x) => x.type === 'schedule' || x.type === 'interval');
    const every = !trig ? 'when you tap Run' : trig.type === 'interval' ? `every ${trig.minutes >= 60 ? `${trig.minutes / 60} hour${trig.minutes === 60 ? '' : 's'}` : `${trig.minutes} minutes`}` : `at ${trig.at}${trig.days && trig.days.length && trig.days.length < 7 ? ` on ${trig.days.join(', ')}` : ' every day'}`;
    const where = fresh.runsOn === 'cloud' ? 'in the cloud' : 'on your phone (open the Runtime there once)';
    const msg = store.addMessage(fresh, {
      agentId: 'system', agentName: 'Pocket Box', emoji: '📦', kind: 'system',
      summary: `Ready: runs ${where}, ${every}${live ? '' : ', quietly first'}`,
      content: `${t.meta.name} passed all ${report.passed} of its checks and was signed (version ${manifest.version}).\n\nIt runs ${where}, ${every}. ${live ? 'You get its notifications from now on.' : 'For now it only records what it would have said; tap Go live when it looks right.'} Change its values under Settings, run it now with "Run now", or tell it here what to change.`,
    });
    store.saveAgent(fresh);
    require('./bus').publish(fresh, { event: 'message', message: msg });
    return store.loadAgent(a.id);
  } catch (e) {
    const failed = store.loadAgent(a.id);
    if (failed) { failed.status = 'error'; failed.error = e.message; store.saveAgent(failed); }
    throw e;
  }
}

module.exports = { list, load, install, applyWhen };
