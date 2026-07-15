import type { CompactN8nGenerationInput } from "../../shared/types/n8nWorkflow";
import type {
  N8nNodeSelection,
  N8nNodeSelectionIssue,
  SelectedN8nNode,
} from "../../shared/types/n8nNodeSelection";
import {
  getN8nNodeByKey,
  isKnownN8nNodeKey,
} from "../catalogs/n8nNodeCatalog";
import {
  buildN8nNodeSelectorUserPrompt,
  n8nNodeSelectorSystemPrompt,
} from "../prompts/n8nNodeSelectorPrompt";

export type N8nNodeSelectorCall = (
  prompt: string,
  systemPrompt: string,
) => Promise<string>;

export class N8nNodeSelectionError extends Error {
  issues: N8nNodeSelectionIssue[];

  constructor(message: string, issues: N8nNodeSelectionIssue[]) {
    super(message);
    this.name = "N8nNodeSelectionError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function parseSelectionJson(raw: string): unknown {
  const cleaned = stripJsonFence(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new N8nNodeSelectionError(
      "Node selector returned invalid JSON.",
      [{
        path: "(root)",
        message: "The selector must return one valid JSON object.",
        code: "invalid_json",
      }],
    );
  }
}

function normalizeStepIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value.filter(
      (item): item is number =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        item > 0,
    ),
  )];
}

function normalizeNodeName(value: unknown, nodeKey: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 100);
  }

  return getN8nNodeByKey(nodeKey)?.displayName ?? nodeKey;
}

function validateAndNormalizeSelection(
  input: unknown,
  fallbackWorkflowName: string,
): N8nNodeSelection {
  const issues: N8nNodeSelectionIssue[] = [];

  if (!isRecord(input)) {
    throw new N8nNodeSelectionError(
      "Node selector returned an invalid result.",
      [{
        path: "(root)",
        message: "Expected a JSON object.",
        code: "invalid_type",
      }],
    );
  }

  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];

  if (rawNodes.length === 0) {
    issues.push({
      path: "nodes",
      message: "At least one selected node is required.",
      code: "too_small",
    });
  }

  const nodes: SelectedN8nNode[] = [];

  rawNodes.forEach((rawNode, index) => {
    const path = `nodes.${index}`;

    if (!isRecord(rawNode)) {
      issues.push({
        path,
        message: "Expected a node selection object.",
        code: "invalid_type",
      });
      return;
    }

    const nodeKey =
      typeof rawNode.nodeKey === "string"
        ? rawNode.nodeKey.trim()
        : "";

    if (!nodeKey || !isKnownN8nNodeKey(nodeKey)) {
      issues.push({
        path: `${path}.nodeKey`,
        message: `Unknown catalog node key: ${nodeKey || "(empty)"}.`,
        code: "unknown_node_key",
      });
      return;
    }

    nodes.push({
      stepIds: normalizeStepIds(rawNode.stepIds),
      nodeKey,
      name: normalizeNodeName(rawNode.name, nodeKey),
      ...(typeof rawNode.reason === "string" && rawNode.reason.trim()
        ? { reason: rawNode.reason.trim().slice(0, 240) }
        : {}),
    });
  });

  const mainTriggers = nodes.filter(
    (node) => getN8nNodeByKey(node.nodeKey)?.group === "trigger",
  );

  if (mainTriggers.length > 1) {
    issues.push({
      path: "nodes",
      message:
        "The selected main workflow contains more than one trigger. Choose one main trigger.",
      code: "multiple_triggers",
    });
  }

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = getN8nNodeByKey(nodes[index - 1]!.nodeKey);
    const current = getN8nNodeByKey(nodes[index]!.nodeKey);

    if (previous?.group === "trigger" && current?.group === "trigger") {
      issues.push({
        path: `nodes.${index}`,
        message: "A trigger cannot follow another trigger in the main path.",
        code: "trigger_after_trigger",
      });
    }
  }

  if (issues.length > 0) {
    throw new N8nNodeSelectionError(
      "Node selector returned an invalid architecture.",
      issues,
    );
  }

  const workflowName =
    typeof input.workflowName === "string" && input.workflowName.trim()
      ? input.workflowName.trim().slice(0, 120)
      : fallbackWorkflowName;

  return {
    workflowName,
    nodes,
  };
}

export async function selectN8nNodes(
  brief: CompactN8nGenerationInput,
  callModel: N8nNodeSelectorCall,
): Promise<N8nNodeSelection> {
  const prompt = buildN8nNodeSelectorUserPrompt({ brief });
  const raw = await callModel(prompt, n8nNodeSelectorSystemPrompt);
  const parsed = parseSelectionJson(raw);

  return validateAndNormalizeSelection(
    parsed,
    brief.workflow_name || "Generated n8n Workflow",
  );
}