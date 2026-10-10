// The crew that turns an Agent Brief into a signed, tested agent package.
//
//   planning   Agent Architect writes the plan (manifest, ctx design, scenarios)
//   plan_review the owner approves or replies
//   building   Agent Developer implements; Pocket Box runs the evals itself;
//              the Evaluator reviews and adds adversarial scenarios; up to
//              three fix cycles
//   release    Pocket Box bumps the version, signs the package and installs it
//              on the owner's phones in shadow mode (or live, for updates to a
//              live agent)
//
// Every crew turn is Claude Code on the owner's plan, as the unprivileged build
// user inside the sandbox, with file tools and `node` only.

const fs = require('fs');
const path = require('path');
const { askClaude, splitSummary } = require('./claude');
const { saveAgent, addMessage } = require('./store');
const bus = require('./bus');
const ws = require('./workspace');
const packages = require('./packages');
const { aboutMe, setStatus, transcript } = require('./room');
const { tell } = require('./notify');
const { validateManifest } = require('./kit/core');

const MIN = 60 * 1000;
const MAX_CYCLES = 3;
const CONTRACT = fs.readFileSync(path.join(__dirname, 'kit', 'CONTRACT.md'), 'utf8');

const CREW = {
  architect: {
    name: 'Agent Architect', emoji: '📐', model: 'opus',
    system: `You are the Agent Architect on the Pocket Box crew. You turn an approved Agent Brief into a build plan a developer can implement in one session, following the agent contract exactly. You decide the manifest (permissions, triggers, settings, budget), the shape of run(ctx), memory keys, how every failure is handled, and the eval scenarios. Prefer plain code and rules over models; use model or handoff only where the brief truly needs language understanding, and always with a non-model fallback. Never plan anything the contract cannot do.`,
  },
  developer: {
    name: 'Agent Developer', emoji: '🛠️', model: 'sonnet',
    system: `You are the Agent Developer on the Pocket Box crew. You implement agents in this repository exactly to the contract in agentkit/CONTRACT.md: agent.json, agent.js and evals/*.json. Write small, readable, defensive code. Run \`node agentkit/evals.js\` after every change and keep going until it prints "All good". Never edit anything under agentkit/. Never weaken a scenario to make it pass: fix the agent. You cannot use the network.`,
  },
  evaluator: {
    name: 'Evaluator', emoji: '🧪', model: 'sonnet',
    system: `You are the Evaluator on the Pocket Box crew, the last check before an agent reaches the owner's phone. Read the brief, the plan and the code. Run \`node agentkit/evals.js\`. Then add 2-4 NEW adversarial scenarios as evals/review-<short-name>.json for failure modes the brief cares about that the existing scenarios miss (feed down, empty data, a late or repeated run, a null model, odd settings) — each must describe behaviour the brief clearly requires, never your own preference. Run the evals again. You may only create files named evals/review-*.json; never edit agent.js, agent.json or other scenarios.`,
  },
};

function base(a) {
  const about = aboutMe(a.ownerId);
  return [
    `THE AGENT BRIEF (approved by the owner):\n${a.brief}`,
    a.plan ? `THE BUILD PLAN:\n${a.plan}` : '',
    about ? `ABOUT THE OWNER:\n${about}` : '',
    `THE AGENT CONTRACT (agentkit/CONTRACT.md):\n${CONTRACT}`,
  ].filter(Boolean).join('\n\n');
}

function checkStop(a) { if (bus.stopping(a.id)) throw new Error('__paused__'); }

function thinking(a, agentId, label) {
  bus.setThinking(a.id, { agentId, label });
  bus.publish(a, { event: 'thinking', expertId: agentId, name: CREW[agentId]?.name || 'Pocket Box', emoji: CREW[agentId]?.emoji || '📦', label });
}

function note(a, summary, content) {
  const msg = addMessage(a, { agentId: 'system', agentName: 'Pocket Box', emoji: '📦', kind: 'system', summary, content: content || summary });
  saveAgent(a);
  bus.publish(a, { event: 'message', message: msg });
  return msg;
}

