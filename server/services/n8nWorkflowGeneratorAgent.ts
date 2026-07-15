import process from "node:process";
import type { ZodIssue } from "zod";
import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nGenerateResponse,
  N8nGeneratorProviderAttempt,
  N8nWorkflow,
  N8nWorkflowValidationIssue,
} from "../../shared/types/n8nWorkflow";
import {
  buildN8nNodeSelectorUserPrompt,
  n8nNodeSelectorSystemPrompt,
} from "../prompts/n8nNodeSelectorPrompt";
import { n8nWorkflowSchema } from "../schemas/n8nWorkflow.schema";
import { callGroq } from "./groqProvider";
import { callOpenAIAgent, type OpenAIFetch } from "./openaiProvider";
import { buildCompactN8nGenerationInput } from "./n8nImplementationBriefBuilder";
import {
  N8nNodeSelectionError,
  selectN8nNodes,
} from "./n8nNodeSelector";
import { buildMinimalN8nWorkflowFromSelection } from "./n8nWorkflowFromSelection";

export const n8nGeneratorNotConfiguredMessage =
  "n8n JSON generator is not configured. Add OPENAI_API_KEY or GROQ_N8N_API_KEY to enable this feature.";

export const n8nGeneratorProviderLimitMessage =
  "n8n JSON generation request was too large for the configured provider tier. Try a shorter workflow or reduce workflow details.";

type N8nAiProvider = "openai" | "groq";

export type N8nWorkflowGeneratorDependencies = {
  calls?: Partial<Record<N8nAiProvider, (prompt: string) => Promise<string>>>;
  openaiFetch?: OpenAIFetch;
};

export class N8nWorkflowGeneratorConfigError extends Error {
  provider_attempts: N8nGeneratorProviderAttempt[];

