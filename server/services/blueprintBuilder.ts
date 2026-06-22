import type { CompileMode } from "../../shared/types/compileJob";
import type {
  AutomationBoundary,
  AutomationReadinessScore,
  DryRunTestCase,
  HumanApprovalGate,
  RealWorldExecutionPolicy,
  RiskCategory,
  RiskItem,
  RiskLevel,
  RiskSummary,
  SafeAutomationBlueprint,
  SignalSummary,
  StepAutomationPolicy,
  WorkflowActor,
  WorkflowPrimitive,
  WorkflowStep,
  WorkflowTrigger,
} from "../../shared/types/workflow";

export type BuildBlueprintInput = {
  jobId: string;
  processInput: string;
  signals: SignalSummary;
  risks: RiskSummary;
  readiness: AutomationReadinessScore;
  mode: CompileMode;
};

type RiskItemDefinition = {
  label: string;
  risk_level: RiskLevel;
  reason: string;
  recommendation: string;
};

type StepDefinition = {
  id: string;
  label: string;
  description: string;
  primitive: WorkflowPrimitive;
  actor: WorkflowActor;
  input: string;
  output: string;
  automation_policy: StepAutomationPolicy;
  approval_required?: boolean;
  risk_categories?: RiskCategory[];
  real_world_execution?: RealWorldExecutionPolicy;
};

const highRiskCategories: readonly RiskCategory[] = [
  "legal",
  "medical",
  "visa_or_immigration",
  "employment",
  "delete_or_destructive_action",
  "account_access",
  "high_stakes_decision",
  "real_world_execution",
];

const financialRiskCategories: readonly RiskCategory[] = ["financial", "refund_or_payment"];

const highStakesDecisionCategories: readonly RiskCategory[] = [
  "legal",
  "medical",
  "visa_or_immigration",
  "employment",
  "high_stakes_decision",
];

const dataAccessCategories: readonly RiskCategory[] = ["account_access", "personal_data"];

const executionBlockCategories: readonly RiskCategory[] = [
  "real_world_execution",
  "delete_or_destructive_action",
  "financial",
  "refund_or_payment",
  "account_access",
];

const riskItemDefinitions: Record<RiskCategory, RiskItemDefinition> = {
  external_communication: {
    label: "External communication",
    risk_level: "medium",
    reason: "Sending messages can affect customers, students, employees, or partners.",
    recommendation: "Generate drafts only and require a human to approve or send.",
  },
  personal_data: {
    label: "Personal data",
    risk_level: "medium",
    reason: "Personal data requires a clear source, permission boundary, and retention plan.",
    recommendation: "Confirm data access and minimize what appears in drafts or reports.",
  },
  financial: {
    label: "Refund, payment, or financial action",
    risk_level: "medium",
    reason: "Financial outcomes can affect money, billing, and policy commitments.",
    recommendation: "Keep financial decisions and payment actions under accountable human review.",
  },
  legal: {
    label: "Legal risk",
    risk_level: "high",
    reason: "Legal workflows can create commitments or advice that need accountable ownership.",
    recommendation: "Route legal content to a qualified human reviewer before any decision or message.",
  },
  medical: {
    label: "Medical risk",
    risk_level: "high",
    reason: "Medical workflows can affect health-related decisions and advice.",
    recommendation: "Keep medical judgment with a qualified human reviewer.",
  },
  visa_or_immigration: {
    label: "Visa or immigration risk",
    risk_level: "high",
    reason: "Visa and immigration workflows can affect eligibility, status, and life-impacting outcomes.",
    recommendation: "Require accountable human review before any recommendation or reply.",
  },
  employment: {
    label: "Employment risk",
    risk_level: "high",
    reason: "Employment workflows can affect hiring, firing, promotion, or workplace outcomes.",
    recommendation: "Keep employment decisions under accountable human review.",
  },
  refund_or_payment: {
    label: "Refund, payment, or financial action",
    risk_level: "medium",
    reason: "Refund and payment workflows can affect customer funds and company policy.",
    recommendation: "Keep financial decisions and payment actions under accountable human review.",
  },
  complaint_or_angry_user: {
    label: "Complaint or angry user",
    risk_level: "medium",
    reason: "Complaints and angry messages need careful tone, escalation, and context review.",
    recommendation: "Route sensitive complaint handling to a human before external communication.",
  },
  delete_or_destructive_action: {
    label: "Destructive action",
    risk_level: "high",
    reason: "Deleting, removing, or cancelling records can be hard to reverse.",
    recommendation: "Require explicit approval and a rollback plan before destructive changes.",
  },
  account_access: {
    label: "Account access",
    risk_level: "high",
    reason: "Account access workflows can expose or change user permissions and records.",
    recommendation: "Confirm permissions and require human review before account changes.",
  },
  high_stakes_decision: {
    label: "High-stakes decision",
    risk_level: "high",
    reason: "Sensitive decisions need accountable ownership outside the automated preview.",
    recommendation: "Keep decision authority with a human reviewer.",
  },
  real_world_execution: {
    label: "Real-world execution",
    risk_level: "high",
    reason: "The preview compiler and MVP should not trigger production systems automatically.",
    recommendation: "Block execution and export only a reviewed implementation plan.",
  },
};

