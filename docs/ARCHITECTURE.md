# FlowForge Architecture

## Current Architecture

FlowForge is currently a Nuxt-only application with deterministic compiler
services plus a constrained Router Agent for the first AI decision point.

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
  -> routeCompileRequest(input, signals, risks, readiness, mode)
  -> buildBlueprint(...)
  -> validate compile job with Zod
  -> safe non-executing preview
```

The current compile endpoint introduces the first constrained AI decision point via the Router Agent, but the blueprint building itself is still deterministic and rule-based. It does not execute workflows.

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
    routerAgent.ts
    schemaValidator.ts
    signalScanner.ts
    groqProvider.ts
    geminiProvider.ts
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

The compile endpoint is synchronous. It may use an AI provider only for the Router Agent in `balanced` and `full` modes; scanner output, readiness scoring, blueprint building, and schema validation remain deterministic:

```text
POST /api/compile
  -> read process input
  -> validate request mode
  -> scanSignals(input)
  -> scanRisks(signals)
  -> scoreReadiness(signals, risks)
  -> routeCompileRequest(input, signals, risks, readiness, mode)
  -> buildBlueprint({ jobId, processInput, signals, risks, readiness, mode })
  -> validate compile job with Zod
  -> return safe non-executing preview
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

## Compile UX Flow

The `/compiler` page adds a visible agent-run experience around the synchronous compile endpoint.

```text
Page opens
  -> frontend shows an idle ready state
  -> no compile request is sent
  -> no result is generated

User clicks Compile preview
  -> frontend starts a staged compile replay
  -> frontend sends one POST /api/compile request
  -> backend returns one CompileJob response
  -> frontend waits for both the response and staged replay
  -> frontend reveals the completed result
```

The staged progress replay is frontend-only UX. It is intentionally slower than a fast local API response so users can read each stage, but it does not slow the backend:

- prepare the local compile job
- scan process signals with deterministic rules
- review safety boundaries with deterministic rules
- route the request server-side
- choose Groq, Gemini fallback, or deterministic routing
- build the deterministic non-executing blueprint preview
- validate the compile job schema

There is no SSE, WebSocket, backend streaming, background job runner, or real-world execution in this milestone. The staged UI is a visual explanation of the compile pipeline, not proof that each backend step is streaming live.

When a previous result exists, the frontend keeps it visible, marks it as updating, and applies the new result only after the replay finishes. Technical trace remains collapsed by default.

The server response provides the real post-run summary:

- `router_decision` shows route, confidence, provider, AI usage, and fallback usage
- `token_usage` shows LLM calls used and the mode-specific limit
- `agent_trace` shows provider attempts, skipped calls, failures, and fallback behavior
- `steps` summarizes deterministic pipeline steps

The visible AI router explanation uses that response to show:

- AI is used only for the server-side router decision in `balanced` and `full` modes
- Groq is the primary router provider
- Gemini is the fallback router provider
- deterministic fallback always exists
- missing provider keys are skipped, not counted as LLM calls
- actual configured provider calls are counted whether they succeed, fail, return invalid JSON, or fail schema validation
- the blueprint builder remains deterministic after the router decision
- the staged UI progress is not real execution

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

Only the Router Agent can use AI today. Groq is the primary provider for the Router Agent. Gemini is the fallback provider. If both fail, return invalid output, or are missing, a deterministic fallback ensures the compilation completes.

Provider accounting:

- missing `GROQ_API_KEY` or `GEMINI_API_KEY` is recorded as a skipped provider attempt
- missing keys do not increment `llm_calls_made`
- actual provider HTTP calls increment `llm_calls_made` immediately before the request
- failed provider HTTP calls still count as LLM call attempts
- invalid JSON or schema validation failures from a configured provider still count as LLM call attempts
- deterministic fallback keeps `/api/compile` successful when provider routing cannot be used

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
