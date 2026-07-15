import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nImplementationBrief,
} from "../../shared/types/n8nWorkflow";
import type { WorkflowStep } from "../../shared/types/workflow";

function truncateText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function addUnique(items: string[], value: unknown, maxLength = 160): void {
  const text = truncateText(value, maxLength);

  if (text && !items.includes(text)) {
    items.push(text);
  }
}

function uniqueStrings(
  items: unknown[],
  maxItems: number,
  maxLength: number,
): string[] {
  const result: string[] = [];

  for (const item of items) {
    addUnique(result, item, maxLength);
    if (result.length >= maxItems) break;
  }

  return result;
}

function normalizeInput(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(input: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => input.includes(phrase));
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function detectTriggerDescription(compileJob: CompileJob): string {
  const trigger = compileJob.result.trigger;

  if (trigger?.description?.trim()) {
    return truncateText(
      trigger.description.replace(/^rule-based .+ inferred from:\s*/i, ""),
      180,
    );
  }

  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  const whenMatch = input.match(
    /\b(when(?:ever)?|after|once)\s+(.+?)(?:,|\.|$)/,
  );

  if (whenMatch?.[0]) {
    return titleCase(truncateText(whenMatch[0].replace(/[,.]$/, ""), 160));
  }

  if (hasAny(input, ["every morning", "each morning"])) {
    return "Every morning";
  }

  if (input.includes("every weekday")) {
    return "Every weekday";
  }

  if (hasAny(input, ["daily", "every day", "each day"])) {
    return "Daily";
  }

  if (hasAny(input, ["weekly", "every week"])) {
    return "Weekly";
  }

  if (hasAny(input, ["monthly", "every month"])) {
    return "Monthly";
  }

  return "Manual trigger";
}

function detectSource(
  compileJob: CompileJob,
  triggerDescription: string,
): string {
  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  const addressedInbox = input.match(
    /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?:\s+inbox)?\b/,
  )?.[1];

  if (addressedInbox) {
    return `${addressedInbox} inbox`;
  }

  const knownSources = [
    "gmail",
    "outlook",
    "microsoft 365",
    "imap",
    "admissions inbox",
    "support inbox",
    "sales inbox",
    "finance inbox",
    "shared inbox",
    "email inbox",
    "inbox",
    "google sheet",
    "spreadsheet",
    "notion",
    "slack",
    "webhook",
    "form",
    "database",
    "crm",
  ];

  const context = `${input} ${normalizeInput(triggerDescription)}`;

  const source = knownSources.find((candidate) => context.includes(candidate));

  if (source) {
    return source;
  }

  if (
    compileJob.result.trigger?.source &&
    compileJob.result.trigger.source !== "compiler_preview"
  ) {
    return truncateText(compileJob.result.trigger.source, 120);
  }

  return "user-configured source";
}

function stepIsRequested(step: WorkflowStep): boolean {
  return (
    step.primitive !== "risk_detection" &&
    step.primitive !== "validation" &&
    !/^block\b/i.test(step.label) &&
    !/^check safety\b/i.test(step.label)
  );
}

function getBlueprintSteps(compileJob: CompileJob): WorkflowStep[] {
  return compileJob.result.steps.filter(stepIsRequested);
}

