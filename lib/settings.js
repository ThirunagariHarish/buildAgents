// The owner's values for an agent's settings (a feed address, a goal).
// Stored on the server, owner-only file; secret values are never sent back to
// the Studio screen after saving, only to the owner's paired phones.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

const DIR = path.join(DATA, 'agent-settings');
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });

const file = (id) => path.join(DIR, `${id}.json`);

/**
 * A setting's short name and its explanation. Agents should give a short
 * `label` and put the rest in `help`; older ones packed everything into the
 * label, so a long label is split at its first natural break.
 */
function describe(s) {
  const label = String(s.label || s.key);
  if (s.help || label.length <= 48) return { short: label, help: s.help ? String(s.help) : '' };
  const m = label.slice(0, 70).match(/^(.{6,}?)(\?\s|:\s|\s\(|,\s|\.\s)/);
  if (!m) return { short: label, help: '' };
  const short = m[1] + (m[2].startsWith('?') ? '?' : '');
  let help = label.slice(m[0].length - (m[2] === ' (' ? 1 : 0)).trim();
  if (m[2] === ' (') help = help.replace(/^\((.*?)\)\s*/, '$1. ');
  return { short, help: help.charAt(0).toUpperCase() + help.slice(1) };
}
const isMultiline = (s) => !!s.multiline || /one per line|each line/i.test(`${s.label} ${s.help || ''}`);
function values(agentId) { try { return JSON.parse(fs.readFileSync(file(agentId), 'utf8')); } catch { return {}; } }

function set(agentId, manifest, input) {
  const known = new Map((manifest.settings || []).map((s) => [s.key, s]));
  const cur = values(agentId);
  for (const [k, v] of Object.entries(input || {})) {
    const s = known.get(k);
    if (!s) continue;
    if (v === null || v === '') { delete cur[k]; continue; }
    let val = String(v).slice(0, isMultiline(s) ? 8000 : 2000);
    if (s.type === 'number') { const n = Number(val); if (!Number.isFinite(n)) throw Object.assign(new Error(`${s.label} must be a number.`), { status: 400 }); val = n; }
    if (s.type === 'url') { try { const u = new URL(val); if (u.protocol !== 'https:') throw new Error(); } catch { throw Object.assign(new Error(`${s.label} must be an https address.`), { status: 400 }); } }
    if (s.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) throw Object.assign(new Error(`${s.label} must look like 07:30.`), { status: 400 });
    cur[k] = val;
  }
  fs.writeFileSync(file(agentId), JSON.stringify(cur), { mode: 0o600 });
  return cur;
}

/** What the Studio screen may show: secrets masked. */
function view(agentId, manifest) {
  const cur = values(agentId);
  return (manifest?.settings || []).map((s) => {
    const d = describe(s);
    return {
      key: s.key, label: d.short, help: d.help, type: s.type || 'text', optional: !!s.optional,
      multiline: isMultiline(s), placeholder: s.placeholder ? String(s.placeholder).slice(0, 120) : '',
      set: s.key in cur, value: s.key in cur ? (s.type === 'secret' ? '••••••' : cur[s.key]) : '',
    };
  });
}

function missing(agentId, manifest) {
  const cur = values(agentId);
  return (manifest?.settings || []).filter((s) => !s.optional && !(s.key in cur)).map((s) => describe(s).short);
}

module.exports = { values, set, view, missing, describe };
