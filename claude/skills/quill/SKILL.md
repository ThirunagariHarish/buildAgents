---
name: quill
description: Run the Quill QA agent to validate behavior against acceptance criteria and regression risk.
argument-hint: "[feature-or-acceptance-criteria]"
disable-model-invocation: true
context: fork
agent: quill
---

Run the **quill** agent on this QA target:

$ARGUMENTS

Validate the expected behavior, cover the highest-risk regressions first, and file structured bug reports for confirmed failures.
