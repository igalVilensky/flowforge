# FlowForge Milestones

## Current Milestone Note

M9 is complete. FlowForge is polished for course demos with blank-input handling, stronger example coverage, workflow-first result hierarchy, Lucide icons, a visual workflow map, collapsed router transparency, visible provider path explanation, and clearer decision copy. The backend still returns one compile response; no streaming, real-world execution, database, auth, or n8n export has been added.

## M0 - Project Setup And Documentation - Complete

Status: complete.

Goal: prepare the repository for safe, incremental implementation.

Deliverables:

- README
- project docs
- shared TypeScript types
- landing page at `/`
- compiler preview page at `/compiler`
- placeholder `POST /api/compile`

Acceptance criteria:

- `npm install` succeeds
- `npm run dev` starts the app
- `/` loads
- `/compiler` loads
- `/api/compile` returns a placeholder compile job
- no real provider calls, database, auth, n8n export, or execution

## M1 - Static Prototype

Status: complete.

Goal: build the compiler UI with fake data.

Deliverables:

- process input panel
- preset selector
- visible pipeline timeline
- token budget panel
- signal summary
- router decision
- automation boundary
- blueprint viewer
- risk map
- approval gates
- dry-run preview
- export prompt preview

Acceptance criteria:

- user can choose a preset or edit input
- fake pipeline and result display clearly
- no backend work is required beyond the M0 placeholder
- no LLM is required

## M2 - Shared Schemas And Fixtures

Status: complete.

Goal: add runtime validation to the shared contracts.

Deliverables:

- schema definitions
- sample valid blueprint fixture
- sample invalid blueprint fixture
- schema tests

Acceptance criteria:

- valid fixture passes
- invalid fixture fails
- schema names match shared TypeScript types
- schemas can be used by frontend and backend

## M3 - Rule-Based Signal Scanner

Status: complete.

Goal: implement deterministic signal scanning.

Deliverables:

- signal scanner service
- primitive detection rules
- missing information detection
- rough action detection
- unit tests

Acceptance criteria:

- detects trigger, repeated process, rough actions, and primitives
- detects missing critical information
- does not call any LLM

## M4 - Risk Scanner And Readiness Score

Status: complete.

Goal: detect sensitive automation risk and calculate an explainable readiness
score.

Deliverables:

- risk scanner service
- readiness score service
- risk rules
- readiness rules
- tests

Acceptance criteria:

- detects external communication, payments, refunds, legal, medical, visa,
  employment, account, personal data, and destructive-action risks
- returns score and reasons
- does not call any LLM

## M5 - Dynamic Blueprint Builder

Status: complete.

Goal: replace the static blueprint preview with a deterministic builder that
uses scanner output.

Deliverables:

- reusable `blueprintBuilder` service
- dynamic workflow name and summary
- dynamic workflow steps based on detected primitives
- dynamic safety buckets, risk items, approval gates, and dry-run test cases
- compile API integration with Zod validation

Acceptance criteria:

- `/api/compile` calls `scanSignals`, `scanRisks`, `scoreReadiness`, and `buildBlueprint`
- blueprint output changes based on detected primitives and risk categories
- fixture validation passes
- typecheck passes
- no AI provider, database, auth, n8n export, or real execution is added

## M6 - Visible Blueprint Output

Status: complete.

Goal: make the generated blueprint visible and understandable in `/compiler`.

Deliverables:

- visible compiled workflow section
- trigger and automation boundary display
- ordered workflow step plan with safety policy labels
- user-facing risk cards
- visible approval gates with review checklists
- visible dry-run test cases
- assumptions and open questions section
- technical details kept secondary

Acceptance criteria:

- workflow name, summary, trigger, and boundary are visible after compile
- generated steps show primitive, actor, automation policy, risk, approval, and execution policy
- risks, gates, dry runs, assumptions, and open questions are visible outside technical details
- different inputs visibly change the rendered blueprint
- no API fields, schemas, providers, persistence, n8n export, or real execution are added

## M7 - Router Agent And Fallbacks

