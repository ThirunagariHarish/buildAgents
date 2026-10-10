// The idea room: a panel of experts debates a rough idea for a personal agent
// into an Agent Brief. Every turn is a headless Claude Code call on the
// owner's plan, text only, no tools.

const fs = require('fs');
const path = require('path');
const { askClaude, splitSummary } = require('./claude');
const { saveAgent, addMessage } = require('./store');
const bus = require('./bus');
const { DATA } = require('./config');

const RULES = `
OUTPUT FORMAT (strict):
- First line exactly: SUMMARY: <one sentence, at most 25 words, your key point this turn>
- Then a blank line, then your contribution in markdown, 120-320 words.
- Text only: no tools, no files, no web.
- You are in a live room. Name the expert you agree or disagree with. Never repeat a settled point; move the agent forward.
- Be concrete: times, triggers, data, exact notification wording. Mark guesses as [guess].`;

const CONTEXT = `
WHAT POCKET BOX BUILDS: a personal agent that runs on the owner's own phone inside the Pocket Box Runtime. An agent is a small package: a manifest (permissions, triggers, settings), one JavaScript run(ctx) function and test scenarios. What an agent can use, through ctx only:
- triggers: a daily schedule (HH:MM, chosen weekdays), an interval (15 min to 24 h), a manual button, or each time the Runtime opens
- notify: a notification to the owner
- memory: small JSON values kept on the phone between runs
- http: read https pages or feeds from host names declared in advance (through the owner's Studio) — e.g. a calendar's secret iCal address, a weather API, an RSS feed
- location: the phone's location when it runs
- model: a language model — on the phone when it has one; otherwise it may be null
- handoff: ask the owner's Studio (Claude Code on the owner's plan) for hard reasoning; owner-only, capped, logged
- settings: values the owner types once (an address, a feed URL, a goal)
Limits: phones do not run anything constantly. Scheduled runs are woken by a push and run when it is delivered or the app opens; nothing reads email, messages, other apps or the screen; no sending, buying or posting on the owner's behalf in v1. Everything is private to the owner.`;

const EXPERTS = {
  orchestrator: {
    name: 'Orchestrator', emoji: '🧭', model: 'opus',
    role: 'Chairs the room: sets the agenda, rules on disagreements, decides when the agent is ready, and writes the Agent Brief.',
    system: `You are the Orchestrator of the Pocket Box idea room, where experts turn the owner's rough idea for a personal phone agent into an Agent Brief a crew can build in one evening. You are decisive and allergic to vagueness: force concrete choices about what the agent does, when, with what data, and what it must never do.\n${CONTEXT}\n${RULES}`,
  },
  designer: {
    name: 'Agent Designer', emoji: '🧩', model: 'sonnet',
    role: 'What the agent decides on its own, what it asks, its exact notifications, and the smallest version worth having.',
    system: `You are the Agent Designer in the Pocket Box idea room. You design the agent's behaviour: the one job it does, the moment it shows up, the exact words of its notification, what it decides alone and what it leaves to the owner, and the smallest v1 that is genuinely useful every week. You cut features that would make it noisy.\n${CONTEXT}\n${RULES}`,
  },
  platform: {
    name: 'Phone Platform Expert', emoji: '📱', model: 'sonnet',
    role: 'What a phone really lets an agent do: background limits, triggers, permissions, what is possible in v1.',
    system: `You are the Phone Platform Expert in the Pocket Box idea room. You know what iPhones (and the Pocket Box web Runtime) really allow: no always-on background processes, scheduled runs woken by push, location only when it runs, no access to other apps, email or messages. You translate the room's wishes into the triggers and ctx tools Pocket Box has, and you say plainly when something is impossible and what the closest honest version is.\n${CONTEXT}\n${RULES}`,
  },
  privacy: {
    name: 'Privacy Officer', emoji: '🔒', model: 'sonnet',
    role: 'What data the agent touches, where it goes, what is never stored, and the permissions it should ask for.',
    system: `You are the Privacy Officer in the Pocket Box idea room. For every piece of data the agent would touch, you say where it comes from, whether it leaves the phone (http reads and hand-offs do), how long memory keeps it, and the minimum permissions. You write the one-paragraph privacy statement the owner will read.\n${CONTEXT}\n${RULES}`,
  },
  reliability: {
    name: 'Reliability Engineer', emoji: '🛟', model: 'sonnet',
    role: 'What happens when it is wrong, offline or late; duplicate alerts; the test scenarios that prove it works.',
    system: `You are the Reliability Engineer in the Pocket Box idea room. You ask what happens when the feed is down, the phone is offline, the run is three hours late, the model returns nothing, or the same thing would be announced twice. You propose the failure behaviour and the 4-6 test scenarios (normal, edge, failure) that must pass before release.\n${CONTEXT}\n${RULES}`,
  },
  critic: {
    name: 'Critic', emoji: '⚖️', model: 'sonnet',
    role: 'The red team: why the owner would switch it off after a week, and how to prevent that.',
    system: `You are the Critic in the Pocket Box idea room. You argue why the owner will mute or delete this agent within a week: noise, wrong timing, stale data, a job a built-in phone feature already does. Quote the expert you attack. End every attack with the change that would keep the agent switched on.\n${CONTEXT}\n${RULES}`,
  },
  voice: {
    name: 'Your Voice', emoji: '🙋', model: 'sonnet',
    role: 'Speaks as the owner: their real day, what would annoy them, what would delight them.',
    system: `You are Your Voice in the Pocket Box idea room: you speak as the owner, in first person, from what they wrote and what "About me" says. Describe the real moment in their day the agent matters, what would annoy them, what they would actually tap, and what would make them keep it. Correct the experts when they assume things about the owner.\n${CONTEXT}\n${RULES}`,
  },
};
const ROSTER = ['designer', 'platform', 'privacy', 'reliability', 'critic', 'voice'];

