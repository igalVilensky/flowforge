import type { AgentTraceEvent } from "./agentTrace";
import type {
  AutomationReadinessScore,
  RiskSummary,
  SafeAutomationBlueprint,
  SignalSummary,
} from "./workflow";

export type CompileMode = "demo" | "rule_only" | "balanced" | "full";

export type CompileJobStatus = "queued" | "running" | "needs_user" | "done" | "failed";

export type PipelineStepStatus = "queued" | "running" | "done" | "skipped" | "failed";

export type PipelineStep = {
  id: string;
  label: string;
  description: string;
  status: PipelineStepStatus;
  tool_name?: string;
  output_summary?: string;
  token_cost?: number;
};

export type TokenUsage = {
  mode: CompileMode;
  llm_calls_used: number;
  llm_calls_limit: number;
  estimated_input_tokens: number;
  rule_based_checks: number;
  skipped_ai_calls: number;
};

export type CompileRequest = {
  input: string;
  mode: CompileMode;
};

export type CompileInput = {
  raw: string;
  trimmed: string;
};

export type RouterDecision = {
  route: "compile_blueprint" | "needs_clarification" | "suggest_safer_workflow" | "assistant_only" | "reject";
  confidence: "low" | "medium" | "high";
  reason: string;
  safety_note: string;
  suggested_next_step: string;
  provider: "groq" | "gemini" | "deterministic";
  used_ai: boolean;
  fallback_used: boolean;
};

export type ClarificationField =
  | "trigger"
  | "input_data"
  | "output"
  | "decision_rules"
  | "human_owner"
  | "approval_boundary"
  | "external_action_boundary"
  | "data_source"
  | "success_criteria";

export type ClarificationQuestion = {
  field: ClarificationField;
  question: string;
  why_it_matters: string;
  example_answer?: string;
};

export type ClarificationPlan = {
  needed: boolean;
  reason: string;
  missing_fields: ClarificationField[];
  questions: ClarificationQuestion[];
  suggested_template: string;
  improved_prompt_starter: string;
};

export type CompileJob = {
  id: string;
  status: CompileJobStatus;
  mode: CompileMode;
  created_at: string;
  updated_at: string;
  input: CompileInput;
  steps: PipelineStep[];
  signals: SignalSummary;
  risks: RiskSummary;
  readiness: AutomationReadinessScore;
  router_decision?: RouterDecision;
  clarification_plan?: ClarificationPlan;
  result: SafeAutomationBlueprint;
  agent_trace: AgentTraceEvent[];
  token_usage: TokenUsage;
  error?: string;
};
