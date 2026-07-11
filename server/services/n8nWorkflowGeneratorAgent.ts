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
  buildN8nWorkflowGeneratorUserPrompt,
  n8nWorkflowGeneratorSystemPrompt,
} from "../prompts/n8nWorkflowGeneratorPrompt";
import { n8nWorkflowSchema } from "../schemas/n8nWorkflow.schema";
import { callGroq } from "./groqProvider";
import {
  OpenAIAPIError,
  callOpenAIAgent,
  resolveOpenAIModelSelection,
  type OpenAIFetch,
} from "./openaiProvider";
import { buildCompactN8nGenerationInput } from "./n8nImplementationBriefBuilder";

export const n8nGeneratorNotConfiguredMessage =
  "n8n JSON generator is not configured. Add OPENAI_API_KEY or GROQ_N8N_API_KEY to enable this feature.";

export const n8nGeneratorProviderLimitMessage =
  "n8n JSON generation exceeded the configured provider output or rate limit. Increase the n8n generation token budget or try a smaller workflow.";

type N8nAiProvider = "openai" | "groq";

type ProviderAttempt = N8nGeneratorProviderAttempt;

export type N8nWorkflowValidationTrace = {
  provider: N8nAiProvider;
  parsed_workflow: unknown;
  normalized_workflow: unknown;
  validation_issues: N8nWorkflowValidationIssue[];
};

export type N8nWorkflowGeneratorDependencies = {
  calls?: Partial<Record<N8nAiProvider, (prompt: string) => Promise<string>>>;
  openaiFetch?: OpenAIFetch;
  onValidationFailure?: (trace: N8nWorkflowValidationTrace) => void;
};

export function resolveN8nOpenAIModelSelection() {
  return resolveOpenAIModelSelection({
    modelEnv: "OPENAI_N8N_MODEL",
    fallbackModelEnv: "OPENAI_AGENT_MODEL",
    defaultModel: "gpt-5-nano",
  });
}

export class N8nWorkflowGeneratorConfigError extends Error {
  provider_attempts: ProviderAttempt[];
  provider: "none";
  used_ai: boolean;
  fallback_used: boolean;
  warnings: string[];
  workflow: null;

