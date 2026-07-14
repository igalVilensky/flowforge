import type { BlueprintArchitectOutput } from "../../shared/types/agentOutputs";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
import type {
  HumanApprovalGate,
  SafeAutomationBlueprint,
  WorkflowStep,
} from "../../shared/types/workflow";
import { safeAutomationBlueprintSchema } from "../schemas/workflow.schema";

export type FinalBlueprintSource =
  | "validated AI design with deterministic safety merge"
  | "deterministic fallback";

export type BlueprintSelection = {
  blueprint: SafeAutomationBlueprint;
  source: FinalBlueprintSource;
  reason: string;
};

const GROUNDING_STOP_WORDS = new Set([
  "about", "after", "before", "create", "from", "human", "into", "process",
  "should", "that", "their", "this", "through", "when", "where", "which",
  "with", "workflow",
]);

function words(value: string): Set<string> {
  return new Set(
    value.toLowerCase().match(/[a-z0-9]+/g)?.filter(
      (word) => word.length >= 4 && !GROUNDING_STOP_WORDS.has(word),
    ) ?? [],
  );
}

function isGrounded(
  proposal: BlueprintArchitectOutput,
  intent: StructuredWorkflowIntent,
): boolean {
  const context = [
    intent.goal,
    intent.task_type,
    intent.trigger,
    ...intent.input_sources,
    ...intent.input_data,
    ...intent.desired_outputs,
    ...intent.decision_rules,
  ].filter((value): value is string => Boolean(value)).join(" ");
  const contextWords = words(context);
  const proposalWords = words([
    proposal.workflow_name,
    proposal.summary,
    ...proposal.proposed_steps.flatMap((step) => [
      step.label,
      step.description,
      step.input,
      step.output,
    ]),
  ].join(" "));

  return [...proposalWords].filter((word) => contextWords.has(word)).length >= 2;
}

function hasUnauthorizedAction(proposal: BlueprintArchitectOutput): boolean {
  const consequential = /\b(?:send|email|publish|post|pay|payment|charge|refund|delete|remove|update production|write to|create external|submit financial|transfer)\b/i;

  return proposal.proposed_steps.some((step) =>
    consequential.test(`${step.label} ${step.description} ${step.output}`) &&
    step.automation_policy === "automate" &&
    !step.approval_required,
  );
}

function mapStep(
  step: BlueprintArchitectOutput["proposed_steps"][number],
  baseline: SafeAutomationBlueprint,
): WorkflowStep {
  const consequential = /\b(?:send|email|publish|post|pay|charge|refund|delete|update|write|submit|transfer|external)\b/i.test(
    `${step.label} ${step.description} ${step.output}`,
  );
  const approvalRequired = step.approval_required || consequential;
  const policy = approvalRequired && step.automation_policy === "automate"
    ? "human_approval"
    : step.automation_policy;

  return {
    id: step.id,
    label: step.label,
    description: step.description,
    primitive: step.primitive,
    actor: ["classification", "extraction", "drafting", "summarization"].includes(step.primitive)
      ? "rules_and_ai"
      : "system",
    input: step.input,
    output: step.output,
    automation_policy: policy,
    approval_required: approvalRequired,
    risk_level: step.risk_level,
    risk_categories: baseline.risks
      .filter((risk) => risk.risk_level === step.risk_level || approvalRequired)
      .map((risk) => risk.category),
    real_world_execution:
      policy === "blocked_in_mvp" || policy === "not_recommended"
        ? "blocked_in_mvp"
        : policy === "draft_only"
          ? "draft_only"
          : approvalRequired
            ? "requires_human_trigger"
            : "none",
  };
}

function mergedGates(
  baseline: SafeAutomationBlueprint,
  proposal: BlueprintArchitectOutput,
  steps: WorkflowStep[],
): HumanApprovalGate[] {
  const stepIds = new Set(steps.map((step) => step.id));
  const approvalStepIds = steps.filter((step) => step.approval_required).map((step) => step.id);
  const safeTargets = (targets: string[]) => {
    const matching = targets.filter((id) => stepIds.has(id));
    return matching.length > 0
      ? matching
      : approvalStepIds.length > 0
        ? approvalStepIds
        : [steps.at(-1)?.id].filter((id): id is string => Boolean(id));
  };
  const proposalGates: HumanApprovalGate[] = proposal.proposed_human_approval_gates.map((gate) => ({
    ...gate,
    applies_to_step_ids: safeTargets(gate.applies_to_step_ids),
    review_checklist: [
      "Confirm the proposed action matches the refined workflow intent.",
      "Confirm no production action occurs without explicit approval.",
    ],
  }));
  const mandatoryGates = baseline.human_approval_gates.map((gate) => ({
    ...gate,
    applies_to_step_ids: safeTargets(gate.applies_to_step_ids),
  }));

  return [...mandatoryGates, ...proposalGates].filter(
    (gate, index, all) => all.findIndex((candidate) => candidate.id === gate.id) === index,
  );
}

export function selectFinalBlueprint(input: {
  baseline: SafeAutomationBlueprint;
  proposal: BlueprintArchitectOutput;
  intent: StructuredWorkflowIntent;
}): BlueprintSelection {
  const { baseline, proposal, intent } = input;

  if (!proposal.used_ai || proposal.status !== "used_ai") {
    return {
      blueprint: baseline,
      source: "deterministic fallback",
      reason: "The Blueprint Architect did not return a validated AI proposal.",
    };
  }

  if (proposal.proposed_steps.length < 2 || !isGrounded(proposal, intent)) {
    return {
      blueprint: baseline,
      source: "deterministic fallback",
      reason: "The AI proposal was not sufficiently grounded in the refined intent.",
    };
  }

  if (hasUnauthorizedAction(proposal)) {
    return {
      blueprint: baseline,
      source: "deterministic fallback",
      reason: "The AI proposal introduced an ungated consequential action.",
    };
  }

  const steps = proposal.proposed_steps.map((step) => mapStep(step, baseline));
  const candidate: SafeAutomationBlueprint = {
    ...baseline,
    workflow_name: proposal.workflow_name,
    summary: proposal.summary,
    steps,
    human_approval_gates: mergedGates(baseline, proposal, steps),
    safe_to_automate: [...new Set([...baseline.safe_to_automate, ...proposal.safe_to_automate])],
    needs_human_approval: [...new Set([
      ...baseline.needs_human_approval,
      ...proposal.requires_human_approval,
      ...proposal.must_remain_draft_only,
    ])],
    not_recommended: [...new Set([...baseline.not_recommended, ...proposal.blocked_or_not_recommended])],
    assumptions: [...new Set([
      ...baseline.assumptions,
      ...proposal.assumptions,
      "Final blueprint source: validated AI design with deterministic safety merge.",
    ])],
    open_questions: [...new Set([...baseline.open_questions, ...proposal.open_questions])],
  };
  const validation = safeAutomationBlueprintSchema.safeParse(candidate);

  if (!validation.success) {
    return {
      blueprint: baseline,
      source: "deterministic fallback",
      reason: "The enriched AI blueprint failed the application blueprint schema.",
    };
  }

  return {
    blueprint: validation.data,
    source: "validated AI design with deterministic safety merge",
    reason: "The grounded AI design passed schema validation and mandatory deterministic gates were merged.",
  };
}
