import type { ClarificationSessionAnswer } from "../../shared/types/clarificationSession";
import type {
  StructuredCompileRequest,
  StructuredWorkflowIntent,
} from "../../shared/types/structuredWorkflowIntent";
import {
  createEmptyStructuredWorkflowIntent,
  getConcreteStructuredWorkflowIntent,
  inferStructuredWorkflowIntent,
  isConcreteKnownFact,
} from "./clarificationFacts";

export const STRUCTURED_COMPILE_INPUT_PREFIX = "FLOWFORGE_COMPILE_INPUT_V2\n";
export const LEGACY_STRUCTURED_COMPILE_INPUT_PREFIX = "FLOWFORGE_COMPILE_INPUT_V1\n";

export type NormalizedCompileRequest = StructuredCompileRequest & {
  semantic_intent: string;
  source: "canonical" | "legacy" | "plain_text";
};

type LegacyStructuredCompileInput = {
  original_input: string;
  clarified_intent: string;
  known_facts: Record<string, unknown>;
  clarification_answers: ClarificationSessionAnswer[];
  safety_constraints: string[];
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueConcreteStrings(values: Array<string | undefined>): string[] {
  return [...new Set(
    values
      .filter((value): value is string => Boolean(value && isConcreteKnownFact(value)))
      .map(normalize),
  )];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isClarificationAnswers(value: unknown): value is ClarificationSessionAnswer[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return typeof record.question_id === "string"
      && typeof record.question === "string"
      && typeof record.answer === "string";
  });
}

function isStructuredWorkflowIntent(value: unknown): value is StructuredWorkflowIntent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return record.version === "1"
    && typeof record.original_input === "string"
    && isStringArray(record.input_sources)
    && isStringArray(record.input_data)
    && isStringArray(record.desired_outputs)
    && isStringArray(record.output_destinations)
    && isStringArray(record.notification_targets)
    && isStringArray(record.decision_rules)
    && isStringArray(record.external_actions);
}

function isStructuredCompileRequest(value: unknown): value is StructuredCompileRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return isStructuredWorkflowIntent(record.intent)
    && isStringArray(record.safety_constraints)
    && isClarificationAnswers(record.clarification_answers);
}

function isLegacyStructuredCompileInput(value: unknown): value is LegacyStructuredCompileInput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return typeof record.original_input === "string"
    && typeof record.clarified_intent === "string"
    && Boolean(record.known_facts && typeof record.known_facts === "object")
    && isClarificationAnswers(record.clarification_answers)
    && isStringArray(record.safety_constraints);
}

function pushFact(target: string[], value: unknown): void {
  if (typeof value === "string" && isConcreteKnownFact(value)) {
    target.push(normalize(value));
  }
}

function adaptLegacyStructuredCompileInput(input: LegacyStructuredCompileInput): StructuredCompileRequest {
  const facts = input.known_facts;
  const intent = createEmptyStructuredWorkflowIntent(input.original_input);

  if (typeof facts.workflow_goal === "string") intent.goal = facts.workflow_goal;
  if (typeof facts.task_type === "string") intent.task_type = facts.task_type;
  if (typeof facts.trigger === "string") intent.trigger = facts.trigger;
  if (typeof facts.human_owner === "string") intent.human_owner = facts.human_owner;
  if (typeof facts.approval_boundary === "string") intent.approval_boundary = facts.approval_boundary;
  if (typeof facts.external_action_boundary === "string") intent.external_action_boundary = facts.external_action_boundary;
  if (typeof facts.success_criteria === "string") intent.success_criteria = facts.success_criteria;

  pushFact(intent.input_sources, facts.data_source);
  if (isStringArray(facts.input_data)) intent.input_data.push(...facts.input_data);
  pushFact(intent.desired_outputs, facts.desired_output);
  if (isStringArray(facts.decision_rules)) intent.decision_rules.push(...facts.decision_rules);

  if (!intent.goal && isConcreteKnownFact(input.clarified_intent, "goal")) {
    intent.goal = input.clarified_intent;
  }

  return {
    intent: getConcreteStructuredWorkflowIntent(intent),
    clarification_answers: input.clarification_answers,
    safety_constraints: uniqueConcreteStrings(input.safety_constraints),
  };
}

