# FlowForge

FlowForge is a safe AI automation blueprint compiler.

It turns messy process descriptions into structured, validated, human-gated
automation blueprints.

```text
Messy process in. Safe automation blueprint out.
```

FlowForge does not blindly automate every request. It finds the safest useful
automation boundary: what can be automated, what needs human approval, what is
not recommended, what needs clarification, and what must not execute
automatically.

## Current Status

This repository has completed Milestone 10: Clarification Flow.

Implemented so far:

- Nuxt 4, Vue 3, and TypeScript scaffold
- Lucide Vue icons from `lucide-vue-next`
- Tile-based UI prototype at `/compiler`
- Progressive disclosure UI for complex blueprints
- Shared TypeScript types for workflow blueprints, compile jobs, clarification plans, and agent trace events
- Zod schema validation for blueprints, compile jobs, clarification plans, scanner output, and readiness scores
- Fixture validation through `npm run validate:fixtures`
- Rule-based signal scanning with workflow primitive detection
- Risk scanning for sensitive automation categories
- Readiness scoring with explainable strengths and weaknesses
- Deterministic dynamic blueprint building from input, signals, risks, and readiness
- Router Agent for evaluating safety and deciding compilation routes via Groq with Gemini fallback
- Deterministic clarification planner for weak, vague, or low-readiness process input
- `clarification_plan` compile output with missing fields, concrete questions, suggested rewrite template, and improved prompt starter
- Manual compile start in `/compiler`; the page does not auto-run on load
- Blank input guard so empty process text cannot call the compile API
- Curated example set for low-risk, human-gated, high-stakes, unsafe, and unclear workflows
- Visible compile progress with a readable staged frontend agent-run replay
- Workflow-first compiler UI with an outcome hero, visual workflow map, compact safety summary, and recommended next step
- Clarification-first UI state for weak input, including missing detail chips, questions with why-it-matters copy, suggested template, and `Use starter` action
- Provisional workflow map labeling when clarification is needed
- Cognitive-load reduction through collapsed detail sections for router, risk, trigger, dry-run, implementation, and technical trace details
- Transparent AI router explanation covering actual submitted input, primitives, risk categories, readiness, route, provider path, and deterministic boundary, collapsed under "How FlowForge decided"
- Provider path display for Groq, Gemini fallback, and deterministic fallback
- Deterministic fallback routing when provider keys are missing or provider calls fail
- Expandable full text for long process, trigger, dry-run, router, clarification, and trace text
- Product, architecture, milestone, demo, and Codex workflow documentation

This milestone intentionally does not include:

- Generating full blueprints with AI; AI is currently used only for router decisions in `balanced` and `full` modes
- AI-generated clarification questions; M10 clarification planning is deterministic
- Persistent storage
- Authentication
- n8n import or export
- Real workflow execution
- Background jobs
- Backend streaming
- Deployment configuration

Blueprint generation remains deterministic. Clarification planning remains deterministic. Groq is the primary router provider, Gemini is the fallback router provider, and deterministic fallback always exists. AI only chooses the constrained router decision in `balanced` and `full` modes. The visible compile replay is frontend-only; the backend still returns one compile response and does not stream progress. The workflow map is a non-executing preview, not a live workflow or n8n export.

## Safety Boundary

The dynamic blueprint preview demonstrates the core FlowForge rule:

- Classification can be automated.
- Drafting can be automated as draft-only output.
- External communication needs human approval.
- Sensitive or high-stakes decisions need human approval.
- Weak input needs clarification before a reliable blueprint should be trusted.
- Real-world execution should not happen automatically in the MVP.

High-risk categories include financial, legal, medical, visa or immigration,
employment, refunds, payments, account access, destructive actions, and any
external communication that affects real people.

## Clarification Flow

M10 adds a clarification-first path for vague or low-readiness input.

When the user enters something like:

```text
Automate my customer messages.
```

or:

```text
do stuff
```

FlowForge should not pretend it has enough information. Instead, the compile output includes a deterministic `clarification_plan` with:

- whether clarification is needed
- why it is needed
- missing fields such as trigger, data source, input data, output, human owner, approval boundary, or external action boundary
- concrete questions to answer before recompiling
- why each question matters
- a suggested rewrite template
- an improved prompt starter

The `/compiler` UI shows this as a clarification-first state. The workflow map remains visible but is labeled as a provisional safe outline. The user can click `Use starter` to replace the input with a clearer deterministic starter, edit it, and manually run `Compile preview` again.

Clarification questions are separate from implementation open questions:

- `clarification_plan.questions` are questions to answer before recompiling weak input.
- `result.open_questions` are questions to review before implementing a sufficiently clear blueprint.

## Tech Stack

- Nuxt 4
- Vue 3
- TypeScript
- Nuxt server routes
- Zod
- Lucide Vue icons
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

Call the compile API:

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"When a customer asks for a refund, classify the request and draft a reply for human review.","mode":"demo"}'
```

## Router, Clarification, And Compile UX Testing

Test the compiler UI and `/api/compile` across these routing paths:

- empty input: compile button disabled, helper copy asks for a process or example, and no API request is sent
- Internal intake example: workflow map is the main output, low-risk internal preview, no approval gates expected, deterministic blueprint generation, no large clarification card
- Refund review example: workflow map shows human approval before refund/message, no automatic refund or send, not treated as unclear if enough details are present
- Visa guidance example: workflow map shows advisor or human review, high-stakes review path, no automatic reply
- Unsafe auto-send example: unsafe execution blocked or redirected into a safer outline, no automatic send/account update, external action boundary remains visible
- Unclear request example: clarification-needed hero, missing fields, concrete questions, suggested template, improved starter, and provisional workflow outline
- Very weak input such as `do stuff`: clarification needed, no confident blueprint language, asks for trigger, data source, output, owner, approval boundary, and success criteria
- Use starter: replaces the process input with the improved starter, clears guard copy, and does not auto-compile
- demo mode: AI router skipped, deterministic routing, deterministic blueprint builder, deterministic clarification planner, `0 / 0` LLM calls
- balanced/full with Groq available: Groq handles the router decision, blueprint generation remains deterministic
- balanced/full with Groq failing and Gemini available: Gemini handles fallback routing, blueprint generation remains deterministic
- balanced/full with missing provider keys: Groq and Gemini are skipped, deterministic fallback keeps compile successful
- balanced/full with failed configured providers: failed HTTP attempts count as LLM calls, deterministic fallback keeps compile successful

The `/compiler` page should open in an idle ready state with no automatic API request. After choosing an example or pasting input and clicking `Compile preview`, it should show a staged compile replay even when the API responds quickly. The previous result remains visible and marked as updating until the staged replay finishes. After completion, the compile run becomes compact, the workflow map appears above router and technical details, and the recommended next step stays near the top.

When clarification is needed, the clarification card should appear above the workflow map. It should show missing details, questions to answer before recompiling, a rewrite template, an improved starter, and a `Use starter` action. The workflow map should be labeled as a provisional safe outline. The AI router explanation should remain available under "How FlowForge decided" and show actual submitted input, primitive names, risk categories, readiness score, router output, LLM calls, and Groq/Gemini/deterministic provider path. Long process, trigger, dry-run, router, clarification, and trace text should expose a `Show full` option when collapsed.

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
      clarificationPlanner.ts
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
Milestone 11 - Safety Critic Agent
```

Persistence, authentication, n8n export, and real workflow execution remain future work.