---
name: feature
description: Discover realistic feature options, help choose one, and route the selected feature through the workflow.
argument-hint: "[product-or-codebase-context]"
disable-model-invocation: true
allowed-tools: Agent Read Grep Glob Bash Write Edit MultiEdit
---

Treat `$ARGUMENTS` as the starting context for feature discovery.

Run this skill in the **main session** so you can delegate to specialist agents as needed.

## Workflow

1. Inspect the repository and current product context enough to suggest plausible features.
2. Produce a short prioritized list of candidate features with user value, rough scope, and likely risk.
3. Ask the user to choose one feature when a choice is required.
4. After a feature is selected, run the delivery chain:
   - **nova** for PRD and acceptance criteria
   - **atlas-architect** for architecture and phased plan
   - **devin** for implementation
   - **cortex-reviewer** for code review
   - **quill** for QA
   - **helix** for release handoff

Prefer strong recommendations over broad brainstorming. Avoid suggesting features that clearly do not fit the codebase or product direction.
