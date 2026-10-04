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
const { getAgents, getPickable, rosterFrom, TEMPLATES } = require('./agents');
const { saveIdea, addMessage } = require('./store');
const { forClaude } = require('./uploads');
const { notify } = require('./notify');
const prefs = require('./prefs');

function templateText(idea) {
  const t = idea.template && TEMPLATES[idea.template];
  if (!t) return '';
  return `\nIDEA TYPE chosen by the user: ${t.name}. ${t.hint} A good starting room for this type is: ${t.roster.join(', ')} — adjust if this idea needs others.${t.research === false ? ' Web research is usually unnecessary for this type.' : ''}\n`;
}

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
    ...prefs.context().attachments,
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
  const owner = prefs.context().text;
  return `${owner ? `${owner}\n\n` : ''}THE USER'S IDEA (verbatim):\n"""\n${idea.text}\n"""${ideaFiles}\n${attached}\nDEBATE TRANSCRIPT SO FAR:\n${idea.messages.length ? transcriptFor(idea) : '(empty — the debate has not started)'}\n`;
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
${templateText(idea)}
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
    } else if (opts.mode === 'devil') {
      // One extra round where the whole room argues against the idea.
      idea.round += 1;
      idea.maxRounds = Math.max(idea.maxRounds, idea.round);
      saveIdea(idea);
      emit(bus, idea, 'round', { round: idea.round });
      await agentTurn(bus, idea, 'orchestrator',
        `DEVIL'S ADVOCATE ROUND. The owner asked the whole room to argue AGAINST the current version of the idea for one round. Restate the idea as it stands (from the latest brief or synthesis), then give each specialist in the room (${rosterNames(idea) || 'the core five'}) the one angle from which they must attack it hardest. No praise this round.`,
        'kickoff', models);
      if (!idea.roster) pickRoster(idea, '');
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
          opts.mode === 'devil'
            ? `DEVIL'S ADVOCATE ROUND ${idea.round}. Argue that this idea fails, from your angle: the strongest two or three reasons, with the mechanism of failure and the evidence from the transcript or research. No hedging and no fixes this turn — the Orchestrator will weigh the attacks afterwards.`
            : `It is your turn in debate round ${idea.round}. Answer the Orchestrator's agenda questions aimed at you, then react to the strongest and weakest points other agents have made this round. Propose at least one concrete improvement, feature, or decision for the idea. If you disagree with someone, say so by name and argue it.`,
          'debate', models);
      }

      checkStop(idea);
      // Synthesis + verdict.
      const { content } = await agentTurn(bus, idea, 'orchestrator',
        (opts.mode === 'devil'
          ? `SYNTHESIS of the devil's advocate round. Rank the attacks by how much they threaten the idea, say which ones the existing plan already answers, which require a change to the idea (state the change), and which are unanswerable risks to carry knowingly. Then end with "DECISION: CONCLUDE".`
          : `SYNTHESIS of round ${idea.round}. Summarize what this round settled (as decisions), rule on open disagreements, and list what remains unproven. `) +
        (opts.mode === 'devil' ? '' : idea.round >= idea.maxRounds
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
    if (idea.brief) {
      idea.briefHistory = [...(idea.briefHistory || []), { content: idea.brief, ts: idea.briefAt || idea.createdAt, round: idea.briefRound || 0 }].slice(-10);
    }
    idea.brief = msg.content;
    idea.briefAt = Date.now();
    idea.briefRound = idea.round;
    saveIdea(idea);
    checkStop(idea);
    await scorecard(bus, idea);
    idea.status = 'done';
    saveIdea(idea);
    emit(bus, idea, 'status', { status: 'done' });
    notify(idea, 'brief');
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
      notify(idea, 'error');
    }
  } finally {
    runners.delete(idea.id);
  }
}

