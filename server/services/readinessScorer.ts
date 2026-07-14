import type {
  AutomationReadinessScore,
  RiskSummary,
  SignalSummary,
} from "../../shared/types/workflow";
import {
  readinessBaseScore,
  readinessBonuses,
  readinessPenalties,
} from "../rules/readinessRules";

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function scoreSignalReadiness(signalSummary: SignalSummary): number {
  let score = readinessBaseScore;

  if (signalSummary.has_trigger) {
    score += readinessBonuses.clear_trigger;
  }

  if (signalSummary.has_clear_output) {
    score += readinessBonuses.clear_output;
  }

  if (signalSummary.has_decision_points) {
    score += readinessBonuses.decision_points;
  }

  if (signalSummary.workflow_primitives.length > 0) {
    score += readinessBonuses.workflow_primitives;
  }

  if (signalSummary.has_system_actor) {
    score += readinessBonuses.system_actor;
  }

  if (signalSummary.has_repeated_process) {
    score += readinessBonuses.repeated_process;
  }

  if (signalSummary.missing_critical_info.length > 0) {
    score -= readinessPenalties.missing_critical_info;
  }

  return clampScore(score);
}

function getStrengths(signalSummary: SignalSummary): string[] {
  const strengths = ["Deterministic scanner can inspect the input."];

  if (signalSummary.has_trigger) {
    strengths.push("Clear trigger condition detected.");
  }

  if (signalSummary.has_clear_output) {
    strengths.push("Expected output is reasonably clear.");
  }

  if (signalSummary.workflow_primitives.length > 0) {
    strengths.push(`Detected workflow primitives: ${signalSummary.workflow_primitives.join(", ")}.`);
  }

  if (signalSummary.has_repeated_process) {
    strengths.push("Repeated process shape detected.");
  }

  if (signalSummary.has_system_actor) {
    strengths.push("System or tool context detected.");
  }

  return strengths;
}

function getWeaknesses(signalSummary: SignalSummary, riskSummary: RiskSummary): string[] {
  const weaknesses: string[] = [];

  for (const missingInfo of signalSummary.missing_critical_info) {
    weaknesses.push(missingInfo);
  }

  if (signalSummary.has_external_action) {
    weaknesses.push("External actions should be reviewed and tested before activation.");
  }

  if (signalSummary.has_sensitive_data) {
    weaknesses.push("Sensitive data requires permission review.");
  }

  if (riskSummary.categories.includes("real_world_execution")) {
    weaknesses.push("Real-world execution remains inactive until the workflow is reviewed.");
  }

  if (riskSummary.risk_level === "high") {
    weaknesses.push("High-impact actions warrant careful review before activation.");
  }

  if (weaknesses.length === 0) {
    weaknesses.push("No major readiness gaps were detected by the rule-based scanner.");
  }

  return [...new Set(weaknesses)];
}

export function scoreReadiness(
  signalSummary: SignalSummary,
  riskSummary: RiskSummary,
): AutomationReadinessScore {
  return {
    score: scoreSignalReadiness(signalSummary),
    strengths: getStrengths(signalSummary),
    weaknesses: getWeaknesses(signalSummary, riskSummary),
  };
}
