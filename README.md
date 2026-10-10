# Pocket Box

Describe a personal agent in plain words. A room of experts debates it into a brief, a crew of Claude Code agents builds and tests it, the Studio signs it, and the agent runs **on your phone** — not on a server.

Live at **https://agents.cashflowus.com** (Studio) and **https://agents.cashflowus.com/runtime** (the phone Runtime).

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Studio | `server.js`, `lib/`, `public/index.html` + `app.js` | Accounts, the idea room, the build crew, signing, settings, runs |
| Agent kit | `lib/kit/` | The contract (`CONTRACT.md`), validator and eval runner shared by the crew, the release gate and the phone |
| Runtime | `public/runtime.html` + `runtime.js` + `agent-worker.js` | Pairs a phone, verifies Ed25519 signatures, runs agents in a network-less worker, shadow/live modes |
| Deploy | `.github/workflows/deploy.yml`, `deploy/` | Push to `pocketbox` → self-test → VPS (systemd `pocketbox`, port 3401) → k3s Traefik route + TLS |

Stages: **room → brief → plan → build → shadow → live**. An agent's first release always starts in shadow mode: it runs on its real triggers but only records what it would have said, until you tap **Go live**.

## Safety model

- Agents can only act through `ctx`; every call needs a permission declared in `agent.json`, counts against a step budget, and is checked twice (in the worker and again by the Runtime page).
- The agent worker is served with `connect-src 'none'`, and before an agent's code runs, the worker removes `fetch`, sockets, `importScripts`, string timers and every Function constructor.
- Web reads go through the Studio, limited to the hosts in `http.allow`, with private addresses blocked.
- Hand-offs to Claude Code are for the owner's own agents only, capped per day (`PB_HANDOFF_DAILY_CAP`).
- The crew builds as the unprivileged `boxbuild` user inside bubblewrap, with Pocket Box's and Box's data hidden.
- The Claude login stays on the server and is never put into a package.

## Run locally

```
PB_PORT=3501 PB_NO_BUILD_USER=1 node server.js
node deploy/selftest.js
```