function line(label: string, value: string | undefined): string | undefined {
  return value ? `- ${label}: ${value}` : undefined;
}

function listLine(label: string, values: string[]): string | undefined {
  return values.length > 0 ? `- ${label}: ${values.join("; ")}` : undefined;
}

export function buildWorkflowIntentSection(intent: StructuredWorkflowIntent): string {
  const concrete = getConcreteStructuredWorkflowIntent(intent);
  return [
    "WORKFLOW INTENT",
    line("Original input", concrete.original_input),
    line("Goal", concrete.goal),
    line("Task type", concrete.task_type),
    line("Trigger", concrete.trigger),
    listLine("Input sources", concrete.input_sources),
    listLine("Input data", concrete.input_data),
    listLine("Desired outputs", concrete.desired_outputs),
    listLine("Output destinations", concrete.output_destinations),
    listLine("Notification targets", concrete.notification_targets),
    listLine("Decision rules", concrete.decision_rules),
    line("Human owner", concrete.human_owner),
    line("Approval boundary", concrete.approval_boundary),
    line("External-action boundary", concrete.external_action_boundary),
    listLine("External actions", concrete.external_actions),
    line("Success criteria", concrete.success_criteria),
  ].filter((value): value is string => Boolean(value)).join("\n");
}

export function buildSafetyConstraintsSection(safetyConstraints: string[]): string {
  const constraints = uniqueConcreteStrings(safetyConstraints);
  return [
    "SAFETY CONSTRAINTS",
    ...(constraints.length > 0 ? constraints : ["No additional request-specific constraints."])
      .map((constraint) => `- ${constraint}`),
  ].join("\n");
}

export function serializeStructuredCompileInput(input: StructuredCompileRequest): string {
  return `${STRUCTURED_COMPILE_INPUT_PREFIX}${JSON.stringify({
    intent: getConcreteStructuredWorkflowIntent(input.intent),
    safety_constraints: uniqueConcreteStrings(input.safety_constraints),
    clarification_answers: input.clarification_answers,
  }, null, 2)}`;
}

function normalizedResult(
  request: StructuredCompileRequest,
  source: NormalizedCompileRequest["source"],
): NormalizedCompileRequest {
  const intent = getConcreteStructuredWorkflowIntent(request.intent);
  return {
    intent,
    clarification_answers: request.clarification_answers,
    safety_constraints: uniqueConcreteStrings(request.safety_constraints),
    semantic_intent: buildWorkflowIntentSection(intent),
    source,
  };
}

export function normalizeCompileRequest(rawInput: string): NormalizedCompileRequest {
  const trimmed = rawInput.trim();

  if (trimmed.startsWith(STRUCTURED_COMPILE_INPUT_PREFIX)) {
    try {
      const parsed = JSON.parse(trimmed.slice(STRUCTURED_COMPILE_INPUT_PREFIX.length)) as unknown;
      if (isStructuredCompileRequest(parsed)) return normalizedResult(parsed, "canonical");
    } catch {
      // Invalid serialized input is treated as plain text at this one compatibility boundary.
    }
  }

  if (trimmed.startsWith(LEGACY_STRUCTURED_COMPILE_INPUT_PREFIX)) {
    try {
      const parsed = JSON.parse(trimmed.slice(LEGACY_STRUCTURED_COMPILE_INPUT_PREFIX.length)) as unknown;
      if (isLegacyStructuredCompileInput(parsed)) {
        return normalizedResult(adaptLegacyStructuredCompileInput(parsed), "legacy");
      }
    } catch {
      // Invalid legacy input is treated as plain text at this one compatibility boundary.
    }
  }

  const intent = inferStructuredWorkflowIntent({ originalInput: trimmed, answers: [] });
  return normalizedResult({
    intent,
    clarification_answers: [],
    safety_constraints: [],
  }, "plain_text");
}
