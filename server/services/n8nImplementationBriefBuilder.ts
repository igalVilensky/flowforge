import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nImplementationBrief,
} from "../../shared/types/n8nWorkflow";

type BriefDomain = "admissions" | "support" | "finance" | "generic";

function truncateText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeInput(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(items: string[], item: unknown, maxLength = 160): void {
  const text = truncateText(item, maxLength);

  if (text && !items.includes(text)) {
    items.push(text);
  }
}

function uniqueStrings(items: unknown[], maxItems: number, maxLength: number): string[] {
  const result: string[] = [];

  for (const item of items) {
    addUnique(result, item, maxLength);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function hasAny(input: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => input.includes(phrase));
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function humanGateText(gate: unknown): string {
  if (!gate || typeof gate !== "object") {
    return truncateText(gate, 160);
  }

  const record = gate as Record<string, unknown>;
  const label = truncateText(record.label || record.name || record.title || "Human approval gate", 80);
  const reason = truncateText(record.reason || record.description || "", 90);

  return reason ? `${label}: ${reason}` : label;
}

function findingText(finding: unknown): string {
  if (!finding || typeof finding !== "object") {
    return truncateText(finding, 180);
  }

  const record = finding as Record<string, unknown>;
  const severity = truncateText(record.severity, 24);
  const title = truncateText(record.title || record.label || record.type || "Safety finding", 80);
  const recommendation = truncateText(record.recommendation || record.explanation || "", 90);
  const prefix = severity ? `${severity}: ` : "";

  return recommendation ? `${prefix}${title}: ${recommendation}` : `${prefix}${title}`;
}

function detectDomain(input: string): BriefDomain {
  if (hasAny(input, ["admissions", "candidate", "applicant", "job application", "application email", "portfolio"])) {
    return "admissions";
  }

  if (hasAny(input, ["support", "ticket", "customer", "helpdesk", "zendesk", "complaint"])) {
    return "support";
  }

  if (hasAny(input, ["invoice", "refund", "billing", "payment", "charge", "receipt"])) {
    return "finance";
  }

  return "generic";
}

function detectTriggerDescription(input: string, compileJob: CompileJob): string {
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

  const whenMatch = input.match(/\b(when(?:ever)?|after|once)\s+(.+?)(?:,|\.|$)/);

  if (whenMatch?.[0]) {
    return titleCase(truncateText(whenMatch[0].replace(/[,.]$/, ""), 120));
  }

  const trigger = compileJob.result.trigger;

  if (trigger?.description) {
    return truncateText(trigger.description.replace(/^rule-based .+ inferred from:\s*/i, ""), 180);
  }

  return "Manual internal review trigger";
}

function detectSource(input: string, compileJob: CompileJob, domain: BriefDomain): string {
  const inboxes = [
    "admissions inbox",
    "support inbox",
    "sales inbox",
    "finance inbox",
    "shared inbox",
    "email inbox",
    "inbox",
  ];
  const inbox = inboxes.find((candidate) => input.includes(candidate));

  if (inbox) {
    if (domain === "admissions" && hasAny(input, ["application", "candidate", "applicant"])) {
      return `${inbox} / job application emails`;
    }

    if (domain === "support") {
      return `${inbox} / support emails`;
    }

    if (domain === "finance") {
      return `${inbox} / billing or refund emails`;
    }

    return `${inbox} / incoming emails`;
  }

  const sourceMatch = input.match(/\bfrom\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{1,60}?)(?:,|\.|\band\b|\bwithout\b|$)/);
  const sourceText = sourceMatch?.[1]?.trim();

  if (sourceText) {
    return truncateText(sourceText, 120);
  }

  if (input.includes("email") || input.includes("emails")) {
    if (domain === "admissions") return "job application emails";
    if (domain === "support") return "support emails";
    if (domain === "finance") return "billing or refund emails";

    return "incoming emails";
  }

  if (compileJob.result.trigger?.source && compileJob.result.trigger.source !== "compiler_preview") {
    return truncateText(compileJob.result.trigger.source, 120);
  }

  return "user-provided internal input";
}

function cleanFieldName(value: string): string {
  return value
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
}

function detectExplicitExtractedFields(input: string): string[] {
  const fields: string[] = [];
  const extractMatch = input.match(
    /\bextract\s+(?:the\s+)?(.+?)(?:,\s*(?:classify|create|prepare|route|draft|write|send|notify|without|do not|don't)\b|\s+and\s+(?:classify|create|prepare|route|draft|write|send|notify)\b|\.|$)/,
  );
  const fieldText = extractMatch?.[1]?.split(/\bfrom\s+(?:the\s+)?/)[0] ?? "";

  for (const rawField of fieldText.replace(/\s+and\s+/g, ", ").split(/[,;]/)) {
    addUnique(fields, cleanFieldName(rawField), 80);
  }

  return fields;
}

function detectExtractedFields(input: string, domain: BriefDomain): string[] {
  const fields = detectExplicitExtractedFields(input);

  if (domain === "admissions") {
    if (fields.length === 0 || input.includes("candidate details") || input.includes("application fields")) {
      addUnique(fields, "candidate name", 80);
      addUnique(fields, "role", 80);
      addUnique(fields, "portfolio link", 80);
      addUnique(fields, "application source", 80);
    }

    if (input.includes("candidate name")) addUnique(fields, "candidate name", 80);
    if (input.includes("portfolio")) addUnique(fields, "portfolio link", 80);
    if (input.includes("application source")) addUnique(fields, "application source", 80);
  }

  if (domain === "support" && fields.length === 0) {
    addUnique(fields, "customer name", 80);
    addUnique(fields, "issue summary", 80);
    addUnique(fields, "urgency", 80);
    addUnique(fields, "account identifier", 80);
  }

  if (domain === "finance" && fields.length === 0) {
    addUnique(fields, "customer name", 80);
    addUnique(fields, "invoice number", 80);
    addUnique(fields, "amount", 80);
    addUnique(fields, "refund or billing reason", 80);
  }

  return uniqueStrings(fields, 8, 80);
}

function detectClassificationTarget(input: string, domain: BriefDomain): string {
  const classifyMatch = input.match(
    /\bclassify\s+(?:the\s+)?([a-z0-9 -]{2,80}?)(?:,|\.|\band\s+(?:create|prepare|route|draft|send|notify|log)\b|\bwithout\b|$)/,
  );
  const target = cleanFieldName(classifyMatch?.[1] ?? "");

  if (target) {
    if (target === "priority" && domain === "admissions") return "application priority";
    if (target === "priority" && domain === "support") return "support priority";

    return truncateText(target, 80);
  }

  if (hasAny(input, ["classify", "categorize", "triage", "label"])) {
    if (domain === "admissions") return "application priority";
    if (domain === "support") return "support priority";
    if (domain === "finance") return "refund or billing review category";

    return "internal review category";
  }

  return "";
}

function buildClassificationRules(target: string, domain: BriefDomain): string[] {
  if (!target) return [];

  if (domain === "admissions") {
    return [
      "Use only visible application email content and extracted fields.",
      "Label missing candidate, role, portfolio, or source details as needs manual review.",
      "Treat priority labels as internal triage, not final admissions or hiring decisions.",
    ];
  }

  if (domain === "support") {
    return [
      "Use issue urgency, customer impact, and missing information to assign priority.",
      "Escalate complaints, threats, refunds, or account access requests to manual review.",
      "Keep any reply as a draft until a human approves it.",
    ];
  }

  if (domain === "finance") {
    return [
      "Use invoice, amount, reason, and account details to label the review category.",
      "Route refunds, payments, and billing changes to manual review.",
      "Do not execute payment, refund, or record-update actions automatically.",
    ];
  }

  return [
    "Use only the provided source data and extracted fields.",
    "Flag missing required details as needs manual review.",
    "Keep labels internal until a human approves downstream action.",
  ];
}

function detectInternalOutputs(input: string, domain: BriefDomain, classificationTarget: string): string[] {
  const outputs: string[] = [];

  if (domain === "admissions") {
    addUnique(outputs, "internal admissions review task", 100);
    addUnique(outputs, "candidate summary", 100);
    if (classificationTarget) addUnique(outputs, "priority label", 100);
  } else if (domain === "support") {
    addUnique(outputs, "support triage task", 100);
    addUnique(outputs, "issue summary", 100);
    if (classificationTarget) addUnique(outputs, "priority or category label", 100);
  } else if (domain === "finance") {
    addUnique(outputs, "finance review task", 100);
    addUnique(outputs, "billing or refund summary", 100);
    if (classificationTarget) addUnique(outputs, "review category label", 100);
  }

  if (hasAny(input, ["create task", "create an internal review task", "review task", "internal task"])) {
    addUnique(outputs, domain === "generic" ? "internal review task" : outputs[0], 100);
  }

  if (hasAny(input, ["draft", "reply", "response"])) {
    addUnique(outputs, "draft reply for human review", 100);
  }

  if (hasAny(input, ["report", "dashboard", "digest"])) {
    addUnique(outputs, "internal report", 100);
  }

  if (outputs.length === 0) {
    addUnique(outputs, "safe internal review summary", 100);
  }

  return uniqueStrings(outputs, 6, 100);
}

function explicitNoExternalSend(input: string): boolean {
  return /\b(?:without|do not|don't|never|no)\b.{0,80}\b(?:send|sending|reply|message|messages|email|emails|external message|external messages)\b/.test(input);
}

function detectBlockedActions(compileJob: CompileJob, input: string): string[] {
  const blueprint = compileJob.result;
  const safety = compileJob.safety_critic;
  const blocked: string[] = [];

  if (explicitNoExternalSend(input)) {
    addUnique(blocked, "Do not send external messages.", 160);
  }

  // External execution and real-world risk are advisory by themselves. Only an
  // explicit user boundary or a compiler/safety-critic blocked classification is
  // allowed to change the requested action in the implementation brief.
  for (const item of [
    ...(blueprint.not_safe_to_automate ?? []),
    ...(blueprint.not_recommended ?? []),
    ...(safety?.blocked_or_not_recommended ?? []),
    ...(safety?.must_remain_draft_only ?? []),
  ]) {
    addUnique(blocked, item, 160);
  }

  return blocked.slice(0, 8);
}

function detectHumanApprovalGates(compileJob: CompileJob, blockedActions: readonly string[]): string[] {
  const gates = uniqueStrings((compileJob.result.human_approval_gates ?? []).map(humanGateText), 8, 160);

  if (gates.length === 0 && (compileJob.risks.requires_human_review || blockedActions.length > 0)) {
    gates.push("Manual review required before external communication or production execution.");
  }

  return gates;
}

function buildWarnings(compileJob: CompileJob, domain: BriefDomain): string[] {
  const safety = compileJob.safety_critic;
  const warnings = uniqueStrings(
    [
      ...(compileJob.risks.reasons ?? []),
      ...(safety?.findings ?? []).map(findingText),
      ...(compileJob.safety_critic_agent?.draft_only_warnings ?? []),
      ...(compileJob.safety_critic_agent?.blocked_or_not_recommended ?? []),
    ],
    6,
    180,
  );

  if (domain === "admissions" && compileJob.risks.categories.includes("employment")) {
    addUnique(warnings, "Application priority labels are internal triage only and must not decide hiring outcomes.", 180);
  }

  return warnings.slice(0, 6);
}

function buildWorkflowGoal(
  domain: BriefDomain,
  source: string,
  extractedFields: readonly string[],
  classificationTarget: string,
  internalOutputs: readonly string[],
): string {
  const parts: string[] = [];

  if (domain === "admissions") {
    parts.push(source.includes("email") ? "collect job application emails" : "collect job application items");
  } else if (domain === "support") {
    parts.push(source.includes("email") ? "collect support emails" : "triage support requests");
  } else if (domain === "finance") {
    parts.push("collect billing or refund requests");
  } else {
    parts.push("collect the source item for internal review");
  }

  if (extractedFields.length > 0) {
    if (domain === "admissions") {
      parts.push("extract candidate details");
    } else if (domain === "support") {
      parts.push("extract support request details");
    } else if (domain === "finance") {
      parts.push("extract billing details");
    } else {
      parts.push(`extract ${joinList(extractedFields.slice(0, 4))}`);
    }
  }

  if (classificationTarget) {
    parts.push(`classify ${classificationTarget}`);
  }

  const reviewTask = internalOutputs.find((output) => output.includes("review task") || output.includes("triage task"));

  if (reviewTask) {
    parts.push(`prepare ${reviewTask}`);
  } else if (internalOutputs.length > 0) {
    parts.push(`prepare ${internalOutputs[0]}`);
  }

  if (parts.length === 0) {
    return "Prepare a safe internal review workflow without executing production actions.";
  }

  if (parts.length === 1) {
    return truncateText(parts[0], 240);
  }

  return truncateText(`${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`, 240);
}

function scheduleLabel(triggerDescription: string): string {
  const normalized = normalizeInput(triggerDescription);

  if (normalized.includes("morning") || normalized.includes("daily") || normalized.includes("every day")) {
    return "Daily";
  }

  if (normalized.includes("weekday")) return "Weekday";
  if (normalized.includes("weekly")) return "Weekly";
  if (normalized.includes("monthly")) return "Monthly";

  return "Scheduled";
}

function workflowLabelForDomain(domain: BriefDomain): string {
  if (domain === "admissions") return "Admissions Intake";
  if (domain === "support") return "Support Triage";
  if (domain === "finance") return "Finance Review";

  return "Internal Review";
}

function reviewWorkflowLabelForDomain(domain: BriefDomain): string {
  if (domain === "admissions") return "Admissions Intake Review";
  if (domain === "support") return "Support Triage Review";
  if (domain === "finance") return "Finance Review";

  return "Internal Review";
}

function isGenericWorkflowName(value: string): boolean {
  const normalized = normalizeInput(value);

  return [
    "classification workflow",
    "extraction workflow",
    "safe automation preview",
    "internal record workflow",
    "drafting workflow",
    "routing workflow",
    "monitoring workflow",
    "summarization workflow",
    "reporting workflow",
    "job application intake workflow",
  ].includes(normalized);
}

function buildDomainWorkflowName(
  input: string,
  domain: BriefDomain,
  classificationTarget: string,
  internalOutputs: readonly string[],
): string {
  if (domain === "admissions") {
    if (
      hasAny(input, ["application", "job application", "candidate", "applicant"])
      && internalOutputs.some((output) => output.includes("review task"))
    ) {
      return "Admissions Application Review Intake";
    }

    return "Admissions Intake Review";
  }

  if (domain === "support") {
    if (classificationTarget.includes("priority") || classificationTarget.includes("category")) {
      return "Support Triage Review Intake";
    }

    return "Support Review Intake";
  }

  if (domain === "finance") {
    if (hasAny(input, ["refund", "payment", "invoice", "billing"])) {
      return "Finance Request Review Intake";
    }

    return "Finance Review Intake";
  }

  return "Internal Review Intake";
}

function buildImplementationWorkflowName(
  compileJob: CompileJob,
  input: string,
  domain: BriefDomain,
  classificationTarget: string,
  internalOutputs: readonly string[],
): string {
  const blueprintName = truncateText(compileJob.result.workflow_name, 120);
  const domainName = buildDomainWorkflowName(input, domain, classificationTarget, internalOutputs);

  if (!blueprintName || isGenericWorkflowName(blueprintName)) {
    return domainName;
  }

  if (domain !== "generic" && isGenericWorkflowName(domainName)) {
    return domainName;
  }

  return blueprintName;
}

function buildRecommendedNodes(
  domain: BriefDomain,
  triggerDescription: string,
  extractedFields: readonly string[],
  classificationTarget: string,
  internalOutputs: readonly string[],
  humanApprovalGates: readonly string[],
  blockedActions: readonly string[],
): string[] {
  const nodes: string[] = [];
  const workflowLabel = humanApprovalGates.length > 0 || blockedActions.length > 0
    ? reviewWorkflowLabelForDomain(domain)
    : workflowLabelForDomain(domain);
  const trigger = normalizeInput(triggerDescription);

  if (hasAny(trigger, ["daily", "morning", "weekly", "weekday", "monthly", "scheduled", "every"])) {
    addUnique(nodes, `Schedule: ${scheduleLabel(triggerDescription)} ${workflowLabel}`, 100);
  } else {
    addUnique(nodes, `Manual Trigger: ${workflowLabel}`, 100);
  }

  if (domain === "admissions") {
    addUnique(nodes, "Sample Application Email", 100);
  } else if (domain === "support") {
    addUnique(nodes, "Sample Support Message", 100);
  } else if (domain === "finance") {
    addUnique(nodes, "Sample Billing Request", 100);
  } else {
    addUnique(nodes, "Sample Internal Request", 100);
  }

  if (extractedFields.length > 0) {
    if (domain === "admissions") addUnique(nodes, "Extract Candidate Fields", 100);
    else if (domain === "support") addUnique(nodes, "Extract Support Fields", 100);
    else if (domain === "finance") addUnique(nodes, "Extract Billing Fields", 100);
    else addUnique(nodes, "Extract Request Fields", 100);
  }

  if (classificationTarget) {
    addUnique(nodes, `Classify ${titleCase(classificationTarget)}`, 100);
  }

  if (internalOutputs.some((output) => output.includes("draft reply") || output.includes("response"))) {
    addUnique(nodes, "Draft Reply For Review", 100);
  }

  if (internalOutputs.some((output) => output.includes("review task") || output.includes("triage task"))) {
    if (domain === "admissions") addUnique(nodes, "Prepare Admissions Review Task", 100);
    else if (domain === "support") addUnique(nodes, "Prepare Support Review Task", 100);
    else if (domain === "finance") addUnique(nodes, "Prepare Finance Review Task", 100);
    else addUnique(nodes, "Prepare Internal Review Task", 100);
  } else {
    addUnique(nodes, "Prepare Internal Review Summary", 100);
  }

  if (humanApprovalGates.length > 0 || blockedActions.length > 0) {
    addUnique(nodes, "Manual Review Required", 100);
  } else {
    addUnique(nodes, "Ready For Internal Review", 100);
  }

  return nodes.slice(0, 7);
}

export function buildN8nImplementationBrief(compileJob: CompileJob): N8nImplementationBrief {
  const originalRequest = compileJob.input.trimmed || compileJob.input.raw;
  const input = normalizeInput(originalRequest);
  const domain = detectDomain(input);
  const triggerDescription = detectTriggerDescription(input, compileJob);
  const source = detectSource(input, compileJob, domain);
  const extractedFields = detectExtractedFields(input, domain);
  const classificationTarget = detectClassificationTarget(input, domain);
  const classificationRules = buildClassificationRules(classificationTarget, domain);
  const internalOutputs = detectInternalOutputs(input, domain, classificationTarget);
  const blockedActions = detectBlockedActions(compileJob, input);
  const humanApprovalGates = detectHumanApprovalGates(compileJob, blockedActions);
  const warnings = buildWarnings(compileJob, domain);
  const workflowGoal = buildWorkflowGoal(
    domain,
    source,
    extractedFields,
    classificationTarget,
    internalOutputs,
  );
  const recommendedNodes = buildRecommendedNodes(
    domain,
    triggerDescription,
    extractedFields,
    classificationTarget,
    internalOutputs,
    humanApprovalGates,
    blockedActions,
  );

  return {
    workflow_goal: workflowGoal,
    trigger_description: triggerDescription,
    source,
    extracted_fields: extractedFields,
    classification_target: classificationTarget,
    classification_rules: classificationRules,
    internal_outputs: internalOutputs,
    human_approval_gates: humanApprovalGates,
    blocked_or_not_safe_actions: blockedActions,
    warnings,
    recommended_nodes: recommendedNodes,
  };
}

export function buildCompactN8nGenerationInput(compileJob: CompileJob): CompactN8nGenerationInput {
  const blueprint = compileJob.result;
  const safety = compileJob.safety_critic;
  const implementationBrief = buildN8nImplementationBrief(compileJob);
  const input = normalizeInput(compileJob.input.trimmed || compileJob.input.raw);
  const workflowName = buildImplementationWorkflowName(
    compileJob,
    input,
    detectDomain(input),
    implementationBrief.classification_target,
    implementationBrief.internal_outputs,
  );

  return {
    original_request: truncateText(compileJob.input.trimmed || compileJob.input.raw, 1000),
    workflow_name: truncateText(workflowName, 120),
    blueprint_summary: truncateText(blueprint.summary, 500),
    safety_status: safety?.overall_status ?? compileJob.status,
    safety_summary: truncateText(safety?.summary || "", 500),
    next_safe_action: truncateText(safety?.next_safe_action || "", 300),
    risk_level: compileJob.risks?.risk_level,
    readiness_score: compileJob.readiness?.score,
    ...implementationBrief,
  };
}