function detectExplicitExtractedFields(input: string): string[] {
  const fields: string[] = [];

  const extractMatch = input.match(
    /\bextract\s+(?:the\s+)?(.+?)(?:,\s*(?:classify|create|prepare|route|draft|write|send|notify)\b|\s+and\s+(?:classify|create|prepare|route|draft|write|send|notify)\b|\.|$)/,
  );

  const fieldText = extractMatch?.[1]?.split(/\bfrom\s+(?:the\s+)?/)[0] ?? "";

  for (const rawField of fieldText.replace(/\s+and\s+/g, ", ").split(/[,;]/)) {
    const field = rawField
      .replace(/^(?:the|a|an)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();

    addUnique(fields, field, 80);
  }

  return fields;
}

function detectExtractedFields(
  compileJob: CompileJob,
  steps: WorkflowStep[],
): string[] {
  if (!steps.some((step) => step.primitive === "extraction")) {
    return [];
  }

  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  const explicitFields = detectExplicitExtractedFields(input);

  if (explicitFields.length > 0) {
    return explicitFields.slice(0, 8);
  }

  const extractionStep = steps.find((step) => step.primitive === "extraction");

  const candidateText = `${extractionStep?.description ?? ""} ${extractionStep?.output ?? ""}`;

  const match = candidateText.match(/\bextract\s+(.+?)(?:\.|$)/i);

  if (!match?.[1]) {
    return [];
  }

  return uniqueStrings(
    match[1].replace(/\s+and\s+/gi, ", ").split(/[,;]/),
    8,
    80,
  );
}

function detectClassificationTarget(
  compileJob: CompileJob,
  steps: WorkflowStep[],
): string {
  const classificationStep = steps.find(
    (step) => step.primitive === "classification",
  );

  if (!classificationStep) {
    return "";
  }

  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  const explicitMatch = input.match(
    /\bclassify\s+(?:the\s+)?([a-z0-9 -]{2,80}?)(?:,|\.|\band\s+(?:create|prepare|route|draft|send|notify|log)\b|$)/,
  );

  if (explicitMatch?.[1]) {
    return truncateText(explicitMatch[1].trim(), 80);
  }

  return truncateText(
    classificationStep.output ||
      classificationStep.label.replace(/^classify\s+/i, ""),
    80,
  );
}

function buildClassificationRules(target: string): string[] {
  if (!target) {
    return [];
  }

  return [
    `Classify ${target} using the clarified request and source data.`,
    "Return a concise machine-readable value.",
  ];
}

function outputFromPrimitive(step: WorkflowStep): string | null {
  switch (step.primitive) {
    case "summarization":
      return "summary";

    case "drafting":
      return step.output || "draft";

    case "notification":
      return step.output || "sent notification";

    case "record_creation":
      return step.output || "created record or task";

    case "reporting":
      return step.output || "report";

    case "export":
      return step.output || "export";

    case "routing":
      return step.output || "routed item";

    default:
      return null;
  }
}

function detectRequestedOutputs(
  compileJob: CompileJob,
  steps: WorkflowStep[],
): string[] {
  const outputs: string[] = [];

  for (const step of steps) {
    const output = outputFromPrimitive(step);

    if (output) {
      addUnique(outputs, output, 120);
    }
  }

  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  if (hasAny(input, ["summary", "summarize", "digest", "recap"])) {
    addUnique(outputs, "summary", 120);
  }

  if (hasAny(input, ["tags", "tag the", "labels", "label the"])) {
    addUnique(outputs, "tags", 120);
  }

  if (/\bcreate\b.{0,50}\b(?:task|ticket|record)\b/.test(input)) {
    addUnique(outputs, "internal task or record", 120);
  }

  if (/\bdraft\b.{0,50}\b(?:reply|email|message|response)\b/.test(input)) {
    addUnique(outputs, "draft reply", 120);
  }

  if (
    /\b(?:send|post|notify)\b.{0,100}\bslack\b|\bslack\b.{0,100}\b(?:send|post|notify)\b/.test(
      input,
    )
  ) {
    addUnique(outputs, "Slack message", 120);
  } else if (
    /\b(?:send|reply|notify|forward)\b.{0,100}\b(?:email|message|applicant|customer|student|team)\b/.test(
      input,
    )
  ) {
    addUnique(outputs, "sent email or message", 120);
  }

  if (hasAny(input, ["report", "dashboard"])) {
    addUnique(outputs, "report", 120);
  }

  if (outputs.length === 0) {
    const lastStep = steps.at(-1);

    addUnique(outputs, lastStep?.output || "requested output", 120);
  }

  return outputs.slice(0, 8);
}

function recommendedNodeName(
  step: WorkflowStep,
  triggerDescription: string,
  source: string,
): string {
  const context = normalizeInput(
    `${triggerDescription} ${source} ${step.description}`,
  );

  if (
    step.primitive === "intake" ||
    step.id.includes("trigger") ||
    step.label.toLowerCase().includes("collect")
  ) {
    if (hasAny(context, ["email", "inbox", "gmail", "imap", "outlook"])) {
      return "Email Trigger: Configurable Inbox";
    }

    if (
      hasAny(context, [
        "daily",
        "morning",
        "weekly",
        "weekday",
        "monthly",
        "schedule",
        "every",
      ])
    ) {
      return "Schedule Trigger";
    }

    if (context.includes("webhook")) {
      return "Webhook Trigger";
    }

    return "Manual Trigger";
  }

  switch (step.primitive) {
    case "summarization":
      return "AI Summarizer";

    case "extraction":
      return "Extract Requested Fields";

    case "classification":
      return `Classify ${titleCase(step.output || "Requested Value")}`;

    case "drafting":
      return "Generate Requested Draft";

    case "notification":
      return /slack/i.test(`${step.label} ${step.description} ${step.output}`)
        ? "Send Requested Slack Message"
        : "Send Requested Message";

    case "record_creation":
      return "Create Requested Record Or Task";

    case "routing":
      return "Route Requested Item";

    case "reporting":
      return "Create Requested Report";

    case "export":
      return "Export Requested Output";

    case "approval":
      return "Human Approval";

    default:
      return step.label || titleCase(step.primitive);
  }
}

function buildRecommendedNodes(
  steps: WorkflowStep[],
  triggerDescription: string,
  source: string,
  outputs: readonly string[],
): string[] {
  const nodes: string[] = [];

  for (const step of steps) {
    addUnique(
      nodes,
      recommendedNodeName(step, triggerDescription, source),
      100,
    );
  }

  if (!nodes.some((node) => /trigger/i.test(node))) {
    const triggerContext = normalizeInput(`${triggerDescription} ${source}`);

    if (
      hasAny(triggerContext, ["email", "inbox", "gmail", "imap", "outlook"])
    ) {
      nodes.unshift("Email Trigger: Configurable Inbox");
    } else if (
      hasAny(triggerContext, [
        "daily",
        "morning",
        "weekly",
        "weekday",
        "monthly",
        "schedule",
        "every",
      ])
    ) {
      nodes.unshift("Schedule Trigger");
    } else {
      nodes.unshift("Manual Trigger");
    }
  }

  if (
    outputs.includes("summary") &&
    !nodes.some((node) => /summar/i.test(node))
  ) {
    nodes.push("AI Summarizer");
  }

  if (
    outputs.includes("summary") &&
    !nodes.some((node) => /output summary/i.test(node))
  ) {
    nodes.push("Output Summary");
  }

  return uniqueStrings(nodes, 8, 100);
}

function explicitApprovalGates(steps: WorkflowStep[]): string[] {
  return steps
    .filter((step) => step.primitive === "approval" || step.approval_required)
    .map((step) => truncateText(step.label || step.description, 160))
    .filter(Boolean)
    .slice(0, 4);
}

function explicitBlockedActions(compileJob: CompileJob): string[] {
  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  const blocked: string[] = [];

  if (
    /\b(?:do not|don't|never|without)\b.{0,80}\b(?:send|reply|publish|delete|update|charge|refund)\b/.test(
      input,
    )
  ) {
    addUnique(
      blocked,
      "Respect the explicit action boundary in the clarified request.",
      160,
    );
  }

  return blocked;
}

function buildWorkflowGoal(
  compileJob: CompileJob,
  steps: WorkflowStep[],
  outputs: readonly string[],
): string {
  const blueprintSummary = truncateText(compileJob.result.summary, 280);

  if (blueprintSummary) {
    return blueprintSummary;
  }

  const stepLabels = steps.map((step) => step.label).filter(Boolean);

  if (stepLabels.length > 0) {
    return truncateText(stepLabels.join(" -> "), 280);
  }

  return truncateText(
    `Produce ${outputs.join(", ") || "the requested output"}.`,
    280,
  );
}

function isGenericWorkflowName(value: string): boolean {
  const normalized = normalizeInput(value);

  return [
    "workflow",
    "automation",
    "automation workflow",
    "classification workflow",
    "extraction workflow",
    "summarization workflow",
    "processing workflow",
    "generated workflow",
    "generated n8n workflow",
    "n8n workflow",
    "safe automation preview",
    "internal automation preview",
  ].includes(normalized);
}

function cleanSourceForWorkflowName(source: string): string {
  return source
    .replace(/\b(?:email\s+)?inbox\b/gi, "")
    .replace(/\buser-configured source\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOutputForWorkflowName(output: string): string {
  return output
    .replace(/\binternal\b/gi, "")
    .replace(/\brequested\b/gi, "")
    .replace(/\bor\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveWorkflowName(
  compileJob: CompileJob,
  implementationBrief: N8nImplementationBrief,
): string {
  const existingName = truncateText(compileJob.result.workflow_name, 120);

  if (existingName && !isGenericWorkflowName(existingName)) {
    return existingName;
  }

  const input = normalizeInput(
    compileJob.input.trimmed || compileJob.input.raw,
  );

  if (
    hasAny(input, [
      "job application",
      "job applications",
      "candidate",
      "candidates",
      "admissions inbox",
      "application priority",
    ])
  ) {
    return "Admissions Application Review";
  }

  if (
    hasAny(input, [
      "support inbox",
      "support email",
      "support ticket",
      "customer support",
    ])
  ) {
    return "Support Inbox Processing";
  }

  if (
    hasAny(input, [
      "sales inbox",
      "sales lead",
      "sales leads",
      "lead qualification",
    ])
  ) {
    return "Sales Lead Processing";
  }

  if (
    hasAny(input, ["invoice", "invoices", "finance inbox", "expense receipt"])
  ) {
    return "Invoice Processing";
  }

  if (
    hasAny(input, [
      "employee onboarding",
      "new employee",
      "new hire",
      "onboarding task",
    ])
  ) {
    return "Employee Onboarding";
  }

  if (
    hasAny(input, ["meeting notes", "meeting transcript", "meeting summary"])
  ) {
    return "Meeting Notes Processing";
  }

  const source = cleanSourceForWorkflowName(implementationBrief.source);

  const output = cleanOutputForWorkflowName(
    implementationBrief.internal_outputs[0] || "",
  );

  if (source && output) {
    return titleCase(truncateText(`${source} ${output}`, 120));
  }

  if (source) {
    return titleCase(truncateText(`${source} Processing`, 120));
  }

  if (output) {
    return titleCase(truncateText(`${output} Workflow`, 120));
  }

  const classificationTarget = implementationBrief.classification_target;

  if (classificationTarget) {
    return titleCase(truncateText(`${classificationTarget} Processing`, 120));
  }

  return "Generated n8n Workflow";
}

export function buildN8nImplementationBrief(
  compileJob: CompileJob,
): N8nImplementationBrief {
  const steps = getBlueprintSteps(compileJob);
  const triggerDescription = detectTriggerDescription(compileJob);
  const source = detectSource(compileJob, triggerDescription);
  const extractedFields = detectExtractedFields(compileJob, steps);
  const classificationTarget = detectClassificationTarget(compileJob, steps);
  const internalOutputs = detectRequestedOutputs(compileJob, steps);
  const humanApprovalGates = explicitApprovalGates(steps);
  const blockedActions = explicitBlockedActions(compileJob);
  const recommendedNodes = buildRecommendedNodes(
    steps,
    triggerDescription,
    source,
    internalOutputs,
  );

  return {
    workflow_goal: buildWorkflowGoal(compileJob, steps, internalOutputs),
    trigger_description: triggerDescription,
    source,
    extracted_fields: extractedFields,
    classification_target: classificationTarget,
    classification_rules: buildClassificationRules(classificationTarget),
    internal_outputs: internalOutputs,
    human_approval_gates: humanApprovalGates,
    blocked_or_not_safe_actions: blockedActions,
    warnings: uniqueStrings(compileJob.result.assumptions ?? [], 6, 180),
    recommended_nodes: recommendedNodes,
  };
}

export function buildCompactN8nGenerationInput(
  compileJob: CompileJob,
): CompactN8nGenerationInput {
  const implementationBrief = buildN8nImplementationBrief(compileJob);

  return {
    original_request: truncateText(
      compileJob.input.trimmed || compileJob.input.raw,
      1200,
    ),
    workflow_name: deriveWorkflowName(compileJob, implementationBrief),
    blueprint_summary: truncateText(compileJob.result.summary, 500),
    safety_status: "",
    safety_summary: "",
    next_safe_action: "",
    risk_level: compileJob.risks?.risk_level,
    readiness_score: compileJob.readiness?.score,
    ...implementationBrief,
  };
}
