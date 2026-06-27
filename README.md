# FlowForge

FlowForge is a **non-executing safety and observability layer for AI automation prototypes**.

It turns a plain-language automation idea into a structured, human-gated blueprint. FlowForge does not execute workflows, connect production tools, or perform real-world actions. It helps a human understand what could be automated, what needs approval, what is unsafe, and what implementation constraints must be preserved.

## Product Direction

```text
Describe an automation idea
  -> clarify vague or risky details
  -> route the request through the compiler
  -> build a safe non-executing blueprint
  -> review gates, blocked actions, and risk
  -> expose agent trace and run observability
  -> prepare an n8n implementation handoff prompt
```

FlowForge is intentionally conservative. The useful output is not "automation happened." The useful output is a safe preview that a human can inspect before anything is built or connected.

## Current Capabilities

FlowForge currently includes:

- guided clarification for vague requests
- compile modes: `rule_only`, `balanced`, and `full`
- agent-assisted routing, clarification, blueprint generation, and safety review
- agent status explanations
- agent trace/debug visibility
- provider attempt and fallback visibility
- LLM call tracking
- run observability summary
- human approval gates and blocked actions
- risk/safety outcomes
- horizontal blueprint flow visualization
- n8n implementation handoff prompt

The n8n handoff is a builder prompt for a human implementer. FlowForge does **not** currently generate full n8n workflow JSON.

## What FlowForge Does

FlowForge can preview workflows such as:

- internal intake and triage
- classification workflows
- extraction workflows
- draft-only support replies
- human-reviewed refund or payment workflows
- internal review task creation
- safe alternatives for risky automation requests

The compiler focuses on one primary outcome:

```text
Safe internal preview
Needs human approval
Needs clarification
Not safe to automate
```

Advanced details remain available in the console:

- risk level
- human approval gates
- draft-only boundaries
- blocked actions
- dry-run guidance
- provider path
- agent status explanations
- agent trace/debug
- Safety Critic review
- run observability summary

## What FlowForge Does Not Do

FlowForge does **not**:

- send emails or messages
- update accounts
- issue refunds
- charge payments
- delete records
- cancel subscriptions
- give legal, medical, visa, financial, or other high-stakes advice
- execute n8n workflows
- connect to production tools
- store jobs in a database
- provide auth or user accounts

Everything is a safe, non-executing preview.

## Main User Flow

### 1. User describes a process

Example:

```text
Automate my tasks.
```

FlowForge should not guess a workflow from a vague request. It starts a guided clarification session and asks one contextual question at a time.

Example clarification:

```text
What kind of tasks should FlowForge help with first: emails, tickets, documents, leads, scheduling, or internal admin work?
```

### 2. FlowForge clarifies until the request is useful

The clarification session tracks previous answers and stops when enough practical detail is known.

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

When the session is ready, the page calls `/api/compile` with the clarified prompt. The compiler returns a `CompileJob` with a safe blueprint, safety outcome, agent outputs, trace/debug data, and observability details.

### 4. FlowForge prepares implementation handoff

For valid blueprint results, the compiler page can generate an n8n builder prompt. The prompt describes the node-by-node implementation constraints, human approval points, test-data guidance, and what must remain disabled before production.

## Agent Stack

FlowForge exposes the agent path instead of hiding it behind a single answer.

### Guided Clarifier

Reads a vague automation idea, extracts known facts, asks one contextual question at a time, and can produce a rewritten compile prompt.

### Router

Routes compile requests and explains the chosen path. Depending on mode and provider availability, this can use AI or deterministic fallback.

### Compile Clarifier

Checks whether the compile request still needs missing details before a blueprint would be useful.

### Blueprint Architect

Builds or improves the non-executing workflow preview with step roles, policies, and execution boundaries.

### Safety Critic

Reviews the blueprint for safety outcome, human approval gates, blocked actions, risk, and the next safe action.

## Compile Modes

### Rule-only

```text
mode: "rule_only"
```

Uses deterministic compiler behavior only. No LLM agent should be used.

### Balanced

```text
mode: "balanced"
```

Allows targeted AI help where useful, while preserving deterministic safety boundaries and fallbacks.

### Full

```text
mode: "full"
```

Allows the most agent/provider usage when providers are configured. Safety validation remains conservative and fallback-aware.

`demo` may still be accepted by the API for deterministic demo compatibility, but the primary user-facing modes are `rule_only`, `balanced`, and `full`.

## Safety Outcomes

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
Low risk
No production side effects
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
Medium risk
Manual approval before external action
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
No blueprint until enough detail is known
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
High risk
Blocked actions
Next safe move
```

## API Endpoints

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

### Guided Clarification

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

## Tech Stack

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt server routes
- Zod
- Groq provider
- Gemini fallback
- deterministic fallbacks
- npm

## Project Structure

```text
app/
  app.vue
  pages/
    index.vue
    compiler.vue

shared/
  types/
    agentOutputs.ts
    clarificationSession.ts
    compileJob.ts
    workflow.ts

server/
  api/
    clarify.post.ts
    compile.post.ts
  prompts/
    clarificationConversationPrompt.ts
    clarificationAgentPrompt.ts
    blueprintArchitectPrompt.ts
    safetyCriticAgentPrompt.ts
  schemas/
    agentOutputs.schema.ts
    clarificationSession.schema.ts
    compileJob.schema.ts
  services/
    blueprintBuilder.ts
    clarificationAgent.ts
    clarificationConversationAgent.ts
    clarificationPlanner.ts
    readinessScorer.ts
    riskScanner.ts
    routerAgent.ts
    safetyCritic.ts
    schemaValidator.ts
    signalScanner.ts
```

## Main Compile Pipeline

```text
POST /api/compile
  -> signalScanner
  -> riskScanner
  -> readinessScorer
  -> routerAgent
  -> clarificationPlanner
  -> clarificationAgent
  -> blueprintBuilder / Blueprint Architect
  -> safetyCritic / Safety Critic
  -> schemaValidator
  -> CompileJob response
```

Provider-backed agents are mode-dependent and fallback-aware. Deterministic scanners, schema validation, and safety boundaries remain part of the compiler path.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000/
http://localhost:3000/compiler
```

## Validation

Run:

```bash
npm run typecheck
npm run build
```

Optional fixture validation:

```bash
npm run validate:fixtures
```

Expected:

- TypeScript passes
- production build completes
- fixture validates against the Zod schema
- frontend and backend types stay aligned
- `CompileJob` includes safety, agent, trace/debug, and observability data

## Provider Environment

FlowForge can run without AI in `rule_only` mode.

For `balanced` or `full` mode, configure providers if available:

```bash
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

If provider calls fail, FlowForge reports fallback or provider-attempt details in the console and keeps the run non-executing.

## Demo Script

Recommended demo order:

1. Safe internal workflow
2. Human-gated support reply workflow
3. Vague customer-message request
4. Visa/payment/account auto-send request
5. Show agent status explanations
6. Show provider attempts, fallbacks, trace/debug, and LLM call tracking
7. Show the n8n implementation handoff prompt

Use `rule_only` for the most deterministic presentation path. Use `balanced` or `full` only if provider keys are configured and stable.

## Design Principle

FlowForge should keep one thing primary:

```text
Safe internal flow
Flow needs human gates
Need details before flow
Do not automate
```

Everything else belongs in details on demand.

## License

Student project / MVP prototype.
