# 📦 Box

**A room of AI experts that debates your idea until it's a real project.**

You drop in a raw idea. Six specialized agents — an Orchestrator, an Entrepreneur, a Marketer, a Solution Architect, a Visionary, and a Critic — debate it live in a chat room: they answer each other, attack weak points, propose features, and iterate round after round until the idea matures into a concrete **Idea Brief** you could start building from tomorrow.

## No API key. No SDK.

Box does **not** use the Anthropic API or the Claude Agent SDK. Every agent turn is a headless invocation of the **Claude Code CLI** (`claude -p`), which runs on your existing **Claude subscription login** (Pro/Max). If `claude` works in your terminal, Box works — zero extra cost, zero keys, zero npm dependencies.

```
Browser UI  ──►  Box server (plain Node.js)  ──►  claude -p  (your Claude subscription)
   ▲                    │
   └── live SSE stream ─┘
```

## Quick start

Requirements: Node.js ≥ 18 and the [Claude Code CLI](https://claude.com/claude-code) installed and logged in (`claude` command works).

```bash
node server.js
# → open http://localhost:3400
```

That's it — no `npm install`.

## How a debate works

1. **＋ New idea** — describe your idea roughly; pick how many debate rounds (1–4).
2. 🧭 **Orchestrator kickoff** — frames the idea and assigns pointed questions to each agent.
3. **Debate round** — 💼 Entrepreneur → 📣 Marketer → 🛠️ Architect → 🔮 Visionary → ⚖️ Critic, each seeing the whole transcript and arguing with the others by name.
4. 🧭 **Synthesis** — the Orchestrator rules on disagreements and decides `CONTINUE` (another round) or `CONCLUDE`.
5. 📄 **Final Idea Brief** — problem, solution, target customer, business model, GTM, MVP scope, architecture, risks, roadmap.

While it runs you see the live chat room. Each message shows a **one-line summary** — click it to expand the agent's full argument. Click any **agent chip** to see that agent's profile and everything it has contributed.

You can also **steer** the room at any time from the composer — your message enters the transcript and the agents respond to it in their next turns. When a debate concludes, hit **↻ Refine further** to run a new cycle on the matured idea.

## Configuration

| What | How |
|---|---|
| Port | `BOX_PORT=4000 node server.js` |
| Claude binary | `BOX_CLAUDE_BIN=/path/to/claude` |
| Per-turn timeout | `BOX_TURN_TIMEOUT_MS=600000` |
| Agent personas & models | edit `lib/agents.js` (Orchestrator uses `opus`, personas use `sonnet` by default; any model alias/ID the CLI accepts works) |
| Rounds per debate | chosen per-idea in the UI |

Ideas are stored as plain JSON in `data/ideas/` — easy to back up, inspect, or delete.

## Project layout

```
server.js          HTTP server, REST API, SSE event stream (zero dependencies)
lib/agents.js      the six agent personas and their models
lib/claude.js      headless `claude -p` subprocess wrapper
lib/engine.js      the debate orchestration loop
lib/store.js       JSON persistence
public/            the dashboard UI (vanilla HTML/CSS/JS)
```
