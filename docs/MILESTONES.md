# FlowForge Milestones

## Current Milestone Note

M6 is complete. FlowForge now shows the dynamic blueprint output visibly in the
compiler UI, including trigger details, ordered steps, safety policies, risks,
approval gates, dry-run cases, assumptions, and open questions. The generated
preview remains deterministic, non-executing, and human-gated.

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

## M7 - Workflow Architect

Goal: generate a structured safe automation blueprint.

Deliverables:

- architect prompt
- blueprint generation service
- schema validation after generation
- error handling

Acceptance criteria:

- clear input can produce a valid blueprint
- vague input does not force a full blueprint
- output includes boundary, steps, risks, gates, assumptions, and open questions

## M8 - Blueprint Repair Loop

Goal: repair invalid structured outputs once before failing clearly.

Deliverables:

- repair prompt or deterministic repair function
- retry logic
- max retry guard
- validation error display

Acceptance criteria:

- malformed output can be repaired when possible
- repair attempts appear in the agent trace
- unrepaired failures are visible and understandable

## M9 - Safety Critic And Approval Gates

Goal: review unsafe automation boundaries and generate explicit gates.

Deliverables:

- safety critic
- approval gate generator
- risk-to-gate rules
- UI for safe, approval, not-recommended, and blocked steps

Acceptance criteria:

- external send actions require review
- sensitive topics require approval
- unsafe automation boundaries are clearly explained
- gates include review checklists

## M10 - Dry Runs And Exports

Goal: create test cases and exportable implementation plans.

Deliverables:

- dry-run generator
- human-readable export
- custom JSON export
- n8n-style outline
- implementation prompt export

Acceptance criteria:

- dry runs cover normal, edge, and risky cases
- exports are clearly marked as non-executing plans
- no direct n8n import is required yet

## M11 - Agent Trace And Token Budget UI

Goal: make the compiler process observable.

Deliverables:

- detailed trace panel
- provider call budget display
- skipped/fallback call display
- error and retry states

Acceptance criteria:

- users can see what ran, what skipped, and why
- provider limits are visible
- failures remain understandable

## M12 - Demo Mode And Polish

Goal: make the local demo reliable and presentation-ready.

Deliverables:

- curated presets
- polished empty, loading, error, and result states
- demo-safe fallback data
- final documentation pass

Acceptance criteria:

- demo works without external credentials
- risky examples show human gates
- no automatic real-world execution is possible
