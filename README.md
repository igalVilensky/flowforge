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

## Current Milestone

This repository is at Milestone 0: project setup and documentation.

Milestone 0 includes:

- Nuxt 4, Vue 3, and TypeScript scaffold
- Landing page at `/`
- Compiler preview page at `/compiler`
- Placeholder `POST /api/compile` endpoint
- Shared TypeScript types for workflow blueprints, compile jobs, and agent trace events
- Product, architecture, milestone, demo, and Codex workflow documentation

Milestone 0 intentionally does not include:

- Real LLM calls
- Groq, Gemini, OpenAI, or other provider integration
- Persistent storage
- Authentication
- n8n import or export
- Real workflow execution
- Background jobs
- Deployment configuration

## Safety Boundary

The placeholder blueprint demonstrates the core FlowForge rule:

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
- npm

Future milestones may add schema validation, deterministic scanner tools, and
isolated AI provider services. Those are not implemented in Milestone 0.

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

Call the placeholder compile API:

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
Milestone 1 - Static Prototype
```

That milestone should build the UI with fake data only. Real scanners,
providers, persistence, n8n export, and execution remain future work.
