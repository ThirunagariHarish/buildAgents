---
name: cortex
description: Run the Cortex Reviewer agent for a high-signal review of code changes.
argument-hint: "[diff-pr-or-change-summary]"
disable-model-invocation: true
context: fork
agent: cortex-reviewer
---

Run the **cortex-reviewer** agent on this review target:

$ARGUMENTS

Return only issues that materially affect correctness, security, regressions, or maintainability.