const primitiveSafeItems: Partial<Record<WorkflowPrimitive, string>> = {
  classification: "Classifying incoming items for internal use",
  extraction: "Extracting fields for review",
  risk_detection: "Detecting obvious risk categories with deterministic rules",
  routing: "Routing items internally to an owner or queue",
  drafting: "Preparing internal draft-only text",
  validation: "Checking required fields and schema shape",
  notification: "Preparing notification drafts without sending",
  record_creation: "Preparing internal record or task fields",
  monitoring: "Monitoring internal conditions for review",
  escalation: "Escalating risky items to a human owner",
  summarization: "Summarizing process details for internal review",
  reporting: "Preparing non-executing reports",
};

function addUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function hasRisk(categories: readonly RiskCategory[], category: RiskCategory): boolean {
  return categories.includes(category);
}

function hasAnyRisk(categories: readonly RiskCategory[], candidates: readonly RiskCategory[]): boolean {
  return candidates.some((category) => hasRisk(categories, category));
}

function hasPrimitive(signals: SignalSummary, primitive: WorkflowPrimitive): boolean {
  return signals.workflow_primitives.includes(primitive);
}

function categoriesFrom(
  categories: readonly RiskCategory[],
  candidates: readonly RiskCategory[],
): RiskCategory[] {
  return candidates.filter((category) => hasRisk(categories, category));
}

function getRiskLevelForCategories(categories: readonly RiskCategory[]): RiskLevel {
  if (categories.some((category) => highRiskCategories.includes(category))) {
    return "high";
  }

  return categories.length > 0 ? "medium" : "low";
}

function needsBlueprintHumanReview(categories: readonly RiskCategory[], risks: RiskSummary): boolean {
  return risks.requires_human_review || hasAnyRisk(categories, ["personal_data", "complaint_or_angry_user"]);
}

function buildStep(definition: StepDefinition): WorkflowStep {
  const riskCategories = unique(definition.risk_categories ?? []);

  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    primitive: definition.primitive,
    actor: definition.actor,
    input: definition.input,
    output: definition.output,
    automation_policy: definition.automation_policy,
    approval_required: definition.approval_required ?? false,
    risk_level: getRiskLevelForCategories(riskCategories),
    risk_categories: riskCategories,
    real_world_execution: definition.real_world_execution ?? "none",
  };
}

function normalizeForPreview(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0] ?? "";
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function getFriendlyRiskLabel(category: RiskCategory): string {
  return riskItemDefinitions[category].label.toLowerCase();
}

function getFriendlyRiskLabels(categories: readonly RiskCategory[]): string[] {
  return unique(categories.map(getFriendlyRiskLabel));
}

function getWorkflowFocus(signals: SignalSummary): string {
  if (hasPrimitive(signals, "classification")) {
    return "Classification Workflow";
  }

  if (hasPrimitive(signals, "drafting")) {
    return "Drafting Workflow";
  }

  if (hasPrimitive(signals, "extraction") && hasPrimitive(signals, "record_creation")) {
    return "Job Application Intake Workflow";
  }

  if (hasPrimitive(signals, "extraction")) {
    return "Extraction Workflow";
  }

  if (hasPrimitive(signals, "routing") || hasPrimitive(signals, "escalation")) {
    return "Routing Workflow";
  }

  if (hasPrimitive(signals, "monitoring")) {
    return "Monitoring Workflow";
  }

  if (hasPrimitive(signals, "summarization")) {
    return "Summarization Workflow";
  }

  if (hasPrimitive(signals, "reporting")) {
    return "Reporting Workflow";
  }

  if (hasPrimitive(signals, "record_creation")) {
    return "Internal Record Workflow";
  }

  return "Safe Automation Preview";
}

