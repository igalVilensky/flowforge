import type { CompileJob } from "../../shared/types/compileJob";
import { validBlueprint } from "./validBlueprint";

export const validCompileJob: CompileJob = {
  id: "compile_fixture_support_triage",
  status: "done",
  mode: "demo",
  created_at: "2026-06-21T10:00:00.000Z",
  updated_at: "2026-06-21T10:00:00.000Z",
  input: {
    raw: "When a customer asks for a refund, classify the reason, draft a reply, and route payment decisions to a human.",
    trimmed: "When a customer asks for a refund, classify the reason, draft a reply, and route payment decisions to a human.",
  },
  steps: [
    {
      id: "initialize_compile_job",
      label: "Initialize compile job",
      description: "Create a fixture compile job from the submitted process.",
      status: "done",
      tool_name: "fixtureCompiler",
      output_summary: "Compile state created without provider calls.",
    },
    {
      id: "validate_blueprint_schema",
      label: "Validate blueprint schema",
      description: "Check the generated blueprint against the shared runtime schema.",
      status: "done",
      tool_name: "schemaValidator",
      output_summary: "Blueprint fixture passed validation.",
      token_cost: 0,
    },
  ],
  signals: {
    has_trigger: true,
    has_repeated_process: true,
    has_external_action: true,
    has_sensitive_data: false,
    has_clear_output: true,
    has_decision_points: true,
    has_human_actor: true,
    has_system_actor: true,
    risk_flags: ["external_communication", "refund_or_payment", "financial", "real_world_execution"],
    missing_critical_info: [
      "Refund policy source is not attached.",
      "Payment system permissions are intentionally out of scope.",
    ],
    rough_actions: [
      "Intake the incoming message",
      "Classify the refund reason",
      "Draft a response",
      "Route customer-facing and payment actions to a human",
      "Block automatic execution",
    ],
    possible_tools: ["schema validator", "risk scanner", "approval gate generator"],
    workflow_primitives: ["intake", "classification", "drafting", "approval", "validation"],
  },
  risks: {
    categories: ["external_communication", "refund_or_payment", "financial", "real_world_execution"],
    risk_level: "high",
    reasons: [
      "Customer communication is external.",
      "Refund decisions affect payment outcomes.",
      "The MVP must not execute real-world actions automatically.",
    ],
    requires_human_review: true,
  },
  readiness: {
    score: 68,
    strengths: [
      "The workflow has a clear trigger and repeated shape.",
      "Drafting and classification can stay inside a safe boundary.",
    ],
    weaknesses: [
      "Refund policy and payment permissions need human ownership.",
      "Execution must remain blocked in the MVP.",
    ],
  },
  result: validBlueprint,
  agent_trace: [
    {
      id: "trace_fixture_compile",
      timestamp: "2026-06-21T10:00:00.000Z",
      actor: "compiler_agent",
      action: "Built valid compile job fixture",
      status: "completed",
      output_summary: "Fixture compile job is ready for schema validation.",
      metadata: {
        provider_calls: 0,
        external_execution: false,
      },
    },
  ],
  token_usage: {
    mode: "demo",
    llm_calls_used: 0,
    llm_calls_limit: 0,
    estimated_input_tokens: 27,
    rule_based_checks: 2,
    skipped_ai_calls: 0,
  },
};
