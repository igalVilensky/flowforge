import { z } from "zod";
import type { AutomationSuggestion } from "../../shared/types/discovery";
import { discoveryCategories } from "../../shared/types/discovery";

const requiredString = z.string().trim().min(1, "Required string cannot be empty.");
const sourceUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Source URL must use http or https.");

export const discoveryCategorySchema = z.enum(discoveryCategories);

export const suggestAutomationRequestSchema = z.object({
  category: discoveryCategorySchema,
}).strict();

export const automationSuggestionSchema = z.object({
  id: requiredString,
  title: requiredString,
  category: discoveryCategorySchema,
  fitType: z.enum(["automation_only", "agent_only", "agentic_workflow"]),
  painPoint: requiredString,
  targetUser: requiredString,
  whyItMatters: requiredString,
  valueLevel: z.enum(["low", "medium", "high"]),
  difficulty: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  workflowIntent: requiredString,
  suggestedSteps: z.array(requiredString).min(1),
  source: z.object({
    title: requiredString,
    url: sourceUrl,
  }).strict().nullable(),
}).strict() satisfies z.ZodType<AutomationSuggestion>;
