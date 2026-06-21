# FlowForge

FlowForge is a safe AI automation blueprint compiler.

It turns messy process descriptions into structured, validated, human-gated
automation blueprints.

```text
Messy process in. Safe automation blueprint out.
```

FlowForge does not blindly automate every request. It finds the safest useful
automation boundary: what can be automated, what needs human approval, what is
not recommended, and what must not execute automatically.

## Current Status

This repository has completed Milestone 5: Dynamic Blueprint Builder.

Implemented so far:

- Nuxt 4, Vue 3, and TypeScript scaffold
- Tile-based UI prototype at `/compiler`
- Shared TypeScript types for workflow blueprints, compile jobs, and agent trace events
- Zod schema validation for blueprints, compile jobs, scanner output, and readiness scores
- Fixture validation through `npm run validate:fixtures`
- Rule-based signal scanning with workflow primitive detection
- Risk scanning for sensitive automation categories
- Readiness scoring with explainable strengths and weaknesses
- Deterministic dynamic blueprint building from input, signals, risks, and readiness
- Product, architecture, milestone, demo, and Codex workflow documentation

This milestone intentionally does not include:

- Real LLM calls
- Groq, Gemini, OpenAI, or other provider integration
- Persistent storage
- Authentication
- n8n import or export
- Real workflow execution
- Background jobs
- Deployment configuration

## Safety Boundary

The dynamic blueprint preview demonstrates the core FlowForge rule:

- Classification can be automated.
- Drafting can be automated as draft-only output.
- External communication needs human approval.
- Sensitive or high-stakes decisions need human approval.
- Real-world execution should not happen automatically in the MVP.

High-risk categories include financial, legal, medical, visa or immigration,
employment, refunds, payments, account access, destructive actions, and any
external communication that affects real people.

## Tech Stack

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt server routes
- Zod
- npm

## Local Development

Install dependencies:

```bash
npm install
```

Start the Nuxt dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/compiler
```

Run fixture validation:

```bash
npm run validate:fixtures
```

Call the deterministic compile API:

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"When a customer asks for a refund, classify the request and draft a reply for human review.","mode":"demo"}'
```

## Project Structure

```text
flowforge/
  app/
    app.vue
    pages/
      index.vue
      compiler.vue
  docs/
    PROJECT_BRIEF.md
    REQUIREMENTS.md
    ARCHITECTURE.md
    CODEX_FLOW.md
    MILESTONES.md
    DEMO_SCRIPT.md
    BOOTSTRAP_COMMANDS.md
  server/
    api/
      compile.post.ts
    services/
      blueprintBuilder.ts
      signalScanner.ts
      riskScanner.ts
      readinessScorer.ts
      schemaValidator.ts
    fixtures/
      validBlueprint.ts
      validCompileJob.ts
      invalidBlueprint.ts
    schemas/
      workflow.schema.ts
      compileJob.schema.ts
    rules/
      primitiveRules.ts
      readinessRules.ts
  shared/
    types/
      workflow.ts
      compileJob.ts
      agentTrace.ts
```

## Development Rule

Build FlowForge in small milestones. Do not jump from this scaffold to a full
automation product in one pass.

Recommended next milestone:

```text
Milestone 6 - Router Agent
```

That milestone should add the first constrained LLM decision point only if the
milestone explicitly authorizes provider work. Persistence, authentication, n8n
export, and real workflow execution remain future work.
