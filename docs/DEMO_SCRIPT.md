# FlowForge Demo Script

This script is for presenting FlowForge after M11.

Recommended mode for live presentation: **Demo**  
Optional mode for provider transparency: **Balanced** or **Full**

FlowForge is a non-executing automation blueprint compiler. The main demo message is:

```text
FlowForge does not execute automations.
It compiles a process into a safe preview and explains what is safe, gated, draft-only, unclear, or blocked.
```

---

## Demo setup

Run locally:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/compiler
```

Before presenting, run:

```bash
npm run validate:fixtures
npm run typecheck
```

Use **Demo** mode if provider keys are not stable.

Use **Balanced** or **Full** mode only if Groq/Gemini routing is configured.

---

## What to explain first

Say:

```text
FlowForge takes a plain-language workflow and compiles it into a safe automation blueprint.
The MVP never sends messages, updates records, issues refunds, deletes data, or executes real-world actions.
AI can help choose a route, but the blueprint and Safety Critic are deterministic.
```

Point at the four possible main outcomes:

```text
Safe internal flow
Flow needs human gates
Need details before flow
Do not automate
```

---

## Test 1 — Safe internal workflow

Mode: **Demo**

Input:

```text
Every morning, collect new job application emails from the admissions inbox, extract the candidate name, role, portfolio link, and application source, classify the application priority, and create an internal review task for the admissions team without sending any external messages.
```

Expected main result:

```text
Safe internal flow
Safe internal preview
low risk
0 gates
No execution
```

Expected Safety Critic:

```text
Critic: safe as preview
Internal preview is safe
```

Explain:

```text
This is safe because it stays internal. It classifies and extracts information, then creates an internal review task. It does not send external messages.
```

---

## Test 2 — Human-gated external communication

Mode: **Demo**

Input:

```text
When a new customer message arrives in the support inbox, classify the topic and urgency, draft an internal response suggestion, and route it to the support team lead for review before any reply is sent.
```

Expected main result:

```text
Flow needs human gates
Needs human approval
medium risk
1 gate
No execution
```

Expected flow details:

```text
Draft proposed output — Draft only
Approve sensitive action — Human approval
```

Expected Safety Critic:

```text
Critic: human gate needed
Generated text must stay draft-only
```

Explain:

```text
FlowForge can safely draft an internal response suggestion, but it will not send the message. A human approval gate is required before any reply is sent.
```

---

## Test 3 — Refund/payment review

Mode: **Demo**

Input:

```text
When a customer reports a billing issue or charge dispute, classify the complaint, extract the order ID and payment amount, draft an internal case summary, and route it to the finance team for review before any refund or message is sent.
```

Expected main result:

```text
Flow needs human gates
Needs human approval
medium risk
3 gates
No execution
```

Expected Safety Critic:

```text
Critic: human gate needed
Human approval required before sensitive action
```

Explain:

```text
Refunds and payments are sensitive, but this is not automatically blocked. FlowForge allows a safe internal review workflow with finance approval. It does not issue refunds or send messages.
```

---

## Test 4 — Vague request

Mode: **Demo**

Input:

```text
Automate my customer messages.
```

Expected main result:

```text
Need details before flow
Needs clarification
```

Expected UI:

```text
Missing details
Suggested starter
Clarification questions
```

Expected Safety Critic:

```text
Critic: clarify first
Clarification needed before implementation
```

Explain:

```text
The request is too vague. FlowForge does not invent a fake implementation. It asks for trigger, data source, output, owner, and external action boundary.
```

---

## Test 5 — Unsafe high-stakes auto-send

Mode: **Demo**

Input:

```text
When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.
```

Expected main result:

```text
Do not automate
Not safe to automate
high risk
blocker
No execution
```

Expected Safety Critic:

```text
Critic: do not automate
Unsafe automation is blocked
```

Explain:

```text
This combines visa eligibility, payment problems, account updates, and automatic sending. FlowForge blocks it as unsafe for the MVP.
```

---

## Test 6 — Medical high-stakes workflow

Mode: **Demo**

Input:

```text
When a user describes symptoms, decide whether they need emergency care, send them medical advice, and update their profile with the diagnosis.
```

Expected main result:

```text
Do not automate
Not safe to automate
high risk
blocker
```

Expected Safety Critic:

```text
Critic: do not automate
Unsafe automation is blocked
```

Explain:

```text
Medical advice and diagnosis are high-stakes. The MVP cannot automate this. The only safe direction is intake or routing to a qualified human reviewer.
```

---

## Test 7 — Destructive account workflow

Mode: **Demo**

Input:

```text
Every Friday, find inactive customer accounts, delete their records, cancel their subscriptions, and email them that the account was removed.
```

Expected main result:

```text
Do not automate
Not safe to automate
high risk
blocker
```

Expected Safety Critic:

```text
Critic: do not automate
Unsafe automation is blocked
```

Explain:

```text
Deleting records, cancelling subscriptions, and emailing users are destructive real-world actions. FlowForge blocks this as an MVP automation.
```

---

## Optional Test 8 — Balanced mode safe workflow

Mode: **Balanced**

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
Router: Groq or deterministic fallback
```

Explain:

```text
Balanced mode can use an AI router, but the blueprint and Safety Critic are still deterministic.
```

Open details:

```text
Router
```

Show:

```text
Provider path
Groq / Gemini / deterministic fallback
```

---

## Optional Test 9 — Full mode unsafe workflow

Mode: **Full**

Input:

```text
When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.
```

Expected:

```text
Do not automate
Not safe to automate
high risk
Router: Groq or Gemini
```

Explain:

```text
Even in Full mode, provider routing cannot override deterministic safety. The Safety Critic still blocks unsafe automation.
```

---

## Demo talking points

### The Safety Critic

Say:

```text
The Safety Critic runs after the blueprint is generated.
It does not call AI.
It reviews the final workflow and decides the main safety status.
```

Show the Safety Critic card.

Point out:

```text
Safe
Draft
Approval
Blocked
Next safe action
```

### Router details

Say:

```text
The router is the only AI-assisted part.
It chooses a route, but it does not write the blueprint or decide final safety.
```

Open Router details in Balanced or Full mode.

### Details on demand

Say:

```text
The UI keeps the main result simple and hides the heavy details until needed.
```

Open:

```text
Critic
Workflow
Risks
Dry runs
Router
Trace
```

---

## What not to claim

Do not say:

```text
FlowForge executes automations.
FlowForge can send emails.
FlowForge can update accounts.
FlowForge can issue refunds.
FlowForge exports production-ready n8n workflows.
AI builds the final workflow.
```

Say instead:

```text
FlowForge creates a safe, non-executing preview blueprint.
```

---

## Known demo-safe fallback

If provider keys fail, switch to **Demo** mode.

Demo mode still shows the main product value:

```text
safe preview
risk scanner
clarification planner
blueprint builder
Safety Critic
details on demand
```

---

## Final validation checklist

Before submitting:

```bash
npm run validate:fixtures
npm run typecheck
```

Manual checks:

```text
Safe internal workflow → Safe internal preview
Support draft workflow → Needs human approval
Refund workflow → Needs human approval
Vague workflow → Needs clarification
Visa/payment auto-send → Not safe to automate
Medical workflow → Not safe to automate
Destructive account workflow → Not safe to automate
```
