import { z } from "zod";
import type {
    AgentOutputConfidence,
    AgentOutputMeta,
    AgentOutputProvider,
    AgentOutputStatus,
    BlueprintArchitectGate,
    BlueprintArchitectOutput,
    BlueprintArchitectRisk,
    BlueprintArchitectStep,
    ClarificationAgentOutput,
    ClarificationAgentQuestion,
    SafetyCriticAgentConcern,
    SafetyCriticAgentOutput,
} from "../../shared/types/agentOutputs";
import type {
    ClarificationField,
    SafetyCriticFindingType,
    SafetyCriticSeverity,
} from "../../shared/types/compileJob";
import {
    riskCategorySchema,
    riskLevelSchema,
    stepAutomationPolicySchema,
    workflowPrimitiveSchema,
} from "./workflow.schema";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const agentOutputProviderSchema = z.enum([
    "openai",
    "groq",
    "gemini",
    "deterministic",
]) satisfies z.ZodType<AgentOutputProvider>;

export const agentOutputConfidenceSchema = z.enum([
    "low",
    "medium",
    "high",
]) satisfies z.ZodType<AgentOutputConfidence>;

export const agentOutputStatusSchema = z.enum([
    "used_ai",
    "fallback_used",
    "skipped",
    "failed_validation",
]) satisfies z.ZodType<AgentOutputStatus>;

export const clarificationFieldSchema = z.enum([
    "task_type",
    "trigger",
    "input_source",
    "input_data",
    "desired_output",
    "output_destination",
    "notification_target",
    "decision_rules",
    "human_owner",
    "approval_boundary",
    "external_action_boundary",
    "success_criteria",
]) satisfies z.ZodType<ClarificationField>;

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

export const agentOutputMetaSchema = z
    .object({
        provider: agentOutputProviderSchema,
        used_ai: z.boolean(),
        fallback_used: z.boolean(),
        confidence: agentOutputConfidenceSchema,
        status: agentOutputStatusSchema,
        reason: requiredString,
    })
    .strict() satisfies z.ZodType<AgentOutputMeta>;

export const clarificationAgentQuestionSchema = z
    .object({
        field: clarificationFieldSchema,
        question: requiredString,
        why_it_matters: requiredString,
        example_answer: requiredString,
    })
    .strict() satisfies z.ZodType<ClarificationAgentQuestion>;

export const clarificationAgentOutputSchema = agentOutputMetaSchema
    .extend({
        rewritten_summary: requiredString,
        questions: z.array(clarificationAgentQuestionSchema),
        improved_prompt_starter: requiredString,
    })
    .strict() satisfies z.ZodType<ClarificationAgentOutput>;

export const blueprintArchitectStepSchema = z
    .object({
        id: requiredString,
        label: requiredString,
        primitive: workflowPrimitiveSchema,
        description: requiredString,
        input: requiredString,
        output: requiredString,
        automation_policy: stepAutomationPolicySchema,
        risk_level: riskLevelSchema,
        approval_required: z.boolean(),
    })
    .strict() satisfies z.ZodType<BlueprintArchitectStep>;

export const blueprintArchitectGateSchema = z
    .object({
        id: requiredString,
        label: requiredString,
        reason: requiredString,
        applies_to_step_ids: z.array(requiredString),
        required: z.boolean(),
    })
    .strict() satisfies z.ZodType<BlueprintArchitectGate>;

export const blueprintArchitectRiskSchema = z
    .object({
        id: requiredString,
        category: riskCategorySchema,
        label: requiredString,
        risk_level: riskLevelSchema,
        reason: requiredString,
        recommendation: requiredString,
    })
    .strict() satisfies z.ZodType<BlueprintArchitectRisk>;

export const blueprintArchitectOutputSchema = agentOutputMetaSchema
    .extend({
        workflow_name: requiredString,
        summary: requiredString,
        proposed_steps: z.array(blueprintArchitectStepSchema),
        proposed_human_approval_gates: z.array(blueprintArchitectGateSchema),
        proposed_risks: z.array(blueprintArchitectRiskSchema),
        safe_to_automate: z.array(requiredString),
        must_remain_draft_only: z.array(requiredString),
        requires_human_approval: z.array(requiredString),
        blocked_or_not_recommended: z.array(requiredString),
        assumptions: z.array(requiredString),
        open_questions: z.array(requiredString),
        safer_alternative: requiredString,
    })
    .strict() satisfies z.ZodType<BlueprintArchitectOutput>;

export const safetyCriticAgentConcernSchema = z
    .object({
        id: requiredString,
        type: safetyCriticFindingTypeSchema,
        severity: safetyCriticSeveritySchema,
        title: requiredString,
        explanation: requiredString,
        recommendation: requiredString,
        related_step_ids: z.array(requiredString).default([]),
        related_risk_ids: z.array(requiredString).default([]),
        related_gate_ids: z.array(requiredString).default([]),
    })
    .strip() satisfies z.ZodType<SafetyCriticAgentConcern>;

export const safetyCriticAgentOutputSchema = agentOutputMetaSchema
    .extend({
        critic_summary: requiredString,
        concerns: z.array(safetyCriticAgentConcernSchema).default([]),
        recommended_human_gates: z.array(requiredString).default([]),
        draft_only_warnings: z.array(requiredString).default([]),
        blocked_or_not_recommended: z.array(requiredString).default([]),
        safer_alternative: requiredString,
        final_advice: requiredString,
    })
    .strip() satisfies z.ZodType<SafetyCriticAgentOutput>;
