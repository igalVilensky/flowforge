import type { CompileJob } from "../../shared/types/compileJob";
import {
  validBlueprint,
  validBlueprintInput,
  validBlueprintReadiness,
  validBlueprintRisks,
  validBlueprintSignals,
} from "./validBlueprint";

const fixtureTimestamp = "2026-06-21T10:00:00.000Z";

export const validCompileJob: CompileJob = {
  id: "compile_fixture_support_triage",
  status: "done",
  mode: "demo",
  created_at: fixtureTimestamp,
  updated_at: fixtureTimestamp,
  input: {
    raw: validBlueprintInput,
    trimmed: validBlueprintInput,
  },
  steps: [
    {
      id: "initialize_compile_job",
      label: "Initialize Compile Job",
      description: "Create a fixture compile job from the submitted process.",
      status: "done",
      tool_name: "fixtureCompiler",
      output_summary: "Compile state created without provider calls.",
    },
    {
      id: "rule_based_signal_scan",
      label: "Rule-Based Signal Scan",
      description: "Summarize visible process structure with deterministic rules.",
      status: "done",
      tool_name: "signalScanner",
      output_summary: `Detected ${validBlueprintSignals.workflow_primitives.join(", ")} primitives.`,
      token_cost: 0,
    },
    {
      id: "dynamic_blueprint_preview",
      label: "Dynamic Blueprint Preview",
      description: "Build a deterministic safe automation blueprint from scanner output.",
      status: "done",
      tool_name: "blueprintBuilder",
      output_summary: `${validBlueprint.workflow_name} is ready for schema validation.`,
      token_cost: 0,
    },
  ],
  signals: validBlueprintSignals,
  risks: validBlueprintRisks,
  readiness: validBlueprintReadiness,
  router_decision: {
    route: "compile_blueprint",
    confidence: "high",
    reason: "Fixture data implies a safe compilation.",
    safety_note: "No execution permitted in fixture mode.",
    suggested_next_step: "Review the blueprint output.",
    provider: "deterministic",
    used_ai: false,
    fallback_used: true,
  },
  result: validBlueprint,
  agent_trace: [
    {
      id: "trace_fixture_compile",
      timestamp: fixtureTimestamp,
      actor: "compiler_agent",
      action: "Built valid compile job fixture",
      status: "completed",
      output_summary: "Fixture compile job is ready for schema validation.",
      metadata: {
        provider_calls: 0,
        external_execution: false,
      },
    },
    {
      id: "trace_fixture_blueprint_builder",
      timestamp: fixtureTimestamp,
      actor: "tool",
      action: "Built dynamic safe automation blueprint",
      status: "completed",
      tool_name: "blueprintBuilder",
      output_summary: validBlueprint.workflow_name,
      metadata: {
        readiness_score: validBlueprintReadiness.score,
        risk_count: validBlueprintRisks.categories.length,
      },
    },
  ],
  token_usage: {
    mode: "demo",
    llm_calls_used: 0,
    llm_calls_limit: 0,
    estimated_input_tokens: Math.max(1, Math.ceil(validBlueprintInput.length / 4)),
    rule_based_checks: 5,
    skipped_ai_calls: 0,
  },
};
