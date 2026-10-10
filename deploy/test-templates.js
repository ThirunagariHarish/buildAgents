// Runs every template agent's own scenarios through the agent kit, the same
// gate a custom build passes. Used by the self-test and on its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TPL = path.join(ROOT, 'lib', 'templates');
let failed = 0;
for (const id of fs.readdirSync(TPL).filter((d) => fs.statSync(path.join(TPL, d)).isDirectory()).sort()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tpl-${id}-`));
  fs.cpSync(path.join(TPL, id), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'agentkit'));
  for (const f of ['core.js', 'evals.js', 'CONTRACT.md']) fs.copyFileSync(path.join(ROOT, 'lib/kit', f), path.join(dir, 'agentkit', f));
  let r;
  try { r = JSON.parse(execFileSync(process.execPath, ['agentkit/evals.js', '--json'], { cwd: dir, encoding: 'utf8' })); }
  catch (e) { r = JSON.parse(e.stdout || '{"ok":false,"problems":["crashed"]}'); }
  const bad = (r.scenarios || []).filter((s) => !s.pass);
  console.log(`${r.ok ? '✓' : '✗'} ${id}: ${r.passed || 0}/${(r.scenarios || []).length}${r.problems && r.problems.length ? `  problems: ${r.problems.join(' | ')}` : ''}`);
  for (const s of bad) console.log(`    ✗ ${s.name}: ${s.failures.join('; ')}`);
  if (r.warnings && r.warnings.length) console.log(`    ! ${r.warnings.join(' | ')}`);
  if (!r.ok) failed += 1;
  fs.rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.log(`${failed} template(s) failing`); process.exit(1); }
console.log('all templates pass');
