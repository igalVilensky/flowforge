# FlowForge Architecture

## Current Architecture

FlowForge is currently a Nuxt-only application with deterministic server-side
compiler services.

Nuxt provides:

- Vue pages for the browser experience
- TypeScript support
- server routes for local API endpoints
- a shared folder for reusable TypeScript contracts

There is no separate backend service yet.

## Current Runtime

```text
Browser
  -> Nuxt page at /
  -> Nuxt page at /compiler
  -> POST /api/compile
  -> scanSignals(input)
  -> scanRisks(signals)
  -> scoreReadiness(signals, risks)
  -> buildBlueprint(...)
  -> validate compile job with Zod
  -> safe non-executing preview
```

The current compile endpoint is deterministic and rule-based. It does not call
an AI provider, database, queue, n8n instance, email system, payment system, or
external API.

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
  services/
    blueprintBuilder.ts
    readinessScorer.ts
    riskScanner.ts
    schemaValidator.ts
    signalScanner.ts
  schemas/
    compileJob.schema.ts
    workflow.schema.ts
  rules/
    primitiveRules.ts
    readinessRules.ts
  fixtures/
    validBlueprint.ts
    validCompileJob.ts
    invalidBlueprint.ts

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

Runtime Zod schemas validate the shared contracts for compile jobs, blueprints,
signal summaries, risk summaries, and readiness scores. Fixtures are validated
with `npm run validate:fixtures`.

## Current Compile Flow

The compile endpoint is synchronous and rule-only:

```text
POST /api/compile
  -> read process input
  -> validate request mode
  -> scanSignals(input)
  -> scanRisks(signals)
  -> scoreReadiness(signals, risks)
  -> buildBlueprint({ jobId, processInput, signals, risks, readiness })
  -> validate compile job with Zod
  -> return safe non-executing preview
  -> report zero provider calls
```

The blueprint builder is deterministic and rule-based for now. It uses detected
workflow primitives, risk categories, missing critical information, and readiness
score to generate:

- workflow name and summary
- workflow steps
- safe, approval, not-recommended, and blocked safety buckets
- risk items
- human approval gates
- dry-run test cases
- assumptions and open questions

The response demonstrates the current safety posture:

- classification, extraction, risk detection, and internal routing can be automated when appropriate
- drafting is safe as draft-only output
- external communication needs human approval
- sensitive or high-stakes decisions need human approval
- real-world execution is blocked in the MVP

## Future Compiler Architecture

Future milestones can evolve the rule-only endpoint into a richer compiler flow:

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
    readinessScorer.ts
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

No provider is used through Milestone 5.

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
