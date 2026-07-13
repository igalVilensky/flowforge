# FlowForge Architecture

FlowForge is a Nuxt-only MVP that compiles a plain-language process into a **non-executing safe automation blueprint**.

It does not run automations, send messages, update accounts, issue refunds, delete records, or connect to production tools. The product is a preview compiler: it shows what a safe workflow could look like, where risks exist, what must stay draft-only, and what requires human approval.

## Core architecture decision

FlowForge uses **Nuxt server routes** instead of a separate backend service.

This keeps the MVP small while still allowing:

- API endpoints
- server-only provider keys
- deterministic scanner services
- LLM-assisted agents
- schema validation
- safe blueprint generation
- fixture validation
- demo fallback behavior

A separate FastAPI or worker backend can be added later, but the MVP does not need it.

---

## High-level layers

```text
Frontend UI
  app/pages/compiler.vue
  Guides the user from input → clarification → workflow/blocked result

Nuxt Server API
  server/api/clarify.post.ts
  Runs one guided clarification turn

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

AI Agent Layer
  clarificationConversationAgent
  routerAgent
  clarificationAgent
  blueprintArchitectAgent
  safetyCriticAgent

Shared Contract
  shared/types
  server/schemas
  StructuredWorkflowIntent is the canonical downstream intent
  Zod validation keeps API and UI aligned
```

---

## Important safety boundary

FlowForge may use AI to reason, route, clarify, propose, and critique, but AI does not execute anything.

The MVP safety rules are:

- no real email or message sending
- no account updates
- no refunds or payments
- no deletion or cancellation
- no production connectors
- no high-stakes automatic decisions
- no n8n workflow execution

Deterministic checks still enforce final safety boundaries before a compile job is returned.

---

## Guided clarification architecture

M12 adds a new guided clarification path before compile.

Endpoint:

```text
POST /api/clarify
```

Purpose:

```text
messy input
  ↓
Clarification Conversation Agent
  ↓
canonical StructuredWorkflowIntent + one next question
  ↓
user answer
  ↓
repeat until ready
  ↓
versioned StructuredCompileRequest
  ↓
POST /api/compile
```

The clarification conversation is represented by:

```text
shared/types/clarificationSession.ts
server/schemas/clarificationSession.schema.ts
```

The agent implementation is:

```text
server/prompts/clarificationConversationPrompt.ts
server/services/clarificationConversationAgent.ts
server/api/clarify.post.ts
```

The Clarification Conversation Agent must:

- ask one question at a time
- ask contextual questions based on the user’s actual input
- avoid generic missing-field questions when the input is messy but understandable
- use previous answers
- map stable question IDs/kinds into the canonical intent
- keep input sources, output destinations, desired outputs, notification targets, owners, and approval boundaries distinct
- stop once canonical readiness confirms the required user-provided facts
- return `ready_to_compile=true` and `rewritten_compile_prompt`
- avoid endless clarification loops
- fall back deterministically when providers fail

Hard stop behavior:

- a small maximum question count prevents infinite questioning
- repeated-question detection selects the next genuinely missing field or stops without inventing values
- the maximum question guard does not force compilation when required facts remain missing
- `assessStructuredWorkflowIntentReadiness` is the single clarification-readiness decision

---

## Compile modes

```text
Demo
  No AI calls. Fully deterministic. Best for presentation and offline reliability.

Rule-only
  No AI calls. Same safety shape as Demo, useful for proving deterministic behavior.

Balanced
  Uses AI where allowed, then keeps deterministic safety validation.

Full
  Allows the most provider usage, but still does not execute actions.
```

The guided clarification endpoint can use providers when configured. It also has deterministic fallback behavior.

---

## Compile pipeline

```text
User input or versioned StructuredCompileRequest
  ↓
Normalize once to StructuredWorkflowIntent
  - canonical guided input
  - legacy envelope adapter
  - plain-text compatibility adapter
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
Clarification Agent
  - OpenAI primary (`gpt-5-nano` default)
  - Groq fallback
  - Gemini fallback
  - deterministic fallback
  ↓
Blueprint Architect Agent or skipped clarification-safe fallback
  - consumes StructuredWorkflowIntent directly
  - receives safety constraints separately
  - same OpenAI → Groq → Gemini → deterministic order
  ↓
Safety Critic Agent or skipped clarification-safe fallback
  ↓
Deterministic Safety Critic / Safety Guard
  ↓
Schema validation
  ↓
CompileJob response
  ↓
Focused compiler UI
```

The compile endpoint remains auditable and schema-validated.

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

## Clarification API

Endpoint:

```text
POST /api/clarify
```

Request shape:

```ts
{
  original_input: string;
  answers?: Array<{
    question_id: string;
    question: string;
    answer: string;
  }>;
}
```

Response shape:

```ts
ClarificationSessionResponse
```

A session contains:

- original input
- canonical `StructuredWorkflowIntent`
- collected answers
- current summary
- one next question, or
- `ready_to_compile=true`
- rewritten compile prompt

---

## Main services

### `clarificationConversationAgent`

Runs the new guided clarification session.

Responsibilities:

- infer known facts from messy input and previous answers
- call Groq/Gemini when configured
- validate structured JSON
- ask one contextual question at a time
- avoid repeated questions
- stop at the question limit
- return `rewritten_compile_prompt` when ready
- provide deterministic fallback

This is different from `clarificationPlanner`. The planner detects deterministic missing-field state inside `/api/compile`; the conversation agent guides the user before compile.

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

### `riskScanner`

Turns signal risk flags into a structured risk summary.

Responsibilities:

- low/medium/high risk level
- risk categories
- human review requirement
- safe handling notes

### `readinessScorer`

Scores whether the input is detailed enough to compile safely.

Readiness does not decide safety alone. It supports clarification and UI explanation.

### `routerAgent`

Chooses the route for the compile request.

Routes include:

- compile
- needs clarification
- suggest safer workflow
- assistant-only
- reject

The router can influence the compile path, but it cannot directly execute the workflow or override final safety boundaries.

### `clarificationPlanner`

Decides whether the compile request still needs more detail before the flow should be treated as implementation-ready.

In M12, this remains useful for compile-time validation but should no longer be the primary user-facing question generator.

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

### `schemaValidator`

Validates the final `CompileJob` before returning it to the frontend.

If validation fails, the API should return a server error rather than rendering unsafe or malformed UI data.

---

## Frontend architecture

Main page:

```text
app/pages/compiler.vue
```

M12 focused flow:

```text
Input screen
  ↓
Guided clarification if needed
  ↓
Compile sequence
  ↓
One focused result:
  - workflow blueprint
  - one clarification question
  - not-safe verdict
  ↓
Optional details
```

The first result screen should not be a technical report.

Primary result rules:

- If workflow is possible, show the workflow first.
- If more data is needed, show one clarification question.
- If not safe, show the verdict and next safe move.
- Hide diagnostics, risks, gates, trace, providers, and Safety Critic details by default.

---

## Agent trace

The API returns an agent trace for transparency.

Important trace events:

- initialize compile job
- router provider attempts
- router decision selected
- clarification planner
- clarification agent
- blueprint architect
- safety critic agent
- deterministic safety review
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
- guided clarification endpoint compiles

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
