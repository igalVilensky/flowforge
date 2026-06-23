import type {
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
};

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
    const hasBlockers = input.deterministicBlueprint.not_safe_to_automate.length > 0
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
                        explanation: "The workflow touches a category that FlowForge should not automate in the MVP.",
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
        blocked_or_not_recommended: input.deterministicBlueprint.not_safe_to_automate.length > 0
            ? input.deterministicBlueprint.not_safe_to_automate
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
    return safetyCriticAgentOutputSchema.parse({
        ...(parsed as Record<string, unknown>),
        provider,
        used_ai: true,
        fallback_used: false,
        status: "used_ai",
        confidence: "medium",
        reason: "AI generated a structured safety critique.",
    });
}

function shouldUseAi(mode: CompileMode): boolean {
    return mode === "full";
}

export async function runSafetyCriticAgent(input: RunSafetyCriticAgentInput): Promise<SafetyCriticAgentResult> {
    if (!shouldUseAi(input.mode)) {
        return {
            output: buildFallbackOutput(input, "deterministic", `Safety Critic Agent skipped in ${input.mode} mode.`),
            llm_calls_made: 0,
        };
    }

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

    let llmCallsMade = 0;

    if (process.env.GROQ_API_KEY) {
        try {
            llmCallsMade += 1;
            const raw = await callGroq(prompt, safetyCriticAgentSystemPrompt);
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
            const raw = await callGemini(prompt, safetyCriticAgentSystemPrompt);
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
                ? "Safety Critic Agent provider output failed validation or parsing. Deterministic fallback was used."
                : "No Safety Critic Agent provider key was configured. Deterministic fallback was used.",
        ),
        llm_calls_made: llmCallsMade,
    };
}