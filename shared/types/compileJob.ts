import type { AgentTraceEvent } from "./agentTrace";
import type {
  AgentDebugBundle,
  BlueprintArchitectOutput,
  ClarificationAgentOutput,
  SafetyCriticAgentOutput,
} from "./agentOutputs";
import type {
  AutomationReadinessScore,
  RiskSummary,
  SafeAutomationBlueprint,
  SignalSummary,
} from "./workflow";

export type CompileMode = "demo" | "rule_only" | "balanced" | "full";

export type CompileJobStatus =
  | "queued"
  | "running"
  | "needs_user"
  | "done"
  | "failed";

export type PipelineStepStatus =
  | "queued"
  | "running"
  | "done"
  | "skipped"
  | "failed";

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

export type RouterRoute =
  | "compile_blueprint"
  | "needs_clarification"
  | "suggest_safer_workflow"
  | "assistant_only"
  | "out_of_scope"
  | "reject";

export type RouterDecision = {
  route: RouterRoute;
  confidence: "low" | "medium" | "high";
  reason: string;
  safety_note: string;
  suggested_next_step: string;
  user_message?: string;
  provider: "openai" | "groq" | "gemini" | "deterministic";
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

export type SafetyCriticSeverity =
  | "info"
  | "warning"
  | "blocker";

export type SafetyCriticFindingType =
  | "safe_to_automate"
  | "draft_only"
  | "human_approval_required"
  | "blocked_in_mvp"
  | "needs_clarification"
  | "implementation_warning";

export type SafetyCriticFinding = {
  id: string;
  type: SafetyCriticFindingType;
  severity: SafetyCriticSeverity;
  title: string;
  explanation: string;
  recommendation: string;
  related_step_ids: string[];
  related_risk_ids: string[];
  related_gate_ids: string[];
};

export type SafetyCriticReview = {
  overall_status:
    | "safe_internal_preview"
    | "needs_human_approval"
    | "needs_clarification"
    | "not_safe_to_automate";
  summary: string;
  findings: SafetyCriticFinding[];
  safe_to_automate: string[];
  must_remain_draft_only: string[];
  requires_human_approval: string[];
  blocked_or_not_recommended: string[];
  next_safe_action: string;
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
  clarification_agent?: ClarificationAgentOutput;
  blueprint_architect_agent?: BlueprintArchitectOutput;
  safety_critic_agent?: SafetyCriticAgentOutput;
  agent_debug?: AgentDebugBundle;
  safety_critic?: SafetyCriticReview;
  result: SafeAutomationBlueprint;
  agent_trace: AgentTraceEvent[];
  token_usage: TokenUsage;
  error?: string;
};

export type CompileProgressStepStatus =
  | "ai_success"
  | "deterministic_success"
  | "fallback_success"
  | "skipped"
  | "failed";

export type CompileProgressEvent =
  | {
      type: "step_started";
      step_id: string;
      label: string;
      kind:
        | "agent"
        | "deterministic"
        | "provider"
        | "validation";
      message: string;
      provider?: string;
      timestamp: string;
    }
  | {
      type: "step_completed";
      step_id: string;
      label: string;
      status: CompileProgressStepStatus;
      message: string;
      provider?: string;
      timestamp: string;
    }
  | {
      type: "step_failed";
      step_id: string;
      label: string;
      status: "failed" | "fallback_success";
      message: string;
      provider?: string;
      timestamp: string;
    }
  | {
      type: "done";
      job: CompileJob;
      timestamp: string;
    }
  | {
      type: "error";
      message: string;
      timestamp: string;
    };