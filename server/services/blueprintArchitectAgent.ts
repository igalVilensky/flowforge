import type {
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
    RiskSummary,
    SignalSummary,
} from "../../shared/types/workflow";
import {
    blueprintArchitectSystemPrompt,
    buildBlueprintArchitectUserPrompt,
} from "../prompts/blueprintArchitectPrompt";
import { blueprintArchitectOutputSchema } from "../schemas/agentOutputs.schema";
import { callGemini } from "./geminiProvider";
import { callGroq } from "./groqProvider";

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
};

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

function normalizeAgentOutput(parsed: unknown, provider: AgentOutputProvider): BlueprintArchitectOutput {
    return blueprintArchitectOutputSchema.parse({
        ...(parsed as Record<string, unknown>),
        provider,
        used_ai: true,
        fallback_used: false,
        status: "used_ai",
        confidence: "medium",
        reason: "AI generated a structured blueprint proposal.",
    });
}

function shouldUseAi(mode: CompileMode): boolean {
    return mode === "balanced" || mode === "full";
}

export async function runBlueprintArchitectAgent(input: RunBlueprintArchitectAgentInput): Promise<BlueprintArchitectAgentResult> {
    if (!shouldUseAi(input.mode)) {
        return {
            output: buildFallbackOutput(input, "deterministic", `Blueprint Architect Agent skipped in ${input.mode} mode.`),
            llm_calls_made: 0,
        };
    }

    const prompt = buildBlueprintArchitectUserPrompt({
        processInput: input.processInput,
        signals: input.signals,
        risks: input.risks,
        readiness: input.readiness,
        routerDecision: input.routerDecision,
        clarificationPlan: input.clarificationPlan,
    });

    let llmCallsMade = 0;

    if (process.env.GROQ_API_KEY) {
        try {
            llmCallsMade += 1;
            const raw = await callGroq(prompt, blueprintArchitectSystemPrompt);
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
            const raw = await callGemini(prompt, blueprintArchitectSystemPrompt);
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
                ? "Blueprint Architect Agent provider output failed validation or parsing. Deterministic fallback was used."
                : "No Blueprint Architect Agent provider key was configured. Deterministic fallback was used.",
        ),
        llm_calls_made: llmCallsMade,
    };
}