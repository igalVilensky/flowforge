import type {
  CompileJob,
  CompileMode,
  PipelineStep,
  TokenUsage,
} from "../../shared/types/compileJob";
import type {
  AutomationReadinessScore,
  RiskCategory,
  RiskItem,
  RiskLevel,
  RiskSummary,
  SafeAutomationBlueprint,
} from "../../shared/types/workflow";
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

function getRiskLevel(categories: RiskCategory[]): RiskLevel {
  const highRiskCategories: RiskCategory[] = [
    "legal",
    "medical",
    "visa_or_immigration",
    "employment",
    "delete_or_destructive_action",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
  ];

  if (categories.some((category) => highRiskCategories.includes(category))) {
    return "high";
  }

  return categories.length > 0 ? "medium" : "low";
}

function requiresHumanReview(categories: RiskCategory[]): boolean {
  const reviewRequiredCategories: RiskCategory[] = [
    "external_communication",
    "financial",
    "legal",
    "medical",
    "visa_or_immigration",
    "employment",
    "refund_or_payment",
    "delete_or_destructive_action",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
  ];

  return categories.some((category) => reviewRequiredCategories.includes(category));
}

function describeRiskReasons(categories: RiskCategory[]): string[] {
  const reasons: string[] = [];

  if (categories.length === 0) {
    return ["The rule-based scanner did not detect obvious safety risk flags."];
  }

  if (categories.includes("external_communication")) {
    reasons.push("External communication must be reviewed before sending.");
  }

  if (categories.includes("refund_or_payment") || categories.includes("financial")) {
    reasons.push("Refund, payment, billing, and financial outcomes need accountable review.");
  }

  if (categories.includes("high_stakes_decision")) {
    reasons.push("Sensitive or high-stakes decisions must remain human-approved.");
  }

  if (categories.includes("personal_data") || categories.includes("account_access")) {
    reasons.push("Personal data and account access require clear permissions.");
  }

  if (categories.includes("delete_or_destructive_action")) {
    reasons.push("Destructive actions need explicit approval and rollback planning.");
  }

  if (categories.includes("real_world_execution")) {
    reasons.push("The MVP must not execute real-world actions automatically.");
  }

  return reasons;
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
  const riskCategories = signals.risk_flags;
  const riskLevel = getRiskLevel(riskCategories);
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
      description: "Create a local placeholder job from the submitted process.",
      status: "done",
      tool_name: "mockCompiler",
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
      id: "mock_risk_review",
      label: "Mock Risk Review",
      description: "Apply fixed MVP safety boundaries.",
      status: "done",
      tool_name: "mockRiskReview",
      output_summary: "External communication, high-stakes decisions, and real execution stay human-gated.",
    },
    {
      id: "mock_blueprint",
      label: "Mock Blueprint",
      description: "Return a static safe automation blueprint preview.",
      status: "done",
      tool_name: "mockBlueprintBuilder",
      output_summary: "Placeholder blueprint is ready for UI preview.",
    },
  ];

  const risks: RiskSummary = {
    categories: riskCategories,
    risk_level: riskLevel,
    reasons: describeRiskReasons(riskCategories),
    requires_human_review: requiresHumanReview(riskCategories),
  };

  const readiness: AutomationReadinessScore = {
    score: riskLevel === "high" ? 44 : riskLevel === "medium" ? 58 : 72,
    strengths: [
      "The input can be scanned deterministically for workflow signals.",
      "Draft generation can be automated as long as the output remains non-executing.",
    ],
    weaknesses:
      signals.missing_critical_info.length > 0
        ? signals.missing_critical_info
        : ["No critical signal gaps were detected by the rule-based scanner."],
  };

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
      reason: "Milestone 0 and the MVP should not trigger production systems automatically.",
      recommendation: "Block execution and export only a reviewed implementation plan.",
      step_ids: ["block_real_world_execution"],
    },
  ];

  const result: SafeAutomationBlueprint = {
    id: `blueprint_${jobId}`,
    workflow_name: "Milestone 0 Safe Automation Blueprint Preview",
    summary: "A placeholder blueprint showing the intended safe automation boundary.",
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
        description: "Prevent the placeholder compiler from sending, deleting, charging, updating, or triggering external systems.",
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
        reason: "Milestone 0 is a preview only and must not perform external actions.",
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
      "This is a Milestone 0 placeholder response.",
      "No AI provider, database, authentication, n8n export, or external execution is connected.",
      "Future milestones will replace mock scanners with deterministic tools and validated schemas.",
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
        action: "Created placeholder compile job",
        status: "completed",
        output_summary: "Milestone 0 mock result returned.",
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
        reason: "Milestone 0 does not call Groq, Gemini, OpenAI, or any external service.",
      },
    ],
    token_usage: tokenUsage,
  };

  const validation = safeValidateCompileJob(compileJob);

  if (!validation.success) {
    throw createError({
      statusCode: 500,
      statusMessage: "Mock compile job failed schema validation.",
      data: {
        issues: validation.issues,
      },
    });
  }

  return validation.data;
});
