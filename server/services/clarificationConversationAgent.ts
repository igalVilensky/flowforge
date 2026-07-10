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
import {
    getClarificationAnswerKind,
    getConcreteKnownFacts,
    isConcreteKnownFact,
} from "./clarificationFacts";
import { callGeminiAgent } from "./geminiProvider";
import { callGroqAgent } from "./groqProvider";
import { serializeStructuredCompileInput } from "./structuredCompileInput";

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

function intentText(input: RunClarificationConversationAgentInput): string {
    return [
        input.originalInput,
        ...input.answers.map((answer) => answer.answer),
    ].join("\n").toLowerCase();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

export function inferKnownFacts(input: RunClarificationConversationAgentInput): ClarificationKnownFacts {
    const text = intentText(input);
    const answerText = input.answers.map((answer) => answer.answer).join(" ").trim();
    const answersByKind = new Map<string, ClarificationSessionAnswer[]>();

    for (const answer of input.answers) {
        const kind = getClarificationAnswerKind(answer);

        if (!kind || !isConcreteKnownFact(answer.answer, kind)) continue;
        answersByKind.set(kind, [...(answersByKind.get(kind) ?? []), answer]);
    }

    const answerFor = (kind: string) => answersByKind.get(kind)?.at(-1)?.answer;
    const taskType = answerFor("task_type");
    const explicitGoal = answerFor("workflow_goal");
    const trigger = answerFor("trigger");
    const dataSource = answerFor("data_source");
    const inputData = answerFor("input_data");
    const desiredOutput = answerFor("desired_output");
    const humanOwner = answerFor("human_owner");
    const approvalBoundary = answerFor("approval_boundary");
    const externalActionBoundary = answerFor("external_action_boundary");
    const successCriteria = answerFor("success_criteria");

    const knownFacts: ClarificationKnownFacts = {
        workflow_goal: explicitGoal ?? (taskType ? `Create a workflow for ${normalizeText(taskType)}.` : normalizeText(input.originalInput)),
    };

    if (taskType) {
        knownFacts.task_type = normalizeText(taskType);
    } else if (!isVeryVagueTaskRequest(input.originalInput) && input.answers.length === 0) {
        knownFacts.task_type = normalizeText(input.originalInput);
    }

    if (trigger) {
        knownFacts.trigger = normalizeText(trigger);
    } else if (hasAny(input.originalInput.toLowerCase(), [
        /\bon[ -]?demand\b/,
        /\bmanually\b/,
        /\bwhen\b/,
        /\bwhenever\b/,
        /\bevery\b/,
        /\bdaily\b/,
        /\bweekly\b/,
        /\bschedule(?:d)?\b/,
    ])) {
        knownFacts.trigger = normalizeText(input.originalInput);
    }

    if (dataSource) {
        knownFacts.data_source = normalizeText(dataSource);
    } else if (input.answers.length === 0 && hasAny(text, [
        /support inbox|admissions inbox|shared inbox|zendesk|intercom|hubspot|salesforce|gmail/,
        /google sheet|spreadsheet|database|campaign brief|product description|source material|brand assets/,
    ])) {
        knownFacts.data_source = normalizeText(input.originalInput);
    }

    if (inputData) {
        knownFacts.input_data = [normalizeText(inputData)];
    } else if (dataSource && /source material|brief|description|blog|asset|marketing point|product/i.test(dataSource)) {
        knownFacts.input_data = [normalizeText(dataSource)];
    }

    if (desiredOutput) {
        knownFacts.desired_output = normalizeText(desiredOutput);
    } else if (taskType && /content generation|social media content|generate (?:social )?posts?|marketing content|social posts?/i.test(taskType)) {
        knownFacts.desired_output = "Draft social media content and a reviewable post package.";
    } else if (taskType && /\b(?:draft|summarize|classify|extract|route|generate|create)\b/i.test(taskType)) {
        knownFacts.desired_output = normalizeText(taskType);
    } else if (input.answers.length === 0 && hasAny(text, [/\bdraft\b|\bsummarize\b|\bclassify\b|\bextract\b|\bgenerate\b/])) {
        knownFacts.desired_output = normalizeText(input.originalInput);
    }

    const ruleAnswers = answersByKind.get("decision_rules") ?? [];

    if (ruleAnswers.length > 0) {
        knownFacts.decision_rules = ruleAnswers.map((answer) => answer.answer);
    }

    if (humanOwner) {
        knownFacts.human_owner = normalizeText(humanOwner);
    }

    if (approvalBoundary) {
        knownFacts.approval_boundary = normalizeText(approvalBoundary);
    }

    if (externalActionBoundary) {
        knownFacts.external_action_boundary = normalizeText(externalActionBoundary);
    } else if (approvalBoundary && /before (?:posting|publishing|sending)|no automatic|draft.only|external/i.test(approvalBoundary)) {
        knownFacts.external_action_boundary = "External action is blocked until explicit human approval.";
    }

    if (successCriteria) {
        knownFacts.success_criteria = normalizeText(successCriteria);
    }

    if (answerText.length > 0) {
        knownFacts.safety_notes = input.answers.map((answer) => `${answer.question}: ${answer.answer}`);
    }

    return knownFacts;
}

export function hasEnoughInformation(knownFacts: ClarificationKnownFacts): boolean {
    const concrete = getConcreteKnownFacts(knownFacts);

    return Boolean(
        isConcreteKnownFact(concrete.workflow_goal, "workflow_goal")
        && isConcreteKnownFact(concrete.task_type, "task_type")
        && isConcreteKnownFact(concrete.trigger, "trigger")
        && (isConcreteKnownFact(concrete.data_source, "data_source") || isConcreteKnownFact(concrete.input_data, "input_data"))
        && isConcreteKnownFact(concrete.desired_output, "desired_output"),
    );
}

function needsHumanBoundary(input: RunClarificationConversationAgentInput): boolean {
    const text = intentText(input);
    return hasAny(text, [
        /send|reply|email|message|external|publish|posting|social media/,
        /refund|payment|charge|invoice|billing/,
        /legal|medical|visa|immigration|employment/,
        /delete|remove|account|access|update/,
    ]);
}

function hasHumanBoundary(knownFacts: ClarificationKnownFacts): boolean {
    return isConcreteKnownFact(knownFacts.human_owner, "human_owner")
        && (isConcreteKnownFact(knownFacts.approval_boundary, "approval_boundary")
            || isConcreteKnownFact(knownFacts.external_action_boundary, "external_action_boundary"));
}

function buildCompilePrompt(input: RunClarificationConversationAgentInput, knownFacts: ClarificationKnownFacts): string {
    const concreteFacts = getConcreteKnownFacts(knownFacts);

    return serializeStructuredCompileInput({
        original_input: normalizeText(input.originalInput),
        clarified_intent: buildCurrentSummary(input, concreteFacts),
        known_facts: concreteFacts,
        clarification_answers: input.answers,
        safety_constraints: [
            concreteFacts.approval_boundary,
            concreteFacts.external_action_boundary,
            "Build a non-executing FlowForge workflow blueprint.",
            "Keep external actions human-reviewed or draft-only.",
            "Do not connect production credentials or execute real-world actions.",
        ].filter((constraint): constraint is string => Boolean(constraint)),
    });
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
        const previousKind = getClarificationAnswerKind(answer);

        if (answer.question_id === question.id) return true;
        if (previousQuestion === q) return true;
        if (previousKind === question.kind && isConcreteKnownFact(answer.answer, question.kind)) return true;

        if (question.kind === "human_owner" || question.kind === "approval_boundary" || question.kind === "external_action_boundary") {
            return /support lead|channel owner|manager|human|review|approve|before sending|before posting|before publishing|before anything/.test(previousAnswer);
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
    if (!isConcreteKnownFact(knownFacts.task_type, "task_type") || (input.answers.length === 0 && isVeryVagueTaskRequest(input.originalInput))) {
        return {
            id: "choose_task_category",
            kind: "task_type",
            question: "What kind of tasks should FlowForge help with first — emails, tickets, documents, leads, scheduling, or internal admin work?",
            why_it_matters: "FlowForge needs the task category before it can ask useful workflow questions.",
            example_answer: "Support emails from students, or weekly admin reports.",
        };
    }

    if (!isConcreteKnownFact(knownFacts.desired_output, "desired_output") || (input.answers.length === 0 && isVagueEmailRequest(input.originalInput))) {
        return {
            id: "desired_output",
            kind: "desired_output",
            question: "What should the workflow produce?",
            why_it_matters: "The output determines the safe workflow structure.",
            example_answer: "A summary, draft reply, tags, and an internal task.",
        };
    }

    if (!isConcreteKnownFact(knownFacts.trigger, "trigger")) {
        return {
            id: "workflow_trigger",
            kind: "trigger",
            question: "When should this workflow start?",
            why_it_matters: "A safe automation blueprint needs a clear starting event.",
            example_answer: "When a new support ticket is created, or every Friday at 16:00.",
        };
    }

    if (!isConcreteKnownFact(knownFacts.data_source, "data_source") && !isConcreteKnownFact(knownFacts.input_data, "input_data")) {
        const isContentWorkflow = /social media|content generation|generate (?:social )?posts?|marketing content|social post/i.test(
            `${knownFacts.task_type ?? ""} ${knownFacts.desired_output ?? ""}`,
        );

        if (isContentWorkflow) {
            return {
                id: "content_source_material",
                kind: "data_source",
                question: "What source material should the workflow use to generate the social media content, such as a product description, campaign brief, blog post, image assets, or key marketing points?",
                why_it_matters: "The workflow needs concrete source material before it can generate an accurate content draft.",
                example_answer: "A product description, campaign brief, brand assets, and the key marketing points for the post.",
            };
        }

        return {
            id: "workflow_source",
            kind: "data_source",
            question: "Where will the workflow read the items from?",
            why_it_matters: "The source tells FlowForge what system or inbox the workflow watches.",
            example_answer: "The support inbox, Zendesk, Intercom, or a Google Sheet.",
        };
    }

    if (needsHumanBoundary(input) && !isConcreteKnownFact(knownFacts.human_owner, "human_owner")) {
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

export function buildDeterministicClarificationSession(
    input: RunClarificationConversationAgentInput,
    reason: string,
    providedFacts?: ClarificationKnownFacts,
): ClarificationSession {
    const knownFacts = {
        ...(providedFacts ?? {}),
        ...inferKnownFacts(input),
    };

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

export function normalizeAgentSession(
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
            ...(raw.known_facts && typeof raw.known_facts === "object" ? raw.known_facts : {}),
            ...inferredFacts,
        },
        answers: input.answers,
        next_question: raw.next_question ?? null,
        status: raw.status,
        ready_to_compile: raw.ready_to_compile,
        rewritten_compile_prompt: raw.rewritten_compile_prompt,
        reason: raw.reason || "Clarification agent updated the session.",
    };

    let parsedSession = clarificationSessionSchema.parse(candidate);

    if (input.answers.length >= MAX_CLARIFICATION_QUESTIONS) {
        return buildReadySession(
            input,
            parsedSession.known_facts,
            "Question limit reached; compiling with the best available clarified facts.",
        );
    }

    const isExplicitNeedsAnswer = parsedSession.status === "needs_answer"
        && parsedSession.ready_to_compile === false
        && parsedSession.next_question !== null;

    if (isExplicitNeedsAnswer) {
        if (
            questionWasAlreadyAnswered(input, parsedSession.next_question!)
            || hasAlreadyAskedKind(input, parsedSession.next_question!.kind)
        ) {
            return buildReadySession(
                input,
                parsedSession.known_facts,
                "The agent repeated an answered question; compiling with the best available clarified facts.",
            );
        }

        return {
            ...parsedSession,
            rewritten_compile_prompt: undefined,
        };
    }

    const enoughInfo = hasEnoughInformation(parsedSession.known_facts);
    const boundaryOk = !needsHumanBoundary(input) || hasHumanBoundary(parsedSession.known_facts);

    if (parsedSession.ready_to_compile && parsedSession.status === "ready_to_compile" && enoughInfo && boundaryOk) {
        parsedSession = buildReadySession(
            input,
            parsedSession.known_facts,
            "Enough concrete clarification has been collected to compile a safe preview.",
        );
    } else if (parsedSession.ready_to_compile || parsedSession.status === "ready_to_compile") {
        return buildDeterministicClarificationSession(
            input,
            "The provider marked the session ready without enough concrete facts; deterministic clarification continues.",
            parsedSession.known_facts,
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

    const session = buildDeterministicClarificationSession(
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
