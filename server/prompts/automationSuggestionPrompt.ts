import type { DiscoveryCategory } from "../../shared/types/discovery";
import { discoveryCategoryLabel } from "../../shared/types/discovery";
import type { WorkflowPainPointSignal } from "../services/tavilySearch";

export const automationSuggestionSystemPrompt = `You are FlowForge's creative automation opportunity scout.

Turn real operational pain signals into exactly one appealing, practical workflow use case. You may select the strongest signal, combine related signals, or reinterpret weak signals into a stronger opportunity. Do not merely repeat a source title. Be imaginative but realistic for an n8n-style workflow.

Choose the technical fit naturally: automation_only, agent_only, or agentic_workflow. This is descriptive metadata only. Do not create a technical blueprint, prescribe exact n8n nodes, or include implementation instructions.

The workflowIntent is the main output. Make it a complete natural-language use case with a clear trigger, received information, useful processing or AI interpretation, decisions or branches, internal actions or integrations, expected outcome, and a human review boundary for high-impact external actions where appropriate. Avoid vague productivity claims and enormous enterprise transformation projects.

Return one JSON object only with these model-owned fields:
title, fitType, painPoint, targetUser, whyItMatters, valueLevel, difficulty, confidence, workflowIntent, suggestedSteps, source.

Rules:
- valueLevel and difficulty must be low, medium, or high.
- confidence must be a number from 0 to 1.
- suggestedSteps must be a non-empty array of conceptual steps, not exact node names.
- source must be one supplied source as {"title":"...","url":"..."}, or null when none genuinely supports the idea.
- Do not return id or category; the server adds those fields.
- Do not quote raw source content in workflowIntent.`;

export function buildAutomationSuggestionPrompt(
  category: DiscoveryCategory,
  signals: WorkflowPainPointSignal[],
): string {
  const categoryInstruction = category === "surprise"
    ? "The user selected Surprise me, so any useful business area is welcome."
    : `Keep the opportunity within ${discoveryCategoryLabel(category)}, while still making it feel fresh and surprising.`;

  const sourceText = signals.map((signal, index) => [
    `Signal ${index + 1}`,
    `Title: ${signal.title}`,
    `URL: ${signal.url}`,
    `Operational description: ${signal.content}`,
  ].join("\n")).join("\n\n");

  return `REQUESTED CATEGORY
Internal value: ${category}
Display name: ${discoveryCategoryLabel(category)}
${categoryInstruction}

SEARCH SIGNALS
${sourceText}

Review every signal, then create exactly one concrete workflow opportunity. Freely choose, combine, or reinterpret the strongest evidence. The use case must be specific enough to submit directly to the FlowForge compiler.`;
}

export function buildAutomationSuggestionRepairPrompt(
  category: DiscoveryCategory,
  malformedResponse: string,
  signals: WorkflowPainPointSignal[],
): string {
  const allowedSources = signals.map((signal, index) =>
    `${index + 1}. ${signal.title} — ${signal.url}`,
  ).join("\n");

  return `Repair the malformed response below into the expected model-output shape. Preserve the original idea and wording where possible; do not replace it with a generic fallback. Return one JSON object only.

REQUESTED CATEGORY (context only; do not return it)
${category}

EXPECTED MODEL-OUTPUT SHAPE
{
  "title": "non-empty string",
  "fitType": "automation_only | agent_only | agentic_workflow",
  "painPoint": "non-empty string",
  "targetUser": "non-empty string",
  "whyItMatters": "non-empty string",
  "valueLevel": "low | medium | high",
  "difficulty": "low | medium | high",
  "confidence": "number from 0 to 1",
  "workflowIntent": "complete natural-language workflow use case",
  "suggestedSteps": ["one or more conceptual steps"],
  "source": {"title": "allowed source title", "url": "allowed source URL"} | null
}

ALLOWED SOURCES
${allowedSources || "None; use null."}

MALFORMED RESPONSE
${malformedResponse.slice(0, 8000)}`;
}
