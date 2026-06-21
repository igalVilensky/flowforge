import type { CompileMode, RouterDecision } from "../../shared/types/compileJob";
import type { AutomationReadinessScore, RiskSummary, SignalSummary } from "../../shared/types/workflow";
import { buildRouterUserPrompt, routerSystemPrompt } from "../prompts/routerPrompt";
import { routerDecisionSchema } from "../schemas/router.schema";
import { callGemini } from "./geminiProvider";
import { callGroq } from "./groqProvider";

export type RouterAttempt = {
  provider: "groq" | "gemini" | "deterministic";
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

function safeParseJSON(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    // Try to extract JSON object substring if direct parse fails
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerE) {
        throw new Error("Failed to parse extracted JSON object substring.");
      }
    }
    throw new Error("No valid JSON object found in response.");
  }
}

function getDeterministicFallback(
  signals: SignalSummary,
  risks: RiskSummary,
  readiness: AutomationReadinessScore,
): RouterDecision {
  let route: RouterDecision["route"] = "compile_blueprint";
  let reason = "The request appears clear and safe enough to preview.";
  let safety_note = "Fallback deterministic routing active.";
  let suggested_next_step = "Review the generated blueprint.";

  if (risks.risk_level === "high" && risks.requires_human_review) {
    route = "suggest_safer_workflow";
    reason = "High risk detected needing human review.";
    suggested_next_step = "Consider adding human approval gates or removing destructive actions.";
  } else if (signals.missing_critical_info.length >= 3) {
    route = "needs_clarification";
    reason = "Too much critical information is missing from the request.";
    suggested_next_step = "Provide more details about the trigger, output, and actors.";
  } else if (readiness.score < 35) {
    route = "needs_clarification";
    reason = "The process description lacks clear structure for automation.";
    suggested_next_step = "Break down the process into clear steps.";
  } else if (signals.has_external_action && risks.categories.includes("real_world_execution")) {
    route = "suggest_safer_workflow";
    reason = "External execution requested without clear safety boundaries.";
    suggested_next_step = "Switch external actions to draft-only mode.";
  }

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

export async function routeCompileRequest(
  input: string,
  signals: SignalSummary,
  risks: RiskSummary,
  readiness: AutomationReadinessScore,
  mode: CompileMode,
): Promise<RouterAgentResult> {
  const attempts: RouterAttempt[] = [];
  let llm_calls_made = 0;

  if (mode === "demo" || mode === "rule_only") {
    attempts.push({
      provider: "groq",
      attempted: false,
      success: false,
      skipped_reason: `AI skipped in ${mode} mode.`,
      validation_failed: false,
    });
    attempts.push({
      provider: "gemini",
      attempted: false,
      success: false,
      skipped_reason: `AI skipped in ${mode} mode.`,
      validation_failed: false,
    });

    return {
      decision: getDeterministicFallback(signals, risks, readiness),
      attempts,
      llm_calls_made: 0,
    };
  }

  const prompt = buildRouterUserPrompt(input, signals, risks, readiness);

  // 1. Try Groq
  let groqFailed = false;
  try {
    llm_calls_made++;
    const groqResponse = await callGroq(prompt, routerSystemPrompt);
    const parsed = safeParseJSON(groqResponse);
    const valid = routerDecisionSchema.parse({
      ...parsed as any,
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
    
    return { decision: valid, attempts, llm_calls_made };
  } catch (error) {
    groqFailed = true;
    attempts.push({
      provider: "groq",
      attempted: true,
      success: false,
      error_summary: error instanceof Error ? error.message : "Unknown error",
      validation_failed: error instanceof Error && error.name === "ZodError",
    });
  }

  // 2. Try Gemini
  if (groqFailed) {
    try {
      llm_calls_made++;
      const geminiResponse = await callGemini(prompt, routerSystemPrompt);
      const parsed = safeParseJSON(geminiResponse);
      const valid = routerDecisionSchema.parse({
        ...parsed as any,
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

      return { decision: valid, attempts, llm_calls_made };
    } catch (error) {
      attempts.push({
        provider: "gemini",
        attempted: true,
        success: false,
        error_summary: error instanceof Error ? error.message : "Unknown error",
        validation_failed: error instanceof Error && error.name === "ZodError",
      });
    }
  }

  // 3. Deterministic Fallback
  attempts.push({
    provider: "deterministic",
    attempted: true,
    success: true,
    validation_failed: false,
  });

  return {
    decision: getDeterministicFallback(signals, risks, readiness),
    attempts,
    llm_calls_made,
  };
}
