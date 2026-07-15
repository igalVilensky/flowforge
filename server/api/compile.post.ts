import type {
  CompileJob,
  CompileMode,
  CompileProgressEvent,
  PipelineStep,
  TokenUsage,
} from "../../shared/types/compileJob";
import type { AgentDebugInfo } from "../../shared/types/agentOutputs";
import { buildBlueprint } from "../services/blueprintBuilder";
import { buildBlueprintFromArchitectOutput } from "../services/blueprintFromArchitectOutput";
import { buildClarificationPlan } from "../services/clarificationPlanner";
import { runBlueprintArchitectAgent } from "../services/blueprintArchitectAgent";
import { runClarificationAgent } from "../services/clarificationAgent";
import { scoreReadiness } from "../services/readinessScorer";
import { scanRisks } from "../services/riskScanner";
import { safeValidateCompileJob } from "../services/schemaValidator";
import { scanSignals } from "../services/signalScanner";
import { routeCompileRequest } from "../services/routerAgent";
import { runSafetyCriticAgent } from "../services/safetyCriticAgent";
import { buildSafetyCriticReview } from "../services/safetyCritic";
import { parseCompileAnalysisInput } from "../services/structuredCompileInput";

const compileModes = [
  "demo",
  "rule_only",
  "balanced",
  "full",
] as const satisfies readonly CompileMode[];

const llmCallLimits: Record<CompileMode, number> = {
  demo: 0,
  rule_only: 0,
  balanced: 3,
  full: 4,
};

export type EmitCompileProgress = (
  event: CompileProgressEvent,
) => void | Promise<void>;

type CompileBody = {
  input?: unknown;
  mode?: unknown;
};

export function isCompileMode(value: unknown): value is CompileMode {
  return (
    typeof value === "string" && compileModes.includes(value as CompileMode)
  );
}

function progressTimestamp() {
  return new Date().toISOString();
}

async function emitProgress(
  emit: EmitCompileProgress | undefined,
  event: Record<string, unknown>,
) {
  if (!emit) return;
  await emit({
    ...event,
    timestamp: progressTimestamp(),
  } as CompileProgressEvent);
}

function agentCompletionStatus(output: {
  used_ai?: boolean;
  fallback_used?: boolean;
  status?: unknown;
}) {
  if (output.status === "skipped") return "skipped";
  if (output.status === "failed_validation") return "failed";
  if (output.used_ai) return "ai_success";
  if (output.fallback_used) return "fallback_success";
  return "deterministic_success";
}

function routerCompletionStatus(decision: {
  used_ai?: boolean;
  fallback_used?: boolean;
}) {
  if (decision.used_ai) return "ai_success";
  if (decision.fallback_used) return "fallback_success";
  return "deterministic_success";
}

