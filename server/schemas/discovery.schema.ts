import { z } from "zod";
import type { AutomationSuggestion } from "../../shared/types/discovery";
import { discoveryCategories } from "../../shared/types/discovery";

const requiredString = z.string().trim().min(1, "Required string cannot be empty.");
const sourceUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Source URL must use http or https.");

const normalizedConfidence = z.preprocess((value) => {
  const numericValue = typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;

  if (typeof numericValue === "number" && numericValue > 1 && numericValue <= 100) {
    return numericValue / 100;
  }

  return numericValue;
}, z.number().min(0).max(1));

export const discoveryCategorySchema = z.enum(discoveryCategories);

export const suggestAutomationRequestSchema = z.object({
  category: discoveryCategorySchema,
}).strict();

const automationSuggestionContentShape = {
  title: requiredString,
  fitType: z.enum(["automation_only", "agent_only", "agentic_workflow"]),
  painPoint: requiredString,
  targetUser: requiredString,
  whyItMatters: requiredString,
  valueLevel: z.enum(["low", "medium", "high"]),
  difficulty: z.enum(["low", "medium", "high"]),
  confidence: normalizedConfidence,
  workflowIntent: requiredString,
  suggestedSteps: z.array(requiredString).min(1),
  source: z.object({
    title: requiredString,
    url: sourceUrl,
  }).nullable().optional().default(null),
};

// Intentionally strips harmless extra model fields. Server-owned metadata is
// not part of this schema.
export const automationSuggestionModelResponseSchema = z.object({
  ...automationSuggestionContentShape,
});

export const automationSuggestionSchema = z.object({
  id: requiredString,
  category: discoveryCategorySchema,
  ...automationSuggestionContentShape,
}).strict() satisfies z.ZodType<AutomationSuggestion>;

export type AutomationSuggestionModelResponse = z.infer<
  typeof automationSuggestionModelResponseSchema
>;
