import type { SafeAutomationBlueprint } from "../../shared/types/workflow";
import { buildBlueprint } from "../services/blueprintBuilder";
import { scoreReadiness } from "../services/readinessScorer";
import { scanRisks } from "../services/riskScanner";
import { scanSignals } from "../services/signalScanner";

export const validBlueprintInput =
  "When a customer asks for a refund, classify the reason, draft a reply, and route payment decisions to a human.";

export const validBlueprintSignals = scanSignals(validBlueprintInput);
export const validBlueprintRisks = scanRisks(validBlueprintSignals);
export const validBlueprintReadiness = scoreReadiness(validBlueprintSignals, validBlueprintRisks);

export const validBlueprint: SafeAutomationBlueprint = buildBlueprint({
  jobId: "compile_fixture_support_triage",
  processInput: validBlueprintInput,
  signals: validBlueprintSignals,
  risks: validBlueprintRisks,
  readiness: validBlueprintReadiness,
});
