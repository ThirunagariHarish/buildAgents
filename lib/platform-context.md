# House standards (from the dev-platform registry, snapshot 2026-09-28)

Follow these without asking. Deviate only with a stated reason in the architecture doc.

## Stacks — pick by project type
- **Web dashboard / SPA**: React 18 + Vite + TypeScript (strict), Tailwind, shadcn-style components (Radix primitives + CVA + clsx + tailwind-merge), lucide-react icons, TanStack Query for server state, zustand for client state, recharts for charts. Package manager pnpm.
- **Full-stack web app** (accounts, data, server logic): Next.js App Router (Next 16 / React 19 / Tailwind 4), Better Auth for sign-in, Drizzle ORM + Postgres (pgvector when AI search is needed), zod at every boundary.
- **Mobile**: Tier 1 is an installable PWA (manifest + icons, "Add to Home Screen") — the default for personal apps, ships with the web deploy. Tier 2 Capacitor wrap when push notifications or native APIs are required. Tier 3 Expo + EAS for full React Native.
- **Bot / agent / background service**: Python 3.11–3.13, FastAPI + uvicorn for any HTTP surface, redis for queues/state, uv for dependencies, Docker image on python:3.X-slim.
- **AI features**: off by default. Products are built to work without any AI provider account: rules, templates, search and user input instead of model calls. When the owner asks for AI, the default route is **the owner's Claude plan**: the app runs the Claude Code CLI (`claude -p --output-format json --model haiku`, prompt on stdin, installed in the image) signed in with `CLAUDE_CODE_OAUTH_TOKEN`, which Box fills from its own login when the owner switches on "Use my Claude plan" (never a value the owner types, never logged, stripped from child processes that do not need it). Cheapest model first: `haiku` for extraction, classification and drafting; `sonnet` only for the one step that needs real reasoning; never `opus` inside a product. Keep prompts compact (window long inputs, send only what the step needs), run one call at a time, treat usage-limit errors as "wait and retry later" rather than failures, and give every AI step a deterministic fallback or a clear "waiting for AI" state. Use the Claude API with `ANTHROPIC_API_KEY` (official Anthropic SDK, `claude-haiku-5-5` default) only when the owner explicitly asks for an API key. List `CLAUDE_CODE_OAUTH_TOKEN` in ENV_JSON with null; never list an AI key the requirements do not call for.
- **Third-party keys** (Google, Dropbox, email, transcription and the like) for a product the owner runs: prefer an in-app Settings page that stores them encrypted after sign-in over deploy-time variables, so the site deploys and starts without them and each feature says which key it is waiting for. Only infrastructure (database, auth secrets, the site's address, the owner's first login) is deploy configuration.

## UI conventions (the house look)
shadcn-style components, dark-first, card/grid layouts, sonner toasts, lucide icons, TanStack Query for all server state, zod everywhere data crosses a boundary. Mobile-first: every user-facing app must work well on a phone and be installable (PWA).

## Code conventions
TypeScript strict; Python typed (pydantic v2). ESLint 9 + Prettier (JS), ruff (Python). Config via environment variables; every repo has `.env.example` with key names only; structured logs to stdout. Every repo gets a `CLAUDE.md` (what it is, how to run, how it deploys).

## Data
Per-app Postgres in the cluster for relational data; Redis for queues and caches; SQLite only for single-user tools. Migrations checked into the repo (Drizzle migrations or Alembic).

## How things ship
Private GitHub repo `ThirunagariHarish/<name>` → GitHub Actions builds a Docker image to `ghcr.io/thirunagariharish/<name>` → deployed to the k3s cluster (traefik ingress + cert-manager TLS) at `https://<name>.cashflowus.com`. Secrets live in Doppler and are synced into the cluster; never in the repo. Anything with Postgres takes a backup before an upgrade. Rollback is `kubectl rollout undo`.

## Non-negotiables
- Secrets never in code, docs or chat.
- CI must pass before a deploy.
- Trading systems: paper mode first, market-hours deploy guard.
