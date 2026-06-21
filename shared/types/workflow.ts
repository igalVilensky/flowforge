export type WorkflowPrimitive =
  | "intake"
  | "classification"
  | "extraction"
  | "risk_detection"
  | "routing"
  | "drafting"
  | "approval"
  | "validation"
  | "notification"
  | "record_creation"
  | "monitoring"
  | "escalation"
  | "summarization"
  | "reporting"
  | "export";

export type WorkflowActor = "human" | "ai" | "system" | "rules" | "rules_and_ai";

export type RiskLevel = "low" | "medium" | "high";

export type RiskCategory =
  | "external_communication"
  | "personal_data"
  | "financial"
  | "legal"
  | "medical"
  | "visa_or_immigration"
  | "employment"
  | "refund_or_payment"
  | "complaint_or_angry_user"
  | "delete_or_destructive_action"
  | "account_access"
  | "high_stakes_decision"
  | "real_world_execution";

export type AutomationBoundary =
  | "fully_automatable"
  | "partially_automatable"
  | "human_approval_required"
  | "assistant_only"
  | "not_safe_to_automate";

export type StepAutomationPolicy =
  | "automate"
  | "draft_only"
  | "human_approval"
  | "assist_only"
  | "not_recommended"
  | "blocked_in_mvp";

export type RealWorldExecutionPolicy =
  | "none"
  | "draft_only"
  | "requires_human_trigger"
  | "blocked_in_mvp";

export type WorkflowTrigger = {
  type: "manual_input" | "incoming_message" | "scheduled" | "webhook" | "unknown";
  source?: string;
  description: string;
};

export type WorkflowStep = {
  id: string;
  label: string;
  description: string;
  primitive: WorkflowPrimitive;
  actor: WorkflowActor;
  input: string;
  output: string;
  automation_policy: StepAutomationPolicy;
  approval_required: boolean;
  risk_level: RiskLevel;
  risk_categories: RiskCategory[];
  real_world_execution: RealWorldExecutionPolicy;
};

export type RiskItem = {
  id: string;
  label: string;
  category: RiskCategory;
  risk_level: RiskLevel;
  reason: string;
  recommendation: string;
  step_ids: string[];
};

export type HumanApprovalGate = {
  id: string;
  label: string;
  required: boolean;
  applies_to_step_ids: string[];
  reason: string;
  review_checklist: string[];
};

export type DryRunTestCase = {
  id: string;
  name: string;
  input_event: string;
  expected_route: string;
  expected_human_gate: boolean;
  reason: string;
};

export type SafeAutomationBlueprint = {
  id: string;
  workflow_name: string;
  summary: string;
  automation_boundary: AutomationBoundary;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  safe_to_automate: string[];
  needs_human_approval: string[];
  not_recommended: string[];
  not_safe_to_automate: string[];
  risks: RiskItem[];
  human_approval_gates: HumanApprovalGate[];
  test_cases: DryRunTestCase[];
  assumptions: string[];
  open_questions: string[];
};

export type SignalSummary = {
  has_trigger: boolean;
  has_scheduled_trigger: boolean;
  has_repeated_process: boolean;
  has_external_action: boolean;
  has_sensitive_data: boolean;
  has_clear_output: boolean;
  has_decision_points: boolean;
  has_human_actor: boolean;
  has_system_actor: boolean;
  risk_flags: RiskCategory[];
  missing_critical_info: string[];
  rough_actions: string[];
  possible_tools: string[];
  workflow_primitives: WorkflowPrimitive[];
};

export type RiskSummary = {
  categories: RiskCategory[];
  risk_level: RiskLevel;
  reasons: string[];
  requires_human_review: boolean;
};

export type AutomationReadinessScore = {
  score: number;
  strengths: string[];
  weaknesses: string[];
};
