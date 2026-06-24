# FlowForge Milestones

FlowForge is a non-executing automation compiler. It turns a plain-language process into a safe preview blueprint with deterministic scanners, explicit safety boundaries, human approval gates, dry-run examples, and an inspectable agent trace.

## Status summary

Current milestone: **M12 — Guided Clarification + Focused Compiler UX**  
Status: **implemented / ready for validation**

M12 moves FlowForge from a report-style compiler screen to a guided workflow experience. The main screen now shows only the user-relevant outcome: a workflow blueprint, one clarification question, or a blocked/not-safe verdict. Advanced safety, trace, provider, and risk details are hidden behind optional inspection panels.

M12 also introduces a dedicated **Clarification Conversation Agent**. Instead of only rewriting hardcoded missing-field questions, the agent reads messy user input, tracks known facts, asks one contextual question at a time, and returns a rewritten compile prompt when enough information has been collected.

---

## M0 — Project setup and docs

Goal: Create the project structure, documentation, and initial shared planning files.

Deliverables:

- Nuxt app initialized
- Docs folder created
- Project brief written
- Requirements written
- Initial architecture notes written
- README created

Acceptance criteria:

- App can be installed and run locally
- README explains what FlowForge is
- Docs explain scope and MVP limits
- Basic `/compiler` route exists

Status: completed

---

## M1 — Static compiler prototype

Goal: Build the first compiler UI using static or fake data.

Deliverables:

- Process input area
- Example process presets
- Compile/result layout
- Pipeline preview
- Blueprint preview cards
- Risk and approval preview sections

Acceptance criteria:

- User can select or type a process
- UI communicates the product idea clearly
- No backend or LLM is required for the prototype

Status: completed

---

## M2 — Shared types and schema foundation

Goal: Define the contract for compile jobs, blueprint data, risks, gates, dry runs, router decisions, clarification plans, and trace events.

Deliverables:

- Shared TypeScript types
- Compile job schema
- Fixture validation path
- Server/client-safe data model

Acceptance criteria:

- Shared types can be used by API and UI
- Valid fixture shape is documented
- Invalid results can be rejected before UI rendering

Status: completed

---

## M3 — Rule-based signal scanner

Goal: Detect process structure with deterministic rules.

Deliverables:

- `signalScanner`
- Primitive detection
- Trigger detection
- Output detection
- Human/system actor detection
- Missing critical information summary

Acceptance criteria:

- Detects triggers like scheduled or event-based workflows
- Detects primitives such as classification, extraction, routing, drafting, approval, record creation, and notification
- Detects whether an input is too vague
- Uses no LLM call

Status: completed

---

## M4 — Risk scanner and readiness score

Goal: Detect sensitive automation risks and calculate an explainable readiness score.

Deliverables:

- `riskScanner`
- `readinessScorer`
- Risk categories
- Review requirement summary
- Readiness reasons and weaknesses

Acceptance criteria:

- Detects external communication
- Detects refund/payment, financial, visa, legal, medical, account, employment, personal data, destructive action, and real-world execution risks
- Produces low/medium/high risk
- Produces an explainable readiness score

Status: completed

---

## M5 — Compile API with deterministic preview

Goal: Connect the frontend to a backend compile endpoint and return a real non-executing preview.

Deliverables:

- `POST /api/compile`
- Request validation
- Rule-based signal scan integration
- Risk scan integration
- Readiness score integration
- Initial deterministic blueprint output

Acceptance criteria:

- User input produces a backend result
- The compiler does not execute any real-world actions
- The UI can render returned workflow, risks, gates, dry runs, and trace data
- No LLM is required

Status: completed

---

## M6 — Router Agent

Goal: Add the first AI-assisted decision point while keeping the blueprint deterministic.

Deliverables:

- Router service
- Router schema
- Provider attempt tracking
- Groq/Gemini/fallback support
- Deterministic fallback route

Acceptance criteria:

- Router returns strict JSON
- Router can choose compile, clarify, safer workflow, assistant-only, or reject routes
- Provider attempts are shown in the UI
- Blueprint generation remains deterministic
- Safety is not delegated to the LLM

Status: completed

---

## M7 — Dynamic safe blueprint builder

Goal: Generate a structured safe automation blueprint from deterministic scanner output.

Deliverables:

- `blueprintBuilder`
- Workflow name/category selection
- Step generation
- Automation policy labels
- Human approval gates
- Automation boundary
- Safe-to-automate, draft-only, approval, not-recommended, and not-safe lists
- Dry-run cases
- Open questions and assumptions

Acceptance criteria:

- Clear inputs generate useful safe blueprints
- Vague inputs do not become fake production workflows
- High-risk inputs become safe alternatives or blocked previews
- No production action is executed

Status: completed

---

## M8 — Validation and fixture safety

Goal: Keep backend results schema-safe and fixture-validated.

Deliverables:

- Compile job Zod schema
- Schema validator service
- Valid compile fixture
- Typecheck path
- Fixture validation command

Acceptance criteria:

- Compile API validates the final job before returning it
- Fixture validation catches schema drift
- Typecheck passes after schema/type changes
- UI receives predictable data

Status: completed

---

## M9 — Dry runs, boundaries, and exports

Goal: Make the preview testable and reviewable.

Deliverables:

- Dry-run scenarios
- Normal and edge-case tests
- Safe alternative paths
- Implementation boundary notes
- Copyable outputs or export-ready sections

Acceptance criteria:

- Every blueprint includes dry-run checks
- Risky workflows include safe alternatives
- Exported or copied output is clearly non-executing
- MVP does not claim working n8n import/export execution

