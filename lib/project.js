// Project engine: runs the build crew on a promoted idea.
//
// Planning (this version):
//   promote → Project Manager → Lead Architect → Database Architect → UX Designer
//   → stage 'plan_review' (the owner approves, or sends feedback that re-runs
//   the affected documents) → 'building' (the build crew, next version).

const fs = require('fs');
const path = require('path');
const { askClaude, splitSummary } = require('./claude');
const { CREW, PLANNING_ORDER, PLATFORM_CONTEXT } = require('./crew');
const { saveIdea, addMessage } = require('./store');
const { saveGenerated, getUpload } = require('./uploads');

const WORK_DIR = path.join(__dirname, '..', 'data', 'work');
const runners = new Map(); // ideaId -> { stop, thinking }

function emit(bus, idea, event, payload) {
  bus.publish(idea.id, { event, ...payload });
}

function setStage(bus, idea, stage) {
  idea.project.stage = stage;
  saveIdea(idea);
  emit(bus, idea, 'stage', { stage });
}

function checkStop(idea) {
  const r = runners.get(idea.id);
  if (r && r.stop) throw new Error('__paused__');
}

/** The debate's decisions, compactly: the Orchestrator's syntheses plus the brief. */
function debateDigest(idea) {
  const syntheses = idea.messages.filter((m) => m.kind === 'synthesis').map((m) => m.content);
  return syntheses.length ? `DECISIONS FROM THE IDEA DEBATE (Orchestrator syntheses):\n${syntheses.join('\n\n')}\n` : '';
}

function notesSince(idea, ts) {
  return idea.messages.filter((m) => m.kind === 'user' && m.ts >= ts).map((m) => `- ${m.content}`).join('\n');
}

function docsText(idea, except) {
  const docs = idea.project.docs || {};
  return Object.entries(docs)
    .filter(([k]) => k !== except)
    .map(([k, d]) => `=== ${d.title.toUpperCase()} (by ${d.agentName}) ===\n${d.content}`)
    .join('\n\n');
}

function planningContext(idea, agent, { feedback } = {}) {
  const p = idea.project;
  const notes = notesSince(idea, p.promotedAt);
  return [
    `HOUSE STANDARDS:\n${PLATFORM_CONTEXT}`,
    `THE ORIGINAL IDEA (verbatim):\n"""\n${idea.text}\n"""`,
    `THE APPROVED IDEA BRIEF:\n${idea.brief}`,
    debateDigest(idea),
    `PROJECT: "${idea.title}" — repo and address name: ${p.slug} (https://${p.slug}.cashflowus.com)`,
    notes ? `NOTES FROM THE OWNER TO THE TEAM:\n${notes}` : '',
    feedback ? `THE OWNER REVIEWED THE PLAN AND ASKED FOR CHANGES. Their feedback, which overrides anything above:\n"""\n${feedback}\n"""\nRevise your document to address it fully; keep what wasn't questioned.` : '',
    docsText(idea, agent.doc) ? `DOCUMENTS ALREADY WRITTEN BY THE CREW:\n${docsText(idea, agent.doc)}` : '',
    (idea.project.docs || {})[agent.doc] ? `YOUR PREVIOUS VERSION OF THIS DOCUMENT (revise it, don't start over):\n${idea.project.docs[agent.doc].content}` : '',
  ].filter(Boolean).join('\n\n');
}