  constructor(providerAttempts: N8nGeneratorProviderAttempt[] = []) {
    super(n8nGeneratorNotConfiguredMessage);
    this.name = "N8nWorkflowGeneratorConfigError";
    this.provider_attempts = providerAttempts;
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

export class N8nWorkflowGeneratorProvidersFailedError extends Error {
  provider_attempts: N8nGeneratorProviderAttempt[];

  constructor(providerAttempts: N8nGeneratorProviderAttempt[]) {
    const details = providerAttempts
      .filter((attempt) => attempt.attempted)
      .map((attempt) => `${attempt.provider}: ${attempt.error_summary || "failed"}`)
      .join(" | ");

    super(
      details
        ? `n8n generation failed after provider fallback. ${details}`
        : "n8n generation failed because no configured provider could be attempted.",
    );

    this.name = "N8nWorkflowGeneratorProvidersFailedError";
    this.provider_attempts = providerAttempts;
  }
}

export function estimateN8nPromptBytes(input: CompactN8nGenerationInput): {
  compactPayloadBytes: number;
  promptBytes: number;
} {
  const prompt = buildN8nNodeSelectorUserPrompt({ brief: input });

  return {
    compactPayloadBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    promptBytes: Buffer.byteLength(
      `${n8nNodeSelectorSystemPrompt}\n${prompt}`,
      "utf8",
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function stripMarkdownJsonFence(rawText: string): string {
  const match = rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ? match[1].trim() : rawText;
}

function extractFirstTopLevelJsonObject(rawText: string): string | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];

    if (startIndex === -1) {
      if (character === "{") {
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return rawText.slice(startIndex, index + 1);
    }
  }

  return null;
}

function previewRawModelOutput(rawText: string): string {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty output)";

  return normalized.length <= 240
    ? normalized
    : `${normalized.slice(0, 239)}...`;
}

function parseStrictJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  const withoutFence = stripMarkdownJsonFence(trimmed);
  const extracted = extractFirstTopLevelJsonObject(withoutFence);

  for (const candidate of [trimmed, withoutFence, extracted]) {
    if (!candidate) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new N8nWorkflowGeneratorValidationError(
    "n8n generator returned invalid JSON.",
    [
      {
        path: "(root)",
        message: "Model output must contain one valid JSON object.",
        code: "invalid_json",
      },
      {
        path: "(root)",
        message: `Raw output preview: ${previewRawModelOutput(rawText)}`,
        code: "invalid_json_preview",
      },
    ],
  );
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

function fallbackNodePosition(index: number): [number, number] {
  return [index * 260, 0];
}

function normalizeWorkflowName(input: unknown, workflowName: string): unknown {
  if (!isRecord(input)) return input;

  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : workflowName;

  return { ...input, name };
}

function normalizeActiveFlag(input: unknown): unknown {
  return isRecord(input) ? { ...input, active: false } : input;
}

function normalizeNodeBasics(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) return input;

  const usedIds = new Set<string>();

  return {
    ...input,
    nodes: input.nodes.map((node, index) => {
      if (!isRecord(node)) return node;

      const position = Array.isArray(node.position) ? node.position : [];
      const fallbackPosition = fallbackNodePosition(index);
      const typeVersion =
        typeof node.typeVersion === "number" && node.typeVersion > 0
          ? node.typeVersion
          : 1;

      return {
        ...node,
        id: uniqueNodeId(
          slugifyNodeId(node.id || node.name, `node_${index + 1}`),
          usedIds,
        ),
        typeVersion,
        position: [
          typeof position[0] === "number" && Number.isFinite(position[0])
            ? position[0]
            : fallbackPosition[0],
          typeof position[1] === "number" && Number.isFinite(position[1])
            ? position[1]
            : fallbackPosition[1],
        ],
        parameters: isRecord(node.parameters) ? node.parameters : {},
      };
    }),
  };
}

function nodeAlias(value: unknown): string {
  return typeof value === "string"
    ? value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
    : "";
}

function normalizeConnectionTarget(
  target: unknown,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (typeof target === "string") {
    return {
      node: aliases.get(nodeAlias(target)) ?? target,
      type: "main",
      index: 0,
    };
  }

  if (!isRecord(target) || typeof target.node !== "string") return target;

  return {
    ...target,
    node: aliases.get(nodeAlias(target.node)) ?? target.node,
    type:
      typeof target.type === "string" && target.type.trim()
        ? target.type
        : "main",
    index:
      typeof target.index === "number" && target.index >= 0
        ? target.index
        : 0,
  };
}

function normalizeConnectionOutput(
  output: unknown,
  aliases: ReadonlyMap<string, string>,
): unknown {
  if (
    typeof output === "string"
    || (isRecord(output) && typeof output.node === "string")
  ) {
    return [[normalizeConnectionTarget(output, aliases)]];
  }

  if (!Array.isArray(output)) return output;

  return output.map((group) => {
    if (
      typeof group === "string"
      || (isRecord(group) && typeof group.node === "string")
    ) {
      return [normalizeConnectionTarget(group, aliases)];
    }

    if (!Array.isArray(group)) return group;
    return group.map((target) => normalizeConnectionTarget(target, aliases));
  });
}

function normalizeConnections(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const aliases = new Map<string, string>();

  for (const node of nodes) {
    if (!isRecord(node) || typeof node.name !== "string") continue;

    aliases.set(nodeAlias(node.name), node.name);

    if (typeof node.id === "string") {
      aliases.set(nodeAlias(node.id), node.name);
    }
  }

  const connections = isRecord(input.connections) ? input.connections : {};
  const normalizedConnections: Record<string, unknown> = {};

  for (const [source, nodeConnections] of Object.entries(connections)) {
    const sourceName = aliases.get(nodeAlias(source)) ?? source;

    if (!isRecord(nodeConnections)) {
      normalizedConnections[sourceName] = nodeConnections;
      continue;
    }

    normalizedConnections[sourceName] = Object.fromEntries(
      Object.entries(nodeConnections).map(([connectionType, output]) => [
        connectionType,
        normalizeConnectionOutput(output, aliases),
      ]),
    );
  }

  return { ...input, connections: normalizedConnections };
}

function placeholderCredentialToken(credentialType: string): string {
  const token = credentialType
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return `PLACEHOLDER_${token || "N8N"}_CREDENTIAL`;
}

function normalizeCredentials(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) return input;

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node) || !isRecord(node.credentials)) return node;

      const credentials = Object.fromEntries(
        Object.entries(node.credentials).map(([credentialType, reference]) => {
          if (!isRecord(reference)) return [credentialType, reference];

          const placeholder = placeholderCredentialToken(credentialType);

          return [
            credentialType,
            {
              ...reference,
              id: placeholder,
              name: placeholder,
            },
          ];
        }),
      );

      return { ...node, credentials };
    }),
  };
}