/** Every agent in the room scores the brief 1-10 with one line of reasoning. */
async function scorecard(bus, idea) {
  const agents = getAgents();
  const roster = (idea.roster || rosterFrom('')).filter((id) => agents[id]);
  if (!roster.length) return;
  const runner = runners.get(idea.id);
  if (runner) runner.thinking = { agentId: 'orchestrator', label: 'The room is scoring the brief', since: Date.now() };
  emit(bus, idea, 'agent_thinking', { agentId: 'orchestrator', kind: 'scorecard', round: idea.round, label: 'The room is scoring the brief' });
  const votes = await Promise.all(roster.map(async (id) => {
    try {
      const res = await askClaude({
        system: agents[id].system,
        model: agents[id].model === 'opus' ? 'sonnet' : agents[id].model,
        prompt: `THE FINAL IDEA BRIEF:\n${idea.brief}\n\nSCORING. From your role's perspective only, how strong is this idea as briefed, 1 (abandon) to 10 (exceptional)? Reply with exactly two lines:\nSCORE: <number>\nWHY: <one sentence, under 25 words>`,
        timeoutMs: 3 * 60 * 1000,
      });
      const score = Number((res.text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i) || [])[1]);
      const why = (res.text.match(/WHY:\s*(.+)/i) || [])[1] || '';
      return Number.isFinite(score) ? { agentId: id, score: Math.max(1, Math.min(10, score)), why: why.trim().slice(0, 200) } : null;
    } catch { return null; }
  }));
  const list = votes.filter(Boolean);
  if (!list.length) return;
  const avg = list.reduce((s, v) => s + v.score, 0) / list.length;
  idea.scorecard = { votes: list, avg: Math.round(avg * 10) / 10, round: idea.round, ts: Date.now() };
  saveIdea(idea);
  const msg = addMessage(idea, {
    agentId: 'system', kind: 'scorecard', round: idea.round,
    summary: `Room score ${idea.scorecard.avg} / 10`,
    content: list.map((v) => `- ${agents[v.agentId].name}: ${v.score}/10 — ${v.why}`).join('\n'),
    scorecard: idea.scorecard,
  });
  emit(bus, idea, 'message', { message: msg });
}

/**
 * A quick question to the room (or one agent) outside the debate: no round,
 * no synthesis, no brief change. The answer lands in the thread.
 */
async function runQuick(bus, idea, { question, agentId }) {
  if (runners.has(idea.id)) return;
  runners.set(idea.id, { stop: false });
  const prevStatus = idea.status;
  idea.status = 'running';
  saveIdea(idea);
  emit(bus, idea, 'status', { status: 'running' });
  try {
    const agents = getAgents();
    let responders = agentId && agents[agentId] ? [agentId] : [];
    if (!responders.length) {
      const pool = (idea.roster || rosterFrom('')).filter((id) => agents[id]);
      const pick = await askClaude({
        model: 'haiku',
        system: 'You route questions to the right expert. Reply with only one or two agent ids, comma-separated, nothing else.',
        prompt: `Agents in the room:\n${pool.map((id) => `[${id}] ${agents[id].name} — ${agents[id].description || ''}`).join('\n')}\n\nThe owner asks: """${question}"""\n\nWhich one or two agents should answer?`,
      });
      responders = (pick.text.toLowerCase().match(/[a-z0-9-]+/g) || []).filter((id) => pool.includes(id)).slice(0, 2);
      if (!responders.length) responders = [pool[0] || 'entrepreneur'];
    }
    for (const id of responders) {
      checkStop(idea);
      await agentTurn(bus, idea, id,
        `QUICK QUESTION from the owner, outside the debate: """${question}"""\nAnswer it directly and specifically from your role, using the transcript and brief as context. Under 200 words. This is not a debate round: no agenda, no new proposals beyond the question.`,
        'answer');
    }
    idea.status = prevStatus === 'running' ? 'paused' : prevStatus;
    saveIdea(idea);
    emit(bus, idea, 'status', { status: idea.status });
  } catch (err) {
    idea.status = err.message === '__paused__' ? (prevStatus === 'running' ? 'paused' : prevStatus) : 'error';
    if (idea.status === 'error') idea.error = err.message;
    saveIdea(idea);
    emit(bus, idea, 'status', { status: idea.status, error: idea.error || undefined });
  } finally {
    runners.delete(idea.id);
  }
}