Status: completed

---

## M10 — Clarification Flow

Goal: Stop vague or underspecified requests from becoming misleading blueprints.

Deliverables:

- `clarificationPlanner`
- Missing field detection
- Clarification questions
- Suggested improved starter prompt
- UI state for “Need details before flow”
- Replace-input and copy-starter actions

Acceptance criteria:

- Vague input shows clarification as the main result
- Clarified input proceeds to flow preview
- Unsafe high-stakes input is not softened into clarification when it should be blocked
- AI router false positives do not override deterministic clarification state
- Clarification UI is details-first and does not pretend to be an implementation-ready workflow

Status: completed

Validated examples:

- `Automate my customer messages.` → needs clarification
- Specific support inbox + support team lead + review-before-send workflow → needs human approval, not clarification
- Visa/payment/account auto-send workflow → not safe to automate, not clarification

Known limitation addressed later in M12:

- Questions were based on deterministic missing-field templates.
- For very vague input, questions could feel generic or unrelated.
- The UI could show too many questions/details at once.

---

## M11 — Safety Critic Agent

Goal: Add a Safety Critic review layer that evaluates the final blueprint and explains what is safe, gated, draft-only, or blocked.

Deliverables:

- `SafetyCriticSeverity`, `SafetyCriticFindingType`, `SafetyCriticFinding`, and `SafetyCriticReview` types
- `safety_critic?: SafetyCriticReview` on `CompileJob`
- Safety Critic Zod schema
- `server/services/safetyCritic.ts`
- Compile API integration after blueprint generation
- Pipeline step: `safety_critic_review`
- Agent trace event: `trace_safety_critic`
- Fixture update
- Compiler UI Safety Critic panel
- Main result driven by Safety Critic status

Acceptance criteria:

- Safety Critic evaluates the final blueprint after `buildBlueprint`
- Safe internal workflows return `safe_internal_preview`
- External reply/draft workflows return `needs_human_approval`
- Refund/payment workflows require human approval instead of becoming blanket blockers
- Medical, visa/immigration, account access, legal, and destructive/delete workflows return `not_safe_to_automate`
- Vague workflows return `needs_clarification`
- AI router false positives do not override Safety Critic status
- UI shows the correct main state:
  - Safe internal flow
  - Flow needs human gates
  - Need details before flow
  - Do not automate
- Details remain hidden until requested
- No workflow executes real-world actions

Status: completed

Validated examples:

- Internal admissions email triage → safe internal preview
- Customer support draft reply with support lead review → needs human approval
- Refund/payment review routed to finance → needs human approval
- Vague customer messages request → needs clarification
- Visa/payment/account auto-send request → not safe to automate
- Medical diagnosis/advice/profile update request → not safe to automate
- Account deletion/subscription cancellation/email request → not safe to automate
- Balanced and Full modes preserve deterministic Safety Critic outcomes

---

## M12 — Guided Clarification + Focused Compiler UX

Goal: Make FlowForge feel like a guided AI automation planner instead of a dense technical report.

Deliverables:

- `shared/types/clarificationSession.ts`
- `server/schemas/clarificationSession.schema.ts`
- `server/prompts/clarificationConversationPrompt.ts`
- `server/services/clarificationConversationAgent.ts`
- `server/api/clarify.post.ts`
- focused `app/pages/compiler.vue` flow
- one-question-at-a-time clarification UI
- compile-again flow using `rewritten_compile_prompt`
- workflow-first blueprint result screen
- blocked-result screen focused on verdict + next safe move
- advanced details hidden behind optional panels
- hard stop for clarification loops
- repeated-question guard

Acceptance criteria:

- Vague input starts a guided clarification session instead of showing hardcoded missing-field questions.
- The clarification agent asks one contextual question at a time.
- `Automate my tasks.` asks about task category first, not data source.
- Clarification stops once enough core facts are collected.
- Clarification does not exceed a small maximum question count.
- Repeated questions force compile-readiness with best available facts.
- When `ready_to_compile=true`, the UI compiles using `rewritten_compile_prompt`.
- If the workflow is possible, the first result view shows the workflow blueprint, not risk/report details.
- If the workflow is unclear, the first result view shows only the next clarification question.
- If the workflow is not safe, the first result view shows only the verdict and next safe move.
- Diagnostics, risk details, provider path, trace, and Safety Critic details remain available but hidden by default.

Status: implemented / ready for validation

Validated today:

- `Automate my tasks.` no longer goes directly to the old hardcoded data-source question.
- Guided clarification asks contextual questions.
- Clarification loop issue was found after long support-ticket session and fixed with:
  - max clarification questions
  - readiness inference
  - repeated-question detection
  - deterministic compile-ready fallback

Known validation still needed:

- Run `npm run typecheck`
- Run `npm run validate:fixtures`
- Test `/api/clarify` with provider keys and without provider keys
- Test focused compiler UI with:
  - vague input
  - clear safe internal workflow
  - human-gated support workflow
  - high-stakes blocked workflow

---

## M13 — Final demo polish

Goal: Prepare final demo and submission package after M12 validation.

Deliverables:

- Final demo script
- README walkthrough
- final screenshots or short screen recording
- final scenario list
- project submission notes
- final command validation

Acceptance criteria:

- Demo works without provider dependency for deterministic paths
- Guided clarification works with provider keys and fallback
- Workflow-first result view is clear in first glance
- Risky inputs clearly trigger safer workflow or blocked states
- Vague inputs are guided one question at a time
- The UI communicates “non-executing preview” throughout
- Final commands pass:
  - `npm run validate:fixtures`
  - `npm run typecheck`

Status: next