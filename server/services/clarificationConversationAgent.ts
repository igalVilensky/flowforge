import { ZodError } from "zod";
import type {
    ClarificationKnownFacts,
    ClarificationNextQuestion,
    ClarificationSession,
    ClarificationSessionAnswer,
    ClarificationSessionResponse,
} from "../../shared/types/clarificationSession";
import {
    clarificationSessionResponseSchema,
    clarificationSessionSchema,
} from "../schemas/clarificationSession.schema";
import {
    buildClarificationConversationUserPrompt,
    clarificationConversationSystemPrompt,
} from "../prompts/clarificationConversationPrompt";
import { callGeminiAgent } from "./geminiProvider";
import { callGroqAgent } from "./groqProvider";

type AgentProvider = ClarificationSessionResponse["provider"];

type RunClarificationConversationAgentInput = {
    originalInput: string;
    answers: ClarificationSessionAnswer[];
};

const MAX_CLARIFICATION_QUESTIONS = 6;

function normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

function summarizeError(error: unknown): string {
    if (error instanceof ZodError) {
        return error.issues
            .slice(0, 5)
            .map((issue) => {
                const path = issue.path.length > 0 ? issue.path.join(".") : "root";
                return `${path}: ${issue.message}`;
            })
            .join("; ");
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "Unknown error.";
}

function safeParseJSON(rawText: string): unknown {
    try {
        return JSON.parse(rawText);
    } catch {
        const match = rawText.match(/\{[\s\S]*\}/);

        if (!match) {
            throw new Error("No valid JSON object found in Clarification Conversation Agent response.");
        }

        return JSON.parse(match[0]);
    }
}

function buildSessionId(originalInput: string, answers: ClarificationSessionAnswer[]): string {
    const seed = `${originalInput}:${answers.length}:${answers.map((answer) => answer.answer).join("|")}`;
    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }

    return `clarify_${Math.abs(hash).toString(36)}`;
}

