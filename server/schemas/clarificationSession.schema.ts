import { z } from "zod";
import type {
    ClarificationKnownFacts,
    ClarificationNextQuestion,
    ClarificationQuestionKind,
    ClarificationSession,
    ClarificationSessionAnswer,
    ClarificationSessionRequest,
    ClarificationSessionResponse,
    ClarificationSessionStatus,
} from "../../shared/types/clarificationSession";

const requiredString = z.string().trim().min(1);

export const clarificationQuestionKindSchema = z.enum([
    "workflow_goal",
    "task_type",
    "trigger",
    "data_source",
    "input_data",
    "desired_output",
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

export const clarificationKnownFactsSchema = z.object({
    workflow_goal: z.string().trim().optional(),
    task_type: z.string().trim().optional(),
    trigger: z.string().trim().optional(),
    data_source: z.string().trim().optional(),
    input_data: z.array(requiredString).optional(),
    desired_output: z.string().trim().optional(),
    decision_rules: z.array(requiredString).optional(),
    human_owner: z.string().trim().optional(),
    approval_boundary: z.string().trim().optional(),
    external_action_boundary: z.string().trim().optional(),
    success_criteria: z.string().trim().optional(),
    safety_notes: z.array(requiredString).optional(),
}).strict() satisfies z.ZodType<ClarificationKnownFacts>;

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
    known_facts: clarificationKnownFactsSchema,
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

export const clarificationProviderSchema = z.enum(["groq", "gemini", "deterministic"]);

export const clarificationSessionResponseSchema = z.object({
    session: clarificationSessionSchema,
    used_ai: z.boolean(),
    provider: clarificationProviderSchema,
    fallback_used: z.boolean(),
    raw_response: z.string().optional(),
}).strict() satisfies z.ZodType<ClarificationSessionResponse>;