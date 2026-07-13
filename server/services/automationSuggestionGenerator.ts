import process from "node:process";
import type {
  AutomationSuggestion,
  DiscoveryCategory,
} from "../../shared/types/discovery";
import {
  automationSuggestionSystemPrompt,
  buildAutomationSuggestionPrompt,
  buildAutomationSuggestionRepairPrompt,
} from "../prompts/automationSuggestionPrompt";
import { automationSuggestionSchema } from "../schemas/discovery.schema";
import { callOpenAIAgent } from "./openaiProvider";
import type { WorkflowPainPointSignal } from "./tavilySearch";

export class AutomationSuggestionConfigurationError extends Error {}
export class AutomationSuggestionGenerationError extends Error {}

export type SuggestionModelCall = (
  prompt: string,
  systemPrompt: string,
) => Promise<string>;

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found.");
    return JSON.parse(match[0]);
  }
}

function validateSuggestion(raw: string, category: DiscoveryCategory): AutomationSuggestion {
  const parsed = parseJsonObject(raw);
  const suggestion = automationSuggestionSchema.parse(parsed);
  if (suggestion.category !== category) {
    throw new Error("Suggestion category did not match the request.");
  }
  return suggestion;
}

function defaultModelCall(prompt: string, systemPrompt: string): Promise<string> {
  return callOpenAIAgent(prompt, systemPrompt, {
    modelEnv: "OPENAI_DISCOVERY_MODEL",
    fallbackModelEnv: "OPENAI_AGENT_MODEL",
    maxOutputTokensEnv: "OPENAI_DISCOVERY_MAX_OUTPUT_TOKENS",
    fallbackMaxOutputTokensEnv: "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: 1800,
    maxOutputTokensCap: 2600,
    reasoningEffort: "low",
    verbosity: "medium",
    structuredOutputMode: "json_object",
  });
}

export async function generateAutomationSuggestion(
  category: DiscoveryCategory,
  signals: WorkflowPainPointSignal[],
  options: { modelCall?: SuggestionModelCall } = {},
): Promise<AutomationSuggestion> {
  if (!options.modelCall && !process.env.OPENAI_API_KEY?.trim()) {
    throw new AutomationSuggestionConfigurationError("OPENAI_API_KEY is not configured.");
  }

  const modelCall = options.modelCall ?? defaultModelCall;
  let firstResponse: string;
  try {
    firstResponse = await modelCall(
      buildAutomationSuggestionPrompt(category, signals),
      automationSuggestionSystemPrompt,
    );
  } catch {
    throw new AutomationSuggestionGenerationError("The AI model could not create a suggestion.");
  }

  try {
    return validateSuggestion(firstResponse, category);
  } catch {
    try {
      const repaired = await modelCall(
        buildAutomationSuggestionRepairPrompt(category, firstResponse),
        automationSuggestionSystemPrompt,
      );
      return validateSuggestion(repaired, category);
    } catch {
      throw new AutomationSuggestionGenerationError("The AI model returned an invalid suggestion.");
    }
  }
}
