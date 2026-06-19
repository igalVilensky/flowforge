# FlowForge Project Brief

## Summary

FlowForge is a safe AI automation blueprint compiler.

It converts messy human process descriptions into structured, validated,
human-gated automation blueprints.

```text
Messy process in. Safe automation blueprint out.
```

FlowForge is not a chatbot that turns every request into workflow JSON. Its
main value is finding the safest useful automation boundary.

## Problem

Most automation demos skip the hard parts:

- Is the process repeatable?
- Is the request clear enough to automate?
- Which parts can be deterministic?
- Which parts need AI assistance?
- Which parts require a human decision?
- Which actions could affect real people, money, accounts, or records?
- How can the plan be validated before anything executes?

FlowForge exists to make those questions visible before implementation.

## Product Positioning

FlowForge is a rule-first, agent-assisted workflow compiler for safe automation
planning.

It should help a user move from:

```text
When a customer asks for a refund, classify the request, detect angry or legal
language, draft a reply, and route risky cases to a human.
```

to a blueprint that explains:

- trigger and inputs
- workflow primitives
- safe automated steps
- draft-only AI steps
- human approval gates
- unsafe or blocked execution steps
- risks and assumptions
- dry-run expectations
- future implementation notes

## Core Principle

```text
FlowForge does not blindly automate every request.
It finds the safest useful automation boundary.
```

The boundary must separate:

- Safe to automate
- Needs human approval
- Not recommended
- Not safe to automate

## Agentic Shape

The final product can be agentic because a constrained compiler agent will
observe workflow state and choose approved tools from a fixed menu.

Future tools may include:

- signal scanner
- risk scanner
- primitive detector
- readiness score calculator
- router agent
- workflow architect
- schema validator
- blueprint repair step
- safety critic
- approval gate generator
- dry-run generator
- export builder

The agent must not execute arbitrary code. It should only call approved local
tools and isolated provider services.

## Milestone 0 Scope

Milestone 0 prepares the repository. It contains:

- documentation
- shared TypeScript contracts
- simple Nuxt pages
- a placeholder compile API
- a mock safe automation blueprint

Milestone 0 does not contain:

- real AI provider calls
- persistent storage
- authentication
- real integrations
- real workflow execution
- n8n import or export
- background jobs

## Product Promise

FlowForge should make automation safer by slowing down the right parts:
classification and drafting can be fast, while external communication,
sensitive decisions, and real execution remain reviewable and accountable.
