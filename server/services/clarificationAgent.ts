import type {
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
};

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

function normalizeAgentOutput(parsed: unknown, provider: AgentOutputProvider): ClarificationAgentOutput {
    return clarificationAgentOutputSchema.parse({
        ...(parsed as Record<string, unknown>),
        provider,
        used_ai: true,
        fallback_used: false,
        status: "used_ai",
    });
}

function shouldUseAi(mode: CompileMode, clarificationPlan: ClarificationPlan): boolean {
    return (mode === "balanced" || mode === "full") && clarificationPlan.needed;
}

export async function runClarificationAgent(input: RunClarificationAgentInput): Promise<ClarificationAgentResult> {
    if (!shouldUseAi(input.mode, input.clarificationPlan)) {
        return {
            output: buildFallbackOutput(input, "deterministic", `Clarification Agent skipped in ${input.mode} mode or no clarification was needed.`),
            llm_calls_made: 0,
        };
    }

    const prompt = buildClarificationAgentUserPrompt({
        processInput: input.processInput,
        signals: input.signals,
        risks: input.risks,
        clarificationPlan: input.clarificationPlan,
    });

    let llmCallsMade = 0;

    if (process.env.GROQ_API_KEY) {
        try {
            llmCallsMade += 1;
            const raw = await callGroq(prompt, clarificationAgentSystemPrompt);
            const parsed = safeParseJSON(raw);

            return {
                output: normalizeAgentOutput(parsed, "groq"),
                llm_calls_made: llmCallsMade,
            };
        } catch {
            // Try Gemini fallback below.
        }
    }

    if (process.env.GEMINI_API_KEY) {
        try {
            llmCallsMade += 1;
            const raw = await callGemini(prompt, clarificationAgentSystemPrompt);
            const parsed = safeParseJSON(raw);

            return {
                output: normalizeAgentOutput(parsed, "gemini"),
                llm_calls_made: llmCallsMade,
            };
        } catch {
            // Deterministic fallback below.
        }
    }

    return {
        output: buildFallbackOutput(
            input,
            "deterministic",
            llmCallsMade > 0
                ? "Clarification Agent provider output failed validation or parsing. Deterministic fallback was used."
                : "No Clarification Agent provider key was configured. Deterministic fallback was used.",
        ),
        llm_calls_made: llmCallsMade,
    };
}