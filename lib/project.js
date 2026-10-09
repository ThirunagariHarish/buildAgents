// Project engine: takes a promoted idea through planning, build, test, deploy,
// review and maintenance with the crew in lib/crew.js.
//
// Stages:
//   planning → design → plan_review (owner approves or sends feedback)
//   → building (Tech Lead plans tasks; developers work them one by one)
//   → testing (QA + Design review; issues become fix tasks, up to 3 cycles)
//   → deploy_setup (if Box has no GitHub/cluster credentials yet) or
//     deploying (DevOps files → GitHub → image → k3s) → review (owner tries
//     the live site; feedback becomes fix tasks) → maintenance (Mark complete;
//     later notes become fix/feature tasks through the same cycle).

const fs = require('fs');
const path = require('path');
const { askClaude, splitSummary } = require('./claude');
const { CREW, PLANNING_ORDER, PLATFORM_CONTEXT, DESIGN_REVIEW_SYSTEM } = require('./crew');
const { saveIdea, addMessage } = require('./store');
const { saveGenerated, getUpload, importFile } = require('./uploads');
const prefs = require('./prefs');
const runners = require('./runners');
const builder = require('./builder');
const deploy = require('./deploy');
const { notify, progress, tell } = require('./notify');

const WORK_DIR = builder.WORK_DIR;
const MAX_FIX_CYCLES = 3;
const MIN = 60 * 1000;

function emit(bus, idea, event, payload) {
  bus.publish(idea.id, { event, ...payload });
}

const STAGE_WORDS = { planning: 'Planning: the crew is writing the documents', design: 'Designing: the UX Designer is on the prototypes', building: 'Building', testing: 'Testing: code review, QA and design review', deploying: 'Deploying to the cluster' };
function setStage(bus, idea, stage) {
  const prev = idea.project.stage;
  idea.project.stage = stage;
  saveIdea(idea);
  emit(bus, idea, 'stage', { stage });
  if (prev !== stage && STAGE_WORDS[stage]) progress(idea, STAGE_WORDS[stage]);
}

function checkStop(idea) {
  if (runners.stopping(idea.id)) throw new Error('__paused__');
}

function thinking(bus, idea, agentId, label, kind = 'doc') {
  runners.setThinking(idea.id, { agentId, label });
  emit(bus, idea, 'agent_thinking', { agentId, kind, round: idea.round, label });
}

/** Live activity from a working agent (file edits, commands), kept briefly on the project. */
function activity(bus, idea, agentId, taskId, a) {
  const p = idea.project;
  p.activity = [...(p.activity || []), { agentId, taskId, ...a }].slice(-40);
  emit(bus, idea, 'activity', { agentId, taskId, ...a });
}

function systemNote(bus, idea, summary, content, extra = {}) {
  const msg = addMessage(idea, { agentId: 'system', kind: 'system', round: idea.round, summary, content: content || summary, ...extra });
  emit(bus, idea, 'message', { message: msg });
  return msg;
}

function publicDocs(idea) {
  return Object.fromEntries(Object.entries(idea.project.docs || {}).map(([k, d]) => [k, { ...d, content: undefined }]));
}

function storeDoc(bus, idea, agent, key, title, content, { summary, res, attachments = [], extra = {} }) {
  idea.project.docs = idea.project.docs || {};
  const prev = idea.project.docs[key];
  idea.project.docs[key] = {
    key, title, agentId: agent.id, agentName: agent.name, content,
    updatedAt: Date.now(), version: (prev?.version || 0) + 1,
    previous: prev ? prev.content : undefined, // for "what changed"
    ...extra, // e.g. verdict: pass|fail for reviews
  };
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: agent.id, agentName: agent.name, kind: 'doc', docKey: key, docTitle: title,
    round: idea.round, summary, content, attachments, model: res?.model, durationMs: res?.durationMs, ...extra,
  });
  emit(bus, idea, 'message', { message: msg });
  emit(bus, idea, 'docs', { docs: publicDocs(idea), prototype: idea.project.prototype || null });
  return msg;
}

/** The debate's decisions, compactly: the Orchestrator's syntheses plus the brief. */
function debateDigest(idea) {
  const syntheses = idea.messages.filter((m) => m.kind === 'synthesis').map((m) => m.content);
  return syntheses.length ? `DECISIONS FROM THE IDEA DEBATE (Orchestrator syntheses):\n${syntheses.join('\n\n')}\n` : '';
}

function notesSince(idea, ts) {
  return idea.messages.filter((m) => m.kind === 'user' && m.ts >= ts).map((m) => `- ${m.content}`).join('\n');
}

function docText(idea, key) {
  const d = (idea.project.docs || {})[key];
  return d ? `=== ${d.title.toUpperCase()} (by ${d.agentName}) ===\n${d.content}` : '';
}

function docsText(idea, keys, except) {
  return keys.filter((k) => k !== except).map((k) => docText(idea, k)).filter(Boolean).join('\n\n');
}

const PLAN_DOCS = ['requirements', 'architecture', 'data_model', 'ux_direction'];

function parseJsonBlock(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function stripJsonBlocks(text) {
  return text.replace(/```json[\s\S]*?```/gi, '').trim();
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function planningContext(idea, agent, { feedback } = {}) {
  const p = idea.project;
  const notes = notesSince(idea, p.promotedAt);
  return [
    `HOUSE STANDARDS:\n${PLATFORM_CONTEXT}`,
    prefs.context(idea.ownerId).text,
    `THE ORIGINAL IDEA (verbatim):\n"""\n${idea.text}\n"""`,
    `THE APPROVED IDEA BRIEF:\n${idea.brief}`,
    debateDigest(idea),
    `PROJECT: "${idea.title}" — repo and address name: ${p.slug} (${deploy.siteUrl(p.slug)})`,
    notes ? `NOTES FROM THE OWNER TO THE TEAM:\n${notes}` : '',
    feedback ? `THE OWNER REVIEWED THE PLAN AND ASKED FOR CHANGES. Their feedback, which overrides anything above:\n"""\n${feedback}\n"""\nRevise your document to address it fully; keep what wasn't questioned.` : '',
    docsText(idea, PLAN_DOCS, agent.doc) ? `DOCUMENTS ALREADY WRITTEN BY THE CREW:\n${docsText(idea, PLAN_DOCS, agent.doc)}` : '',
    (idea.project.docs || {})[agent.doc] ? `YOUR PREVIOUS VERSION OF THIS DOCUMENT (revise it, don't start over):\n${idea.project.docs[agent.doc].content}` : '',
  ].filter(Boolean).join('\n\n');
}

async function crewTurn(bus, idea, agentId, extra = {}) {
  const agent = CREW[agentId];
  thinking(bus, idea, agentId, `${agent.name} is writing the ${agent.docTitle.toLowerCase()}`);
  const cwd = path.join(WORK_DIR, idea.project.slug, agentId);
  fs.mkdirSync(cwd, { recursive: true });
  const res = await askClaude({
    prompt: `${planningContext(idea, agent, extra)}\n\nYOUR TASK NOW: write the "${agent.docTitle}" document for this project.${agentId === 'ux' ? ' Then write prototype.html in the current directory with the Write tool.' : ''}`,
    system: agent.system,
    model: agent.model,
    tools: agent.tools || [],
    cwd,
    timeoutMs: 20 * MIN,
  });
  const { summary, content } = splitSummary(res.text);
  let attachments = [];
  if (agentId === 'ux') {
    const protos = [];
    for (const [file, label] of [['prototype.html', 'A'], ['prototype-b.html', 'B']]) {
      const f = path.join(cwd, file);
      if (!fs.existsSync(f)) continue;
      const html = fs.readFileSync(f, 'utf8');
      if (html.length > 200) protos.push({ ...saveGenerated({ name: file, type: 'text/html', content: html }), direction: label });
    }
    if (protos.length) {
      idea.project.prototypes = protos;
      idea.project.prototype = protos[0];
      idea.project.designChoice = protos.length > 1 ? null : 'A';
      attachments = protos;
    }
    const tokens = parseJsonBlock(content);
    if (tokens && typeof tokens === 'object') idea.project.tokens = tokens;
  }
  return storeDoc(bus, idea, agent, agent.doc, agent.docTitle, content, { summary, res, attachments });
}

/** The owner picks design direction A or B; the developers build that one. */
function chooseDesign(bus, idea, choice) {
  const p = idea.project;
  const list = p.prototypes || (p.prototype ? [{ ...p.prototype, direction: 'A' }] : []);
  const pick = list.find((x) => x.direction === choice);
  if (!pick) throw new Error('No such design direction.');
  p.prototype = pick;
  p.designChoice = choice;
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: 'user', kind: 'user', round: idea.round,
    summary: `Design direction ${choice} chosen`, content: `Design decision: build Direction ${choice} (${pick.name}). Treat the other prototype as rejected.`,
  });
  emit(bus, idea, 'message', { message: msg });
  emit(bus, idea, 'docs', { docs: publicDocs(idea), prototype: p.prototype });
  return msg;
}

