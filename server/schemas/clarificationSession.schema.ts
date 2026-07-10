import { z } from "zod";
import type {
    ClarificationNextQuestion,
    ClarificationProviderAttempt,
    ClarificationQuestionKind,
    ClarificationSession,
    ClarificationSessionAnswer,
    ClarificationSessionRequest,
    ClarificationSessionResponse,
    ClarificationSessionStatus,
} from "../../shared/types/clarificationSession";
import { structuredWorkflowIntentSchema } from "./structuredWorkflowIntent.schema";

const requiredString = z.string().trim().min(1);

export const clarificationQuestionKindSchema = z.enum([
    "workflow_goal",
    "task_type",
    "trigger",
    "data_source",
    "input_data",
    "desired_output",
    "output_destination",
    "notification_target",
    "decision_rules",
    "human_owner",
    "approval_boundary",
    "external_action_boundary",
    "success_criteria",
    "other",
]) satisfies z.ZodType<ClarificationQuestionKind>;

export const clarificationSessionStatusSchema = z.enum([
    "needs_answer",
    "ready_to_compile",
    "cannot_continue",
]) satisfies z.ZodType<ClarificationSessionStatus>;

export const clarificationSessionAnswerSchema = z.object({
    question_id: requiredString,
    question: requiredString,
    answer: requiredString,
}).strict() satisfies z.ZodType<ClarificationSessionAnswer>;

export const clarificationNextQuestionSchema = z.object({
    id: requiredString,
    kind: clarificationQuestionKindSchema,
    question: requiredString,
    why_it_matters: requiredString,
    example_answer: z.string().trim().optional(),
}).strict() satisfies z.ZodType<ClarificationNextQuestion>;

export const clarificationSessionSchema = z.object({
    session_id: requiredString,
    original_input: requiredString,
    current_summary: requiredString,
    intent: structuredWorkflowIntentSchema,
    answers: z.array(clarificationSessionAnswerSchema),
    next_question: clarificationNextQuestionSchema.nullable(),
    status: clarificationSessionStatusSchema,
    ready_to_compile: z.boolean(),
    rewritten_compile_prompt: z.string().trim().optional(),
    reason: requiredString,
}).strict() satisfies z.ZodType<ClarificationSession>;

export const clarificationSessionRequestSchema = z.object({
    original_input: requiredString,
    answers: z.array(clarificationSessionAnswerSchema).optional().default([]),
}).strict() satisfies z.ZodType<ClarificationSessionRequest>;

export const clarificationProviderSchema = z.enum(["openai", "groq", "gemini", "deterministic"]);

export const clarificationProviderAttemptSchema = z.object({
    provider: clarificationProviderSchema,
    attempted: z.boolean(),
    success: z.boolean(),
    error_summary: z.string().optional(),
}).strict() satisfies z.ZodType<ClarificationProviderAttempt>;

export const clarificationSessionResponseSchema = z.object({
    session: clarificationSessionSchema,
    used_ai: z.boolean(),
    provider: clarificationProviderSchema,
    fallback_used: z.boolean(),
    provider_attempts: z.array(clarificationProviderAttemptSchema),
    raw_response: z.string().optional(),
}).strict() satisfies z.ZodType<ClarificationSessionResponse>;
