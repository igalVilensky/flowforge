import { ZodError } from "zod";
import type {
    AgentDebugInfo,
    AgentProviderDebugAttempt,
    AgentOutputProvider,
    ClarificationAgentOutput,
    ClarificationAgentQuestion,
} from "../../shared/types/agentOutputs";
import type { CompileMode, ClarificationPlan } from "../../shared/types/compileJob";
import type { RiskSummary, SignalSummary } from "../../shared/types/workflow";
import {
    buildClarificationAgentUserPrompt,
    clarificationAgentSystemPrompt,
} from "../prompts/clarificationAgentPrompt";
import { clarificationAgentOutputSchema } from "../schemas/agentOutputs.schema";
import { callGemini } from "./geminiProvider";
import { callGroq } from "./groqProvider";

export type RunClarificationAgentInput = {
    processInput: string;
    mode: CompileMode;
    signals: SignalSummary;
    risks: RiskSummary;
    clarificationPlan: ClarificationPlan;
};

export type ClarificationAgentResult = {
    output: ClarificationAgentOutput;
    llm_calls_made: number;
    debug: AgentDebugInfo;
};

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
            throw new Error("No valid JSON object found in Clarification Agent response.");
        }

        return JSON.parse(match[0]);
    }
}

function fallbackQuestion(question: ClarificationPlan["questions"][number]): ClarificationAgentQuestion {
    return {
        field: question.field,
        question: question.question,
        why_it_matters: question.why_it_matters,
        example_answer: question.example_answer ?? "Provide a concrete example for this missing detail.",
    };
}

function buildFallbackOutput(input: RunClarificationAgentInput, provider: AgentOutputProvider, reason: string): ClarificationAgentOutput {
    return {
        provider,
        used_ai: false,
        fallback_used: true,
        confidence: input.clarificationPlan.needed ? "medium" : "high",
        status: "fallback_used",
        reason,
        rewritten_summary: input.clarificationPlan.needed
            ? input.clarificationPlan.reason || "Some details are missing before this workflow can be safely planned."
            : "No clarification is needed for this workflow.",
        questions: input.clarificationPlan.questions.map(fallbackQuestion),
        improved_prompt_starter:
            input.clarificationPlan.improved_prompt_starter
            || input.clarificationPlan.suggested_template
            || "When [trigger happens], read [data source], create [safe internal output], and keep external actions human-reviewed.",
    };
}

function normalizeQuestion(rawQuestion: unknown, fallback: ClarificationAgentQuestion, index: number): ClarificationAgentQuestion {
    const question = rawQuestion && typeof rawQuestion === "object"
        ? rawQuestion as Partial<ClarificationAgentQuestion>
        : {};

    return {
        field: question.field ?? fallback.field,
        question: question.question && question.question.trim().length > 0
            ? question.question
            : fallback.question,
        why_it_matters: question.why_it_matters && question.why_it_matters.trim().length > 0
            ? question.why_it_matters
            : fallback.why_it_matters,
        example_answer: question.example_answer && question.example_answer.trim().length > 0
            ? question.example_answer
            : fallback.example_answer || `Example answer for clarification item ${index + 1}.`,
    };
}

function normalizeAgentOutput(
    parsed: unknown,
    provider: AgentOutputProvider,
    input: RunClarificationAgentInput,
): ClarificationAgentOutput {
    const raw = parsed && typeof parsed === "object"
        ? parsed as Record<string, unknown>
        : {};

    const fallbackQuestions = input.clarificationPlan.questions.map(fallbackQuestion);
    const rawQuestions = Array.isArray(raw.questions) ? raw.questions : [];

    const questions = fallbackQuestions.map((fallback, index) => {
        return normalizeQuestion(rawQuestions[index], fallback, index);
    });

    const rewrittenSummary =
        typeof raw.rewritten_summary === "string" && raw.rewritten_summary.trim().length > 0
            ? raw.rewritten_summary
            : input.clarificationPlan.reason || "Some details are missing before this workflow can be safely planned.";

    const improvedPromptStarter =
        typeof raw.improved_prompt_starter === "string" && raw.improved_prompt_starter.trim().length > 0
            ? raw.improved_prompt_starter
            : input.clarificationPlan.improved_prompt_starter
            || input.clarificationPlan.suggested_template
            || "When [trigger happens], read [data source], create [safe internal output], and keep external actions human-reviewed.";

    return clarificationAgentOutputSchema.parse({
        provider,
        used_ai: true,
        fallback_used: false,
        confidence: raw.confidence ?? "medium",
        status: "used_ai",
        reason: raw.reason ?? "AI improved the clarification questions and prompt starter.",
        rewritten_summary: rewrittenSummary,
        questions,
        improved_prompt_starter: improvedPromptStarter,
    });
}

function shouldUseAi(mode: CompileMode, clarificationPlan: ClarificationPlan): boolean {
    return (mode === "balanced" || mode === "full") && clarificationPlan.needed;
}