const EXTRAS = {
  pitch: { title: 'Pitch deck', agent: 'orchestrator', prompt: 'Write a 10-slide investor pitch deck from the brief. Markdown: each slide as "## Slide N — <title>" with 3-5 tight bullets (and speaker notes in italics). Slides: title and one-liner, problem, solution, product (what it does), market, business model, go-to-market, competition and moat, roadmap and milestones, the ask.' },
  onepager: { title: 'One-pager', agent: 'orchestrator', prompt: 'Write a one-page summary of the idea for someone who has 90 seconds: a headline, a two-sentence pitch, who it is for, why now, how it makes money, what exists today and why this is better, the first milestone, and a closing line. Under 350 words, markdown.' },
  elevator: { title: 'Elevator pitches', agent: 'marketer', prompt: 'Write three spoken elevator pitches for the idea: "## 10 seconds" (one sentence), "## 30 seconds" (3-4 sentences) and "## 2 minutes" (a short story with problem, solution, proof, ask). Natural spoken language, no jargon, no bullet points inside the pitches.' },
  landing: { title: 'Landing page copy', agent: 'marketer', prompt: 'Write landing-page copy for the idea: hero headline and subheadline, three benefit blocks with titles, a "how it works" in three steps, social-proof placeholders, pricing section outline, FAQ with five questions, and the call to action. Markdown with the section names as headings.' },
  premortem: { title: 'Pre-mortem', agent: 'critic', prompt: 'Write a pre-mortem: it is one year later and the project has failed. Tell the story of how, in past tense, as a short narrative, then list the five most likely causes of death ranked by probability with the early warning sign for each and the cheapest prevention. Finish with the one assumption that, if wrong, kills everything.' },
  tam: { title: 'Market size model', agent: 'finance', prompt: 'Build a market size model: TAM, SAM and SOM, each derived bottom-up from explicit assumptions (number of potential customers, share reachable, share winnable in 3 years, price per year). Put every assumption in an "## Assumptions" table with a plain-language name, your value, and a low/high range, then show the resulting TAM/SAM/SOM for base, low and high cases in a table. State what evidence from the transcript supports each assumption and which ones the owner should verify first. The owner will change the assumption values, so make the arithmetic explicit.' },
  pricing: { title: 'Pricing options', agent: 'finance', prompt: 'Propose three pricing models for this product (for example free + paid tier, per-seat, usage-based, one-time, marketplace take rate). For each: who pays, the price points, what is gated, expected conversion and annual revenue at 1,000 and 10,000 active users with assumptions shown, the main risk, and which competitors use it. End with a recommendation and the first pricing experiment to run.' },
  regulatory: { title: 'Regulatory checklist', agent: 'legal', prompt: 'Write a regulatory and compliance checklist for launching this product: the laws and platform rules that apply (privacy, consumer protection, payments, sector-specific, app-store policies), who enforces them, what the MVP must do to comply (a checkbox list in order), documents to publish (terms, privacy policy, etc.), and what to defer until there is traction. Mark each item required / recommended / later, and name the jurisdictions you assumed.' },
  stores: { title: 'App store scan', agent: 'scout', tools: ['WebSearch', 'WebFetch'], prompt: 'Search the Apple App Store and Google Play (and the Chrome Web Store if relevant) for apps that compete with or resemble this idea. For the 5-8 most relevant: name, store link, rating and number of reviews, price model, last update, and the recurring complaints in reviews. Then summarise what users of these apps say they are missing. Cite links for every app.' },
  forums: { title: 'What people complain about', agent: 'researcher', tools: ['WebSearch', 'WebFetch'], prompt: 'Search Reddit, Hacker News, product forums and review sites for real people describing the problem this idea solves and their frustration with current solutions. Quote 8-12 short verbatim complaints with a link to each, group them into themes, and say which themes the brief addresses, which it ignores, and what language the customers themselves use (useful for marketing copy).' },
  seo: { title: 'Search demand & keywords', agent: 'researcher', tools: ['WebSearch', 'WebFetch'], prompt: 'Assess search demand for this idea: list 15-25 keywords people would use (problem terms, solution terms, competitor names, "best X for Y"), estimate relative interest and competitiveness from what you can verify (search results, autocomplete, who ranks today), and recommend 5 keywords to build content around first. Cite how you judged each. Be explicit that volumes are estimates unless you found a source.' },
};