/** Which documents the owner's feedback touches; the PM decides. */
async function triagePlan(idea, feedback) {
  const res = await askClaude({
    model: 'haiku',
    system: 'You route change requests on a software project. Reply with only a comma-separated list of document keys, nothing else.',
    prompt: `The project has four documents: requirements (Project Manager), architecture (Lead Architect), data_model (Database Architect), ux_direction (UX Designer, includes the prototype).\n\nThe owner's feedback:\n"""\n${feedback}\n"""\n\nWhich documents must be revised to address it? Include a document if the feedback changes anything it says. Requirements is included whenever scope or features change. Reply with keys only, e.g. "requirements, ux_direction".`,
  });
  const keys = res.text.toLowerCase().match(/requirements|architecture|data_model|ux_direction/g) || [];
  const order = PLANNING_ORDER.filter((id) => keys.includes(CREW[id].doc));
  return order.length ? order : ['pm'];
}

async function runPlanning(bus, idea, { feedback } = {}) {
  if (!runners.start(idea.id)) return;
  idea.status = 'running';
  idea.error = null;
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });
  try {
    const docs = idea.project.docs || {};
    let agents;
    if (feedback && docs.requirements) {
      thinking(bus, idea, 'pm', 'Project Manager is reading your feedback');
      agents = await triagePlan(idea, feedback);
    } else {
      agents = PLANNING_ORDER.filter((id) => !docs[CREW[id].doc]);
    }
    for (const agentId of agents) {
      checkStop(idea);
      setStage(bus, idea, agentId === 'ux' ? 'design' : 'planning');
      await crewTurn(bus, idea, agentId, { feedback });
    }
    idea.status = 'done';
    saveIdea(idea);
    setStage(bus, idea, 'plan_review');
    emit(bus, idea, 'status', { status: 'done' });
    notify(idea, 'plan_review');
  } catch (err) {
    failRun(bus, idea, err);
  } finally {
    runners.finish(idea.id);
  }
}

function failRun(bus, idea, err) {
  if (err.message === '__paused__') {
    idea.status = 'paused';
    saveIdea(idea);
    emit(bus, idea, 'status', { status: 'paused' });
  } else {
    idea.status = 'error';
    idea.error = err.message;
    saveIdea(idea);
    emit(bus, idea, 'status', { status: 'error', error: err.message });
    notify(idea, 'error');
  }
}

function approvePlan(bus, idea) {
  if (idea.project.stage !== 'plan_review') throw new Error('The plan is not waiting for approval.');
  idea.project.planApprovedAt = Date.now();
  idea.status = 'idle';
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: 'system', kind: 'approved', round: idea.round,
    summary: 'Plan approved', content: 'The owner approved the plan and design. The build crew takes it from here.',
  });
  emit(bus, idea, 'message', { message: msg });
  setStage(bus, idea, 'building');
  return msg;
}

// ---------------------------------------------------------------------------
// Build, test, deploy
// ---------------------------------------------------------------------------

function nextTaskId(p) {
  const n = (p.tasks || []).reduce((m, t) => Math.max(m, Number(String(t.id).replace(/\D/g, '')) || 0), 0) + 1;
  return `T${n}`;
}

function addTasks(idea, list, source) {
  const p = idea.project;
  p.tasks = p.tasks || [];
  const added = [];
  for (const t of list || []) {
    if (!t || !t.title) continue;
    const id = source === 'plan' && t.id && !p.tasks.some((x) => x.id === t.id) ? String(t.id) : nextTaskId(p);
    const task = {
      id, title: String(t.title).slice(0, 120), role: t.role === 'frontend' ? 'frontend' : 'backend',
      size: t.size || 'M', depends: Array.isArray(t.depends) ? t.depends : [],
      description: String(t.description || t.title), files: Array.isArray(t.files) ? t.files : [],
      status: 'todo', source, createdAt: Date.now(),
    };
    p.tasks.push(task);
    added.push(task);
  }
  saveIdea(idea);
  return added;
}

function tasksEvent(bus, idea) {
  emit(bus, idea, 'tasks', { tasks: idea.project.tasks || [] });
}

function buildContext(idea) {
  const p = idea.project;
  return [
    `HOUSE STANDARDS:\n${PLATFORM_CONTEXT}`,
    `PROJECT: "${idea.title}" — repository name: ${p.slug}; it will be live at ${deploy.siteUrl(p.slug)}`,
    builder.servicesText(p.slug),
    `THE APPROVED IDEA BRIEF:\n${idea.brief}`,
    docsText(idea, [...PLAN_DOCS, 'build_plan']),
    p.prototype ? 'The UX Designer\'s clickable prototype is in the repository at design/prototype.html — read it for the look of every screen.' : '',
  ].filter(Boolean).join('\n\n');
}

async function repoState(slug) {
  const [tree, log] = await Promise.all([builder.fileTree(slug), builder.recentCommits(slug)]);
  return `REPOSITORY FILES:\n${tree || '(empty)'}\n\nRECENT COMMITS:\n${log || '(none)'}`;
}