async function crewTurn(a, who, prompt, { tools = [], cwd, kind = 'turn', timeoutMs = 20 * MIN, docKey } = {}) {
  const c = CREW[who];
  thinking(a, who, `${c.name} is working`);
  const res = await askClaude({
    system: c.system, model: c.model, prompt, tools, cwd, timeoutMs,
    runAs: cwd ? ws.buildUser() : null,
    onActivity: cwd ? (act) => bus.publish(a, { event: 'activity', expertId: who, activity: act }) : undefined,
  });
  const { summary, content } = splitSummary(res.text);
  const msg = addMessage(a, { agentId: who, agentName: c.name, emoji: c.emoji, kind, docKey, summary, content, durationMs: res.durationMs, toolCalls: res.toolCalls });
  a.crewMs = (a.crewMs || 0) + (res.durationMs || 0);
  saveAgent(a);
  bus.publish(a, { event: 'message', message: msg });
  return { msg, summary, content };
}

// ---- planning ---------------------------------------------------------------

async function runPlanning(a, { feedback } = {}) {
  if (!bus.start(a.id)) return;
  setStatus(a, 'running', { error: null, stage: 'planning' });
  try {
    const r = await crewTurn(a, 'architect', `${base(a)}\n\n${feedback ? `THE OWNER'S FEEDBACK ON YOUR PLAN:\n"""\n${feedback}\n"""\nRevise the plan to address it.\n\n` : ''}YOUR TASK: write the build plan. First line "SUMMARY: <one sentence>", then markdown with these sections:
## Manifest (a complete agent.json in a json code block: id slug, name, icon, description, version "1.0.0", permissions, http.allow if any, triggers, settings, budget)
## How run(ctx) works (numbered steps, including every early return)
## Memory keys (key → value shape → why)
## Failure handling (each failure → exact behaviour)
## Eval scenarios (6-8: file name, situation, fixtures, expected outcome; at least two failures)
## What the owner must provide (each setting, where to find it)
## Shadow-mode check (what the owner should see during the first day for this agent to go live)`, { kind: 'plan', docKey: 'plan', timeoutMs: 12 * MIN });
    a.plan = r.content;
    a.planAt = Date.now();
    setStatus(a, 'idle', { stage: 'plan_review' });
    tell(a, { title: 'Plan ready', body: `${a.title}: approve it or reply with changes.` });
  } catch (e) {
    if (e.message === '__paused__') setStatus(a, 'paused');
    else setStatus(a, 'error', { error: e.message });
  } finally { bus.finish(a.id); }
}

// ---- building ---------------------------------------------------------------

function addTask(a, { title, description, source }) {
  a.tasks = a.tasks || [];
  const t = { id: `T${a.tasks.length + 1}`, title: String(title).slice(0, 120), description: String(description || title), source: source || 'plan', status: 'todo', createdAt: Date.now() };
  a.tasks.push(t);
  return t;
}

function reportText(r) {
  const lines = [...(r.problems || []).map((p) => `✗ ${p}`), ...(r.warnings || []).map((w) => `! ${w}`)];
  for (const s of r.scenarios || []) {
    lines.push(`${s.pass ? '✓' : '✗'} ${s.name}${s.file ? ` (${s.file})` : ''}`);
    for (const f of s.failures || []) lines.push(`    - ${f}`);
  }
  lines.push(r.ok ? `All good: ${r.passed} scenario(s) passed.` : `Not ready: ${(r.problems || []).length} problem(s), ${r.failed || 0} failing scenario(s).`);
  return lines.join('\n');
}

async function devTurn(a, task, lastReport) {
  task.status = 'doing';
  saveAgent(a);
  bus.publish(a, { event: 'tasks', tasks: a.tasks });
  const files = ws.listFiles(a.id).filter((f) => !f.startsWith('agentkit/'));
  const r = await crewTurn(a, 'developer', `${base(a)}\n\nFILES IN THE REPOSITORY NOW:\n${files.join('\n') || '(only agentkit/)'}\n\n${lastReport ? `THE LAST EVAL REPORT (run by Pocket Box):\n${reportText(lastReport)}\n\n` : ''}YOUR TASK — ${task.id}: ${task.title}\n${task.description}\n\nImplement it in this repository (agent.json, agent.js, evals/*.json), run \`node agentkit/evals.js\` until it prints "All good", then reply: first line "SUMMARY: <what you did>", then a short report, then a final line "STATUS: done" or "STATUS: blocked — <why>".`, { tools: ws.DEV_TOOLS, cwd: ws.repoDir(a.id), kind: 'task', timeoutMs: 30 * MIN });
  const blocked = /STATUS:\s*blocked/i.test(r.content);
  task.status = blocked ? 'blocked' : 'done';
  task.report = r.summary;
  task.commit = await ws.commitAll(a.id, `${task.id}: ${task.title}\n\n${r.summary}`);
  saveAgent(a);
  bus.publish(a, { event: 'tasks', tasks: a.tasks });
}

async function gate(a) {
  thinking(a, 'evaluator', 'Pocket Box is running the evals');
  const report = await ws.runEvals(a.id);
  a.evals = { ok: report.ok, passed: report.passed, total: (report.scenarios || []).length, problems: (report.problems || []).length, at: Date.now() };
  saveAgent(a);
  note(a, report.ok ? `Evals pass: ${report.passed} of ${report.scenarios.length}` : `Evals not passing yet: ${report.failed || 0} failing, ${(report.problems || []).length} problem(s)`, `\`\`\`\n${reportText(report)}\n\`\`\``);
  return report;
}

function parseIssues(text) {
  const m = String(text).match(/```json\s*([\s\S]*?)```/);
  if (!m) return [];
  try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v.filter((x) => x && x.title).slice(0, 8) : []; } catch { return []; }
}

