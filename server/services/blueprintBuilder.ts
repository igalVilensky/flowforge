import type { CompileMode } from "../../shared/types/compileJob";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
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
  intent?: StructuredWorkflowIntent;
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

export type BlueprintDomain = "admissions" | "support" | "finance" | "content" | "generic";

type DomainStepContext = {
  domain: BlueprintDomain;
  source: string;
  sourceItem: string;
  triggerTiming: string;
  extractedFields: string[];
  classificationTarget: string;
  internalOutput: string;
  approvalOwner: string;
  hasDraftReply: boolean;
  hasExplicitExternalMessageBlock: boolean;
  hasExplicitFinancialActionBlock: boolean;
  hasExplicitProductionWriteBlock: boolean;
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

function normalizeForDetection(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeForPreview(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function hasAny(input: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => input.includes(phrase));
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function cleanDomainPhrase(value: string): string {
  return value
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
}

function displayFieldName(value: string): string {
  return cleanDomainPhrase(value)
    .replace(/\bid\b/g, "ID")
    .replace(/\burl\b/g, "URL")
    .replace(/\bapi\b/g, "API");
}

function addUniqueText(items: string[], item: string, maxLength = 120): void {
  const text = truncateText(displayFieldName(item), maxLength);

  if (text && !items.includes(text)) {
    items.push(text);
  }
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

function hasAffirmativeFinanceIntent(input: string): boolean {
  const clauses = input.split(/[.!?;]+|\b(?:but|however)\b/).map((clause) => clause.trim()).filter(Boolean);
  const financePhrase = /\b(?:refunds?|payments?|billing|charges?|invoices?|receipts?|finance workflow|finance review)\b/;

  return clauses.some((clause) => {
    const match = financePhrase.exec(clause);

    if (!match || match.index === undefined) return false;

    const prefix = clause.slice(Math.max(0, match.index - 70), match.index);

    if (/\b(?:do not|don't|never|must not|should not|without|no automatic|block|prevent)\b/.test(prefix)) {
      return false;
    }

    const boundaryOnly = /\b(?:human[- ]reviewed|human review|human approval|manual approval|draft[- ]only|requires? approval|keep .* reviewed|blocked until)\b/.test(clause);
    const workflowCue = /\b(?:refund|payment|billing|charge|invoice|finance)\s+(?:request|requests|workflow|process|case|cases|review|decision|decisions|task)\b/.test(clause)
      || /\b(?:automate|process|handle|review|triage|evaluate|calculate|collect|receive|route|prepare|approve|issue|make|apply)\b.{0,50}\b(?:refund|payment|billing|charge|invoice|finance)\b/.test(clause)
      || /\b(?:customer|user)\s+(?:asks?|submits?|requests?)\b.{0,35}\b(?:refund|payment|billing)\b/.test(clause);

    return !boundaryOnly || workflowCue;
  });
}

export function detectBlueprintDomain(processInput: string): BlueprintDomain {
  const input = normalizeForDetection(processInput);

  if (hasAny(input, [
    "social media content",
    "content generation",
    "generate posts",
    "generate social posts",
    "marketing content",
    "product promotion",
    "social post",
    "post to social media",
    "publish to social media",
    "generate image",
    "image generation",
    "voice generation",
    "video generation",
    "avatar",
  ])) {
    return "content";
  }

  if (hasAny(input, ["admissions", "candidate", "applicant", "job application", "application email", "portfolio"])) {
    return "admissions";
  }

  if (hasAffirmativeFinanceIntent(input)) {
    return "finance";
  }

  if (hasAny(input, ["support", "ticket", "customer", "helpdesk", "zendesk", "intercom", "complaint", "angry"])) {
    return "support";
  }

  return "generic";
}

function detectTriggerTiming(input: string, signals: SignalSummary): string {
  if (hasAny(input, ["on demand", "on-demand", "manually", "manual trigger"])) {
    return "when requested on demand";
  }

  if (hasAny(input, ["every morning", "each morning"])) {
    return "on the morning schedule";
  }

  if (input.includes("every weekday")) {
    return "on the weekday schedule";
  }

  if (hasAny(input, ["daily", "every day", "each day"])) {
    return "on the daily schedule";
  }

  if (hasAny(input, ["weekly", "every week"])) {
    return "on the weekly schedule";
  }

  if (hasAny(input, ["monthly", "every month"])) {
    return "on the monthly schedule";
  }

  if (signals.has_scheduled_trigger) {
    return "on the requested schedule";
  }

  if (/\b(?:when|whenever|after|once)\b/.test(input)) {
    return "when it arrives";
  }

  return "for the internal review run";
}

function detectSource(input: string, domain: BlueprintDomain): string {
  if (domain === "content") {
    const labeledSource = input.match(/\bsource material:\s*([^\n.]{2,160})/i)?.[1];

    if (labeledSource) {
      return truncateText(cleanDomainPhrase(labeledSource), 160);
    }

    const contentSource = [
      "campaign brief",
      "product description",
      "blog post",
      "image assets",
      "brand assets",
      "key marketing points",
      "marketing points",
      "source material",
    ].find((source) => input.includes(source));

    return contentSource ? `the provided ${contentSource}` : "the clarified source material";
  }

  const knownSources = [
    "admissions inbox",
    "support inbox",
    "finance inbox",
    "billing inbox",
    "shared inbox",
    "email inbox",
    "ticket queue",
    "support queue",
    "zendesk",
    "intercom",
    "google sheet",
    "spreadsheet",
    "web form",
  ];
  const knownSource = knownSources.find((source) => input.includes(source));

  if (knownSource) {
    return knownSource.startsWith("the ") ? knownSource : `the ${knownSource}`;
  }

  const fromMatch = input.match(/\bfrom\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{1,60}?)(?:,|\.|\band\b|\bwithout\b|\bdo not\b|$)/);
  const sourceText = cleanDomainPhrase(fromMatch?.[1] ?? "");

  if (sourceText) {
    return sourceText.startsWith("the ") ? sourceText : `the ${sourceText}`;
  }

  if (domain === "admissions") {
    return "the admissions inbox";
  }

  if (domain === "support") {
    return "the support inbox";
  }

  if (domain === "finance") {
    return "the finance queue";
  }

  return "the requested internal source";
}

function detectSourceItem(input: string, domain: BlueprintDomain): string {
  if (domain === "content") {
    return "source material or campaign brief";
  }

  if (domain === "admissions") {
    return input.includes("email") ? "job application emails" : "job application items";
  }

  if (domain === "support") {
    if (input.includes("email")) return "support email";
    if (input.includes("ticket")) return "support ticket";
    return "support request";
  }

  if (domain === "finance") {
    if (input.includes("refund")) return "refund request";
    if (input.includes("billing")) return "billing request";
    return "finance request";
  }

  if (input.includes("email")) return "source email";
  if (input.includes("ticket")) return "source ticket";
  if (input.includes("request")) return "source request";

  return "source item";
}

function detectExplicitExtractedFields(input: string): string[] {
  const fields: string[] = [];
  const extractMatch = input.match(
    /\bextract\s+(?:the\s+)?(.+?)(?:,\s*(?:classify|create|prepare|route|draft|write|send|notify|without|do not|don't)\b|\s+and\s+(?:classify|create|prepare|route|draft|write|send|notify)\b|\.|$)/,
  );
  const fieldText = extractMatch?.[1]?.split(/\bfrom\s+(?:the\s+)?/)[0] ?? "";

  for (const rawField of fieldText.replace(/\s+and\s+/g, ", ").split(/[,;]/)) {
    addUniqueText(fields, rawField, 80);
  }

  return fields;
}

function detectExtractedFields(input: string, domain: BlueprintDomain, signals: SignalSummary): string[] {
  const fields = detectExplicitExtractedFields(input);

  if (domain === "admissions") {
    if (fields.length === 0 || hasAny(input, ["candidate details", "application fields"])) {
      addUniqueText(fields, "candidate name", 80);
      addUniqueText(fields, "role", 80);
      addUniqueText(fields, "portfolio link", 80);
      addUniqueText(fields, "application source", 80);
    }
  } else if (domain === "support" && fields.length === 0) {
    addUniqueText(fields, "sender", 80);
    addUniqueText(fields, "order ID", 80);
    addUniqueText(fields, "complaint reason", 80);
    addUniqueText(fields, "urgency", 80);
  } else if (domain === "finance" && fields.length === 0) {
    addUniqueText(fields, "customer name", 80);
    addUniqueText(fields, "order ID", 80);
    addUniqueText(fields, "amount", 80);
    addUniqueText(fields, "reason", 80);
  } else if (fields.length === 0 && hasPrimitive(signals, "extraction")) {
    addUniqueText(fields, "requested fields", 80);
  }

  return fields.slice(0, 8);
}

function detectClassificationTarget(input: string, domain: BlueprintDomain): string {
  const classifyMatch = input.match(
    /\bclassify\s+(?:the\s+)?([a-z0-9 -]{2,80}?)(?:,|\.|\band\s+(?:create|prepare|route|draft|send|notify|log)\b|\bwithout\b|$)/,
  );
  const target = cleanDomainPhrase(classifyMatch?.[1] ?? "");

  if (target) {
    if (domain === "admissions" && target === "priority") return "application priority";
    if (domain === "support" && ["issue", "request", "priority"].includes(target)) return "issue priority";
    if (domain === "finance" && target === "refund risk") return "refund review risk";
    if (domain === "finance" && target === "risk") return "refund review risk";

    return truncateText(target, 80);
  }

  if (hasAny(input, ["classify", "categorize", "triage", "label"])) {
    if (domain === "admissions") return "application priority";
    if (domain === "support") return "issue priority";
    if (domain === "finance") return "refund review risk";

    return "internal review category";
  }

  return "";
}

function detectInternalOutput(input: string, domain: BlueprintDomain): string {
  if (domain === "admissions") return "admissions review task";
  if (domain === "support") return "support review task";
  if (domain === "finance") return "finance review task";
  if (domain === "content") return "social media post package";

  if (hasAny(input, ["task", "ticket", "review task"])) return "internal review task";
  if (hasAny(input, ["report", "dashboard", "digest"])) return "internal report";
  if (hasAny(input, ["summary", "summarize"])) return "internal review summary";

  return "internal review output";
}

function detectApprovalOwner(input: string, domain: BlueprintDomain): string {
  const labeledOwner = input.match(/\bhuman (?:reviewer|owner):\s*([^\n.]{2,80})/i)?.[1];

  if (labeledOwner) {
    return truncateText(cleanDomainPhrase(labeledOwner), 80);
  }

  const ownerMatch = input.match(
    /\b(?:the\s+)?([a-z0-9][a-z0-9 -]{1,60}?(?:team lead|lead|team|manager|owner|reviewer|approver|human))\s+(?:must|should|will|reviews?|approves?)\b/,
  );
  const owner = cleanDomainPhrase(ownerMatch?.[1] ?? "");

  if (owner) {
    return owner;
  }

  if (input.includes("support lead")) return "support lead";
  if (input.includes("admissions team")) return "admissions team";
  if (input.includes("finance")) return "finance";
  if (input.includes("channel owner")) return "channel owner";

  if (domain === "admissions") return "admissions reviewer";
  if (domain === "support") return "support lead";
  if (domain === "finance") return "finance reviewer";
  if (domain === "content") return "channel owner";

  return "human reviewer";
}

function buildDomainStepContext(
  processInput: string,
  signals: SignalSummary,
  risks: RiskSummary,
  intent?: StructuredWorkflowIntent,
): DomainStepContext {
  const normalizedInput = normalizeForDetection(processInput);
  const domain = detectBlueprintDomain(processInput);
  const structuredSourceFallback = domain === "content"
    ? "the clarified source material"
    : domain === "admissions"
      ? "the admissions inbox"
      : domain === "support"
        ? "the support inbox"
        : domain === "finance"
          ? "the finance queue"
          : "the requested internal source";

  return {
    domain,
    source: intent
      ? intent.input_sources[0] ?? structuredSourceFallback
      : detectSource(normalizedInput, domain),
    sourceItem: intent
      ? intent.input_data[0] ?? detectSourceItem("", domain)
      : detectSourceItem(normalizedInput, domain),
    triggerTiming: intent?.trigger ? truncateText(intent.trigger, 120) : detectTriggerTiming(normalizedInput, signals),
    extractedFields: detectExtractedFields(normalizedInput, domain, signals),
    classificationTarget: detectClassificationTarget(normalizedInput, domain),
    internalOutput: intent?.desired_outputs[0] ?? detectInternalOutput(normalizedInput, domain),
    approvalOwner: intent?.human_owner ?? detectApprovalOwner(normalizedInput, domain),
    hasDraftReply: hasAny(normalizedInput, ["draft", "reply", "response", "write", "compose"]),
    hasExplicitExternalMessageBlock:
      /\b(?:without|do not|don't|never|no)\b.{0,80}\b(?:send|sending|reply|replies|message|messages|email|emails|external message|external messages)\b/.test(normalizedInput),
    hasExplicitFinancialActionBlock:
      /\b(?:without|do not|don't|never|no)\b.{0,80}\b(?:refund|refunding|payment|pay|charge|charging)\b/.test(normalizedInput),
    hasExplicitProductionWriteBlock:
      /\b(?:without|do not|don't|never|no)\b.{0,80}\b(?:write|writing|update|updating|create|creating|save|saving)\b.{0,60}\b(?:production|live|real)\b/.test(normalizedInput),
  };
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

function buildWorkflowName(processInput: string, signals: SignalSummary, risks: RiskSummary): string {
  const intentDomain = detectBlueprintDomain(processInput);

  if (intentDomain === "content") {
    return "Social Media Content Draft Workflow";
  }

  if (intentDomain === "finance") {
    return "Refund or Payment Review Workflow";
  }

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

  if (hasAny(normalizedInput, ["on demand", "on-demand", "manually", "manual trigger"])) {
    return {
      type: "manual_input",
      source: "on_demand_request",
      description: `Rule-based on-demand trigger inferred from: ${preview}`,
    };
  }

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

function buildContentWorkflowSteps(
  processInput: string,
  context: DomainStepContext,
  risks: RiskSummary,
): WorkflowStep[] {
  const input = normalizeForDetection(processInput);
  const categories = risks.categories;
  const draftRiskCategories = categoriesFrom(categories, ["external_communication", "personal_data"]);
  const steps: WorkflowStep[] = [
    buildStep({
      id: "content_collect_source_material",
      label: "Collect source material or campaign brief",
      description: `Use ${context.source} as the approved input ${context.triggerTiming}; do not fetch from an unconfigured external provider.`,
      primitive: "intake",
      actor: "system",
      input: "On-demand request and clarified source material",
      output: "Reviewed content brief",
      automation_policy: "assist_only",
      risk_categories: categoriesFrom(categories, ["personal_data", "account_access"]),
      real_world_execution: "none",
    }),
    buildStep({
      id: "content_define_message_and_audience",
      label: "Define message and target audience",
      description: "Turn the approved source into an internal product, campaign, message, audience, tone, and channel brief for review.",
      primitive: "classification",
      actor: "rules_and_ai",
      input: "Reviewed content brief",
      output: "Internal creative direction",
      automation_policy: "assist_only",
      real_world_execution: "none",
    }),
  ];

  if (hasAny(input, ["avatar", "image", "visual", "product promotion"])) {
    steps.push(buildStep({
      id: "content_generate_visual_draft",
      label: "Generate visual concept draft",
      description: "Prepare an image, avatar, or visual concept as a draft only without claiming a connected generation provider.",
      primitive: "drafting",
      actor: "ai",
      input: "Internal creative direction and approved assets",
      output: "Draft visual concept",
      automation_policy: "draft_only",
      risk_categories: draftRiskCategories,
      real_world_execution: "draft_only",
    }));
  }

  steps.push(buildStep({
    id: "content_generate_copy_draft",
    label: "Generate script or caption draft",
    description: "Draft the requested script, caption, and post copy from the approved source material for human review.",
    primitive: "drafting",
    actor: "ai",
    input: "Internal creative direction",
    output: "Draft script, caption, and post copy",
    automation_policy: "draft_only",
    risk_categories: draftRiskCategories,
    real_world_execution: "draft_only",
  }));

  if (hasAny(input, ["voice generation", "voice draft", "voiceover", "voice-over"])) {
    steps.push(buildStep({
      id: "content_generate_voice_draft",
      label: "Generate voice draft",
      description: "Prepare a reviewable voice or voice-over draft without claiming a connected voice provider or publishing it.",
      primitive: "drafting",
      actor: "ai",
      input: "Approved script draft",
      output: "Draft voice asset",
      automation_policy: "draft_only",
      risk_categories: draftRiskCategories,
      real_world_execution: "draft_only",
    }));
  }

  if (hasAny(input, ["video generation", "generate video", "video draft", "assemble video"])) {
    steps.push(buildStep({
      id: "content_assemble_video_draft",
      label: "Assemble video content draft",
      description: "Describe a draft video assembly from approved visual, script, and voice assets without connecting a video provider.",
      primitive: "drafting",
      actor: "ai",
      input: "Approved draft content assets",
      output: "Draft video concept",
      automation_policy: "draft_only",
      risk_categories: draftRiskCategories,
      real_world_execution: "draft_only",
    }));
  }

  steps.push(
    buildStep({
      id: "content_prepare_post_package",
      label: "Prepare social media post package",
      description: "Assemble the selected drafts, caption, asset references, channel notes, and publishing checklist into an internal package.",
      primitive: "record_creation",
      actor: "system",
      input: "Reviewed content drafts",
      output: "Social media post package",
      automation_policy: "assist_only",
      risk_categories: draftRiskCategories,
      real_world_execution: "none",
    }),
    buildStep({
      id: "content_require_channel_owner_approval",
      label: `Require ${context.approvalOwner} approval`,
      description: `Hold the post package until the ${context.approvalOwner} explicitly reviews and approves it.`,
      primitive: "approval",
      actor: "human",
      input: "Social media post package",
      output: "Recorded human approval decision",
      automation_policy: "human_approval",
      approval_required: true,
      risk_categories: categoriesFrom(categories, ["external_communication", "personal_data"]),
      real_world_execution: "requires_human_trigger",
    }),
    buildStep({
      id: "content_block_automatic_publishing",
      label: "Block automatic social publishing",
      description: "Do not publish or post to any social platform automatically; the blueprint stays non-executing even after approval.",
      primitive: "approval",
      actor: "human",
      input: "Human-reviewed post package",
      output: "Blocked automatic publishing boundary",
      automation_policy: "human_approval",
      approval_required: true,
      risk_categories: categoriesFrom(categories, ["external_communication", "real_world_execution"]),
      real_world_execution: "requires_human_trigger",
    }),
  );

  return steps;
}

function buildWorkflowSteps(
  processInput: string,
  signals: SignalSummary,
  risks: RiskSummary,
  intent?: StructuredWorkflowIntent,
): WorkflowStep[] {
  const context = buildDomainStepContext(processInput, signals, risks, intent);

  if (context.domain === "content") {
    return buildContentWorkflowSteps(processInput, context, risks);
  }

  const categories = risks.categories;
  const requiresApprovalStep =
    needsBlueprintHumanReview(categories, risks)
    || signals.has_external_action
    || hasPrimitive(signals, "approval")
    || context.domain !== "generic"
    || context.hasDraftReply
    || context.hasExplicitExternalMessageBlock
    || context.hasExplicitFinancialActionBlock
    || context.hasExplicitProductionWriteBlock;
  const extractionFields = context.extractedFields.length > 0 ? context.extractedFields : ["requested fields"];

  const sourceRiskCategories = categoriesFrom(categories, [
    "external_communication",
    "personal_data",
    "employment",
    "financial",
    "refund_or_payment",
    "complaint_or_angry_user",
  ]);

  const extractionRiskCategories = categoriesFrom(categories, [
    "personal_data",
    "employment",
    "financial",
    "refund_or_payment",
    "account_access",
  ]);

  const classificationRiskCategories = categoriesFrom(categories, [
    "employment",
    "financial",
    "refund_or_payment",
    "complaint_or_angry_user",
    "high_stakes_decision",
  ]);

  const reviewTaskRiskCategories = categoriesFrom(categories, [
    "personal_data",
    "employment",
    "financial",
    "refund_or_payment",
    "external_communication",
    "account_access",
    "real_world_execution",
  ]);

  const steps: WorkflowStep[] = [];

  const collectLabelByDomain: Record<BlueprintDomain, string> = {
    admissions: "Collect application emails",
    support: context.sourceItem.includes("email") ? "Collect support email" : "Collect support request",
    finance: context.sourceItem.includes("refund") ? "Collect refund request" : "Collect finance request",
    content: "Collect source material",
    generic: "Collect source item",
  };

  steps.push(
    buildStep({
      id: `${context.domain}_collect_source_item`,
      label: collectLabelByDomain[context.domain],
      description:
        context.domain === "generic"
          ? `Read the ${context.sourceItem} from ${context.source} ${context.triggerTiming}.`
          : `Read new ${context.sourceItem} from ${context.source} ${context.triggerTiming}.`,
      primitive: "intake",
      actor: "system",
      input: "Workflow trigger and source details",
      output: titleCase(context.sourceItem),
      automation_policy: "assist_only",
      risk_categories: sourceRiskCategories,
      real_world_execution: "none",
    }),
  );

  if (hasPrimitive(signals, "extraction") || context.extractedFields.length > 0) {
    const extractLabelByDomain: Record<BlueprintDomain, string> = {
      admissions: "Extract candidate details",
      support: "Extract support request details",
      finance: "Extract refund details",
      content: "Extract content brief details",
      generic: "Extract requested fields",
    };

    steps.push(
      buildStep({
        id: `${context.domain}_extract_fields`,
        label: extractLabelByDomain[context.domain],
        description: `Extract ${joinList(extractionFields)}.`,
        primitive: "extraction",
        actor: "rules",
        input: titleCase(context.sourceItem),
        output: "Structured review fields",
        automation_policy: "automate",
        risk_categories: extractionRiskCategories,
        real_world_execution: "none",
      }),
    );
  }

  if (hasPrimitive(signals, "classification") || context.classificationTarget) {
    const target = context.classificationTarget || "internal review category";
    const classificationDescriptionByDomain: Record<BlueprintDomain, string> = {
      admissions: "Assign an internal triage priority for admissions review only.",
      support: "Assign an internal issue priority using urgency, customer impact, and complaint signals.",
      finance: "Assign an internal refund or billing risk label for finance review only.",
      content: "Define an internal content category and audience for review only.",
      generic: "Classify or summarize the item for internal review only.",
    };

    steps.push(
      buildStep({
        id: `${context.domain}_classify_item`,
        label: `Classify ${target}`,
        description: classificationDescriptionByDomain[context.domain],
        primitive: "classification",
        actor: "rules",
        input: "Structured review fields",
        output: titleCase(target),
        automation_policy: classificationRiskCategories.length > 0 ? "assist_only" : "automate",
        risk_categories: classificationRiskCategories,
        real_world_execution: "none",
      }),
    );
  } else if (context.domain === "generic") {
    steps.push(
      buildStep({
        id: "generic_classify_or_summarize",
        label: "Classify or summarize item",
        description: "Classify or summarize the source item only when the request asks for it.",
        primitive: hasPrimitive(signals, "summarization") ? "summarization" : "classification",
        actor: "rules",
        input: titleCase(context.sourceItem),
        output: "Internal review note",
        automation_policy: "assist_only",
        real_world_execution: "none",
      }),
    );
  }

  if (context.hasDraftReply || hasPrimitive(signals, "drafting")) {
    const draftLabelByDomain: Record<BlueprintDomain, string> = {
      admissions: "Draft internal note for review",
      support: "Draft reply for review",
      finance: "Draft finance note for review",
      content: "Draft content for review",
      generic: "Draft output for review",
    };
    const draftDescriptionByDomain: Record<BlueprintDomain, string> = {
      admissions: "Draft internal admissions notes only; do not message candidates automatically.",
      support: "Draft a customer reply for review without sending it.",
      finance: "Draft an internal finance note without issuing refunds, payments, or billing changes.",
      content: "Draft content assets without publishing them or connecting production providers.",
      generic: "Draft the requested output for human review without sending or applying it.",
    };

    steps.push(
      buildStep({
        id: `${context.domain}_draft_for_review`,
        label: draftLabelByDomain[context.domain],
        description: draftDescriptionByDomain[context.domain],
        primitive: "drafting",
        actor: "ai",
        input: "Structured review fields and classification",
        output: "Draft-only review content",
        automation_policy: "draft_only",
        risk_categories: categoriesFrom(categories, [
          "external_communication",
          "personal_data",
          "financial",
          "refund_or_payment",
          "employment",
          "complaint_or_angry_user",
          "high_stakes_decision",
        ]),
        real_world_execution: "draft_only",
      }),
    );
  }

  if (
    hasPrimitive(signals, "record_creation")
    || hasPrimitive(signals, "routing")
    || hasPrimitive(signals, "escalation")
    || signals.has_clear_output
  ) {
    const reviewTaskLabelByDomain: Record<BlueprintDomain, string> = {
      admissions: "Prepare admissions review task",
      support: "Prepare support review task",
      finance: "Prepare finance review task",
      content: "Prepare social media post package",
      generic: "Prepare internal review output",
    };

    steps.push(
      buildStep({
        id: `${context.domain}_prepare_internal_output`,
        label: reviewTaskLabelByDomain[context.domain],
        description:
          context.domain === "generic"
            ? "Prepare an internal review output without writing to production systems."
            : `Prepare an internal ${context.internalOutput} payload without writing to production systems.`,
        primitive: "record_creation",
        actor: "system",
        input: "Structured review fields, classification, and draft notes",
        output: titleCase(context.internalOutput),
        automation_policy: "assist_only",
        risk_categories: reviewTaskRiskCategories,
        real_world_execution: "none",
      }),
    );
  }

  if (hasPrimitive(signals, "monitoring") && !signals.has_scheduled_trigger) {
    steps.push(
      buildStep({
        id: `${context.domain}_monitor_condition`,
        label: "Monitor source condition",
        description: "Describe the monitored condition without connecting a live scheduler, inbox listener, or production credential.",
        primitive: "monitoring",
        actor: "system",
        input: "Source condition",
        output: "Monitoring preview",
        automation_policy: "assist_only",
        risk_categories: categoriesFrom(categories, ["real_world_execution", "account_access", "personal_data"]),
        real_world_execution: "none",
      }),
    );
  }

  if (hasPrimitive(signals, "summarization") && !steps.some((step) => step.primitive === "summarization")) {
    steps.push(
      buildStep({
        id: `${context.domain}_summarize_context`,
        label: "Summarize source item",
        description: "Prepare a concise internal summary for reviewers without sending or applying it.",
        primitive: "summarization",
        actor: "rules",
        input: titleCase(context.sourceItem),
        output: "Internal summary",
        automation_policy: "assist_only",
        risk_categories: categoriesFrom(categories, ["personal_data", "medical", "legal", "visa_or_immigration"]),
        real_world_execution: "none",
      }),
    );
  }

  if (hasPrimitive(signals, "validation")) {
    steps.push(
      buildStep({
        id: `${context.domain}_validate_required_fields`,
        label: "Validate required fields",
        description: "Check whether the source, extracted fields, owner, approval boundary, and output shape are defined.",
        primitive: "validation",
        actor: "rules",
        input: "Structured review fields",
        output: "Validation notes",
        automation_policy: "automate",
        real_world_execution: "none",
      }),
    );
  }

  if (hasPrimitive(signals, "reporting")) {
    steps.push(
      buildStep({
        id: `${context.domain}_prepare_report`,
        label: "Prepare report",
        description: "Create an internal report outline for human review without publishing or updating production data.",
        primitive: "reporting",
        actor: "rules",
        input: "Structured review fields",
        output: "Report outline",
        automation_policy: "assist_only",
        risk_categories: categoriesFrom(categories, ["personal_data", "financial", "refund_or_payment"]),
        real_world_execution: "none",
      }),
    );
  }

  if (requiresApprovalStep) {
    const approvalLabelByDomain: Record<BlueprintDomain, string> = {
      admissions: "Require manual review",
      support: context.approvalOwner.includes("support lead")
        ? "Require support lead approval"
        : "Require support approval",
      finance: "Require finance approval",
      content: "Require channel owner approval",
      generic: "Require human review",
    };
    const approvalDescriptionByDomain: Record<BlueprintDomain, string> = {
      admissions: "Mark the task as pending human review before any follow-up action.",
      support: `Hold every draft reply and review task until the ${context.approvalOwner} approves it.`,
      finance: "Hold the finance task for approval before any refund, payment, or billing change.",
      content: `Hold every content draft until the ${context.approvalOwner} approves it for the requested channel.`,
      generic: "Keep the output pending human review before any external, sensitive, or production action.",
    };

    steps.push(
      buildStep({
        id: `${context.domain}_require_human_review`,
        label: approvalLabelByDomain[context.domain],
        description: approvalDescriptionByDomain[context.domain],
        primitive: "approval",
        actor: "human",
        input: "Prepared review output and safety notes",
        output: "Human approval decision",
        automation_policy: "human_approval",
        approval_required: true,
        risk_categories: categories,
        real_world_execution: "requires_human_trigger",
      }),
    );
  }

  if (
    context.domain === "finance"
    || hasAnyRisk(categories, financialRiskCategories)
    || context.hasExplicitFinancialActionBlock
  ) {
    steps.push(
      buildStep({
        id: "block_automatic_financial_actions",
        label: "Block automatic refund/payment actions",
        description: "Do not issue refunds, payments, charges, or billing changes automatically.",
        primitive: "approval",
        actor: "human",
        input: "Finance review decision",
        output: "Blocked automatic financial execution",
        automation_policy: "human_approval",
        approval_required: true,
        risk_categories: categoriesFrom(categories, ["financial", "refund_or_payment", "real_world_execution"]),
        real_world_execution: "requires_human_trigger",
      }),
    );
  } else if (
    hasRisk(categories, "external_communication")
    || context.hasExplicitExternalMessageBlock
    || hasPrimitive(signals, "notification")
  ) {
    const blockLabelByDomain: Record<BlueprintDomain, string> = {
      admissions: "Block external messaging",
      support: "Block automatic sending",
      finance: "Block external messaging",
      content: "Block automatic social publishing",
      generic: "Block external messaging",
    };

    steps.push(
      buildStep({
        id: "block_external_messaging",
        label: blockLabelByDomain[context.domain],
        description: "Do not send emails, replies, or external messages automatically.",
        primitive: "approval",
        actor: "human",
        input: "Prepared draft or review task",
        output: "Blocked automatic external sending",
        automation_policy: "human_approval",
        approval_required: true,
        risk_categories: categoriesFrom(categories, ["external_communication", "personal_data", "complaint_or_angry_user"]),
        real_world_execution: "requires_human_trigger",
      }),
    );
  } else if (context.domain === "generic" || hasRisk(categories, "real_world_execution")) {
    steps.push(
      buildStep({
        id: "block_production_execution",
        label: "Block production execution",
        description: "Do not write to production systems, send messages, charge, refund, delete, or trigger external tools from this preview.",
        primitive: "validation",
        actor: "system",
        input: "Prepared internal review output",
        output: "Non-executing preview boundary",
        automation_policy: requiresApprovalStep ? "human_approval" : "assist_only",
        approval_required: requiresApprovalStep,
        risk_categories: categoriesFrom(categories, executionBlockCategories),
        real_world_execution: requiresApprovalStep ? "requires_human_trigger" : "none",
      }),
    );
  }

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
    .filter((step) =>
      step.primitive === "approval"
      || step.primitive === "validation"
      || step.automation_policy === "human_approval"
      || step.real_world_execution === "requires_human_trigger"
    )
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

function getStepText(step: WorkflowStep): string {
  return [
    step.id,
    step.label,
    step.description,
    step.input,
    step.output,
    step.primitive,
    step.automation_policy,
    step.real_world_execution,
  ].join(" ").toLowerCase();
}

function getHumanBoundaryStepIds(steps: readonly WorkflowStep[]): string[] {
  return steps
    .filter((step) =>
      step.automation_policy === "human_approval"
      || step.automation_policy === "draft_only"
      || step.real_world_execution === "requires_human_trigger"
      || step.real_world_execution === "draft_only"
      || /\b(?:manual review|approval|block|blocked|draft-only|without sending|without writing)\b/.test(getStepText(step))
    )
    .map((step) => step.id);
}

function buildStepDerivedApprovalGate(steps: readonly WorkflowStep[]): HumanApprovalGate | null {
  const stepIds = getHumanBoundaryStepIds(steps);

  if (stepIds.length === 0) {
    return null;
  }

  const combinedText = steps
    .filter((step) => stepIds.includes(step.id))
    .map(getStepText)
    .join(" ");
  const hasFinancialBoundary = /\b(?:refund|payment|billing|charge|finance)\b/.test(combinedText);
  const hasExternalMessagingBoundary = /\b(?:external|send|sending|email|reply|message|candidate|customer|contact)\b/.test(combinedText);
  const hasProductionBoundary = /\b(?:production|write|update|trigger|execute|real-world)\b/.test(combinedText);

  if (hasFinancialBoundary) {
    return {
      id: "gate_manual_finance_review",
      label: "Finance approval before payment action",
      required: true,
      applies_to_step_ids: stepIds,
      reason: "Refund, payment, billing, or charge actions must wait for accountable finance approval.",
      review_checklist: [
        "Confirm the customer, order, amount, and policy basis.",
        "Verify the prepared task is internal only.",
        "Execute refunds, payments, charges, or billing changes only after a human chooses to proceed.",
      ],
    };
  }

  if (hasExternalMessagingBoundary) {
    return {
      id: "gate_manual_external_messaging_review",
      label: "Manual review before external messaging",
      required: true,
      applies_to_step_ids: stepIds,
      reason: "Manual review is required before contacting candidates, customers, or any external recipient.",
      review_checklist: [
        "Confirm the recipient, channel, and reviewer owner.",
        "Check tone, accuracy, and missing context.",
        "Send emails, replies, or external messages only after a human chooses to proceed.",
      ],
    };
  }

  if (hasProductionBoundary) {
    return {
      id: "gate_manual_production_review",
      label: "Manual review before production execution",
      required: true,
      applies_to_step_ids: stepIds,
      reason: "Production writes and real-world execution must stay outside the automatic preview.",
      review_checklist: [
        "Confirm the target system and production owner.",
        "Review rollback, audit, and permission requirements.",
        "Trigger production writes only after a human chooses to proceed.",
      ],
    };
  }

  return {
    id: "gate_manual_review_boundary",
    label: "Manual review before follow-up action",
    required: true,
    applies_to_step_ids: stepIds,
    reason: "The blueprint includes human-review boundaries even though the preview itself does not execute actions.",
    review_checklist: [
      "Confirm the prepared output is internal only.",
      "Review extracted fields, classification labels, and task payloads.",
      "Proceed with follow-up actions only after a human chooses to continue.",
    ],
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

  const stepDerivedGate = buildStepDerivedApprovalGate(steps);

  if (stepDerivedGate && gates.length === 0) {
    gates.push(stepDerivedGate);
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
  intent,
  signals,
  risks,
  readiness,
  mode,
}: BuildBlueprintInput): SafeAutomationBlueprint {
  const steps = buildWorkflowSteps(processInput, signals, risks, intent);

  return {
    id: `blueprint_${jobId}`,
    workflow_name: buildWorkflowName(processInput, signals, risks),
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
