import { ZodError } from "zod";
import type {
    AgentDebugInfo,
    AgentProviderDebugAttempt,
    AgentOutputProvider,
    BlueprintArchitectOutput,
    SafetyCriticAgentOutput,
} from "../../shared/types/agentOutputs";
import type {
    ClarificationPlan,
    CompileMode,
    RouterDecision,
} from "../../shared/types/compileJob";
import type {
    AutomationReadinessScore,
    RiskSummary,
    SafeAutomationBlueprint,
    SignalSummary,
} from "../../shared/types/workflow";
import {
    buildSafetyCriticAgentUserPrompt,
    safetyCriticAgentSystemPrompt,
} from "../prompts/safetyCriticAgentPrompt";
import { safetyCriticAgentOutputSchema } from "../schemas/agentOutputs.schema";
import { callGemini } from "./geminiProvider";
import { callGroq } from "./groqProvider";

export type RunSafetyCriticAgentInput = {
    processInput: string;
    mode: CompileMode;
    signals: SignalSummary;
    risks: RiskSummary;
    readiness: AutomationReadinessScore;
    routerDecision: RouterDecision;
    clarificationPlan: ClarificationPlan;
    deterministicBlueprint: SafeAutomationBlueprint;
    blueprintArchitectOutput?: BlueprintArchitectOutput;
};