async function crewTurn(bus, idea, agentId, extra = {}) {
  const agent = CREW[agentId];
  const runner = runners.get(idea.id);
  if (runner) runner.thinking = { agentId, label: `${agent.name} is writing the ${agent.docTitle.toLowerCase()}`, since: Date.now() };
  emit(bus, idea, 'agent_thinking', { agentId, kind: 'doc', round: idea.round, label: runner?.thinking.label });

  const cwd = path.join(WORK_DIR, idea.project.slug, agentId);
  fs.mkdirSync(cwd, { recursive: true });
  const res = await askClaude({
    prompt: `${planningContext(idea, agent, extra)}\n\nYOUR TASK NOW: write the "${agent.docTitle}" document for this project.${agentId === 'ux' ? ' Then write prototype.html in the current directory with the Write tool.' : ''}`,
    system: agent.system,
    model: agent.model,
    tools: agent.tools || [],
    cwd,
  });
  const { summary, content } = splitSummary(res.text);

  idea.project.docs = idea.project.docs || {};
  idea.project.docs[agent.doc] = {
    key: agent.doc, title: agent.docTitle, agentId, agentName: agent.name, content,
    updatedAt: Date.now(), version: ((idea.project.docs[agent.doc] || {}).version || 0) + 1,
  };

  let attachments = [];
  if (agentId === 'ux') {
    const proto = path.join(cwd, 'prototype.html');
    if (fs.existsSync(proto)) {
      const html = fs.readFileSync(proto, 'utf8');
      if (html.length > 200) {
        const meta = saveGenerated({ name: 'prototype.html', type: 'text/html', content: html });
        idea.project.prototype = meta;
        attachments = [meta];
      }
    }
  }
  saveIdea(idea);

  const msg = addMessage(idea, {
    agentId, agentName: agent.name, kind: 'doc', docKey: agent.doc, docTitle: agent.docTitle,
    round: idea.round, summary, content, attachments,
    model: res.model, durationMs: res.durationMs,
  });
  emit(bus, idea, 'message', { message: msg });
  emit(bus, idea, 'docs', { docs: Object.fromEntries(Object.entries(idea.project.docs).map(([k, d]) => [k, { ...d, content: undefined }])), prototype: idea.project.prototype || null });
  return { msg, content };
}

/** Which documents the owner's feedback touches; the PM decides. */
async function triage(idea, feedback) {
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
  if (runners.has(idea.id)) return;
  runners.set(idea.id, { stop: false });
  idea.status = 'running';
  idea.error = null;
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });
  try {
    const docs = idea.project.docs || {};
    // Fresh promotion: everyone. Resume after a pause: whoever hasn't written yet.
    // Owner feedback on a finished plan: whoever the feedback touches.
    let agents;
    if (feedback && Object.keys(docs).length) {
      const label = 'Project Manager is reading your feedback';
      runners.get(idea.id).thinking = { agentId: 'pm', label, since: Date.now() };
      emit(bus, idea, 'agent_thinking', { agentId: 'pm', kind: 'doc', round: idea.round, label });
      agents = await triage(idea, feedback);
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
  } catch (err) {
    if (err.message === '__paused__') {
      idea.status = 'paused';
      saveIdea(idea);
      emit(bus, idea, 'status', { status: 'paused' });
    } else {
      idea.status = 'error';
      idea.error = err.message;
      saveIdea(idea);
      emit(bus, idea, 'status', { status: 'error', error: err.message });
    }
  } finally {
    runners.delete(idea.id);
  }
}

function approvePlan(bus, idea) {
  if (idea.project.stage !== 'plan_review') throw new Error('The plan is not waiting for approval.');
  idea.project.planApprovedAt = Date.now();
  idea.status = 'idle';
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: 'system', kind: 'approved', round: idea.round,
    summary: 'Plan approved', content: 'The owner approved the plan and design. Next: the build crew.',
  });
  emit(bus, idea, 'message', { message: msg });
  setStage(bus, idea, 'building');
  return msg;
}

function pauseProject(idea) {
  const r = runners.get(idea.id);
  if (r) r.stop = true;
}

function projectRunning(ideaId) {
  return runners.has(ideaId);
}

function projectSpeaker(ideaId) {
  const t = runners.get(ideaId)?.thinking;
  return t ? { agentId: t.agentId, label: t.label, elapsedMs: Date.now() - t.since } : null;
}

module.exports = { runPlanning, approvePlan, pauseProject, projectRunning, projectSpeaker, getUpload };
