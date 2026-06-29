import type {
    ClarificationField,
    SafetyCriticFindingType,
    SafetyCriticSeverity,
} from "./compileJob";
import type {
    RiskCategory,
    RiskLevel,
    StepAutomationPolicy,
    WorkflowPrimitive,
} from "./workflow";

export type AgentOutputProvider = "groq" | "gemini" | "deterministic";

export type AgentOutputConfidence = "low" | "medium" | "high";

export type AgentOutputStatus =
    | "used_ai"
    | "fallback_used"
    | "skipped"
    | "failed_validation";

export type AgentOutputMeta = {
    provider: AgentOutputProvider;
    used_ai: boolean;
    fallback_used: boolean;
    confidence: AgentOutputConfidence;
    status: AgentOutputStatus;
    reason: string;
};

export type AgentProviderDebugAttempt = {
    provider: AgentOutputProvider;
    attempted: boolean;
    success: boolean;
    error_summary?: string;
    raw_error_summary?: string;
    warning_summary?: string;
    raw_response?: string;
    parsed_response?: unknown;
};

export type AgentDebugInfo = {
    agent_id: "clarification_agent" | "blueprint_architect_agent" | "safety_critic_agent";
    agent_label: string;
    mode: string;
    system_prompt: string;
    user_prompt: string;
    provider_attempts: AgentProviderDebugAttempt[];
    selected_provider: AgentOutputProvider;
    used_ai: boolean;
    fallback_used: boolean;
    status: AgentOutputStatus;
    llm_calls_made: number;
    final_output: unknown;
};

export type AgentDebugBundle = {
    clarification_agent?: AgentDebugInfo;
    blueprint_architect_agent?: AgentDebugInfo;
    safety_critic_agent?: AgentDebugInfo;
};

export type ClarificationAgentQuestion = {
    field: ClarificationField;
    question: string;
    why_it_matters: string;
    example_answer: string;
};

export type ClarificationAgentOutput = AgentOutputMeta & {
    rewritten_summary: string;
    questions: ClarificationAgentQuestion[];
    improved_prompt_starter: string;
};

export type BlueprintArchitectStep = {
    id: string;
    label: string;
    primitive: WorkflowPrimitive;
    description: string;
    input: string;
    output: string;
    automation_policy: StepAutomationPolicy;
    risk_level: RiskLevel;
    approval_required: boolean;
};

export type BlueprintArchitectGate = {
    id: string;
    label: string;
    reason: string;
    applies_to_step_ids: string[];
    required: boolean;
};

export type BlueprintArchitectRisk = {
    id: string;
    category: RiskCategory;
    label: string;
    risk_level: RiskLevel;
    reason: string;
    recommendation: string;
};

export type BlueprintArchitectOutput = AgentOutputMeta & {
    workflow_name: string;
    summary: string;
    proposed_steps: BlueprintArchitectStep[];
    proposed_human_approval_gates: BlueprintArchitectGate[];
    proposed_risks: BlueprintArchitectRisk[];
    safe_to_automate: string[];
    must_remain_draft_only: string[];
    requires_human_approval: string[];
    blocked_or_not_recommended: string[];
    assumptions: string[];
    open_questions: string[];
    safer_alternative: string;
};

export type SafetyCriticAgentConcern = {
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

export type SafetyCriticAgentOutput = AgentOutputMeta & {
    critic_summary: string;
    concerns: SafetyCriticAgentConcern[];
    recommended_human_gates: string[];
    draft_only_warnings: string[];
    blocked_or_not_recommended: string[];
    safer_alternative: string;
    final_advice: string;
};
