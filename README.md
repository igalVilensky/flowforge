# FlowForge

FlowForge is a **safe automation blueprint compiler**.

It turns a plain-language process into a structured, validated, non-executing automation preview. It does not blindly automate the request. It finds the safest useful automation boundary and guides the user when the request is too vague.

## Core idea

```text
Describe a process
  → clarify messy input when needed
  → scan structure and risks
  → route with AI only when enabled
  → build a safe non-executing blueprint
  → review the blueprint with safety checks
  → show the focused next outcome
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

FlowForge shows the user one primary outcome:

```text
1. Workflow possible
   Show the workflow blueprint first.

2. Missing details
   Ask one clarification question at a time.

3. Not safe
   Show the blocked verdict and next safe move.
```

Advanced details are still available on demand:

- risk level
- human approval gates
- draft-only boundaries
- MVP-blocked actions
- dry-run scenarios
- AI provider path
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

Current milestone: **M12 — Guided Clarification + Focused Compiler UX**

Status: **implemented / ready for validation**

M12 adds a dedicated clarification session flow. Instead of showing a batch of hardcoded missing-field questions, FlowForge can call a Clarification Conversation Agent that reads messy input, extracts known facts, asks one contextual question at a time, and returns a rewritten compile prompt when enough information is collected.

M12 also changes the compiler page from a dense report view into a focused guided experience.

---

## Main user flow

### 1. User enters a process

Example:

```text
Automate my tasks.
```

FlowForge should not immediately ask a generic data-source question. It should first ask what kind of task the user wants to automate.

Expected first clarification:

```text
What kind of tasks should FlowForge help with first — emails, tickets, documents, leads, scheduling, or internal admin work?
```

### 2. FlowForge asks one question at a time

The clarification session tracks previous answers and stops when enough useful facts are known.

Example collected facts:

```text
Task type: email or support ticket management
Trigger: new support ticket or weekly review
Source: email inbox
Output: summary, draft reply, tags, internal task
Human reviewer: support lead
Boundary: no reply is sent automatically
```

### 3. FlowForge compiles a blueprint

When the session is ready, the page calls `/api/compile` with the agent’s `rewritten_compile_prompt`.

If a workflow is possible, the first result view is the workflow itself, similar to a lightweight n8n/Make-style blueprint.

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
Workflow blueprint
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
Workflow blueprint with human gates
Needs human approval
medium risk
1 gate
```

### Needs clarification

Example:

```text
Automate my tasks.
```

Expected result:

```text
Guided clarification
One contextual question at a time
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
Not safe to automate
high risk
next safe move
```

---

## API endpoints

### Compile

```text
POST /api/compile
```

Request:

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

### Guided clarification

```text
POST /api/clarify
```

Request:

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

Response:

```ts
ClarificationSessionResponse
```

The clarification response includes:

- known facts
- previous answers
- one next question, or
- `ready_to_compile=true`
- `rewritten_compile_prompt`

---

## Compile modes

### Demo

No AI calls. Useful for deterministic demo paths.

### Rule-only

No AI calls. Useful for proving the compiler works without providers.

### Balanced

Uses AI where allowed, with deterministic safety boundaries.

### Full

Allows the most provider usage, still with no execution and deterministic validation.

---

## Tech stack

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt server routes
- Zod
- Groq provider
- Gemini fallback
- Deterministic fallbacks
- npm

---

## Project structure

```text
app/
  pages/
    compiler.vue

shared/
  types/
    compileJob.ts
    agentOutputs.ts
    clarificationSession.ts
    workflow.ts

server/
  api/
    compile.post.ts
    clarify.post.ts

  prompts/
    clarificationConversationPrompt.ts
    clarificationAgentPrompt.ts
    blueprintArchitectPrompt.ts
    safetyCriticAgentPrompt.ts

  schemas/
    compileJob.schema.ts
    agentOutputs.schema.ts
    clarificationSession.schema.ts

  services/
    signalScanner.ts
    riskScanner.ts
    readinessScorer.ts
    clarificationPlanner.ts
    clarificationConversationAgent.ts
    clarificationAgent.ts
    routerAgent.ts
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

Run before marking the current milestone complete:

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