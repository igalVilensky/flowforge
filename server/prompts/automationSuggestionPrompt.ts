import type { DiscoveryCategory } from "../../shared/types/discovery";
import { discoveryCategoryLabel } from "../../shared/types/discovery";
import type { WorkflowPainPointSignal } from "../services/tavilySearch";

export const automationSuggestionSystemPrompt = `You are FlowForge's creative automation opportunity scout.

Turn real operational pain signals into exactly one appealing, practical workflow use case. You may select the strongest signal, combine related signals, or reinterpret weak signals into a stronger opportunity. Do not merely repeat a source title. Be imaginative but realistic for an n8n-style workflow.

Choose the technical fit naturally: automation_only, agent_only, or agentic_workflow. This is descriptive metadata only. Do not create a technical blueprint, prescribe exact n8n nodes, or include implementation instructions.

The workflowIntent is the main output. Make it a complete natural-language use case with a clear trigger, received information, useful processing or AI interpretation, decisions or branches, internal actions or integrations, expected outcome, and a human review boundary for high-impact external actions where appropriate. Avoid vague productivity claims and enormous enterprise transformation projects.

Return one JSON object only, with exactly these fields:
id, title, category, fitType, painPoint, targetUser, whyItMatters, valueLevel, difficulty, confidence, workflowIntent, suggestedSteps, source.

Rules:
- category must exactly match the requested internal category value.
- valueLevel and difficulty must be low, medium, or high.
- confidence must be a number from 0 to 1.
- suggestedSteps must be a non-empty array of conceptual steps, not exact node names.
- source must be one supplied source as {"title":"...","url":"..."}, or null when none genuinely supports the idea.
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
): string {
  return `Repair the following malformed response into the exact JSON structure requested by the system prompt. Preserve its idea instead of inventing a fallback. Return JSON only. The category must be "${category}".

MALFORMED RESPONSE
${malformedResponse.slice(0, 8000)}`;
}
