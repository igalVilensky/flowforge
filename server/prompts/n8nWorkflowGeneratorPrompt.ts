import type { CompileJob } from "../../shared/types/compileJob";
import type { CompactN8nGenerationInput } from "../../shared/types/n8nWorkflow";

export const n8nWorkflowGeneratorSystemPrompt = [
  "Return only valid JSON. Generate a safe draft n8n workflow from this compact FlowForge blueprint.",
  "",
  "Rules:",
  "- Draft only. No production credentials.",
  "- Use placeholder credentials only.",
  "- Keep workflow inactive with active:false.",
  "- No real email sending, record updates, deletes, refunds, payments, or production writes.",
  "- If an external action is needed, create a manual review/approval placeholder instead.",
  "- Use at most 7 nodes.",
  "- Prefer Manual Trigger, Set, IF, Code, Sticky Note, and placeholder review nodes.",
  "- Every node must include string id, name, type, numeric typeVersion, position array, and parameters object.",
  "- Use short stable node ids such as manual_trigger, prepare_data, review_gate, and draft_placeholder.",
  "- Use compact node parameters. No verbose notes. No huge sample data.",
  "- Output one n8n workflow object with nodes, connections, and active:false. No markdown.",
].join("\n");

function truncateText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function uniqueStrings(items: unknown[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const text = truncateText(item, maxLength);

    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    result.push(text);

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
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

function workflowStepLabel(step: unknown, fallback: string): string {
  if (!step || typeof step !== "object") {
    return fallback;
  }

  const record = step as Record<string, unknown>;

  return truncateText(record.label || record.title || record.name || fallback, 100);
}

export function buildCompactN8nGenerationInput(compileJob: CompileJob): CompactN8nGenerationInput {
  const blueprint = compileJob.result;
  const safety = compileJob.safety_critic;

  const blockedItems = [
    ...(blueprint.not_safe_to_automate ?? []),
    ...(blueprint.not_recommended ?? []),
    ...(safety?.blocked_or_not_recommended ?? []),
    ...(safety?.must_remain_draft_only ?? []),
  ];

  const warningItems = [
    ...(safety?.findings ?? []).map(findingText),
    ...(compileJob.safety_critic_agent?.draft_only_warnings ?? []),
    ...(compileJob.safety_critic_agent?.blocked_or_not_recommended ?? []),
  ];

  return {
    original_request: truncateText(compileJob.input.trimmed || compileJob.input.raw, 1000),
    workflow_name: truncateText(blueprint.workflow_name, 120),
    blueprint_summary: truncateText(blueprint.summary, 500),
    safety_status: safety?.overall_status ?? compileJob.status,
    safety_summary: truncateText(safety?.summary || "", 500),
    next_safe_action: truncateText(safety?.next_safe_action || "", 300),
    risk_level: compileJob.risks?.risk_level,
    readiness_score: compileJob.readiness?.score,
    workflow_steps: (blueprint.steps ?? []).slice(0, 8).map((step, index) => ({
      label: workflowStepLabel(step, `Step ${index + 1}`),
      description: truncateText(step.description, 180),
      primitive: step.primitive,
      automation_policy: step.automation_policy,
      real_world_execution: step.real_world_execution,
    })),
    human_approval_gates: uniqueStrings((blueprint.human_approval_gates ?? []).map(humanGateText), 8, 160),
    blocked_or_not_safe_actions: uniqueStrings(blockedItems, 8, 160),
    warnings: uniqueStrings(warningItems, 5, 180),
  };
}

export function buildN8nWorkflowGeneratorUserPrompt(input: CompactN8nGenerationInput): string {
  return [
    "Compact FlowForge blueprint:",
    JSON.stringify(input),
  ].join("\n");
}
