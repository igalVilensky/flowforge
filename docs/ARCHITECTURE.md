# FlowForge Architecture

FlowForge is a Nuxt-only MVP that compiles a plain-language process into a **non-executing safe automation blueprint**.

It does not run automations, send messages, update accounts, issue refunds, delete records, or connect to production tools. The product is a preview compiler: it shows what a safe workflow could look like, where risks exist, what must stay draft-only, and what requires human approval.

## Core architecture decision

FlowForge uses **Nuxt server routes** instead of a separate backend service.

This keeps the MVP small while still allowing:

- API endpoints
- server-only provider keys
- deterministic scanner services
- LLM router calls
- schema validation
- safe blueprint generation
- fixture validation
- demo fallback behavior

A separate FastAPI or worker backend can be added later, but the MVP does not need it.

---

## High-level layers

```text
Frontend UI
  Nuxt app/pages/compiler.vue
  Shows input, compile modes, main result, Safety Critic, and details on demand

Nuxt Server API
  server/api/compile.post.ts
  Orchestrates one compile request and returns a validated CompileJob

Deterministic Services
  signalScanner
  riskScanner
  readinessScorer
  clarificationPlanner
  blueprintBuilder
  safetyCritic
  schemaValidator

AI Router Layer
  routerAgent
  Uses Groq/Gemini/fallback only to choose a route

Shared Contract
  shared/types
  server/schemas
  Zod validation keeps API and UI aligned
```

---

## Important safety boundary

AI is **not** allowed to generate the final blueprint.

AI may help route the request in Balanced or Full mode, but these parts stay deterministic:

- signal scan
- risk scan
- readiness score
- clarification plan
- safe blueprint generation
- Safety Critic review
- schema validation
- UI main safety state

This prevents a provider response from accidentally turning a risky workflow into an executable automation.

---

## Compile modes

```text
Demo
  No AI calls. Fully deterministic. Best for presentation and offline reliability.

Rule-only
  No AI calls. Same safety shape as Demo, useful for proving deterministic behavior.

Balanced
  Uses AI router if available, then deterministic blueprint + Safety Critic.
  Best normal development mode.

Full
  Allows the most router/provider usage, but still does not execute actions.
  Blueprint and Safety Critic remain deterministic.
```

---

## Current compile pipeline

```text
User input
  ↓
Validate request body
  ↓
Signal scanner
  ↓
Risk scanner
  ↓
Readiness scorer
  ↓
Router Agent
  - Groq primary
  - Gemini fallback
  - deterministic fallback
  ↓
Clarification planner
  ↓
Blueprint builder
  ↓
Safety Critic
  ↓
Schema validation
  ↓
CompileJob response
  ↓
Compiler UI
```

In `server/api/compile.post.ts`, the pipeline is intentionally linear and auditable.

The Safety Critic runs **after** the blueprint is built because it reviews the final proposed workflow, not only the raw input.

---

## Compile API

Endpoint:

```text
POST /api/compile
```

Request shape:

```ts
{
  input: string;
  mode?: "demo" | "rule_only" | "balanced" | "full";
}
```

Response:

```ts
CompileJob
```

The returned job includes:

- input
- pipeline steps
- signal summary
- risk summary
- readiness score
- router decision
- clarification plan
- safe automation blueprint
- Safety Critic review
- agent trace
- token/provider usage
- validation-safe structure

---

## Main services

### `signalScanner`

Detects visible workflow structure from the raw process text.

Responsibilities:

- trigger detection
- workflow primitive detection
- external action detection
- human actor detection
- system/data-source hints
- clear output detection
- missing critical information summary

Examples of primitives:

- classification
- extraction
- summarization
- routing
- drafting
- approval
- notification
- record creation
- risk detection

### `riskScanner`

Turns signal risk flags into a structured risk summary.

Responsibilities:

- low/medium/high risk level
- risk categories
- human review requirement
- safe handling notes

Examples of risk categories:

- external communication
- refund or payment
- financial
- visa or immigration
- medical
- legal
- employment
- account access
- personal data
- real-world execution
- delete or destructive action

### `readinessScorer`

Scores whether the input is detailed enough to compile safely.

Responsibilities:

- numeric readiness score
- strengths
- weaknesses
- implementation warnings

Readiness does not decide safety alone. It supports clarification and UI explanation.

### `routerAgent`

Chooses the route for the compile request.

Routes include:

- compile
- needs clarification
- suggest safer workflow
- assistant-only
- reject

Provider strategy:

```text
Groq primary
Gemini fallback
Deterministic fallback
```

The router can influence the compile path, but it cannot directly create the blueprint or override deterministic safety.

### `clarificationPlanner`

Decides whether the process needs more detail before the flow should be treated as implementation-ready.