async function techLeadTurn(bus, idea) {
  const agent = CREW.techlead;
  thinking(bus, idea, 'techlead', 'Tech Lead is planning the build');
  const res = await askClaude({
    prompt: `${buildContext(idea)}\n\n${notesSince(idea, idea.project.planApprovedAt || 0) ? `NOTES FROM THE OWNER:\n${notesSince(idea, idea.project.planApprovedAt || 0)}\n\n` : ''}YOUR TASK NOW: write the "Build plan" document with the task list for this project.`,
    system: agent.system,
    model: agent.model,
    timeoutMs: 20 * MIN,
  });
  const { summary, content } = splitSummary(res.text);
  const tasks = parseJsonBlock(content);
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('The Tech Lead did not produce a task list. Tap Resume to try again.');
  storeDoc(bus, idea, agent, 'build_plan', 'Build plan', stripJsonBlocks(content), { summary, res });
  addTasks(idea, tasks, 'plan');
  tasksEvent(bus, idea);
}

const SIZE_COST = { S: 1, M: 2, L: 3 };
/**
 * Consecutive small tasks for the same developer, done in one session: the
 * Tech Lead splits work finely (2–4 minutes a task), and each session
 * spends a good part of that reading the repository. Up to three tasks,
 * one medium-plus-small, or one large, per session.
 */
function pickBatch(todo) {
  const batch = [];
  let cost = 0;
  for (const t of todo) {
    if (batch.length && (t.role !== batch[0].role || t.holdBefore || t.redoNote)) break;
    const c = SIZE_COST[t.size] || 2;
    if (batch.length && cost + c > 3) break;
    const unmet = (t.depends || []).some((d) => { const dep = todo.find((x) => x.id === d); return dep && !batch.includes(dep); });
    if (batch.length && unmet) break;
    batch.push(t);
    cost += c;
    if (batch.length >= 3 || t.redoNote || t.holdBefore) break;
  }
  return batch;
}

/** One developer session for one task or a small batch of consecutive tasks. */
async function devTurn(bus, idea, taskOrTasks) {
  const p = idea.project;
  const tasks = Array.isArray(taskOrTasks) ? taskOrTasks : [taskOrTasks];
  const task = tasks[0];
  const agent = CREW[task.role === 'frontend' ? 'frontend' : 'backend'];
  for (const t of tasks) { t.status = 'doing'; t.agentId = agent.id; t.startedAt = Date.now(); }
  saveIdea(idea);
  tasksEvent(bus, idea);
  const ids = tasks.map((t) => t.id).join(', ');
  thinking(bus, idea, agent.id, `${agent.name} is on ${ids}: ${task.title}${tasks.length > 1 ? ` (+${tasks.length - 1})` : ''}`, 'task');

  const done = (p.tasks || []).filter((t) => t.status === 'done').slice(-4);
  const notes = notesSince(idea, p.planApprovedAt || 0);
  const why = (t) => (t.source === 'qa' ? ', a fix from QA' : t.source === 'review' ? ', a fix from code review' : t.source === 'owner' ? ', requested by the owner' : t.source === 'ci' ? ', a fix for the failed GitHub Actions run' : '');
  const describe = (t) => `${t.id}: ${t.title} (${t.role}, size ${t.size}${why(t)})\n${t.description}${t.files?.length ? `\nFiles likely involved: ${t.files.join(', ')}` : ''}${t.redoNote ? `\n\nTHIS TASK IS BEING REDONE. The owner's instruction for this attempt: """${t.redoNote}"""${t.report ? ` The previous attempt reported: ${t.report}` : ''}` : ''}`;
  const prompt = [
    buildContext(idea),
    await repoState(p.slug),
    done.length ? `WHAT THE PREVIOUS DEVELOPERS REPORTED (most recent last):\n${done.map((t) => `- ${t.id} ${t.title}: ${t.report || ''}`).join('\n')}` : '',
    notes ? `NOTES FROM THE OWNER (apply where relevant):\n${notes}` : '',
    tasks.length === 1
      ? `YOUR TASK NOW — ${describe(task)}\n\nImplement it completely, run the checks, then report.`
      : `YOUR TASKS NOW — ${tasks.length} related tasks, in this order. Do each one completely (they are separate deliverables, not one blurred change), run the checks after the last, then report on each by id.\n\n${tasks.map(describe).join('\n\n')}\n\nIn your report, give one line per task: "<id>: done" or "<id>: blocked — why". If one task cannot be finished, still finish the others.`,
  ].filter(Boolean).join('\n\n');

  let res;
  try {
    res = await askClaude({
      prompt, system: agent.system, model: agent.model, tools: builder.BUILD_TOOLS, cwd: builder.repoDir(p.slug), runAs: builder.buildUser(), timeoutMs: (30 + 10 * tasks.length) * MIN,
      onActivity: (a) => activity(bus, idea, agent.id, task.id, a),
    });
  } catch (e) {
    for (const t of tasks) t.status = 'todo';
    saveIdea(idea);
    tasksEvent(bus, idea);
    throw e;
  }
  const { summary, content } = splitSummary(res.text);
  const allBlocked = /^STATUS:\s*blocked/im.test(content);
  const hash = await builder.commitAll(p.slug, `${ids}: ${task.title}${tasks.length > 1 ? ` (+${tasks.length - 1})` : ''}\n\n${summary}`);
  const share = (res.durationMs || 0) / tasks.length;
  for (const t of tasks) {
    const line = tasks.length > 1 ? (content.match(new RegExp(`^\\W*${t.id}\\W*:?\\s*(done|blocked)[^\\n]*`, 'im')) || [])[0] : null;
    const blocked = line ? /blocked/i.test(line) : allBlocked;
    t.status = blocked ? 'blocked' : 'done';
    t.report = line ? line.replace(/^\W*/, '').slice(0, 400) : summary;
    t.commit = hash;
    t.finishedAt = Date.now();
    t.durationMs = (t.durationMs || 0) + share;
    t.toolCalls = (t.toolCalls || 0) + Math.round((res.toolCalls || 0) / tasks.length);
    t.attempts = (t.attempts || 0) + 1;
    delete t.redoNote;
  }
  p.crewMs = (p.crewMs || 0) + (res.durationMs || 0);
  saveIdea(idea);
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length;
  const msg = addMessage(idea, {
    agentId: agent.id, agentName: agent.name, kind: 'task', taskId: task.id, taskTitle: tasks.length > 1 ? `${ids}: ${task.title} (+${tasks.length - 1})` : task.title,
    taskStatus: blockedCount === tasks.length ? 'blocked' : 'done', commit: hash,
    round: idea.round, summary, content, model: res.model, durationMs: res.durationMs,
  });
  emit(bus, idea, 'message', { message: msg });
  tasksEvent(bus, idea);
  const doneCount = p.tasks.filter((t) => t.status === 'done').length;
  const next = p.tasks.find((t) => t.status === 'todo');
  progress(idea, `Build ${doneCount}/${p.tasks.length} · ${ids} ${blockedCount ? `${blockedCount} blocked` : 'done'}${next ? ` · next ${next.id}: ${next.title}` : ' · testing next'}`);
}

