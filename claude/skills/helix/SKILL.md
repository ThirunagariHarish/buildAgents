---
name: helix
description: Run the Helix release manager agent for release readiness, versioning, and rollout handoff.
argument-hint: "[release-context]"
disable-model-invocation: true
context: fork
agent: helix
---

Run the **helix** agent on this release context:

$ARGUMENTS

Summarize what is shipping, what still blocks release, and any rollout or rollback concerns.