const TEMPLATES = {
  briefing: { name: 'Daily briefing', emoji: '☀️', hint: 'A scheduled summary the owner reads once a day, built from feeds or the web.' },
  watcher: { name: 'Watcher', emoji: '👀', hint: 'Checks a source on an interval and notifies only when something changes or crosses a threshold.' },
  habit: { name: 'Habit coach', emoji: '🌱', hint: 'Nudges a habit at the right times, counts progress in memory, adapts to the owner.' },
  place: { name: 'Place-aware', emoji: '📍', hint: 'Uses the phone location when it runs to decide what is relevant now.' },
  logger: { name: 'Quick logger', emoji: '📝', hint: 'A manual button that records something and summarises it later.' },
};

// ---- the owner's "About me", used by Your Voice and the crew ---------------
const ABOUT_DIR = path.join(DATA, 'about');
function aboutMe(userId) { try { return fs.readFileSync(path.join(ABOUT_DIR, `${userId}.txt`), 'utf8').slice(0, 4000); } catch { return ''; } }
function setAboutMe(userId, text) { fs.mkdirSync(ABOUT_DIR, { recursive: true }); fs.writeFileSync(path.join(ABOUT_DIR, `${userId}.txt`), String(text || '').slice(0, 4000)); }

function transcript(a, limit = 14000) {
  const lines = a.messages.map((m) => `### ${m.agentName}${m.kind && m.kind !== 'turn' ? ` (${m.kind})` : ''}\n${m.content}`);
  let out = '';
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) out = `${lines[i]}\n\n${out}`;
  return out.trim();
}

function base(a) {
  const about = aboutMe(a.ownerId);
  const tpl = a.template && TEMPLATES[a.template];
  return [
    `THE OWNER'S IDEA:\n"""\n${a.idea}\n"""`,
    tpl ? `TEMPLATE: ${tpl.name} — ${tpl.hint}` : '',
    about ? `ABOUT THE OWNER (from their settings):\n${about}` : '',
    a.brief ? `THE CURRENT AGENT BRIEF:\n${a.brief}` : '',
    `TRANSCRIPT SO FAR:\n${transcript(a)}`,
  ].filter(Boolean).join('\n\n');
}

function checkStop(a) { if (bus.stopping(a.id)) throw new Error('__paused__'); }

async function turn(a, expertId, task, kind = 'turn') {
  const e = EXPERTS[expertId];
  bus.setThinking(a.id, { agentId: expertId, label: `${e.name} is thinking` });
  bus.publish(a, { event: 'thinking', expertId, name: e.name, emoji: e.emoji });
  const res = await askClaude({ system: e.system, model: e.model, prompt: `${base(a)}\n\n${task}`, timeoutMs: 8 * 60 * 1000 });
  const { summary, content } = splitSummary(res.text);
  const msg = addMessage(a, { agentId: expertId, agentName: e.name, emoji: e.emoji, kind, summary, content, durationMs: res.durationMs });
  saveAgent(a);
  bus.publish(a, { event: 'message', message: msg });
  return msg;
}

