# House standards (from the dev-platform registry, snapshot 2026-09-28)

Follow these without asking. Deviate only with a stated reason in the architecture doc.

## Stacks — pick by project type
- **Web dashboard / SPA**: React 18 + Vite + TypeScript (strict), Tailwind, shadcn-style components (Radix primitives + CVA + clsx + tailwind-merge), lucide-react icons, TanStack Query for server state, zustand for client state, recharts for charts. Package manager pnpm.
- **Full-stack web app** (accounts, data, server logic): Next.js App Router (Next 16 / React 19 / Tailwind 4), Better Auth for sign-in, Drizzle ORM + Postgres (pgvector when AI search is needed), zod at every boundary.
- **Mobile**: Tier 1 is an installable PWA (manifest + icons, "Add to Home Screen") — the default for personal apps, ships with the web deploy. Tier 2 Capacitor wrap when push notifications or native APIs are required. Tier 3 Expo + EAS for full React Native.
- **Bot / agent / background service**: Python 3.11–3.13, FastAPI + uvicorn for any HTTP surface, redis for queues/state, uv for dependencies, Docker image on python:3.X-slim.
- **AI features**: off by default. Products are built to work without any AI provider account: rules, templates, search and user input instead of model calls. Only when the requirements explicitly say "Needs an AI provider key from the owner" does a product use the Claude API (official Anthropic SDK, ANTHROPIC_API_KEY from Box's shared keys, claude-sonnet-5-5 default), isolated behind one module with a no-key fallback. Never a Claude subscription or Claude Code login inside a product.

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