function normalizeCodeParameters(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) return input;

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node) || node.type !== "n8n-nodes-base.code") return node;

      const parameters = isRecord(node.parameters)
        ? { ...node.parameters }
        : {};

      if (
        typeof parameters.jsCode !== "string"
        && typeof parameters.code === "string"
      ) {
        parameters.jsCode = parameters.code;
        delete parameters.code;
      }

      return { ...node, parameters };
    }),
  };
}

const allowedRootKeys = new Set([
  "name",
  "nodes",
  "connections",
  "active",
  "settings",
  "tags",
  "meta",
]);

function stripFlowForgeRootMetadata(input: unknown): unknown {
  if (!isRecord(input)) return input;

  return Object.fromEntries(
    Object.entries(input).filter(([key]) => allowedRootKeys.has(key)),
  );
}

function malformedNodeTypeIssues(
  input: unknown,
): N8nWorkflowValidationIssue[] {
  if (!isRecord(input) || !Array.isArray(input.nodes)) return [];

  const issues: N8nWorkflowValidationIssue[] = [];

  input.nodes.forEach((node, index) => {
    if (!isRecord(node) || typeof node.type !== "string") return;

    if (node.type.includes("[") || node.type.includes("]")) {
      issues.push({
        path: `nodes.${index}.type`,
        message:
          `Malformed n8n node type "${node.type}". Use a real dotted n8n node identifier.`,
        code: "malformed_node_type",
      });
    }

    if (!/^(?:n8n-nodes-base|@n8n\/n8n-nodes-langchain)\./.test(node.type)) {
      issues.push({
        path: `nodes.${index}.type`,
        message:
          `Node type "${node.type}" does not look like a standard n8n node identifier.`,
        code: "invalid_node_type_format",
      });
    }
  });

  return issues;
}

function getConnectionTargets(nodeConnections: unknown): string[] {
  if (!isRecord(nodeConnections)) return [];

  const targets: string[] = [];

  for (const output of Object.values(nodeConnections)) {
    if (!Array.isArray(output)) continue;

    for (const group of output) {
      if (!Array.isArray(group)) continue;

      for (const target of group) {
        if (isRecord(target) && typeof target.node === "string") {
          targets.push(target.node);
        }
      }
    }
  }

  return targets;
}

function cycleIssues(input: unknown): N8nWorkflowValidationIssue[] {
  if (
    !isRecord(input)
    || !Array.isArray(input.nodes)
    || !isRecord(input.connections)
  ) {
    return [];
  }

  const nodes = input.nodes;
  const connections = input.connections;

  const nodeNames = nodes
    .filter(isRecord)
    .map((node) => node.name)
    .filter((name): name is string => typeof name === "string");

  const graph = new Map<string, string[]>(
    nodeNames.map((name) => [
      name,
      getConnectionTargets(connections[name]),
    ]),
  );

  const visited = new Set<string>();
  const active = new Set<string>();

  function visit(nodeName: string): boolean {
    if (active.has(nodeName)) return true;
    if (visited.has(nodeName)) return false;

    visited.add(nodeName);
    active.add(nodeName);

    for (const target of graph.get(nodeName) ?? []) {
      if (visit(target)) return true;
    }

    active.delete(nodeName);
    return false;
  }

  for (const nodeName of nodeNames) {
    if (visit(nodeName)) {
      return [
        {
          path: "connections",
          message:
            "Generated workflow contains a connection cycle. Retry with a forward-only workflow unless a loop was explicitly requested.",
          code: "unexpected_cycle",
        },
      ];
    }
  }

  return [];
}

