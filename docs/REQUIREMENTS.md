# FlowForge Requirements

FlowForge is a non-executing automation blueprint compiler.

It accepts a plain-language workflow description and returns a safe, structured preview showing what can be automated, what must stay draft-only, what needs human approval, what needs clarification, and what is blocked in the MVP.

M12 adds a guided clarification session so vague or messy input can be clarified one contextual question at a time before compiling.

---

## Product goal

Help users reason about automation safely before implementation.

FlowForge should answer:

```text
What would this workflow do?
What is safe to automate?
What must stay human-reviewed?
What is too vague?
What is unsafe to automate?
What is the next missing detail?
```

The MVP must not execute any real-world action.

---

## MVP scope

FlowForge must provide:

- workflow input
- compile modes
- guided clarification session
- deterministic signal scan
- deterministic risk scan
- readiness scoring
- AI router support in Balanced/Full modes
- deterministic clarification planner inside compile
- safe blueprint builder
- Safety Critic review
- validated compile job response
- focused main UI result
- details-on-demand UI
- demo-ready test scenarios

---

## Out of scope

The MVP must not include:

- database persistence
- authentication
- user accounts
- production connectors
- live email sending
- live messaging
- account updates
- refunds or payments
- deletion or cancellation actions
- n8n execution
- real workflow deployment
- medical, legal, visa, employment, financial, or account-access decision automation

---

## Functional requirements

### FR1 — Process input

The user must be able to enter a plain-language workflow description.

The UI should support:

- manual text input
- suggested example prompts
- guided compile button
- clear indication that output is non-executing
- advanced compile mode selection hidden behind a secondary control

Acceptance criteria:

- Empty input returns a validation error
- Non-empty input can start guided clarification or compile
- Previous result clears when a new compile starts
- Default user flow does not require understanding compile modes

---

### FR2 — Compile modes

The app must support four modes:

```text
demo
rule_only
balanced
full
```

Mode behavior:

- Demo: no AI calls
- Rule-only: no AI calls
- Balanced: AI routing/agents allowed where configured, deterministic safety validation remains
- Full: most provider usage allowed, deterministic safety validation remains

Acceptance criteria:

- Demo works without provider keys
- Balanced/Full show provider path when providers are configured
- Safety outcome remains bounded by deterministic safety logic
- Mode selection is not the primary UX

---

### FR3 — Guided clarification session

The system must support a dedicated clarification session before compile.

Endpoint:

```text
POST /api/clarify
```

The clarification session must:

- accept original input and previous answers
- infer known facts from messy text
- ask one contextual question at a time
- use previous answers
- stop when enough useful facts are collected
- return `ready_to_compile=true`
- return `rewritten_compile_prompt`
- avoid repeated questions
- hard-stop after a small maximum number of questions

Acceptance criteria:

- `Automate my tasks.` asks what task category to automate first
- the first question is not a generic data-source question
- support-ticket/email clarification stops after enough core details are collected
- repeated human-review or decision-rule questions are detected and stopped
- the system compiles with best available facts after the question limit
- provider failure falls back to deterministic clarification behavior

---

### FR4 — Signal scanning

The system must scan visible process structure.

It must detect:

- trigger
- scheduled trigger
- repeated process
- workflow primitives
- external action
- sensitive data
- clear output
- decision points
- human actor
- system actor
- missing critical information

Workflow primitives include:

- intake
- classification
- extraction
- summarization
- routing
- drafting
- approval
- notification
- record creation
- risk detection
- validation
- monitoring
- reporting

Acceptance criteria:

- Internal workflows produce enough structure for a blueprint
- Vague workflows are flagged as underspecified
- Support inbox / support team lead / review-before-send language is recognized
- Safe no-send boundaries are recognized

---

### FR5 — Risk scanning

The system must classify risk deterministically.

Risk categories include:

- external communication
- refund or payment
- financial
- legal
- medical
- visa or immigration
- employment
- account access
- personal data
- complaint or angry user
- real-world execution
- delete or destructive action
- high-stakes decision

Acceptance criteria:

- Low-risk internal workflows stay low risk
- External replies become medium risk and require approval
- Refund/payment workflows require human approval
- Medical, visa/immigration, legal, account access, and destructive workflows are blocked or treated as not safe to automate
- Risk summary is visible in details

---

### FR6 — Readiness scoring

The system must calculate a readiness score.

The score should consider:

- trigger clarity
- output clarity
- data/source detail
- workflow primitives
- decision points
- risk clarity
- human ownership where needed

Acceptance criteria:

- Vague inputs receive low or medium readiness
- Clear internal workflows receive higher readiness
- Readiness reasons and weaknesses are available for explanation

---

### FR7 — Router Agent

The system may use an AI router in Balanced and Full mode.

Router responsibilities:

- choose route
- provide confidence
- explain reason
- provide safety note
- record provider attempts

Possible routes:

- compile blueprint
- needs clarification
- suggest safer workflow
- assistant only
- reject

Acceptance criteria:

- Router returns validated structured output
- Groq can be primary provider
- Gemini can be fallback provider
- deterministic fallback exists
- router does not generate final blueprint
- router does not decide final safety alone

---

### FR8 — Compile-time clarification planner

The compile endpoint must still detect when a request is underspecified.

Clarification fields:

- trigger
- data source
- input data
- output
- decision rules
- human owner
- approval boundary
- external action boundary
- success criteria

Acceptance criteria:

- compile-time clarification remains available as a safety fallback
- specific support inbox + support team lead + before any reply is sent does not remain stuck in clarification
- high-stakes unsafe workflows are not softened into clarification when they should be blocked
- compile-time clarification is not the primary user-facing guided conversation