async function reviewTurn(bus, idea, { agentId, system, key, title, label, extraPrompt }) {
  const agent = CREW[agentId];
  const p = idea.project;
  thinking(bus, idea, agentId, label);
  const prompt = [
    buildContext(idea),
    await repoState(p.slug),
    `TASKS THE DEVELOPERS COMPLETED:\n${(p.tasks || []).map((t) => `- ${t.id} ${t.title} [${t.status}]${t.report ? `: ${t.report}` : ''}`).join('\n')}`,
    extraPrompt,
  ].filter(Boolean).join('\n\n');
  const res = await askClaude({
    prompt, system, model: agent.model, tools: builder.REVIEW_TOOLS, cwd: builder.repoDir(p.slug), runAs: builder.buildUser(), timeoutMs: 30 * MIN,
    onActivity: (a) => activity(bus, idea, agentId, null, a),
  });
  p.crewMs = (p.crewMs || 0) + (res.durationMs || 0);
  const { summary, content } = splitSummary(res.text);
  const pass = /^VERDICT:\s*PASS/im.test(content) && !/^VERDICT:\s*FAIL/im.test(content);
  const issues = parseJsonBlock(content) || [];
  // Screenshots QA took, if any.
  let attachments = [];
  if (agentId === 'qa') {
    const dir = path.join(builder.repoDir(p.slug), 'qa', 'screenshots');
    try {
      attachments = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().slice(0, 12)
        .map((f) => importFile(path.join(dir, f), { name: f })).filter(Boolean);
      p.screenshots = attachments;
    } catch {}
  }
  storeDoc(bus, idea, agent, key, title, stripJsonBlocks(content), { summary, res, attachments, extra: { verdict: pass ? 'pass' : 'fail' } });
  return { pass, issues: Array.isArray(issues) ? issues : [] };
}

async function devopsTurn(bus, idea) {
  const agent = CREW.devops;
  const p = idea.project;
  thinking(bus, idea, 'devops', 'DevOps is preparing the deployment');
  const prompt = [
    buildContext(idea),
    await repoState(p.slug),
    `YOUR TASK NOW: make "${p.slug}" deployable. Write the Dockerfile, .dockerignore, .github/workflows/build.yml and deploy/k8s.yaml, then write the "Deployment" document ending with the PORT and ENV_JSON lines.${p.customDomain ? ` The owner also wants the site served on the custom domain ${p.customDomain} (they will point its DNS at the cluster).` : ''}`,
  ].join('\n\n');
  const res = await askClaude({ prompt, system: agent.system, model: agent.model, tools: builder.BUILD_TOOLS, cwd: builder.repoDir(p.slug), runAs: builder.buildUser(), timeoutMs: 30 * MIN });
  const { summary, content } = splitSummary(res.text);
  const port = Number((content.match(/^PORT:\s*(\d+)/im) || [])[1]) || 3000;
  let envJson = {};
  const envLine = content.match(/^ENV_JSON:\s*(\{.*\})\s*$/im);
  if (envLine) { try { envJson = JSON.parse(envLine[1]); } catch {} }
  for (const f of ['Dockerfile', 'deploy/k8s.yaml', '.github/workflows/build.yml']) {
    if (builder.readRepoFile(p.slug, f) === null) throw new Error(`DevOps did not write ${f}. Tap Resume to try again.`);
  }
  p.deploy = { ...(p.deploy || {}), port, envJson, preparedAt: Date.now() };
  await builder.commitAll(p.slug, 'Deployment: Dockerfile, image workflow, k8s manifests');
  storeDoc(bus, idea, agent, 'deploy_notes', 'Deployment', content.replace(/^ENV_JSON:.*$/im, '').trim(), { summary, res });
}

