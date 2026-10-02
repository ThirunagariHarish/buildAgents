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

1. **New idea** — type (or dictate) a rough idea, optionally attach photos, PDFs or text files with **+**, and send. Box names it automatically.
2. 🧭 **Orchestrator kickoff** — frames the idea and assigns pointed questions to every agent in the room.
3. **Debate round** — 💼 Entrepreneur → 📣 Marketer → 🛠️ Architect → 🔮 Visionary → ⚖️ Critic, plus any agents you added, each seeing the whole transcript and every attachment, and arguing with the others by name.
4. 🧭 **Synthesis** — the Orchestrator rules on disagreements and decides `CONTINUE` (another round) or `CONCLUDE`.
5. 📄 **Idea Brief** — problem, solution, target customer, business model, GTM, MVP scope, architecture, risks, roadmap.

The interface follows the Claude mobile app: a slide-out sidebar of recent ideas, a centered thread with a "brewing" indicator while an agent thinks, a composer with **+** (camera, photos, files, rounds, agents), dictation, and send/stop. Reply at any time — your message goes into the transcript and the room picks it up (a finished debate starts a new round). **⋯** has Share, Rename, Room & agents, the Idea Brief, pause/resume, and Delete. **Agents** lets you add your own agents with instructions; they join every debate.

## Configuration

| What | How |
|---|---|
| Port | `BOX_PORT=4000 node server.js` |
| Password-protect the UI | `BOX_PASSWORD=secret node server.js` (HTTP Basic auth — set this if Box is reachable from the internet) |
| Claude binary | `BOX_CLAUDE_BIN=/path/to/claude` |
| Per-turn timeout | `BOX_TURN_TIMEOUT_MS=600000` |
| Agent personas & models | edit `lib/agents.js` (Orchestrator uses `opus`, personas use `sonnet` by default; any model alias/ID the CLI accepts works) |
| Rounds per debate | chosen per-idea in the UI |

Ideas are stored as plain JSON in `data/ideas/` — easy to back up, inspect, or delete.

## Deploying to a VPS

One-time on the server (Ubuntu/Debian):

```bash
git clone https://github.com/ThirunagariHarish/box.git /opt/box && cd /opt/box
claude setup-token        # authorize with your Claude (Max) account
bash deploy/setup-vps.sh  # installs Node + Claude CLI, systemd service, auto-start
```

Continuous deployment: `.github/workflows/deploy.yml` redeploys on every push to
`main` over SSH. Repo secrets it uses: `VPS_HOST`, `VPS_USER`, `VPS_PASSWORD`
(or switch to `VPS_SSH_KEY`), and optionally `BOX_PASSWORD` to set the app's
login password (written to `/etc/box.env`).

## Project layout

```
server.js          HTTP server, REST API, SSE event stream (zero dependencies)
lib/agents.js      the six agent personas and their models
lib/claude.js      headless `claude -p` subprocess wrapper
lib/engine.js      the debate orchestration loop
lib/store.js       JSON persistence
public/            the dashboard UI (vanilla HTML/CSS/JS)
```
