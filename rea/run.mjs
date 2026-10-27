// Runs REA (Reverse Engineer Anything) against each public competitor page:
// a scripted Chrome visit, then export of the scripts it loaded, then REA's
// static JavaScript analysis. Raw captures stay in rea/raw (uploaded as a
// workflow artifact, never committed); rea/out gets only derived summaries.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9333';
const ROOT = path.resolve('rea');
const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'targets.json'), 'utf8'));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const rea = (args, timeout = 240000) => {
  try {
    return { ok: true, out: execFileSync('npx', ['rea', ...args, '--format', 'json'], { encoding: 'utf8', timeout, maxBuffer: 512 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message).slice(0, 4000) };
  }
};

for (const t of targets) {
  if (only && !only.includes(t.name)) continue;
  const raw = path.join(ROOT, 'raw', t.name);
  fs.mkdirSync(raw, { recursive: true });
  const log = (m) => { console.log(`[${t.name}] ${m}`); fs.appendFileSync(path.join(raw, 'log.txt'), m + '\n'); };
  const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const scenario = {
    browser: { mode: 'connect', cdp_endpoint: CDP, target_id: tab.id },
    start_url: { url: t.url },
    environment: { viewport: t.viewport || { width: 390, height: 844, device_scale_factor: 2 }, service_workers: 'allow' },
    // Either step down the page a screen at a time (a screenshot after each step), or jump to the end twice.
    actions: t.steps ? [
      { step_id: 'settle', action: 'wait_for_timeout', duration_ms: 6000 },
      ...Array.from({ length: t.steps }, (_, i) => [
        { step_id: `down${i + 1}`, action: 'press', locator: { kind: 'css', selector: 'body' }, key: 'PageDown', timeout_ms: 8000 },
        { step_id: `look${i + 1}`, action: 'wait_for_timeout', duration_ms: 1200 },
      ]).flat(),
    ] : [
      { step_id: 'settle', action: 'wait_for_timeout', duration_ms: 6000 },
      { step_id: 'scroll1', action: 'press', locator: { kind: 'css', selector: 'body' }, key: 'End', timeout_ms: 8000 },
      { step_id: 'more', action: 'wait_for_timeout', duration_ms: 4000 },
      { step_id: 'scroll2', action: 'press', locator: { kind: 'css', selector: 'body' }, key: 'End', timeout_ms: 8000 },
      { step_id: 'final', action: 'wait_for_timeout', duration_ms: 4000 },
    ],
    capture: t.steps
      ? { after_each_step: ['screenshot'], at_end: ['url', 'accessibility'], events: ['network', 'console', 'page-errors'], network: { response_body: true } }
      : { at_end: ['url', 'accessibility', 'screenshot'], events: ['network', 'console', 'page-errors'], network: { response_body: true } },
  };
  fs.writeFileSync(path.join(raw, 'scenario.json'), JSON.stringify(scenario, null, 2));
  let r = rea(['capture-browser-scenario', path.join(raw, 'scenario.json')]);
  fs.writeFileSync(path.join(raw, 'capture.json'), r.out || '{}');
  log(`capture: ${r.ok ? 'ok' : 'failed'} ${r.err ? r.err.slice(0, 300) : ''} (${(r.out || '').length} bytes)`);
  // The scroll steps can fail on pages without a focusable body; retry without them.
  if (!r.ok) {
    scenario.actions = [{ step_id: 'settle', action: 'wait_for_timeout', duration_ms: 9000 }];
    const tab2 = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
    scenario.browser.target_id = tab2.id;
    fs.writeFileSync(path.join(raw, 'scenario.json'), JSON.stringify(scenario, null, 2));
    r = rea(['capture-browser-scenario', path.join(raw, 'scenario.json')]);
    fs.writeFileSync(path.join(raw, 'capture.json'), r.out || '{}');
    log(`capture (no scroll): ${r.ok ? 'ok' : 'failed'} ${r.err ? r.err.slice(0, 300) : ''}`);
  }
  if (r.ok) {
    const scripts = path.join(raw, 'scripts');
    const e = rea(['export-web-scripts', path.join(raw, 'capture.json'), scripts]);
    fs.writeFileSync(path.join(raw, 'export.json'), e.out || '{}');
    log(`export scripts: ${e.ok ? 'ok' : 'failed ' + (e.err || '').slice(0, 300)}`);
    const files = path.join(scripts, 'files');
    if (e.ok && fs.existsSync(files)) {
      const a = rea(['analyze-javascript-application', files], 300000);
      fs.writeFileSync(path.join(raw, 'analysis.json'), a.out || '{}');
      log(`analyze javascript: ${a.ok ? 'ok' : 'failed ' + (a.err || '').slice(0, 300)} (${(a.out || '').length} bytes)`);
    }
  }
  try { await fetch(`${CDP}/json/close/${tab.id}`); } catch {}
}