async function deploySteps(bus, idea) {
  const p = idea.project;
  setStage(bus, idea, 'deploying');
  if (!p.deploy?.preparedAt || builder.readRepoFile(p.slug, 'deploy/k8s.yaml') === null) {
    checkStop(idea);
    await devopsTurn(bus, idea);
  }
  checkStop(idea);
  thinking(bus, idea, 'devops', 'Pushing the code to GitHub');
  const repo = await deploy.ensureGithubRepo(p.slug, idea.brief ? idea.brief.split('\n').find((l) => l.trim() && !l.startsWith('#')) : idea.title);
  p.repoUrl = repo.url;

  // Push, then wait for GitHub Actions. When the project's own checks fail
  // there (a test that only breaks on CI, a lint rule), the failure details
  // go back to a developer as a fix task and the push is repeated, up to
  // three times, instead of stopping the crew.
  const pushAndBuild = async () => {
    let runUrl;
    for (let attempt = 1; ; attempt++) {
      const { sha, pushed } = await deploy.pushRepo(p.slug);
      saveIdea(idea);
      // A resumed deploy finds its commit already on GitHub: no second push,
      // and the image check below returns at once when it was already built.
      if (pushed) systemNote(bus, idea, `Code pushed to GitHub${repo.created && attempt === 1 && !p.deploys ? ' (new private repository)' : ''}`, `${repo.url} — commit ${sha.slice(0, 7)}. GitHub Actions is now building the container image.`, { link: repo.url });
      thinking(bus, idea, 'devops', pushed ? 'Waiting for the container image to build' : `Commit ${sha.slice(0, 7)} is already on GitHub; checking its image build`);
      try {
        const built = await deploy.waitForImage(p.slug, sha, { onProgress: (t) => thinking(bus, idea, 'devops', t), stopping: () => runners.stopping(idea.id) });
        runUrl = built.url;
        // The repository's other checks failed on GitHub while the image is
        // fine: the site ships (Box's QA already passed it) and a developer
        // task carries the failure into the next cycle. One task per run.
        for (const f of built.otherFailures || []) {
          const title = `Fix the GitHub Actions checks "${f.name}" (run ${f.id})`;
          if ((p.tasks || []).some((t) => t.title === title)) continue;
          const details = await deploy.ciFailure(p.slug, f.id).catch(() => 'GitHub gave no details.');
          systemNote(bus, idea, `GitHub Actions checks "${f.name}" failed; the image is built, so the deploy continues`, `${details}\n\nA developer task was added for the next cycle. Box's own QA and code review already passed this build.`, { link: f.url });
          addTasks(idea, [{
            title, role: /e2e|playwright|frontend|\.tsx?:|\.css/i.test(details) ? 'frontend' : 'backend', size: 'S',
            description: `The repository's GitHub Actions workflow "${f.name}" fails on GitHub's runner while the product passes QA locally. Make it pass honestly: CI must not depend on repository secrets or network services it does not have (skip or stub those steps on CI), and tests must be deterministic. Do not delete the checks.\n\nWHAT GITHUB REPORTED:\n${details}`,
          }], 'ci');
          tasksEvent(bus, idea);
        }
        break;
      } catch (e) {
        if (!e.ciRun || attempt >= 3) throw e;
        checkStop(idea);
        thinking(bus, idea, 'devops', 'Reading why GitHub Actions failed');
        const details = await deploy.ciFailure(p.slug, e.ciRun.id).catch(() => 'GitHub gave no details.');
        systemNote(bus, idea, `GitHub Actions failed (attempt ${attempt} of 3) — sending it back to the developer`, details, { link: e.ciRun.url });
        const [task] = addTasks(idea, [{
          title: `Fix the GitHub Actions failure (attempt ${attempt})`, role: /e2e|playwright|frontend|\.tsx?:|\.css/i.test(details) ? 'frontend' : 'backend', size: 'S',
          description: `The repository's GitHub Actions workflow failed after the push, so the image was not built. Make the workflow pass without weakening the checks: fix the code or the test so it is correct and reliable on CI (a test that passes locally but not on CI is still a defect). Run the same checks locally before reporting.\n\nWHAT GITHUB REPORTED:\n${details}`,
        }], 'ci');
        tasksEvent(bus, idea);
        await devTurn(bus, idea, task);
        checkStop(idea);
        thinking(bus, idea, 'devops', 'Pushing the fix to GitHub');
      }
    }
    systemNote(bus, idea, 'Container image built', `The image is on GHCR. ${runUrl}`, { link: runUrl });
  };
  await pushAndBuild();

  checkStop(idea);
  // Settings the crew left for the owner: Box fills in what it knows (the
  // owner's email and name, the site's address). Anything else must come
  // from the owner before the rollout, because the app would only crash
  // without it.
  const ownerUser = (() => { try { return require('./auth').getUser(idea.ownerId); } catch { return null; } })();
  const owner = ownerUser ? { email: ownerUser.email, name: `${ownerUser.firstName || ''} ${ownerUser.lastName || ''}`.trim() } : {};
  const shared = require('./sharedenv').values();
  const { env, missing, filled, fromShared, revealed } = deploy.resolveEnv(p.slug, p.deploy.envJson, p.deploy.env || {}, owner, shared);
  p.deploy.env = env;
  p.deploy.missing = missing;
  saveIdea(idea);
  const shown = Object.entries(revealed || {});
  if (filled.length || shown.length || fromShared.length) {
    const typed = shown.length
      ? `\n\nVALUES THE SITE WILL ASK YOU FOR — Box generated them; they are also under ⋯ → Environment variables → Show:\n${shown.map(([k, v]) => `${k}: ${v}`).join('\n')}${shown.some(([k]) => /PASSWORD/.test(k)) ? '\nChange any password after your first sign-in.' : ''}`
      : '';
    const parts = [
      filled.length ? `${filled.join(', ')} — from your account and the site's address.` : '',
      fromShared.length ? `${fromShared.join(', ')} — from your Shared keys (Settings).` : '',
    ].filter(Boolean).join(' ');
    systemNote(bus, idea, shown.length ? 'Your setup values for the site' : 'Settings filled in by Box', `${parts}${parts ? ' Change any of them under ⋯ → Environment variables.' : ''}${typed}`);
  }
  if (missing.length) {
    const keys = missing.filter((k) => /(_KEY|_TOKEN|_SECRET|_ID)$/.test(k));
    const ai = missing.filter((k) => /^(ANTHROPIC|OPENAI|GEMINI|GOOGLE_AI|MISTRAL|COHERE)_/.test(k));
    systemNote(bus, idea, `The site needs ${missing.length} ${missing.length === 1 ? 'value' : 'values'} from you before it can start`, `${missing.join(', ')}\n\nTap the ⋯ menu → Environment variables, set each one, then tap Resume the crew. The crew's deployment notes above say what each is for.${ai.length ? `\n\n${ai.join(', ')}: this product calls an AI provider. If you do not want that, write a note here such as "Remove the AI features and implement them with rules instead" and the crew rebuilds, tests and redeploys without ${ai.length === 1 ? 'it' : 'them'}.` : ''}${keys.length ? `\n\nTip: add ${keys.length === 1 ? 'a key' : 'keys'} you do want to keep once under Settings → Shared keys and every future project gets ${keys.length === 1 ? 'it' : 'them'} automatically.` : ''}`);
    notify(idea, 'needs_env');
    progress(idea, `Deploy paused · needs ${missing.join(', ')}`);
    throw new Error('__paused__');
  }
  // Roll out. When the cluster rejects the manifests or the app never comes
  // up, the cluster's report goes to a developer as a fix task, the fix is
  // pushed and built, and the rollout is tried again, up to three times.
  let site;
  for (let attempt = 1; ; attempt++) {
    thinking(bus, idea, 'devops', 'Rolling out to the cluster');
    try {
      await deploy.applyManifests(p.slug, env, { onProgress: (t) => thinking(bus, idea, 'devops', `Rolling out: ${t.split('\n').pop()}`), customDomain: p.customDomain || '' });
      // A deploy is done only when the address serves a working page. A
      // 404, an error page or silence is a failure that goes to the developer.
      thinking(bus, idea, 'devops', 'Waiting for the site to answer over HTTPS');
      site = await deploy.waitForSite(p.slug);
      if (!site.up) {
        const diag = await deploy.siteDiagnostics(p.slug).catch((x) => x.message);
        throw new Error(`Rollout did not finish: ${site.url} answers ${site.error || `HTTP ${site.status}`} after the rollout, so the site is not live.${site.router ? ' The cluster router has no route for this hostname: the Ingress is missing, has the wrong host or class, or its Service name/port does not match.' : site.status === 404 ? ' The app itself returns 404 for its front page: check the root route and the port the Service targets.' : ''}\n\nCLUSTER:\n${diag}`);
      }
      break;
    } catch (e) {
      if (e.message === '__paused__' || attempt >= 3 || !/^(Rollout did not finish|kubectl apply)/.test(e.message)) throw e;
      checkStop(idea);
      const hints = [];
      if (/no attempt/.test(e.message)) hints.push('pg_isready printing "host:port - no attempt" means it could not even try: when a container runs as a user ID that has no passwd entry (a non-root securityContext), libpq cannot pick a default user name. Give it one explicitly, e.g. pg_isready -h HOST -p 5432 -U "$POSTGRES_USER" (or -U postgres), in the wait-for-db init container and any probe.');
      if (/ImagePullBackOff|ErrImagePull/.test(e.message)) hints.push('An image could not be pulled: check the image name and tag in deploy/k8s.yaml match what the workflow publishes.');
      if (/CrashLoopBackOff/.test(e.message)) hints.push('The app container exits at startup: read the LOGS section for the exception and fix the startup path (required settings, migrations, port).');
      if (/PROBLEM: middleware/.test(e.message)) hints.push('A Traefik router whose middleware is missing or broken is disabled and the host answers 404 even though the Ingress looks right. Either create what the middleware needs (for basicAuth, a Secret with an htpasswd "users" entry, created in deploy/k8s.yaml) or remove the middleware annotation. The owner did not ask for password protection on the site, so prefer removing basic auth unless the requirements call for it.');
      if (/cluster router has no route/.test(e.message)) hints.push(`The Ingress must exist in namespace ${p.slug} with ingressClassName traefik, a rule for host ${p.slug}.cashflowus.com, path / Prefix, backend the app Service and its port, and the cert-manager annotation. Compare the CLUSTER section with deploy/k8s.yaml; names and ports must match exactly.`);
      if (/app itself returns 404/.test(e.message)) hints.push('The container serves the port but not the front page: make sure the production server serves the app at / (not only under a base path), that the Service targetPort is the port the app listens on, and that the build output is included in the image.');
      systemNote(bus, idea, `Rollout failed (attempt ${attempt} of 3) — sending it to the developer`, e.message.slice(0, 3500));
      const [task] = addTasks(idea, [{
        title: `Fix the cluster rollout failure (attempt ${attempt})`, role: 'backend', size: 'S',
        description: `The deploy to the cluster failed after the image was built. Fix the cause in deploy/k8s.yaml or in the app's startup so the rollout completes; keep the health checks and the wait-for-db step, make them correct. Run what you can locally (manifests must stay valid YAML; node scripts must start).${hints.length ? `\n\nHINTS:\n- ${hints.join('\n- ')}` : ''}\n\nWHAT THE CLUSTER REPORTED:\n${e.message.slice(0, 5000)}`,
      }], 'ci');
      tasksEvent(bus, idea);
      await devTurn(bus, idea, task);
      checkStop(idea);
      thinking(bus, idea, 'devops', 'Pushing the fix to GitHub');
      await pushAndBuild();
    }
  }
  p.url = site.url;
  p.deployedAt = Date.now();
  p.deploys = (p.deploys || 0) + 1;
  // The custom domain, if any: on the Ingress already; does it answer yet?
  let customText = '';
  if (p.customDomain) {
    const probe = await deploy.probeSite(`https://${p.customDomain}`);
    p.customDomainStatus = probe.up ? 'live' : /ENOTFOUND|EAI_AGAIN/.test(probe.error || '') ? 'dns' : 'certificate';
    customText = probe.up ? ` Also at https://${p.customDomain}.` : p.customDomainStatus === 'dns'
      ? ` The custom domain ${p.customDomain} does not resolve yet: point its A record at 2.25.157.104.`
      : ` The custom domain ${p.customDomain} is on the site; its certificate usually arrives within a few minutes.`;
  }
  saveIdea(idea);
  const missingText = missing.length ? `\n\nStill needed from you (add them in the cluster secret ${p.slug}-env or tell the crew): ${missing.join(', ')}.` : '';
  const msg = addMessage(idea, {
    agentId: 'devops', agentName: 'DevOps', kind: 'deployed', round: idea.round, url: site.url,
    summary: `Live at ${site.url}`,
    content: `The site answers with HTTP ${site.status}.${customText} Repository: ${p.repoUrl}.${missingText}`,
  });
  emit(bus, idea, 'message', { message: msg });
  const wasLive = p.deploys > 1;
  setStage(bus, idea, wasLive && p.completedAt ? 'maintenance' : 'review');
  notify(idea, wasLive && p.completedAt ? 'redeployed' : 'review');
}

