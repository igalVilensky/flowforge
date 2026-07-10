import type { ClarificationSessionAnswer } from "./clarificationSession";

export type StructuredWorkflowIntent = {
  version: "1";
  original_input: string;
  goal?: string;
  task_type?: string;
  trigger?: string;
  input_sources: string[];
  input_data: string[];
  desired_outputs: string[];
  output_destinations: string[];
  notification_targets: string[];
  decision_rules: string[];
  human_owner?: string;
  approval_boundary?: string;
  external_action_boundary?: string;
  external_actions: string[];
  success_criteria?: string;
};

export type StructuredCompileRequest = {
  intent: StructuredWorkflowIntent;
  safety_constraints: string[];
  clarification_answers: ClarificationSessionAnswer[];
};
