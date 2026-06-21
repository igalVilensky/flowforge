# Codex Development Flow

FlowForge should be developed in small, controlled milestones.

Do not ask Codex or any coding agent to build the whole app at once. Each task
should include the current milestone, allowed files, constraints, and acceptance
criteria.

## Standard Prompt Shape

```text
You are working on FlowForge.

FlowForge is a safe AI automation blueprint compiler.
It turns messy process descriptions into structured, validated, human-gated
automation blueprints.

Core principle:
FlowForge does not blindly automate every request.
It finds the safest useful automation boundary.

Current milestone:
[name]

Allowed files:
[files]

Do not implement:
[out-of-scope items]

Acceptance criteria:
[checks]
```

## Required Reading For Feature Work

Before implementing a feature milestone, Codex should read:

- `docs/PROJECT_BRIEF.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/MILESTONES.md`
- `docs/DEMO_SCRIPT.md`

## Engineering Rules

Codex should:

- work one milestone at a time
- preserve the safety boundary principle
- keep changes scoped to allowed files
- prefer deterministic logic before LLM calls
- keep provider integrations isolated on the server
- keep shared contracts clear and typed
- keep API output shape stable
- preserve existing snake_case API fields
- run schema validation for compile responses
- run fixture validation with `npm run validate:fixtures`
- run typecheck with `npm run typecheck`
- update docs when a milestone changes architecture or current state
- add tests when behavior becomes real
- run available checks before finishing
- explain what changed and what remains deferred

Codex should not:

- add AI providers unless the milestone explicitly says so
- add a database before persistence is explicitly requested
- add authentication before user accounts are in scope
- add n8n import or export before the export milestone
- implement automatic real-world execution
- hide safety only in prompts
- silently change architecture
- add unnecessary dependencies

## Review Checklist

Before accepting a Codex change, check:

- Did it edit only allowed files, except framework-required fixes?
- Did the app still run?
- Did shared types compile?
- Did the API return the documented shape?
- Did it avoid real external service calls?
- Did it preserve human approval gates?
- Did it keep real-world execution blocked?
- Did docs match the current milestone?

## Milestone Handoff Template

```text
Current milestone:
[name]

Goal:
[what should be true after this milestone]

Allowed files:
[files]

Acceptance criteria:
[checks]

Out of scope:
[items]
```

## Completion Note Template

```text
Summary:
- What changed
- What was tested
- What remains intentionally deferred

Files edited:
- [files]

Next recommended milestone:
- [milestone]
```

## Core Instruction To Repeat

```text
FlowForge does not blindly automate every request.
It finds the safest useful automation boundary.
```