function allText(input: RunClarificationConversationAgentInput): string {
    return [
        input.originalInput,
        ...input.answers.flatMap((answer) => [answer.question, answer.answer]),
    ].join("\n").toLowerCase();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

function inferKnownFacts(input: RunClarificationConversationAgentInput): ClarificationKnownFacts {
    const text = allText(input);
    const answerText = input.answers.map((answer) => answer.answer).join(" ").trim();

    const knownFacts: ClarificationKnownFacts = {
        workflow_goal: normalizeText(input.originalInput),
    };

    if (hasAny(text, [/email|inbox|message|support ticket|ticket/])) {
        knownFacts.task_type = "email or support ticket management";
    }

    if (hasAny(text, [/when a new|new .*created|new .*arrives|created|arrives|every|daily|weekly|friday|monday|schedule/])) {
        const triggerAnswer = input.answers.find((answer) => /when|start|trigger/i.test(answer.question + " " + answer.answer));
        knownFacts.trigger = triggerAnswer?.answer ?? "A new item arrives or a scheduled review runs.";
    }

    if (hasAny(text, [/inbox|zendesk|intercom|hubspot|salesforce|gmail|email|ticketing system|database|spreadsheet|queue/])) {
        const sourceAnswer = input.answers.find((answer) => /where|source|come from|data source|read/i.test(answer.question));
        knownFacts.data_source = sourceAnswer?.answer ?? "The source mentioned by the user.";
    }

    if (hasAny(text, [/subject|description|customer name|priority|order id|amount|email body|sender|ticket/])) {
        knownFacts.input_data = ["ticket or message details mentioned by the user"];
    }

    if (hasAny(text, [/summary|draft|reply|tag|tags|task|classify|route|extract/])) {
        const outputAnswer = input.answers.find((answer) => /produce|happen|output|what should/i.test(answer.question));
        knownFacts.desired_output = outputAnswer?.answer ?? "A summary, draft, tags, routing, or internal task.";
    }

    const ruleAnswers = input.answers.filter((answer) =>
        /rule|priority|vip|condition|determine|decide|route/i.test(answer.question + " " + answer.answer),
    );

    if (ruleAnswers.length > 0) {
        knownFacts.decision_rules = ruleAnswers.map((answer) => answer.answer);
    }

    if (hasAny(text, [/support lead|manager|human|reviewer|owner|team lead|finance|legal|advisor|approver/])) {
        const ownerAnswer = input.answers.find((answer) => /who|review|owner|approve/i.test(answer.question + " " + answer.answer));
        knownFacts.human_owner = ownerAnswer?.answer ?? "A human reviewer mentioned by the user.";
    }

    if (hasAny(text, [/before sending|before anything|review every|reviews every|approval|approve|human review|draft before/i])) {
        knownFacts.approval_boundary = "Human review is required before external actions.";
        knownFacts.external_action_boundary = "No external message, update, charge, refund, deletion, or execution happens automatically.";
    }

    if (answerText.length > 0) {
        knownFacts.safety_notes = input.answers.map((answer) => `${answer.question}: ${answer.answer}`);
    }

    return knownFacts;
}

function hasEnoughInformation(knownFacts: ClarificationKnownFacts): boolean {
    return Boolean(
        knownFacts.workflow_goal
        && knownFacts.task_type
        && knownFacts.trigger
        && knownFacts.data_source
        && knownFacts.desired_output,
    );
}

function needsHumanBoundary(input: RunClarificationConversationAgentInput): boolean {
    const text = allText(input);
    return hasAny(text, [
        /send|reply|email|message|external/,
        /refund|payment|charge|invoice|billing/,
        /legal|medical|visa|immigration|employment/,
        /delete|remove|account|access|update/,
    ]);
}

function hasHumanBoundary(knownFacts: ClarificationKnownFacts): boolean {
    return Boolean(knownFacts.human_owner && (knownFacts.approval_boundary || knownFacts.external_action_boundary));
}

function buildCompilePrompt(input: RunClarificationConversationAgentInput, knownFacts: ClarificationKnownFacts): string {
    const answers = input.answers
        .map((answer, index) => `${index + 1}. ${answer.question}\nAnswer: ${answer.answer}`)
        .join("\n\n");

    const facts = [
        knownFacts.task_type ? `Task type: ${knownFacts.task_type}` : undefined,
        knownFacts.trigger ? `Trigger: ${knownFacts.trigger}` : undefined,
        knownFacts.data_source ? `Source: ${knownFacts.data_source}` : undefined,
        knownFacts.input_data?.length ? `Input data: ${knownFacts.input_data.join(", ")}` : undefined,
        knownFacts.desired_output ? `Desired output: ${knownFacts.desired_output}` : undefined,
        knownFacts.decision_rules?.length ? `Decision rules: ${knownFacts.decision_rules.join("; ")}` : undefined,
        knownFacts.human_owner ? `Human reviewer: ${knownFacts.human_owner}` : undefined,
        knownFacts.approval_boundary ? `Approval boundary: ${knownFacts.approval_boundary}` : undefined,
        knownFacts.external_action_boundary ? `External action boundary: ${knownFacts.external_action_boundary}` : undefined,
    ].filter(Boolean).join("\n");

    return normalizeText(`Original request: ${input.originalInput}

Clarified workflow facts:
${facts}

Clarification answers:
${answers}

Build a non-executing FlowForge workflow blueprint. Keep all external sending, account changes, payments, refunds, deletions, and high-stakes decisions human-reviewed or draft-only. Do not execute anything.`);
}

function buildReadySession(
    input: RunClarificationConversationAgentInput,
    knownFacts: ClarificationKnownFacts,
    reason: string,
): ClarificationSession {
    return {
        session_id: buildSessionId(input.originalInput, input.answers),
        original_input: normalizeText(input.originalInput),
        current_summary: buildCurrentSummary(input, knownFacts),
        known_facts: knownFacts,
        answers: input.answers,
        next_question: null,
        status: "ready_to_compile",
        ready_to_compile: true,
        rewritten_compile_prompt: buildCompilePrompt(input, knownFacts),
        reason,
    };
}

function buildCurrentSummary(
    input: RunClarificationConversationAgentInput,
    knownFacts: ClarificationKnownFacts,
): string {
    if (knownFacts.task_type && knownFacts.desired_output) {
        return normalizeText(`${knownFacts.task_type}, producing ${knownFacts.desired_output}.`);
    }

    if (input.answers.length > 0) {
        return normalizeText(`${input.originalInput} ${input.answers.map((answer) => answer.answer).join(" ")}`);
    }

    return normalizeText(input.originalInput);
}

function hasAlreadyAskedKind(input: RunClarificationConversationAgentInput, kind: string): boolean {
    const normalizedKind = kind.replaceAll("_", " ");
    return input.answers.some((answer) => {
        const combined = `${answer.question} ${answer.question_id}`.toLowerCase();
        return combined.includes(kind.toLowerCase()) || combined.includes(normalizedKind);
    });
}

function questionWasAlreadyAnswered(input: RunClarificationConversationAgentInput, question: ClarificationNextQuestion): boolean {
    const q = question.question.toLowerCase();
    return input.answers.some((answer) => {
        const previousQuestion = answer.question.toLowerCase();
        const previousAnswer = answer.answer.toLowerCase();

        if (answer.question_id === question.id) return true;
        if (previousQuestion === q) return true;

        if (question.kind === "human_owner" || question.kind === "approval_boundary" || question.kind === "external_action_boundary") {
            return /support lead|manager|human|review|approve|before sending|before anything/.test(previousAnswer);
        }

        if (question.kind === "decision_rules") {
            return /rule|priority|vip|condition|determine/.test(previousAnswer);
        }

        return false;
    });
}

function isVeryVagueTaskRequest(input: string): boolean {
    const normalized = input.toLowerCase().trim();
    return normalized.length < 40
        && /\b(automate|automation|make|build|do)\b/.test(normalized)
        && /\b(task|tasks|work|stuff|things|process|job|jobs)\b/.test(normalized);
}

function isVagueEmailRequest(input: string): boolean {
    const normalized = input.toLowerCase().trim();
    return normalized.length < 80
        && /\b(email|emails|mail|inbox|message|messages)\b/.test(normalized)
        && !/\b(draft|summarize|classify|extract|route|reply|tag|assign)\b/.test(normalized);
}

function createFallbackQuestion(
    input: RunClarificationConversationAgentInput,
    knownFacts: ClarificationKnownFacts,
): ClarificationNextQuestion {
    if (!knownFacts.task_type || (input.answers.length === 0 && isVeryVagueTaskRequest(input.originalInput))) {
        return {
            id: "choose_task_category",
            kind: "task_type",
            question: "What kind of tasks should FlowForge help with first — emails, tickets, documents, leads, scheduling, or internal admin work?",
            why_it_matters: "FlowForge needs the task category before it can ask useful workflow questions.",
            example_answer: "Support emails from students, or weekly admin reports.",
        };
    }

    if (!knownFacts.desired_output || (input.answers.length === 0 && isVagueEmailRequest(input.originalInput))) {
        return {
            id: "desired_output",
            kind: "desired_output",
            question: "What should the workflow produce?",
            why_it_matters: "The output determines the safe workflow structure.",
            example_answer: "A summary, draft reply, tags, and an internal task.",
        };
    }

    if (!knownFacts.trigger) {
        return {
            id: "workflow_trigger",
            kind: "trigger",
            question: "When should this workflow start?",
            why_it_matters: "A safe automation blueprint needs a clear starting event.",
            example_answer: "When a new support ticket is created, or every Friday at 16:00.",
        };
    }

    if (!knownFacts.data_source) {
        return {
            id: "workflow_source",
            kind: "data_source",
            question: "Where will the workflow read the items from?",
            why_it_matters: "The source tells FlowForge what system or inbox the workflow watches.",
            example_answer: "The support inbox, Zendesk, Intercom, or a Google Sheet.",
        };
    }

    if (needsHumanBoundary(input) && !knownFacts.human_owner) {
        return {
            id: "human_reviewer",
            kind: "human_owner",
            question: "Who reviews the result before anything is sent or changed?",
            why_it_matters: "External replies and sensitive actions need accountable human ownership.",
            example_answer: "The support lead reviews every draft before sending.",
        };
    }

    if (needsHumanBoundary(input) && !hasHumanBoundary(knownFacts)) {
        return {
            id: "approval_boundary",
            kind: "approval_boundary",
            question: "What must stay human-approved or draft-only?",
            why_it_matters: "This prevents FlowForge from planning automatic external actions.",
            example_answer: "No replies are sent automatically. The support lead reviews every draft.",
        };
    }

    return {
        id: "success_criteria",
        kind: "success_criteria",
        question: "How will you know the workflow worked correctly?",
        why_it_matters: "Success criteria help FlowForge generate useful dry-run checks.",
        example_answer: "A draft reply, tags, and a support-lead task are created, with no message sent automatically.",
    };
}

function buildFallbackSession(
    input: RunClarificationConversationAgentInput,
    reason: string,
): ClarificationSession {
    const knownFacts = inferKnownFacts(input);

    if (hasEnoughInformation(knownFacts) && (!needsHumanBoundary(input) || hasHumanBoundary(knownFacts))) {
        return buildReadySession(input, knownFacts, "Enough clarification has been collected to compile a safe preview.");
    }

    if (input.answers.length >= MAX_CLARIFICATION_QUESTIONS) {
        return buildReadySession(input, knownFacts, "Question limit reached; compiling with the best available clarified facts.");
    }

    const nextQuestion = createFallbackQuestion(input, knownFacts);

    if (questionWasAlreadyAnswered(input, nextQuestion) || hasAlreadyAskedKind(input, nextQuestion.kind)) {
        return buildReadySession(input, knownFacts, "Repeated clarification detected; compiling with the best available clarified facts.");
    }

    return {
        session_id: buildSessionId(input.originalInput, input.answers),
        original_input: normalizeText(input.originalInput),
        current_summary: buildCurrentSummary(input, knownFacts),
        known_facts: knownFacts,
        answers: input.answers,
        next_question: nextQuestion,
        status: "needs_answer",
        ready_to_compile: false,
        reason,
    };
}

function normalizeAgentSession(
    parsed: unknown,
    input: RunClarificationConversationAgentInput,
): ClarificationSession {
    const raw = parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : {};

    const inferredFacts = inferKnownFacts(input);

    const candidate = {
        session_id: buildSessionId(input.originalInput, input.answers),
        original_input: normalizeText(input.originalInput),
        current_summary: raw.current_summary || buildCurrentSummary(input, inferredFacts),
        known_facts: {
            ...inferredFacts,
            ...(raw.known_facts && typeof raw.known_facts === "object" ? raw.known_facts : {}),
        },
        answers: input.answers,
        next_question: raw.next_question ?? null,
        status: raw.status,
        ready_to_compile: raw.ready_to_compile,
        rewritten_compile_prompt: raw.rewritten_compile_prompt,
        reason: raw.reason || "Clarification agent updated the session.",
    };

    let parsedSession = clarificationSessionSchema.parse(candidate);

    const enoughInfo = hasEnoughInformation(parsedSession.known_facts);
    const boundaryOk = !needsHumanBoundary(input) || hasHumanBoundary(parsedSession.known_facts);

    if ((enoughInfo && boundaryOk) || input.answers.length >= MAX_CLARIFICATION_QUESTIONS) {
        parsedSession = buildReadySession(
            input,
            parsedSession.known_facts,
            input.answers.length >= MAX_CLARIFICATION_QUESTIONS
                ? "Question limit reached; compiling with the best available clarified facts."
                : "Enough clarification has been collected to compile a safe preview.",
        );
    }

    if (parsedSession.ready_to_compile && !parsedSession.rewritten_compile_prompt) {
        parsedSession = {
            ...parsedSession,
            rewritten_compile_prompt: buildCompilePrompt(input, parsedSession.known_facts),
        };
    }

    if (!parsedSession.ready_to_compile && !parsedSession.next_question) {
        throw new Error("A non-ready clarification session requires next_question.");
    }

    if (parsedSession.next_question && questionWasAlreadyAnswered(input, parsedSession.next_question)) {
        return buildReadySession(
            input,
            parsedSession.known_facts,
            "The agent repeated an answered question; compiling with the best available clarified facts.",
        );
    }

    return parsedSession;
}

async function tryProvider(
    provider: "groq" | "gemini",
    userPrompt: string,
): Promise<{ rawResponse: string; parsedResponse: unknown }> {
    const rawResponse = provider === "groq"
        ? await callGroqAgent(userPrompt, clarificationConversationSystemPrompt, {
            modelEnv: "GROQ_CLARIFIER_MODEL",
            fallbackModelEnv: "GROQ_AGENT_MODEL",
            maxTokensEnv: "GROQ_CLARIFIER_MAX_TOKENS",
            fallbackMaxTokensEnv: "GROQ_AGENT_MAX_TOKENS",
            defaultMaxTokens: 1000,
            maxTokensCap: 1800,
            truncationSuggestion: "Raise GROQ_CLARIFIER_MAX_TOKENS to around 1200-1800.",
        })
        : await callGeminiAgent(userPrompt, clarificationConversationSystemPrompt, {
            modelEnv: "GEMINI_CLARIFIER_MODEL",
            fallbackModelEnv: "GEMINI_AGENT_MODEL",
            maxOutputTokensEnv: "GEMINI_CLARIFIER_MAX_OUTPUT_TOKENS",
            fallbackMaxOutputTokensEnv: "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
            defaultMaxOutputTokens: 1000,
            maxOutputTokensCap: 1800,
            truncationSuggestion: "Raise GEMINI_CLARIFIER_MAX_OUTPUT_TOKENS to around 1200-1800.",
        });

    return {
        rawResponse,
        parsedResponse: safeParseJSON(rawResponse),
    };
}

export async function runClarificationConversationAgent(
    input: RunClarificationConversationAgentInput,
): Promise<ClarificationSessionResponse> {
    const preflightFacts = inferKnownFacts(input);

    if (input.answers.length >= MAX_CLARIFICATION_QUESTIONS) {
        return clarificationSessionResponseSchema.parse({
            session: buildReadySession(input, preflightFacts, "Question limit reached; compiling with the best available clarified facts."),
            used_ai: false,
            provider: "deterministic" satisfies AgentProvider,
            fallback_used: true,
        });
    }

    const userPrompt = buildClarificationConversationUserPrompt({
        originalInput: input.originalInput,
        answers: input.answers,
    });

    const providerOrder: Array<"groq" | "gemini"> = ["groq", "gemini"];
    const providerErrors: string[] = [];

    for (const provider of providerOrder) {
        const keyName = provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";

        if (!process.env[keyName]) {
            providerErrors.push(`${provider}: ${keyName} is not configured.`);
            continue;
        }

        try {
            const { rawResponse, parsedResponse } = await tryProvider(provider, userPrompt);
            const session = normalizeAgentSession(parsedResponse, input);

            return clarificationSessionResponseSchema.parse({
                session,
                used_ai: true,
                provider,
                fallback_used: false,
                raw_response: rawResponse,
            });
        } catch (error) {
            providerErrors.push(`${provider}: ${summarizeError(error)}`);
        }
    }

    const session = buildFallbackSession(
        input,
        providerErrors.length > 0
            ? `Clarification agent fallback used. ${providerErrors.join(" | ")}`
            : "Clarification agent fallback used.",
    );

    return clarificationSessionResponseSchema.parse({
        session,
        used_ai: false,
        provider: "deterministic" satisfies AgentProvider,
        fallback_used: true,
    });
}
