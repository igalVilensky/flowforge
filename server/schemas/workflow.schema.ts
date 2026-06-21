import { z } from "zod";
import type {
  AutomationBoundary,
  AutomationReadinessScore,
  DryRunTestCase,
  HumanApprovalGate,
  RealWorldExecutionPolicy,
  RiskCategory,
  RiskItem,
  RiskLevel,
  RiskSummary,
  SafeAutomationBlueprint,
  SignalSummary,
  StepAutomationPolicy,
  WorkflowActor,
  WorkflowPrimitive,
  WorkflowStep,
  WorkflowTrigger,
} from "../../shared/types/workflow";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const workflowPrimitiveSchema = z.enum([
  "intake",
  "classification",
  "extraction",
  "risk_detection",
  "routing",
  "drafting",
  "approval",
  "validation",
  "notification",
  "record_creation",
  "monitoring",
  "escalation",
  "summarization",
  "reporting",
  "export",
]) satisfies z.ZodType<WorkflowPrimitive>;

export const workflowActorSchema = z.enum([
  "human",
  "ai",
  "system",
  "rules",
  "rules_and_ai",
]) satisfies z.ZodType<WorkflowActor>;

export const riskLevelSchema = z.enum(["low", "medium", "high"]) satisfies z.ZodType<RiskLevel>;

export const riskCategorySchema = z.enum([
  "external_communication",
  "personal_data",
  "financial",
  "legal",
  "medical",
  "visa_or_immigration",
  "employment",
  "refund_or_payment",
  "complaint_or_angry_user",
  "delete_or_destructive_action",
  "account_access",
  "high_stakes_decision",
  "real_world_execution",
]) satisfies z.ZodType<RiskCategory>;

export const automationBoundarySchema = z.enum([
  "fully_automatable",
  "partially_automatable",
  "human_approval_required",
  "assistant_only",
  "not_safe_to_automate",
]) satisfies z.ZodType<AutomationBoundary>;

export const stepAutomationPolicySchema = z.enum([
  "automate",
  "draft_only",
  "human_approval",
  "assist_only",
  "not_recommended",
  "blocked_in_mvp",
]) satisfies z.ZodType<StepAutomationPolicy>;

export const realWorldExecutionPolicySchema = z.enum([
  "none",
  "draft_only",
  "requires_human_trigger",
  "blocked_in_mvp",
]) satisfies z.ZodType<RealWorldExecutionPolicy>;

export const workflowTriggerSchema = z
  .object({
    type: z.enum(["manual_input", "incoming_message", "scheduled", "webhook", "unknown"]),
    source: requiredString.optional(),
    description: requiredString,
  })
  .strict() satisfies z.ZodType<WorkflowTrigger>;

export const workflowStepSchema = z
  .object({
    id: requiredString,
    label: requiredString,
    description: requiredString,
    primitive: workflowPrimitiveSchema,
    actor: workflowActorSchema,
    input: requiredString,
    output: requiredString,
    automation_policy: stepAutomationPolicySchema,
    approval_required: z.boolean(),
    risk_level: riskLevelSchema,
    risk_categories: z.array(riskCategorySchema),
    real_world_execution: realWorldExecutionPolicySchema,
  })
  .strict() satisfies z.ZodType<WorkflowStep>;

export const riskItemSchema = z
  .object({
    id: requiredString,
    label: requiredString,
    category: riskCategorySchema,
    risk_level: riskLevelSchema,
    reason: requiredString,
    recommendation: requiredString,
    step_ids: z.array(requiredString),
  })
  .strict() satisfies z.ZodType<RiskItem>;

export const humanApprovalGateSchema = z
  .object({
    id: requiredString,
    label: requiredString,
    required: z.boolean(),
    applies_to_step_ids: z.array(requiredString),
    reason: requiredString,
    review_checklist: z.array(requiredString),
  })
  .strict() satisfies z.ZodType<HumanApprovalGate>;

export const dryRunTestCaseSchema = z
  .object({
    id: requiredString,
    name: requiredString,
    input_event: requiredString,
    expected_route: requiredString,
    expected_human_gate: z.boolean(),
    reason: requiredString,
  })
  .strict() satisfies z.ZodType<DryRunTestCase>;

export const safeAutomationBlueprintSchema = z
  .object({
    id: requiredString,
    workflow_name: requiredString,
    summary: requiredString,
    automation_boundary: automationBoundarySchema,
    trigger: workflowTriggerSchema,
    steps: z.array(workflowStepSchema),
    safe_to_automate: z.array(requiredString),
    needs_human_approval: z.array(requiredString),
    not_recommended: z.array(requiredString),
    not_safe_to_automate: z.array(requiredString),
    risks: z.array(riskItemSchema),
    human_approval_gates: z.array(humanApprovalGateSchema),
    test_cases: z.array(dryRunTestCaseSchema),
    assumptions: z.array(requiredString),
    open_questions: z.array(requiredString),
  })
  .strict() satisfies z.ZodType<SafeAutomationBlueprint>;

export const signalSummarySchema = z
  .object({
    has_trigger: z.boolean(),
    has_repeated_process: z.boolean(),
    has_external_action: z.boolean(),
    has_sensitive_data: z.boolean(),
    has_clear_output: z.boolean(),
    has_decision_points: z.boolean(),
    has_human_actor: z.boolean(),
    has_system_actor: z.boolean(),
    risk_flags: z.array(riskCategorySchema),
    missing_critical_info: z.array(requiredString),
    rough_actions: z.array(requiredString),
    possible_tools: z.array(requiredString),
    workflow_primitives: z.array(workflowPrimitiveSchema),
  })
  .strict() satisfies z.ZodType<SignalSummary>;

export const riskSummarySchema = z
  .object({
    categories: z.array(riskCategorySchema),
    risk_level: riskLevelSchema,
    reasons: z.array(requiredString),
    requires_human_review: z.boolean(),
  })
  .strict() satisfies z.ZodType<RiskSummary>;

export const automationReadinessScoreSchema = z
  .object({
    score: z.number().min(0).max(100),
    strengths: z.array(requiredString),
    weaknesses: z.array(requiredString),
  })
  .strict() satisfies z.ZodType<AutomationReadinessScore>;
