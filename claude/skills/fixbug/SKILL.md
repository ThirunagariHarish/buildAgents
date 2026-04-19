---
name: fixbug
description: Diagnose a bug, choose the strongest fix path, then route implementation, review, QA, and release readiness.
argument-hint: "[bug-report]"
disable-model-invocation: true
allowed-tools: Agent Read Grep Glob Bash Write Edit MultiEdit
---

Treat `$ARGUMENTS` as the bug report.

Run this workflow in the **main session**. Do not fork into the `fixbug` subagent if you need downstream delegations.

## Workflow

1. Restate the symptom, expected behavior, impact, and any reproduction steps already known.
2. Generate 2-3 plausible root-cause hypotheses before code changes begin.
3. If the issue reveals a requirements gap, invoke **nova** to tighten acceptance criteria.
4. Invoke **devin** to investigate and implement the best fix.
5. Invoke **cortex-reviewer** to review the fix for correctness and regression risk.
6. Invoke **quill** to verify the bug is fixed and related flows still work.
7. Invoke **helix** for the release handoff.

If review or QA fails, route the issue back through **devin** and repeat the necessary stages until the change is ready or blocked.