Status: complete.

Goal: Add the first constrained AI decision point to FlowForge to decide what route the compiler should take, without generating the full blueprint with AI yet.

Deliverables:

- Router decision schema
- Router agent service
- Groq provider wrapper (primary)
- Gemini provider wrapper (fallback)
- Deterministic fallback logic
- UI integration to display router decision

Acceptance criteria:

- `demo` and `rule_only` modes make zero AI calls
- `balanced` and `full` modes try Groq first, then Gemini, then deterministic fallback
- Invalid provider output falls back safely
- Compile endpoint still returns valid `CompileJob`
- Router decision appears in UI compactly
- No real execution or blueprint generation with AI added yet

## M8 - Visible Agent Run / Compile Progress UX

Status: complete.

Goal: make the compile process feel like a visible agent run while keeping the backend synchronous and safe.

Deliverables:

- no automatic compile on page load
- compile starts only after the user clicks `Compile preview`
- compile run panel near the top of `/compiler`
- frontend-only staged replay for prepare, signal scan, safety review, routing, provider decision, blueprint build, and schema validation
- readable stage timing for fast responses, around 7 to 10 seconds total
- previous result remains visible and marked as updating while a new compile replay runs
- visible AI router explanation without opening Technical trace
- provider path explanation for Groq, Gemini fallback, skipped AI, and deterministic fallback
- readable router labels for route, provider, and confidence
- expandable full-text behavior for long process, trigger, dry-run, router, and trace text
- deterministic blueprint generation clearly labeled
- no backend streaming added
- no real execution added

Acceptance criteria:

- [x] Page does not auto-compile on load
- [x] Compile run appears immediately after click
- [x] Stages remain visible long enough to read
- [x] Previous result is marked as updating
- [x] AI/router explanation is visible without Technical trace
- [x] Groq/Gemini/deterministic provider path is understandable
- [x] Truncated long text has Show full behavior
- [x] Blueprint generation is labeled deterministic
- [x] Typecheck passes
- [x] Fixture validation passes

## M9 - Demo Polish & Router Transparency

Status: complete.

Goal: make the compiler page presentation-ready by improving blank-input handling, example coverage, router transparency, provider-path explanation, top-level decision copy, workflow-first result hierarchy, and milestone docs.

Deliverables:

- blank input guard
- improved demo examples
- transparent router inputs
- explainable router output
- provider path display
- clearer top-level decision copy
- full-text expansion cleanup
- milestone numbering cleanup
- Lucide icon system
- workflow-first result hierarchy
- visual workflow map
- recommended next step card
- collapsed "How FlowForge decided"
- compact compile run after completion
- improved outcome hero
- reduced visible clutter
- clarification-needed visual hierarchy

Acceptance criteria:

- [x] Empty input cannot call compile API
- [x] Examples cover low-risk, human-gated, high-stakes, unsafe, and unclear workflows
- [x] Router inputs show actual submitted process, primitive names, risk categories, readiness score, and mode
- [x] Router output explains route, confidence, reason, safety note, next step, provider, AI usage, fallback usage, and LLM calls
- [x] Provider path is visible without Technical trace
- [x] Long text has Show full behavior
- [x] Milestone numbering has no duplicate M12
- [x] Lucide icons installed and used in compiler UI
- [x] Workflow map appears above router/technical details
- [x] Workflow map visually shows steps, connectors, risk, gates, and no execution
- [x] Recommended next step is visible near the top
- [x] AI/router explanation is collapsed by default
- [x] Compile run is compact after completion
- [x] Needs clarification state is visually distinct
- [x] Typecheck passes
- [x] Fixture validation passes

## M10 - Clarification Flow

Status: complete.

Goal: turn unclear or low-readiness compiler input into a guided clarification loop before implementation.

This milestone makes weak input a first-class product state instead of treating it like a failed or normal blueprint. When the user gives vague, incomplete, or unsafe process text, FlowForge now explains what is missing, asks concrete questions, suggests a safer rewrite template, and lets the user improve the input before recompiling.

Deliverables:

