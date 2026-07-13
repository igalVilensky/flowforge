import type { AgentOutputMeta } from "./types/agentOutputs";
import type { CompileJob } from "./types/compileJob";
import type {
  N8nGenerationTrace,
  N8nGeneratorProviderAttempt,
  N8nWorkflow,
  N8nWorkflowProcessingTrace,
} from "./types/n8nWorkflow";

export type ExecutionJourneyStatus =
  | "completed"
  | "skipped"
  | "failed"
  | "fallback"
  | "repaired"
  | "validated";

export type ExecutionJourneyMethod =
  | "deterministic"
  | "openai"
  | "groq"
  | "gemini"
  | "validation"
  | "normalization"
  | "safety"
  | "mixed";

export type JourneyItem = {
  label: string;
  value: string;
};

export type ExecutionJourneyStep = {
  id: string;
  order: number;
  title: string;
  stage: string;
  status: ExecutionJourneyStatus;
  method: ExecutionJourneyMethod;
  function_names?: string[];
  purpose: string;
  input_summary: JourneyItem[];
  requirements?: string[];
  actions: string[];
  output_summary: JourneyItem[];
  field_explanations?: Array<{
    field: string;
    reason: string;
    used_by?: string;
  }>;
  next_step?: {
    title: string;
    reason: string;
  };
  limitations?: string[];
  raw_input?: unknown;
  raw_output?: unknown;
};

export type ExecutionJourneyN8nState = {
  state: "idle" | "generating" | "ready" | "failed";
  workflow?: N8nWorkflow | null;
  provider?: string;
  used_ai?: boolean;
  fallback_used?: boolean;
  provider_attempts?: N8nGeneratorProviderAttempt[];
  generation_trace?: N8nGenerationTrace | null;
  warnings?: string[];
  error?: string;
};

export type ExecutionJourneyGuidedClarification = {
  original_input: string;
  answers: Array<{ question: string; answer: string }>;
  provider?: string;
  used_ai?: boolean;
  fallback_used?: boolean;
  ready_to_compile?: boolean;
  reason?: string;
  rewritten_compile_prompt?: string;
  raw?: unknown;
};

function textList(values: readonly string[] | undefined, empty = "None detected") {
  return values?.length ? values.join(", ") : empty;
}

function yesNo(value: boolean | undefined) {
  return value ? "Yes" : "No";
}

function methodForAgent(output: AgentOutputMeta | undefined): ExecutionJourneyMethod {
  if (!output?.used_ai) return "deterministic";
  if (output.provider === "openai" || output.provider === "groq" || output.provider === "gemini") {
    return output.provider;
  }
  return "mixed";
}

function statusForAgent(output: AgentOutputMeta | undefined): ExecutionJourneyStatus {
  if (!output) return "skipped";
  if (output.status === "skipped") return "skipped";
  if (output.status === "failed_validation") return "failed";
  if (output.fallback_used) return "fallback";
  return "completed";
}

function providerAttemptActions(
  attempts: N8nGeneratorProviderAttempt[] | undefined,
) {
  return (attempts ?? []).map((attempt) => {
    if (!attempt.attempted) return `${attempt.provider} was not called: ${attempt.error_summary || "provider was not configured"}`;
    if (attempt.success) return `${attempt.provider} returned a workflow draft that passed FlowForge processing.`;
    if (attempt.validation_issues?.length) {
      return `${attempt.provider} returned a draft, but validation rejected it: ${attempt.validation_issues[0]?.message}`;
    }
    return `${attempt.provider} failed: ${attempt.error_summary || "unknown provider error"}`;
  });
}

function processingActions(processing: N8nWorkflowProcessingTrace) {
  const actions = [
    ...processing.normalization_actions.flatMap((action) => [
      action.description,
      ...(action.details ?? []),
    ]),
    ...processing.repair_actions.flatMap((action) => [
      action.description,
      ...(action.details ?? []),
    ]),
  ];

  return actions.length ? actions : ["The provider draft already matched the required safe workflow shape; no material repair was needed."];
}

function processingFunctions(processing: N8nWorkflowProcessingTrace) {
  return [...new Set([
    ...processing.normalization_actions.flatMap((action) => action.function_names),
    ...processing.repair_actions.flatMap((action) => action.function_names),
  ])];
}

