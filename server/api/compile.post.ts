import type {
  CompileJob,
  CompileMode,
  PipelineStep,
  TokenUsage,
} from "../../shared/types/compileJob";
import type { RiskItem, SafeAutomationBlueprint } from "../../shared/types/workflow";
import { scoreReadiness } from "../services/readinessScorer";
import { scanRisks } from "../services/riskScanner";
import { safeValidateCompileJob } from "../services/schemaValidator";
import { scanSignals } from "../services/signalScanner";

const compileModes = ["demo", "rule_only", "balanced", "full"] as const satisfies readonly CompileMode[];

const llmCallLimits: Record<CompileMode, number> = {
  demo: 0,
  rule_only: 0,
  balanced: 3,
  full: 4,
};

type CompileBody = {
  input?: unknown;
  mode?: unknown;
};

function isCompileMode(value: unknown): value is CompileMode {
  return typeof value === "string" && compileModes.includes(value as CompileMode);
}

export default defineEventHandler(async (event): Promise<CompileJob> => {
  const body = await readBody<CompileBody>(event);
  const rawInput = typeof body.input === "string" ? body.input : "";
  const trimmedInput = rawInput.trim();

  if (!trimmedInput) {
    throw createError({
      statusCode: 400,
      statusMessage: "Process description is required.",
    });
  }

  if (body.mode !== undefined && !isCompileMode(body.mode)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Compile mode must be demo, rule_only, balanced, or full.",
    });
  }

  const mode = isCompileMode(body.mode) ? body.mode : "demo";
  const signals = scanSignals(trimmedInput);
  const risks = scanRisks(signals);
  const readiness = scoreReadiness(signals, risks);
  const riskCategories = risks.categories;
  const detectedPrimitiveSummary =
    signals.workflow_primitives.length > 0
      ? `Detected ${signals.workflow_primitives.join(", ")} primitives.`
      : "No clear workflow primitives detected yet.";
  const now = new Date().toISOString();
  const jobId = `compile_${Date.now()}`;

  const steps: PipelineStep[] = [
    {
      id: "initialize_compile_job",
      label: "Initialize Compile Job",
      description: "Create a local compile job from the submitted process.",
      status: "done",
      tool_name: "previewCompiler",
      output_summary: "Compile state created without provider calls.",
    },
    {
      id: "rule_based_signal_scan",
      label: "Rule-Based Signal Scan",
      description: "Summarize visible process structure with deterministic rules.",
      status: "done",
      tool_name: "signalScanner",
      output_summary: detectedPrimitiveSummary,
    },
    {
      id: "rule_based_risk_review",
      label: "Rule-Based Risk Review",
      description: "Summarize risk level and review requirements with deterministic rules.",
      status: "done",
      tool_name: "riskScanner",
      output_summary: `Risk level is ${risks.risk_level}; human review ${
        risks.requires_human_review ? "is required" : "is not required"
      }.`,
    },
    {
      id: "static_blueprint_preview",
      label: "Static Blueprint Preview",
      description: "Return a static safe automation blueprint preview.",
      status: "done",
      tool_name: "staticBlueprintBuilder",
      output_summary: "Static blueprint preview is ready for UI preview.",
    },
  ];

  const riskItems: RiskItem[] = [
    {
      id: "risk_external_communication",
      label: "External communication",
      category: "external_communication",
      risk_level: "medium",
      reason: "Sending messages can affect customers, students, employees, or partners.",
      recommendation: "Generate drafts only and require a human to approve or send.",
      step_ids: ["draft_response", "approve_external_action"],
    },
    {
      id: "risk_high_stakes_decision",
      label: "Sensitive or high-stakes decision",
      category: "high_stakes_decision",
      risk_level: "high",
      reason: "Legal, medical, financial, immigration, employment, and account decisions need accountable review.",
      recommendation: "Keep decision authority with a human reviewer.",
      step_ids: ["approve_high_stakes_decision"],
    },
    {
      id: "risk_real_world_execution",
      label: "Real-world execution",
      category: "real_world_execution",
      risk_level: "high",
      reason: "The preview compiler and MVP should not trigger production systems automatically.",
      recommendation: "Block execution and export only a reviewed implementation plan.",
      step_ids: ["block_real_world_execution"],
    },
  ];

  const result: SafeAutomationBlueprint = {
    id: `blueprint_${jobId}`,
    workflow_name: "Rule-Based Blueprint Preview",
    summary: "A static blueprint preview showing the intended safe automation boundary.",
    automation_boundary: "human_approval_required",
    trigger: {
      type: "manual_input",
      source: "compiler_preview",
      description: "A user submits a messy process description to FlowForge.",
    },
    steps: [
      {
        id: "intake_process",
        label: "Capture process description",
        description: "Store the submitted process text in the compile job.",
        primitive: "intake",
        actor: "system",
        input: "User process description",
        output: "Compile job input",
        automation_policy: "automate",
        approval_required: false,
        risk_level: "low",
        risk_categories: [],
        real_world_execution: "none",
      },
      {
        id: "classify_request",
        label: "Classify the request",
        description: "Identify the likely workflow shape and process primitives.",
        primitive: "classification",
        actor: "rules_and_ai",
        input: "Compile job input",
        output: "Workflow classification",
        automation_policy: "automate",
        approval_required: false,
        risk_level: "low",
        risk_categories: [],
        real_world_execution: "none",
      },
      {
        id: "detect_risks",
        label: "Detect safety risks",
        description: "Flag external communication, sensitive data, high-stakes decisions, and execution risk.",
        primitive: "risk_detection",
        actor: "rules",
        input: "Workflow classification",
        output: "Risk summary",
        automation_policy: "automate",
        approval_required: false,
        risk_level: "medium",
        risk_categories: riskCategories,
        real_world_execution: "none",
      },
      {
        id: "draft_response",
        label: "Draft proposed output",
        description: "Prepare draft text, tasks, or blueprint notes without sending anything.",
        primitive: "drafting",
        actor: "ai",
        input: "Risk-aware workflow summary",
        output: "Draft-only response or task",
        automation_policy: "draft_only",
        approval_required: false,
        risk_level: "medium",
        risk_categories: ["external_communication"],
        real_world_execution: "draft_only",
      },
      {
        id: "approve_external_action",
        label: "Approve external communication",
        description: "A human reviews any message before it can leave the system.",
        primitive: "approval",
        actor: "human",
        input: "Draft-only response",
        output: "Approval decision",
        automation_policy: "human_approval",
        approval_required: true,
        risk_level: "medium",
        risk_categories: ["external_communication"],
        real_world_execution: "requires_human_trigger",
      },
      {
        id: "approve_high_stakes_decision",
        label: "Approve sensitive decisions",
        description: "A human owns decisions involving legal, medical, financial, immigration, employment, or account impact.",
        primitive: "approval",
        actor: "human",
        input: "Risk summary and draft recommendation",
        output: "Human decision",
        automation_policy: "human_approval",
        approval_required: true,
        risk_level: "high",
        risk_categories: ["high_stakes_decision"],
        real_world_execution: "requires_human_trigger",
      },
      {
        id: "block_real_world_execution",
        label: "Block real-world execution in MVP",
        description: "Prevent the preview compiler from sending, deleting, charging, updating, or triggering external systems.",
        primitive: "validation",
        actor: "system",
        input: "Compiled blueprint",
        output: "Non-executing preview",
        automation_policy: "blocked_in_mvp",
        approval_required: true,
        risk_level: "high",
        risk_categories: ["real_world_execution"],
        real_world_execution: "blocked_in_mvp",
      },
    ],
    safe_to_automate: [
      "Classifying the process shape",
      "Detecting obvious risk categories",
      "Drafting internal notes, replies, or task descriptions",
      "Preparing a non-executing blueprint preview",
    ],
    needs_human_approval: [
      "Any external message before it is sent",
      "Any sensitive or high-stakes decision",
      "Any workflow step that changes real systems or user records",
    ],
    not_recommended: [
      "Treating an AI draft as an approved decision",
      "Skipping review for refunds, payments, legal, medical, immigration, employment, or account actions",
    ],
    not_safe_to_automate: [
      "Automatic real-world execution in the MVP",
      "Sending, deleting, charging, approving, rejecting, or updating external systems without a human trigger",
    ],
    risks: riskItems,
    human_approval_gates: [
      {
        id: "gate_external_communication",
        label: "Review external communication",
        required: true,
        applies_to_step_ids: ["draft_response", "approve_external_action"],
        reason: "Messages can affect real people and organizations.",
        review_checklist: [
          "Confirm the recipient and channel.",
          "Check tone, accuracy, and missing context.",
          "Verify no sensitive data is exposed.",
          "Send only after a human chooses to proceed.",
        ],
      },
      {
        id: "gate_high_stakes_decision",
        label: "Review sensitive decisions",
        required: true,
        applies_to_step_ids: ["detect_risks", "approve_high_stakes_decision"],
        reason: "Sensitive categories require accountable human judgment.",
        review_checklist: [
          "Confirm the risk category.",
          "Check policy, legal, or domain constraints.",
          "Escalate to the correct owner when needed.",
          "Record the human decision separately from AI output.",
        ],
      },
      {
        id: "gate_no_execution",
        label: "Confirm no automatic execution",
        required: true,
        applies_to_step_ids: ["block_real_world_execution"],
        reason: "The preview compiler must not perform external actions.",
        review_checklist: [
          "Keep outputs as previews or exports.",
          "Do not connect production credentials.",
          "Do not trigger n8n, email, payments, or account updates.",
        ],
      },
    ],
    test_cases: [
      {
        id: "dry_run_safe_classification",
        name: "Classification-only request",
        input_event: "A user asks FlowForge to classify support messages by topic.",
        expected_route: "compile_light_blueprint",
        expected_human_gate: false,
        reason: "Classification and internal labeling can be automated when no external action follows.",
      },
      {
        id: "dry_run_external_reply",
        name: "External reply request",
        input_event: "A user asks FlowForge to draft and send customer replies.",
        expected_route: "suggest_safer_workflow",
        expected_human_gate: true,
        reason: "Drafting is acceptable, but sending requires approval.",
      },
      {
        id: "dry_run_high_stakes",
        name: "High-stakes decision request",
        input_event: "A user asks FlowForge to approve a refund or legal response automatically.",
        expected_route: "suggest_safer_workflow",
        expected_human_gate: true,
        reason: "Sensitive decisions must remain human-approved.",
      },
    ],
    assumptions: [
      "This is a rule-based preview response. AI generation is not connected yet.",
      "No AI provider, database, authentication, n8n export, or external execution is connected.",
      "Future milestones will replace the static blueprint preview with generated blueprint synthesis.",
    ],
    open_questions: [
      "Which deterministic scanner rules should be implemented first?",
      "Which blueprint schema fields should become required in Milestone 2?",
      "Which demo preset best represents the final presentation?",
    ],
  };

  const tokenUsage: TokenUsage = {
    mode,
    llm_calls_used: 0,
    llm_calls_limit: llmCallLimits[mode],
    estimated_input_tokens: Math.max(1, Math.ceil(trimmedInput.length / 4)),
    rule_based_checks: 4,
    skipped_ai_calls: llmCallLimits[mode],
  };

  const compileJob: CompileJob = {
    id: jobId,
    status: "done",
    mode,
    created_at: now,
    updated_at: now,
    input: {
      raw: rawInput,
      trimmed: trimmedInput,
    },
    steps,
    signals,
    risks,
    readiness,
    result,
    agent_trace: [
      {
        id: "trace_initialize",
        timestamp: now,
        actor: "compiler_agent",
        action: "Created rule-based compile job",
        status: "completed",
        output_summary: "Rule-based preview result returned.",
        metadata: {
          provider_calls: 0,
          external_execution: false,
        },
      },
      {
        id: "trace_skip_providers",
        timestamp: now,
        actor: "llm",
        action: "Skipped AI provider calls",
        status: "skipped",
        reason: "The rule-based compiler does not call Groq, Gemini, OpenAI, or any external service.",
      },
    ],
    token_usage: tokenUsage,
  };

  const validation = safeValidateCompileJob(compileJob);

  if (!validation.success) {
    throw createError({
      statusCode: 500,
      statusMessage: "Compile job failed schema validation.",
      data: {
        issues: validation.issues,
      },
    });
  }

  return validation.data;
});
