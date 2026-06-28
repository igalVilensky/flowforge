import process from "node:process";
import type { ZodIssue } from "zod";
import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nGenerateResponse,
  N8nWorkflow,
} from "../../shared/types/n8nWorkflow";
import {
  buildN8nWorkflowGeneratorUserPrompt,
  n8nWorkflowGeneratorSystemPrompt,
} from "../prompts/n8nWorkflowGeneratorPrompt";
import { n8nWorkflowSchema } from "../schemas/n8nWorkflow.schema";
import { callGroq } from "./groqProvider";
import { buildCompactN8nGenerationInput } from "./n8nImplementationBriefBuilder";

export const n8nGeneratorNotConfiguredMessage =
  "n8n JSON generator is not configured. Add GROQ_N8N_API_KEY to enable this feature.";

export const n8nGeneratorProviderLimitMessage =
  "n8n JSON generation request was too large for the configured Groq tier. FlowForge now sends a compact implementation brief, but this request still exceeded the provider limit. Try a shorter workflow or reduce workflow details.";

export type N8nWorkflowValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class N8nWorkflowGeneratorConfigError extends Error {
  constructor() {
    super(n8nGeneratorNotConfiguredMessage);
    this.name = "N8nWorkflowGeneratorConfigError";
  }
}

export class N8nWorkflowGeneratorValidationError extends Error {
  issues: N8nWorkflowValidationIssue[];

  constructor(message: string, issues: N8nWorkflowValidationIssue[]) {
    super(message);
    this.name = "N8nWorkflowGeneratorValidationError";
    this.issues = issues;
  }
}

export class N8nWorkflowGeneratorProviderLimitError extends Error {
  constructor() {
    super(n8nGeneratorProviderLimitMessage);
    this.name = "N8nWorkflowGeneratorProviderLimitError";
  }
}

export function estimateN8nPromptBytes(input: CompactN8nGenerationInput): {
  compactPayloadBytes: number;
  promptBytes: number;
} {
  const prompt = buildN8nWorkflowGeneratorUserPrompt(input);

  return {
    compactPayloadBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    promptBytes: Buffer.byteLength(`${n8nWorkflowGeneratorSystemPrompt}\n${prompt}`, "utf8"),
  };
}

function formatIssuePath(path: ZodIssue["path"]): string {
  return path.length > 0 ? path.map(String).join(".") : "(root)";
}

function formatIssues(issues: ZodIssue[]): N8nWorkflowValidationIssue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

function parseStrictJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new N8nWorkflowGeneratorValidationError(
      "n8n generator returned non-JSON output.",
      [
        {
          path: "(root)",
          message: "Model output must be valid JSON with no markdown or surrounding explanation.",
          code: "invalid_json",
        },
      ],
    );
  }
}

