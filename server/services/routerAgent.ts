import process from "node:process";
import type {
  CompileMode,
  RouterDecision,
} from "../../shared/types/compileJob";
import type {
  AutomationReadinessScore,
  RiskSummary,
  SignalSummary,
} from "../../shared/types/workflow";
import {
  buildRouterUserPrompt,
  routerSystemPrompt,
} from "../prompts/routerPrompt";
import {
  routerDecisionSchema,
} from "../schemas/router.schema";
import {
  callGeminiAgent,
} from "./geminiProvider";
import {
  callGroqAgent,
} from "./groqProvider";

export type RouterAttempt = {
  provider:
    | "groq"
    | "gemini"
    | "deterministic";
  attempted: boolean;
  success: boolean;
  skipped_reason?: string;
  error_summary?: string;
  validation_failed: boolean;
};

export type RouterAgentResult = {
  decision: RouterDecision;
  attempts: RouterAttempt[];
  llm_calls_made: number;
};

function safeParseJSON(
  rawText: string,
): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const match =
      rawText.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        return JSON.parse(
          match[0],
        );
      } catch {
        throw new Error(
          "Failed to parse extracted JSON object substring.",
        );
      }
    }

    throw new Error(
      "No valid JSON object found in response.",
    );
  }
}

function getDeterministicFallback(
  signals: SignalSummary,
  risks: RiskSummary,
  readiness:
    AutomationReadinessScore,
): RouterDecision {
  let route:
    RouterDecision["route"] =
      "compile_blueprint";

  let reason =
    "The request appears clear and safe enough to preview.";

  let safety_note =
    "Fallback deterministic routing active.";

  let suggested_next_step =
    "Review the generated blueprint.";

  if (
    risks.risk_level === "high"
    && risks.requires_human_review
  ) {
    route =
      "suggest_safer_workflow";

    reason =
      "High risk detected needing human review.";

    suggested_next_step =
      "Consider adding human approval gates or removing destructive actions.";
  } else if (
    signals
      .missing_critical_info
      .length >= 3
  ) {
    route =
      "needs_clarification";

    reason =
      "Too much critical information is missing from the request.";

    suggested_next_step =
      "Provide more details about the trigger, output, and actors.";
  } else if (
    readiness.score < 35
  ) {
    route =
      "needs_clarification";

    reason =
      "The process description lacks clear structure for automation.";

    suggested_next_step =
      "Break down the process into clear steps.";
  } else if (
    signals.has_external_action
    && risks.categories.includes(
      "real_world_execution",
    )
  ) {
    route =
      "suggest_safer_workflow";

    reason =
      "External execution requested without clear safety boundaries.";

    suggested_next_step =
      "Switch external actions to draft-only mode.";
  }

  /*
   * The deterministic fallback never returns out_of_scope.
   *
   * Scope classification is intentionally semantic and belongs only
   * to the Router Agent. When no AI provider is available, the safe
   * fallback is to continue with clarification or blueprint handling
   * rather than rejecting a potentially valid automation request.
   */
  return {
    route,
    confidence: "medium",
    reason,
    safety_note,
    suggested_next_step,
    provider: "deterministic",
    used_ai: false,
    fallback_used: true,
  };
}

function normalizeRouterDecision(
  decision: RouterDecision,
): RouterDecision {
  /*
   * A low-confidence semantic rejection is too uncertain to stop the
   * complete pipeline. Convert it into clarification so a legitimate
   * but vaguely worded automation request is not rejected.
   */
  if (
    decision.route
      === "out_of_scope"
    && decision.confidence
      === "low"
  ) {
    return {
      ...decision,
      route:
        "needs_clarification",
      reason:
        "The router was not confident enough to classify the request as outside workflow automation scope.",
      safety_note:
        "Low-confidence scope decisions are routed to clarification instead of rejection.",
      suggested_next_step:
        "Ask the user what process or recurring task they want to automate.",
      user_message:
        undefined,
    };
  }

  if (
    decision.route
    !== "out_of_scope"
  ) {
    return {
      ...decision,
      user_message:
        undefined,
    };
  }

  return {
    ...decision,
    user_message:
      decision.user_message
      ?? "FlowForge is designed to create workflow automations and agentic processes. Describe a process you want to automate, including what starts it, what should happen, and the expected result.",
  };
}

