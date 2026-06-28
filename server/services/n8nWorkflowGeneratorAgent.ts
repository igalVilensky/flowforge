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
  const normalized = normalizeGeneratedWorkflowConnections(normalizedIds);
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
