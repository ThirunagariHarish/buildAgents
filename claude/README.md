# Portable Claude workflow bundle

This folder is a portable export of a Claude Code workflow bundle. It includes:

- `agents/`: reusable subagent definitions written as Claude Code markdown agents
- `skills/`: slash-invocable skills that either fork into a specialist agent or orchestrate the full workflow from the main session

## How Claude picks these up

Claude Code discovers this bundle from standard `.claude/` locations:

- **project-local**: `<repo>/.claude/agents/` and `<repo>/.claude/skills/`
- **user-global**: `~/.claude/agents/` and `~/.claude/skills/`

Once copied into one of those locations:

- each directory under `.claude/skills/` becomes a slash command
- `skills/<name>/SKILL.md` becomes `/name`
- each file in `.claude/agents/*.md` becomes a named subagent Claude can delegate to
- skills can explicitly fork into a subagent with frontmatter such as `context: fork` and `agent: nova`

This means other Claude Code installations will reflect these commands as soon as the bundle is copied into their `.claude/` folder and the session sees the new directories.

## Install into a target project

Copy the contents of this folder into the target repository's `.claude/` directory:

```text
target-repo/
  .claude/
    agents/
    skills/
```

For example:

```bash
mkdir -p .claude
cp -R claude/agents .claude/
cp -R claude/skills .claude/
```

If the target repo did not already have a `.claude/skills/` directory when Claude Code started, restart Claude Code once after copying.

## Install for all repositories on one machine

If you want these commands available in every repository for one user, copy them into the user-level Claude directory instead:

```bash
mkdir -p ~/.claude
cp -R claude/agents ~/.claude/
cp -R claude/skills ~/.claude/
```

That makes `/build`, `/feature`, `/fixbug`, and the specialist commands available across projects on that machine.

## Quick verification

After copying:

1. Run `claude agents` to confirm the agents are visible.
2. Start Claude Code in the target repository.
3. Type `/` and confirm the new skills appear in autocomplete.
4. Try `/nova draft a PRD for ...` or `/build implement ...` to verify invocation works.

If the commands do not appear:

1. Confirm the files are under `.claude/skills/<skill-name>/SKILL.md`.
2. Confirm the agent files are under `.claude/agents/*.md`.
3. Restart Claude Code if the top-level `.claude/skills/` directory was created after the session started.
4. Check that the folder names match the command names you expect, for example `skills/build/SKILL.md` -> `/build`.

## Included slash commands

| Command | Purpose |
| --- | --- |
| `/build [request]` | End-to-end delivery workflow using Nova -> Atlas -> Devin -> Cortex -> Quill -> Helix |
| `/feature [goal]` | Feature discovery and implementation workflow |
| `/fixbug [bug-report]` | Bug triage, diagnosis, fix, review, QA, and release workflow |
| `/nova [brief]` | Product management and PRD drafting |
| `/atlas-architect [brief]` | Architecture, contracts, and phased technical plan |
| `/atlas [brief]` | Alias for `/atlas-architect` |
| `/devin [phase-or-task]` | Implementation and unit-level validation |
| `/cortex [diff-or-pr]` | High-signal code review |
| `/quill [feature-or-criteria]` | QA execution and bug reporting |
| `/quil [feature-or-criteria]` | Alias for `/quill` |
| `/helix [release-context]` | Release readiness, versioning, and rollout handoff |

## Important Claude Code constraint

Claude Code subagents cannot spawn other subagents. Because of that:

- the specialist roles in `agents/` are standard subagents
- the orchestration slash commands (`/build`, `/feature`, `/fixbug`) are implemented as skills that run in the main session and explicitly tell Claude to delegate to the specialist subagents
- the orchestration agent files (`build.md`, `feature.md`, `fixbug.md`) are still included as reusable prompts for `claude --agent ...` or manual adaptation, but they should not be invoked as forked subagents when you expect them to spawn more agents

## How to customize the bundle

The two main places to customize behavior are:

| Location | What to change |
| --- | --- |
| `agents/*.md` | Role instructions, model, tool access, max turns, and specialization |
| `skills/*/SKILL.md` | Slash command name, argument hint, whether it is user-invocable, and whether it runs inline or forks to a subagent |

Useful patterns:

- change the **folder name** under `skills/` to change the slash command name
- edit `description` so Claude knows when to auto-apply a skill
- keep `disable-model-invocation: true` for commands you only want invoked manually
- use `context: fork` plus `agent: <name>` for specialist commands like `/nova`
- keep orchestration commands like `/build` inline so they can delegate to multiple specialist agents

## Recommended import flow

For teams sharing this in git:

1. Commit this bundle into a repository as `claude/` or directly as `.claude/`.
2. In the target repo, copy or rename it into `.claude/`.
3. Start Claude Code from that repository root.
4. Use the exported slash commands normally.

If you keep this bundle as `claude/` in a separate repo, treat it as a source bundle and copy it into `.claude/` wherever you want the commands to become active.

## File layout

```text
claude/
  agents/
    atlas-architect.md
    build.md
    cortex-reviewer.md
    devin.md
    feature.md
    fixbug.md
    helix.md
    nova.md
    quill.md
  skills/
    atlas/
      SKILL.md
    atlas-architect/
      SKILL.md
    build/
      SKILL.md
    cortex/
      SKILL.md
    devin/
      SKILL.md
    feature/
      SKILL.md
    fixbug/
      SKILL.md
    helix/
      SKILL.md
    nova/
      SKILL.md
    quil/
      SKILL.md
    quill/
      SKILL.md
```
