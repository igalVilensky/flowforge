import type { RiskCategory, WorkflowPrimitive } from "../../shared/types/workflow";

export type PrimitiveRule = {
  primitive: WorkflowPrimitive;
  phrases: readonly string[];
  patterns?: readonly RegExp[];
  rough_action: string;
  possible_tool: string;
};

export type RiskRule = {
  categories: readonly RiskCategory[];
  phrases: readonly string[];
  patterns?: readonly RegExp[];
};

export const triggerPhrases = [
  "when",
  "whenever",
  "after",
  "before",
  "if",
  "once",
  "upon receipt",
  "as soon as",
] as const;

export const schedulePhrases = [
  "every morning",
  "every day",
  "daily",
  "each morning",
  "every weekday",
  "every week",
  "every monday",
  "every tuesday",
  "every wednesday",
  "every thursday",
  "every friday",
] as const;

export const repeatedProcessPhrases = [
  "every",
  "whenever",
  "each",
  "repeat",
  "recurring",
  "daily",
  "weekly",
  "monthly",
  "for each",
  "each time",
  "check every",
  "when",
] as const;

export const externalActionPhrases = [
  "send",
  "email",
  "reply",
  "message",
  "customer",
  "student",
  "slack",
  "client",
  "partner",
  "applicant",
] as const;

export const clearOutputPhrases = [
  "classify",
  "categorize",
  "tag",
  "label",
  "extract",
  "draft",
  "write",
  "compose",
  "reply",
  "route",
  "assign",
  "send",
  "notify",
  "create",
  "log",
  "save",
  "summarize",
  "summary",
  "report",
  "dashboard",
  "approve",
  "validate",
  "verify",
] as const;

export const decisionPointPhrases = [
  "if",
  "classify",
  "categorize",
  "route",
  "decide",
  "decision",
  "detect",
  "approve",
  "review",
  "eligibility",
  "triage",
  "flag",
  "risk",
] as const;

export const humanActorPhrases = [
  "human",
  "manager",
  "reviewer",
  "agent",
  "owner",
  "staff",
  "team",
  "manual review",
  "human review",
  "human approval",
  "approver",
] as const;

export const systemActorPhrases = [
  "system",
  "crm",
  "database",
  "inbox",
  "email",
  "slack",
  "webhook",
  "api",
  "spreadsheet",
  "ticket",
  "form",
  "queue",
  "tool",
  "app",
  "record",
  "account",
] as const;

export const primitiveRules: readonly PrimitiveRule[] = [
  {
    primitive: "classification",
    phrases: ["classify", "categorize", "tag", "label", "triage", "bucket"],
    rough_action: "Classify the incoming item",
    possible_tool: "classifier",
  },
  {
    primitive: "extraction",
    phrases: ["extract", "pull out", "parse", "read fields", "capture fields", "get fields"],
    rough_action: "Extract important fields",
    possible_tool: "field extractor",
  },
  {
    primitive: "risk_detection",
    phrases: ["risk", "legal", "refund", "payment", "visa", "medical", "employment"],
    rough_action: "Detect risk categories before automation",
    possible_tool: "risk scanner",
  },
  {
    primitive: "routing",
    phrases: ["route", "assign", "send to", "forward to", "hand off", "handoff"],
    rough_action: "Route the item to the correct owner",
    possible_tool: "router",
  },
  {
    primitive: "drafting",
    phrases: ["draft", "write", "compose", "reply", "propose response", "prepare response"],
    rough_action: "Draft a proposed response or task",
    possible_tool: "draft generator",
  },
  {
    primitive: "approval",
    phrases: [
      "approve",
      "approval",
      "requires approval",
      "needs approval",
      "human approval",
      "manual approval",
      "sign off",
      "sign-off",
      "final approval",
      "approval required",
    ],
    rough_action: "Ask a human to approve before execution",
    possible_tool: "approval gate",
  },
  {
    primitive: "validation",
    phrases: ["validate", "check schema", "verify", "confirm fields", "check required fields"],
    rough_action: "Validate the output before it is used",
    possible_tool: "schema validator",
  },
  {
    primitive: "notification",
    phrases: ["notify", "send email", "message", "slack", "alert", "send notification"],
    rough_action: "Notify the relevant person or system",
    possible_tool: "notifier",
  },
  {
    primitive: "record_creation",
    phrases: [
      "create record",
      "create task",
      "create ticket",
      "create review task",
      "internal review task",
      "review task",
      "create internal task",
      "create follow-up task",
      "follow-up task",
      "log",
      "save",
      "update record",
      "internal tag",
    ],
    rough_action: "Create or update an internal record",
    possible_tool: "record writer",
  },
  {
    primitive: "monitoring",
    phrases: ["monitor", "watch", "check every", "track", "listen for"],
    rough_action: "Monitor the condition over time",
    possible_tool: "schedule monitor",
  },
  {
    primitive: "escalation",
    phrases: ["escalate", "raise to", "urgent queue", "manager review"],
    rough_action: "Escalate risky or urgent items",
    possible_tool: "escalation router",
  },
  {
    primitive: "summarization",
    phrases: ["summarize", "summary", "recap", "digest"],
    rough_action: "Summarize the important details",
    possible_tool: "summarizer",
  },
  {
    primitive: "reporting",
    phrases: ["report", "dashboard", "weekly report", "daily report", "metrics"],
    rough_action: "Prepare a report for review",
    possible_tool: "report builder",
  },
];

