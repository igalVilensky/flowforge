import type {
  CompileJob,
  CompileMode,
  PipelineStep,
  TokenUsage,
} from "../../shared/types/compileJob";
import { buildBlueprint } from "../services/blueprintBuilder";
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
  const routerResult = await routeCompileRequest(trimmedInput, signals, risks, readiness, mode);
  const clarificationPlan = buildClarificationPlan({
    processInput: trimmedInput,
    signals,
    risks,
    readiness,
    route: routerResult.decision.route,
  });

  const clarificationAgentResult = await runClarificationAgent({
    processInput: trimmedInput,
    mode,
    signals,
    risks,
    clarificationPlan,
  });

  const blueprintArchitectAgentResult = await runBlueprintArchitectAgent({
    processInput: trimmedInput,
    mode,
    signals,
    risks,
    readiness,
    routerDecision: routerResult.decision,
    clarificationPlan,
  });

  const displayedPrimitives = signals.workflow_primitives.filter((primitive) => {
    if (primitive === "approval" && !risks.requires_human_review) {
      return false;
    }

    if (primitive === "risk_detection" && risks.categories.length === 0) {
      return false;
    }

    return true;
  });

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

  const blueprintArchitectSummary = blueprintArchitectAgentResult.output.used_ai
    ? `Blueprint Architect proposed ${blueprintArchitectAgentResult.output.proposed_steps.length} step(s).`
    : `Blueprint Architect fallback: ${blueprintArchitectAgentResult.output.reason}`;

  const now = new Date().toISOString();
  const jobId = `compile_${Date.now()}`;
  const result = buildBlueprint({
    jobId,
    processInput: trimmedInput,
    signals,
    risks,
    readiness,
    mode,
  });
  const safetyCriticReview = buildSafetyCriticReview({
    signals,
    risks,
    readiness,
    routerDecision: routerResult.decision,
    clarificationPlan,
    blueprint: result,
  });

  const safetyCriticAgentResult = await runSafetyCriticAgent({
    processInput: trimmedInput,
    mode,
    signals,
    risks,
    readiness,
    routerDecision: routerResult.decision,
    clarificationPlan,
    deterministicBlueprint: result,
    blueprintArchitectOutput: blueprintArchitectAgentResult.output,
  });

  const safetyCriticAgentSummary = safetyCriticAgentResult.output.used_ai
    ? `Safety Critic Agent found ${safetyCriticAgentResult.output.concerns.length} concern(s).`
    : `Safety Critic Agent fallback: ${safetyCriticAgentResult.output.reason}`;

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
      output_summary: `Risk level is ${risks.risk_level}; human review ${risks.requires_human_review ? "is required" : "is not required"
        }.`,
    },
    {
      id: "clarification_planner",
      label: "Clarification Planner",
      description: "Determine whether clarification is needed before building a reliable blueprint.",
      status: "done",
      tool_name: "clarificationPlanner",
      output_summary: clarificationSummary,
    },
    {
      id: "clarification_agent",
      label: "Clarification Agent",
      description: "Use an AI agent, when available, to improve missing-detail questions.",
      status: "done",
      tool_name: "clarificationAgent",
      output_summary: clarificationAgentSummary,
      token_cost: clarificationAgentResult.llm_calls_made,
    },
    {
      id: "blueprint_architect_agent",
      label: "Blueprint Architect Agent",
      description: "Use an AI agent, when available, to propose a structured non-executing blueprint.",
      status: "done",
      tool_name: "blueprintArchitectAgent",
      output_summary: blueprintArchitectSummary,
      token_cost: blueprintArchitectAgentResult.llm_calls_made,
    },
    {
      id: "dynamic_blueprint_preview",
      label: "Dynamic Blueprint Preview",
      description: "Build a deterministic safe automation blueprint from scanner output.",
      status: "done",
      tool_name: "blueprintBuilder",
      output_summary: `${result.workflow_name} is ready for UI preview.`,
    },
    {
      id: "safety_critic_review",
      label: "Safety Critic Review",
      description: "Review the blueprint boundary and explain what must stay gated, draft-only, or blocked.",
      status: "done",
      tool_name: "safetyCritic",
      output_summary: safetyCriticReview.summary,
    },
    {
      id: "safety_critic_agent",
      label: "Safety Critic Agent",
      description: "Use an AI agent, when available, to critique the proposed automation blueprint.",
      status: "done",
      tool_name: "safetyCriticAgent",
      output_summary: safetyCriticAgentSummary,
      token_cost: safetyCriticAgentResult.llm_calls_made,
    },
  ];

  const totalAgentLlmCalls =
    routerResult.llm_calls_made
    + clarificationAgentResult.llm_calls_made
    + blueprintArchitectAgentResult.llm_calls_made
    + safetyCriticAgentResult.llm_calls_made;

  const tokenUsage: TokenUsage = {
    mode,
    llm_calls_used: totalAgentLlmCalls,
    llm_calls_limit: llmCallLimits[mode],
    estimated_input_tokens: Math.max(1, Math.ceil(trimmedInput.length / 4)),
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
      trimmed: trimmedInput,
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
        actor: attempt.provider === "deterministic" ? "system" as const : "llm" as const,
        action: `Router attempt: ${attempt.provider}`,
        status: attempt.success ? "completed" as const : (attempt.attempted ? "failed" as const : "skipped" as const),
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
        action: "Ran Blueprint Architect Agent",
        status: "completed",
        tool_name: "blueprintArchitectAgent",
        output_summary: blueprintArchitectSummary,
        metadata: {
          used_ai: blueprintArchitectAgentResult.output.used_ai,
          fallback_used: blueprintArchitectAgentResult.output.fallback_used,
          provider: blueprintArchitectAgentResult.output.provider,
          proposed_step_count: blueprintArchitectAgentResult.output.proposed_steps.length,
        },
      },
      {
        id: "trace_build_blueprint",
        timestamp: now,
        actor: "tool",
        action: "Built dynamic safe automation blueprint",
        status: "completed",
        tool_name: "blueprintBuilder",
        output_summary: result.workflow_name,
        metadata: {
          readiness_score: readiness.score,
          risk_count: risks.categories.length,
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
        action: "Ran Safety Critic Agent",
        status: "completed",
        tool_name: "safetyCriticAgent",
        output_summary: safetyCriticAgentSummary,
        metadata: {
          used_ai: safetyCriticAgentResult.output.used_ai,
          fallback_used: safetyCriticAgentResult.output.fallback_used,
          provider: safetyCriticAgentResult.output.provider,
          concern_count: safetyCriticAgentResult.output.concerns.length,
        },
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