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

This repository has completed Milestone 8: Visible Agent Run / Compile Progress UX.

Implemented so far:

- Nuxt 4, Vue 3, and TypeScript scaffold
- Tile-based UI prototype at `/compiler`
- Progressive disclosure UI for complex blueprints
- Shared TypeScript types for workflow blueprints, compile jobs, and agent trace events
- Zod schema validation for blueprints, compile jobs, scanner output, and readiness scores
- Fixture validation through `npm run validate:fixtures`
- Rule-based signal scanning with workflow primitive detection
- Risk scanning for sensitive automation categories
- Readiness scoring with explainable strengths and weaknesses
- Deterministic dynamic blueprint building from input, signals, risks, and readiness
- Router Agent for evaluating safety and deciding compilation routes via Groq with Gemini fallback
- Manual compile start in `/compiler`; the page does not auto-run on load
- Visible compile progress with a readable staged frontend agent-run replay
- Visible AI router explanation covering router role, inputs, output, provider path, and deterministic boundary
- Deterministic fallback routing when provider keys are missing or provider calls fail
- Expandable full text for long process, trigger, dry-run, router, and trace text
- Product, architecture, milestone, demo, and Codex workflow documentation

This milestone intentionally does not include:

- Generating full blueprints with AI; AI is currently used only for router decisions in `balanced` and `full` modes
- Persistent storage
- Authentication
- n8n import or export
- Real workflow execution
- Background jobs
- Deployment configuration

Blueprint generation remains deterministic. Groq is the primary router provider, Gemini is the fallback router provider, and deterministic fallback always exists. The visible compile replay is frontend-only; the backend still returns one compile response and does not stream progress.

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

Run typecheck:

```bash
npm run typecheck
```

Call the deterministic compile API:

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"When a customer asks for a refund, classify the request and draft a reply for human review.","mode":"demo"}'
```

## Router And Compile UX Testing

Test the compiler UI and `/api/compile` across these routing paths:

- demo mode: AI router skipped, deterministic routing, deterministic blueprint builder, `0 / 0` LLM calls
- balanced/full with Groq available: Groq handles the router decision, blueprint generation remains deterministic
- balanced/full with Groq failing and Gemini available: Gemini handles fallback routing, blueprint generation remains deterministic
- balanced/full with missing provider keys: Groq and Gemini are skipped, deterministic fallback keeps compile successful
- balanced/full with failed configured providers: failed HTTP attempts count as LLM calls, deterministic fallback keeps compile successful

The `/compiler` page should open in an idle ready state with no automatic API request. After clicking `Compile preview`, it should show a staged compile replay even when the API responds quickly. The previous result remains visible and marked as updating until the staged replay finishes. Long process, trigger, dry-run, router, and trace text should expose a `Show full` option when collapsed.

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
      routerAgent.ts
      groqProvider.ts
      geminiProvider.ts
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
Milestone 9 - Blueprint Repair Loop
```

Persistence, authentication, n8n export, and real workflow execution remain future work.
