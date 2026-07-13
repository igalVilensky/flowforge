import type { StructuredWorkflowIntent } from "./structuredWorkflowIntent";

export type ClarificationQuestionKind =
    | "workflow_goal"
    | "task_type"
    | "trigger"
    | "data_source"
    | "input_data"
    | "desired_output"
    | "output_destination"
    | "notification_target"
    | "decision_rules"
    | "human_owner"
    | "approval_boundary"
    | "external_action_boundary"
    | "success_criteria"
    | "other";

export type ClarificationSessionStatus =
    | "needs_answer"
    | "ready_to_compile"
    | "cannot_continue";

export type ClarificationSessionAnswer = {
    question_id: string;
    question: string;
    answer: string;
};

export type ClarificationNextQuestion = {
    id: string;
    kind: ClarificationQuestionKind;
    question: string;
    why_it_matters: string;
    example_answer?: string;
};

export type ClarificationSession = {
    session_id: string;
    original_input: string;
    current_summary: string;
    intent: StructuredWorkflowIntent;
    answers: ClarificationSessionAnswer[];
    next_question: ClarificationNextQuestion | null;
    status: ClarificationSessionStatus;
    ready_to_compile: boolean;
    rewritten_compile_prompt?: string;
    reason: string;
};

export type ClarificationSessionRequest = {
    original_input: string;
    answers?: ClarificationSessionAnswer[];
};

export type ClarificationProviderAttempt = {
    provider: "openai" | "groq" | "gemini" | "deterministic";
    attempted: boolean;
    success: boolean;
    error_summary?: string;
};

export type ClarificationSessionResponse = {
    session: ClarificationSession;
    used_ai: boolean;
    provider: "openai" | "groq" | "gemini" | "deterministic";
    fallback_used: boolean;
    provider_attempts: ClarificationProviderAttempt[];
    raw_response?: string;
};
