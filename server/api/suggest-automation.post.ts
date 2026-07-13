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

export default defineEventHandler(async (event): Promise<AutomationSuggestion> => {
  const body = await readBody<unknown>(event);
  const parsed = suggestAutomationRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "Select a valid discovery category.",
    });
  }

  try {
    const signals = await searchWorkflowPainPoints(parsed.data.category);
    return await generateAutomationSuggestion(parsed.data.category, signals);
  } catch (error) {
    if (
      error instanceof TavilyConfigurationError
      || error instanceof AutomationSuggestionConfigurationError
    ) {
      throw createError({
        statusCode: 503,
        statusMessage: "Automation discovery is not configured.",
      });
    }

    if (error instanceof NoUsefulTavilyResultsError) {
      throw createError({
        statusCode: 422,
        statusMessage: "No useful workflow pain points were found. Please try again.",
      });
    }

    if (error instanceof TavilyRequestError) {
      throw createError({
        statusCode: 502,
        statusMessage: "Could not search for workflow pain points. Please try again.",
      });
    }

    if (error instanceof AutomationSuggestionGenerationError) {
      throw createError({
        statusCode: 502,
        statusMessage: "Could not create a valid automation idea. Please try again.",
      });
    }

    throw createError({
      statusCode: 500,
      statusMessage: "Automation discovery failed. Please try again.",
    });
  }
});