function slugifyNodeId(value: unknown, fallback: string): string {
  const source = typeof value === "string" && value.trim() ? value : fallback;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function nodeAlias(value: unknown): string {
  return typeof value === "string"
    ? value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    : "";
}

function uniqueNodeId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGenericGeneratedWorkflowName(value: unknown): boolean {
  if (typeof value !== "string") return true;

  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return !normalized
    || [
      "classification workflow",
      "extraction workflow",
      "safe automation preview",
      "draft workflow",
      "draft n8n workflow",
      "n8n workflow",
      "workflow",
    ].includes(normalized);
}

export function normalizeGeneratedWorkflowName(input: unknown, workflowName: string): unknown {
  if (!isRecord(input)) {
    return input;
  }

  if (!isGenericGeneratedWorkflowName(input.name)) {
    return input;
  }

  return {
    ...input,
    name: workflowName,
  };
}

export function normalizeGeneratedWorkflowIds(input: unknown): unknown {
  if (!input || typeof input !== "object" || !Array.isArray((input as { nodes?: unknown }).nodes)) {
    return input;
  }

  const workflow = input as Record<string, unknown> & { nodes: unknown[] };
  const usedIds = new Set<string>();

  return {
    ...workflow,
    nodes: workflow.nodes.map((node, index) => {
      if (!node || typeof node !== "object") {
        return node;
      }

      const record = node as Record<string, unknown>;
      const existingId = typeof record.id === "string" ? record.id.trim() : "";
      const baseId = slugifyNodeId(existingId || record.name, `node_${index + 1}`);

      return {
        ...record,
        id: uniqueNodeId(baseId, usedIds),
      };
    }),
  };
}

function buildNodeNameAliases(input: Record<string, unknown>): Map<string, string> {
  const aliases = new Map<string, string>();
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const firstWordCandidates = new Map<string, string[]>();

  for (const node of nodes) {
    if (!isRecord(node) || typeof node.name !== "string" || !node.name.trim()) {
      continue;
    }

    const nameAlias = nodeAlias(node.name);
    aliases.set(nameAlias, node.name);

    const firstWord = nodeAlias(node.name.split(/\s+/)[0]);

    if (firstWord) {
      firstWordCandidates.set(firstWord, [...(firstWordCandidates.get(firstWord) ?? []), node.name]);
    }

    if (typeof node.id === "string" && node.id.trim()) {
      aliases.set(nodeAlias(node.id), node.name);
    }

    if (nameAlias.includes("manual_review")) {
      aliases.set("review", node.name);
      aliases.set("manual", node.name);
      aliases.set("manual_review", node.name);
      aliases.set("review_gate", node.name);
    }
  }

  for (const [firstWord, names] of firstWordCandidates) {
    if (names.length === 1 && !aliases.has(firstWord)) {
      aliases.set(firstWord, names[0] ?? "");
    }
  }

  return aliases;
}

function resolveConnectionNodeName(value: string, aliases: Map<string, string>): string {
  return aliases.get(nodeAlias(value)) ?? value;
}

function normalizeConnectionTarget(target: unknown, aliases: Map<string, string>): unknown {
  if (typeof target === "string") {
    return {
      node: resolveConnectionNodeName(target, aliases),
      type: "main",
      index: 0,
    };
  }

  if (!isRecord(target) || typeof target.node !== "string") {
    return target;
  }

  const resolvedNodeName = resolveConnectionNodeName(target.node, aliases);

  if (
    typeof target.type === "string"
    && typeof target.index === "number"
    && target.node === resolvedNodeName
  ) {
    return target;
  }

  return {
    ...target,
    node: resolvedNodeName,
    type: typeof target.type === "string" ? target.type : "main",
    index: typeof target.index === "number" ? target.index : 0,
  };
}

function normalizeConnectionGroup(group: unknown, aliases: Map<string, string>): unknown {
  if (Array.isArray(group)) {
    return group.map((target) => normalizeConnectionTarget(target, aliases));
  }

  if (typeof group === "string" || (isRecord(group) && typeof group.node === "string")) {
    return [normalizeConnectionTarget(group, aliases)];
  }

  return group;
}

function normalizeConnectionOutput(output: unknown, aliases: Map<string, string>): unknown {
  if (Array.isArray(output)) {
    return output.map((group) => normalizeConnectionGroup(group, aliases));
  }

  if (typeof output === "string" || (isRecord(output) && typeof output.node === "string")) {
    return [[normalizeConnectionTarget(output, aliases)]];
  }

  return output;
}

export function normalizeGeneratedWorkflowConnections(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.connections)) {
    return input;
  }

  const aliases = buildNodeNameAliases(input);
  const normalizedConnections = Object.fromEntries(
    Object.entries(input.connections).map(([sourceNodeName, nodeConnections]) => {
      if (!isRecord(nodeConnections)) {
        return [sourceNodeName, nodeConnections];
      }

      const resolvedSourceNodeName = resolveConnectionNodeName(sourceNodeName, aliases);

      return [
        resolvedSourceNodeName,
        Object.fromEntries(
          Object.entries(nodeConnections).map(([connectionType, output]) => [
            connectionType,
            normalizeConnectionOutput(output, aliases),
          ]),
        ),
      ];
    }),
  );

  return {
    ...input,
    connections: normalizedConnections,
  };
}

