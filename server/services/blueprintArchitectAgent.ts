import { ZodError } from "zod";
import type {
    AgentDebugInfo,
    AgentProviderDebugAttempt,
    AgentOutputProvider,
    BlueprintArchitectOutput,
} from "../../shared/types/agentOutputs";
import type {
    ClarificationPlan,
    CompileMode,
    RouterDecision,
} from "../../shared/types/compileJob";
import type {
    AutomationReadinessScore,
    RiskCategory,
    RiskSummary,
    SignalSummary,
} from "../../shared/types/workflow";
import {
    blueprintArchitectSystemPrompt,
    buildBlueprintArchitectUserPrompt,
} from "../prompts/blueprintArchitectPrompt";
import { blueprintArchitectOutputSchema } from "../schemas/agentOutputs.schema";
import { callGeminiAgent } from "./geminiProvider";
import { callGroqAgent } from "./groqProvider";

export type RunBlueprintArchitectAgentInput = {
    processInput: string;
    mode: CompileMode;
    signals: SignalSummary;
    risks: RiskSummary;
    readiness: AutomationReadinessScore;
    routerDecision: RouterDecision;
    clarificationPlan: ClarificationPlan;
};

export type BlueprintArchitectAgentResult = {
    output: BlueprintArchitectOutput;
    llm_calls_made: number;
    debug: AgentDebugInfo;
};

const allowedRiskCategories: ReadonlySet<string> = new Set<RiskCategory>([
    "external_communication",
    "personal_data",
    "financial",
    "legal",
    "medical",
    "visa_or_immigration",
    "employment",
    "refund_or_payment",
    "complaint_or_angry_user",
    "delete_or_destructive_action",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
]);

type NormalizedBlueprintArchitectOutput = {
    output: BlueprintArchitectOutput;
    parsedResponse: unknown;
    warningSummary?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeOptionalProposedRisks(parsed: unknown): { value: unknown; warningSummary?: string } {
    if (!isRecord(parsed) || !Array.isArray(parsed.proposed_risks)) {
        return { value: parsed };
    }

    const droppedCategories = new Set<string>();
    const proposedRisks = parsed.proposed_risks.filter((risk) => {
        const category = isRecord(risk) ? risk.category : undefined;

        if (typeof category === "string" && allowedRiskCategories.has(category)) {
            return true;
        }

        droppedCategories.add(typeof category === "string" && category.trim() ? category : "unknown");
        return false;
    });

    if (droppedCategories.size === 0) {
        return { value: parsed };
    }

    return {
        value: {
            ...parsed,
            proposed_risks: proposedRisks,
        },
        warningSummary: `Ignored unsupported AI risk categories: ${Array.from(droppedCategories).join(", ")}`,
    };
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
            throw new Error("No valid JSON object found in Blueprint Architect Agent response.");
        }

        return JSON.parse(match[0]);
    }
}

function buildFallbackOutput(input: RunBlueprintArchitectAgentInput, provider: AgentOutputProvider, reason: string): BlueprintArchitectOutput {
    const needsHumanApproval = input.risks.requires_human_review || input.signals.has_external_action;
    const hasBlocker =
        input.routerDecision.route === "reject"
        || input.risks.categories.some((category) =>
            [
                "legal",
                "medical",
                "visa_or_immigration",
                "account_access",
                "delete_or_destructive_action",
            ].includes(category),
        );

    return {
        provider,
        used_ai: false,
        fallback_used: true,
        confidence: hasBlocker ? "high" : needsHumanApproval ? "medium" : "high",
        status: "fallback_used",
        reason,
        workflow_name: "Safe automation blueprint proposal",
        summary: hasBlocker
            ? "This workflow should be treated as unsafe for automatic execution and reduced to a human-reviewed internal summary."
            : needsHumanApproval
                ? "This workflow can be planned as a non-executing preview with human approval before any external or sensitive action."
                : "This workflow can be planned as a safe internal non-executing preview.",
        proposed_steps: [
            {
                id: "collect_input",
                label: "Collect input",
                primitive: "intake",
                description: "Read the described trigger and input source without executing any real-world action.",
                input: "User-described workflow input",
                output: "Structured internal intake record",
                automation_policy: "automate",
                risk_level: "low",
                approval_required: false,
            },
            {
                id: "classify_and_summarize",
                label: "Classify and summarize",
                primitive: "summarization",
                description: "Classify the request and produce a concise internal summary for review.",
                input: "Structured internal intake record",
                output: "Internal summary and classification",
                automation_policy: needsHumanApproval || hasBlocker ? "assist_only" : "automate",
                risk_level: needsHumanApproval || hasBlocker ? "medium" : "low",
                approval_required: needsHumanApproval || hasBlocker,
            },
            {
                id: "build_non_executing_preview",
                label: "Build non-executing preview",
                primitive: "reporting",
                description: "Generate a preview blueprint only. Do not execute external actions.",
                input: "Internal summary, risks, and missing details",
                output: "Non-executing automation blueprint preview",
                automation_policy: "blocked_in_mvp",
                risk_level: "low",
                approval_required: false,
            },
        ],
        proposed_human_approval_gates: needsHumanApproval || hasBlocker
            ? [
                {
                    id: "human_review_before_action",
                    label: "Human review before action",
                    reason: "Sensitive or external actions must be reviewed before anything is sent, changed, refunded, deleted, or executed.",
                    applies_to_step_ids: ["classify_and_summarize"],
                    required: true,
                },
            ]
            : [],
        proposed_risks: input.risks.categories.map((category) => ({
            id: `risk_${category}`,
            category,
            label: category.replaceAll("_", " "),
            risk_level: input.risks.risk_level,
            reason: "Detected by deterministic risk scanning.",
            recommendation: "Keep this workflow internal, draft-only, or human-reviewed depending on risk severity.",
        })),
        safe_to_automate: [
            "Create a non-executing internal preview.",
            "Classify and summarize information for review.",
        ],
        must_remain_draft_only: input.signals.has_external_action
            ? ["Any generated external message or reply must remain draft-only."]
            : [],
        requires_human_approval: needsHumanApproval || hasBlocker
            ? ["Human review is required before any sensitive or external action."]
            : [],
        blocked_or_not_recommended: hasBlocker
            ? ["Automatic execution is not recommended for this workflow category."]
            : [],
        assumptions: [
            "FlowForge is operating as a planning tool only.",
            "No production system action will be executed by the MVP.",
        ],
        open_questions: input.clarificationPlan.questions.map((question) => question.question),
        safer_alternative: "Create an internal summary and route it to a human reviewer before any real-world action.",
    };
}