function setStatus(a, status, extra = {}) {
  Object.assign(a, { status }, extra);
  saveAgent(a);
  bus.publish(a, { event: 'status', status: a.status, stage: a.stage, error: a.error || null });
}

/** Debate the idea (or the owner's latest feedback) into an Agent Brief. */
async function runRoom(a, { extraRounds } = {}) {
  if (!bus.start(a.id)) return;
  setStatus(a, 'running', { error: null, stage: 'room' });
  try {
    const startRound = a.round;
    const last = startRound + (extraRounds || a.maxRounds);
    if (startRound === 0) {
      a.round = 1;
      await turn(a, 'orchestrator', 'KICKOFF. Restate the agent idea in two sentences, name the one job it must do well, and set an agenda of 3-4 sharp questions this room must settle (when it runs, what it reads, what it says, what it must never do).', 'kickoff');
    } else {
      a.round += 1;
      await turn(a, 'orchestrator', 'The owner has replied (latest owner message in the transcript). Restate what they want changed and set the agenda for this round.', 'kickoff');
    }
    while (true) {
      for (const id of ROSTER) { checkStop(a); await turn(a, id, `ROUND ${a.round}. Contribute from your role to the agenda.`); }
      checkStop(a);
      const syn = await turn(a, 'orchestrator', `SYNTHESIS for round ${a.round}. Summarise what is settled, rule on disagreements, list what is still open. End with exactly one line "DECISION: CONTINUE" or "DECISION: CONCLUDE" and one sentence why. Conclude when the agent's job, triggers, data, notifications and failure behaviour are decided.`, 'synthesis');
      if (/DECISION:\s*CONCLUDE/i.test(syn.content) || a.round >= last) break;
      a.round += 1;
      saveAgent(a);
    }
    checkStop(a);
    const brief = await turn(a, 'orchestrator', `FINAL AGENT BRIEF. Write the definitive brief in markdown, with exactly these sections:
# <Agent name> — <one-line promise>
## The job (one sentence)
## When it runs (each trigger, exact times or intervals)
## What it reads (each source, host name, setting it needs from the owner)
## What it says (the exact notification title and body patterns, with an example)
## Acts alone vs. asks first
## Memory (keys, what is kept, for how long)
## Permissions (only from: notify, memory, location, http, model, handoff — and why each)
## Settings the owner provides
## Failure behaviour (offline, bad data, late run, nothing new, model returns nothing)
## Test scenarios (5-8, each one line: situation → expected outcome)
## Privacy statement (one paragraph the owner reads)
## Success after one week
Then end with a line "ICON: <one emoji>" and a line "NAME: <2-4 word agent name>".`, 'brief');
    a.brief = brief.content.replace(/^\s*(ICON|NAME):.*$/gim, '').trim();
    const icon = (brief.content.match(/^\s*ICON:\s*(\S+)/im) || [])[1];
    const name = (brief.content.match(/^\s*NAME:\s*(.+)$/im) || [])[1];
    if (icon) a.icon = [...icon].slice(0, 2).join('');
    if (name) a.title = name.trim().slice(0, 40);
    const shown = a.messages.find((m) => m.id === brief.id);
    if (shown) shown.content = a.brief;
    a.briefAt = Date.now();
    setStatus(a, 'idle', { stage: 'brief' });
    require('./notify').tell(a, { title: 'Agent Brief ready', body: `${a.title}: read it, then build it or reply.` });
  } catch (e) {
    if (e.message === '__paused__') setStatus(a, 'paused');
    else setStatus(a, 'error', { error: e.message });
  } finally {
    bus.finish(a.id);
  }
}

/** A question to the room, answered by the Orchestrator without a new round. */
async function answer(a, question) {
  if (!bus.start(a.id)) return;
  const prev = a.status;
  setStatus(a, 'running');
  try {
    await turn(a, 'orchestrator', `QUICK QUESTION from the owner (not a new round): """${question}"""\nAnswer it directly in under 150 words from the transcript and brief. No agenda.`, 'answer');
    setStatus(a, prev === 'running' ? 'idle' : prev);
  } catch (e) { setStatus(a, 'error', { error: e.message }); }
  finally { bus.finish(a.id); }
}

module.exports = { EXPERTS, ROSTER, TEMPLATES, runRoom, answer, aboutMe, setAboutMe, transcript, setStatus };
