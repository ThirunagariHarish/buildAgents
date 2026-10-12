// Scenarios on disk: data/scenarios/<id>.json holds the claim, its thesis
// and the probability history; each day's full desk report is its own file
// under data/scenarios/<id>/runs/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const DIR = path.join(DATA, 'scenarios');
fs.mkdirSync(DIR, { recursive: true });

const fileOf = (id) => path.join(DIR, `${id}.json`);
const runsDir = (id) => path.join(DIR, id, 'runs');
const validId = (id) => /^[a-z0-9]{10,16}$/.test(String(id || ''));

function writeJson(file, v) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify(v), { mode: 0o600 });
  fs.renameSync(t, file);
}

function load(id) {
  if (!validId(id)) return null;
  try { return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')); } catch { return null; }
}
function save(sc) { sc.updatedAt = Date.now(); writeJson(fileOf(sc.id), sc); return sc; }
function patch(id, fields) { const sc = load(id); if (!sc) return null; Object.assign(sc, fields); return save(sc); }

function list() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => load(f.slice(0, -5))).filter(Boolean);
}

function create({ ownerId, claim, facts = '', themeId = null, parentId = null }) {
  const id = crypto.randomBytes(6).toString('hex');
  const sc = {
    id, ownerId, claim, facts, themeId: themeId || id, parentId, createdAt: Date.now(),
    status: 'new', thesis: null, history: [], backfill: [], questions: [], seen: {}, schedule: 'daily', alerts: { email: true, move: 5 },
    latest: null, error: null,
  };
  return save(sc);
}

function remove(id) {
  if (!validId(id)) return;
  try { fs.unlinkSync(fileOf(id)); } catch {}
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
}

function saveRun(id, run) { writeJson(path.join(runsDir(id), `${run.id}.json`), run); }
function loadRun(id, runId) {
  if (!validId(id) || !/^[\w-]{6,40}$/.test(String(runId || ''))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(runsDir(id), `${runId}.json`), 'utf8')); } catch { return null; }
}
function runIds(id) {
  try { return fs.readdirSync(runsDir(id)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; }
}

module.exports = { load, save, patch, list, create, remove, saveRun, loadRun, runIds, validId };
