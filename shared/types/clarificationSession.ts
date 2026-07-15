export type ClarificationQuestionKind =
    | "workflow_goal"
    | "task_type"
    | "trigger"
    | "data_source"
    | "input_data"
    | "desired_output"
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

export type ClarificationKnownFacts = {
    workflow_goal?: string;
    task_type?: string;
    trigger?: string;
    data_source?: string;
    input_data?: string[];
    desired_output?: string;
    decision_rules?: string[];
    human_owner?: string;
    approval_boundary?: string;
    external_action_boundary?: string;
    success_criteria?: string;
    safety_notes?: string[];
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
    known_facts: ClarificationKnownFacts;
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

export type ClarificationSessionResponse = {
    session: ClarificationSession;
    used_ai: boolean;
    provider: "openai" | "groq" | "gemini" | "deterministic";
    fallback_used: boolean;
    raw_response?: string;
};