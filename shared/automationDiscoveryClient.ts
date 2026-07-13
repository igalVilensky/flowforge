import type {
  AutomationSuggestion,
  DiscoveryCategory,
} from "./types/discovery";

export type AutomationSuggestionFetcher = (
  category: DiscoveryCategory,
) => Promise<AutomationSuggestion>;

export function createAutomationDiscoveryRequester(
  fetchSuggestion: AutomationSuggestionFetcher,
) {
  let inFlight = false;

  return {
    get isBusy() {
      return inFlight;
    },
    async request(category: DiscoveryCategory): Promise<AutomationSuggestion | null> {
      if (inFlight) return null;

      inFlight = true;
      try {
        return await fetchSuggestion(category);
      } finally {
        inFlight = false;
      }
    },
  };
}

export async function sendSuggestionToCompiler(
  suggestion: AutomationSuggestion,
  compile: (workflowIntent: string) => Promise<void>,
): Promise<void> {
  await compile(suggestion.workflowIntent);
}