export type SafetyCriticAgentResult = {
    output: SafetyCriticAgentOutput;
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

function normalizeProviderFailure(provider: AgentOutputProvider, error: unknown): { summary: string; rawSummary?: string } {
    const rawSummary = summarizeError(error);
    const normalized = rawSummary.toLowerCase();
    const providerName = provider === "groq" ? "Groq" : provider === "gemini" ? "Gemini" : "Provider";

    if (
        normalized.includes("429")
        || normalized.includes("too many requests")
        || normalized.includes("rate limit")
        || normalized.includes("rate_limit")
    ) {
        return {
            summary: `${providerName} rate limit reached. Try again later or use deterministic fallback.`,
            rawSummary,
        };
    }

    if (
        normalized.includes("aborted")
        || normalized.includes("aborterror")
        || normalized.includes("timed out")
        || normalized.includes("timeout")
    ) {
        return {
            summary: `${providerName} request timed out or was aborted before returning a valid response.`,
            rawSummary,
        };
    }

    if (
        error instanceof ZodError
        || normalized.includes("schema")
        || normalized.includes("validation")
        || normalized.includes("invalid json")
        || normalized.includes("no valid json")
        || normalized.includes("failed to parse")
        || normalized.includes("unexpected token")
    ) {
        return {
            summary: "Invalid AI output rejected by schema.",
            rawSummary,
        };
    }

    if (normalized.includes("api_key") || normalized.includes("is not set") || normalized.includes("not configured")) {
        return {
            summary: `${providerName} is not configured. Deterministic fallback can still complete the review.`,
            rawSummary,
        };
    }

    return {
        summary: `${providerName} provider failed. Deterministic fallback can still complete the review.`,
        rawSummary,
    };
}

function safeParseJSON(rawText: string): unknown {
    try {
        return JSON.parse(rawText);
    } catch {
        const match = rawText.match(/\{[\s\S]*\}/);

        if (!match) {
            throw new Error("No valid JSON object found in Safety Critic Agent response.");
        }

        return JSON.parse(match[0]);
    }
}

function buildFallbackOutput(input: RunSafetyCriticAgentInput, provider: AgentOutputProvider, reason: string): SafetyCriticAgentOutput {
    const hasExternalAction = input.signals.has_external_action;
    const needsHumanReview = input.risks.requires_human_review || input.deterministicBlueprint.human_approval_gates.length > 0;

    const hardBlockerCategories = [
        "legal",
        "medical",
        "visa_or_immigration",
        "delete_or_destructive_action",
    ];

    const hasBlockers =
        input.deterministicBlueprint.automation_boundary === "not_safe_to_automate"
        || input.deterministicBlueprint.steps.some((step) =>
            step.automation_policy === "blocked_in_mvp"
            || step.automation_policy === "not_recommended"
            || step.real_world_execution === "blocked_in_mvp",
        )
        || input.risks.categories.some((category) => hardBlockerCategories.includes(category));

    return {
        provider,
        used_ai: false,
        fallback_used: true,
        confidence: hasBlockers ? "high" : needsHumanReview ? "medium" : "high",
        status: "fallback_used",
        reason,
        critic_summary: hasBlockers
            ? "Deterministic checks found blocker-level risk. Keep this workflow as an internal human-reviewed summary only."
            : needsHumanReview
                ? "Deterministic checks found actions that require human approval before any real-world step."
                : "Deterministic checks found this suitable as a non-executing internal preview.",
        concerns: [
            ...(hasExternalAction
                ? [
                    {
                        id: "draft_only_external_communication",
                        type: "draft_only" as const,
                        severity: "warning" as const,
                        title: "External communication must stay draft-only",
                        explanation: "Generated messages can affect real people and should not be sent automatically by the MVP.",
                        recommendation: "Route generated messages to a human reviewer before sending.",
                        related_step_ids: input.deterministicBlueprint.steps.map((step) => step.id),
                        related_risk_ids: input.deterministicBlueprint.risks.map((risk) => risk.id),
                        related_gate_ids: input.deterministicBlueprint.human_approval_gates.map((gate) => gate.id),
                    },
                ]
                : []),
            ...(needsHumanReview
                ? [
                    {
                        id: "human_approval_required",
                        type: "human_approval_required" as const,
                        severity: "warning" as const,
                        title: "Human approval required",
                        explanation: "The workflow includes sensitive or external-facing actions that must be reviewed.",
                        recommendation: "Keep the workflow as assistive or draft-only until a human approves the next step.",
                        related_step_ids: input.deterministicBlueprint.steps.map((step) => step.id),
                        related_risk_ids: input.deterministicBlueprint.risks.map((risk) => risk.id),
                        related_gate_ids: input.deterministicBlueprint.human_approval_gates.map((gate) => gate.id),
                    },
                ]
                : []),
            ...(hasBlockers
                ? [
                    {
                        id: "blocked_in_mvp",
                        type: "blocked_in_mvp" as const,
                        severity: "blocker" as const,
                        title: "Blocked in MVP",
                        explanation: "The workflow touches a hard-blocked category that FlowForge should not automate in the MVP.",
                        recommendation: "Use an internal summary and escalate to a qualified human owner.",
                        related_step_ids: input.deterministicBlueprint.steps.map((step) => step.id),
                        related_risk_ids: input.deterministicBlueprint.risks.map((risk) => risk.id),
                        related_gate_ids: input.deterministicBlueprint.human_approval_gates.map((gate) => gate.id),
                    },
                ]
                : []),
        ],
        recommended_human_gates: input.deterministicBlueprint.human_approval_gates.map((gate) => gate.label),
        draft_only_warnings: hasExternalAction
            ? ["Any generated external message, reply, notification, or email must remain draft-only."]
            : [],
        blocked_or_not_recommended: hasBlockers
            ? [
                ...input.deterministicBlueprint.not_recommended,
                ...input.deterministicBlueprint.not_safe_to_automate,
            ]
            : input.deterministicBlueprint.not_recommended,
        safer_alternative: "Create an internal summary and route it to a human reviewer before any real-world action.",
        final_advice: hasBlockers
            ? "Do not automate this workflow. Use human review and internal summaries only."
            : needsHumanReview
                ? "Keep the automation assistive and require human approval before external or sensitive actions."
                : "Keep the workflow as a non-executing internal preview.",
    };
}

function normalizeAgentOutput(parsed: unknown, provider: AgentOutputProvider): SafetyCriticAgentOutput {
    const raw = parsed as Record<string, unknown>;

    return safetyCriticAgentOutputSchema.parse({
        ...raw,
        provider,
        used_ai: true,
        fallback_used: false,
        status: "used_ai",
        confidence: raw.confidence ?? "medium",
        reason: raw.reason ?? "AI generated a structured safety critique.",
    });
}

function shouldUseAi(mode: CompileMode): boolean {
    return mode === "full";
}

function buildDebugInfo(input: {
    mode: CompileMode;
    userPrompt: string;
    providerAttempts: AgentProviderDebugAttempt[];
    output: SafetyCriticAgentOutput;
    llmCallsMade: number;
}): AgentDebugInfo {
    return {
        agent_id: "safety_critic_agent",
        agent_label: "Safety Critic Agent",
        mode: input.mode,
        system_prompt: safetyCriticAgentSystemPrompt,
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

export async function runSafetyCriticAgent(input: RunSafetyCriticAgentInput): Promise<SafetyCriticAgentResult> {
    const prompt = buildSafetyCriticAgentUserPrompt({
        processInput: input.processInput,
        signals: input.signals,
        risks: input.risks,
        readiness: input.readiness,
        routerDecision: input.routerDecision,
        clarificationPlan: input.clarificationPlan,
        deterministicBlueprint: input.deterministicBlueprint,
        blueprintArchitectOutput: input.blueprintArchitectOutput,
    });

    if (!shouldUseAi(input.mode)) {
        const output = buildFallbackOutput(input, "deterministic", `Safety Critic Agent skipped in ${input.mode} mode.`);
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
            rawResponse = await callGroq(prompt, safetyCriticAgentSystemPrompt);
            parsedResponse = safeParseJSON(rawResponse);
            const output = normalizeAgentOutput(parsedResponse, "groq");

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
            const failure = normalizeProviderFailure("groq", error);

            providerAttempts.push({
                provider: "groq",
                attempted: true,
                success: false,
                error_summary: failure.summary,
                raw_error_summary: failure.rawSummary,
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
            rawResponse = await callGemini(prompt, safetyCriticAgentSystemPrompt);
            parsedResponse = safeParseJSON(rawResponse);
            const output = normalizeAgentOutput(parsedResponse, "gemini");

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
            const failure = normalizeProviderFailure("gemini", error);

            providerAttempts.push({
                provider: "gemini",
                attempted: true,
                success: false,
                error_summary: failure.summary,
                raw_error_summary: failure.rawSummary,
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
            ? `Safety Critic AI was unavailable, so FlowForge used deterministic safety fallback. Deterministic checks completed the safety review. ${providerErrors.join(" ")}`
            : "No Safety Critic Agent provider key was configured. Deterministic fallback was used.";

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
