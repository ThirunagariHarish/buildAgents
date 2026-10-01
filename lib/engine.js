// Orchestration engine: runs the multi-agent debate for an idea.
//
// Flow per refinement cycle:
//   1. Orchestrator KICKOFF  — frames the idea, sets the agenda
//   2. Debate round          — every agent in the pool, built-in and added
//   3. Orchestrator SYNTHESIS + verdict (CONTINUE → another round, CONCLUDE → step 4)
//   4. Orchestrator FINAL BRIEF — the mature idea document
//
// One agent speaks at a time; every turn is a fresh headless `claude -p` call
// that receives the idea + running transcript.

const { askClaude, splitSummary } = require('./claude');
const { getAgents, getDebateOrder } = require('./agents');
const { saveIdea, addMessage } = require('./store');

const runners = new Map(); // ideaId -> { stop: bool }

function emit(bus, idea, event, payload) {
  bus.publish(idea.id, { event, ...payload });
}

function transcriptFor(idea, { maxChars = 60000 } = {}) {
  const agents = getAgents();
  const lines = idea.messages
    .filter((m) => m.kind !== 'status')
    .map((m) => {
      const who = m.agentId === 'user' ? 'USER (the idea owner)' : (agents[m.agentId]?.name || m.agentName || m.agentId).toUpperCase();
      return `--- ${who} (round ${m.round}) ---\n${m.content}`;
    });
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = '[earlier transcript truncated]\n\n' + text.slice(-maxChars);
  return text;
}

function baseContext(idea) {
  return `THE USER'S IDEA (verbatim):\n"""\n${idea.text}\n"""\n\nDEBATE TRANSCRIPT SO FAR:\n${idea.messages.length ? transcriptFor(idea) : '(empty — the debate has not started)'}\n`;
}

async function agentTurn(bus, idea, agentId, moderatorPrompt, kind, models) {
  const agent = getAgents()[agentId];
  if (!agent) return null; // removed from the pool mid-debate
  emit(bus, idea, 'agent_thinking', { agentId, kind, round: idea.round });
  const model = (models && models[agentId]) || agent.model;
  const res = await askClaude({
    prompt: `${baseContext(idea)}\nMODERATOR INSTRUCTION FOR THIS TURN:\n${moderatorPrompt}`,
    system: agent.system,
    model,
  });
  const { summary, content } = splitSummary(res.text);
  const msg = addMessage(idea, {
    agentId, agentName: agent.name, kind, round: idea.round, summary, content,
    model: res.model, durationMs: res.durationMs,
  });
  emit(bus, idea, 'message', { message: msg });
  return { msg, content };
}

function debateNames() {
  const agents = getAgents();
  return getDebateOrder().map((id) => agents[id]?.name).filter(Boolean).join(', ');
}

function checkStop(idea) {
  const r = runners.get(idea.id);
  if (r && r.stop) throw new Error('__paused__');
}

async function runIdea(bus, idea, opts = {}) {
  if (runners.has(idea.id)) return; // already running
  runners.set(idea.id, { stop: false });
  idea.status = 'running';
  idea.error = null;
  if (opts.maxRounds) idea.maxRounds = opts.maxRounds;
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });

  const models = opts.models;
  const isResume = idea.messages.some((m) => m.kind === 'kickoff');

  try {
    if (!isResume) {
      idea.round = 1;
      saveIdea(idea);
      await agentTurn(bus, idea, 'orchestrator',
        `KICKOFF. This is the start of the debate. Restate the user's idea crisply, name its core hypothesis, and set an agenda of the 3-5 sharpest questions this first round must answer. Assign at least one pointed question to each of: ${debateNames()}.`,
        'kickoff', models);
    } else {
      // Continuing a project that already ran: start a new cycle.
      idea.round += 1;
      saveIdea(idea);
      await agentTurn(bus, idea, 'orchestrator',
        `NEW CYCLE KICKOFF. The user has reopened this project (possibly after adding new input — check the end of the transcript for USER messages). Summarize where the idea stands now, then set a fresh agenda of the 3-5 most valuable open questions for this new round, assigning at least one question to each of: ${debateNames()}.`,
        'kickoff', models);
    }

    let concluded = false;
    while (!concluded) {
      checkStop(idea);

      // Debate round: each persona speaks, seeing everything said before them.
      for (const agentId of getDebateOrder()) {
        checkStop(idea);
        await agentTurn(bus, idea, agentId,
          `It is your turn in debate round ${idea.round}. Answer the Orchestrator's agenda questions aimed at you, then react to the strongest and weakest points other agents have made this round. Propose at least one concrete improvement, feature, or decision for the idea. If you disagree with someone, say so by name and argue it.`,
          'debate', models);
      }

      checkStop(idea);
      // Synthesis + verdict.
      const { content } = await agentTurn(bus, idea, 'orchestrator',
        `SYNTHESIS of round ${idea.round}. Summarize what this round settled (as decisions), rule on open disagreements, and list what remains unproven. ` +
        (idea.round >= idea.maxRounds
          ? `This was the final allowed round, so you MUST end with "DECISION: CONCLUDE".`
          : `Then decide: if another debate round would still materially improve the idea, end with "DECISION: CONTINUE" and set the next round's agenda; if the idea is mature, end with "DECISION: CONCLUDE". Max rounds: ${idea.maxRounds}, current: ${idea.round}.`),
        'synthesis', models);

      if (/DECISION:\s*CONTINUE/i.test(content) && idea.round < idea.maxRounds) {
        idea.round += 1;
        saveIdea(idea);
        emit(bus, idea, 'round', { round: idea.round });
      } else {
        concluded = true;
      }
    }

    checkStop(idea);
    // Final brief.
    const { msg } = await agentTurn(bus, idea, 'orchestrator',
      `FINAL BRIEF. The debate has concluded. Write the definitive Idea Brief that captures the mature version of this idea, incorporating every decision the room made. Structure it in markdown with these sections: # <Refined idea name> — one-line pitch, ## Problem, ## Solution, ## Target customer & beachhead, ## Business model, ## Go-to-market, ## MVP scope (what's in, what's cut), ## Architecture sketch, ## Key risks & mitigations, ## Roadmap (3 phases), ## Open questions for the user. Be specific — this document should let the user start building tomorrow.`,
      'brief', models);
    idea.brief = msg.content;
    idea.status = 'done';
    saveIdea(idea);
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

function pauseIdea(idea) {
  const r = runners.get(idea.id);
  if (r) r.stop = true;
}

function isRunning(ideaId) {
  return runners.has(ideaId);
}

module.exports = { runIdea, pauseIdea, isRunning };
