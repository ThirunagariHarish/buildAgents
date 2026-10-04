// Orchestration engine: runs the multi-agent debate for an idea.
//
// Flow per refinement cycle:
//   1. Orchestrator KICKOFF  — frames the idea, picks the roster, sets the agenda
//   2. Research phase        — Market Researcher + Competitor Scout search the web (round 1)
//   3. Debate round          — the picked specialists, plus every user-added agent
//   4. Orchestrator SYNTHESIS + verdict (CONTINUE → another round, CONCLUDE → step 5),
//      optionally requesting one follow-up research question first
//   5. Orchestrator FINAL BRIEF — the mature idea document
//
// One agent speaks at a time; every turn is a fresh headless `claude -p` call
// that receives the idea + running transcript.

const { askClaude, splitSummary } = require('./claude');
const { getAgents, getPickable, rosterFrom } = require('./agents');
const { saveIdea, addMessage } = require('./store');
const { forClaude } = require('./uploads');

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
      const files = m.attachments?.length ? `\n[attached: ${m.attachments.map((a) => a.name).join(', ')}]` : '';
      return `--- ${who} (round ${m.round}) ---\n${m.content}${files}`;
    });
  let text = lines.join('\n\n');
  if (text.length > maxChars) text = '[earlier transcript truncated]\n\n' + text.slice(-maxChars);
  return text;
}

function allAttachments(idea) {
  return [
    ...(idea.attachments || []),
    ...idea.messages.flatMap((m) => m.attachments || []),
  ];
}

function baseContext(idea, files) {
  let attached = '';
  if (files.mediaNames.length || files.text) {
    attached = `\nFILES THE USER ATTACHED:\n`;
    if (files.mediaNames.length) attached += `Images/PDFs (included with this message — look at them): ${files.mediaNames.join(', ')}\n`;
    if (files.text) attached += files.text;
    attached += `Use what these files show; refer to them by name.\n`;
  }
  const ideaFiles = idea.attachments?.length ? `\n[attached with the idea: ${idea.attachments.map((a) => a.name).join(', ')}]` : '';
  return `THE USER'S IDEA (verbatim):\n"""\n${idea.text}\n"""${ideaFiles}\n${attached}\nDEBATE TRANSCRIPT SO FAR:\n${idea.messages.length ? transcriptFor(idea) : '(empty — the debate has not started)'}\n`;
}

async function agentTurn(bus, idea, agentId, moderatorPrompt, kind, models, { label } = {}) {
  const agent = getAgents()[agentId];
  if (!agent) return null; // removed from the pool mid-debate
  const runner = runners.get(idea.id);
  if (runner) runner.thinking = { agentId, label, since: Date.now() };
  emit(bus, idea, 'agent_thinking', { agentId, kind, round: idea.round, label });
  const model = (models && models[agentId]) || agent.model;
  const files = forClaude(allAttachments(idea));
  const res = await askClaude({
    prompt: `${baseContext(idea, files)}\nMODERATOR INSTRUCTION FOR THIS TURN:\n${moderatorPrompt}`,
    system: agent.system,
    model,
    blocks: files.blocks,
    tools: agent.tools || [],
  });
  const { summary, content } = splitSummary(res.text);
  const msg = addMessage(idea, {
    agentId, agentName: agent.name, kind, round: idea.round, summary, content,
    model: res.model, durationMs: res.durationMs,
  });
  emit(bus, idea, 'message', { message: msg });
  return { msg, content };
}

function poolText() {
  const agents = getAgents();
  return getPickable().map((id) => `[${id}] ${agents[id].name} — ${agents[id].description || ''}${agents[id].builtin ? '' : ' (added by the user; always takes part)'}`).join('\n');
}

function rosterNames(idea) {
  const agents = getAgents();
  return (idea.roster || []).map((id) => agents[id]?.name).filter(Boolean).join(', ');
}