const automaticExecutionPatterns = [
  /\b(?:send|approve|charge|delete|update)\b.{0,40}\bautomatically\b/,
  /\bautomatically\b.{0,40}\b(?:send|approve|charge|delete|update)\b/,
];

function hasNegatedAutomaticExecutionBoundary(input: string): boolean {
  return /\b(?:do not|don't|never|without|no)\b.{0,60}\b(?:send|approve|charge|delete|update|change|refund)\b.{0,50}\bautomatically\b/.test(input)
    || /\b(?:do not|don't|never|without|no)\b.{0,60}\b(?:send|approve|charge|delete|update|change|refund)\b/.test(input);
}

function realWorldExecutionMatches(input: string): boolean {
  if (hasNegatedAutomaticExecutionBoundary(input)) return false;
  return automaticExecutionPatterns.some((pattern) => pattern.test(input))
    || ["send automatically", "approve automatically", "charge automatically", "delete automatically", "update automatically"]
      .some((phrase) => input.includes(phrase));
}

export const riskRules: readonly RiskRule[] = [
  {
    categories: ["external_communication"],
    phrases: externalActionPhrases,
  },
  {
    categories: ["refund_or_payment", "financial"],
    phrases: ["refund", "payment", "charge", "invoice", "billing"],
  },
  {
    categories: ["legal", "high_stakes_decision"],
    phrases: ["legal", "lawyer", "contract", "lawsuit"],
  },
  {
    categories: ["medical", "high_stakes_decision"],
    phrases: ["medical", "health", "diagnosis", "patient"],
  },
  {
    categories: ["visa_or_immigration", "high_stakes_decision"],
    phrases: ["visa", "immigration", "passport"],
  },
  {
    categories: ["employment", "high_stakes_decision"],
    phrases: ["hire", "fire", "employee", "promotion", "employment"],
  },
  {
    categories: ["delete_or_destructive_action"],
    phrases: ["delete", "remove", "cancel account", "close account"],
  },
  {
    categories: ["account_access", "personal_data"],
    phrases: ["password", "login", "account", "personal data", "phone", "address"],
  },
  {
    categories: ["complaint_or_angry_user"],
    phrases: ["angry", "complaint", "threat", "escalate"],
  },
  {
    categories: ["real_world_execution"],
    phrases: [],
    patterns: automaticExecutionPatterns,
  },
];

export const sensitiveRiskCategories: readonly RiskCategory[] = [
  "personal_data",
  "financial",
  "medical",
  "visa_or_immigration",
  "employment",
  "refund_or_payment",
  "account_access",
];

export function shouldIgnoreRealWorldExecutionRisk(input: string): boolean {
  return !realWorldExecutionMatches(input);
}