/** Turn owner feedback (review or maintenance) into tasks via the Tech Lead. */
async function triageFeedback(bus, idea, feedback) {
  const p = idea.project;
  thinking(bus, idea, 'techlead', 'Tech Lead is turning your feedback into tasks');
  const res = await askClaude({
    system: `You are the Tech Lead on a software build crew. The owner tried the product and sent feedback. Turn it into concrete developer tasks. Reply with only a fenced JSON block: [{"title":"...","role":"frontend|backend","size":"S|M|L","description":"what to change, where, and acceptance criteria"}]. Split by concern; keep each task doable in one session; nothing else in the reply.`,
    model: 'sonnet',
    prompt: `${docsText(idea, ['requirements', 'build_plan'])}\n\nREPOSITORY FILES:\n${await builder.fileTree(p.slug, 200)}\n\nOWNER FEEDBACK:\n"""\n${feedback}\n"""`,
    timeoutMs: 10 * MIN,
  });
  const list = parseJsonBlock(res.text) || [];
  const added = addTasks(idea, list, 'owner');
  tasksEvent(bus, idea);
  if (!added.length) throw new Error('The Tech Lead could not turn that feedback into tasks. Try describing what should change more concretely.');
  systemNote(bus, idea, `${added.length} ${added.length === 1 ? 'task' : 'tasks'} added from your feedback`, added.map((t) => `- ${t.id} ${t.title}`).join('\n'));
}

/**
 * The build loop. Resumable: picks up from the project's recorded state.
 *   feedback — owner feedback from review/maintenance; becomes tasks first.
 */
