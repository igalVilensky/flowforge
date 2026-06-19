# FlowForge Requirements

## Product Goal

FlowForge must help users convert messy process descriptions into safe,
structured automation blueprints.

The product must not blindly generate automations. It must identify the safest
useful automation boundary, explain risks, require human approval where needed,
and produce implementation-friendly outputs.

## Milestone 0 Requirements

Milestone 0 must provide:

- a clear README
- complete project docs in `docs/`
- shared TypeScript types for workflow blueprints, compile jobs, and agent traces
- a simple landing page at `/`
- a simple compiler preview page at `/compiler`
- a placeholder `POST /api/compile` endpoint
- no real AI provider calls
- no database
- no authentication
- no n8n import or export
- no real-world workflow execution

The compile endpoint must accept:

- `input`
- `mode`

It must validate that `input` exists and return a placeholder compile job.

## MVP Requirements

Future MVP milestones should include:

- process input
- demo presets
- visible pipeline timeline
- central workflow state
- compiler agent trace
- signal scanner tool
- risk scanner tool
- router decision
- workflow architect tool
- schema validator tool
- safety critic or deterministic safety rules
- automation boundary output
- human approval gates
- final blueprint UI
- token budget display
- export prompt

## Useful But Secondary

- dry-run test cases
- n8n-style outline
- rule-only fallback mode
- automation readiness score
- blueprint repair loop

## Future Scope

- direct n8n import and export
- real Gmail, Slack, Notion, CRM, or ticketing integrations
- authentication
- saved workflow history
- database-backed storage
- multi-user workspaces
- collaboration
- production deployment
- billing or usage tracking

## Non-Goals For MVP

The MVP should not include:

- production automation execution
- direct external actions
- real email sending
- destructive actions
- automatic refunds, approvals, account updates, or payment handling
- authentication
- billing
- complex database design
- production data storage

## Safety Requirements

FlowForge must clearly separate:

- Safe to automate
- Needs human approval
- Not recommended
- Not safe to automate

High-risk or sensitive categories include:

- external communication
- personal data
- financial topics
- legal topics
- medical topics
- visa or immigration topics
- employment decisions
- refunds or payments
- complaints or angry users
- delete or destructive actions
- account access
- high-stakes decisions
- real-world execution

The system should never recommend fully automatic execution for high-risk
external actions.

## Rule-Based Tool Requirements

Deterministic tools should run before LLM calls wherever possible.

Future deterministic tools should include:

- signal scanner
- risk scanner
- primitive detector
- readiness score calculator
- token estimator
- schema validator
- approval gate generator
- export builder

Rule-based tools must not call LLM providers.

## Router Requirements

The future router should decide what kind of response the input deserves.

Possible routes:

- `compile_full_blueprint`
- `compile_light_blueprint`
- `ask_clarifying_questions`
- `suggest_safer_workflow`
- `assistant_mode`
- `reject_disallowed`

The router should not build the workflow. It should only decide the processing
route and required next tools.

## Blueprint Requirements

A safe automation blueprint should define:

- workflow name
- summary
- automation boundary
- trigger
- inputs
- steps
- workflow primitives
- actors
- outputs
- risk levels
- safe-to-automate list
- human approval list
- not-recommended list
- not-safe-to-automate list
- approval gates
- assumptions
- open questions

## Acceptance Standard

The project is healthy when:

- local install succeeds
- the Nuxt dev server starts
- `/` renders
- `/compiler` renders
- `/api/compile` validates input and returns a typed placeholder job
- shared types compile
- docs clearly describe the intended product and development flow
