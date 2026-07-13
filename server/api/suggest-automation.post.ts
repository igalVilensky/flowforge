import type { AutomationSuggestion } from "../../shared/types/discovery";
import { suggestAutomationRequestSchema } from "../schemas/discovery.schema";
import {
  AutomationSuggestionConfigurationError,
  AutomationSuggestionGenerationError,
  generateAutomationSuggestion,
} from "../services/automationSuggestionGenerator";
import {
  NoUsefulTavilyResultsError,
  TavilyConfigurationError,
  TavilyRequestError,
  searchWorkflowPainPoints,
} from "../services/tavilySearch";

function publicApiError(statusCode: number, statusMessage: string) {
  const error = createError({ statusCode, statusMessage });
  // Keep development responses as concise as production responses. Detailed,
  // redacted diagnostics are emitted server-side by the generator.
  error.stack = undefined;
  return error;
}

export default defineEventHandler(async (event): Promise<AutomationSuggestion> => {
  const body = await readBody<unknown>(event);
  const parsed = suggestAutomationRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw publicApiError(400, "Select a valid discovery category.");
  }

  try {
    const signals = await searchWorkflowPainPoints(parsed.data.category);
    return await generateAutomationSuggestion(parsed.data.category, signals);
  } catch (error) {
    if (
      error instanceof TavilyConfigurationError
      || error instanceof AutomationSuggestionConfigurationError
    ) {
      throw publicApiError(503, "Automation discovery is not configured.");
    }

    if (error instanceof NoUsefulTavilyResultsError) {
      throw publicApiError(422, "No useful workflow pain points were found. Please try again.");
    }

    if (error instanceof TavilyRequestError) {
      throw publicApiError(502, "Could not search for workflow pain points. Please try again.");
    }

    if (error instanceof AutomationSuggestionGenerationError) {
      throw publicApiError(502, "Could not create a valid automation idea. Please try again.");
    }

    throw publicApiError(500, "Automation discovery failed. Please try again.");
  }
});
