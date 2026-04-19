---
name: build
description: Run the end-to-end Build workflow for a requested feature, bug fix, refactor, or delivery task.
argument-hint: "[request]"
disable-model-invocation: true
allowed-tools: Agent Read Grep Glob Bash Write Edit MultiEdit
---

Use this skill to execute an end-to-end delivery workflow for:

- new features
- bug fixes that still need structured review and QA
- refactors
- release-sized engineering tasks

Treat `$ARGUMENTS` as the working brief.

Important: keep orchestration in the **main session**. Claude Code subagents cannot spawn other subagents, so do **not** fork into the `build` agent for this workflow. Instead, drive the sequence from the current session and delegate to the specialist agents directly.

## Required workflow

1. Clarify the request only if a missing answer materially changes behavior or scope.
2. Invoke **nova** to produce a crisp product brief with acceptance criteria.
3. Invoke **atlas-architect** to produce a technical design and phased plan.
4. Invoke **devin** to implement the current phase or the full task if one phase is enough.
5. Invoke **cortex-reviewer** to review the resulting changes.
6. If review finds issues, route the relevant fixes back through **devin** and then re-run **cortex-reviewer**.
7. Invoke **quill** to validate the change against the acceptance criteria.
8. If QA finds issues, route the relevant fixes back through **devin**, then repeat review and QA as needed.
9. Invoke **helix** for a release-readiness handoff.

## Output expectations

- Keep each specialist in its lane.
- Preserve and pass forward the important output from each stage.
- End with a concise final summary that includes what was delivered, unresolved blockers if any, and the next concrete action.