function getWorkflowDomain(categories: readonly RiskCategory[]): string {
  if (hasRisk(categories, "visa_or_immigration")) {
    return "Visa or Immigration Review";
  }

  if (hasRisk(categories, "medical")) {
    return "Medical Review";
  }

  if (hasRisk(categories, "legal")) {
    return "Legal Review";
  }

  if (hasRisk(categories, "employment")) {
    return "Employment Review";
  }

  if (hasAnyRisk(categories, financialRiskCategories)) {
    return "Refund or Payment Review";
  }

  if (hasRisk(categories, "account_access")) {
    return "Account Access Review";
  }

  if (hasRisk(categories, "delete_or_destructive_action")) {
    return "Destructive Action Review";
  }

  if (hasRisk(categories, "external_communication")) {
    return "External Communication Review";
  }

  if (hasRisk(categories, "personal_data")) {
    return "Personal Data Review";
  }

  if (hasRisk(categories, "complaint_or_angry_user")) {
    return "Complaint Triage Review";
  }

  if (hasRisk(categories, "high_stakes_decision")) {
    return "High-Stakes Decision Review";
  }

  return "";
}

function buildWorkflowName(signals: SignalSummary, risks: RiskSummary): string {
  const domain = getWorkflowDomain(risks.categories);

  if (domain) {
    return `${domain} Workflow`;
  }

  return getWorkflowFocus(signals);
}

function getSummaryPrimitiveNames(signals: SignalSummary, risks: RiskSummary): string {
  const primitives = signals.workflow_primitives.filter((primitive) => {
    if (primitive === "intake") {
      return false;
    }

    if (primitive === "approval" && !risks.requires_human_review) {
      return false;
    }

    if (primitive === "risk_detection" && risks.categories.length === 0) {
      return false;
    }

    return true;
  });

  if (primitives.length === 0) {
    return "preview";
  }

  const labels: Partial<Record<WorkflowPrimitive, string>> = {
    classification: "classification",
    extraction: "extraction",
    routing: "routing",
    drafting: "drafting",
    approval: "approval",
    validation: "validation",
    notification: "notification",
    record_creation: "internal task",
    monitoring: "monitoring",
    escalation: "escalation",
    summarization: "summarization",
    reporting: "reporting",
    risk_detection: "risk review",
    export: "export",
  };

  return joinList(primitives.map((primitive) => labels[primitive] ?? primitive));
}

function articleFor(text: string): "a" | "an" {
  return /^[aeiou]/i.test(text) ? "an" : "a";
}

function buildSummary(signals: SignalSummary, risks: RiskSummary, readiness: AutomationReadinessScore): string {
  const primitiveNames = getSummaryPrimitiveNames(signals, risks);
  const workflowPhrase =
    primitiveNames === "preview"
      ? "a preview"
      : `${articleFor(primitiveNames)} ${primitiveNames} workflow`;

  const parts = [
    `Rule-based preview for ${workflowPhrase} with readiness ${readiness.score}/100.`,
  ];

  if (risks.categories.length > 0) {
    parts.push(`Detected risks include ${joinList(getFriendlyRiskLabels(risks.categories))}.`);
  } else {
    parts.push("No obvious high-risk categories were detected by deterministic rules.");
  }

  if (hasRisk(risks.categories, "external_communication")) {
    parts.push("External messages remain draft-only until a human approves them.");
  }

  if (hasRisk(risks.categories, "real_world_execution")) {
    parts.push("Real-world execution is blocked in the MVP.");
  }

  if (risks.requires_human_review) {
    parts.push("Detected risk categories require human approval before any real action.");
  }

  if (signals.missing_critical_info.length > 0) {
    parts.push("Missing trigger, output, permission, or execution details should be clarified before implementation.");
  }

  return parts.join(" ");
}

function inferTrigger(processInput: string, signals: SignalSummary): WorkflowTrigger {
  const normalizedInput = processInput.toLowerCase();
  const preview = normalizeForPreview(processInput);

  if (normalizedInput.includes("webhook") || normalizedInput.includes("api")) {
    return {
      type: "webhook",
      source: "webhook_or_api",
      description: `Rule-based webhook trigger inferred from: ${preview}`,
    };
  }

  if (
    signals.has_scheduled_trigger ||
    hasPrimitive(signals, "monitoring") ||
    normalizedInput.includes("daily") ||
    normalizedInput.includes("weekly")
  ) {
    return {
      type: "scheduled",
      source: "scheduled_monitor",
      description: `Rule-based scheduled trigger inferred from: ${preview}`,
    };
  }

  if (signals.has_external_action) {
    return {
      type: "incoming_message",
      source: "message_or_inbox",
      description: `Rule-based incoming message trigger inferred from: ${preview}`,
    };
  }

  if (!signals.has_trigger) {
    return {
      type: "unknown",
      source: "compiler_preview",
      description: "No explicit trigger was detected, so FlowForge treats this as a manual preview input.",
    };
  }

  return {
    type: "manual_input",
    source: "compiler_preview",
    description: `Rule-based trigger inferred from: ${preview}`,
  };
}