function compileSteps(
  job: CompileJob,
  guided?: ExecutionJourneyGuidedClarification,
): ExecutionJourneyStep[] {
  const clarification = job.clarification_plan;
  const clarificationAgent = job.clarification_agent;
  const architect = job.blueprint_architect_agent;
  const critic = job.safety_critic_agent;
  const result = job.result;
  const router = job.router_decision;
  const hasStructuredNormalization = job.input.raw.trim() !== job.input.trimmed;
  const clarificationSkipped = clarification?.needed === false;
  const routerAttempts = job.agent_trace.filter((event) => event.id.startsWith("trace_router_") && event.id !== "trace_router_decision");
  const originalRequest = guided?.original_input || job.input.raw;

  return [
    {
      id: "submitted_request",
      order: 0,
      title: "User submitted scenario",
      stage: "request",
      status: "completed",
      method: "deterministic",
      function_names: ["normalizeCompileRequest()"],
      purpose: "Turns the submitted scenario into the canonical text used by the compiler while preserving the original request.",
      input_summary: [{ label: "Original request", value: originalRequest }],
      requirements: ["A non-empty scenario", "A supported compile mode"],
      actions: [
        guided
          ? `Collected ${guided.answers.length} guided clarification answer(s) before compilation.`
          : hasStructuredNormalization
          ? "Separated the structured workflow intent from clarification and safety context."
          : "Trimmed the scenario and preserved it as the compiler's semantic input.",
        `Selected ${job.mode} compile mode.`,
      ],
      output_summary: [
        { label: "Compiler input", value: job.input.trimmed },
        { label: "Compile mode", value: job.mode },
      ],
      field_explanations: [
        { field: "input.trimmed", reason: "This is the canonical scenario examined by every compile stage.", used_by: "Request analysis" },
        { field: "mode", reason: "This controls which AI agents may be attempted and the LLM-call budget.", used_by: "Router and compile agents" },
      ],
      next_step: guided
        ? { title: "Guided clarification", reason: "The initial scenario needed user-supplied facts before the compiler could analyze a complete request." }
        : { title: "Request analysis", reason: "The request must be scanned for workflow structure, risk, and readiness before routing." },
      limitations: ["Normalization does not decide the route or build workflow steps.", "It cannot recover facts that the user did not provide."],
      raw_input: originalRequest,
      raw_output: job.input,
    },
    ...(guided ? [{
      id: "guided_clarification",
      order: 0,
      title: "Guided clarification",
      stage: "pre_compile_clarification",
      status: guided.fallback_used ? "fallback" as const : "completed" as const,
      method: guided.used_ai && (guided.provider === "openai" || guided.provider === "groq" || guided.provider === "gemini")
        ? guided.provider
        : "deterministic" as const,
      function_names: ["runClarificationConversationAgent()"],
      purpose: "Collects missing facts conversationally and rewrites them into the complete scenario that enters the compiler.",
      input_summary: [
        { label: "Original request", value: guided.original_input },
        { label: "Answers collected", value: String(guided.answers.length) },
      ],
      requirements: ["An underspecified scenario", "User answers to focused clarification questions"],
      actions: [
        guided.reason || "Collected enough workflow facts to continue.",
        guided.used_ai
          ? `${guided.provider} updated the clarification session.`
          : "Deterministic clarification logic updated the session.",
        guided.ready_to_compile ? "The session reached compile readiness." : "The session had not yet reached compile readiness.",
      ],
      output_summary: [
        { label: "Ready to compile", value: yesNo(guided.ready_to_compile) },
        { label: "Provider", value: guided.provider || "deterministic" },
        { label: "Rewritten compiler input", value: guided.rewritten_compile_prompt || job.input.raw },
      ],
      field_explanations: [
        { field: "rewritten_compile_prompt", reason: "This preserves the original scenario plus collected facts as the canonical compile request.", used_by: "Request analysis" },
      ],
      next_step: { title: "Request analysis", reason: "The clarified scenario was complete enough to enter deterministic signal, risk, and readiness analysis." },
      limitations: ["The clarifier can organize user answers but cannot verify that they are factually correct.", "It does not build or approve the workflow."],
      raw_input: { original_input: guided.original_input, answers: guided.answers },
      raw_output: guided.raw,
    } satisfies ExecutionJourneyStep] : []),
    {
      id: "request_analysis",
      order: 0,
      title: "Request normalization and analysis",
      stage: "analysis",
      status: "completed",
      method: "deterministic",
      function_names: [
        "assessStructuredWorkflowIntentReadiness()",
        "scanSignals()",
        "scanRisks()",
        "scoreReadiness()",
      ],
      purpose: "Detects workflow primitives, missing details, safety risks, and whether the scenario is specific enough to design.",
      input_summary: [
        { label: "Scenario", value: job.input.trimmed },
        { label: "Mode", value: job.mode },
      ],
      requirements: ["Canonical scenario text", "Recognizable trigger, input, output, and safety signals where present"],
      actions: [
        job.signals.has_trigger ? "Detected a workflow trigger." : "No reliable workflow trigger was detected.",
        `Detected ${job.signals.workflow_primitives.length} workflow primitive(s): ${textList(job.signals.workflow_primitives)}.`,
        `Assigned ${job.risks.risk_level} risk; human review ${job.risks.requires_human_review ? "is" : "is not"} required.`,
        `Calculated readiness score ${job.readiness.score}.`,
      ],
      output_summary: [
        { label: "Trigger found", value: yesNo(job.signals.has_trigger) },
        { label: "Requested actions", value: textList(job.signals.rough_actions) },
        { label: "Workflow primitives", value: textList(job.signals.workflow_primitives) },
        { label: "Missing information", value: textList(job.signals.missing_critical_info) },
        { label: "Risk / readiness", value: `${job.risks.risk_level} / ${job.readiness.score}` },
      ],
      field_explanations: [
        ...(job.signals.workflow_primitives.length ? [{ field: "workflow_primitives", reason: "These determine which deterministic blueprint step patterns are eligible.", used_by: "Blueprint builder" }] : []),
        ...(job.risks.categories.length ? [{ field: "risk categories", reason: "These create approval gates and blocked or draft-only boundaries.", used_by: "Safety review" }] : []),
        { field: "readiness", reason: "This decides whether design agents can run or must wait for clarification.", used_by: "Clarification decision" },
      ],
      next_step: { title: "Router", reason: "Routing uses the detected signals, risks, and readiness rather than the raw request alone." },
      limitations: ["Signal matching is deterministic and may miss unusual wording.", "Risk detection identifies visible indicators; it is not a legal or policy approval."],
      raw_input: job.input,
      raw_output: { signals: job.signals, risks: job.risks, readiness: job.readiness },
    },
    {
      id: "router",
      order: 0,
      title: "Router",
      stage: "routing",
      status: router?.fallback_used ? "fallback" : "completed",
      method: router?.used_ai && (router.provider === "groq" || router.provider === "gemini") ? router.provider : "deterministic",
      function_names: ["routeCompileRequest()"],
      purpose: "Chooses whether to compile, clarify, suggest a safer workflow, provide assistance only, or reject the request.",
      input_summary: [
        { label: "Readiness", value: String(job.readiness.score) },
        { label: "Risk", value: job.risks.risk_level },
        { label: "Missing information", value: textList(job.signals.missing_critical_info) },
      ],
      requirements: ["Analyzed workflow signals", "Risk summary", "Readiness score"],
      actions: [
        ...routerAttempts.map((attempt) => `${attempt.action}: ${attempt.status}${attempt.reason ? ` — ${attempt.reason}` : ""}.`),
        router?.reason || "No router decision details were recorded.",
        ...(router?.safety_note ? [router.safety_note] : []),
      ],
      output_summary: [
        { label: "Route", value: router?.route ?? "not recorded" },
        { label: "Confidence", value: router?.confidence ?? "not recorded" },
        { label: "Provider", value: router?.provider ?? "deterministic" },
        { label: "Suggested next step", value: router?.suggested_next_step ?? "Continue with deterministic checks" },
      ],
      field_explanations: router ? [
        { field: "route", reason: "This records the router recommendation for the clarification planner and safety review.", used_by: "Clarification decision" },
        { field: "safety_note", reason: "This keeps visible safety context attached to downstream design work.", used_by: "Blueprint and safety stages" },
      ] : [],
      next_step: { title: "Clarification decision", reason: "A deterministic planner verifies whether required facts are actually missing; the AI route is advisory." },
      limitations: ["The router does not build workflow nodes.", "A cautious AI route cannot override the deterministic clarification readiness decision."],
      raw_input: { signals: job.signals, risks: job.risks, readiness: job.readiness },
      raw_output: router,
    },
    {
      id: "clarification",
      order: 0,
      title: "Clarification decision",
      stage: "clarification",
      status: clarificationSkipped ? "skipped" : statusForAgent(clarificationAgent),
      method: clarificationSkipped ? "deterministic" : methodForAgent(clarificationAgent),
      function_names: ["buildClarificationPlan()", "runClarificationAgent()"],
      purpose: "Checks required workflow facts and, only when needed, prepares focused questions before design continues.",
      input_summary: [
        { label: "Router route", value: router?.route ?? "not recorded" },
        { label: "Missing information", value: textList(job.signals.missing_critical_info) },
        { label: "Readiness", value: String(job.readiness.score) },
      ],
      requirements: ["A trigger", "An input source", "A desired output or action", "A human owner and approval boundary when external or high-stakes actions are present"],
      actions: clarificationSkipped
        ? [
            "The deterministic planner found no blocking clarification requirement.",
            "The Compile Clarifier was skipped because there were no missing-detail questions to improve.",
          ]
        : [
            clarification?.reason || "Clarification was required.",
            `Missing fields: ${textList(clarification?.missing_fields)}.`,
            clarificationAgent?.used_ai
              ? `${clarificationAgent.provider} prepared ${clarificationAgent.questions.length} clarification question(s).`
              : clarificationAgent?.reason || "Deterministic clarification questions were used.",
          ],
      output_summary: [
        { label: "Clarification needed", value: yesNo(clarification?.needed) },
        { label: "Missing fields", value: textList(clarification?.missing_fields) },
        { label: "Questions", value: String(clarificationAgent?.questions.length ?? clarification?.questions.length ?? 0) },
      ],
      field_explanations: clarification?.needed ? [
        { field: "missing_fields", reason: "Blocking fields prevent design agents from treating an underspecified scenario as implementation-ready.", used_by: "Design-agent gate" },
        { field: "questions", reason: "These are the concrete facts the user must supply before recompiling.", used_by: "Guided clarification" },
      ] : [],
      next_step: {
        title: "Deterministic blueprint",
        reason: clarificationSkipped
          ? "The trigger, source, actions, and required safety boundary were sufficient to create a safe preview."
          : "FlowForge still creates a clarification-first deterministic preview; AI design agents may be skipped when readiness is blocking.",
      },
      limitations: ["The clarifier asks for missing facts but does not invent them.", "Clarification does not approve external actions."],
      raw_input: { router, signals: job.signals, readiness: job.readiness },
      raw_output: { plan: clarification, agent: clarificationAgent },
    },
    {
      id: "deterministic_blueprint",
      order: 0,
      title: "Deterministic blueprint",
      stage: "blueprint",
      status: "completed",
      method: "deterministic",
      function_names: ["buildBlueprint()"],
      purpose: "Builds the authoritative, non-executing workflow preview from detected primitives and safety policy.",
      input_summary: [
        { label: "Trigger", value: result.trigger.description },
        { label: "Primitives", value: textList(job.signals.workflow_primitives) },
        { label: "Risk", value: job.risks.risk_level },
      ],
      requirements: ["Analyzed workflow primitives", "Risk and readiness summaries", "Canonical safety constraints"],
      actions: [
        `Created ${result.steps.length} workflow step(s).`,
        `Applied the ${result.automation_boundary.replaceAll("_", " ")} automation boundary.`,
        `${result.human_approval_gates.length} human approval gate(s) were added.`,
      ],
      output_summary: [
        { label: "Workflow", value: result.workflow_name },
        { label: "Trigger", value: result.trigger.description },
        { label: "Steps", value: result.steps.map((step) => step.label).join(" → ") || "No workflow steps" },
        { label: "Automation boundary", value: result.automation_boundary },
        { label: "Approval gates", value: textList(result.human_approval_gates.map((gate) => gate.label)) },
      ],
      field_explanations: [
        { field: "steps", reason: "These become the source workflow roles for implementation planning.", used_by: "Implementation brief" },
        ...(result.human_approval_gates.length ? [{ field: "human_approval_gates", reason: "These prevent downstream generators from turning review points into automatic side effects.", used_by: "Safety review and n8n generation" }] : []),
        { field: "automation_boundary", reason: "This states the strongest execution behavior the preview is allowed to represent.", used_by: "Final guard" },
      ],
      next_step: { title: "Deterministic safety review", reason: "The locally built blueprint must be checked against risk, clarification, and routing outcomes before it is exposed as safe." },
      limitations: ["This is a planning blueprint, not an executable workflow.", "It intentionally excludes credentials and production connections."],
      raw_input: { signals: job.signals, risks: job.risks, readiness: job.readiness },
      raw_output: result,
    },
    {
      id: "deterministic_safety",
      order: 0,
      title: "Deterministic safety review",
      stage: "safety_review",
      status: "validated",
      method: "safety",
      function_names: ["buildSafetyCriticReview()"],
      purpose: "Applies deterministic guardrails to decide what is safe, draft-only, human-gated, blocked, or still unclear.",
      input_summary: [
        { label: "Blueprint boundary", value: result.automation_boundary },
        { label: "Risk categories", value: textList(job.risks.categories) },
        { label: "Clarification needed", value: yesNo(clarification?.needed) },
      ],
      requirements: ["A deterministic blueprint", "Risk findings", "Router and clarification decisions"],
      actions: [
        job.safety_critic?.summary || "No safety review summary was recorded.",
        `${job.safety_critic?.findings.length ?? 0} observable safety finding(s) were produced.`,
      ],
      output_summary: [
        { label: "Safety status", value: job.safety_critic?.overall_status ?? "not recorded" },
        { label: "Human approval", value: textList(job.safety_critic?.requires_human_approval) },
        { label: "Draft only", value: textList(job.safety_critic?.must_remain_draft_only) },
        { label: "Blocked", value: textList(job.safety_critic?.blocked_or_not_recommended) },
      ],
      field_explanations: job.safety_critic ? [
        { field: "overall_status", reason: "This determines whether an n8n draft may be requested at all.", used_by: "Final guard and n8n endpoint" },
        { field: "requires_human_approval", reason: "These constraints are preserved in the implementation brief and terminal review node.", used_by: "n8n generation" },
      ] : [],
      next_step: { title: "Blueprint Architect", reason: architect?.status === "skipped" ? architect.reason : "The safe local blueprint provides grounded context for the AI design proposal." },
      limitations: ["Rules can enforce known boundaries but cannot guarantee real-world regulatory compliance.", "The review does not execute or approve any external action."],
      raw_input: result,
      raw_output: job.safety_critic,
    },
    {
      id: "blueprint_architect",
      order: 0,
      title: "Blueprint Architect",
      stage: "agent_design",
      status: statusForAgent(architect),
      method: methodForAgent(architect),
      function_names: ["runBlueprintArchitectAgent()"],
      purpose: "Produces an AI-assisted structured design proposal for critique without replacing the authoritative deterministic blueprint.",
      input_summary: [
        { label: "Workflow", value: result.workflow_name },
        { label: "Safety boundary", value: result.automation_boundary },
        { label: "Clarification needed", value: yesNo(clarification?.needed) },
      ],
      requirements: ["Sufficient deterministic readiness", "A safe non-executing design context", "Provider availability within the selected mode"],
      actions: architect?.status === "skipped"
        ? [architect.reason]
        : [
            architect?.used_ai ? `${architect.provider} generated the proposal.` : architect?.reason || "A deterministic fallback proposal was used.",
            `${architect?.proposed_steps.length ?? 0} proposed step(s) and ${architect?.proposed_human_approval_gates.length ?? 0} proposed gate(s) were returned.`,
          ],
      output_summary: [
        { label: "Provider", value: architect?.provider ?? "not run" },
        { label: "Proposal", value: architect?.summary ?? "No agent proposal" },
        { label: "Proposed steps", value: textList(architect?.proposed_steps.map((step) => step.label)) },
      ],
      field_explanations: architect?.proposed_steps.length ? [
        { field: "proposed_steps", reason: "The Safety Critic uses this proposal to identify AI-design concerns alongside the deterministic blueprint.", used_by: "Safety Critic" },
      ] : [],
      next_step: { title: "Safety Critic", reason: critic?.status === "skipped" ? critic.reason : "The design proposal is critiqued against deterministic risks and the authoritative blueprint." },
      limitations: ["The proposal does not replace the deterministic final blueprint.", "It cannot enable external actions or credentials."],
      raw_input: { blueprint: result, clarification, risks: job.risks },
      raw_output: architect,
    },
    {
      id: "safety_critic_agent",
      order: 0,
      title: "Safety Critic",
      stage: "agent_safety",
      status: statusForAgent(critic),
      method: methodForAgent(critic),
      function_names: ["runSafetyCriticAgent()"],
      purpose: "Critiques the proposed design and surfaces concerns, human gates, draft-only warnings, and safer alternatives.",
      input_summary: [
        { label: "Deterministic safety status", value: job.safety_critic?.overall_status ?? "not recorded" },
        { label: "Architect provider", value: architect?.provider ?? "not run" },
        { label: "Risk", value: job.risks.risk_level },
      ],
      requirements: ["A deterministic blueprint and safety review", "An architect proposal when design readiness permits"],
      actions: critic?.status === "skipped"
        ? [critic.reason]
        : [
            critic?.used_ai ? `${critic.provider} reviewed the proposal.` : critic?.reason || "Deterministic critic fallback was used.",
            `${critic?.concerns.length ?? 0} concern(s) were recorded.`,
          ],
      output_summary: [
        { label: "Provider", value: critic?.provider ?? "not run" },
        { label: "Critic summary", value: critic?.critic_summary ?? "No AI critic output" },
        { label: "Concerns", value: textList(critic?.concerns.map((concern) => concern.title)) },
        { label: "Final advice", value: critic?.final_advice ?? job.safety_critic?.next_safe_action ?? "Review the blueprint" },
      ],
      field_explanations: critic?.concerns.length ? [
        { field: "concerns", reason: "These explain risks in the AI proposal; they are visible guidance rather than hidden reasoning.", used_by: "User review" },
      ] : [],
      next_step: { title: "Final guard", reason: "The complete compile job must pass its schema and deterministic safety gate before it can be returned." },
      limitations: ["The critic reports observable concerns, not private chain-of-thought.", "Its advice cannot authorize real-world execution."],
      raw_input: { deterministic_blueprint: result, architect, safety_review: job.safety_critic },
      raw_output: critic,
    },
    {
      id: "final_guard",
      order: 0,
      title: "Final guard",
      stage: "compile_validation",
      status: job.status === "failed" ? "failed" : "validated",
      method: "validation",
      function_names: ["safeValidateCompileJob()"],
      purpose: "Validates the complete compile response and exposes the deterministic blueprint as the final compile result.",
      input_summary: [
        { label: "Compile status", value: job.status },
        { label: "Safety status", value: job.safety_critic?.overall_status ?? "not recorded" },
        { label: "Blueprint", value: result.workflow_name },
      ],
      requirements: ["A schema-valid compile job", "A deterministic blueprint", "A completed safety review"],
      actions: [
        job.status === "failed" ? "Compile validation failed." : "The compile job passed schema validation.",
        "The final compile result comes from buildBlueprint(); agent proposals and critiques remain separate observability outputs.",
      ],
      output_summary: [
        { label: "Final result", value: result.workflow_name },
        { label: "Status", value: job.status },
        { label: "Next safe action", value: job.safety_critic?.next_safe_action ?? "Review the blueprint" },
      ],
      field_explanations: [
        { field: "result", reason: "This authoritative deterministic blueprint is used to build the implementation brief.", used_by: "n8n implementation brief" },
        { field: "safety_critic.overall_status", reason: "Unsafe or clarification-blocked results cannot enter direct n8n generation.", used_by: "n8n generation gate" },
      ],
      limitations: ["Schema validity does not make the workflow production-ready.", "A downloadable n8n workflow exists only after the separate generation and validation stages."],
      raw_input: job,
      raw_output: result,
    },
  ];
}

