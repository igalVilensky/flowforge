import { z } from "zod";
import type {
  ClarificationField,
  ClarificationPlan,
  ClarificationQuestion,
  CompileInput,
  CompileJob,
  CompileJobStatus,
  CompileMode,
  PipelineStep,
  PipelineStepStatus,
  SafetyCriticFinding,
  SafetyCriticFindingType,
  SafetyCriticReview,
  SafetyCriticSeverity,
  TokenUsage,
} from "../../shared/types/compileJob";
import type {
  AgentTraceActor,
  AgentTraceEvent,
  AgentTraceStatus,
} from "../../shared/types/agentTrace";
import {
  automationReadinessScoreSchema,
  riskSummarySchema,
  safeAutomationBlueprintSchema,
  signalSummarySchema,
} from "./workflow.schema";
import { routerDecisionSchema } from "./router.schema";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const compileModeSchema = z.enum([
  "demo",
  "rule_only",
  "balanced",
  "full",
]) satisfies z.ZodType<CompileMode>;

export const compileJobStatusSchema = z.enum([
  "queued",
  "running",
  "needs_user",
  "done",
  "failed",
]) satisfies z.ZodType<CompileJobStatus>;

export const pipelineStepStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "skipped",
  "failed",
]) satisfies z.ZodType<PipelineStepStatus>;

export const pipelineStepSchema = z
  .object({
    id: requiredString,
    label: requiredString,
    description: requiredString,
    status: pipelineStepStatusSchema,
    tool_name: requiredString.optional(),
    output_summary: requiredString.optional(),
    token_cost: z.number().nonnegative().optional(),
  })
  .strict() satisfies z.ZodType<PipelineStep>;

export const tokenUsageSchema = z
  .object({
    mode: compileModeSchema,
    llm_calls_used: z.number().int().nonnegative(),
    llm_calls_limit: z.number().int().nonnegative(),
    estimated_input_tokens: z.number().int().nonnegative(),
    rule_based_checks: z.number().int().nonnegative(),
    skipped_ai_calls: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<TokenUsage>;

export const compileInputSchema = z
  .object({
    raw: z.string(),
    trimmed: requiredString,
  })
  .strict() satisfies z.ZodType<CompileInput>;

export const agentTraceActorSchema = z.enum([
  "compiler_agent",
  "tool",
  "llm",
  "system",
]) satisfies z.ZodType<AgentTraceActor>;

export const agentTraceStatusSchema = z.enum([
  "started",
  "completed",
  "failed",
  "skipped",
]) satisfies z.ZodType<AgentTraceStatus>;

export const agentTraceEventSchema = z
  .object({
    id: requiredString,
    timestamp: requiredString,
    actor: agentTraceActorSchema,
    action: requiredString,
    status: agentTraceStatusSchema,
    tool_name: requiredString.optional(),
    input_summary: requiredString.optional(),
    output_summary: requiredString.optional(),
    reason: requiredString.optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict() satisfies z.ZodType<AgentTraceEvent>;

export const clarificationFieldSchema = z.enum([
  "trigger",
  "input_data",
  "output",
  "decision_rules",
  "human_owner",
  "approval_boundary",
  "external_action_boundary",
  "data_source",
  "success_criteria",
]) satisfies z.ZodType<ClarificationField>;

export const clarificationQuestionSchema = z
  .object({
    field: clarificationFieldSchema,
    question: requiredString,
    why_it_matters: requiredString,
    example_answer: requiredString.optional(),
  })
  .strict() satisfies z.ZodType<ClarificationQuestion>;

export const clarificationPlanSchema = z
  .object({
    needed: z.boolean(),
    reason: z.string(),
    missing_fields: z.array(clarificationFieldSchema),
    questions: z.array(clarificationQuestionSchema),
    suggested_template: z.string(),
    improved_prompt_starter: z.string(),
  })
  .strict() satisfies z.ZodType<ClarificationPlan>;

export const safetyCriticSeveritySchema = z.enum([
  "info",
  "warning",
  "blocker",
]) satisfies z.ZodType<SafetyCriticSeverity>;

export const safetyCriticFindingTypeSchema = z.enum([
  "safe_to_automate",
  "draft_only",
  "human_approval_required",
  "blocked_in_mvp",
  "needs_clarification",
  "implementation_warning",
]) satisfies z.ZodType<SafetyCriticFindingType>;

export const safetyCriticFindingSchema = z
  .object({
    id: requiredString,
    type: safetyCriticFindingTypeSchema,
    severity: safetyCriticSeveritySchema,
    title: requiredString,
    explanation: requiredString,
    recommendation: requiredString,
    related_step_ids: z.array(requiredString),
    related_risk_ids: z.array(requiredString),
    related_gate_ids: z.array(requiredString),
  })
  .strict() satisfies z.ZodType<SafetyCriticFinding>;

export const safetyCriticReviewSchema = z
  .object({
    overall_status: z.enum([
      "safe_internal_preview",
      "needs_human_approval",
      "needs_clarification",
      "not_safe_to_automate",
    ]),
    summary: requiredString,
    findings: z.array(safetyCriticFindingSchema),
    safe_to_automate: z.array(requiredString),
    must_remain_draft_only: z.array(requiredString),
    requires_human_approval: z.array(requiredString),
    blocked_or_not_recommended: z.array(requiredString),
    next_safe_action: requiredString,
  })
  .strict() satisfies z.ZodType<SafetyCriticReview>;

export const compileJobSchema = z
  .object({
    id: requiredString,
    status: compileJobStatusSchema,
    mode: compileModeSchema,
    created_at: requiredString,
    updated_at: requiredString,
    input: compileInputSchema,
    steps: z.array(pipelineStepSchema),
    signals: signalSummarySchema,
    risks: riskSummarySchema,
    readiness: automationReadinessScoreSchema,
    router_decision: routerDecisionSchema.optional(),
    clarification_plan: clarificationPlanSchema.optional(),
    safety_critic: safetyCriticReviewSchema.optional(),
    result: safeAutomationBlueprintSchema,
    agent_trace: z.array(agentTraceEventSchema),
    token_usage: tokenUsageSchema,
    error: requiredString.optional(),
  })
  .strict() satisfies z.ZodType<CompileJob>;