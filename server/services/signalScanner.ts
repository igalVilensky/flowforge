import type { RiskCategory, SignalSummary, WorkflowPrimitive } from "../../shared/types/workflow";
import {
  clearOutputPhrases,
  decisionPointPhrases,
  humanActorPhrases,
  primitiveRules,
  repeatedProcessPhrases,
  riskRules,
  schedulePhrases,
  sensitiveRiskCategories,
  systemActorPhrases,
  triggerPhrases,
} from "../rules/primitiveRules";

type MatchableRule = {
  phrases: readonly string[];
  patterns?: readonly RegExp[];
};

const outputPrimitives: readonly WorkflowPrimitive[] = [
  "classification",
  "extraction",
  "routing",
  "drafting",
  "approval",
  "validation",
  "notification",
  "record_creation",
  "summarization",
  "reporting",
  "export",
];

const roughActionByPrimitive = new Map<WorkflowPrimitive, string>([
  ["intake", "Intake the process description"],
  ...primitiveRules.map((rule) => [rule.primitive, rule.rough_action] as const),
]);

const possibleToolByPrimitive = new Map<WorkflowPrimitive, string>(
  primitiveRules.map((rule) => [rule.primitive, rule.possible_tool] as const),
);

function normalizeInput(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseMatches(input: string, phrase: string): boolean {
  const normalizedPhrase = normalizeInput(phrase);

  if (!normalizedPhrase) {
    return false;
  }

  const pattern = normalizedPhrase.split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`).test(input);
}

function matchesAny(input: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => phraseMatches(input, phrase));
}

function ruleMatches(input: string, rule: MatchableRule): boolean {
  return matchesAny(input, rule.phrases) || (rule.patterns?.some((pattern) => pattern.test(input)) ?? false);
}

function addUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}

function detectRiskFlags(input: string): RiskCategory[] {
  const riskFlags: RiskCategory[] = [];

  for (const rule of riskRules) {
    if (!ruleMatches(input, rule)) {
      continue;
    }

    for (const category of rule.categories) {
      addUnique(riskFlags, category);
    }
  }

  return riskFlags;
}

function detectWorkflowPrimitives(input: string, riskFlags: RiskCategory[]): WorkflowPrimitive[] {
  const primitives: WorkflowPrimitive[] = [];

  if (input) {
    addUnique(primitives, "intake");
  }

  for (const rule of primitiveRules) {
    if (ruleMatches(input, rule)) {
      addUnique(primitives, rule.primitive);
    }
  }

  if (riskFlags.length > 0) {
    addUnique(primitives, "risk_detection");
  }

  return primitives;
}

function getRoughActions(primitives: readonly WorkflowPrimitive[], needsApproval: boolean): string[] {
  const roughActions: string[] = [];

  for (const primitive of primitives) {
    const roughAction = roughActionByPrimitive.get(primitive);

    if (roughAction) {
      addUnique(roughActions, roughAction);
    }
  }

  if (needsApproval) {
    addUnique(roughActions, "Ask a human to review before execution");
  }

  return roughActions;
}

function getPossibleTools(
  primitives: readonly WorkflowPrimitive[],
  hasExternalAction: boolean,
  needsApproval: boolean,
): string[] {
  const possibleTools: string[] = [];

  for (const primitive of primitives) {
    const possibleTool = possibleToolByPrimitive.get(primitive);

    if (possibleTool) {
      addUnique(possibleTools, possibleTool);
    }
  }

  if (hasExternalAction || needsApproval) {
    addUnique(possibleTools, "approval gate");
  }

  if (possibleTools.length === 0) {
    possibleTools.push("signal scanner");
  }

  return possibleTools;
}

function getMissingCriticalInfo(
  hasTrigger: boolean,
  hasClearOutput: boolean,
  hasExternalAction: boolean,
  hasSensitiveData: boolean,
  hasRealWorldExecutionRisk: boolean,
): string[] {
  const missingInfo: string[] = [];

  if (!hasTrigger) {
    missingInfo.push("Trigger condition is not clear.");
  }

  if (!hasClearOutput) {
    missingInfo.push("Expected output is not clear.");
  }

  if (hasExternalAction) {
    missingInfo.push("External channel and approval owner are not defined.");
  }

  if (hasSensitiveData) {
    missingInfo.push("Data source and access permissions are not defined.");
  }

  if (hasRealWorldExecutionRisk) {
    missingInfo.push("Execution target and rollback plan are not defined.");
  }

  return missingInfo;
}

export function scanSignals(input: string): SignalSummary {
  const normalizedInput = normalizeInput(input);
  const riskFlags = detectRiskFlags(normalizedInput);
  const workflowPrimitives = detectWorkflowPrimitives(normalizedInput, riskFlags);

  const hasScheduledTrigger = matchesAny(normalizedInput, schedulePhrases);
  const hasTrigger = hasScheduledTrigger || matchesAny(normalizedInput, triggerPhrases);
  const hasRepeatedProcess = matchesAny(normalizedInput, repeatedProcessPhrases);
  const hasExternalAction = riskFlags.includes("external_communication");
  const hasSensitiveData = riskFlags.some((category) => sensitiveRiskCategories.includes(category));
  const hasRealWorldExecutionRisk = riskFlags.includes("real_world_execution");
  const hasClearOutput =
    matchesAny(normalizedInput, clearOutputPhrases) ||
    workflowPrimitives.some((primitive) => outputPrimitives.includes(primitive));
  const hasDecisionPoints =
    matchesAny(normalizedInput, decisionPointPhrases) ||
    workflowPrimitives.some((primitive) =>
      ["classification", "routing", "approval", "risk_detection", "validation", "escalation"].includes(primitive),
    );
  const hasHumanActor = matchesAny(normalizedInput, humanActorPhrases);
  const hasSystemActor = matchesAny(normalizedInput, systemActorPhrases) || workflowPrimitives.length > 0;
  const needsApproval =
    hasExternalAction ||
    hasRealWorldExecutionRisk ||
    riskFlags.includes("high_stakes_decision") ||
    riskFlags.includes("delete_or_destructive_action");

  return {
    has_trigger: hasTrigger,
    has_scheduled_trigger: hasScheduledTrigger,
    has_repeated_process: hasRepeatedProcess,
    has_external_action: hasExternalAction,
    has_sensitive_data: hasSensitiveData,
    has_clear_output: hasClearOutput,
    has_decision_points: hasDecisionPoints,
    has_human_actor: hasHumanActor,
    has_system_actor: hasSystemActor,
    risk_flags: riskFlags,
    missing_critical_info: getMissingCriticalInfo(
      hasTrigger,
      hasClearOutput,
      hasExternalAction,
      hasSensitiveData,
      hasRealWorldExecutionRisk,
    ),
    rough_actions: getRoughActions(workflowPrimitives, needsApproval),
    possible_tools: getPossibleTools(workflowPrimitives, hasExternalAction, needsApproval),
    workflow_primitives: workflowPrimitives,
  };
}