async function runBuild(a, { feedback } = {}) {
  if (!bus.start(a.id)) return;
  setStatus(a, 'running', { error: null, stage: a.stage === 'shadow' || a.stage === 'live' ? a.stage : 'building' });
  const wasStage = a.stage;
  try {
    await ws.ensureRepo(a.id, { readme: `# ${a.title}\n\nA Pocket Box agent. See agentkit/CONTRACT.md.\n` });
    a.tasks = a.tasks || [];
    for (const t of a.tasks) if (t.status === 'doing') t.status = 'todo';
    if (!a.tasks.length) addTask(a, { title: 'Build v1 from the plan', description: 'Implement agent.json, agent.js and every eval scenario the plan lists, exactly as planned.' });
    if (feedback) { addTask(a, { title: 'Owner request', description: `The owner asked:\n"""\n${feedback}\n"""\nChange the agent to do this, update or add eval scenarios that prove it, keep every other scenario passing.`, source: 'owner' }); a.cycle = 0; }
    saveAgent(a);
    bus.publish(a, { event: 'tasks', tasks: a.tasks });

    let report = null;
    for (;;) {
      for (let t = a.tasks.find((x) => x.status === 'todo'); t; t = a.tasks.find((x) => x.status === 'todo')) {
        checkStop(a);
        await devTurn(a, t, report);
      }
      checkStop(a);
      report = await gate(a);
      if (!report.ok) {
        if ((a.fixTries || 0) >= 2) throw new Error('The evals still fail after three attempts. Read the last report in the thread, then reply with guidance or tap Resume.');
        a.fixTries = (a.fixTries || 0) + 1;
        addTask(a, { title: 'Make the evals pass', description: 'Pocket Box ran the evals and they do not pass. Fix the agent (not the scenarios, unless a scenario contradicts the brief) until `node agentkit/evals.js` prints "All good".', source: 'evals' });
        continue;
      }
      a.fixTries = 0;
      checkStop(a);
      const review = await crewTurn(a, 'evaluator', `${base(a)}\n\nTHE EVAL REPORT FROM POCKET BOX:\n${reportText(report)}\n\nYOUR TASK: evaluate the agent (cycle ${a.cycle + 1} of ${MAX_CYCLES}). Reply: first line "SUMMARY: <verdict in one sentence>", then "# Evaluation" with ## Scenarios added, ## What I checked, ## Issues (numbered, each with the scenario that shows it), a line "VERDICT: PASS" or "VERDICT: FAIL", and a fenced json block listing the open issues as tasks: [{"title":"...","description":"what to change and the scenario that must pass"}] (empty list when passing).`, { tools: ws.REVIEW_TOOLS, cwd: ws.repoDir(a.id), kind: 'evaluation', timeoutMs: 20 * MIN });
      await ws.commitAll(a.id, `Evaluation, cycle ${a.cycle + 1}`);
      checkStop(a);
      report = await gate(a);
      const issues = parseIssues(review.content);
      const pass = /VERDICT:\s*PASS/i.test(review.content) && report.ok;
      if (pass || a.cycle + 1 >= MAX_CYCLES) {
        if (!report.ok) throw new Error('The evals do not pass after the last fix cycle. Read the report in the thread, then reply with guidance or tap Resume.');
        if (!pass) note(a, `Releasing after ${MAX_CYCLES} cycles with open review notes`, issues.map((i) => `- ${i.title}`).join('\n') || 'See the evaluation above.');
        break;
      }
      a.cycle += 1;
      const added = (issues.length ? issues : [{ title: 'Address the evaluation', description: 'Fix what the Evaluator reported and make every scenario, including the review-* ones, pass.' }]).map((i) => addTask(a, { title: i.title, description: i.description || i.title, source: 'evaluation' }));
      saveAgent(a);
      note(a, `Fix cycle ${a.cycle}: ${added.length} task(s)`, added.map((t) => `- ${t.id} ${t.title}`).join('\n'));
    }
    checkStop(a);
    await release(a, report, wasStage);
  } catch (e) {
    if (e.message === '__paused__') setStatus(a, 'paused');
    else { setStatus(a, 'error', { error: e.message }); tell(a, { title: 'The crew stopped', body: `${a.title}: ${e.message.slice(0, 120)}` }); }
  } finally { bus.finish(a.id); }
}

