import type {
  CompileJob,
  CompileMode,
  PipelineStep,
  TokenUsage,
} from "../../shared/types/compileJob";
import { buildBlueprint } from "../services/blueprintBuilder";
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
  const detectedPrimitiveSummary =
    signals.workflow_primitives.length > 0
      ? `Detected ${signals.workflow_primitives.join(", ")} primitives.`
      : "No clear workflow primitives detected yet.";
  const now = new Date().toISOString();
  const jobId = `compile_${Date.now()}`;
  const result = buildBlueprint({
    jobId,
    processInput: trimmedInput,
    signals,
    risks,
    readiness,
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
      id: "dynamic_blueprint_preview",
      label: "Dynamic Blueprint Preview",
      description: "Build a deterministic safe automation blueprint from scanner output.",
      status: "done",
      tool_name: "blueprintBuilder",
      output_summary: `${result.workflow_name} is ready for UI preview.`,
    },
  ];

  const tokenUsage: TokenUsage = {
    mode,
    llm_calls_used: 0,
    llm_calls_limit: llmCallLimits[mode],
    estimated_input_tokens: Math.max(1, Math.ceil(trimmedInput.length / 4)),
    rule_based_checks: 5,
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
        output_summary: "Rule-based compile state created.",
        metadata: {
          provider_calls: 0,
          external_execution: false,
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