function technicalIssues(input: unknown): N8nWorkflowValidationIssue[] {
  return [
    ...malformedNodeTypeIssues(input),
    ...cycleIssues(input),
  ];
}

/**
 * Retained for compatibility with existing tests and callers.
 *
 * The new generation path no longer asks the model to generate complete
 * workflow JSON. It asks the model to select catalog nodes and then builds
 * workflow JSON deterministically.
 */
export function normalizeAndValidateGeneratedWorkflow(
  rawResponse: string,
  compactInput: CompactN8nGenerationInput,
): N8nWorkflow {
  const parsed = parseStrictJson(rawResponse);
  const named = normalizeWorkflowName(parsed, compactInput.workflow_name);
  const inactive = normalizeActiveFlag(named);
  const nodesNormalized = normalizeNodeBasics(inactive);
  const connectionsNormalized = normalizeConnections(nodesNormalized);
  const credentialsNormalized = normalizeCredentials(connectionsNormalized);
  const codeNormalized = normalizeCodeParameters(credentialsNormalized);
  const rootNormalized = stripFlowForgeRootMetadata(codeNormalized);

  const preValidationIssues = technicalIssues(rootNormalized);

  if (preValidationIssues.length > 0) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON failed basic technical validation.",
      preValidationIssues,
    );
  }

  const validation = n8nWorkflowSchema.safeParse(rootNormalized);

  if (!validation.success) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge technical validation.",
      formatIssues(validation.error.issues),
    );
  }

  return validation.data;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function workflowHasExternalAction(workflow: N8nWorkflow): boolean {
  return workflow.nodes.some((node) => {
    const text = `${node.name} ${node.type} ${safeStringify(node.parameters)}`
      .toLowerCase();

    return /\b(send|post|publish|reply|update|delete|create|charge|refund|message)\b/.test(text)
      && /(gmail|email|slack|http|webhook|notion|airtable|hubspot|salesforce|stripe|paypal|twilio|sendgrid)/.test(text);
  });
}

export function collectN8nWorkflowWarnings(
  workflow: N8nWorkflow,
  compactInput: CompactN8nGenerationInput,
): string[] {
  const warnings = [
    "The workflow is generated inactive and must be reviewed before activation.",
    "Configure the selected nodes in n8n before testing or activation.",
  ];

  if (
    workflow.nodes.some(
      (node) => node.credentials && Object.keys(node.credentials).length > 0,
    )
  ) {
    warnings.push(
      "Credentials must be configured manually in n8n after import.",
    );
  }

  const emailContext =
    `${compactInput.trigger_description} ${compactInput.source}`.toLowerCase();

  const providerIsUnspecified =
    /\b(?:email|inbox)\b/.test(emailContext)
    && !/\b(?:gmail|outlook|microsoft 365|imap)\b/.test(emailContext);

  if (providerIsUnspecified) {
    warnings.push(
      "Email provider is unspecified; select the correct email integration in n8n if needed.",
    );
  }

  if (workflowHasExternalAction(workflow)) {
    warnings.push(
      "This workflow includes an external integration node, but its action still needs to be configured.",
    );
  }

  return warnings;
}

function isProviderLimitError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String(error ?? "");

  return /413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute/i.test(
    message,
  );
}

function providerConfigured(
  provider: N8nAiProvider,
  dependencies?: N8nWorkflowGeneratorDependencies,
): boolean {
  if (dependencies?.calls?.[provider]) return true;

  return provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.GROQ_N8N_API_KEY);
}