function buildDebugInfo(input: {
    mode: CompileMode;
    userPrompt: string;
    providerAttempts: AgentProviderDebugAttempt[];
    output: ClarificationAgentOutput;
    llmCallsMade: number;
}): AgentDebugInfo {
    return {
        agent_id: "clarification_agent",
        agent_label: "Clarification Agent",
        mode: input.mode,
        system_prompt: clarificationAgentSystemPrompt,
        user_prompt: input.userPrompt,
        provider_attempts: input.providerAttempts,
        selected_provider: input.output.provider,
        used_ai: input.output.used_ai,
        fallback_used: input.output.fallback_used,
        status: input.output.status,
        llm_calls_made: input.llmCallsMade,
        final_output: input.output,
    };
}

export async function runClarificationAgent(input: RunClarificationAgentInput): Promise<ClarificationAgentResult> {
    const prompt = buildClarificationAgentUserPrompt({
        processInput: input.processInput,
        signals: input.signals,
        risks: input.risks,
        clarificationPlan: input.clarificationPlan,
    });

    if (!shouldUseAi(input.mode, input.clarificationPlan)) {
        const output = buildFallbackOutput(input, "deterministic", `Clarification Agent skipped in ${input.mode} mode or no clarification was needed.`);
        const providerAttempts: AgentProviderDebugAttempt[] = [
            {
                provider: "deterministic",
                attempted: true,
                success: true,
                parsed_response: output,
            },
        ];

        return {
            output,
            llm_calls_made: 0,
            debug: buildDebugInfo({
                mode: input.mode,
                userPrompt: prompt,
                providerAttempts,
                output,
                llmCallsMade: 0,
            }),
        };
    }

    let llmCallsMade = 0;
    const providerAttempts: AgentProviderDebugAttempt[] = [];

    if (process.env.GROQ_API_KEY) {
        let rawResponse: string | undefined;
        let parsedResponse: unknown;

        try {
            llmCallsMade += 1;
            rawResponse = await callGroq(prompt, clarificationAgentSystemPrompt);
            parsedResponse = safeParseJSON(rawResponse);
            const output = normalizeAgentOutput(parsedResponse, "groq", input);

            providerAttempts.push({
                provider: "groq",
                attempted: true,
                success: true,
                raw_response: rawResponse,
                parsed_response: parsedResponse,
            });

            return {
                output,
                llm_calls_made: llmCallsMade,
                debug: buildDebugInfo({
                    mode: input.mode,
                    userPrompt: prompt,
                    providerAttempts,
                    output,
                    llmCallsMade,
                }),
            };
        } catch (error) {
            providerAttempts.push({
                provider: "groq",
                attempted: true,
                success: false,
                error_summary: summarizeError(error),
                raw_response: rawResponse,
                parsed_response: parsedResponse,
            });
        }
    } else {
        providerAttempts.push({
            provider: "groq",
            attempted: false,
            success: false,
            error_summary: "GROQ_API_KEY is not configured.",
        });
    }

    if (process.env.GEMINI_API_KEY) {
        let rawResponse: string | undefined;
        let parsedResponse: unknown;

        try {
            llmCallsMade += 1;
            rawResponse = await callGemini(prompt, clarificationAgentSystemPrompt);
            parsedResponse = safeParseJSON(rawResponse);
            const output = normalizeAgentOutput(parsedResponse, "gemini", input);

            providerAttempts.push({
                provider: "gemini",
                attempted: true,
                success: true,
                raw_response: rawResponse,
                parsed_response: parsedResponse,
            });

            return {
                output,
                llm_calls_made: llmCallsMade,
                debug: buildDebugInfo({
                    mode: input.mode,
                    userPrompt: prompt,
                    providerAttempts,
                    output,
                    llmCallsMade,
                }),
            };
        } catch (error) {
            providerAttempts.push({
                provider: "gemini",
                attempted: true,
                success: false,
                error_summary: summarizeError(error),
                raw_response: rawResponse,
                parsed_response: parsedResponse,
            });
        }
    } else {
        providerAttempts.push({
            provider: "gemini",
            attempted: false,
            success: false,
            error_summary: "GEMINI_API_KEY is not configured.",
        });
    }

    const providerErrors = providerAttempts
        .filter((attempt) => attempt.error_summary)
        .map((attempt) => `${attempt.provider}: ${attempt.error_summary}`);

    const reason =
        llmCallsMade > 0
            ? `Clarification Agent provider output failed validation or parsing. ${providerErrors.join(" | ")}`
            : "No Clarification Agent provider key was configured. Deterministic fallback was used.";

    const output = buildFallbackOutput(input, "deterministic", reason);

    providerAttempts.push({
        provider: "deterministic",
        attempted: true,
        success: true,
        parsed_response: output,
    });

    return {
        output,
        llm_calls_made: llmCallsMade,
        debug: buildDebugInfo({
            mode: input.mode,
            userPrompt: prompt,
            providerAttempts,
            output,
            llmCallsMade,
        }),
    };
}