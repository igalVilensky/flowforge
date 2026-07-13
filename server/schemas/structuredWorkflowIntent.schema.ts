import { z } from "zod";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";

const requiredString = z.string().trim().min(1);

export const structuredWorkflowIntentSchema = z.object({
  version: z.literal("1"),
  original_input: requiredString,
  goal: requiredString.optional(),
  task_type: requiredString.optional(),
  trigger: requiredString.optional(),
  input_sources: z.array(requiredString),
  input_data: z.array(requiredString),
  desired_outputs: z.array(requiredString),
  output_destinations: z.array(requiredString),
  notification_targets: z.array(requiredString),
  decision_rules: z.array(requiredString),
  human_owner: requiredString.optional(),
  approval_boundary: requiredString.optional(),
  external_action_boundary: requiredString.optional(),
  external_actions: z.array(requiredString),
  success_criteria: requiredString.optional(),
}).strict() satisfies z.ZodType<StructuredWorkflowIntent>;