export async function runCompilePipeline(input: {
  rawInput: string;
  mode: CompileMode;
  emit?: EmitCompileProgress;
}): Promise<CompileJob> {
  const { rawInput, mode, emit } = input;
  const analysisInput = parseCompileAnalysisInput(rawInput);
  const semanticInput = analysisInput.intent;
  const signals = scanSignals(semanticInput);
  const risks = scanRisks(signals);
  const readiness = scoreReadiness(signals, risks);
  await emitProgress(emit, {
    type: "step_started",
    step_id: "router",
    label: "Router",
    kind: "agent",
    message: "Routing request with available providers.",
  });
  const routerResult = await routeCompileRequest(
    semanticInput,
    signals,
    risks,
    readiness,
    mode,
  );
  await emitProgress(emit, {
    type: "step_completed",
    step_id: "router",
    label: "Router",
    status: routerCompletionStatus(routerResult.decision),
    provider: routerResult.decision.provider,
    message: routerResult.decision.used_ai
      ? `Router used ${routerResult.decision.provider}.`
      : routerResult.decision.reason,
  });

  await emitProgress(emit, {
    type: "step_started",
    step_id: "clarification_planner",
    label: "Clarification Planner",
    kind: "deterministic",
    message: "Checking whether required workflow details are present.",
  });
  const clarificationPlan = buildClarificationPlan({
    processInput: semanticInput,
    signals,
    risks,
    readiness,
    route: routerResult.decision.route,
  });
  await emitProgress(emit, {
    type: "step_completed",
    step_id: "clarification_planner",
    label: "Clarification Planner",
    status: clarificationPlan.needed ? "deterministic_success" : "skipped",
    message: clarificationPlan.needed
      ? `Missing details: ${clarificationPlan.missing_fields.join(", ")}.`
      : "No clarification needed.",
  });

  await emitProgress(emit, {
    type: "step_started",
    step_id: "clarification_agent",
    label: "Compile Clarifier",
    kind: "agent",
    message: clarificationPlan.needed
      ? "Preparing clarification questions."
      : "Confirming no compile clarification is needed.",
  });
  const clarificationAgentResult = await runClarificationAgent({
    processInput: semanticInput,
    mode,
    signals,
    risks,
    clarificationPlan,
  });
  await emitProgress(emit, {
    type: "step_completed",
    step_id: "clarification_agent",
    label: "Compile Clarifier",
    status: !clarificationPlan.needed
      ? "skipped"
      : agentCompletionStatus(clarificationAgentResult.output),
    provider: clarificationAgentResult.output.provider,
    message: !clarificationPlan.needed
      ? "No clarification agent work needed."
      : clarificationAgentResult.output.used_ai
        ? `Clarifier used ${clarificationAgentResult.output.provider}.`
        : clarificationAgentResult.output.reason,
  });

  // Critical rule:
  // Do not let a cautious AI router route skip the design agents.
  // The deterministic clarification planner is the source of truth for whether the
  // workflow is too underspecified to design.
  //
  // Success criteria / verification questions are useful implementation follow-ups,
  // but they should not block Blueprint Architect or Safety Critic Agent from
  // producing a non-executing preview.
  const blockingMissingFields = clarificationPlan.missing_fields.filter(
    (field) => field !== "success_criteria",
  );
  const shouldSkipDesignAgents = blockingMissingFields.length > 0;

  const displayedPrimitives = signals.workflow_primitives.filter(
    (primitive) => {
      if (primitive === "approval" && !risks.requires_human_review) {
        return false;
      }

      if (primitive === "risk_detection" && risks.categories.length === 0) {
        return false;
      }

      return true;
    },
  );

  const detectedPrimitiveSummary =
    displayedPrimitives.length > 0
      ? `Detected ${displayedPrimitives.join(", ")} primitives.`
      : "No clear workflow primitives detected yet.";

  const clarificationSummary = clarificationPlan.needed
    ? `Clarification needed: ${clarificationPlan.missing_fields.join(", ")}.`
    : "No clarification needed.";

  const clarificationAgentSummary = clarificationAgentResult.output.used_ai
    ? `Clarification Agent improved ${clarificationAgentResult.output.questions.length} question(s).`
    : `Clarification Agent fallback: ${clarificationAgentResult.output.reason}`;

  const now = new Date().toISOString();
  const jobId = `compile_${Date.now()}`;

  await emitProgress(emit, {
    type: "step_started",
    step_id: "deterministic_blueprint",
    label: "Deterministic Blueprint",
    kind: "deterministic",
    message: "Building the safe local blueprint preview.",
  });
  const deterministicResult = buildBlueprint({
    jobId,
    processInput: semanticInput,
    signals,
    risks,
    readiness,
    mode,
  });

  for (const constraint of analysisInput.safetyConstraints) {
    const assumption = `Clarification safety constraint: ${constraint}`;

    if (!deterministicResult.assumptions.includes(assumption)) {
      deterministicResult.assumptions.push(assumption);
    }
  }
  await emitProgress(emit, {
    type: "step_completed",
    step_id: "deterministic_blueprint",
    label: "Deterministic Blueprint",
    status: "deterministic_success",
    message: `${deterministicResult.workflow_name} prepared.`,
  });

  const skippedBlueprintArchitectOutput = {
    provider: "deterministic" as const,
    used_ai: false,
    fallback_used: true,
    confidence: "high" as const,
    status: "skipped" as const,
    reason:
      "Blueprint Architect Agent skipped because blocking deterministic clarification is needed before proposing an implementation-ready blueprint.",
    workflow_name: "Clarification-first blueprint proposal",
    summary:
      "The request needs more detail before the AI Blueprint Architect should propose a workflow.",
    proposed_steps: [
      {
        id: "collect_missing_details",
        label: "Collect missing details",
        primitive: "intake" as const,
        description:
          "Ask the missing clarification questions before designing the workflow.",
        input: "User process description and clarification plan",
        output: "Clarified workflow requirements",
        automation_policy: "assist_only" as const,
        risk_level: risks.risk_level,
        approval_required: true,
      },
      {
        id: "review_safe_boundaries",
        label: "Review safe boundaries",
        primitive: "risk_detection" as const,
        description:
          "Confirm what must remain draft-only, human-approved, or blocked.",
        input: "Clarified requirements",
        output: "Safe automation boundary",
        automation_policy: "human_approval" as const,
        risk_level: risks.risk_level,
        approval_required: true,
      },
      {
        id: "recompile_after_clarification",
        label: "Recompile after clarification",
        primitive: "reporting" as const,
        description:
          "Run FlowForge again after the missing details are answered.",
        input: "Clarified process description",
        output: "Updated non-executing blueprint preview",
        automation_policy: "blocked_in_mvp" as const,
        risk_level: "low" as const,
        approval_required: false,
      },
    ],
    proposed_human_approval_gates: [
      {
        id: "review_before_design",
        label: "Review before design",
        reason:
          "Clarification is required before a safe implementation-ready workflow can be proposed.",
        applies_to_step_ids: [
          "collect_missing_details",
          "review_safe_boundaries",
        ],
        required: true,
      },
    ],
    proposed_risks: risks.categories.map((category) => ({
      id: `risk_${category}`,
      category,
      label: category.replaceAll("_", " "),
      risk_level: risks.risk_level,
      reason: "Detected before clarification was complete.",
      recommendation:
        "Answer missing details and keep sensitive or external actions human-reviewed.",
    })),
    safe_to_automate: ["Collect clarification answers for review."],
    must_remain_draft_only: signals.has_external_action
      ? [
          "Any external message or action must remain draft-only until reviewed.",
        ]
      : [],
    requires_human_approval: risks.requires_human_review
      ? ["A human owner must approve the clarified workflow boundary."]
      : [],
    blocked_or_not_recommended: [],
    assumptions: [
      "FlowForge should not spend blueprint-design AI calls until deterministic clarification is complete.",
    ],
    open_questions: clarificationPlan.questions.map(
      (question) => question.question,
    ),
    safer_alternative:
      "Ask the clarification questions first, then recompile the workflow.",
  };

  const skippedBlueprintArchitectDebug: AgentDebugInfo = {
    agent_id: "blueprint_architect_agent",
    agent_label: "Blueprint Architect Agent",
    mode,
    system_prompt: "",
    user_prompt:
      "Skipped before prompting because blocking deterministic clarification is needed.",
    provider_attempts: [
      {
        provider: "deterministic",
        attempted: true,
        success: true,
        parsed_response: skippedBlueprintArchitectOutput,
      },
    ],
    selected_provider: "deterministic",
    used_ai: false,
    fallback_used: true,
    status: "skipped",
    llm_calls_made: 0,
    final_output: skippedBlueprintArchitectOutput,
  };

  await emitProgress(emit, {
    type: "step_started",
    step_id: "blueprint_architect_agent",
    label: "Blueprint Architect",
    kind: "agent",
    message: shouldSkipDesignAgents
      ? "Skipping AI blueprint design until blocking clarification is answered."
      : "Drafting a safe workflow blueprint.",
  });

  const blueprintArchitectAgentResult = shouldSkipDesignAgents
    ? {
        output: skippedBlueprintArchitectOutput,
        llm_calls_made: 0,
        debug: skippedBlueprintArchitectDebug,
      }
    : await runBlueprintArchitectAgent({
        processInput: semanticInput,
        mode,
        signals,
        risks,
        readiness,
        routerDecision: routerResult.decision,
        clarificationPlan,
      });

  await emitProgress(emit, {
    type: "step_completed",
    step_id: "blueprint_architect_agent",
    label: "Blueprint Architect",
    status: shouldSkipDesignAgents
      ? "skipped"
      : agentCompletionStatus(blueprintArchitectAgentResult.output),
    provider: blueprintArchitectAgentResult.output.provider,
    message: shouldSkipDesignAgents
      ? "Blueprint Architect skipped because clarification is needed first."
      : blueprintArchitectAgentResult.output.used_ai
        ? `Blueprint Architect used ${blueprintArchitectAgentResult.output.provider}.`
        : blueprintArchitectAgentResult.output.reason,
  });

  const blueprintArchitectSummary = blueprintArchitectAgentResult.output.used_ai
    ? `Blueprint Architect proposed ${blueprintArchitectAgentResult.output.proposed_steps.length} step(s).`
    : `Blueprint Architect fallback: ${blueprintArchitectAgentResult.output.reason}`;

  const aiResult = shouldSkipDesignAgents
    ? null
    : buildBlueprintFromArchitectOutput({
        jobId,
        processInput: semanticInput,
        mode,
        architectOutput: blueprintArchitectAgentResult.output,
        deterministicFallback: deterministicResult,
        signals,
        risks,
        readiness,
      });

  const result = aiResult ?? deterministicResult;

  for (const constraint of analysisInput.safetyConstraints) {
    const assumption = `Clarification safety constraint: ${constraint}`;

    if (!result.assumptions.includes(assumption)) {
      result.assumptions.push(assumption);
    }
  }

  await emitProgress(emit, {
    type: "step_started",
    step_id: "safety_critic_deterministic",
    label: "Deterministic Safety Review",
    kind: "deterministic",
    message: "Checking the selected blueprint with deterministic guardrails.",
  });

  const safetyCriticReview = buildSafetyCriticReview({
    signals,
    risks,
    readiness,
    routerDecision: routerResult.decision,
    clarificationPlan,
    blueprint: result,
  });

  await emitProgress(emit, {
    type: "step_completed",
    step_id: "safety_critic_deterministic",
    label: "Deterministic Safety Review",
    status: "deterministic_success",
    message: safetyCriticReview.summary,
  });

  const skippedSafetyCriticAgentOutput = {
    provider: "deterministic" as const,
    used_ai: false,
    fallback_used: true,
    confidence: "high" as const,
    status: "skipped" as const,
    reason:
      "Safety Critic Agent skipped because blocking deterministic clarification is needed before critiquing an implementation-ready blueprint.",
    critic_summary:
      "Clarify the workflow before asking the AI Safety Critic to critique the proposed automation.",
    concerns: [
      {
        id: "needs_clarification_before_critique",
        type: "needs_clarification" as const,
        severity: "warning" as const,
        title: "Clarification needed before AI critique",
        explanation:
          "The workflow is missing required details, so the AI critic would be reviewing an unstable blueprint.",
        recommendation:
          "Answer the clarification questions and recompile before requesting AI critique.",
        related_step_ids: deterministicResult.steps.map((step) => step.id),
        related_risk_ids: deterministicResult.risks.map((risk) => risk.id),
        related_gate_ids: deterministicResult.human_approval_gates.map(
          (gate) => gate.id,
        ),
      },
    ],
    recommended_human_gates: deterministicResult.human_approval_gates.map(
      (gate) => gate.label,
    ),
    draft_only_warnings: signals.has_external_action
      ? [
          "Any generated external message, reply, notification, or email must remain draft-only.",
        ]
      : [],
    blocked_or_not_recommended:
      deterministicResult.not_safe_to_automate.length > 0
        ? deterministicResult.not_safe_to_automate
        : deterministicResult.not_recommended,
    safer_alternative:
      "Answer the clarification questions, revise the process description, and recompile.",
    final_advice:
      "Do not treat this as implementation-ready until the missing details are answered.",
  };

  const skippedSafetyCriticDebug: AgentDebugInfo = {
    agent_id: "safety_critic_agent",
    agent_label: "Safety Critic Agent",
    mode,
    system_prompt: "",
    user_prompt:
      "Skipped before prompting because blocking deterministic clarification is needed.",
    provider_attempts: [
      {
        provider: "deterministic",
        attempted: true,
        success: true,
        parsed_response: skippedSafetyCriticAgentOutput,
      },
    ],
    selected_provider: "deterministic",
    used_ai: false,
    fallback_used: true,
    status: "skipped",
    llm_calls_made: 0,
    final_output: skippedSafetyCriticAgentOutput,
  };

  function getSafetyCriticAgentDebug(
    resultWithMaybeDebug: unknown,
  ): AgentDebugInfo {
    const maybeDebug = (resultWithMaybeDebug as { debug?: AgentDebugInfo })
      .debug;

    if (maybeDebug) {
      return maybeDebug;
    }

    const output = (
      resultWithMaybeDebug as { output: typeof skippedSafetyCriticAgentOutput }
    ).output;
    const llmCallsMade =
      (resultWithMaybeDebug as { llm_calls_made?: number }).llm_calls_made ?? 0;

    return {
      agent_id: "safety_critic_agent",
      agent_label: "Safety Critic Agent",
      mode,
      system_prompt: "",
      user_prompt: "Safety Critic Agent returned without debug metadata.",
      provider_attempts: [
        {
          provider: output.provider,
          attempted: true,
          success: output.used_ai,
          parsed_response: output,
          error_summary: output.fallback_used ? output.reason : undefined,
        },
      ],
      selected_provider: output.provider,
      used_ai: output.used_ai,
      fallback_used: output.fallback_used,
      status: output.status,
      llm_calls_made: llmCallsMade,
      final_output: output,
    };
  }

  await emitProgress(emit, {
    type: "step_started",
    step_id: "safety_critic_agent",
    label: "Safety Critic",
    kind: "agent",
    message: shouldSkipDesignAgents
      ? "Skipping AI critique until blocking clarification is answered."
      : "Reviewing the blueprint with the Safety Critic agent.",
  });

  const safetyCriticAgentResult = shouldSkipDesignAgents
    ? {
        output: skippedSafetyCriticAgentOutput,
        llm_calls_made: 0,
        debug: skippedSafetyCriticDebug,
      }
    : await runSafetyCriticAgent({
        processInput: semanticInput,
        mode,
        signals,
        risks,
        readiness,
        routerDecision: routerResult.decision,
        clarificationPlan,
        deterministicBlueprint: deterministicResult,
        blueprintArchitectOutput: blueprintArchitectAgentResult.output,
      });

  await emitProgress(emit, {
    type: "step_completed",
    step_id: "safety_critic_agent",
    label: "Safety Critic",
    status: shouldSkipDesignAgents
      ? "skipped"
      : agentCompletionStatus(safetyCriticAgentResult.output),
    provider: safetyCriticAgentResult.output.provider,
    message: shouldSkipDesignAgents
      ? "Safety Critic skipped because clarification is needed first."
      : safetyCriticAgentResult.output.used_ai
        ? `Safety Critic used ${safetyCriticAgentResult.output.provider}.`
        : safetyCriticAgentResult.output.reason,
  });

  const safetyCriticAgentSummary = safetyCriticAgentResult.output.used_ai
    ? `Safety Critic Agent found ${safetyCriticAgentResult.output.concerns.length} concern(s).`
    : `Safety Critic Agent fallback: ${safetyCriticAgentResult.output.reason}`;

  await emitProgress(emit, {
    type: "step_started",
    step_id: "final_guard",
    label: "Final Guard",
    kind: "validation",
    message: "Preparing and validating the final compile result.",
  });

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
      description:
        "Summarize visible process structure with deterministic rules.",
      status: "done",
      tool_name: "signalScanner",
      output_summary: detectedPrimitiveSummary,
    },
    {
      id: "rule_based_risk_review",
      label: "Rule-Based Risk Review",
      description:
        "Summarize risk level and review requirements with deterministic rules.",
      status: "done",
      tool_name: "riskScanner",
      output_summary: `Risk level is ${risks.risk_level}; human review ${risks.requires_human_review ? "is required" : "is not required"}.`,
    },
    {
      id: "clarification_planner",
      label: "Clarification Planner",
      description:
        "Determine whether clarification is needed before building a reliable blueprint.",
      status: "done",
      tool_name: "clarificationPlanner",
      output_summary: clarificationSummary,
    },
    {
      id: "clarification_agent",
      label: "Clarification Agent",
      description:
        "Use an AI agent, when available, to improve missing-detail questions.",
      status: "done",
      tool_name: "clarificationAgent",
      output_summary: clarificationAgentSummary,
      token_cost: clarificationAgentResult.llm_calls_made,
    },
    {
      id: "blueprint_architect_agent",
      label: "Blueprint Architect Agent",
      description: shouldSkipDesignAgents
        ? "Skipped AI blueprint design because deterministic clarification is needed first."
        : "Use an AI agent, when available, to propose a structured non-executing blueprint.",
      status: shouldSkipDesignAgents ? "skipped" : "done",
      tool_name: "blueprintArchitectAgent",
      output_summary: blueprintArchitectSummary,
      token_cost: blueprintArchitectAgentResult.llm_calls_made,
    },
    {
      id: "dynamic_blueprint_preview",
      label: "Dynamic Blueprint Preview",
      description: aiResult
        ? "Use the validated AI Blueprint Architect output as the primary workflow design."
        : "Use the deterministic safe blueprint because no valid AI blueprint was available.",
      status: "done",
      tool_name: aiResult ? "blueprintFromArchitectOutput" : "blueprintBuilder",
      output_summary: `${result.workflow_name} is ready for UI preview.`,
    },
    {
      id: "safety_critic_review",
      label: "Safety Critic Review",
      description:
        "Review the blueprint boundary and explain what must stay gated, draft-only, or blocked.",
      status: "done",
      tool_name: "safetyCritic",
      output_summary: safetyCriticReview.summary,
    },
    {
      id: "safety_critic_agent",
      label: "Safety Critic Agent",
      description: shouldSkipDesignAgents
        ? "Skipped AI critique because deterministic clarification is needed first."
        : "Use an AI agent, when available, to critique the proposed automation blueprint.",
      status: shouldSkipDesignAgents ? "skipped" : "done",
      tool_name: "safetyCriticAgent",
      output_summary: safetyCriticAgentSummary,
      token_cost: safetyCriticAgentResult.llm_calls_made,
    },
  ];

  const totalAgentLlmCalls =
    routerResult.llm_calls_made +
    clarificationAgentResult.llm_calls_made +
    blueprintArchitectAgentResult.llm_calls_made +
    safetyCriticAgentResult.llm_calls_made;

  const tokenUsage: TokenUsage = {
    mode,
    llm_calls_used: totalAgentLlmCalls,
    llm_calls_limit: llmCallLimits[mode],
    estimated_input_tokens: Math.max(1, Math.ceil(semanticInput.length / 4)),
    rule_based_checks: 6,
    skipped_ai_calls: routerResult.attempts.filter((attempt) => {
      return attempt.provider !== "deterministic" && !attempt.attempted;
    }).length,
  };

  const compileJob: CompileJob = {
    id: jobId,
    status: "done",
    mode,
    created_at: now,
    updated_at: now,
    input: {
      raw: rawInput,
      trimmed: semanticInput,
    },
    steps,
    signals,
    risks,
    readiness,
    result,
    router_decision: routerResult.decision,
    clarification_plan: clarificationPlan,
    clarification_agent: clarificationAgentResult.output,
    blueprint_architect_agent: blueprintArchitectAgentResult.output,
    safety_critic_agent: safetyCriticAgentResult.output,
    agent_debug: {
      clarification_agent: clarificationAgentResult.debug,
      blueprint_architect_agent: blueprintArchitectAgentResult.debug,
      safety_critic_agent: getSafetyCriticAgentDebug(safetyCriticAgentResult),
    },
    safety_critic: safetyCriticReview,
    agent_trace: [
      {
        id: "trace_initialize",
        timestamp: now,
        actor: "compiler_agent",
        action: "Created rule-based compile job",
        status: "completed",
        output_summary: "Rule-based compile state created.",
        metadata: {
          provider_calls: 0,
          external_execution: false,
        },
      },
      ...routerResult.attempts.map((attempt, index) => ({
        id: `trace_router_${attempt.provider}_${index}`,
        timestamp: new Date().toISOString(),
        actor:
          attempt.provider === "deterministic"
            ? ("system" as const)
            : ("llm" as const),
        action: `Router attempt: ${attempt.provider}`,
        status: attempt.success
          ? ("completed" as const)
          : attempt.attempted
            ? ("failed" as const)
            : ("skipped" as const),
        reason: attempt.skipped_reason || attempt.error_summary,
        metadata: {
          validation_failed: attempt.validation_failed,
        },
      })),
      {
        id: "trace_router_decision",
        timestamp: new Date().toISOString(),
        actor: "compiler_agent",
        action: "Router decision selected",
        status: "completed",
        output_summary: `Route: ${routerResult.decision.route} (${routerResult.decision.provider})`,
        metadata: {
          used_ai: routerResult.decision.used_ai,
          fallback_used: routerResult.decision.fallback_used,
          confidence: routerResult.decision.confidence,
        },
      },
      {
        id: "trace_clarification_planner",
        timestamp: now,
        actor: "tool",
        action: "Ran deterministic clarification planner",
        status: "completed",
        tool_name: "clarificationPlanner",
        output_summary: clarificationSummary,
        metadata: {
          clarification_needed: clarificationPlan.needed,
          missing_field_count: clarificationPlan.missing_fields.length,
        },
      },
      {
        id: "trace_clarification_agent",
        timestamp: now,
        actor: clarificationAgentResult.output.used_ai ? "llm" : "system",
        action: "Ran Clarification Agent",
        status: "completed",
        tool_name: "clarificationAgent",
        output_summary: clarificationAgentSummary,
        metadata: {
          used_ai: clarificationAgentResult.output.used_ai,
          fallback_used: clarificationAgentResult.output.fallback_used,
          provider: clarificationAgentResult.output.provider,
          question_count: clarificationAgentResult.output.questions.length,
        },
      },
      {
        id: "trace_blueprint_architect_agent",
        timestamp: now,
        actor: blueprintArchitectAgentResult.output.used_ai ? "llm" : "system",
        action: shouldSkipDesignAgents
          ? "Skipped Blueprint Architect Agent"
          : "Ran Blueprint Architect Agent",
        status: shouldSkipDesignAgents ? "skipped" : "completed",
        tool_name: "blueprintArchitectAgent",
        output_summary: blueprintArchitectSummary,
        metadata: {
          used_ai: blueprintArchitectAgentResult.output.used_ai,
          fallback_used: blueprintArchitectAgentResult.output.fallback_used,
          provider: blueprintArchitectAgentResult.output.provider,
          proposed_step_count:
            blueprintArchitectAgentResult.output.proposed_steps.length,
          skipped_because_clarification_needed: shouldSkipDesignAgents,
          blocking_missing_fields: blockingMissingFields.join(", "),
        },
      },
      {
        id: "trace_build_blueprint",
        timestamp: now,
        actor: aiResult ? "llm" : "tool",
        action: aiResult
          ? "Selected validated AI blueprint"
          : "Used deterministic blueprint fallback",
        status: "completed",
        tool_name: aiResult
          ? "blueprintFromArchitectOutput"
          : "blueprintBuilder",
        output_summary: result.workflow_name,
        metadata: {
          blueprint_source: aiResult
            ? "blueprint_architect_agent"
            : "deterministic_fallback",
          architect_provider: blueprintArchitectAgentResult.output.provider,
          architect_used_ai: blueprintArchitectAgentResult.output.used_ai,
          architect_fallback_used:
            blueprintArchitectAgentResult.output.fallback_used,
          readiness_score: readiness.score,
          risk_count: risks.categories.length,
          separated_safety_constraint_count:
            analysisInput.safetyConstraints.length,
        },
      },
      {
        id: "trace_safety_critic",
        timestamp: now,
        actor: "tool",
        action: "Ran deterministic safety critic",
        status: "completed",
        tool_name: "safetyCritic",
        output_summary: safetyCriticReview.summary,
        metadata: {
          finding_count: safetyCriticReview.findings.length,
          overall_status: safetyCriticReview.overall_status,
        },
      },
      {
        id: "trace_safety_critic_agent",
        timestamp: now,
        actor: safetyCriticAgentResult.output.used_ai ? "llm" : "system",
        action: shouldSkipDesignAgents
          ? "Skipped Safety Critic Agent"
          : "Ran Safety Critic Agent",
        status: shouldSkipDesignAgents ? "skipped" : "completed",
        tool_name: "safetyCriticAgent",
        output_summary: safetyCriticAgentSummary,
        metadata: {
          used_ai: safetyCriticAgentResult.output.used_ai,
          fallback_used: safetyCriticAgentResult.output.fallback_used,
          provider: safetyCriticAgentResult.output.provider,
          concern_count: safetyCriticAgentResult.output.concerns.length,
          skipped_because_clarification_needed: shouldSkipDesignAgents,
          blocking_missing_fields: blockingMissingFields.join(", "),
        },
      },
    ],
    token_usage: tokenUsage,
  };

  const validation = safeValidateCompileJob(compileJob);

  if (!validation.success) {
      console.error("[compile final validation] Failed", {
    issues: validation.issues,
    blueprintProvider: blueprintArchitectAgentResult.output.provider,
    safetyProvider: safetyCriticAgentResult.output.provider,
    clarificationProvider: clarificationAgentResult.output.provider,
  });
    await emitProgress(emit, {
      type: "step_failed",
      step_id: "final_guard",
      label: "Final Guard",
      status: "failed",
      message: "Compile job failed schema validation.",
    });

    throw createError({
      statusCode: 500,
      statusMessage: "Compile job failed schema validation.",
      data: {
        issues: validation.issues,
      },
    });
  }

  await emitProgress(emit, {
    type: "step_completed",
    step_id: "final_guard",
    label: "Final Guard",
    status: "deterministic_success",
    message:
      validation.data.safety_critic?.next_safe_action ||
      "Final guard completed.",
  });
  await emitProgress(emit, {
    type: "done",
    job: validation.data,
  });

  return validation.data;
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

  return runCompilePipeline({
    rawInput,
    mode,
  });
});
