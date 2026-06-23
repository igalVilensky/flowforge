# FlowForge

FlowForge is a **safe automation blueprint compiler**.

It turns a plain-language process into a structured, validated, non-executing automation preview. It does not blindly automate the request. It finds the safest useful automation boundary.

## Core idea

```text
Describe a process
  → scan structure and risks
  → route with AI only when enabled
  → build a deterministic safe blueprint
  → run a deterministic Safety Critic
  → show what is safe, gated, draft-only, or blocked
```

FlowForge is intentionally conservative. The MVP never executes real-world actions.

---

## What FlowForge does

FlowForge can preview workflows such as:

- internal intake and triage
- classification workflows
- extraction workflows
- draft-only support replies
- human-reviewed refund/payment workflows
- internal review task creation
- safe alternatives for risky automation requests

FlowForge shows:

- workflow steps
- risk level
- human approval gates
- draft-only boundaries
- MVP-blocked actions
- dry-run scenarios
- AI router path
- agent trace
- Safety Critic review

---

## What FlowForge does not do

The MVP does **not**:

- send emails or messages
- update accounts
- issue refunds
- delete records
- cancel subscriptions
- give legal, medical, visa, or other high-stakes advice
- execute n8n workflows
- connect to production tools
- store jobs in a database
- provide auth or user accounts

Everything is a safe preview.

---

## Current milestone

Current milestone: **M11 — Safety Critic Agent**

Status: **completed / ready for validation**

M11 adds a deterministic Safety Critic that reviews the final blueprint after generation.

The Safety Critic decides whether the workflow is:

```text
safe_internal_preview
needs_human_approval
needs_clarification
not_safe_to_automate
```

It uses no LLM call.

---

## Safety outcomes

### Safe internal preview

Example:

```text
Every morning, collect new job application emails from the admissions inbox,
extract the candidate name, role, portfolio link, and application source,
classify the application priority, and create an internal review task
for the admissions team without sending any external messages.
```

Expected result:

```text
Safe internal flow
Safe internal preview
low risk
0 gates
```

### Needs human approval

Example:

```text
When a new customer message arrives in the support inbox,
classify the topic and urgency, draft an internal response suggestion,
and route it to the support team lead for review before any reply is sent.
```

Expected result:

```text
Flow needs human gates
Needs human approval
medium risk
1 gate
```

### Needs clarification

Example:

```text
Automate my customer messages.
```

Expected result:

```text
Need details before flow
Needs clarification
```

### Not safe to automate

Example:

```text
When a student asks about visa eligibility or payment problems,
decide the answer, update their account, send the message automatically,
and close the case.
```

Expected result:

```text
Do not automate
Not safe to automate
high risk
blocker
```

---

## Compile modes

### Demo

No AI calls.

Use this for the final demo because it is deterministic and reliable.

### Rule-only

No AI calls.

Useful for proving the compiler works without any provider.

### Balanced

Uses the AI router when available, then keeps the blueprint and Safety Critic deterministic.

Best normal development mode.

### Full

Allows the most router/provider usage, but still does not execute anything.

The blueprint and Safety Critic remain deterministic.

---

## Tech stack

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt server routes
- Zod
- Groq router provider
- Gemini router fallback
- Deterministic fallback router
- npm

---

## Project structure

```text
app/
  pages/
    compiler.vue

server/
  api/
    compile.post.ts
  services/
    signalScanner.ts
    riskScanner.ts
    readinessScorer.ts
    routerAgent.ts
    clarificationPlanner.ts
    blueprintBuilder.ts
    safetyCritic.ts
    schemaValidator.ts
  schemas/
    compileJob.schema.ts
  fixtures/
    validCompileJob.ts
  rules/
    primitiveRules.ts

shared/
  types/
    compileJob.ts
    workflow.ts

docs/
  ARCHITECTURE.md
  MILESTONES.md
  REQUIREMENTS.md
  DEMO_SCRIPT.md
```

---

## Main compile pipeline

```text
POST /api/compile
  ↓
signalScanner
  ↓
riskScanner
  ↓
readinessScorer
  ↓
routerAgent
  ↓
clarificationPlanner
  ↓
blueprintBuilder
  ↓
safetyCritic
  ↓
schemaValidator
  ↓
CompileJob response
```

Only the router may use AI.

The following are deterministic:

- signal scan
- risk scan
- readiness score
- clarification plan
- blueprint generation
- Safety Critic
- schema validation

---

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000/compiler
```

---

## Validation

Run:

```bash
npm run validate:fixtures
npm run typecheck
```

Expected:

- fixture validates against the Zod schema
- TypeScript passes
- CompileJob includes Safety Critic data
- frontend and backend types stay aligned

---

## Provider environment

FlowForge can run without AI in Demo or Rule-only mode.

For Balanced or Full mode, configure providers if available:

```bash
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

If provider calls fail, the router can fall back to deterministic routing.

---

## Demo script

Recommended demo order:

1. Safe internal workflow
2. Human-gated support reply workflow
3. Vague customer-message request
4. Visa/payment/account auto-send request
5. Show router details in Balanced or Full mode
6. Show Safety Critic details

Use Demo mode for the safest presentation path.

Use Balanced or Full mode only if provider keys are configured and stable.

---

## Tested M11 scenarios

The following scenarios were tested during M11:

```text
Safe internal admissions intake
→ Safe internal preview
```

```text
Support reply drafted for team lead review
→ Needs human approval
```

```text
Refund/payment review routed to finance
→ Needs human approval
```

```text
Vague “Automate my customer messages”
→ Needs clarification
```

```text
Visa/payment/account update/send automatically
→ Not safe to automate
```

```text
Medical symptoms/diagnosis/advice/profile update
→ Not safe to automate
```

```text
Delete customer records/cancel subscription/email user
→ Not safe to automate
```

Balanced and Full modes preserve deterministic Safety Critic outcomes.

---

## Known polish items

The M11 logic is complete, but the UI still has a few polish items:

- Rename “Blocked” counter to “MVP boundaries” when status is not blocked
- Hide “Before build questions” unless the main state is clarification
- Show only top clarification questions first
- Improve risk-specific blocked recommendations
- Reword “Build non-executing preview — Blocked in MVP” to clarify that execution is blocked, not the preview

---

## Design principle

FlowForge should keep one thing primary:

```text
Safe internal flow
Flow needs human gates
Need details before flow
Do not automate
```

Everything else belongs in details on demand.

---

## License

Student project / MVP prototype.