  constructor(providerAttempts: ProviderAttempt[] = []) {
    super(n8nGeneratorNotConfiguredMessage);
    this.name = "N8nWorkflowGeneratorConfigError";
    this.provider_attempts = providerAttempts;
    this.provider = "none";
    this.used_ai = false;
    this.fallback_used = false;
    this.warnings = [];
    this.workflow = null;
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
  provider_attempts: ProviderAttempt[];
  provider: N8nAiProvider | "none";
  used_ai: boolean;
  fallback_used: boolean;
  warnings: string[];
  workflow: null;

  constructor(providerAttempts: ProviderAttempt[]) {
    const attemptedProviders = providerAttempts.filter(
      (attempt) => attempt.attempted,
    );

    const details = attemptedProviders
      .map((attempt) => {
        const result = attempt.success
          ? "success"
          : attempt.error_summary || "failed";

        return `${attempt.provider}: ${result}`;
      })
      .join(" | ");

    super(
      details
        ? `n8n generation failed after provider fallback. ${details}`
        : "n8n generation failed because no configured provider could be attempted.",
    );

    this.name = "N8nWorkflowGeneratorProvidersFailedError";

    this.provider_attempts = providerAttempts;

    this.provider = attemptedProviders.at(-1)?.provider ?? "none";

    this.used_ai = attemptedProviders.length > 0;

    this.fallback_used = attemptedProviders.length > 1;

    this.warnings = [];
    this.workflow = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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

export function estimateN8nPromptBytes(input: CompactN8nGenerationInput): {
  compactPayloadBytes: number;
  promptBytes: number;
} {
  const prompt = buildN8nWorkflowGeneratorUserPrompt(input);

  return {
    compactPayloadBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    promptBytes: Buffer.byteLength(
      `${n8nWorkflowGeneratorSystemPrompt}\n${prompt}`,
      "utf8",
    ),
  };
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
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return rawText.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function previewRawModelOutput(rawText: string): string {
  return (
    boundedDiagnosticText(redactDiagnosticSecrets(rawText), 600) ||
    "(empty output)"
  );
}

function boundedDiagnosticText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function redactDiagnosticSecrets(value: string): string {
  let redacted = value;

  for (const secret of [
    process.env.OPENAI_API_KEY,
    process.env.GROQ_N8N_API_KEY,
  ]) {
    if (secret?.trim()) {
      redacted = redacted.replaceAll(secret.trim(), "[REDACTED]");
    }
  }

  return redacted
    .replace(
      /(["']?authorization["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bbearer\s+[^"',\s}]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:OPENAI_API_KEY|GROQ_N8N_API_KEY)\s*[:=]\s*[^\s,"'}]+/gi,
      (match) => `${match.split(/[=:]/, 1)[0]}=[REDACTED]`,
    )
    .replace(/\b(?:sk|gsk)_[a-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{8,}\b/gi, "[REDACTED]");
}

function parseStrictJson(rawText: string): unknown {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with safe cleanup.
  }

  const withoutFence = stripMarkdownJsonFence(trimmed);

  if (withoutFence !== trimmed) {
    try {
      return JSON.parse(withoutFence);
    } catch {
      // Continue with object extraction.
    }
  }

  const extractedObject = extractFirstTopLevelJsonObject(withoutFence);

  if (extractedObject) {
    try {
      return JSON.parse(extractedObject);
    } catch {
      // Fall through to the validation error.
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

function nodeAlias(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}

function isGenericGeneratedWorkflowName(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();

  return (
    !normalized ||
    [
      "classification workflow",
      "extraction workflow",
      "safe automation preview",
      "draft workflow",
      "draft n8n workflow",
      "n8n workflow",
      "workflow",
      "external communication review workflow",
    ].includes(normalized)
  );
}

export function normalizeGeneratedWorkflowEnvelope(input: unknown): unknown {
  if (
    !isRecord(input) ||
    Array.isArray(input.nodes) ||
    isRecord(input.connections) ||
    !isRecord(input.workflow) ||
    !Array.isArray(input.workflow.nodes) ||
    !isRecord(input.workflow.connections)
  ) {
    return input;
  }

  const normalized = {
    ...input,
    ...input.workflow,
  };

  delete normalized.workflow;

  return normalized;
}

export function normalizeGeneratedWorkflowName(
  input: unknown,
  workflowName: string,
): unknown {
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

export function normalizeGeneratedWorkflowActiveFlag(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    active: false,
  };
}

export function normalizeGeneratedWorkflowIds(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  const usedIds = new Set<string>();

  return {
    ...input,
    nodes: input.nodes.map((node, index) => {
      if (!isRecord(node)) {
        return node;
      }

      const existingId = normalizeText(node.id);

      const baseId = slugifyNodeId(
        existingId || node.name,
        `node_${index + 1}`,
      );

      return {
        ...node,
        id: uniqueNodeId(baseId, usedIds),
      };
    }),
  };
}

export function normalizeGeneratedWorkflowNodeShape(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node)) {
        return node;
      }

      const normalized = {
        ...node,
      };

      if (normalized.parameters == null) {
        normalized.parameters = {};
      }

      if (typeof normalized.typeVersion === "string") {
        const parsedTypeVersion = Number(normalized.typeVersion);

        if (Number.isFinite(parsedTypeVersion) && parsedTypeVersion > 0) {
          normalized.typeVersion = parsedTypeVersion;
        }
      }

      for (const optionalKey of [
        "credentials",
        "disabled",
        "notes",
        "notesInFlow",
      ] as const) {
        if (normalized[optionalKey] === null) {
          delete normalized[optionalKey];
        }
      }

      return normalized;
    }),
  };
}

function fallbackNodePosition(index: number): [number, number] {
  return [index * 260, 0];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeGeneratedWorkflowNodePositions(
  input: unknown,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map((node, index) => {
      if (!isRecord(node)) {
        return node;
      }

      const position = Array.isArray(node.position) ? node.position : [];

      const fallback = fallbackNodePosition(index);

      return {
        ...node,
        position: [
          isFiniteNumber(position[0]) ? position[0] : fallback[0],

          isFiniteNumber(position[1]) ? position[1] : fallback[1],
        ],
      };
    }),
  };
}

function buildNodeNameAliases(
  input: Record<string, unknown>,
): Map<string, string> {
  const aliases = new Map<string, string>();

  const nodes = Array.isArray(input.nodes) ? input.nodes : [];

  for (const node of nodes) {
    if (!isRecord(node) || typeof node.name !== "string" || !node.name.trim()) {
      continue;
    }

    aliases.set(nodeAlias(node.name), node.name);

    if (typeof node.id === "string") {
      aliases.set(nodeAlias(node.id), node.name);
    }
  }

  return aliases;
}

function resolveConnectionNodeName(
  value: string,
  aliases: Map<string, string>,
): string {
  return aliases.get(nodeAlias(value)) ?? value;
}

function normalizeConnectionTarget(
  target: unknown,
  aliases: Map<string, string>,
): unknown {
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

  return {
    ...target,
    node: resolveConnectionNodeName(target.node, aliases),
    type: typeof target.type === "string" ? target.type : "main",
    index: typeof target.index === "number" ? target.index : 0,
  };
}

function normalizeConnectionGroup(
  group: unknown,
  aliases: Map<string, string>,
): unknown {
  if (Array.isArray(group)) {
    return group.map((target) => normalizeConnectionTarget(target, aliases));
  }

  if (
    typeof group === "string" ||
    (isRecord(group) && typeof group.node === "string")
  ) {
    return [normalizeConnectionTarget(group, aliases)];
  }

  return group;
}

function normalizeConnectionOutput(
  output: unknown,
  aliases: Map<string, string>,
): unknown {
  if (Array.isArray(output)) {
    return output.map((group) => normalizeConnectionGroup(group, aliases));
  }

  if (
    typeof output === "string" ||
    (isRecord(output) && typeof output.node === "string")
  ) {
    return [[normalizeConnectionTarget(output, aliases)]];
  }

  return output;
}

function unwrapSingleConnectionWrapper(
  nodeConnections: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.hasOwn(nodeConnections, "main")) {
    return nodeConnections;
  }

  const entries = Object.entries(nodeConnections);

  if (entries.length !== 1) {
    return nodeConnections;
  }

  const wrapped = entries[0]?.[1];

  return isRecord(wrapped) && Object.hasOwn(wrapped, "main")
    ? wrapped
    : nodeConnections;
}

export function normalizeGeneratedWorkflowConnections(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.connections)) {
    return input;
  }

  const aliases = buildNodeNameAliases(input);

  const connections = Object.fromEntries(
    Object.entries(input.connections).map(([sourceName, nodeConnections]) => {
      if (!isRecord(nodeConnections)) {
        return [sourceName, nodeConnections];
      }

      const resolvedSource = resolveConnectionNodeName(sourceName, aliases);

      const unwrappedConnections =
        unwrapSingleConnectionWrapper(nodeConnections);

      return [
        resolvedSource,
        Object.fromEntries(
          Object.entries(unwrappedConnections).map(
            ([connectionType, output]) => [
              connectionType,
              normalizeConnectionOutput(output, aliases),
            ],
          ),
        ),
      ];
    }),
  );

  return {
    ...input,
    connections,
  };
}

export function normalizeGeneratedWorkflowConnectionsAfterNodeRemoval(
  input: unknown,
): unknown {
  const normalized = normalizeGeneratedWorkflowConnections(input);

  if (
    !isRecord(normalized) ||
    !Array.isArray(normalized.nodes) ||
    !isRecord(normalized.connections)
  ) {
    return normalized;
  }

  const nodeNames = new Set(
    normalized.nodes
      .filter(isRecord)
      .map((node) => normalizeText(node.name))
      .filter(Boolean),
  );

  const connections: Record<string, unknown> = {};

  for (const [sourceName, nodeConnections] of Object.entries(
    normalized.connections,
  )) {
    if (!nodeNames.has(sourceName) || !isRecord(nodeConnections)) {
      continue;
    }

    const cleaned: Record<string, unknown> = {};

    for (const [connectionType, output] of Object.entries(nodeConnections)) {
      if (!Array.isArray(output)) {
        cleaned[connectionType] = output;
        continue;
      }

      const groups = output
        .map((group) => {
          if (!Array.isArray(group)) {
            return group;
          }

          return group.filter((target) => {
            const targetName = connectionTargetName(target);

            return !targetName || nodeNames.has(targetName);
          });
        })
        .filter((group) => !Array.isArray(group) || group.length > 0);

      if (groups.length > 0) {
        cleaned[connectionType] = groups;
      }
    }

    if (Object.keys(cleaned).length > 0) {
      connections[sourceName] = cleaned;
    }
  }

  return {
    ...normalized,
    connections,
  };
}

function safeReviewValues(
  compactInput: CompactN8nGenerationInput,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const owner = compactInput.human_owner || "responsible human reviewer";

  const approvalBoundary =
    compactInput.approval_boundary ||
    "Human approval is required before external action.";

  const externalBoundary =
    compactInput.external_action_boundary ||
    "No external action is allowed before human review.";

  return {
    ...existing,
    ...canonicalContextValues(compactInput),
    review_owner: owner,
    review_status: "pending",
    manual_review_required: true,
    requires_human_approval: true,
    draft_only: true,
    send_status: "not_sent",
    approval_boundary: approvalBoundary,
    external_action_boundary: externalBoundary,
    next_action: `${owner} reviews and approves the package before any external communication or production action.`,
  };
}

function fieldKey(field: string): string {
  return field
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalFieldKeys(compactInput: CompactN8nGenerationInput): string[] {
  return compactInput.extracted_fields
    .map(fieldKey)
    .filter(
      (field, index, fields) =>
        Boolean(field) && fields.indexOf(field) === index,
    );
}

function canonicalFieldExpressions(
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  return Object.fromEntries(
    canonicalFieldKeys(compactInput).map((field) => [
      field,
      `={{ $json.${field} }}`,
    ]),
  );
}

function canonicalContextValues(
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  return {
    domain: compactInput.domain,
    source: compactInput.source,
    source_system: compactInput.source,
    source_type: compactInput.source_type,
    source_is_placeholder: true,
    human_owner: compactInput.human_owner,
    approval_boundary: compactInput.approval_boundary,
    external_action_boundary: compactInput.external_action_boundary,
  };
}

function samplePayloadForInput(
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...canonicalContextValues(compactInput),
    sample_only: true,
  };

  for (const field of compactInput.extracted_fields) {
    const key = fieldKey(field);

    if (key) {
      payload[key] = "";
    }
  }

  return payload;
}

function sampleCodeForInput(compactInput: CompactN8nGenerationInput): string {
  return `return [{ json: ${JSON.stringify(
    samplePayloadForInput(compactInput),
    null,
    2,
  )} }];`;
}

function extractionCodeForInput(
  compactInput: CompactN8nGenerationInput,
): string {
  const entries = compactInput.extracted_fields
    .map((field) => {
      const key = fieldKey(field);

      return `      ${JSON.stringify(key)}: item.json[${JSON.stringify(
        key,
      )}] ?? ""`;
    })
    .join(",\n");

  return [
    "return items.map((item) => ({",
    "  json: {",
    entries || '    extracted_value: item.json.extracted_value ?? ""',
    "  }",
    "}));",
  ].join("\n");
}

function reviewPackageValues(
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    ...canonicalFieldExpressions(compactInput),
    ...canonicalContextValues(compactInput),
  };

  const classificationKey = fieldKey(compactInput.classification_target);

  if (classificationKey) {
    values[classificationKey] = `={{ $json.${classificationKey} }}`;
  }

  for (const output of compactInput.internal_outputs) {
    const key = fieldKey(output);

    if (key) {
      values[key] = true;
    }
  }

  return values;
}

function reviewPackageCodeForInput(
  compactInput: CompactN8nGenerationInput,
): string {
  const assignments = Object.entries(reviewPackageValues(compactInput))
    .map(([key, value]) => {
      const assignment =
        typeof value === "string" && value.startsWith("={{ $json.")
          ? `item.json[${JSON.stringify(key)}] ?? ""`
          : JSON.stringify(value);

      return `      ${JSON.stringify(key)}: ${assignment}`;
    })
    .join(",\n");

  return [
    "return items.map((item) => ({",
    "  json: {",
    assignments,
    "  }",
    "}));",
  ].join("\n");
}

function normalizedNodeName(node: Record<string, unknown>): string {
  return normalizeText(node.name).toLowerCase();
}

function isPendingReviewNodeName(name: string): boolean {
  const normalized = normalizeText(name).toLowerCase();

  return (
    normalized.includes("mark pending human review") ||
    (normalized.includes("pending") && normalized.includes("review"))
  );
}

function isReviewPackageNodeName(name: string): boolean {
  const normalized = normalizeText(name).toLowerCase();

  return (
    normalized.includes("prepare") &&
    normalized.includes("review") &&
    !isPendingReviewNodeName(normalized)
  );
}

function classificationCodeForInput(
  compactInput: CompactN8nGenerationInput,
): string {
  const targetKey = fieldKey(
    compactInput.classification_target || "classification",
  );
  const canonicalAssignments = canonicalFieldKeys(compactInput).map(
    (field) =>
      `      ${JSON.stringify(field)}: item.json[${JSON.stringify(field)}] ?? "",`,
  );

  if (compactInput.domain === "admissions") {
    return [
      "return items.map((item) => {",
      "  const requiredFields = [",
      ...compactInput.extracted_fields.map(
        (field) => `    ${JSON.stringify(fieldKey(field))},`,
      ),
      "  ];",
      "",
      '  const missingFields = requiredFields.filter((field) => !String(item.json[field] || "").trim());',
      '  const priority = missingFields.length > 0 ? "needs_manual_review" : "normal";',
      "",
      "  return {",
      "    json: {",
      ...canonicalAssignments,
      `      ${JSON.stringify(targetKey)}: priority,`,
      "      priority,",
      "      missing_fields: missingFields,",
      "      classification_is_internal_triage_only: true",
      "    }",
      "  };",
      "});",
    ].join("\n");
  }

  return [
    "return items.map((item) => ({",
    "  json: {",
    ...canonicalAssignments,
    `    ${JSON.stringify(targetKey)}: item.json[${JSON.stringify(targetKey)}] || "needs_manual_review",`,
    "    classification_is_internal_only: true",
    "  }",
    "}));",
  ].join("\n");
}

function reviewCodeForInput(compactInput: CompactN8nGenerationInput): string {
  const reviewValues = safeReviewValues(compactInput);

  const assignments = Object.entries(reviewValues)
    .map(
      ([key, value]) =>
        `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    )
    .join(",\n");

  return [
    "return items.map((item) => ({",
    "  json: {",
    assignments,
    "  }",
    "}));",
  ].join("\n");
}

function normalizeCodeNodeParameters(
  node: Record<string, unknown>,
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const existingParameters = isRecord(node.parameters) ? node.parameters : {};

  const nodeName = normalizedNodeName(node);

  let canonicalCode = "";

  if (nodeName.includes("sample")) {
    canonicalCode = sampleCodeForInput(compactInput);
  } else if (nodeName.includes("extract")) {
    canonicalCode = extractionCodeForInput(compactInput);
  } else if (
    nodeName.includes("classify") ||
    nodeName.includes("categorize") ||
    nodeName.includes("triage")
  ) {
    canonicalCode = classificationCodeForInput(compactInput);
  } else if (isReviewPackageNodeName(nodeName)) {
    canonicalCode = reviewPackageCodeForInput(compactInput);
  } else if (
    isPendingReviewNodeName(nodeName) ||
    nodeName.includes("approval") ||
    nodeName.includes("human review")
  ) {
    canonicalCode = reviewCodeForInput(compactInput);
  }

  return {
    ...node,
    parameters: canonicalCode
      ? {
          jsCode: canonicalCode,
        }
      : {
          ...existingParameters,
          ...(typeof existingParameters.jsCode !== "string" &&
          typeof existingParameters.code === "string"
            ? {
                jsCode: existingParameters.code,
              }
            : {}),
        },
  };
}

function normalizeSetNodeParameters(
  node: Record<string, unknown>,
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const existingParameters = isRecord(node.parameters) ? node.parameters : {};

  const nodeName = normalizedNodeName(node);

  let values: Record<string, unknown> | null = null;

  if (nodeName.includes("sample")) {
    values = samplePayloadForInput(compactInput);
  } else if (nodeName.includes("extract")) {
    values = canonicalFieldExpressions(compactInput);
  } else if (
    nodeName.includes("classify") ||
    nodeName.includes("categorize") ||
    nodeName.includes("triage")
  ) {
    const classificationKey = fieldKey(
      compactInput.classification_target || "classification",
    );

    values = {
      ...canonicalFieldExpressions(compactInput),
      [classificationKey]: "needs_manual_review",
      classification_is_internal_only: true,
    };
  } else if (isReviewPackageNodeName(nodeName)) {
    values = reviewPackageValues(compactInput);
  } else if (
    isPendingReviewNodeName(nodeName) ||
    nodeName.includes("approval") ||
    nodeName.includes("human review")
  ) {
    values = safeReviewValues(compactInput);
  }

  return {
    ...node,
    parameters: values
      ? {
          values,
          keepOnlySet: false,
        }
      : existingParameters,
  };
}

function normalizeStickyNoteParameters(
  node: Record<string, unknown>,
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const content = [
    `Domain: ${compactInput.domain}.`,
    `Source represented safely: ${compactInput.source} (${compactInput.source_type}).`,
    `Human owner: ${compactInput.human_owner}.`,
    compactInput.approval_boundary,
    compactInput.external_action_boundary,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...node,
    parameters: {
      content,
    },
  };
}

function isUnsafeExternalNode(node: Record<string, unknown>): boolean {
  const type = normalizeText(node.type).toLowerCase();

  return (
    type.includes("gmail") ||
    type.includes("slack") ||
    type.includes("http") ||
    type.includes("webhook") ||
    type.includes("sendgrid") ||
    type.includes("zendesk") ||
    type.includes("emailSend".toLowerCase())
  );
}

function normalizeUnsafeExternalNode(
  node: Record<string, unknown>,
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown> {
  const safeNode = { ...node };

  delete safeNode.credentials;

  return {
    ...safeNode,
    type: "n8n-nodes-base.set",
    disabled: true,
    notes: "Disabled safe-preview placeholder. No external action is executed.",
    parameters: {
      values: safeReviewValues(compactInput, {
        blocked_external_action: normalizeText(node.name) || "external action",
        action_status: "blocked",
      }),
      keepOnlySet: false,
    },
  };
}

function hasMeaningfulConditionValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.some(hasMeaningfulConditionValue);
  }

  if (isRecord(value)) {
    return Object.values(value).some(hasMeaningfulConditionValue);
  }

  return false;
}

function hasMeaningfulIfBranches(
  connections: unknown,
  nodeName: string,
): boolean {
  if (!isRecord(connections)) {
    return false;
  }

  const nodeConnections = connections[nodeName];

  if (!isRecord(nodeConnections)) {
    return false;
  }

  const main = nodeConnections.main;

  if (!Array.isArray(main) || main.length < 2) {
    return false;
  }

  const branchTargets = main
    .slice(0, 2)
    .map((group) =>
      Array.isArray(group)
        ? group
            .map(connectionTargetName)
            .filter((name): name is string => Boolean(name))
        : [],
    );

  return (
    branchTargets.every((targets) => targets.length > 0) &&
    branchTargets[0]?.some((target) => !branchTargets[1]?.includes(target)) ===
      true
  );
}

function isMeaninglessClassificationIfNode(
  node: Record<string, unknown>,
  connections: unknown,
): boolean {
  if (node.type !== "n8n-nodes-base.if") {
    return false;
  }

  const name = normalizedNodeName(node);

  if (
    !name.includes("classify") &&
    !name.includes("categorize") &&
    !name.includes("triage")
  ) {
    return false;
  }

  const parameters = isRecord(node.parameters) ? node.parameters : {};

  return (
    !hasMeaningfulConditionValue(parameters.conditions) ||
    !hasMeaningfulIfBranches(connections, normalizeText(node.name))
  );
}

export function normalizeGeneratedWorkflowNodeParameters(
  input: unknown,
  compactInput: CompactN8nGenerationInput,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node)) {
        return node;
      }

      if (isUnsafeExternalNode(node)) {
        return normalizeUnsafeExternalNode(node, compactInput);
      }

      if (isMeaninglessClassificationIfNode(node, input.connections)) {
        return normalizeCodeNodeParameters(
          {
            ...node,
            type: "n8n-nodes-base.code",
            typeVersion: 2,
          },
          compactInput,
        );
      }

      if (node.type === "n8n-nodes-base.code") {
        return normalizeCodeNodeParameters(node, compactInput);
      }

      if (node.type === "n8n-nodes-base.set") {
        return normalizeSetNodeParameters(node, compactInput);
      }

      if (node.type === "n8n-nodes-base.stickyNote") {
        return normalizeStickyNoteParameters(node, compactInput);
      }

      return node;
    }),
  };
}

function connectionTargetName(target: unknown): string | null {
  return isRecord(target) &&
    typeof target.node === "string" &&
    target.node.trim()
    ? target.node
    : null;
}

function removeNodeNamesFromOutput(
  output: unknown,
  names: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(output)) {
    return output;
  }

  return output
    .map((group) => {
      if (!Array.isArray(group)) {
        return group;
      }

      return group.filter((target) => {
        const targetName = connectionTargetName(target);

        return !targetName || !names.has(targetName);
      });
    })
    .filter((group) => !Array.isArray(group) || group.length > 0);
}

export function normalizeStickyNoteConnections(input: unknown): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes) ||
    !isRecord(input.connections)
  ) {
    return input;
  }

  const stickyNoteNames = new Set(
    input.nodes
      .filter(
        (node) =>
          isRecord(node) &&
          node.type === "n8n-nodes-base.stickyNote" &&
          typeof node.name === "string",
      )
      .map((node) => (node as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === "string"),
  );

  if (stickyNoteNames.size === 0) {
    return input;
  }

  const connections: Record<string, unknown> = {};

  for (const [sourceName, nodeConnections] of Object.entries(
    input.connections,
  )) {
    if (stickyNoteNames.has(sourceName)) {
      continue;
    }

    if (!isRecord(nodeConnections)) {
      connections[sourceName] = nodeConnections;

      continue;
    }

    const cleaned: Record<string, unknown> = {};

    for (const [connectionType, output] of Object.entries(nodeConnections)) {
      const normalized = removeNodeNamesFromOutput(output, stickyNoteNames);

      if (!Array.isArray(normalized) || normalized.length > 0) {
        cleaned[connectionType] = normalized;
      }
    }

    if (Object.keys(cleaned).length > 0) {
      connections[sourceName] = cleaned;
    }
  }

  return {
    ...input,
    connections,
  };
}

function isReviewMarkerNode(node: unknown): node is Record<string, unknown> {
  if (!isRecord(node)) {
    return false;
  }

  const name = normalizeText(node.name).toLowerCase();

  return (
    (node.type === "n8n-nodes-base.set" ||
      node.type === "n8n-nodes-base.code") &&
    isPendingReviewNodeName(name)
  );
}

export function normalizeDuplicateReviewSetNodes(input: unknown): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes) ||
    !isRecord(input.connections)
  ) {
    return input;
  }

  const reviewNodes = input.nodes.filter(isReviewMarkerNode);

  if (reviewNodes.length <= 1) {
    return input;
  }

  const preferred =
    reviewNodes.find((node) => {
      const name = normalizeText(node.name).toLowerCase();

      return name.includes("mark pending");
    }) ?? reviewNodes[0];

  const preferredName = normalizeText(preferred?.name);

  const duplicateNames = new Set(
    reviewNodes
      .map((node) => normalizeText(node.name))
      .filter((name) => name && name !== preferredName),
  );

  if (duplicateNames.size === 0) {
    return input;
  }

  const nodes = input.nodes.filter(
    (node) =>
      !(
        isRecord(node) &&
        typeof node.name === "string" &&
        duplicateNames.has(node.name)
      ),
  );

  const connections: Record<string, unknown> = {};

  for (const [sourceName, nodeConnections] of Object.entries(
    input.connections,
  )) {
    if (duplicateNames.has(sourceName)) {
      continue;
    }

    if (!isRecord(nodeConnections)) {
      connections[sourceName] = nodeConnections;

      continue;
    }

    const cleaned: Record<string, unknown> = {};

    for (const [connectionType, output] of Object.entries(nodeConnections)) {
      const normalized = removeNodeNamesFromOutput(output, duplicateNames);

      if (!Array.isArray(normalized) || normalized.length > 0) {
        cleaned[connectionType] = normalized;
      }
    }

    if (Object.keys(cleaned).length > 0) {
      connections[sourceName] = cleaned;
    }
  }

  return {
    ...input,
    nodes,
    connections,
  };
}

function recommendedPendingReviewName(
  compactInput: CompactN8nGenerationInput,
): string | null {
  return (
    compactInput.recommended_nodes.find((name) =>
      isPendingReviewNodeName(name),
    ) ?? null
  );
}

export function ensureRecommendedPendingReviewNode(
  input: unknown,
  compactInput: CompactN8nGenerationInput,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  const recommendedName = recommendedPendingReviewName(compactInput);

  if (!recommendedName) {
    return input;
  }

  const existingIndex = input.nodes.findIndex(
    (node) =>
      isRecord(node) && isPendingReviewNodeName(normalizeText(node.name)),
  );

  const reviewNode = {
    id: "mark_pending_human_review",
    name: recommendedName,
    type: "n8n-nodes-base.set",
    typeVersion: 1,
    position: [input.nodes.length * 260, 0],
    parameters: {
      values: safeReviewValues(compactInput),
      keepOnlySet: false,
    },
  };

  if (existingIndex >= 0) {
    return {
      ...input,
      nodes: input.nodes.map((node, index) =>
        index === existingIndex && isRecord(node)
          ? {
              ...node,
              name: recommendedName,
              type: "n8n-nodes-base.set",
              typeVersion: 1,
              parameters: reviewNode.parameters,
            }
          : node,
      ),
    };
  }

  const usedIds = new Set(
    input.nodes
      .filter(isRecord)
      .map((node) => normalizeText(node.id))
      .filter(Boolean),
  );

  return {
    ...input,
    nodes: [
      ...input.nodes,
      {
        ...reviewNode,
        id: uniqueNodeId(reviewNode.id, usedIds),
      },
    ],
  };
}

function isExecutableNode(node: unknown): node is Record<string, unknown> {
  return (
    isRecord(node) &&
    node.type !== "n8n-nodes-base.stickyNote" &&
    node.disabled !== true &&
    normalizeText(node.name).length > 0
  );
}

function isTriggerNode(node: Record<string, unknown>): boolean {
  return (
    node.type === "n8n-nodes-base.manualTrigger" ||
    node.type === "n8n-nodes-base.scheduleTrigger"
  );
}

function mainConnectionTargets(
  connections: unknown,
  sourceName: string,
): string[] {
  if (!isRecord(connections)) {
    return [];
  }

  const source = connections[sourceName];

  if (!isRecord(source)) {
    return [];
  }

  const main = source.main;

  if (!Array.isArray(main)) {
    return [];
  }

  return main.flatMap((group) =>
    Array.isArray(group)
      ? group
          .map(connectionTargetName)
          .filter((name): name is string => Boolean(name))
      : [],
  );
}

function reachableNodeNames(
  connections: unknown,
  startName: string,
): Set<string> {
  const reachable = new Set<string>();
  const pending = [startName];

  while (pending.length > 0) {
    const current = pending.shift();

    if (!current || reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    for (const target of mainConnectionTargets(connections, current)) {
      if (!reachable.has(target)) {
        pending.push(target);
      }
    }
  }

  return reachable;
}

function canReachNode(
  connections: unknown,
  sourceName: string,
  targetName: string,
): boolean {
  return reachableNodeNames(connections, sourceName).has(targetName);
}

function orderedExecutableNodes(
  nodes: unknown[],
  compactInput: CompactN8nGenerationInput,
): Record<string, unknown>[] {
  const executable = nodes.filter(isExecutableNode);
  const ordered: Record<string, unknown>[] = [];
  const usedNames = new Set<string>();

  const addNode = (node: Record<string, unknown> | undefined) => {
    const name = node ? normalizeText(node.name) : "";

    if (node && name && !usedNames.has(name)) {
      ordered.push(node);
      usedNames.add(name);
    }
  };

  const findByRecommendedName = (recommendedName: string) => {
    const alias = nodeAlias(recommendedName);

    return executable.find((node) => nodeAlias(node.name) === alias);
  };

  const recommendedTrigger = compactInput.recommended_nodes
    .map(findByRecommendedName)
    .find((node) => node && isTriggerNode(node));

  addNode(recommendedTrigger ?? executable.find(isTriggerNode));

  for (const recommendedName of compactInput.recommended_nodes) {
    const node = findByRecommendedName(recommendedName);

    if (node && !isPendingReviewNodeName(normalizeText(node.name))) {
      addNode(node);
    }
  }

  for (const node of executable) {
    if (
      !isTriggerNode(node) &&
      !isPendingReviewNodeName(normalizeText(node.name))
    ) {
      addNode(node);
    }
  }

  for (const node of executable) {
    if (isPendingReviewNodeName(normalizeText(node.name))) {
      addNode(node);
    }
  }

  return ordered;
}

function graphNeedsRepair(
  connections: unknown,
  orderedNodes: Record<string, unknown>[],
  compactInput: CompactN8nGenerationInput,
): boolean {
  if (orderedNodes.length <= 1) {
    return false;
  }

  if (!isRecord(connections) || Object.keys(connections).length === 0) {
    return true;
  }

  const first = orderedNodes[0];
  const firstName = normalizeText(first?.name);

  if (
    !first ||
    !isTriggerNode(first) ||
    mainConnectionTargets(connections, firstName).length === 0
  ) {
    return true;
  }

  const reachable = reachableNodeNames(connections, firstName);

  if (orderedNodes.some((node) => !reachable.has(normalizeText(node.name)))) {
    return true;
  }

  const recommendedPresent = compactInput.recommended_nodes
    .map((recommendedName) => {
      const alias = nodeAlias(recommendedName);

      return orderedNodes.find((node) => nodeAlias(node.name) === alias);
    })
    .filter((node): node is Record<string, unknown> => Boolean(node));

  for (let index = 0; index < recommendedPresent.length - 1; index += 1) {
    const sourceName = normalizeText(recommendedPresent[index]?.name);
    const targetName = normalizeText(recommendedPresent[index + 1]?.name);

    if (!canReachNode(connections, sourceName, targetName)) {
      return true;
    }
  }

  const terminal = orderedNodes.at(-1);
  const terminalName = normalizeText(terminal?.name);

  if (
    terminal &&
    isPendingReviewNodeName(terminalName) &&
    mainConnectionTargets(connections, terminalName).length > 0
  ) {
    return true;
  }

  return orderedNodes.some((node) => {
    const name = normalizeText(node.name).toLowerCase();

    return (
      node.type === "n8n-nodes-base.code" &&
      (name.includes("classify") ||
        name.includes("categorize") ||
        name.includes("triage")) &&
      isRecord(connections) &&
      isRecord(connections[normalizeText(node.name)]) &&
      Array.isArray(
        (connections[normalizeText(node.name)] as Record<string, unknown>).main,
      ) &&
      (
        (connections[normalizeText(node.name)] as Record<string, unknown>)
          .main as unknown[]
      ).length > 1
    );
  });
}

export function repairGeneratedWorkflowGraph(
  input: unknown,
  compactInput: CompactN8nGenerationInput,
): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  const orderedNodes = orderedExecutableNodes(input.nodes, compactInput);

  if (!graphNeedsRepair(input.connections, orderedNodes, compactInput)) {
    return input;
  }

  const connections: Record<string, unknown> = {};
  const positions = new Map<string, [number, number]>();

  orderedNodes.forEach((node, index) => {
    const name = normalizeText(node.name);

    positions.set(name, [index * 260, 0]);

    const next = orderedNodes[index + 1];

    if (next) {
      connections[name] = {
        main: [
          [
            {
              node: normalizeText(next.name),
              type: "main",
              index: 0,
            },
          ],
        ],
      };
    }
  });

  return {
    ...input,
    nodes: input.nodes.map((node) => {
      if (!isRecord(node)) {
        return node;
      }

      const position = positions.get(normalizeText(node.name));

      return position
        ? {
            ...node,
            position,
          }
        : node;
    }),
    connections,
  };
}

const implementationBriefRootFields = [
  "workflow_goal",
  "trigger_description",
  "source",
  "source_type",
  "source_is_placeholder",
  "domain",
  "extracted_fields",
  "classification_target",
  "classification_rules",
  "internal_outputs",
  "human_owner",
  "human_approval_gates",
  "approval_boundary",
  "external_action_boundary",
  "blocked_or_not_safe_actions",
  "warnings",
  "recommended_nodes",
  "draft_only",
] as const;

function enforceCanonicalMetadata(
  input: unknown,
  compactInput: CompactN8nGenerationInput,
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const existingMeta = isRecord(input.meta) ? input.meta : {};

  const normalized: Record<string, unknown> = {};

  for (const key of [
    "name",
    "nodes",
    "connections",
    "active",
    "settings",
    "tags",
    "meta",
    "pinData",
    "staticData",
  ]) {
    if (Object.hasOwn(input, key)) {
      normalized[key] = input[key];
    }
  }

  return {
    ...normalized,
    active: false,
    meta: {
      ...existingMeta,
      flowforge_preview: true,
      domain: compactInput.domain,
      source: compactInput.source,
      source_type: compactInput.source_type,
      source_is_placeholder: true,
      extracted_fields: canonicalFieldKeys(compactInput),
      classification_target: compactInput.classification_target,
      human_owner: compactInput.human_owner,
      approval_boundary: compactInput.approval_boundary,
      external_action_boundary: compactInput.external_action_boundary,
      safety_status: compactInput.safety_status,
    },
  };
}

function workflowWarnings(workflow: N8nWorkflow): string[] {
  const disabledNodes = workflow.nodes.filter((node) => node.disabled === true);

  const warnings = [
    "Draft only. Review before importing. Credentials are placeholders. Production side effects remain disabled.",
  ];

  if (disabledNodes.length > 0) {
    warnings.push(
      `${disabledNodes.length} external or side-effect placeholder node(s) are disabled in the draft.`,
    );
  }

  return warnings;
}

function providerConfigured(provider: N8nAiProvider): boolean {
  if (provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  /*
   * n8n generation must use its dedicated Groq account.
   * Do not silently use the general GROQ_API_KEY.
   */
  return Boolean(process.env.GROQ_N8N_API_KEY);
}

async function callN8nProvider(
  provider: N8nAiProvider,
  prompt: string,
  dependencies?: N8nWorkflowGeneratorDependencies,
): Promise<string> {
  const injectedCall = dependencies?.calls?.[provider];

  if (injectedCall) {
    return injectedCall(prompt);
  }

  if (provider === "openai") {
    return callOpenAIAgent(prompt, n8nWorkflowGeneratorSystemPrompt, {
      modelEnv: "OPENAI_N8N_MODEL",

      fallbackModelEnv: "OPENAI_AGENT_MODEL",

      maxOutputTokensEnv: "OPENAI_N8N_MAX_OUTPUT_TOKENS",

      fallbackMaxOutputTokensEnv: "OPENAI_AGENT_MAX_OUTPUT_TOKENS",

      defaultMaxOutputTokens: 4500,
      maxOutputTokensCap: 6000,

      timeoutEnv: "OPENAI_N8N_TIMEOUT_MS",

      reasoningEffort: "minimal",
      verbosity: "low",
      structuredOutputMode: "none",
      fetchImpl: dependencies?.openaiFetch,
    });
  }

  return callGroq(prompt, n8nWorkflowGeneratorSystemPrompt, {
    /*
     * Always use the dedicated n8n Groq key.
     */
    apiKeyEnv: "GROQ_N8N_API_KEY",

    modelEnv: "GROQ_N8N_MODEL",

    maxTokensEnv: "GROQ_N8N_MAX_TOKENS",

    defaultMaxTokens: 4096,
    maxTokensCap: 6000,
    timeoutMs: 45000,

    truncationSuggestion: "Raise GROQ_N8N_MAX_TOKENS to 4096 or 5000.",

    jsonMode: false,
  });
}

function summarizeProviderError(error: unknown): string {
  if (error instanceof N8nWorkflowGeneratorValidationError) {
    const issueSummary = boundedValidationIssues(error.issues)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");

    return boundedDiagnosticText(
      redactDiagnosticSecrets(
        `${error.message}${issueSummary ? ` ${issueSummary}` : ""}`,
      ),
      800,
    );
  }

  if (error instanceof OpenAIAPIError) {
    return boundedDiagnosticText(redactDiagnosticSecrets(error.message), 500);
  }

  if (error instanceof Error) {
    return boundedDiagnosticText(
      redactDiagnosticSecrets(
        error.message.replace(/\s*\|?\s*Response body:[\s\S]*/i, ""),
      ),
      500,
    );
  }

  return boundedDiagnosticText(
    redactDiagnosticSecrets(String(error ?? "Unknown provider error.")),
    500,
  );
}

function boundedValidationIssues(
  issues: readonly N8nWorkflowValidationIssue[],
): N8nWorkflowValidationIssue[] {
  return issues.slice(0, 5).map((issue) => ({
    path: boundedDiagnosticText(redactDiagnosticSecrets(issue.path), 180),
    message: boundedDiagnosticText(redactDiagnosticSecrets(issue.message), 420),
    code: boundedDiagnosticText(redactDiagnosticSecrets(issue.code), 80),
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parameterTextContainsFieldKey(
  parameterText: string,
  field: string,
): boolean {
  const escapedField = escapeRegExp(field);

  const patterns = [
    new RegExp(`"${escapedField}"\\s*:`, "i"),
    new RegExp(`\\$json\\.${escapedField}\\b`, "i"),
    new RegExp(`\\$json\\[["']${escapedField}["']\\]`, "i"),
    new RegExp(`item\\.json\\.${escapedField}\\b`, "i"),
    new RegExp(`item\\.json\\[["']${escapedField}["']\\]`, "i"),
    new RegExp(`"name"\\s*:\\s*"${escapedField}"`, "i"),
  ];

  return patterns.some((pattern) => pattern.test(parameterText));
}

function conflictingLegacyFieldKeys(
  parameterText: string,
  compactInput: CompactN8nGenerationInput,
): string[] {
  const canonicalKeys = new Set(canonicalFieldKeys(compactInput));

  const possibleLegacyFields = [
    "candidate_name",
    "role",
    "portfolio_link",
    "application_source",
  ];

  return possibleLegacyFields.filter(
    (field) =>
      !canonicalKeys.has(field) &&
      parameterTextContainsFieldKey(parameterText, field),
  );
}

function validateGeneratedWorkflowQuality(
  workflow: N8nWorkflow,
  compactInput: CompactN8nGenerationInput,
): N8nWorkflowValidationIssue[] {
  const issues: N8nWorkflowValidationIssue[] = [];

  const addIssue = (path: string, message: string) => {
    issues.push({
      path,
      message,
      code: "custom",
    });
  };

  const executableNodes = workflow.nodes.filter(isExecutableNode);
  const trigger = executableNodes.find(isTriggerNode);

  if (
    executableNodes.length > 1 &&
    Object.keys(workflow.connections).length === 0
  ) {
    addIssue(
      "connections",
      "Multiple executable nodes require a connected main execution path.",
    );
  }

  if (executableNodes.length > 1 && !trigger) {
    addIssue(
      "nodes",
      "A multi-node direct workflow requires a manual or schedule trigger.",
    );
  }

  if (trigger) {
    const triggerName = normalizeText(trigger.name);
    const reachable = reachableNodeNames(workflow.connections, triggerName);

    if (
      executableNodes.length > 1 &&
      mainConnectionTargets(workflow.connections, triggerName).length === 0
    ) {
      addIssue(
        `connections.${triggerName}`,
        "The workflow trigger must connect to the executable main path.",
      );
    }

    for (const node of executableNodes) {
      const nodeName = normalizeText(node.name);

      if (!reachable.has(nodeName)) {
        addIssue(
          `connections.${nodeName}`,
          `Executable node "${nodeName}" is unreachable from trigger "${triggerName}".`,
        );
      }
    }
  }

  const expectedReviewName = recommendedPendingReviewName(compactInput);
  const pendingReviewNode = workflow.nodes.find((node) =>
    isPendingReviewNodeName(node.name),
  );

  if (expectedReviewName && !pendingReviewNode) {
    addIssue(
      "nodes",
      `Recommended terminal review node "${expectedReviewName}" is missing.`,
    );
  }

  if (pendingReviewNode) {
    const reviewName = pendingReviewNode.name;

    if (pendingReviewNode.type !== "n8n-nodes-base.set") {
      addIssue(
        `nodes.${reviewName}.type`,
        "The terminal pending-review marker must be a safe Set node.",
      );
    }

    if (mainConnectionTargets(workflow.connections, reviewName).length > 0) {
      addIssue(
        `connections.${reviewName}`,
        "The pending-human-review node must be terminal.",
      );
    }

    const parameters = isRecord(pendingReviewNode.parameters)
      ? pendingReviewNode.parameters
      : {};
    const values = isRecord(parameters.values) ? parameters.values : {};
    const expectedValues = safeReviewValues(compactInput);

    for (const [key, value] of Object.entries(expectedValues)) {
      if (values[key] !== value) {
        addIssue(
          `nodes.${reviewName}.parameters.values.${key}`,
          `Pending-review field "${key}" must preserve the canonical value.`,
        );
      }
    }
  }

  const canonicalKeys = canonicalFieldKeys(compactInput);
  const fieldNodes = workflow.nodes.filter((node) => {
    const name = node.name.toLowerCase();

    return (
      name.includes("sample") ||
      name.includes("extract") ||
      name.includes("classify") ||
      name.includes("categorize") ||
      name.includes("triage") ||
      isReviewPackageNodeName(name)
    );
  });

  for (const node of fieldNodes) {
    const parameterText = JSON.stringify(node.parameters);

    for (const key of canonicalKeys) {
      if (!parameterText.includes(key)) {
        addIssue(
          `nodes.${node.name}.parameters`,
          `Canonical extracted field "${key}" is missing from this field-processing node.`,
        );
      }
    }

    const conflictingFields = conflictingLegacyFieldKeys(
      parameterText,
      compactInput,
    );

    if (conflictingFields.length > 0) {
      addIssue(
        `nodes.${node.name}.parameters`,
        `Field-processing node contains noncanonical extracted fields: ${conflictingFields.join(
          ", ",
        )}. Expected extracted fields: ${canonicalKeys.join(", ")}.`,
      );
    }
  }

  const sampleNode = workflow.nodes.find((node) =>
    node.name.toLowerCase().includes("sample"),
  );
  const sampleParameterText = sampleNode
    ? JSON.stringify(sampleNode.parameters)
    : "";

  if (
    sampleNode &&
    (!sampleParameterText.includes(compactInput.source) ||
      !sampleParameterText.includes(compactInput.source_type) ||
      !sampleParameterText.includes(compactInput.domain) ||
      !sampleParameterText.includes(compactInput.human_owner) ||
      !sampleParameterText.includes(compactInput.approval_boundary) ||
      !sampleParameterText.includes(compactInput.external_action_boundary))
  ) {
    addIssue(
      `nodes.${sampleNode?.name}.parameters.values`,
      "The sample intake node must preserve the canonical source and source type.",
    );
  }

  const contextValues = [
    compactInput.domain,
    compactInput.source,
    compactInput.source_type,
    compactInput.human_owner,
    compactInput.approval_boundary,
    compactInput.external_action_boundary,
  ];

  for (const node of workflow.nodes.filter(
    (candidate) =>
      candidate.type === "n8n-nodes-base.stickyNote" ||
      isReviewPackageNodeName(candidate.name),
  )) {
    const parameterText = JSON.stringify(node.parameters);

    if (
      contextValues.some((value) => value && !parameterText.includes(value))
    ) {
      addIssue(
        `nodes.${node.name}.parameters`,
        "Review-package and guidance nodes must preserve canonical domain, source, owner, and boundary context.",
      );
    }
  }

  for (const node of workflow.nodes) {
    if (isMeaninglessClassificationIfNode(node, workflow.connections)) {
      addIssue(
        `nodes.${node.name}`,
        "Classification If nodes require meaningful conditions and connected true/false branches.",
      );
    }
  }

  for (const field of implementationBriefRootFields) {
    if (Object.hasOwn(workflow, field)) {
      addIssue(
        field,
        `Implementation-brief field "${field}" must not leak into the downloadable workflow root.`,
      );
    }
  }

  const meta = isRecord(workflow.meta) ? workflow.meta : {};
  const canonicalMeta: Record<string, unknown> = {
    domain: compactInput.domain,
    source: compactInput.source,
    source_type: compactInput.source_type,
    human_owner: compactInput.human_owner,
    approval_boundary: compactInput.approval_boundary,
    external_action_boundary: compactInput.external_action_boundary,
  };

  for (const [key, value] of Object.entries(canonicalMeta)) {
    if (meta[key] !== value) {
      addIssue(
        `meta.${key}`,
        `Workflow metadata field "${key}" must preserve the canonical implementation brief value.`,
      );
    }
  }

  return issues;
}

function normalizeAndValidateGeneratedWorkflow(
  rawResponse: string,
  compactInput: CompactN8nGenerationInput,
  provider: N8nAiProvider,
  onValidationFailure?: (trace: N8nWorkflowValidationTrace) => void,
): N8nWorkflow {
  const parsed = parseStrictJson(rawResponse);

  const unwrapped = normalizeGeneratedWorkflowEnvelope(parsed);

  const named = normalizeGeneratedWorkflowName(
    unwrapped,
    compactInput.workflow_name,
  );

  const inactive = normalizeGeneratedWorkflowActiveFlag(named);

  const normalizedIds = normalizeGeneratedWorkflowIds(inactive);

  const normalizedNodeShape =
    normalizeGeneratedWorkflowNodeShape(normalizedIds);

  const normalizedConnections =
    normalizeGeneratedWorkflowConnections(normalizedNodeShape);

  const normalizedParameters = normalizeGeneratedWorkflowNodeParameters(
    normalizedConnections,
    compactInput,
  );

  const normalizedStickyNotes =
    normalizeStickyNoteConnections(normalizedParameters);

  const normalizedDuplicates = normalizeDuplicateReviewSetNodes(
    normalizedStickyNotes,
  );

  const completedReviewPath = ensureRecommendedPendingReviewNode(
    normalizedDuplicates,
    compactInput,
  );

  const finalConnections =
    normalizeGeneratedWorkflowConnectionsAfterNodeRemoval(completedReviewPath);

  const repairedGraph = repairGeneratedWorkflowGraph(
    finalConnections,
    compactInput,
  );

  const normalizedPositions =
    normalizeGeneratedWorkflowNodePositions(repairedGraph);

  const normalized = enforceCanonicalMetadata(
    normalizedPositions,
    compactInput,
  );

  const validation = n8nWorkflowSchema.safeParse(normalized);

  if (!validation.success) {
    const issues = formatIssues(validation.error.issues);

    try {
      onValidationFailure?.({
        provider,
        parsed_workflow: parsed,
        normalized_workflow: normalized,
        validation_issues: issues,
      });
    } catch {
      // Diagnostics must never alter provider routing.
    }

    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge safety validation.",
      issues,
    );
  }

  const qualityIssues = validateGeneratedWorkflowQuality(
    validation.data,
    compactInput,
  );

  if (qualityIssues.length > 0) {
    try {
      onValidationFailure?.({
        provider,
        parsed_workflow: parsed,
        normalized_workflow: validation.data,
        validation_issues: qualityIssues,
      });
    } catch {
      // Diagnostics must never alter provider routing.
    }

    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge direct-workflow quality validation.",
      qualityIssues,
    );
  }

  return validation.data;
}

export async function runN8nWorkflowGeneratorAgent(
  input: {
    compileJob: CompileJob;
  },
  dependencies?: N8nWorkflowGeneratorDependencies,
): Promise<N8nGenerateResponse> {
  /*
   * Provider order is intentional:
   *
   * 1. OpenAI
   * 2. Dedicated n8n Groq account
   */
  const providers: readonly N8nAiProvider[] = ["openai", "groq"];

  const compactInput = buildCompactN8nGenerationInput(input.compileJob);

  const prompt = buildN8nWorkflowGeneratorUserPrompt(compactInput);

  const providerAttempts: ProviderAttempt[] = [];

  for (const provider of providers) {
    if (!providerConfigured(provider)) {
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

    let rawResponse: string | undefined;

    try {
      rawResponse = await callN8nProvider(provider, prompt, dependencies);

      const workflow = normalizeAndValidateGeneratedWorkflow(
        rawResponse,
        compactInput,
        provider,
        dependencies?.onValidationFailure,
      );

      /*
       * A provider is a fallback only when an earlier provider
       * was actually attempted and failed.
       *
       * A provider that was merely unconfigured does not count
       * as a runtime fallback.
       */
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

        warnings: workflowWarnings(workflow),

        provider,

        used_ai: true,

        fallback_used: fallbackUsed,

        provider_attempts: providerAttempts,
      };
    } catch (error) {
      const validationIssues =
        error instanceof N8nWorkflowGeneratorValidationError
          ? boundedValidationIssues(error.issues)
          : undefined;

      providerAttempts.push({
        provider,
        attempted: true,
        success: false,
        error_summary: summarizeProviderError(error),
        ...(validationIssues
          ? {
              validation_issues: validationIssues,
            }
          : {}),
        ...(provider === "openai" && rawResponse
          ? {
              raw_response_preview: previewRawModelOutput(rawResponse),
            }
          : {}),
      });
    }
  }

  /*
   * Do not replace the detailed provider history with a generic
   * rate-limit exception. The API/UI needs these fields to show
   * what happened to OpenAI and Groq separately.
   */
  if (!providerAttempts.some((attempt) => attempt.attempted)) {
    throw new N8nWorkflowGeneratorConfigError(providerAttempts);
  }

  throw new N8nWorkflowGeneratorProvidersFailedError(providerAttempts);
}