function getAutomationBoundary(
  signals: SignalSummary,
  risks: RiskSummary,
  readiness: AutomationReadinessScore,
): AutomationBoundary {
  if (hasRisk(risks.categories, "real_world_execution") || hasRisk(risks.categories, "delete_or_destructive_action")) {
    return "not_safe_to_automate";
  }

  if (needsBlueprintHumanReview(risks.categories, risks)) {
    return "human_approval_required";
  }

  if (signals.missing_critical_info.length > 0 || readiness.score < 45) {
    return "assistant_only";
  }

  return "partially_automatable";
}

function buildWorkflowSteps(signals: SignalSummary, risks: RiskSummary): WorkflowStep[] {
  const categories = risks.categories;
  const requiresApprovalStep = needsBlueprintHumanReview(categories, risks);
  const hasDetectedRisks = categories.length > 0;

  const steps: WorkflowStep[] = [
    buildStep({
      id: "intake_process",
      label: "Capture process description",
      description: "Store the submitted process text as the source for a non-executing preview.",
      primitive: "intake",
      actor: "system",
      input: "User process description",
      output: "Compile job input",
      automation_policy: "automate",
    }),
  ];

  if (hasPrimitive(signals, "monitoring")) {
    steps.push(
      buildStep({
        id: "monitor_condition",
        label: "Monitor condition",
        description: "Describe the monitored condition without connecting a live scheduler or listener.",
        primitive: "monitoring",
        actor: "system",
        input: "Process trigger details",
        output: "Monitoring plan",
        automation_policy: "assist_only",
      }),
    );
  }

  if (hasPrimitive(signals, "classification")) {
    steps.push(
      buildStep({
        id: "classify_request",
        label: "Classify the request",
        description: "Identify the likely workflow shape, topic, or category with deterministic rules.",
        primitive: "classification",
        actor: "rules",
        input: "Compile job input",
        output: "Workflow classification",
        automation_policy: "automate",
      }),
    );
  }

  if (hasPrimitive(signals, "extraction")) {
    steps.push(
      buildStep({
        id: "extract_required_fields",
        label: "Extract required fields",
        description: "Pull structured fields from the submitted process for review.",
        primitive: "extraction",
        actor: "rules",
        input: "Compile job input",
        output: "Extracted field list",
        automation_policy: "automate",
        risk_categories: categoriesFrom(categories, dataAccessCategories),
      }),
    );
  }

  if (hasPrimitive(signals, "summarization")) {
    steps.push(
      buildStep({
        id: "summarize_context",
        label: "Summarize context",
        description: "Prepare a concise internal summary for reviewers.",
        primitive: "summarization",
        actor: "rules",
        input: "Compile job input",
        output: "Internal summary",
        automation_policy: "automate",
        risk_categories: categoriesFrom(categories, ["personal_data", "medical", "legal", "visa_or_immigration"]),
      }),
    );
  }

  steps.push(
    buildStep({
      id: "detect_risks",
      label: hasDetectedRisks ? "Detect safety risks" : "Check safety boundary",
      description: hasDetectedRisks
        ? "Flag external communication, sensitive data, high-stakes decisions, and execution risk."
        : "Confirm whether the workflow includes external actions, sensitive data, high-stakes decisions, or execution risk.",
      primitive: "risk_detection",
      actor: "rules",
      input: "Workflow signals",
      output: "Risk summary",
      automation_policy: "automate",
      risk_categories: categories,
    }),
  );

  if (hasPrimitive(signals, "validation")) {
    steps.push(
      buildStep({
        id: "validate_required_fields",
        label: "Validate required fields",
        description: "Check whether trigger, output, owner, permission, and execution details are defined.",
        primitive: "validation",
        actor: "rules",
        input: "Workflow signals and missing information",
        output: "Validation notes",
        automation_policy: "automate",
      }),
    );
  }

  if (hasPrimitive(signals, "routing") || hasPrimitive(signals, "escalation")) {
    steps.push(
      buildStep({
        id: "route_or_escalate",
        label: "Route or escalate item",
        description: "Route lower-risk items internally and escalate sensitive cases to a human owner.",
        primitive: "routing",
        actor: "rules",
        input: "Risk summary and classification",
        output: "Owner or queue recommendation",
        automation_policy: "assist_only",
        risk_categories: categoriesFrom(categories, [
          "external_communication",
          "financial",
          "refund_or_payment",
          "legal",
          "medical",
          "visa_or_immigration",
          "employment",
          "complaint_or_angry_user",
          "high_stakes_decision",
        ]),
      }),
    );
  }

  if (hasPrimitive(signals, "drafting")) {
    steps.push(
      buildStep({
        id: "draft_response",
        label: "Draft proposed output",
        description: "Prepare draft text, tasks, or blueprint notes without sending anything.",
        primitive: "drafting",
        actor: "ai",
        input: "Risk-aware workflow summary",
        output: "Draft-only response or task",
        automation_policy: "draft_only",
        risk_categories: categoriesFrom(categories, [
          "external_communication",
          "financial",
          "refund_or_payment",
          "legal",
          "medical",
          "visa_or_immigration",
          "employment",
          "personal_data",
          "complaint_or_angry_user",
          "high_stakes_decision",
        ]),
        real_world_execution: "draft_only",
      }),
    );
  }

  if (hasPrimitive(signals, "notification")) {
    const notificationRisks = categoriesFrom(categories, ["external_communication", "personal_data"]);

    steps.push(
      buildStep({
        id: "prepare_notification",
        label: "Prepare notification",
        description: "Prepare notification content without sending it from the MVP preview.",
        primitive: "notification",
        actor: "system",
        input: "Workflow status and reviewer notes",
        output: "Draft-only notification",
        automation_policy: notificationRisks.length > 0 ? "draft_only" : "assist_only",
        risk_categories: notificationRisks,
        real_world_execution: notificationRisks.length > 0 ? "draft_only" : "none",
      }),
    );
  }

  if (hasPrimitive(signals, "record_creation")) {
    const recordRisks = categoriesFrom(categories, [
      "account_access",
      "personal_data",
      "financial",
      "refund_or_payment",
      "real_world_execution",
    ]);

    steps.push(
      buildStep({
        id: "prepare_internal_record",
        label: "Prepare internal record",
        description: "Prepare record, task, or tag fields without writing to production systems.",
        primitive: "record_creation",
        actor: "system",
        input: "Approved workflow notes",
        output: "Draft record or task payload",
        automation_policy: recordRisks.length > 0 ? "assist_only" : "automate",
        risk_categories: recordRisks,
        real_world_execution: hasRisk(recordRisks, "real_world_execution") ? "blocked_in_mvp" : "none",
      }),
    );
  }

  if (hasPrimitive(signals, "reporting")) {
    steps.push(
      buildStep({
        id: "prepare_report",
        label: "Prepare report",
        description: "Create a non-executing report outline for human review.",
        primitive: "reporting",
        actor: "rules",
        input: "Workflow signals and risk summary",
        output: "Report outline",
        automation_policy: "assist_only",
        risk_categories: categoriesFrom(categories, ["personal_data", "financial", "refund_or_payment"]),
      }),
    );
  }

  if (requiresApprovalStep) {
    steps.push(
      buildStep({
        id: "approve_sensitive_action",
        label: "Approve sensitive action",
        description: "A human reviews external messages, sensitive decisions, data access, or production changes.",
        primitive: "approval",
        actor: "human",
        input: "Risk summary and draft plan",
        output: "Human approval decision",
        automation_policy: "human_approval",
        approval_required: true,
        risk_categories: categories,
        real_world_execution: "requires_human_trigger",
      }),
    );
  }

  steps.push(
    buildStep({
      id: "build_non_executing_preview",
      label: "Build non-executing preview",
      description: "Return a safe blueprint preview and block production execution in the MVP.",
      primitive: "validation",
      actor: "system",
      input: "Compiled blueprint",
      output: "Validated non-executing preview",
      automation_policy: hasRisk(categories, "real_world_execution") ? "blocked_in_mvp" : "automate",
      approval_required: hasRisk(categories, "real_world_execution"),
      risk_categories: categoriesFrom(categories, executionBlockCategories),
      real_world_execution: hasRisk(categories, "real_world_execution") ? "blocked_in_mvp" : "none",
    }),
  );

  return steps;
}