async function callN8nProvider(
  provider: N8nAiProvider,
  prompt: string,
  systemPrompt: string,
  dependencies?: N8nWorkflowGeneratorDependencies,
): Promise<string> {
  const injectedCall = dependencies?.calls?.[provider];

  if (injectedCall) {
    return injectedCall(`${systemPrompt}\n\n${prompt}`);
  }

  if (provider === "openai") {
    return callOpenAIAgent(prompt, systemPrompt, {
      modelEnv: "OPENAI_N8N_MODEL",
      fallbackModelEnv: "OPENAI_AGENT_MODEL",
      maxOutputTokensEnv: "OPENAI_N8N_MAX_OUTPUT_TOKENS",
      fallbackMaxOutputTokensEnv: "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
      defaultMaxOutputTokens: 2200,
      maxOutputTokensCap: 3000,
      timeoutEnv: "OPENAI_N8N_TIMEOUT_MS",
      reasoningEffort: "minimal",
      verbosity: "low",
      structuredOutputMode: "json_object",
      fetchImpl: dependencies?.openaiFetch,
    });
  }

  return callGroq(prompt, systemPrompt, {
    apiKeyEnv: "GROQ_N8N_API_KEY",
    modelEnv: "GROQ_N8N_MODEL",
    maxTokensEnv: "GROQ_N8N_MAX_TOKENS",
    defaultMaxTokens: 2200,
    maxTokensCap: 3000,
    timeoutMs: 45000,
    truncationSuggestion:
      "Raise GROQ_N8N_MAX_TOKENS to 2200 or 3000.",
    jsonMode: true,
  });
}

function summarizeProviderError(error: unknown): string {
  if (
    error instanceof N8nWorkflowGeneratorValidationError
    || error instanceof N8nNodeSelectionError
  ) {
    return error.message;
  }

  const message = error instanceof Error
    ? error.message
    : String(error ?? "Unknown provider error.");

  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

export async function runN8nWorkflowGeneratorAgent(
  input: { compileJob: CompileJob },
  dependencies?: N8nWorkflowGeneratorDependencies,
): Promise<N8nGenerateResponse> {
  const compactInput = buildCompactN8nGenerationInput(input.compileJob);
  const providerAttempts: N8nGeneratorProviderAttempt[] = [];

  for (const provider of ["openai", "groq"] as const) {
    if (!providerConfigured(provider, dependencies)) {
      providerAttempts.push({
        provider,
        attempted: false,
        success: false,
        error_summary:
          provider === "openai"
            ? "OPENAI_API_KEY is not configured."
            : "GROQ_N8N_API_KEY is not configured.",
      });
      continue;
    }

    try {
      const selection = await selectN8nNodes(
        compactInput,
        (prompt, systemPrompt) =>
          callN8nProvider(
            provider,
            prompt,
            systemPrompt,
            dependencies,
          ),
      );

      const generatedWorkflow =
  buildMinimalN8nWorkflowFromSelection(
    selection,
    compactInput.workflow_name,
  );

      const validation = n8nWorkflowSchema.safeParse(generatedWorkflow);

      if (!validation.success) {
        throw new N8nWorkflowGeneratorValidationError(
          "Generated n8n workflow JSON did not pass FlowForge technical validation.",
          formatIssues(validation.error.issues),
        );
      }

      const workflow = validation.data;
      const fallbackUsed = providerAttempts.some(
        (attempt) => attempt.attempted && !attempt.success,
      );

      providerAttempts.push({
        provider,
        attempted: true,
        success: true,
      });

      return {
        workflow_json: workflow,
        warnings: collectN8nWorkflowWarnings(workflow, compactInput),
        provider,
        used_ai: true,
        fallback_used: fallbackUsed,
        provider_attempts: providerAttempts,
      };
    } catch (error) {
      providerAttempts.push({
        provider,
        attempted: true,
        success: false,
        error_summary: summarizeProviderError(error),
        ...(error instanceof N8nWorkflowGeneratorValidationError
          ? { validation_issues: error.issues }
          : {}),
        ...(error instanceof N8nNodeSelectionError
          ? { validation_issues: error.issues }
          : {}),
      });
    }
  }

  if (!providerAttempts.some((attempt) => attempt.attempted)) {
    throw new N8nWorkflowGeneratorConfigError(providerAttempts);
  }

  if (
    providerAttempts.every((attempt) => !attempt.success)
    && providerAttempts.some(
      (attempt) =>
        attempt.attempted && isProviderLimitError(attempt.error_summary),
    )
    && providerAttempts.filter((attempt) => attempt.attempted).length === 1
  ) {
    throw new N8nWorkflowGeneratorProviderLimitError();
  }

  throw new N8nWorkflowGeneratorProvidersFailedError(providerAttempts);
}