function normalizeCodeNodeParameters(node: Record<string, unknown>): Record<string, unknown> {
  const parameters = isRecord(node.parameters) ? { ...node.parameters } : {};
  const nodeName = typeof node.name === "string" ? node.name.toLowerCase() : "";

  const existingJsCode = typeof parameters.jsCode === "string" ? parameters.jsCode : "";
  const legacyCode = typeof parameters.code === "string" ? parameters.code : "";

  if (!existingJsCode && legacyCode) {
    parameters.jsCode = legacyCode;
    delete parameters.code;
  }

  const isSampleNode = nodeName.includes("sample");
  const isExtractNode = nodeName.includes("extract");
  const isClassifyNode = nodeName.includes("classify");

  if (isSampleNode) {
    parameters.jsCode = [
      "return [{",
      "  json: {",
      "    subject: \"Job Application\",",
      "    body: \"Sample application email for safe draft testing only.\",",
      "    candidate_name: \"\",",
      "    role: \"\",",
      "    portfolio_link: \"\",",
      "    application_source: \"\"",
      "  }",
      "}];",
    ].join("\n");
  }

  if (isExtractNode && nodeName.includes("candidate")) {
    parameters.jsCode = [
      "return items.map((item) => ({",
      "  json: {",
      "    ...item.json,",
      "    candidate_name: item.json.candidate_name || \"\",",
      "    role: item.json.role || \"\",",
      "    portfolio_link: item.json.portfolio_link || \"\",",
      "    application_source: item.json.application_source || \"\"",
      "  }",
      "}));",
    ].join("\n");
  }

  if (isClassifyNode) {
    parameters.jsCode = [
      "return items.map((item) => {",
      "  const role = String(item.json.role || \"\").toLowerCase();",
      "  const portfolio = String(item.json.portfolio_link || \"\");",
      "  const source = String(item.json.application_source || \"\").toLowerCase();",
      "",
      "  const priority = portfolio || role.includes(\"senior\") || source.includes(\"referral\")",
      "    ? \"high\"",
      "    : \"normal\";",
      "",
      "  return {",
      "    json: {",
      "      ...item.json,",
      "      priority",
      "    }",
      "  };",
      "});",
    ].join("\n");
  }

  return {
    ...node,
    parameters,
  };
}

function normalizeStickyNoteParameters(node: Record<string, unknown>): Record<string, unknown> {
  const parameters = isRecord(node.parameters) ? { ...node.parameters } : {};
  const hasText =
    typeof parameters.content === "string"
    || typeof parameters.text === "string"
    || typeof parameters.note === "string";

  if (!hasText) {
    parameters.content = "Manual review required before contacting candidates, sending external messages, or connecting production systems.";
  }

  return {
    ...node,
    parameters,
  };
}

function normalizeSetNodeParameters(node: Record<string, unknown>): Record<string, unknown> {
  const parameters = isRecord(node.parameters) ? { ...node.parameters } : {};
  const values = isRecord(parameters.values) ? { ...parameters.values } : null;
  const nodeName = typeof node.name === "string" ? node.name.toLowerCase() : "";

  if (!values) {
    return {
      ...node,
      parameters,
    };
  }

  if (nodeName.includes("extract candidate")) {
    parameters.values = {
      candidate_name: values.candidate_name || "={{ $json.candidate_name }}",
      role: values.role || "={{ $json.role }}",
      portfolio_link: values.portfolio_link || "={{ $json.portfolio_link }}",
      application_source: values.application_source || "={{ $json.application_source }}",
    };
  }

  const currentValues = isRecord(parameters.values) ? parameters.values : values;

  if (nodeName.includes("review") && !currentValues.review_status) {
    parameters.values = {
      ...currentValues,
      review_status: "pending",
    };
  }

  return {
    ...node,
    parameters,
  };
}

export function normalizeGeneratedWorkflowNodeParameters(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node) || typeof node.type !== "string") {
        return node;
      }

      if (node.type === "n8n-nodes-base.code") {
        return normalizeCodeNodeParameters(node);
      }

      if (node.type === "n8n-nodes-base.stickyNote") {
        return normalizeStickyNoteParameters(node);
      }

      if (node.type === "n8n-nodes-base.set") {
        return normalizeSetNodeParameters(node);
      }

      return node;
    }),
  };
}

function connectionTargetNodeName(target: unknown): string | null {
  if (!isRecord(target) || typeof target.node !== "string" || !target.node.trim()) {
    return null;
  }

  return target.node;
}

function getConnectionTargetsForSource(connections: Record<string, unknown>, sourceNodeName: string): string[] {
  const nodeConnections = connections[sourceNodeName];

  if (!isRecord(nodeConnections)) {
    return [];
  }

  const targets: string[] = [];

  for (const output of Object.values(nodeConnections)) {
    if (!Array.isArray(output)) {
      continue;
    }

    for (const group of output) {
      if (!Array.isArray(group)) {
        continue;
      }

      for (const target of group) {
        const targetName = connectionTargetNodeName(target);

        if (targetName) {
          targets.push(targetName);
        }
      }
    }
  }

  return targets;
}

function getSourcesTargetingNode(connections: Record<string, unknown>, targetNodeName: string): string[] {
  const sources: string[] = [];

  for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
    if (!isRecord(nodeConnections)) {
      continue;
    }

    for (const output of Object.values(nodeConnections)) {
      if (!Array.isArray(output)) {
        continue;
      }

      for (const group of output) {
        if (!Array.isArray(group)) {
          continue;
        }

        const hasTarget = group.some((target) => connectionTargetNodeName(target) === targetNodeName);

        if (hasTarget) {
          sources.push(sourceNodeName);
        }
      }
    }
  }

  return [...new Set(sources)];
}