async function runBuild(bus, idea, { feedback } = {}) {
  if (!runners.start(idea.id)) return;
  const p = idea.project;
  idea.status = 'running';
  idea.error = null;
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });
  try {
    await builder.ensureRepo(p.slug, { readme: `# ${idea.title}\n\nBuilt by the Box crew.\n` });
    if (p.prototype && builder.readRepoFile(p.slug, 'design/prototype.html') === null) {
      const u = getUpload(p.prototype.id);
      if (u) builder.writeRepoFile(p.slug, 'design/prototype.html', fs.readFileSync(u.path, 'utf8'));
    }
    p.tasks = p.tasks || [];
    p.cycle = p.cycle || 0;
    for (const t of p.tasks) if (t.status === 'doing') t.status = 'todo';

    if (feedback) {
      setStage(bus, idea, 'building');
      await triageFeedback(bus, idea, feedback);
      p.cycle = 0;
      p.qaPassed = false;
    }
    if (!(p.docs || {}).build_plan) {
      setStage(bus, idea, 'building');
      checkStop(idea);
      await techLeadTurn(bus, idea);
    }

    // Build → test, with fix cycles.
    while (!p.qaPassed) {
      const todo = () => p.tasks.filter((t) => t.status === 'todo');
      if (todo().length) setStage(bus, idea, 'building');
      while (todo().length) {
        checkStop(idea);
        const next = todo()[0];
        if (next.holdBefore) {
          // The owner asked to be consulted before this task.
          next.holdBefore = false;
          saveIdea(idea);
          tasksEvent(bus, idea);
          systemNote(bus, idea, `Paused before ${next.id} as you asked`, `${next.id} ${next.title} is next. Leave a note for the crew, then tap Resume the crew.`);
          throw new Error('__paused__');
        }
        await devTurn(bus, idea, pickBatch(todo()));
      }
      setStage(bus, idea, 'testing');
      checkStop(idea);
      // From the second cycle on, reviews are incremental: what changed since
      // the last review is listed, previous findings are re-checked, and the
      // design review is skipped when it passed and no frontend work happened.
      const since = p.lastReviewAt || 0;
      const changed = p.tasks.filter((t) => t.finishedAt && t.finishedAt > since && t.status !== 'todo');
      const headNow = (await builder.git(p.slug, ['rev-parse', 'HEAD'])).out.trim();
      let diffStat = '';
      if (p.lastReviewedSha && p.lastReviewedSha !== headNow) diffStat = (await builder.git(p.slug, ['diff', '--stat', `${p.lastReviewedSha}..HEAD`])).out.trim().split('\n').slice(-40).join('\n');
      const incremental = p.cycle > 0 && p.lastReviewedSha
        ? `\n\nTHIS IS A RE-REVIEW (cycle ${p.cycle + 1}). Since your last review these tasks were done:\n${changed.map((t) => `- ${t.id} ${t.title} [${t.status}]: ${t.report || ''}`).join('\n') || '- (none)'}\n\nFiles changed since then (git diff --stat ${p.lastReviewedSha.slice(0, 7)}..HEAD):\n${diffStat || '(no changes)'}\n\nReview the changed files thoroughly, re-check each finding from your previous report, and do not re-review unchanged files. Say which previous findings are fixed.`
        : '';
      const frontendChanged = p.cycle === 0 || changed.some((t) => t.role === 'frontend' || t.source === 'qa');
      const lastDesign = (p.docs || {}).design_review;
      const skipDesign = p.cycle > 0 && lastDesign && lastDesign.verdict === 'pass' && !frontendChanged;
      p.lastReviewAt = Date.now();
      p.lastReviewedSha = headNow;
      saveIdea(idea);
      // Code review (reads the code) and QA (runs the product) do not touch
      // each other's work, so they run at the same time. The design review
      // follows QA because it uses QA's screenshots.
      const [review, qa] = await Promise.all([
        reviewTurn(bus, idea, {
          agentId: 'reviewer', system: CREW.reviewer.system, key: 'code_review', title: 'Code review',
          label: 'Code Reviewer is reading the code',
          extraPrompt: `YOUR TASK NOW: review the repository and write the "Code review" (cycle ${p.cycle + 1} of ${MAX_FIX_CYCLES}). QA is testing the product at the same time: do not start servers or run end-to-end tests yourself; unit tests, linters, audits and reading are yours.${incremental}`,
        }),
        reviewTurn(bus, idea, {
          agentId: 'qa', system: CREW.qa.system, key: 'qa_report', title: 'QA report',
          label: 'QA Tester is testing the build',
          extraPrompt: `YOUR TASK NOW: test the product and write the "QA report" (cycle ${p.cycle + 1} of ${MAX_FIX_CYCLES}).${incremental ? `${incremental}\nStill smoke-test the main paths end to end; go deep on what changed.` : ''}`,
        }),
      ]);
      checkStop(idea);
      const design = skipDesign
        ? { pass: true, issues: [] }
        : await reviewTurn(bus, idea, {
          agentId: 'ux', system: DESIGN_REVIEW_SYSTEM, key: 'design_review', title: 'Design review',
          label: 'UX Designer is reviewing the build against the design',
          extraPrompt: `${docText(idea, 'ux_direction')}\n\nYOUR TASK NOW: review the built UI against your UX direction and prototype and write the "Design review".${incremental}`,
        });
      if (skipDesign) systemNote(bus, idea, 'Design review kept from the previous cycle', 'It passed, and the fixes since then did not touch the interface.');
      const issues = [...review.issues.map((i) => ({ ...i, source: 'review' })), ...qa.issues, ...design.issues];
      const blocked = p.tasks.filter((t) => t.status === 'blocked');
      if (review.pass && qa.pass && design.pass && !blocked.length) {
        p.qaPassed = true;
        saveIdea(idea);
        systemNote(bus, idea, 'Code review, QA and design review passed', `${p.tasks.length} tasks done. Ready to deploy.`);
        break;
      }
      if (p.cycle >= MAX_FIX_CYCLES) {
        p.qaPassed = true; // ship what we have; the owner reviews it
        saveIdea(idea);
        systemNote(bus, idea, `Shipping after ${MAX_FIX_CYCLES} fix cycles`, `Open issues remain (${issues.length}); they are listed in the QA report and design review for your review.`);
        break;
      }
      p.cycle += 1;
      for (const t of blocked) t.status = 'todo';
      const added = [...addTasks(idea, issues.filter((i) => i.source === 'review'), 'review'), ...addTasks(idea, issues.filter((i) => i.source !== 'review'), 'qa')];
      tasksEvent(bus, idea);
      if (!added.length && !blocked.length) { p.qaPassed = true; saveIdea(idea); break; }
      systemNote(bus, idea, `Fix cycle ${p.cycle}: ${added.length + blocked.length} ${added.length + blocked.length === 1 ? 'task' : 'tasks'} for the developers`, added.map((t) => `- ${t.id} ${t.title}`).join('\n'));
    }

    // Deploy
    if (!deploy.ready()) {
      const c = deploy.configured();
      idea.status = 'done';
      saveIdea(idea);
      setStage(bus, idea, 'deploy_setup');
      if (!p.deploySetupNoted) {
        p.deploySetupNoted = true;
        systemNote(bus, idea, 'Built and tested — deployment needs setup',
          `Box needs credentials to put projects live: ${!c.github ? 'a GitHub token (secret BOX_GITHUB_TOKEN)' : ''}${!c.github && !c.kube ? ' and ' : ''}${!c.kube ? 'the cluster kubeconfig (secret BOX_KUBECONFIG)' : ''}. Add them to the buildAgents repository secrets, redeploy Box, then tap Deploy.`);
      }
      emit(bus, idea, 'status', { status: 'done' });
      notify(idea, 'deploy_setup');
      return;
    }
    await deploySteps(bus, idea);
    idea.status = 'done';
    saveIdea(idea);
    emit(bus, idea, 'status', { status: 'done' });
  } catch (err) {
    failRun(bus, idea, err);
  } finally {
    runners.finish(idea.id);
  }
}

/** Owner: "Mark complete" after review → maintenance. */
function completeProject(bus, idea) {
  if (idea.project.stage !== 'review') throw new Error('The project is not waiting for your review.');
  idea.project.completedAt = Date.now();
  idea.status = 'idle';
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: 'system', kind: 'completed', round: idea.round,
    summary: 'Marked complete — now in maintenance', content: `The site is live at ${idea.project.url}. Notes you leave here become fixes or features; the crew builds, tests and redeploys them.`,
  });
  emit(bus, idea, 'message', { message: msg });
  setStage(bus, idea, 'maintenance');
  return msg;
}

/** What a user message should trigger for a project in its current stage. */
function onOwnerMessage(bus, idea, text) {
  const stage = idea.project.stage;
  if (runners.isRunning(idea.id)) return; // the crew reads notes on their next turn
  if (stage === 'plan_review') runPlanning(bus, idea, { feedback: text });
  // Any other note goes to the Tech Lead first: a question gets an answer;
  // a request for a change becomes tasks and restarts build → test → deploy.
  else if (['review', 'maintenance', 'building', 'testing', 'deploy_setup', 'deploying'].includes(stage)) triageNote(bus, idea, text).catch((e) => console.error(`note ${idea.id}: ${e.message}`));
}

/**
 * The Tech Lead reads the owner's note. Questions ("what is the password?",
 * "where do I find X?") are answered on the spot from the project's
 * documents, settings and state. Only a request for a change goes to the crew.
 */
