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

## From brief to project

When a brief is ready, **Promote to project**. The planning crew starts at once, each writing one project document that you can read in the app:

1. 📋 **Project Manager** — requirements, user stories, milestones, task list, risks.
2. 🏗️ **Lead Architect** — stack, components, API, deployment shape (follows the house standards in `lib/platform-context.md`).
3. 🗄️ **Database Architect** — entities, schema, key queries, migrations.
4. 🎨 **UX Designer** — researches comparable products on the web, sets the design direction for *this* product, and writes a clickable `prototype.html` you can try on your phone.

The project then waits in **Needs you** as *Plan ready — approve it*. Reply with changes and the Project Manager routes your feedback to the documents it affects, which get revised; or **Approve plan** to hand it to the build crew.

## The build crew

After approval the build crew works in the project's own git repository (`data/work/<name>/repo`), as the unprivileged `boxbuild` user on the server, with a shell limited to build commands:

1. 🧭 **Tech Lead** (opus) — writes the build plan and an ordered task list; later turns your feedback into tasks.
2. 🧑‍💻 **Frontend Developer** / ⚙️ **Backend Developer** — take tasks one at a time; Box commits after each. The task board in the app shows progress live.
3. 🧪 **QA Tester** — runs build, lint and tests, walks every user story, and files bugs. 🎨 The **UX Designer** reviews the UI against the design direction. Open issues become fix tasks (up to three cycles).
4. 🚀 **DevOps** — Dockerfile, a GHCR image workflow and Kubernetes manifests. Box then creates the private GitHub repo, pushes, waits for the image, applies the manifests to the k3s cluster and waits for `https://<name>.cashflowus.com` to answer.

You get the project back as *Site ready — review it*. Reply with what should change (fix → test → redeploy), or **Mark complete** to move it to maintenance, where any later note becomes a fix or a feature.

Deploying needs two more repository secrets for Box's own deploy workflow: `BOX_GITHUB_TOKEN` (create private repos, read Actions) and `BOX_KUBECONFIG` (the cluster kubeconfig, raw or base64). Without them projects are built and tested, and wait in *Built — deploy needs setup* until you add them and redeploy Box.

## More around the room and the crew

- **Idea templates** (SaaS, consumer, marketplace, internal tool, content, hardware, AI, community) steer the roster and agenda; the Customer Voice speaks as three named personas; the Scout always files a competitor matrix.
- **Room score**: after every brief each agent scores it 1–10 with a reason. **Devil's advocate round**, **quick questions** to the room or one agent, **fork** an idea, **brief versions** with a line diff.
- **From the brief**: pitch deck, one-pager, elevator pitches, landing-page copy, pre-mortem, and a domain/handle **name check**.
- **Agents**: a marketplace of ready-made specialists, clone-and-edit any built-in, edit your own, temperament settings, and how often the chair cited each one.
- **Build crew**: a Code Reviewer (correctness + security) runs before QA; QA checks accessibility; the task board lets you edit, reorder, delete, add, redo with a note, and pause before a task; live activity shows each file edit and command; crew time per task; browse the repository in the app; "what changed" on every revised document; comment on the prototype.
- **Operate**: uptime checks every five minutes with a push when a site goes down or recovers, a weekly digest, a projects board, search across everything, tags and archive, a source library, export everything as a zip, a monthly agent-time cap, and offline reading of what you opened last.

## Accounts and security

Box has one administrator and any number of members. Members **request access** (first name, last name, contact number, email); the administrator approves them under Settings → People, which emails a one-time **set-password link** (24 h). "Forgot password" works the same way. Members get every feature on their own ideas and projects; only the administrator sees everyone's work and manages people. The administrator's email is set by `BOX_ADMIN_EMAIL`; its initial password by `BOX_ADMIN_PASSWORD` (change it from Settings after the first sign-in).

Email goes out over SMTPS with no dependencies: set `BOX_SMTP_HOST`, `BOX_SMTP_PORT` (465), `BOX_SMTP_USER`, `BOX_SMTP_PASS` and optionally `BOX_MAIL_FROM` (Gmail works with an App Password). Without them, approval links are shown to the administrator in the app to send by hand.

What keeps it safe:

- Passwords are scrypt-hashed with a per-user salt; sessions are random 32-byte tokens stored only as hashes, in `HttpOnly; SameSite=Strict; Secure` cookies, 30-day sliding expiry.
- Sign-in, sign-up and reset are rate-limited per IP and per account, with a temporary lockout after repeated failures, and the same reply whether or not an email exists.
- Every response carries a strict Content-Security-Policy (scripts only from Box, no inline scripts, no framing), `nosniff`, no-referrer and HSTS. State-changing requests from another origin are refused.
- Agent-written HTML (prototypes) is served in a sandboxed, opaque origin, so it can never read Box's cookies or call its API.
- Ideas, documents, notifications and the live event stream are scoped to their owner; members never see each other's work.
- Build-crew agents run as the unprivileged `boxbuild` user with a shell limited to build commands and no access to Box's data, the password file or the server; the key file and `/etc/box.env` are root-only, mode 600.
- Secrets live only in GitHub Actions secrets and `/etc/box.env`; nothing is in the repository. Box never exposes a terminal, shell or card data to the browser.

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
lib/crew.js        the planning and build crew personas
lib/project.js     the project engine: planning, build/test loop, deploy, review, maintenance
lib/builder.js     the build sandbox: repo per project, unprivileged build user, allowed tools
lib/deploy.js      GitHub repo + image build, kubectl rollout, site check
lib/platform-context.md  house standards the crew follows (snapshot of the dev-platform registry)
lib/store.js       JSON persistence
public/            the dashboard UI (vanilla HTML/CSS/JS)
```
