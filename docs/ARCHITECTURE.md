# FlowForge Architecture

## Current Architecture

FlowForge starts as a Nuxt-only application.

Nuxt provides:

- Vue pages for the browser experience
- TypeScript support
- server routes for local API endpoints
- a shared folder for reusable TypeScript contracts

There is no separate backend service in Milestone 0.

## Current Runtime

```text
Browser
  -> Nuxt page at /
  -> Nuxt page at /compiler
  -> POST /api/compile
  -> typed mock compile job
```

The current compile endpoint is a placeholder. It does not call an AI provider,
database, queue, n8n instance, email system, payment system, or external API.

## Source Layout

```text
app/
  app.vue
  pages/
    index.vue
    compiler.vue

server/
  api/
    compile.post.ts

shared/
  types/
    workflow.ts
    compileJob.ts
    agentTrace.ts

docs/
  PROJECT_BRIEF.md
  REQUIREMENTS.md
  ARCHITECTURE.md
  CODEX_FLOW.md
  MILESTONES.md
  DEMO_SCRIPT.md
  BOOTSTRAP_COMMANDS.md
```

## Shared Contracts

The shared types define the boundary between frontend and backend:

- `SafeAutomationBlueprint`
- `WorkflowStep`
- `RiskItem`
- `HumanApprovalGate`
- `DryRunTestCase`
- `CompileJob`
- `PipelineStep`
- `TokenUsage`
- `AgentTraceEvent`

These types are intentionally TypeScript-only in Milestone 0. Runtime schemas
can be added in a later milestone.

## Placeholder Compile Flow

Milestone 0 uses a synchronous mock endpoint:

```text
POST /api/compile
  -> validate input exists
  -> validate mode if provided
  -> detect simple placeholder risk hints
  -> return a typed compile job
  -> report zero provider calls
```

The response demonstrates the intended safety posture:

- classification is safe to automate
- drafting is safe as draft-only output
- external communication needs human approval
- sensitive or high-stakes decisions need human approval
- real-world execution is blocked in the MVP

## Future Compiler Architecture

Future milestones can evolve the mock endpoint into a real compiler flow:

```text
User input
  -> initialize workflow state
  -> signal scanner
  -> risk scanner
  -> readiness score
  -> router
  -> workflow architect
  -> schema validator
  -> repair loop if needed
  -> safety critic
  -> approval gate generator
  -> dry-run generator
  -> export builder
  -> final blueprint
```

## Future Server Layers

Recommended future server folders:

```text
server/
  services/
    compilerAgent.ts
    signalScanner.ts
    riskScanner.ts
    readinessScore.ts
    routerAgent.ts
    workflowArchitect.ts
    schemaValidator.ts
    blueprintRepair.ts
    safetyCritic.ts
    approvalGateGenerator.ts
    dryRunGenerator.ts
    exportBuilder.ts
    tokenEstimator.ts
  schemas/
  rules/
  prompts/
  fixtures/
```

The AI provider layer should be isolated in server services. Frontend code
should never call LLM providers directly.

## Provider Strategy

No provider is used in Milestone 0.

Future provider strategy:

- balanced mode: at most 2 to 3 LLM calls
- full mode: at most 4 LLM calls
- rule-only mode: 0 LLM calls
- fallback behavior when a provider fails

Provider calls should receive the smallest useful context, not the entire
workflow state every time.

## Safety Architecture

Safety should not live only in prompts.

FlowForge should combine:

- deterministic scanner rules
- explicit risk categories
- schema validation
- human approval gates
- dry-run expectations
- provider call budgets
- blocked real-world execution in the MVP

External communication, sensitive decisions, and real-world execution must be
visible in the blueprint and reviewable by a human.
