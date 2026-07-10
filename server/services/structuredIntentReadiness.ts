import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
import { isConcreteKnownFact, structuredIntentHasExternalAction } from "./clarificationFacts";

export type StructuredIntentReadinessField =
  | "goal_or_task_type"
  | "trigger"
  | "input_source_or_data"
  | "desired_output"
  | "human_owner"
  | "approval_or_external_action_boundary";

export type StructuredIntentReadiness = {
  ready: boolean;
  missing_fields: StructuredIntentReadinessField[];
  external_actions_involved: boolean;
};

export function assessStructuredWorkflowIntentReadiness(
  intent: StructuredWorkflowIntent,
): StructuredIntentReadiness {
  const missingFields: StructuredIntentReadinessField[] = [];
  const externalActionsInvolved = structuredIntentHasExternalAction(intent);

  if (!isConcreteKnownFact(intent.goal, "goal") && !isConcreteKnownFact(intent.task_type, "task_type")) {
    missingFields.push("goal_or_task_type");
  }

  if (!isConcreteKnownFact(intent.trigger, "trigger")) {
    missingFields.push("trigger");
  }

  if (!isConcreteKnownFact(intent.input_sources, "input_sources")
    && !isConcreteKnownFact(intent.input_data, "input_data")) {
    missingFields.push("input_source_or_data");
  }

  if (!isConcreteKnownFact(intent.desired_outputs, "desired_outputs")) {
    missingFields.push("desired_output");
  }

  if (externalActionsInvolved) {
    if (!isConcreteKnownFact(intent.human_owner, "human_owner")) {
      missingFields.push("human_owner");
    }

    if (!isConcreteKnownFact(intent.approval_boundary, "approval_boundary")
      && !isConcreteKnownFact(intent.external_action_boundary, "external_action_boundary")) {
      missingFields.push("approval_or_external_action_boundary");
    }
  }

  return {
    ready: missingFields.length === 0,
    missing_fields: missingFields,
    external_actions_involved: externalActionsInvolved,
  };
}
