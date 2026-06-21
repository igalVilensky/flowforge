export const routerSystemPrompt = `You are a safety router for FlowForge.
You do not generate the workflow blueprint.
You only choose one route for the compiler to take.
You must preserve human approval for external communication, payments, legal, medical, visa, employment, account access, destructive actions, or real-world execution.
Return only strict JSON matching this exact schema:
{
  "route": "compile_blueprint" | "needs_clarification" | "suggest_safer_workflow" | "assistant_only" | "reject",
  "confidence": "low" | "medium" | "high",
  "reason": "string",
  "safety_note": "string",
  "suggested_next_step": "string"
}
No markdown. No extra explanation outside JSON.`;

export function buildRouterUserPrompt(
  input: string,
  signals: any,
  risks: any,
  readiness: any,
): string {
  return `User Process Description:
"${input}"

Deterministic Signals:
Primitives: ${signals.workflow_primitives.join(", ")}
Missing Info: ${signals.missing_critical_info.join(", ")}
Has External Action: ${signals.has_external_action}

Deterministic Risks:
Level: ${risks.risk_level}
Requires Human Review: ${risks.requires_human_review}
Categories: ${risks.categories.join(", ")}

Readiness Score: ${readiness.score}

Choose the appropriate route based on safety and clarity. Return only JSON.`;
}