function createMainConnection(targetNodeName: string): Record<string, unknown> {
  return {
    node: targetNodeName,
    type: "main",
    index: 0,
  };
}

function removeTargetsFromConnectionOutput(output: unknown, nodesToRemove: ReadonlySet<string>): unknown {
  if (!Array.isArray(output)) {
    return output;
  }

  return output
    .map((group) => {
      if (!Array.isArray(group)) {
        return group;
      }

      return group.filter((target) => {
        const targetName = connectionTargetNodeName(target);
        return !targetName || !nodesToRemove.has(targetName);
      });
    })
    .filter((group) => !Array.isArray(group) || group.length > 0);
}

function removeTargetsFromNodeConnections(
  nodeConnections: Record<string, unknown>,
  nodesToRemove: ReadonlySet<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [connectionType, output] of Object.entries(nodeConnections)) {
    const cleanedOutput = removeTargetsFromConnectionOutput(output, nodesToRemove);

    if (Array.isArray(cleanedOutput) && cleanedOutput.length === 0) {
      continue;
    }

    result[connectionType] = cleanedOutput;
  }

  return result;
}

function addMainConnection(
  connections: Record<string, unknown>,
  sourceNodeName: string,
  targetNodeName: string,
): void {
  if (sourceNodeName === targetNodeName) {
    return;
  }

  const sourceConnections = isRecord(connections[sourceNodeName])
    ? { ...connections[sourceNodeName] }
    : {};

  const mainOutput = Array.isArray(sourceConnections.main)
    ? [...sourceConnections.main]
    : [];

  const firstGroup = Array.isArray(mainOutput[0])
    ? [...mainOutput[0]]
    : [];

  const alreadyConnected = firstGroup.some((target) => connectionTargetNodeName(target) === targetNodeName);

  if (!alreadyConnected) {
    firstGroup.push(createMainConnection(targetNodeName));
  }

  sourceConnections.main = [firstGroup, ...mainOutput.slice(1)];
  connections[sourceNodeName] = sourceConnections;
}

function isStickyNoteNode(node: unknown): boolean {
  return isRecord(node) && node.type === "n8n-nodes-base.stickyNote" && typeof node.name === "string";
}

export function normalizeStickyNoteConnections(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes) || !isRecord(input.connections)) {
    return input;
  }

  const stickyNoteNames = new Set(
    input.nodes
      .filter(isStickyNoteNode)
      .map((node) => (node as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === "string" && Boolean(name.trim())),
  );

  if (stickyNoteNames.size === 0) {
    return input;
  }

  const originalConnections = input.connections;
  const cleanedConnections: Record<string, unknown> = {};

  for (const [sourceNodeName, nodeConnections] of Object.entries(originalConnections)) {
    if (stickyNoteNames.has(sourceNodeName)) {
      continue;
    }

    if (!isRecord(nodeConnections)) {
      cleanedConnections[sourceNodeName] = nodeConnections;
      continue;
    }

    const cleanedNodeConnections = removeTargetsFromNodeConnections(nodeConnections, stickyNoteNames);

    if (Object.keys(cleanedNodeConnections).length > 0) {
      cleanedConnections[sourceNodeName] = cleanedNodeConnections;
    }
  }

  for (const stickyNoteName of stickyNoteNames) {
    const previousSources = getSourcesTargetingNode(originalConnections, stickyNoteName).filter(
      (source) => !stickyNoteNames.has(source),
    );

    const nextTargets = getConnectionTargetsForSource(originalConnections, stickyNoteName).filter(
      (target) => !stickyNoteNames.has(target),
    );

    for (const previousSource of previousSources) {
      for (const nextTarget of nextTargets) {
        addMainConnection(cleanedConnections, previousSource, nextTarget);
      }
    }
  }

  return {
    ...input,
    connections: cleanedConnections,
  };
}

function isReviewSetNode(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node)) return false;

  const nodeName = typeof node.name === "string" ? node.name.toLowerCase() : "";
  const nodeType = typeof node.type === "string" ? node.type : "";

  return nodeType === "n8n-nodes-base.set"
    && nodeName.includes("review")
    && (
      nodeName.includes("task")
      || nodeName.includes("gate")
      || nodeName.includes("pending")
    );
}

