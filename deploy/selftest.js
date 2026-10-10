// CI check before a deploy: the agent kit passes a known-good agent and
// rejects broken ones, packages sign and verify, and the server boots and
// serves the Studio, the Runtime and the locked-down agent worker.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-selftest-'));
process.env.PB_DATA_DIR = path.join(tmp, 'data');

function evalsOn(dir) {
  fs.mkdirSync(path.join(dir, 'agentkit'), { recursive: true });
  for (const f of ['core.js', 'evals.js', 'CONTRACT.md']) fs.copyFileSync(path.join(ROOT, 'lib/kit', f), path.join(dir, 'agentkit', f));
  try { return JSON.parse(execFileSync(process.execPath, ['agentkit/evals.js', '--json'], { cwd: dir, encoding: 'utf8' })); }
  catch (e) { return JSON.parse(e.stdout); }
}

(async () => {
  // 1. A good agent passes.
  const good = path.join(tmp, 'good');
  fs.cpSync(path.join(__dirname, 'fixtures/water'), good, { recursive: true });
  const r = evalsOn(good);
  assert.ok(r.ok, `fixture should pass: ${JSON.stringify(r.problems)} ${JSON.stringify(r.scenarios.filter((s) => !s.pass))}`);
  console.log(`kit: fixture passes ${r.passed}/${r.scenarios.length}`);

  // 2. A sneaky one is refused.
  const bad = path.join(tmp, 'bad');
  fs.cpSync(good, bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'agent.js'), 'async function run(ctx) { await fetch("https://x.y"); await ctx.http.get("https://x.y"); }');
  const rb = evalsOn(bad);
  assert.ok(!rb.ok && rb.problems.some((p) => /fetch/.test(p)) && rb.problems.some((p) => /http/.test(p)), 'bad agent should be refused');
  console.log('kit: forbidden word and undeclared permission refused');

  // 3. Signatures.
  const packages = require('../lib/packages');
  const manifest = JSON.parse(fs.readFileSync(path.join(good, 'agent.json'), 'utf8'));
  const rec = packages.publish({ agent: { id: 'a1b2c3d4e5f6', ownerId: 'x' }, manifest, code: fs.readFileSync(path.join(good, 'agent.js'), 'utf8'), report: r, commit: 'test' });
  assert.ok(packages.verify(rec.package, rec.signature));
  assert.ok(!packages.verify({ ...rec.package, code: `${rec.package.code}//` }, rec.signature));
  console.log('packages: sign, verify, tamper refused');

  // 4. The server boots.
  const port = 3900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PB_PORT: String(port), PB_ADMIN_PASSWORD: 'selftest-password' }, stdio: 'pipe' });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  const get = (p) => fetch(`http://localhost:${port}${p}`);
  try {
    for (let i = 0; i < 40; i++) { try { await get('/api/session'); break; } catch { await new Promise((ok) => setTimeout(ok, 250)); } }
    assert.strictEqual((await get('/')).status, 200);
    assert.strictEqual((await get('/runtime')).status, 200);
    assert.strictEqual((await get('/api/agents')).status, 401);
    const w = await get('/agent-worker.js');
    assert.match(w.headers.get('content-security-policy') || '', /connect-src 'none'/);
    assert.strictEqual((await get('/agent-core.js')).status, 200);
    console.log('server: Studio, Runtime, worker policy and sign-in all as expected');
  } catch (e) { console.error(log); throw e; } finally { srv.kill('SIGKILL'); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('selftest: all good');
})().catch((e) => { console.error(`selftest FAILED: ${e.message}`); process.exit(1); });