/** Generate a derived document from the brief; stored on the idea. */
async function generateExtra(bus, idea, kind) {
  const spec = EXTRAS[kind];
  if (!spec) throw new Error('Unknown document type.');
  if (!idea.brief) throw new Error('The idea needs a finished brief first.');
  const agents = getAgents();
  const agent = agents[spec.agent];
  const res = await askClaude({
    system: agent.system,
    model: 'sonnet',
    prompt: `${prefs.context().text ? `${prefs.context().text}\n\n` : ''}THE IDEA BRIEF:\n${idea.brief}\n\nTASK: ${spec.prompt}\n\nReply with the document only, in markdown, no preamble, no SUMMARY line.`,
    tools: spec.tools || [],
    timeoutMs: (spec.tools ? 15 : 5) * 60 * 1000,
  });
  idea.extras = idea.extras || {};
  idea.extras[kind] = { kind, title: spec.title, agentId: spec.agent, content: res.text.trim(), ts: Date.now(), briefRound: idea.briefRound || idea.round };
  saveIdea(idea);
  emit(bus, idea, 'extras', { extras: Object.fromEntries(Object.entries(idea.extras).map(([k, v]) => [k, { ...v, content: undefined }])) });
  return idea.extras[kind];
}

/** Compare two ideas: the Orchestrator writes a verdict, stored on both. */
async function compareIdeas(bus, a, b) {
  const agents = getAgents();
  const res = await askClaude({
    system: agents.orchestrator.system,
    model: 'sonnet',
    prompt: `${prefs.context().text ? `${prefs.context().text}\n\n` : ''}Two ideas the owner is weighing. Compare them and recommend which to pursue first.\n\n=== IDEA A: ${a.title} ===\n${a.text}\n\nBRIEF A:\n${a.brief || '(no brief yet)'}\n\n=== IDEA B: ${b.title} ===\n${b.text}\n\nBRIEF B:\n${b.brief || '(no brief yet)'}\n\nWrite "# ${a.title} vs ${b.title}" with: ## Side by side (a table: problem, customer, business model, moat, effort to MVP, biggest risk, time to first revenue), ## Where each wins, ## Could they combine, ## Recommendation (one to pursue first and why, in plain terms), ## What would change the recommendation. Markdown only, no preamble.`,
    timeoutMs: 5 * 60 * 1000,
  });
  const doc = { kind: 'comparison', title: `Compared with ${b.title}`, agentId: 'orchestrator', content: res.text.trim(), ts: Date.now(), otherId: b.id, otherTitle: b.title };
  for (const [idea, other] of [[a, b], [b, a]]) {
    idea.extras = idea.extras || {};
    idea.extras[`compare_${other.id}`] = { ...doc, title: `Compared with ${other.title}`, otherId: other.id, otherTitle: other.title };
    saveIdea(idea);
    emit(bus, idea, 'extras', {});
  }
  return doc;
}

/** Weekly trend watch: the Market Researcher posts fresh news into the thread. */
async function trendTurn(bus, idea) {
  if (runners.has(idea.id)) return null;
  runners.set(idea.id, { stop: false });
  try {
    const r = await agentTurn(bus, idea, 'researcher',
      `TREND WATCH (weekly). Search the web for what changed in the last 7-14 days that matters to this idea: competitor launches, funding, pricing changes, regulation, platform policy changes, notable news or demand signals. Report only what is new and dated, with links; say explicitly if nothing material happened. End with "## What this changes" in 2-3 bullets.`,
      'research', null, { label: 'Market Researcher is checking this week\'s news' });
    idea.watchedAt = Date.now();
    saveIdea(idea);
    return r;
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

module.exports = { runIdea, runQuick, generateExtra, compareIdeas, trendTurn, EXTRAS, pauseIdea, isRunning, currentSpeaker };
