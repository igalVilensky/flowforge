import type {
  BlueprintArchitectOutput,
} from "../../shared/types/agentOutputs";
import type {
  CompileMode,
} from "../../shared/types/compileJob";
import type {
  AutomationBoundary,
  AutomationReadinessScore,
  HumanApprovalGate,
  RealWorldExecutionPolicy,
  RiskItem,
  RiskSummary,
  SafeAutomationBlueprint,
  SignalSummary,
  WorkflowActor,
  WorkflowStep,
  WorkflowTrigger,
} from "../../shared/types/workflow";

export type BuildBlueprintFromArchitectOutputInput = {
  jobId: string;
  processInput: string;
  mode: CompileMode;
  architectOutput: BlueprintArchitectOutput;
  deterministicFallback: SafeAutomationBlueprint;
  signals: SignalSummary;
  risks: RiskSummary;
  readiness: AutomationReadinessScore;
};

function normalizeText(
  value: unknown,
  fallback: string,
  maxLength = 500,
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function normalizeId(
  value: unknown,
  fallback: string,
): string {
  const source =
    typeof value === "string" && value.trim()
      ? value
      : fallback;

  const normalized = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

function uniqueStrings(
  values: readonly unknown[],
  maxItems = 20,
  maxLength = 500,
): string[] {
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(
      value,
      "",
      maxLength,
    );

    if (
      normalized
      && !result.includes(normalized)
    ) {
      result.push(normalized);
    }

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function normalizedInput(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(
  input: string,
  phrases: readonly string[],
): boolean {
  return phrases.some((phrase) =>
    input.includes(phrase)
  );
}

function inferTrigger(
  processInput: string,
  fallback: WorkflowTrigger,
): WorkflowTrigger {
  const input = normalizedInput(processInput);

  const scheduled =
    includesAny(input, [
      "every morning",
      "each morning",
      "every day",
      "each day",
      "daily",
      "every weekday",
      "weekly",
      "every week",
      "monthly",
      "every month",
      "at ",
      "schedule",
      "scheduled",
    ]);

  if (scheduled) {
    return {
      type: "scheduled",
      source: "user-configured schedule",
      description: normalizeText(
        processInput,
        "Run on the requested schedule.",
        220,
      ),
    };
  }

  const emailSource =
    includesAny(input, [
      "email",
      "inbox",
      "gmail",
      "outlook",
      "imap",
      "mailbox",
    ]);

  if (emailSource) {
    return {
      type: "incoming_message",
      source: includesAny(input, ["gmail"])
        ? "gmail"
        : includesAny(input, ["outlook"])
          ? "outlook"
          : "user-configured inbox",
      description: normalizeText(
        processInput,
        "Run when a matching message arrives.",
        220,
      ),
    };
  }

  const eventDriven =
    /\bwhen(?:ever)?\b/.test(input)
    || /\bonce\b/.test(input)
    || /\bafter\b/.test(input)
    || includesAny(input, [
      "webhook",
      "event",
      "drops below",
      "rises above",
      "changes to",
      "is created",
      "is updated",
      "is submitted",
      "is received",
    ]);

  if (eventDriven) {
    return {
      type: "webhook",
      source: "user-configured event source",
      description: normalizeText(
        processInput,
        "Run when the described source event occurs.",
        220,
      ),
    };
  }

  if (
    fallback.type !== "unknown"
    && fallback.source !== "compiler_preview"
  ) {
    return fallback;
  }

  return {
    type: "manual_input",
    source: "user-configured source",
    description:
      "Start manually with the requested source data.",
  };
}

function actorForStep(
  step: BlueprintArchitectOutput["proposed_steps"][number],
): WorkflowActor {
  switch (step.primitive) {
    case "classification":
    case "extraction":
    case "drafting":
    case "summarization":
      return "ai";

    case "approval":
      return "human";

    case "validation":
    case "risk_detection":
      return "rules";

    case "routing":
      return "rules_and_ai";

    default:
      return step.automation_policy === "assist_only"
        ? "ai"
        : "system";
  }
}

function executionPolicyForStep(
  step: BlueprintArchitectOutput["proposed_steps"][number],
): RealWorldExecutionPolicy {
  switch (step.automation_policy) {
    case "draft_only":
      return "draft_only";

    case "human_approval":
      return "requires_human_trigger";

    case "blocked_in_mvp":
    case "not_recommended":
      return "blocked_in_mvp";

    case "assist_only":
      return step.approval_required
        ? "requires_human_trigger"
        : "none";

    case "automate":
    default:
      return step.approval_required
        ? "requires_human_trigger"
        : "none";
  }
}

function buildSteps(
  architectOutput: BlueprintArchitectOutput,
  risks: RiskSummary,
): WorkflowStep[] {
  const usedIds = new Set<string>();

  return architectOutput.proposed_steps.map(
    (proposedStep, index) => {
      const baseId = normalizeId(
        proposedStep.id,
        `step_${index + 1}`,
      );

      let id = baseId;
      let suffix = 2;

      while (usedIds.has(id)) {
        id = `${baseId}_${suffix}`;
        suffix += 1;
      }

      usedIds.add(id);

      return {
        id,
        label: normalizeText(
          proposedStep.label,
          `Step ${index + 1}`,
          120,
        ),
        description: normalizeText(
          proposedStep.description,
          proposedStep.label,
          500,
        ),
        primitive: proposedStep.primitive,
        actor: actorForStep(proposedStep),
        input: normalizeText(
          proposedStep.input,
          index === 0
            ? "Workflow trigger data"
            : "Previous workflow step output",
          300,
        ),
        output: normalizeText(
          proposedStep.output,
          "Workflow step output",
          300,
        ),
        automation_policy:
          proposedStep.automation_policy,
        approval_required:
          proposedStep.approval_required,
        risk_level: proposedStep.risk_level,
        risk_categories:
          proposedStep.risk_level === "low"
            ? []
            : [...risks.categories],
        real_world_execution:
          executionPolicyForStep(proposedStep),
      };
    },
  );
}

function buildApprovalGates(
  architectOutput: BlueprintArchitectOutput,
  steps: WorkflowStep[],
): HumanApprovalGate[] {
  const validStepIds = new Set(
    steps.map((step) => step.id),
  );

  return architectOutput
    .proposed_human_approval_gates
    .map((gate, index) => {
      const appliesToStepIds =
        gate.applies_to_step_ids.filter(
          (stepId) => validStepIds.has(stepId),
        );

      return {
        id: normalizeId(
          gate.id,
          `approval_gate_${index + 1}`,
        ),
        label: normalizeText(
          gate.label,
          `Approval gate ${index + 1}`,
          120,
        ),
        required: gate.required,
        applies_to_step_ids:
          appliesToStepIds.length > 0
            ? appliesToStepIds
            : steps
                .filter(
                  (step) =>
                    step.approval_required,
                )
                .map((step) => step.id),
        reason: normalizeText(
          gate.reason,
          "Human review is required before continuing.",
          400,
        ),
        review_checklist: [
          "Confirm that the selected action matches the original request.",
          "Confirm that credentials, destinations, and production settings are configured manually.",
          "Confirm that no blocked or unsafe action will run automatically.",
        ],
      };
    });
}

function buildRiskItems(
  architectOutput: BlueprintArchitectOutput,
  steps: WorkflowStep[],
  fallbackRisks: RiskItem[],
): RiskItem[] {
  if (
    architectOutput.proposed_risks.length === 0
  ) {
    return fallbackRisks;
  }

  return architectOutput.proposed_risks.map(
    (risk, index) => {
      const relatedStepIds = steps
        .filter(
          (step) =>
            step.risk_level === risk.risk_level
            || step.risk_categories.includes(
              risk.category,
            ),
        )
        .map((step) => step.id);

      return {
        id: normalizeId(
          risk.id,
          `risk_${index + 1}`,
        ),
        label: normalizeText(
          risk.label,
          risk.category.replaceAll("_", " "),
          120,
        ),
        category: risk.category,
        risk_level: risk.risk_level,
        reason: normalizeText(
          risk.reason,
          "Risk identified by the Blueprint Architect.",
          400,
        ),
        recommendation: normalizeText(
          risk.recommendation,
          "Keep sensitive or external actions human-reviewed.",
          400,
        ),
        step_ids:
          relatedStepIds.length > 0
            ? relatedStepIds
            : steps.map((step) => step.id),
      };
    },
  );
}

function deriveBoundary(
  architectOutput: BlueprintArchitectOutput,
  steps: WorkflowStep[],
): AutomationBoundary {
  const hasBlockedStep = steps.some(
    (step) =>
      step.automation_policy
        === "blocked_in_mvp"
      || step.automation_policy
        === "not_recommended",
  );

  const hasApprovalStep =
    architectOutput.requires_human_approval
      .length > 0
    || steps.some(
      (step) =>
        step.approval_required
        || step.automation_policy
          === "human_approval",
    );

  const hasAssistantOnlyStep = steps.some(
    (step) =>
      step.automation_policy === "assist_only",
  );

  if (
    hasBlockedStep
    && architectOutput.safe_to_automate.length
      === 0
  ) {
    return "not_safe_to_automate";
  }

  if (hasApprovalStep) {
    return "human_approval_required";
  }

  if (hasAssistantOnlyStep) {
    return "assistant_only";
  }

  if (
    steps.every(
      (step) =>
        step.automation_policy === "automate",
    )
  ) {
    return "fully_automatable";
  }

  return "partially_automatable";
}

function isUsableAiArchitectOutput(
  output: BlueprintArchitectOutput,
): boolean {
  return (
    output.used_ai === true
    && output.fallback_used === false
    && output.status === "used_ai"
    && output.proposed_steps.length > 0
    && output.workflow_name.trim().length > 0
  );
}

export function buildBlueprintFromArchitectOutput(
  input: BuildBlueprintFromArchitectOutputInput,
): SafeAutomationBlueprint | null {
  const {
    jobId,
    processInput,
    architectOutput,
    deterministicFallback,
    risks,
  } = input;

  if (
    !isUsableAiArchitectOutput(architectOutput)
  ) {
    return null;
  }

  const steps = buildSteps(
    architectOutput,
    risks,
  );

  if (steps.length === 0) {
    return null;
  }

  const humanApprovalGates =
    buildApprovalGates(
      architectOutput,
      steps,
    );

  const riskItems = buildRiskItems(
    architectOutput,
    steps,
    deterministicFallback.risks,
  );

  const draftOnly = uniqueStrings(
    architectOutput.must_remain_draft_only,
  );

  const blocked = uniqueStrings(
    architectOutput.blocked_or_not_recommended,
  );

  return {
    id: jobId,
    workflow_name: normalizeText(
      architectOutput.workflow_name,
      deterministicFallback.workflow_name,
      160,
    ),
    summary: normalizeText(
      architectOutput.summary,
      deterministicFallback.summary,
      800,
    ),
    automation_boundary: deriveBoundary(
      architectOutput,
      steps,
    ),
    trigger: inferTrigger(
      processInput,
      deterministicFallback.trigger,
    ),
    steps,
    safe_to_automate: uniqueStrings(
      architectOutput.safe_to_automate,
    ),
    needs_human_approval: uniqueStrings(
      architectOutput.requires_human_approval,
    ),
    not_recommended: blocked,
    not_safe_to_automate:
      deriveBoundary(architectOutput, steps)
        === "not_safe_to_automate"
        ? blocked
        : [],
    risks: riskItems,
    human_approval_gates:
      humanApprovalGates,
    test_cases:
      deterministicFallback.test_cases,
    assumptions: uniqueStrings([
      ...architectOutput.assumptions,
      "The Blueprint Architect output was selected as the primary workflow design.",
      "FlowForge remains non-executing and does not activate production workflows.",
      ...draftOnly.map(
        (item) => `Draft-only boundary: ${item}`,
      ),
    ]),
    open_questions: uniqueStrings(
      architectOutput.open_questions,
    ),
  };
}