function bump(version, kind) {
  const [M, m, p] = String(version || '0.0.0').split('.').map((x) => Number(x) || 0);
  return kind === 'minor' ? `${M}.${m + 1}.0` : `${M}.${m}.${p + 1}`;
}

async function release(a, report, wasStage) {
  thinking(a, 'evaluator', 'Signing the package');
  const dir = ws.repoDir(a.id);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'agent.json'), 'utf8'));
  const code = fs.readFileSync(path.join(dir, 'agent.js'), 'utf8');
  const prev = packages.load(a.id);
  const prevManifest = prev?.package?.manifest;
  const permsChanged = prevManifest && JSON.stringify([...(prevManifest.permissions || [])].sort()) !== JSON.stringify([...(manifest.permissions || [])].sort());
  manifest.version = prevManifest ? bump(prevManifest.version, permsChanged ? 'minor' : 'patch') : '1.0.0';
  const problems = validateManifest(manifest);
  if (problems.length) throw new Error(`agent.json is not valid: ${problems.join(' ')}`);
  fs.writeFileSync(path.join(dir, 'agent.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const commit = (await ws.commitAll(a.id, `Release ${manifest.version}`)) || (await ws.head(a.id));
  // A live agent whose permissions changed goes back to shadow mode.
  const channel = !prev ? 'shadow' : (permsChanged ? 'shadow' : prev.channel === 'off' ? 'shadow' : prev.channel);
  const rec = packages.publish({ agent: a, manifest, code, report, commit, channel });
  a.icon = manifest.icon || a.icon;
  a.title = manifest.name || a.title;
  a.release = { version: manifest.version, channel: rec.channel, publishedAt: rec.publishedAt, evals: `${report.passed}/${report.scenarios.length}`, permissions: manifest.permissions, triggers: manifest.triggers };
  a.missingSettings = require('./settings').missing(a.id, manifest);
  const stage = rec.channel === 'live' ? 'live' : 'shadow';
  setStatus(a, 'idle', { stage });
  note(a, `Version ${manifest.version} is on your phone${rec.channel === 'shadow' ? ' in shadow mode' : ''}`,
    `${rec.channel === 'shadow' ? 'For its first day the agent runs on its real triggers but only records what it would have done. Open the Runtime on your phone to watch it, then tap Go live.' : 'Your phones pick it up the next time the Runtime opens.'}${permsChanged ? '\n\nIts permissions changed, so it is back in shadow mode until you approve it again.' : ''}${a.missingSettings.length ? `\n\nIt needs ${a.missingSettings.length === 1 ? 'a setting' : 'settings'} from you first: ${a.missingSettings.join(', ')}.` : ''}`);
  tell(a, { title: rec.channel === 'shadow' ? 'Agent installed in shadow mode' : 'Agent updated', body: `${a.title} ${manifest.version}${a.missingSettings.length ? ': it needs your settings' : ''}` });
  if (wasStage === 'live' && rec.channel === 'live') bus.publish(a, { event: 'released', release: a.release });
}

// ---- the owner's notes, questions and feedback ---------------------------------

async function triage(a, text) {
  const res = await askClaude({
    model: 'sonnet',
    system: 'You are the Agent Architect of Pocket Box talking to the owner of a personal phone agent, who is not technical. Decide if their note is a QUESTION (they want information) or a CHANGE (they want the agent to behave differently, or something fixed). Answer questions directly and concretely in under 150 words, from the facts given; never invent values. Where things are: the agent\'s settings are on its page under Settings; runs and what it did are under Runs; the code under Code; the Runtime on the phone at /runtime. Reply with only a fenced json block: {"kind":"question"|"change","answer":"..."} (answer only for questions).',
    prompt: `AGENT: ${a.title} (stage ${a.stage}${a.release ? `, version ${a.release.version} on the ${a.release.channel} channel` : ''})\n\nBRIEF:\n${a.brief || '(none)'}\n\nRECENT THREAD:\n${transcript(a, 5000)}\n\nTHE OWNER'S NOTE:\n"""\n${text}\n"""`,
    timeoutMs: 4 * MIN,
  });
  const m = res.text.match(/```json\s*([\s\S]*?)```/) || [null, res.text];
  try { return JSON.parse(m[1]); } catch { return { kind: 'change' }; }
}

/** The owner wrote in the thread. Route it to the room, the architect or the crew. */
async function onOwnerMessage(a, text) {
  if (bus.running(a.id)) return; // the room and crew read it on their next turn
  const room = require('./room');
  if (a.stage === 'room' || a.stage === 'brief') {
    if (/\?\s*$/.test(text.trim()) && text.length < 300) return room.answer(a, text);
    return room.runRoom(a, { extraRounds: 1 });
  }
  if (a.stage === 'plan_review' || a.stage === 'planning') return runPlanning(a, { feedback: text });
  if (!bus.start(a.id)) return;
  let verdict;
  try {
    setStatus(a, 'running');
    thinking(a, 'architect', 'Reading your note');
    verdict = await triage(a, text);
    if (verdict.kind === 'question' && verdict.answer) {
      const msg = addMessage(a, { agentId: 'architect', agentName: CREW.architect.name, emoji: CREW.architect.emoji, kind: 'answer', summary: String(verdict.answer).slice(0, 160), content: String(verdict.answer) });
      saveAgent(a);
      bus.publish(a, { event: 'message', message: msg });
    }
    setStatus(a, a.status === 'running' ? 'idle' : a.status);
  } catch (e) { setStatus(a, 'error', { error: e.message }); return; }
  finally { bus.finish(a.id); }
  if (verdict.kind !== 'question') return runBuild(a, { feedback: text });
}

/** Resume whatever the stage calls for. */
function resume(a) {
  const room = require('./room');
  if (a.stage === 'room') return room.runRoom(a);
  if (a.stage === 'planning') return runPlanning(a);
  if (['building', 'shadow', 'live'].includes(a.stage)) return runBuild(a);
  throw Object.assign(new Error('Nothing to resume.'), { status: 409 });
}

module.exports = { CREW, runPlanning, runBuild, onOwnerMessage, resume, reportText };
