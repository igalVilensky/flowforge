 FlowForge Requirements

FlowForge is a non-executing automation blueprint compiler.

It accepts a plain-language workflow description and returns a safe, structured preview showing what can be automated, what must stay draft-only, what needs human approval, what needs clarification, and what is blocked in the MVP.

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
```

The MVP must not execute any real-world action.

---

## MVP scope

FlowForge must provide:

- workflow input
- compile modes
- deterministic signal scan
- deterministic risk scan
- readiness scoring
- AI router support in Balanced/Full modes
- deterministic clarification planner
- deterministic safe blueprint builder
- deterministic Safety Critic
- validated compile job response
- main UI result
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
- compile button
- clear indication that output is non-executing

Acceptance criteria:

- Empty input returns a validation error
- Non-empty input can be compiled
- Previous result clears when a new compile starts

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
- Balanced: AI router allowed, deterministic blueprint and critic
- Full: most provider usage allowed, deterministic blueprint and critic

Acceptance criteria:

- Demo works without provider keys
- Balanced/Full show provider path when providers are configured
- Safety outcome remains deterministic across modes

---

### FR3 — Signal scanning

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

### FR4 — Risk scanning

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

### FR5 — Readiness scoring

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

### FR6 — Router Agent

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

### FR7 — Clarification planner

The system must ask for clarification when the input is too vague or missing important details.

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

- `Automate my customer messages.` returns `needs_clarification`
- specific support inbox + support team lead + before any reply is sent does not remain stuck in clarification
- high-stakes unsafe workflows are not softened into clarification when they should be blocked
- clarification questions are readable and include example answers
- suggested starter prompt is shown

---

### FR8 — Safe blueprint builder

The system must build a deterministic safe automation blueprint.

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

### FR9 — Safety Critic

The system must run a deterministic Safety Critic after blueprint generation.

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

Finding types:

- safe to automate
- draft only
- human approval required
- blocked in MVP
- needs clarification
- implementation warning

Acceptance criteria:

- Safety Critic uses no LLM calls
- safe internal workflow returns safe internal preview
- support draft reply returns needs human approval
- refund/payment workflow returns needs human approval
- vague workflow returns needs clarification
- visa/payment/account auto-send returns not safe to automate
- medical advice/diagnosis returns not safe to automate
- destructive delete/cancel/email workflow returns not safe to automate
- router false positives do not override deterministic Safety Critic state

---

### FR10 — Main UI state

The compiler page must show one main outcome.

Main outcomes:

```text
Safe internal flow
Flow needs human gates
Need details before flow
Do not automate
```

The main outcome must be driven by `safety_critic.overall_status`.

Acceptance criteria:

- `safe_internal_preview` shows safe flow
- `needs_human_approval` shows flow with gates
- `needs_clarification` shows missing details
- `not_safe_to_automate` shows safe alternative path
- router route alone does not hijack the main UI

---

### FR11 — Details on demand

The UI must keep advanced details hidden until requested.

Detail panels:

- Critic
- Workflow
- Risks
- Dry runs
- Router
- Before build
- Trace

Acceptance criteria:

- Main result is understandable without opening details
- Router provider path is inspectable
- Trace is inspectable
- Risk and gate details are inspectable
- Details do not clutter the first view

---

### FR12 — Schema validation

The final compile job must validate before it is returned.

Validation must cover:

- compile job
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
- Fixture validation catches schema drift
- `npm run validate:fixtures` passes
- `npm run typecheck` passes

---

## Non-functional requirements

### NFR1 — Safety first

The app must prefer safe refusal, clarification, draft-only output, or human approval over unsafe automation.

### NFR2 — Determinism

Core safety behavior must not depend on AI provider output.

Deterministic components:

- signal scanner
- risk scanner
- readiness scorer
- clarification planner
- blueprint builder
- Safety Critic
- schema validator

### NFR3 — Demo reliability

Demo mode must work without any provider keys.

### NFR4 — Explainability

Every outcome must explain:

- why this status was selected
- what is safe
- what is gated
- what is blocked
- what the next safe action is

### NFR5 — No execution

The system must never execute real-world actions in the MVP.

---

## Tested M11 scenarios

### Safe internal

Input:

```text
Every morning, collect new job application emails from the admissions inbox, extract the candidate name, role, portfolio link, and application source, classify the application priority, and create an internal review task for the admissions team without sending any external messages.
```

Expected:

```text
Safe internal flow
Safe internal preview
low risk
0 gates
```

### Human-gated support reply

Input:

```text
When a new customer message arrives in the support inbox, classify the topic and urgency, draft an internal response suggestion, and route it to the support team lead for review before any reply is sent.
```

Expected:

```text
Flow needs human gates
Needs human approval
medium risk
1 gate
```

### Refund/payment review

Input:

```text
When a customer reports a billing issue or charge dispute, classify the complaint, extract the order ID and payment amount, draft an internal case summary, and route it to the finance team for review before any refund or message is sent.
```

Expected:

```text
Flow needs human gates
Needs human approval
medium risk
human approval gates
```

### Vague request

Input:

```text
Automate my customer messages.
```

Expected:

```text
Need details before flow
Needs clarification
```

### Visa/payment/account auto-send

Input:

```text
When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.
```

Expected:

```text
Do not automate
Not safe to automate
high risk
blocker
```

### Medical advice/diagnosis

Input:

```text
When a user describes symptoms, decide whether they need emergency care, send them medical advice, and update their profile with the diagnosis.
```

Expected:

```text
Do not automate
Not safe to automate
high risk
blocker
```

### Destructive account workflow

Input:

```text
Every Friday, find inactive customer accounts, delete their records, cancel their subscriptions, and email them that the account was removed.
```

Expected:

```text
Do not automate
Not safe to automate
high risk
blocker
```

---

## Acceptance checklist for M11

M11 is complete when:

- Safety Critic types exist
- Safety Critic schema exists
- `CompileJob` includes `safety_critic`
- API builds Safety Critic after blueprint
- API includes `safety_critic_review` pipeline step
- API includes `trace_safety_critic`
- UI renders Safety Critic
- UI main state follows Safety Critic status
- fixture validates
- typecheck passes
- tested scenarios pass in Demo
- safe/human-gated/clarify/blocked paths pass in Balanced or Full

---

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