/** The Orchestrator's "RESEARCH:" line: 'yes', 'no', or a follow-up question. */
function researchDirective(text) {
  const m = String(text || '').match(/^\s*RESEARCH:\s*(.+)$/im);
  if (!m) return null;
  const v = m[1].trim().replace(/[*_`]/g, '');
  if (/^(yes|y|true)\b/i.test(v)) return 'yes';
  if (/^(no|n|none|false|skip)\b/i.test(v)) return 'no';
  return v.length > 12 ? v : null;
}

const RESEARCH_LABEL = 'Market Researcher and Competitor Scout are searching the web';

async function researchPhase(bus, idea, models) {
  const prompt = (who) => `RESEARCH PHASE, before the debate starts. Read the Orchestrator's kickoff above: answer the fact questions it raised that fall in your area, and cover your standard ground for THIS idea. Search the web now; do not rely on memory. ${who}`;
  await Promise.all([
    agentTurn(bus, idea, 'researcher', prompt('Focus on the market, the customers and demand; leave competitor profiles to the Scout.'), 'research', models, { label: RESEARCH_LABEL }),
    agentTurn(bus, idea, 'scout', prompt('Focus on competitors and substitutes; leave market sizing to the Researcher.'), 'research', models, { label: RESEARCH_LABEL }),
  ]);
}

function pickRoster(idea, content) {
  const roster = rosterFrom(content);
  idea.roster = roster;
  saveIdea(idea);
  return roster;
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
      const kick = await agentTurn(bus, idea, 'orchestrator',
        `KICKOFF. This is the start of the debate. Restate the user's idea crisply and name its core hypothesis.

PICK THE ROOM. Choose the 4 to 7 specialists whose angle matters most for THIS idea from the pool below, and leave the rest out — a consumer app needs different voices than a B2B tool or a hardware idea. Say in one line each why you picked them.
${poolText()}

RESEARCH. The Market Researcher and Competitor Scout can search the web before the debate. Say whether that is worth doing (it almost always is; say no only for purely personal or internal ideas with no market), and if yes, list 2-4 specific fact questions you want answered with sources.

AGENDA. Set the 3-5 sharpest questions this first round must answer, assigning at least one pointed question to each specialist you picked.

End your message with exactly these two lines, using the ids in brackets:
ROSTER: id, id, id, ...
RESEARCH: yes or no`,
        'kickoff', models);
      const roster = pickRoster(idea, kick?.content);
      emit(bus, idea, 'roster', { roster });
      if (researchDirective(kick?.content) !== 'no') {
        checkStop(idea);
        await researchPhase(bus, idea, models);
      }
    } else {
      // Continuing a project that already ran: start a new cycle.
      idea.round += 1;
      saveIdea(idea);
      const kick = await agentTurn(bus, idea, 'orchestrator',
        `NEW CYCLE KICKOFF. The user has reopened this idea (probably after giving feedback — check the end of the transcript for USER messages and treat them as the priority). Summarize where the idea stands now, then set a fresh agenda of the 3-5 most valuable open questions for this new round.

THE ROOM. The current room is: ${rosterNames(idea) || 'the core five'}. Keep it unless the new questions need a different specialist; you may re-pick from the pool below. Assign at least one question to each specialist in the room.
${poolText()}

RESEARCH. If the user's feedback or the open questions need new facts from the web, say what to look up; otherwise say no.

End your message with exactly these two lines:
ROSTER: id, id, id, ...
RESEARCH: no — or a single specific question for the Market Researcher to look up`,
        'kickoff', models);
      if (/^\s*ROSTER:/im.test(kick?.content || '')) emit(bus, idea, 'roster', { roster: pickRoster(idea, kick.content) });
      else if (!idea.roster) pickRoster(idea, '');
      const q = researchDirective(kick?.content);
      if (q && q !== 'no') {
        checkStop(idea);
        await agentTurn(bus, idea, 'researcher',
          q === 'yes' ? 'RESEARCH. The Orchestrator asked for fresh research for this new round: cover what its kickoff above asks for. Search the web now.' : `FOLLOW-UP RESEARCH. The Orchestrator wants this answered with sources before the round starts: "${q}". Search the web now and answer exactly that.`,
          'research', models, { label: 'Market Researcher is searching the web' });
      }
    }

    let concluded = false;
    while (!concluded) {
      checkStop(idea);

      // Debate round: each persona speaks, seeing everything said before them.
      for (const agentId of idea.roster || rosterFrom('')) {
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
          : `Then decide: if another debate round would still materially improve the idea, end with "DECISION: CONTINUE" and set the next round's agenda; if the idea is mature, end with "DECISION: CONCLUDE". Max rounds: ${idea.maxRounds}, current: ${idea.round}. If continuing and one specific fact from the web would settle a disagreement, add a final line "RESEARCH: <that one question>"; otherwise omit it.`),
        'synthesis', models);

      if (/DECISION:\s*CONTINUE/i.test(content) && idea.round < idea.maxRounds) {
        idea.round += 1;
        saveIdea(idea);
        emit(bus, idea, 'round', { round: idea.round });
        const q = researchDirective(content);
        if (q && q !== 'yes' && q !== 'no') {
          checkStop(idea);
          await agentTurn(bus, idea, 'researcher',
            `FOLLOW-UP RESEARCH. The Orchestrator wants this answered with sources before round ${idea.round}: "${q}". Search the web now and answer exactly that, then say which side of the disagreement the evidence supports.`,
            'research', models, { label: 'Market Researcher is searching the web' });
        }
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

/** Who is speaking right now, for pages that open mid-turn. */
function currentSpeaker(ideaId) {
  const t = runners.get(ideaId)?.thinking;
  return t ? { agentId: t.agentId, label: t.label, elapsedMs: Date.now() - t.since } : null;
}

module.exports = { runIdea, pauseIdea, isRunning, currentSpeaker };