function findDuplicateReviewSetNodeNames(nodes: unknown[]): Set<string> {
  const reviewSetNodes = nodes.filter(isReviewSetNode);

  if (reviewSetNodes.length <= 1) {
    return new Set();
  }

  const preferredNode = reviewSetNodes.find((node) => {
    const nodeName = typeof node.name === "string" ? node.name.toLowerCase() : "";

    return nodeName.startsWith("prepare ")
      || nodeName.includes("prepare admissions")
      || nodeName.includes("prepare support")
      || nodeName.includes("prepare finance");
  }) ?? reviewSetNodes[0];

  const preferredName = typeof preferredNode?.name === "string" ? preferredNode.name : "";

  return new Set(
    reviewSetNodes
      .map((node) => typeof node.name === "string" ? node.name : "")
      .filter((name) => name && name !== preferredName),
  );
}

function removeNodesFromConnections(
  connections: Record<string, unknown>,
  nodeNamesToRemove: ReadonlySet<string>,
): Record<string, unknown> {
  const cleanedConnections: Record<string, unknown> = {};

  for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeNamesToRemove.has(sourceNodeName)) {
      continue;
    }

    if (!isRecord(nodeConnections)) {
      cleanedConnections[sourceNodeName] = nodeConnections;
      continue;
    }

    const cleanedNodeConnections = removeTargetsFromNodeConnections(nodeConnections, nodeNamesToRemove);

    if (Object.keys(cleanedNodeConnections).length > 0) {
      cleanedConnections[sourceNodeName] = cleanedNodeConnections;
    }
  }

  return cleanedConnections;
}

export function normalizeDuplicateReviewSetNodes(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes) || !isRecord(input.connections)) {
    return input;
  }

  const duplicateReviewNodeNames = findDuplicateReviewSetNodeNames(input.nodes);

  if (duplicateReviewNodeNames.size === 0) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.filter((node) => {
      if (!isRecord(node) || typeof node.name !== "string") {
        return true;
      }

      return !duplicateReviewNodeNames.has(node.name);
    }),
    connections: removeNodesFromConnections(input.connections, duplicateReviewNodeNames),
  };
}

function workflowWarnings(workflow: N8nWorkflow): string[] {
  const disabledNodes = workflow.nodes.filter((node) => node.disabled === true);
  const warnings = [
    "Draft only. Review before importing. Credentials are placeholders. Production side effects remain disabled.",
  ];

  if (disabledNodes.length > 0) {
    warnings.push(`${disabledNodes.length} external or side-effect placeholder node(s) are disabled in the draft.`);
  }

  return warnings;
}

function isProviderLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return /413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute/i.test(message);
}

export async function runN8nWorkflowGeneratorAgent(input: {
  compileJob: CompileJob;
}): Promise<N8nGenerateResponse> {
  if (!process.env.GROQ_N8N_API_KEY) {
    throw new N8nWorkflowGeneratorConfigError();
  }

  const compactInput = buildCompactN8nGenerationInput(input.compileJob);
  const prompt = buildN8nWorkflowGeneratorUserPrompt(compactInput);
  let rawResponse: string;

  try {
    rawResponse = await callGroq(prompt, n8nWorkflowGeneratorSystemPrompt, {
      apiKeyEnv: "GROQ_N8N_API_KEY",
      modelEnv: "GROQ_N8N_MODEL",
      maxTokensEnv: "GROQ_N8N_MAX_TOKENS",
      defaultMaxTokens: 2200,
      maxTokensCap: 2200,
      timeoutMs: 30000,
    });
  } catch (error) {
    if (isProviderLimitError(error)) {
      throw new N8nWorkflowGeneratorProviderLimitError();
    }

    throw error;
  }

  const parsed = parseStrictJson(rawResponse);
  const named = normalizeGeneratedWorkflowName(parsed, compactInput.workflow_name);
  const normalizedIds = normalizeGeneratedWorkflowIds(named);
  const normalizedConnections = normalizeGeneratedWorkflowConnections(normalizedIds);
  const normalizedParameters = normalizeGeneratedWorkflowNodeParameters(normalizedConnections);
  const normalizedStickyNotes = normalizeStickyNoteConnections(normalizedParameters);
  const normalized = normalizeDuplicateReviewSetNodes(normalizedStickyNotes);
  const validation = n8nWorkflowSchema.safeParse(normalized);

  if (!validation.success) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge safety validation.",
      formatIssues(validation.error.issues),
    );
  }

  return {
    workflow_json: validation.data,
    warnings: workflowWarnings(validation.data),
    provider: "groq",
    used_ai: true,
    fallback_used: false,
  };
}