function buildSafeToAutomate(signals: SignalSummary, risks: RiskSummary): string[] {
  const items: string[] = [];

  for (const primitive of signals.workflow_primitives) {
    if (primitive === "approval") {
      continue;
    }

    const safeItem = primitiveSafeItems[primitive];

    if (safeItem) {
      addUnique(items, safeItem);
    }
  }

  if (risks.requires_human_review) {
    addUnique(items, "Preparing a human approval checkpoint");
  }

  addUnique(items, "Generating a non-executing blueprint preview");

  if (items.length === 1) {
    addUnique(items, "Capturing the process description for review");
  }

  return items;
}

function buildNeedsHumanApproval(signals: SignalSummary, risks: RiskSummary): string[] {
  const items: string[] = [];
  const categories = risks.categories;

  if (hasRisk(categories, "external_communication")) {
    addUnique(items, "Any external message before it is sent");
  }

  if (hasAnyRisk(categories, financialRiskCategories)) {
    addUnique(items, "Any refund, payment, billing, or financial decision");
  }

  if (hasRisk(categories, "legal")) {
    addUnique(items, "Any legal recommendation, response, or decision");
  }

  if (hasRisk(categories, "medical")) {
    addUnique(items, "Any medical recommendation, response, or decision");
  }

  if (hasRisk(categories, "visa_or_immigration")) {
    addUnique(items, "Any visa or immigration eligibility recommendation");
  }

  if (hasRisk(categories, "employment")) {
    addUnique(items, "Any employment decision or recommendation");
  }

  if (hasRisk(categories, "account_access")) {
    addUnique(items, "Any account access or permission change");
  }

  if (hasRisk(categories, "personal_data")) {
    addUnique(items, "Any personal data access, export, or sharing decision");
  }

  if (hasRisk(categories, "delete_or_destructive_action")) {
    addUnique(items, "Any delete, removal, cancellation, or destructive action");
  }

  if (hasRisk(categories, "high_stakes_decision")) {
    addUnique(items, "Any sensitive or high-stakes decision");
  }

  if (hasRisk(categories, "real_world_execution")) {
    addUnique(items, "Any workflow step that changes real systems or user records");
  }

  if (hasRisk(categories, "complaint_or_angry_user")) {
    addUnique(items, "Any complaint escalation or emotionally sensitive response");
  }

  if (items.length === 0 && signals.missing_critical_info.length > 0) {
    addUnique(items, "Implementation decisions while trigger or output details are incomplete");
  }

  return items;
}