function normalizeAgentOutput(parsed: unknown, provider: AgentOutputProvider): NormalizedBlueprintArchitectOutput {
    const sanitized = sanitizeOptionalProposedRisks(parsed);
    const raw = isRecord(sanitized.value) ? sanitized.value : {};

    const output = blueprintArchitectOutputSchema.parse({
        ...raw,
        provider,
        used_ai: true,
        fallback_used: false,
        status: "used_ai",
        confidence: raw.confidence ?? "medium",
        reason: raw.reason ?? "AI generated a structured blueprint proposal.",
    });

    return {
        output,
        parsedResponse: sanitized.value,
        warningSummary: sanitized.warningSummary,
    };
}

function shouldUseAi(mode: CompileMode): boolean {
    return mode === "balanced" || mode === "full";
}

function buildDebugInfo(input: {
    mode: CompileMode;
    userPrompt: string;
    providerAttempts: AgentProviderDebugAttempt[];
    output: BlueprintArchitectOutput;
    llmCallsMade: number;
}): AgentDebugInfo {
    return {
        agent_id: "blueprint_architect_agent",
        agent_label: "Blueprint Architect Agent",
        mode: input.mode,
        system_prompt: blueprintArchitectSystemPrompt,
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

export async function runBlueprintArchitectAgent(input: RunBlueprintArchitectAgentInput): Promise<BlueprintArchitectAgentResult> {
    const prompt = buildBlueprintArchitectUserPrompt({
        processInput: input.processInput,
        signals: input.signals,
        risks: input.risks,
        readiness: input.readiness,
        routerDecision: input.routerDecision,
        clarificationPlan: input.clarificationPlan,
    });

    if (!shouldUseAi(input.mode)) {
        const output = buildFallbackOutput(input, "deterministic", `Blueprint Architect Agent skipped in ${input.mode} mode.`);
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
            rawResponse = await callGroqAgent(prompt, blueprintArchitectSystemPrompt, {
                modelEnv: "GROQ_BLUEPRINT_MODEL",
                fallbackModelEnv: "GROQ_AGENT_MODEL",
                maxTokensEnv: "GROQ_BLUEPRINT_MAX_TOKENS",
                fallbackMaxTokensEnv: "GROQ_AGENT_MAX_TOKENS",
                defaultMaxTokens: 2400,
                maxTokensCap: 4000,
                truncationSuggestion: "Raise GROQ_BLUEPRINT_MAX_TOKENS to around 2400-4000.",
            });
            parsedResponse = safeParseJSON(rawResponse);
            const normalized = normalizeAgentOutput(parsedResponse, "groq");

            providerAttempts.push({
                provider: "groq",
                attempted: true,
                success: true,
                raw_response: rawResponse,
                parsed_response: normalized.parsedResponse,
                ...(normalized.warningSummary ? { warning_summary: normalized.warningSummary } : {}),
            });

            return {
                output: normalized.output,
                llm_calls_made: llmCallsMade,
                debug: buildDebugInfo({
                    mode: input.mode,
                    userPrompt: prompt,
                    providerAttempts,
                    output: normalized.output,
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
            rawResponse = await callGeminiAgent(prompt, blueprintArchitectSystemPrompt, {
                modelEnv: "GEMINI_BLUEPRINT_MODEL",
                fallbackModelEnv: "GEMINI_AGENT_MODEL",
                maxOutputTokensEnv: "GEMINI_BLUEPRINT_MAX_OUTPUT_TOKENS",
                fallbackMaxOutputTokensEnv: "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
                defaultMaxOutputTokens: 2400,
                maxOutputTokensCap: 4000,
                truncationSuggestion: "Raise GEMINI_BLUEPRINT_MAX_OUTPUT_TOKENS to around 2400-4000.",
            });
            parsedResponse = safeParseJSON(rawResponse);
            const normalized = normalizeAgentOutput(parsedResponse, "gemini");

            providerAttempts.push({
                provider: "gemini",
                attempted: true,
                success: true,
                raw_response: rawResponse,
                parsed_response: normalized.parsedResponse,
                ...(normalized.warningSummary ? { warning_summary: normalized.warningSummary } : {}),
            });

            return {
                output: normalized.output,
                llm_calls_made: llmCallsMade,
                debug: buildDebugInfo({
                    mode: input.mode,
                    userPrompt: prompt,
                    providerAttempts,
                    output: normalized.output,
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
            ? `Blueprint Architect Agent provider output failed validation or parsing. ${providerErrors.join(" | ")}`
            : "No Blueprint Architect Agent provider key was configured. Deterministic fallback was used.";

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