* deterministic `clarificationPlanner` service
* `clarification_plan` field on `CompileJob`
* Zod validation for clarification fields, questions, and plans
* compile API integration after router decision
* clarification planner pipeline step
* clarification planner trace event
* fixture update for valid compile job validation
* clarification-first UI state for weak input
* missing-field display
* concrete clarification questions with why-it-matters copy
* suggested rewrite template
* improved prompt starter
* `Use starter` action that replaces the input without auto-compiling
* `Copy` action for the improved starter
* provisional workflow labeling when clarification is needed
* separation between clarification questions and implementation open questions
* docs updated

Acceptance criteria:

* [x] Weak input produces clarification-first UI
* [x] Clarification plan includes missing fields and concrete questions
* [x] User can apply an improved starter to the input
* [x] Applying the starter does not auto-compile
* [x] Workflow map is labeled provisional when clarification is needed
* [x] Good input does not show unnecessary clarification UI
* [x] Clarification questions are separate from implementation open questions
* [x] Compile output validates with `clarification_plan`
* [x] Fixture validation passes
* [x] Typecheck passes

Manual validation cases:

* `Automate my customer messages.` shows clarification-first UI, missing fields, questions, suggested template, improved starter, and provisional safe outline.
* `do stuff` shows clarification needed and does not present a confident final blueprint.
* Job-application intake example stays clean and does not show the large clarification card.
* Refund review example stays human-gated and is not treated as unclear when enough details are present.
* Unsafe auto-send/update-account input keeps external action boundaries safe and does not imply automatic execution.

## M11 - Safety Critic Agent

Goal: add a dedicated safety critic that reviews automation boundaries and explains unsafe or gated paths.

Deliverables:

- safety critic agent
- risk-to-boundary explanations
- critic trace entries
- UI copy for safe, gated, redirected, and blocked decisions

Acceptance criteria:

- external send actions require review
- sensitive topics require approval
- unsafe automation boundaries are clearly explained
- critic output remains non-executing

## M12 - Security & Privacy Agent

Goal: review data access, secrets, credentials, retention, and privacy boundaries before implementation.

Deliverables:

- security and privacy agent
- data-source and permission checks
- secret/API-key warnings
- retention and minimization recommendations

Acceptance criteria:

- personal data and account access require explicit scope
- provider prompts avoid secrets and raw credentials
- privacy risks are visible before implementation
- no database/auth or production integrations are added

## M13 - Human Gate Planner

Goal: generate clearer human approval gates, review checklists, owners, and escalation paths.

Deliverables:

- human gate planner
- gate owner suggestions
- review checklist generation
- UI for gate rationale and next human action

Acceptance criteria:

- risky actions map to explicit gates
- gates include concrete review checklists
- low-risk internal previews avoid unnecessary approval language
- no real execution is added

## M14 - Dry Run Test Agent

Goal: generate stronger dry-run scenarios for safe, risky, edge, and unclear workflows.

Deliverables:

- dry-run test agent
- normal, edge, and failure case generation
- expected route and gate assertions
- UI for dry-run review

Acceptance criteria:

- dry runs cover normal, edge, and risky cases
- unsafe examples include blocked or gated expectations
- unclear workflows include clarification expectations
- dry runs remain non-executing

## M15 - Implementation Prompt Export

Goal: export reviewed implementation prompts and plans without creating live integrations.

Deliverables:

- human-readable implementation prompt export
- structured JSON plan export
- safety boundary recap in exports
- explicit non-execution labels

Acceptance criteria:

- exports are clearly marked as plans
- exports include gates, assumptions, and open questions
- no direct n8n import/export is required yet
- no production credentials or execution paths are added

## M16 - Final Demo Polish

Goal: make the local demo reliable, polished, and ready for final presentation.

Deliverables:

- curated demo presets
- polished empty, loading, error, and result states
- demo-safe fallback behavior
- final documentation pass

Acceptance criteria:

- demo works without external credentials
- risky examples show human gates
- no automatic real-world execution is possible
- docs match the final demo flow