export async function routeCompileRequest(
  input: string,
  signals: SignalSummary,
  risks: RiskSummary,
  readiness:
    AutomationReadinessScore,
  mode: CompileMode,
): Promise<RouterAgentResult> {
  const attempts:
    RouterAttempt[] = [];

  let llm_calls_made = 0;

  if (
    mode === "demo"
    || mode === "rule_only"
  ) {
    attempts.push({
      provider: "groq",
      attempted: false,
      success: false,
      skipped_reason:
        `AI skipped in ${mode} mode.`,
      validation_failed: false,
    });

    attempts.push({
      provider: "gemini",
      attempted: false,
      success: false,
      skipped_reason:
        `AI skipped in ${mode} mode.`,
      validation_failed: false,
    });

    return {
      decision:
        getDeterministicFallback(
          signals,
          risks,
          readiness,
        ),
      attempts,
      llm_calls_made: 0,
    };
  }

  const prompt =
    buildRouterUserPrompt(
      input,
      signals,
      risks,
      readiness,
    );

  const groqApiKey =
    process.env.GROQ_API_KEY;

  const geminiApiKey =
    process.env.GEMINI_API_KEY;

  if (!groqApiKey) {
    attempts.push({
      provider: "groq",
      attempted: false,
      success: false,
      skipped_reason:
        "GROQ_API_KEY is not set.",
      validation_failed: false,
    });
  } else {
    try {
      llm_calls_made += 1;

      const groqResponse =
        await callGroqAgent(
          prompt,
          routerSystemPrompt,
          {
            modelEnv:
              "GROQ_ROUTER_MODEL",
            fallbackModelEnv:
              "GROQ_AGENT_MODEL",
            maxTokensEnv:
              "GROQ_ROUTER_MAX_TOKENS",
            fallbackMaxTokensEnv:
              "GROQ_AGENT_MAX_TOKENS",
            defaultMaxTokens: 900,
            maxTokensCap: 1200,
            truncationSuggestion:
              "Raise GROQ_ROUTER_MAX_TOKENS to around 900-1200.",
          },
        );

      const parsed =
        safeParseJSON(
          groqResponse,
        );

      const valid =
        routerDecisionSchema.parse({
          ...(parsed as Record<
            string,
            unknown
          >),
          provider: "groq",
          used_ai: true,
          fallback_used: false,
        });

      attempts.push({
        provider: "groq",
        attempted: true,
        success: true,
        validation_failed: false,
      });

      return {
        decision:
          normalizeRouterDecision(
            valid,
          ),
        attempts,
        llm_calls_made,
      };
    } catch (error) {
      attempts.push({
        provider: "groq",
        attempted: true,
        success: false,
        error_summary:
          error
          instanceof Error
            ? error.message
            : "Unknown error",
        validation_failed:
          error
          instanceof Error
          && error.name
            === "ZodError",
      });
    }
  }

  if (!geminiApiKey) {
    attempts.push({
      provider: "gemini",
      attempted: false,
      success: false,
      skipped_reason:
        "GEMINI_API_KEY is not set.",
      validation_failed: false,
    });
  } else {
    try {
      llm_calls_made += 1;

      const geminiResponse =
        await callGeminiAgent(
          prompt,
          routerSystemPrompt,
          {
            modelEnv:
              "GEMINI_ROUTER_MODEL",
            fallbackModelEnv:
              "GEMINI_AGENT_MODEL",
            maxOutputTokensEnv:
              "GEMINI_ROUTER_MAX_OUTPUT_TOKENS",
            fallbackMaxOutputTokensEnv:
              "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
            defaultMaxOutputTokens:
              900,
            maxOutputTokensCap:
              1200,
            truncationSuggestion:
              "Raise GEMINI_ROUTER_MAX_OUTPUT_TOKENS to around 900-1200.",
          },
        );

      const parsed =
        safeParseJSON(
          geminiResponse,
        );

      const valid =
        routerDecisionSchema.parse({
          ...(parsed as Record<
            string,
            unknown
          >),
          provider: "gemini",
          used_ai: true,
          fallback_used: true,
        });

      attempts.push({
        provider: "gemini",
        attempted: true,
        success: true,
        validation_failed: false,
      });

      return {
        decision:
          normalizeRouterDecision(
            valid,
          ),
        attempts,
        llm_calls_made,
      };
    } catch (error) {
      attempts.push({
        provider: "gemini",
        attempted: true,
        success: false,
        error_summary:
          error
          instanceof Error
            ? error.message
            : "Unknown error",
        validation_failed:
          error
          instanceof Error
          && error.name
            === "ZodError",
      });
    }
  }

  attempts.push({
    provider:
      "deterministic",
    attempted: true,
    success: true,
    validation_failed: false,
  });

  return {
    decision:
      getDeterministicFallback(
        signals,
        risks,
        readiness,
      ),
    attempts,
    llm_calls_made,
  };
}