function n8nSteps(job: CompileJob, state: ExecutionJourneyN8nState): ExecutionJourneyStep[] {
  if (state.state === "idle") return [];

  const attempts = state.provider_attempts ?? [];
  const trace = state.generation_trace;
  const implementation = trace?.implementation_input;
  const selectedAttempt = attempts.find((attempt) => attempt.success);
  const processing = trace?.processing ?? selectedAttempt?.processing_trace;
  const steps: ExecutionJourneyStep[] = [
    {
      id: "implementation_brief",
      order: 0,
      title: "n8n implementation brief",
      stage: "implementation_brief",
      status: "completed",
      method: "deterministic",
      function_names: ["buildN8nImplementationBrief()", "buildCompactN8nGenerationInput()"],
      purpose: "Converts the safe compile result into a compact, canonical contract for direct n8n generation.",
      input_summary: [
        { label: "Blueprint", value: job.result.workflow_name },
        { label: "Safety status", value: job.safety_critic?.overall_status ?? job.status },
        { label: "Original request", value: job.input.raw },
      ],
      requirements: ["A completed compile job", "A safe or human-gated safety status", "An authoritative deterministic blueprint"],
      actions: implementation ? [
        `Detected ${implementation.domain} domain and ${implementation.source_type} source type.`,
        `Preserved ${implementation.extracted_fields.length} canonical extracted field(s).`,
        `Attached the human owner and approval boundaries used by safe-preview nodes.`,
      ] : ["Built a compact provider prompt from the completed blueprint and safety review."],
      output_summary: implementation ? [
        { label: "Domain", value: implementation.domain },
        { label: "Trigger", value: implementation.trigger_description },
        { label: "Source", value: `${implementation.source} (${implementation.source_type})` },
        { label: "Extracted fields", value: textList(implementation.extracted_fields) },
        { label: "Classification target", value: implementation.classification_target },
        { label: "Human owner", value: implementation.human_owner },
        { label: "Approval boundary", value: implementation.approval_boundary },
        { label: "Recommended nodes", value: textList(implementation.recommended_nodes) },
      ] : [
        { label: "Blueprint", value: job.result.workflow_name },
        { label: "Safety status", value: job.safety_critic?.overall_status ?? job.status },
      ],
      field_explanations: implementation ? [
        { field: "domain", reason: "Selects the workflow pattern and safe sample context.", used_by: "n8n generator" },
        ...(implementation.extracted_fields.length ? [{ field: "extracted_fields", reason: "These fields must survive sample, normalization, classification, and review nodes.", used_by: "Normalization and quality validation" }] : []),
        { field: "human_owner", reason: "Creates the accountable pending-review handoff.", used_by: "Terminal review node" },
        { field: "approval_boundary", reason: "Prevents a provider draft from enabling an external side effect.", used_by: "Normalization and validation" },
      ] : [],
      next_step: { title: attempts[0] ? `${attempts[0].provider === "openai" ? "OpenAI" : "Groq"} n8n generation` : "n8n provider generation", reason: "The provider receives only the compact implementation contract needed to draft a safe workflow." },
      limitations: ["The brief intentionally omits credentials and live production configuration.", "Its source and trigger are safe placeholders, not connected integrations."],
      raw_input: job,
      raw_output: implementation,
    },
  ];

  attempts.forEach((attempt, index) => {
    const earlierRuntimeFailure = attempts.slice(0, index).some((candidate) => candidate.attempted && !candidate.success);
    const nextAttempt = attempts[index + 1];
    const providerName = attempt.provider === "openai" ? "OpenAI" : "Groq";
    const validationIssues = attempt.validation_issues ?? attempt.processing_trace?.validation_issues ?? [];
    const rejectedProcessingActions = !attempt.success && attempt.processing_trace
      ? [
          `FlowForge applied ${attempt.processing_trace.normalization_actions.length} normalization change(s) and ${attempt.processing_trace.repair_actions.length} repair(s) before validation.`,
          ...attempt.processing_trace.repair_actions.slice(0, 2).map((action) => action.description),
        ]
      : [];
    const status: ExecutionJourneyStatus = !attempt.attempted
      ? "skipped"
      : attempt.success
        ? earlierRuntimeFailure ? "fallback" : "completed"
        : "failed";

    steps.push({
      id: `n8n_provider_${attempt.provider}_${index}`,
      order: 0,
      title: `${providerName} n8n generation`,
      stage: "n8n_provider",
      status,
      method: attempt.provider,
      function_names: ["runN8nWorkflowGeneratorAgent()", attempt.provider === "openai" ? "callOpenAIAgent()" : "callGroq()"],
      purpose: "Asks the selected provider for a direct n8n workflow draft using the compact, safety-bounded implementation input.",
      input_summary: implementation ? [
        { label: "Workflow goal", value: implementation.workflow_goal },
        { label: "Canonical fields", value: textList(implementation.extracted_fields) },
        { label: "External action boundary", value: implementation.external_action_boundary },
      ] : [{ label: "Implementation input", value: "Compact brief derived from the compile result" }],
      requirements: ["A configured provider key", "Strict JSON output", "Only allowed safe-preview n8n node types"],
      actions: [
        ...rejectedProcessingActions,
        providerAttemptActions([attempt])[0] ?? "No provider outcome was recorded.",
      ],
      output_summary: [
        { label: "Attempted", value: yesNo(attempt.attempted) },
        { label: "Accepted", value: yesNo(attempt.success) },
        ...(validationIssues.length ? [{ label: "Validation failures", value: validationIssues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") }] : []),
        ...(attempt.error_summary ? [{ label: "Failure", value: attempt.error_summary }] : []),
      ],
      field_explanations: validationIssues.length ? [
        { field: "validation_issues", reason: "These observable failures explain why this provider draft was rejected and why another provider could run.", used_by: nextAttempt ? `${nextAttempt.provider} fallback` : "Generation failure" },
      ] : [],
      next_step: nextAttempt
        ? { title: `${nextAttempt.provider === "openai" ? "OpenAI" : "Groq"} n8n generation`, reason: attempt.attempted ? `${providerName} did not produce an accepted draft, so the next configured provider was tried.` : `${providerName} was unavailable, so FlowForge checked the next configured provider.` }
        : attempt.success
          ? { title: "n8n normalization and repair", reason: "The provider draft must be deterministically normalized before it can become the downloadable workflow." }
          : undefined,
      limitations: ["Provider output is never trusted as final JSON until deterministic processing passes.", "The provider cannot add credentials or enable production side effects."],
      raw_input: implementation,
      raw_output: attempt,
    });
  });

  if (processing && selectedAttempt) {
    const repaired = processing.repair_actions.length > 0;
    steps.push({
      id: "n8n_normalization_repair",
      order: 0,
      title: "n8n normalization and repair",
      stage: "n8n_processing",
      status: repaired ? "repaired" : "completed",
      method: "normalization",
      function_names: processingFunctions(processing),
      purpose: "Converts the accepted provider draft into FlowForge's safe, canonical n8n workflow shape before validation.",
      input_summary: [
        { label: "Provider", value: selectedAttempt.provider },
        { label: "Draft accepted for processing", value: "Yes" },
      ],
      requirements: ["Parseable provider JSON", "Allowed safe-preview node types", "Canonical compile fields and approval boundaries"],
      actions: processingActions(processing),
      output_summary: [
        { label: "Normalization changes", value: String(processing.normalization_actions.length) },
        { label: "Repairs", value: String(processing.repair_actions.length) },
        { label: "Canonical fields enforced", value: textList(processing.canonical_fields_restored) },
      ],
      field_explanations: processing.canonical_fields_restored.map((field) => ({
        field,
        reason: "The structured compile input is authoritative, so provider-generated metadata cannot override this value.",
        used_by: "Workflow quality validation and final download",
      })),
      next_step: { title: "n8n validation", reason: "The normalized draft must pass both the n8n safety schema and direct-workflow quality checks." },
      limitations: ["Repair fixes known structural and safety issues; it does not configure real integrations.", "The repaired workflow may differ materially from the raw provider draft."],
      raw_input: selectedAttempt,
      raw_output: state.workflow,
    });

    steps.push({
      id: "n8n_validation",
      order: 0,
      title: "n8n validation",
      stage: "n8n_validation",
      status: processing.schema_validation_passed && processing.quality_validation_passed ? "validated" : "failed",
      method: "validation",
      function_names: ["n8nWorkflowSchema.safeParse()", "validateGeneratedWorkflowQuality()"],
      purpose: "Rejects unsafe, disconnected, noncanonical, or incomplete direct-workflow drafts.",
      input_summary: [
        { label: "Normalized provider", value: selectedAttempt.provider },
        { label: "Workflow nodes", value: String(state.workflow?.nodes.length ?? 0) },
      ],
      requirements: ["A schema-valid inactive workflow", "A connected executable path", "Canonical fields in field-processing nodes", "A terminal pending-review handoff when required"],
      actions: [
        `Safety schema ${processing.schema_validation_passed ? "passed" : "failed"}.`,
        `Direct-workflow quality validation ${processing.quality_validation_passed ? "passed" : "failed"}.`,
        ...(processing.validation_issues.length ? processing.validation_issues.map((issue) => `${issue.path}: ${issue.message}`) : ["No validation issues remained."]),
      ],
      output_summary: [
        { label: "Schema validation", value: processing.schema_validation_passed ? "Passed" : "Failed" },
        { label: "Quality validation", value: processing.quality_validation_passed ? "Passed" : "Failed" },
        { label: "Remaining issues", value: String(processing.validation_issues.length) },
      ],
      field_explanations: [],
      next_step: processing.schema_validation_passed && processing.quality_validation_passed
        ? { title: "Final downloadable workflow", reason: "Only the normalized draft that passed both validation layers is returned for download." }
        : undefined,
      limitations: ["Validation checks FlowForge's safe-draft contract, not live credentials or third-party API behavior."],
      raw_input: state.workflow,
      raw_output: processing,
    });
  }

  if (state.workflow) {
    steps.push({
      id: "final_n8n_workflow",
      order: 0,
      title: "Final downloadable workflow",
      stage: "result",
      status: "completed",
      method: "mixed",
      function_names: ["runN8nWorkflowGeneratorAgent()"],
      purpose: "Returns the provider draft only after deterministic normalization, repair, canonical-field enforcement, and validation.",
      input_summary: [
        { label: "Selected provider", value: state.provider || selectedAttempt?.provider || "not recorded" },
        { label: "Fallback used", value: yesNo(state.fallback_used) },
      ],
      requirements: ["An accepted provider draft", "Passed schema validation", "Passed direct-workflow quality validation"],
      actions: [
        `Returned an inactive workflow with ${state.workflow.nodes.length} node(s).`,
        "Made the validated JSON available to copy or download.",
      ],
      output_summary: [
        { label: "Workflow", value: state.workflow.name ?? job.result.workflow_name },
        { label: "Nodes", value: String(state.workflow.nodes.length) },
        { label: "Active", value: yesNo(state.workflow.active) },
        { label: "Warnings", value: textList(state.warnings) },
      ],
      field_explanations: [
        { field: "active", reason: "The workflow remains disabled so importing the draft cannot start production execution.", used_by: "n8n import review" },
        { field: "meta", reason: "Canonical source, owner, fields, and approval boundaries make the result traceable to the compile input.", used_by: "Human review" },
      ],
      limitations: ["The download is a safe draft, not a production-ready integration.", "Credentials, real external triggers, and enabled side effects are intentionally excluded."],
      raw_input: processing,
      raw_output: state.workflow,
    });
  } else if (state.state === "failed" && !attempts.length) {
    steps.push({
      id: "n8n_generation_failed",
      order: 0,
      title: "n8n generation",
      stage: "n8n_provider",
      status: "failed",
      method: "mixed",
      purpose: "Creates a safe direct-workflow draft from the implementation brief.",
      input_summary: [{ label: "Blueprint", value: job.result.workflow_name }],
      requirements: ["At least one configured provider"],
      actions: [state.error || "Generation failed before a provider attempt was recorded."],
      output_summary: [{ label: "Result", value: "No downloadable workflow was produced" }],
      limitations: ["No workflow can be downloaded until a provider draft passes validation."],
    });
  }

  return steps;
}

export function buildExecutionJourney(input: {
  job?: CompileJob | null;
  guided_clarification?: ExecutionJourneyGuidedClarification;
  n8n?: ExecutionJourneyN8nState;
}): ExecutionJourneyStep[] {
  if (!input.job) return [];

  const steps = [
    ...compileSteps(input.job, input.guided_clarification),
    ...(input.n8n ? n8nSteps(input.job, input.n8n) : []),
  ];

  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
    ...(step.id === "final_guard" && input.n8n && input.n8n.state !== "idle"
      ? {
          next_step: {
            title: "n8n implementation brief",
            reason: "The validated compile result is now eligible to be translated into a compact, safety-bounded generation contract.",
          },
        }
      : {}),
  }));
}
