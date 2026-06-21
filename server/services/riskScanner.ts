import type { RiskCategory, RiskLevel, RiskSummary, SignalSummary } from "../../shared/types/workflow";

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

const humanReviewCategories: readonly RiskCategory[] = [
  "external_communication",
  "financial",
  "legal",
  "medical",
  "visa_or_immigration",
  "employment",
  "refund_or_payment",
  "delete_or_destructive_action",
  "account_access",
  "high_stakes_decision",
  "real_world_execution",
];

function uniqueCategories(categories: readonly RiskCategory[]): RiskCategory[] {
  return [...new Set(categories)];
}

export function getRiskLevel(categories: readonly RiskCategory[]): RiskLevel {
  if (categories.some((category) => highRiskCategories.includes(category))) {
    return "high";
  }

  return categories.length > 0 ? "medium" : "low";
}

export function requiresHumanReview(categories: readonly RiskCategory[]): boolean {
  return categories.some((category) => humanReviewCategories.includes(category));
}

export function describeRiskReasons(categories: readonly RiskCategory[]): string[] {
  const reasons: string[] = [];

  if (categories.length === 0) {
    return ["The rule-based scanner did not detect obvious safety risk flags."];
  }

  if (categories.includes("external_communication")) {
    reasons.push("External communication must be reviewed before sending.");
  }

  if (categories.includes("refund_or_payment") || categories.includes("financial")) {
    reasons.push("Refund, payment, billing, and financial outcomes need accountable review.");
  }

  if (categories.includes("legal")) {
    reasons.push("Legal workflows require accountable human ownership.");
  }

  if (categories.includes("medical")) {
    reasons.push("Medical workflows require accountable human ownership.");
  }

  if (categories.includes("visa_or_immigration")) {
    reasons.push("Visa and immigration workflows require accountable human ownership.");
  }

  if (categories.includes("employment")) {
    reasons.push("Employment workflows require accountable human ownership.");
  }

  if (categories.includes("high_stakes_decision")) {
    reasons.push("Sensitive or high-stakes decisions must remain human-approved.");
  }

  if (categories.includes("personal_data") || categories.includes("account_access")) {
    reasons.push("Personal data and account access require clear permissions.");
  }

  if (categories.includes("delete_or_destructive_action")) {
    reasons.push("Destructive actions need explicit approval and rollback planning.");
  }

  if (categories.includes("complaint_or_angry_user")) {
    reasons.push("Complaints, angry messages, and threats need careful review before automation.");
  }

  if (categories.includes("real_world_execution")) {
    reasons.push("The MVP must not execute real-world actions automatically.");
  }

  return reasons.length > 0 ? reasons : ["Detected risk flags require review before automation."];
}

export function scanRisks(signalSummary: SignalSummary): RiskSummary {
  const categories = uniqueCategories(signalSummary.risk_flags);

  return {
    categories,
    risk_level: getRiskLevel(categories),
    reasons: describeRiskReasons(categories),
    requires_human_review: requiresHumanReview(categories),
  };
}
