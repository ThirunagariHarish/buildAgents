// Shared keys: values the owner gives Box once (an Anthropic API key, an
// email provider key) that every project's deploy fills in automatically,
// so no crew ever asks for them again. Root-only file; values never leave
// the server except into the projects' cluster secrets.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'shared-env.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function save(map) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 1), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch {}
}

/** Names only, with who set them and when. */
function list() {
  return Object.entries(load()).map(([name, v]) => ({ name, setBy: v.setBy, setAt: v.setAt, hint: v.hint || '' }));
}
/** name → value, for a deploy. */
function values() {
  return Object.fromEntries(Object.entries(load()).map(([k, v]) => [k, v.value]));
}
function set(name, value, { by, hint } = {}) {
  if (!/^[A-Z][A-Z0-9_]{1,60}$/.test(name)) throw Object.assign(new Error('Names are UPPER_CASE, like ANTHROPIC_API_KEY.'), { status: 400 });
  const map = load();
  map[name] = { value: String(value), setBy: by || null, setAt: Date.now(), hint: hint || map[name]?.hint || '' };
  save(map);
}
function remove(name) {
  const map = load();
  delete map[name];
  save(map);
}

/** Variables the crews should know are provided by Box, with what each is for. */
const WELL_KNOWN = {
  ANTHROPIC_API_KEY: 'Claude API key: AI features in every product use it. Billed per use on the owner\'s Anthropic account.',
  RESEND_API_KEY: 'Transactional email.',
  OPENAI_API_KEY: 'Only if a product truly needs it; Claude is the default.',
  STRIPE_SECRET_KEY: 'Payments.',
  ASSEMBLYAI_API_KEY: 'Speech to text.',
};

module.exports = { list, values, set, remove, WELL_KNOWN };