async function triageNote(bus, idea, text) {
  const p = idea.project;
  if (!runners.start(idea.id)) return;
  const prevStatus = idea.status;
  idea.status = 'running';
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });
  let kind = 'change';
  try {
    thinking(bus, idea, 'techlead', 'Tech Lead is reading your note');
    const envNames = Object.keys(p.deploy?.env || {}).filter((k) => !k.startsWith('__'));
    const recent = (idea.messages || []).slice(-14).map((m) => `- [${m.agentName || m.agentId}${m.kind ? `/${m.kind}` : ''}] ${(m.summary || '').slice(0, 200)}`).join('\n');
    const res = await askClaude({
      model: 'sonnet',
      system: `You are the Tech Lead of the build crew on "Box", talking to the product's owner, who is not technical. Decide whether their note is a QUESTION (they want information: how something works, where to find something, what a value is, what happened) or a CHANGE REQUEST (they want the product to be different, or something fixed). Questions get a direct, concrete answer under 200 words in plain language, using the facts given; do not invent values. Where Box keeps things: generated secrets and setup codes are under the project's ⋯ menu → Environment variables → Show (the owner can read any value there); logs under ⋯ → Logs; the code under ⋯ → Browse the code; documents under ⋯ → Project documents. A user name on a site the crew built is whatever the owner chose when signing up on it (or their email), unless the documents say otherwise. If a question reveals a real problem that needs a change, answer it AND say what you would change, but it is still a question. Reply with only a fenced JSON block: {"kind":"question"|"change","answer":"..."} (answer only for questions).`,
      prompt: `PROJECT: ${idea.title} — ${p.url ? `live at ${p.url}` : 'not live yet'}${p.customDomain ? `, custom domain ${p.customDomain}` : ''}; stage ${p.stage}.\n\n${docsText(idea, ['requirements', 'deployment'])}\n\nSETTINGS THE SITE READS (names only; values are under Environment variables → Show): ${envNames.join(', ') || '(none yet)'}\n\nRECENT THREAD:\n${recent}\n\nTASKS: ${(p.tasks || []).length} (${(p.tasks || []).filter((t) => t.status === 'done').length} done)\n\nTHE OWNER'S NOTE:\n"""\n${text}\n"""`,
      timeoutMs: 5 * MIN,
    });
    const j = parseJsonBlock(res.text) || {};
    if (j.kind === 'question' && j.answer) {
      kind = 'question';
      const msg = addMessage(idea, {
        agentId: 'techlead', agentName: CREW.techlead.name, kind: 'answer', round: idea.round,
        summary: String(j.answer).replace(/\s+/g, ' ').slice(0, 160), content: String(j.answer), model: res.model, durationMs: res.durationMs,
      });
      emit(bus, idea, 'message', { message: msg });
      tell(idea, { title: 'Tech Lead answered', body: `${idea.title}: ${String(j.answer).slice(0, 120)}`, tag: `${idea.id}:answer` });
    }
  } finally {
    idea.status = prevStatus === 'running' ? 'paused' : prevStatus;
    saveIdea(idea);
    emit(bus, idea, 'status', { status: idea.status });
    runners.finish(idea.id);
  }
  if (kind === 'change') runBuild(bus, idea, { feedback: text });
}

/** Resume/start whatever the stage calls for. */
function resumeProject(bus, idea) {
  const stage = idea.project.stage;
  if (['planning', 'design', 'plan_review'].includes(stage)) return runPlanning(bus, idea);
  if (['building', 'testing', 'deploy_setup', 'deploying'].includes(stage)) return runBuild(bus, idea);
  if (['review', 'maintenance'].includes(stage)) {
    if (idea.project.tasks?.some((t) => t.status !== 'done')) return runBuild(bus, idea);
    throw new Error('Nothing to run: reply with what should change.');
  }
  throw new Error(`Nothing to run at stage ${stage}.`);
}

/**
 * Owner edits on the task board. ops: { action, taskId, ...fields }
 *   edit (title, description, role) · delete · move (dir: up|down) · redo (note)
 *   hold (holdBefore: bool) · add (title, description, role)
 */
function editTasks(bus, idea, op) {
  const p = idea.project;
  if (!p) throw new Error('Not a project.');
  p.tasks = p.tasks || [];
  const t = p.tasks.find((x) => x.id === op.taskId);
  const running = runners.isRunning(idea.id);
  switch (op.action) {
    case 'add': {
      if (!String(op.title || '').trim()) throw new Error('Give the task a title.');
      addTasks(idea, [{ title: op.title, description: op.description || op.title, role: op.role, size: op.size || 'M' }], 'owner');
      if (p.qaPassed && !running) { p.qaPassed = false; } // a new task means another test pass
      break;
    }
    case 'edit': {
      if (!t) throw new Error('Task not found.');
      if (t.status === 'doing') throw new Error('That task is being worked on right now.');
      if (op.title) t.title = String(op.title).slice(0, 120);
      if (op.description) t.description = String(op.description).slice(0, 4000);
      if (op.role === 'frontend' || op.role === 'backend') t.role = op.role;
      break;
    }
    case 'delete': {
      if (!t) throw new Error('Task not found.');
      if (t.status === 'doing') throw new Error('That task is being worked on right now.');
      if (t.status === 'done') throw new Error('Done tasks stay on the board; use Redo to change the result.');
      p.tasks = p.tasks.filter((x) => x.id !== t.id);
      break;
    }
    case 'move': {
      if (!t) throw new Error('Task not found.');
      const i = p.tasks.indexOf(t);
      const j = op.dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= p.tasks.length) break;
      if (t.status !== 'todo' || p.tasks[j].status !== 'todo') throw new Error('Only waiting tasks can be reordered.');
      [p.tasks[i], p.tasks[j]] = [p.tasks[j], p.tasks[i]];
      break;
    }
    case 'redo': {
      if (!t) throw new Error('Task not found.');
      if (t.status === 'doing') throw new Error('That task is being worked on right now.');
      t.status = 'todo';
      t.redoNote = String(op.note || '').slice(0, 2000) || 'Redo this task more carefully.';
      p.qaPassed = false;
      break;
    }
    case 'hold': {
      if (!t) throw new Error('Task not found.');
      if (t.status !== 'todo') throw new Error('Only a waiting task can be held.');
      t.holdBefore = !!op.holdBefore;
      break;
    }
    case 'revert': {
      if (!t) throw new Error('Task not found.');
      if (running) throw new Error('Wait for the crew to finish first.');
      if (!t.commit) throw new Error('That task has no commit to revert.');
      // Resolved by the caller (async); handled in revertTask.
      throw new Error('__revert__');
    }
    default: throw new Error('Unknown task action.');
  }
  saveIdea(idea);
  tasksEvent(bus, idea);
  return p.tasks;
}

/** Roll back one task's commit with git revert; the task is marked reverted and re-queued only if asked. */
async function revertTask(bus, idea, taskId, { requeue = false } = {}) {
  const p = idea.project;
  const t = (p.tasks || []).find((x) => x.id === taskId);
  if (!t) throw new Error('Task not found.');
  if (runners.isRunning(idea.id)) throw new Error('Wait for the crew to finish first.');
  if (!t.commit) throw new Error('That task has no commit to revert.');
  const r = await builder.git(p.slug, ['revert', '--no-edit', t.commit]);
  if (r.code !== 0) {
    await builder.git(p.slug, ['revert', '--abort']);
    throw new Error(`Could not revert cleanly: ${r.out.slice(-300)}`);
  }
  const h = await builder.git(p.slug, ['rev-parse', '--short', 'HEAD']);
  t.status = requeue ? 'todo' : 'reverted';
  t.revertCommit = h.out.trim();
  if (requeue) t.redoNote = 'The previous implementation was reverted by the owner. Implement it again, differently.';
  p.qaPassed = false;
  saveIdea(idea);
  tasksEvent(bus, idea);
  systemNote(bus, idea, `${t.id} reverted`, `The commit ${t.commit} for "${t.title}" was reverted (${t.revertCommit}).${requeue ? ' It is queued to be redone.' : ''}`);
  return t;
}

function pauseProject(idea) { runners.requestStop(idea.id); }
function projectRunning(ideaId) { return runners.isRunning(ideaId); }
function projectSpeaker(ideaId) { return runners.speaker(ideaId); }

module.exports = { runPlanning, approvePlan, runBuild, completeProject, onOwnerMessage, resumeProject, editTasks, revertTask, chooseDesign, pauseProject, projectRunning, projectSpeaker, getUpload, deployStatus: deploy.configured };
