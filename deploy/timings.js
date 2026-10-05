#!/usr/bin/env node
// Where the time goes, per project, from the idea files: crew work by role,
// waits on GitHub Actions and cluster rollouts, and wall-clock. Printed in
// the deploy log so build speed is judged from numbers.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data', 'ideas');
const fmt = (ms) => {
  if (!ms) return '0m';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
};
let files = [];
try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { console.log('(no ideas yet)'); process.exit(0); }
const projects = files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
  .filter((i) => i && i.phase === 'project' && i.project);
if (!projects.length) { console.log('(no projects yet)'); process.exit(0); }

for (const i of projects) {
  const p = i.project;
  const msgs = (i.messages || []).filter((m) => m.ts).sort((a, b) => a.ts - b.ts);
  const by = (pred) => msgs.filter(pred).reduce((s, m) => s + (m.durationMs || 0), 0);
  const tasks = p.tasks || [];
  const dev = tasks.reduce((s, t) => s + (t.durationMs || 0), 0);
  const planning = by((m) => m.kind === 'doc' && ['pm', 'lead_architect', 'dba'].includes(m.agentId)) + by((m) => m.kind === 'doc' && m.agentId === 'ux' && m.docKey !== 'design_review');
  const techlead = by((m) => m.agentId === 'techlead');
  const review = by((m) => m.agentId === 'reviewer');
  const qa = by((m) => m.agentId === 'qa');
  const design = by((m) => m.agentId === 'ux' && m.docKey === 'design_review');
  const devops = by((m) => m.agentId === 'devops' && m.kind === 'doc');
  // Waits: pushed → image built (or CI failed); image built → next event.
  let ciWait = 0, rollout = 0, pushes = 0, ciFails = 0, rolloutFails = 0;
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    const s = m.summary || '';
    if (/^Code pushed to GitHub/.test(s)) {
      pushes++;
      const end = msgs.slice(k + 1).find((x) => /^(Container image built|GitHub Actions failed)/.test(x.summary || ''));
      if (end) ciWait += end.ts - m.ts;
    }
    if (/^Container image built/.test(s)) {
      const end = msgs.slice(k + 1).find((x) => x.kind === 'deployed' || /^(Rollout failed|The site needs|GitHub Actions failed|Code pushed)/.test(x.summary || '') || x.kind === 'system' && /stopped/i.test(x.summary || ''));
      if (end) rollout += end.ts - m.ts;
    }
    if (/^GitHub Actions failed/.test(s)) ciFails++;
    if (/^Rollout failed/.test(s)) rolloutFails++;
  }
  const first = msgs[0]?.ts || 0, last = msgs[msgs.length - 1]?.ts || 0;
  const crewTotal = dev + planning + techlead + review + qa + design + devops;
  const wall = last - first;
  const idle = Math.max(0, wall - crewTotal - ciWait - rollout);
  console.log(`-- ${i.title} (${p.stage || '?'}, ${i.status})`);
  console.log(`   wall-clock ${fmt(wall)} = crew ${fmt(crewTotal)} + GitHub Actions waits ${fmt(ciWait)} + rollouts ${fmt(rollout)} + idle/paused/owner ${fmt(idle)}`);
  console.log(`   crew: planning ${fmt(planning)} · tech lead ${fmt(techlead)} · developers ${fmt(dev)} over ${tasks.length} tasks (avg ${fmt(tasks.length ? dev / tasks.length : 0)}) · code review ${fmt(review)} · QA ${fmt(qa)} · design review ${fmt(design)} · devops ${fmt(devops)} · fix cycles ${p.cycle || 0}`);
  console.log(`   deploys: pushes ${pushes} · CI failures ${ciFails} · rollout failures ${rolloutFails} · live ${p.url ? 'yes' : 'no'}`);
}