function buildNotRecommended(signals: SignalSummary, risks: RiskSummary): string[] {
  const items = [
    "Treating AI or rule-based output as final approval",
    "Connecting production credentials too early",
  ];
  const categories = risks.categories;

  if (hasAnyRisk(categories, [
    ...financialRiskCategories,
    ...highStakesDecisionCategories,
    "account_access",
    "delete_or_destructive_action",
  ])) {
    addUnique(items, "Skipping human review for sensitive categories");
  }

  if (hasRisk(categories, "external_communication")) {
    addUnique(items, "Sending messages directly from the preview compiler");
  }

  if (signals.missing_critical_info.length > 0) {
    addUnique(items, "Relying on incomplete trigger, output, permission, or execution details");
  }

  return items;
}

function buildNotSafeToAutomate(risks: RiskSummary): string[] {
  const items = ["Automatic real-world execution in the MVP"];
  const categories = risks.categories;

  if (hasRisk(categories, "external_communication")) {
    addUnique(items, "Sending external messages without a human trigger");
  }

  if (hasAnyRisk(categories, financialRiskCategories)) {
    addUnique(items, "Charging, refunding, or changing payment outcomes automatically");
  }

  if (hasRisk(categories, "account_access") || hasRisk(categories, "delete_or_destructive_action")) {
    addUnique(items, "Deleting or changing account data automatically");
  }

  if (hasAnyRisk(categories, highStakesDecisionCategories)) {
    addUnique(items, "Approving legal, medical, visa, immigration, or employment decisions automatically");
  }

  if (hasRisk(categories, "personal_data")) {
    addUnique(items, "Sharing personal data externally without permission review");
  }

  return items;
}

function getStepIdsForCategories(
  steps: readonly WorkflowStep[],
  categories: readonly RiskCategory[],
): string[] {
  const directMatches = steps
    .filter((step) => step.risk_categories.some((category) => categories.includes(category)))
    .map((step) => step.id);
  const fallbackIds = steps
    .filter((step) => ["detect_risks", "approve_sensitive_action", "build_non_executing_preview"].includes(step.id))
    .map((step) => step.id);

  return unique([...directMatches, ...fallbackIds]);
}

function buildRiskItems(steps: readonly WorkflowStep[], risks: RiskSummary): RiskItem[] {
  return risks.categories.map((category) => {
    const definition = riskItemDefinitions[category];

    return {
      id: `risk_${category}`,
      label: definition.label,
      category,
      risk_level: definition.risk_level,
      reason: definition.reason,
      recommendation: definition.recommendation,
      step_ids: getStepIdsForCategories(steps, [category]),
    };
  });
}