It checks:

- missing trigger
- missing data source
- missing input data
- missing output
- missing decision rules
- missing human owner
- missing approval boundary
- missing external action boundary
- missing success criteria

For vague input, the UI should show **Need details before flow**.

For specific input, even if Groq is cautious, deterministic clarification should allow the flow to continue.

### `blueprintBuilder`

Builds the safe, non-executing workflow preview.

Responsibilities:

- workflow name
- workflow category
- workflow steps
- automation policy per step
- real-world execution policy per step
- human approval gates
- safe-to-automate list
- draft-only list
- human-approval list
- not-recommended list
- not-safe-to-automate list
- dry-run cases
- assumptions
- open questions

The builder never creates an executable automation.

### `safetyCritic`

Reviews the final blueprint after it is generated.

It is deterministic and uses no LLM call.

Possible statuses:

```text
safe_internal_preview
needs_human_approval
needs_clarification
not_safe_to_automate
```

Responsibilities:

- identify what can be automated safely
- identify draft-only steps
- identify approval-required steps
- identify blocked MVP actions
- decide the final main safety status
- produce findings and next safe action

Safety Critic rules:

- clean internal workflows can be safe previews
- external replies require human approval
- refunds/payments require human approval, not blanket blocking
- medical, visa/immigration, account access, legal, and destructive actions are not safe to automate
- router false positives must not override deterministic Safety Critic status

### `schemaValidator`

Validates the final `CompileJob` before returning it to the frontend.

If validation fails, the API should return a server error rather than rendering unsafe or malformed UI data.

---

## Safety Critic status meanings

### `safe_internal_preview`

The workflow is safe to preview internally.

Typical example:

```text
Every morning, collect job application emails, extract fields,
classify priority, and create an internal review task.
```

Expected UI:

```text
Safe internal flow
Safe internal preview
low risk
0 gates
```

### `needs_human_approval`

The workflow can be previewed, but one or more actions must stay gated or draft-only.

Typical examples:

- draft a support reply before a human sends it
- prepare a refund case for finance review
- route sensitive cases to a team lead

Expected UI:

```text
Flow needs human gates
Needs human approval
medium risk
1+ gates
```

### `needs_clarification`

The input is too vague or missing important process structure.

Typical example:

```text
Automate my customer messages.
```

Expected UI:

```text
Need details before flow
Needs clarification
```

### `not_safe_to_automate`

The request asks for something the MVP must not automate.

Typical examples:

- medical diagnosis or advice
- visa eligibility decisions
- legal decisions
- account access changes
- deleting records
- cancelling subscriptions
- sending high-stakes answers automatically

Expected UI:

```text
Do not automate
Not safe to automate
high risk
blocker
```

---

## Frontend architecture

Main page:

```text
app/pages/compiler.vue
```

Responsibilities:

- process input
- compile mode selection
- suggested use cases
- loading state
- main result panel
- Safety Critic panel
- flow preview
- clarification view
- safe alternative view
- details on demand

The UI should make one thing primary:

```text
safe flow
human-gated flow
missing details
do not automate
```

Details should remain hidden until the user asks for them.

Detail sections:

- Critic
- Workflow
- Risks
- Dry runs
- Router
- Before build
- Trace

Main state should be driven by `safety_critic.overall_status`, not directly by router output.

---

## Agent trace

The API returns an agent trace for transparency.

Important trace events:

- initialize compile job
- router provider attempts
- router decision selected
- clarification planner
- blueprint builder
- safety critic
- schema validation

The trace is not the main UI; it belongs in details.

---

## Validation commands

Use these before considering a milestone complete:

```bash
npm run validate:fixtures
npm run typecheck
```

Expected:

- fixture matches Zod schema
- app types compile
- no stale schema/type mismatch
- Safety Critic is included in the validated compile job

---

## Demo reliability

The final demo should not depend on provider availability.

Demo mode should work with:

```text
0 LLM calls
deterministic route
deterministic blueprint
deterministic Safety Critic
```

Balanced and Full mode can show Groq/Gemini routing when configured, but safety outcomes must remain consistent with deterministic logic.

---

## Known architecture limits

Current MVP does not include:

- database persistence
- user accounts
- auth
- n8n export execution
- real automation execution
- real email sending
- real account updates
- real refund/payment actions
- production tool connectors
- streaming backend jobs

These are intentionally out of scope.

---

## Future architecture direction

Possible later upgrades:

- persisted compile jobs
- team workspaces
- saved templates
- real provider abstraction service
- automated test fixtures for safety scenarios
- n8n export as a static, non-executing draft
- explicit connector policy layer
- richer risk-specific Safety Critic recommendations
- evaluation suite for router/provider drift