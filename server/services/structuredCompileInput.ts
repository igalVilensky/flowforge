import type {
  ClarificationKnownFacts,
  ClarificationSessionAnswer,
} from "../../shared/types/clarificationSession";
import {
  getConcreteKnownFacts,
  isConcreteKnownFact,
  isSafetyBoundaryAnswer,
} from "./clarificationFacts";

export type StructuredCompileInput = {
  original_input: string;
  clarified_intent: string;
  known_facts: ClarificationKnownFacts;
  clarification_answers: ClarificationSessionAnswer[];
  safety_constraints: string[];
};

export type CompileAnalysisInput = {
  intent: string;
  safetyConstraints: string[];
  structuredInput?: StructuredCompileInput;
};

export const STRUCTURED_COMPILE_INPUT_PREFIX = "FLOWFORGE_COMPILE_INPUT_V1\n";

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueConcreteStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && isConcreteKnownFact(value))).map(normalize))];
}

function isStructuredCompileInput(value: unknown): value is StructuredCompileInput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return typeof record.original_input === "string"
    && typeof record.clarified_intent === "string"
    && Boolean(record.known_facts && typeof record.known_facts === "object")
    && Array.isArray(record.clarification_answers)
    && Array.isArray(record.safety_constraints)
    && record.safety_constraints.every((constraint) => typeof constraint === "string");
}

export function serializeStructuredCompileInput(input: StructuredCompileInput): string {
  return `${STRUCTURED_COMPILE_INPUT_PREFIX}${JSON.stringify({
    ...input,
    known_facts: getConcreteKnownFacts(input.known_facts),
    safety_constraints: uniqueConcreteStrings(input.safety_constraints),
  }, null, 2)}`;
}

function buildIntentOnlyText(input: StructuredCompileInput): string {
  const facts = getConcreteKnownFacts(input.known_facts);
  const semanticAnswers = input.clarification_answers
    .filter((answer) => !isSafetyBoundaryAnswer(answer))
    .map((answer) => answer.answer);
  const factLines = [
    facts.task_type ? `Task type: ${facts.task_type}` : undefined,
    facts.trigger ? `Trigger: ${facts.trigger}` : undefined,
    facts.data_source ? `Source material: ${facts.data_source}` : undefined,
    facts.input_data?.length ? `Input data: ${facts.input_data.join(", ")}` : undefined,
    facts.desired_output ? `Desired output: ${facts.desired_output}` : undefined,
    facts.decision_rules?.length ? `Decision rules: ${facts.decision_rules.join("; ")}` : undefined,
    facts.human_owner ? `Human reviewer: ${facts.human_owner}` : undefined,
    facts.success_criteria ? `Success criteria: ${facts.success_criteria}` : undefined,
  ];
  const hasApprovalBoundary = Boolean(
    facts.approval_boundary
    || facts.external_action_boundary
    || input.clarification_answers.some(isSafetyBoundaryAnswer),
  );

  if (hasApprovalBoundary) {
    factLines.push("Approval boundary: External action is blocked until explicit human approval.");
  }

  return uniqueConcreteStrings([
    input.original_input,
    input.clarified_intent,
    ...semanticAnswers,
    ...factLines,
  ]).join("\n");
}

export function parseCompileAnalysisInput(rawInput: string): CompileAnalysisInput {
  const trimmed = rawInput.trim();

  if (!trimmed.startsWith(STRUCTURED_COMPILE_INPUT_PREFIX)) {
    return {
      intent: trimmed,
      safetyConstraints: [],
    };
  }

  try {
    const parsed = JSON.parse(trimmed.slice(STRUCTURED_COMPILE_INPUT_PREFIX.length)) as unknown;

    if (!isStructuredCompileInput(parsed)) {
      throw new Error("Invalid structured compile input shape.");
    }

    const structuredInput: StructuredCompileInput = {
      ...parsed,
      known_facts: getConcreteKnownFacts(parsed.known_facts),
      safety_constraints: uniqueConcreteStrings(parsed.safety_constraints),
    };

    return {
      intent: buildIntentOnlyText(structuredInput),
      safetyConstraints: structuredInput.safety_constraints,
      structuredInput,
    };
  } catch {
    return {
      intent: trimmed,
      safetyConstraints: [],
    };
  }
}