function buildApprovalGate(
  steps: readonly WorkflowStep[],
  id: string,
  label: string,
  categories: readonly RiskCategory[],
  reason: string,
  reviewChecklist: string[],
): HumanApprovalGate {
  return {
    id,
    label,
    required: true,
    applies_to_step_ids: getStepIdsForCategories(steps, categories),
    reason,
    review_checklist: reviewChecklist,
  };
}

function buildHumanApprovalGates(steps: readonly WorkflowStep[], risks: RiskSummary): HumanApprovalGate[] {
  const categories = risks.categories;
  const gates: HumanApprovalGate[] = [];

  if (hasRisk(categories, "external_communication")) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_external_communication",
        "Review external communication",
        ["external_communication"],
        "Messages can affect real people and organizations.",
        [
          "Confirm the recipient and channel.",
          "Check tone, accuracy, and missing context.",
          "Verify no sensitive data is exposed.",
          "Send only after a human chooses to proceed.",
        ],
      ),
    );
  }

  if (hasAnyRisk(categories, financialRiskCategories)) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_payment_or_refund",
        "Review payment or refund decision",
        financialRiskCategories,
        "Financial outcomes need accountable human ownership.",
        [
          "Confirm the policy source and customer context.",
          "Check amount, eligibility, and exception handling.",
          "Keep payment execution outside the MVP preview.",
        ],
      ),
    );
  }

  if (hasAnyRisk(categories, highStakesDecisionCategories)) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_high_stakes_decision",
        "Review high-stakes decision",
        highStakesDecisionCategories,
        "Sensitive categories require accountable human judgment.",
        [
          "Confirm the risk category and reviewer authority.",
          "Check policy, legal, or domain constraints.",
          "Record the human decision separately from generated output.",
        ],
      ),
    );
  }

  if (hasAnyRisk(categories, dataAccessCategories)) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_data_access",
        "Review data access and permissions",
        dataAccessCategories,
        "Personal data and account access require explicit permission boundaries.",
        [
          "Confirm the data source and access owner.",
          "Minimize personal data in drafts, reports, and exports.",
          "Do not update account permissions automatically.",
        ],
      ),
    );
  }

  if (hasRisk(categories, "delete_or_destructive_action")) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_destructive_action",
        "Review destructive action",
        ["delete_or_destructive_action"],
        "Destructive changes can be hard to reverse.",
        [
          "Confirm the exact target record or account.",
          "Verify backup, rollback, and audit requirements.",
          "Require explicit human approval before any deletion or cancellation.",
        ],
      ),
    );
  }

  if (hasRisk(categories, "complaint_or_angry_user")) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_sensitive_complaint",
        "Review complaint handling",
        ["complaint_or_angry_user"],
        "Complaints and angry messages need careful tone and escalation review.",
        [
          "Confirm the complaint context.",
          "Check tone and escalation path.",
          "Send external replies only after human approval.",
        ],
      ),
    );
  }

  if (hasRisk(categories, "real_world_execution")) {
    gates.push(
      buildApprovalGate(
        steps,
        "gate_no_execution",
        "Confirm no automatic execution",
        ["real_world_execution"],
        "The preview compiler must not perform external actions.",
        [
          "Keep outputs as previews or exports.",
          "Do not connect production credentials.",
          "Do not trigger n8n, email, payments, or account updates.",
        ],
      ),
    );
  }

  return gates;
}