---

### FR9 — Safe blueprint builder

The system must build a safe automation blueprint.

The blueprint must include:

- workflow name
- workflow category
- steps
- step primitives
- automation policy
- real-world execution policy
- human approval gates
- risks
- safe-to-automate list
- needs-human-approval list
- not-recommended list
- not-safe-to-automate list
- dry-run cases
- assumptions
- open questions
- automation boundary

Acceptance criteria:

- Safe workflows produce clear steps
- External communication creates draft-only and approval steps
- Refund/payment workflows create finance/human approval gates
- Unsafe workflows return safe alternatives
- No step performs production execution

---

### FR10 — Safety Critic

The system must run a Safety Critic review after blueprint generation.

Possible overall statuses:

```text
safe_internal_preview
needs_human_approval
needs_clarification
not_safe_to_automate
```

The Safety Critic must produce:

- summary
- findings
- safe-to-automate list
- draft-only list
- human-approval list
- blocked/not-recommended list
- next safe action

Acceptance criteria:

- safe internal workflow returns safe internal preview
- support draft reply returns needs human approval
- refund/payment workflow returns needs human approval
- vague workflow returns needs clarification
- visa/payment/account auto-send returns not safe to automate
- medical advice/diagnosis returns not safe to automate
- destructive delete/cancel/email workflow returns not safe to automate
- router false positives do not override Safety Critic state

---

### FR11 — Focused main UI state

The compiler page must show one primary user outcome.

Main outcomes:

```text
Workflow blueprint
Guided clarification
Not safe to automate
```

Acceptance criteria:

- Possible workflows show the workflow first
- Missing information shows only the next clarification question
- Unsafe workflows show only verdict + next safe move first
- Risks, trace, providers, Safety Critic, and debug details are hidden by default
- Details are available on demand
- Main result is understandable at first glance

---

### FR12 — Details on demand

The UI must keep advanced details hidden until requested.

Detail panels:

- Critic
- Workflow
- Risks
- Dry runs
- Router
- Before build
- Trace
- Agent workbench
- Agent debug

Acceptance criteria:

- Main result is understandable without opening details
- Router provider path is inspectable
- Trace is inspectable
- Risk and gate details are inspectable
- Agent debug is inspectable when available
- Details do not clutter the first view

---

### FR13 — Schema validation

The final compile job and clarification sessions must validate before use.

Validation must cover:

- compile job
- clarification session
- input
- pipeline steps
- signals
- risks
- readiness
- router decision
- clarification plan
- blueprint
- Safety Critic
- trace
- token usage

Acceptance criteria:

- Invalid compile job returns server error
- Invalid clarification session returns server error or fallback
- Fixture validation catches schema drift
- `npm run validate:fixtures` passes
- `npm run typecheck` passes

---

## Non-functional requirements

### NFR1 — Safety first

The app must prefer safe refusal, clarification, draft-only output, or human approval over unsafe automation.

### NFR2 — Bounded AI behavior

AI may guide, route, propose, or critique, but must not execute actions or override deterministic safety boundaries.

### NFR3 — Determinism where it matters

Core safety behavior must not depend only on AI provider output.

Deterministic components:

- signal scanner
- risk scanner
- readiness scorer
- compile-time clarification planner
- blueprint builder
- Safety Critic / Safety Guard
- schema validator
- clarification fallback readiness

### NFR4 — Demo reliability

Demo mode must work without any provider keys.

### NFR5 — Explainability

Every outcome must explain, at least in details:

- why this status was selected
- what is safe
- what is gated
- what is blocked
- what the next safe action is

### NFR6 — No execution

The system must never execute real-world actions in the MVP.

---

## Tested M12 scenarios

### Guided vague request

Input:

```text
Automate my tasks.
```

Expected:

```text
Guided clarification
First question asks what kind of tasks to automate first
No generic data-source question first
```

### Guided email support workflow

Clarification answers should be enough after collecting:

```text
Task type: email/support ticket management
Trigger: new support ticket or weekly review
Source: email inbox
Output: summary, draft reply, tags, internal task
Human reviewer: support lead
Boundary: no reply is sent automatically
```

Expected:

```text
ready_to_compile=true
rewritten_compile_prompt exists
compiler shows workflow blueprint first
```

### Human-gated support reply

Input:

```text
When a new customer message arrives in the support inbox, classify the topic and urgency, draft an internal response suggestion, and route it to the support team lead for review before any reply is sent.
```

Expected:

```text
Workflow blueprint
Needs human approval
medium risk
1 gate
```

### Unsafe high-stakes workflow

Input:

```text
When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.
```

Expected:

```text
Not safe to automate
high risk
next safe move
```

---

## Acceptance checklist for M12

M12 is complete when:

- `clarificationSession` shared type exists
- clarification session schema exists
- clarification conversation prompt exists
- clarification conversation agent exists
- `/api/clarify` exists
- compiler page calls `/api/clarify` before compiling vague input
- clarification asks one contextual question at a time
- clarification stops after enough facts or max question count
- repeated questions are detected
- UI compiles with `rewritten_compile_prompt`
- workflow result is shown first
- details are hidden by default
- typecheck passes
- fixture validation passes

## Future requirements

Future versions may add:

- saved compile jobs
- auth
- team workspaces
- persistent templates
- exportable static n8n draft
- provider evaluation suite
- richer category-specific Safety Critic recommendations
- connector policy layer
- production-readiness checklist
- collaboration and comments