function buildDryRunTestCases(processInput: string, risks: RiskSummary): DryRunTestCase[] {
  const testCases: DryRunTestCase[] = [
    {
      id: "dry_run_internal_safe_path",
      name: "Safer internal path",
      input_event: "A teammate asks FlowForge to classify or summarize internal work without sending messages or updating systems.",
      expected_route: "compile_internal_preview",
      expected_human_gate: false,
      reason: "Internal classification, extraction, summarization, and preview generation can stay inside the non-executing boundary.",
    },
  ];

  if (risks.categories.length === 0) {
    testCases.push({
      id: "dry_run_non_executing_preview",
      name: "Non-executing preview",
      input_event: normalizeForPreview(processInput),
      expected_route: "compile_light_blueprint",
      expected_human_gate: false,
      reason: "The rule-based scanner did not detect obvious risk flags, and the MVP still returns a preview only.",
    });

    return testCases;
  }

  if (hasRisk(risks.categories, "visa_or_immigration")) {
    testCases.push({
      id: "dry_run_visa_review",
      name: "Visa or immigration request",
      input_event: "A student asks about visa eligibility and the workflow tries to approve the recommendation automatically.",
      expected_route: "suggest_safer_workflow",
      expected_human_gate: true,
      reason: "Visa and immigration recommendations require accountable human review.",
    });

    return testCases;
  }

  if (hasAnyRisk(risks.categories, financialRiskCategories)) {
    testCases.push({
      id: "dry_run_payment_review",
      name: "Refund or payment request",
      input_event: "A customer asks for a refund and the workflow tries to send a decision or trigger payment automatically.",
      expected_route: "suggest_safer_workflow",
      expected_human_gate: true,
      reason: "Payment outcomes and customer-facing messages require human approval.",
    });

    return testCases;
  }

  if (hasRisk(risks.categories, "external_communication")) {
    testCases.push({
      id: "dry_run_external_message",
      name: "External message request",
      input_event: "A user asks FlowForge to draft and send a customer, student, or partner message.",
      expected_route: "suggest_safer_workflow",
      expected_human_gate: true,
      reason: "Drafting is acceptable, but sending requires a human trigger.",
    });

    return testCases;
  }

  testCases.push({
    id: "dry_run_sensitive_review",
    name: "Sensitive risk request",
    input_event: normalizeForPreview(processInput),
    expected_route: "suggest_safer_workflow",
    expected_human_gate: true,
    reason: "Detected risk categories require human review before any real-world action.",
  });

  return testCases;
}

function questionForMissingInfo(missingInfo: string): string {
  if (missingInfo.includes("Trigger condition")) {
    return "What trigger should start this workflow?";
  }

  if (missingInfo.includes("Expected output")) {
    return "What exact output should the workflow produce?";
  }

  if (missingInfo.includes("External channel")) {
    return "Which external channel and approval owner should be used?";
  }

  if (missingInfo.includes("Data source")) {
    return "Which data source and access permissions are allowed?";
  }

  if (missingInfo.includes("Execution target")) {
    return "Which execution target, owner, and rollback plan would be required later?";
  }

  return `Clarify: ${missingInfo}`;
}

function buildAssumptions(mode: CompileMode): string[] {
  const assumptions = [
    mode === "demo" || mode === "rule_only"
      ? "Demo/rule mode uses deterministic routing and deterministic blueprint generation."
      : "AI may be used only for the router decision. Blueprint generation remains deterministic.",
    "No database, authentication, n8n export, or external execution is connected.",
    "The blueprint describes a safe plan and does not send, update, charge, delete, or trigger production systems.",
  ];

  if (mode === "balanced" || mode === "full") {
    assumptions.push("Groq is the primary router provider and Gemini is the fallback when configured.");
  }

  return assumptions;
}

function buildOpenQuestions(signals: SignalSummary, risks: RiskSummary): string[] {
  const questions = signals.missing_critical_info.map(questionForMissingInfo);

  if (hasRisk(risks.categories, "external_communication")) {
    addUnique(questions, "Who approves external messages before they are sent?");
  }

  if (hasAnyRisk(risks.categories, financialRiskCategories)) {
    addUnique(questions, "Which payment or refund policy should reviewers use?");
  }

  if (hasAnyRisk(risks.categories, highStakesDecisionCategories)) {
    addUnique(questions, "Which qualified owner reviews sensitive decisions?");
  }

  if (hasAnyRisk(risks.categories, dataAccessCategories)) {
    addUnique(questions, "Which data sources and permissions are in scope?");
  }

  if (questions.length === 0) {
    questions.push("Which internal owner should verify the first dry run before any production integration?");
  }

  return questions;
}

export function buildBlueprint({
  jobId,
  processInput,
  signals,
  risks,
  readiness,
  mode,
}: BuildBlueprintInput): SafeAutomationBlueprint {
  const steps = buildWorkflowSteps(signals, risks);

  return {
    id: `blueprint_${jobId}`,
    workflow_name: buildWorkflowName(signals, risks),
    summary: buildSummary(signals, risks, readiness),
    automation_boundary: getAutomationBoundary(signals, risks, readiness),
    trigger: inferTrigger(processInput, signals),
    steps,
    safe_to_automate: buildSafeToAutomate(signals, risks),
    needs_human_approval: buildNeedsHumanApproval(signals, risks),
    not_recommended: buildNotRecommended(signals, risks),
    not_safe_to_automate: buildNotSafeToAutomate(risks),
    risks: buildRiskItems(steps, risks),
    human_approval_gates: buildHumanApprovalGates(steps, risks),
    test_cases: buildDryRunTestCases(processInput, risks),
    assumptions: buildAssumptions(mode),
    open_questions: buildOpenQuestions(signals, risks),
  };
}
