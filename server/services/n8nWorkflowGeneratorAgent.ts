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
import { callOpenAIAgent, type OpenAIFetch } from "./openaiProvider";
import { buildCompactN8nGenerationInput } from "./n8nImplementationBriefBuilder";

export const n8nGeneratorNotConfiguredMessage =
  "n8n JSON generator is not configured. Add OPENAI_API_KEY or GROQ_N8N_API_KEY to enable this feature.";

export const n8nGeneratorProviderLimitMessage =
  "n8n JSON generation request was too large for the configured Groq tier. FlowForge now sends a compact implementation brief, but this request still exceeded the provider limit. Try a shorter workflow or reduce workflow details.";

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

    super(details
      ? `n8n generation failed after provider fallback. ${details}`
      : "n8n generation failed because no configured provider could be attempted.");
    this.name = "N8nWorkflowGeneratorProvidersFailedError";
    this.provider_attempts = providerAttempts;
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
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try progressively more tolerant text cleanup below.
  }

  const withoutFence = stripMarkdownJsonFence(trimmed);

  if (withoutFence !== trimmed) {
    try {
      return JSON.parse(withoutFence);
    } catch {
      // Continue to balanced-object extraction.
    }
  }

  const extractedObject = extractFirstTopLevelJsonObject(withoutFence);

  if (extractedObject) {
    try {
      return JSON.parse(extractedObject);
    } catch {
      // Fall through to the FlowForge validation error below.
    }
  }

  throw new N8nWorkflowGeneratorValidationError(
    "n8n generator returned invalid JSON.",
    [
      {
        path: "(root)",
        message: "Model output must be one valid JSON object with no markdown or surrounding explanation.",
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
      } else if (character === "\"") {
        inString = false;
      }

      continue;
    }

    if (character === "\"") {
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
  const normalized = rawText.replace(/\s+/g, " ").trim();

  if (!normalized) return "(empty output)";
  if (normalized.length <= 240) return normalized;

  return `${normalized.slice(0, 239)}...`;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fallbackNodePosition(index: number): [number, number] {
  return [(index % 4) * 260, Math.floor(index / 4) * 180];
}

export function normalizeGeneratedWorkflowNodePositions(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map((node, index) => {
      if (!isRecord(node)) {
        return node;
      }

      const fallbackPosition = fallbackNodePosition(index);
      const position = Array.isArray(node.position) ? node.position : [];

      return {
        ...node,
        position: [
          isFiniteNumber(position[0]) ? position[0] : fallbackPosition[0],
          isFiniteNumber(position[1]) ? position[1] : fallbackPosition[1],
        ],
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function includesAny(value: string, markers: readonly string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

function normalizedNodeName(node: Record<string, unknown>): string {
  return typeof node.name === "string" ? node.name.toLowerCase() : "";
}

function normalizedNodeText(node: Record<string, unknown>): string {
  return [
    node.name,
    node.type,
    safeStringify(node.parameters),
    safeStringify(node.credentials),
    typeof node.notes === "string" ? node.notes : "",
  ]
    .join(" ")
    .toLowerCase();
}

function isSupportNodeName(nodeName: string): boolean {
  return includesAny(nodeName, ["support", "customer", "ticket", "inbox", "message"]);
}

function isDraftReplyNodeName(nodeName: string): boolean {
  return nodeName.includes("draft")
    || nodeName.includes("reply")
    || nodeName.includes("response suggestion");
}

function isReviewOrApprovalNodeName(nodeName: string): boolean {
  return nodeName.includes("review")
    || nodeName.includes("approval")
    || nodeName.includes("approve")
    || nodeName.includes("pending");
}

function isSampleSupportMessageNodeName(nodeName: string): boolean {
  return nodeName.includes("sample") && isSupportNodeName(nodeName);
}

function isClassifyNodeName(nodeName: string): boolean {
  return nodeName.includes("classify") || nodeName.includes("categorize");
}

function isSupportClassificationNodeName(nodeName: string): boolean {
  return isClassifyNodeName(nodeName)
    && (
      isSupportNodeName(nodeName)
      || nodeName.includes("topic")
      || nodeName.includes("urgency")
    );
}

function isSupportDraftFlowNodeName(nodeName: string): boolean {
  return isSupportNodeName(nodeName)
    || isDraftReplyNodeName(nodeName)
    || isReviewOrApprovalNodeName(nodeName);
}

function safeDraftReviewFields(values: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...values,
    review_status: values.review_status || "pending",
    send_status: values.send_status || "not_sent",
    draft_only: values.draft_only ?? true,
    requires_human_approval: values.requires_human_approval ?? true,
  };
}

function normalizeCodeNodeParameters(node: Record<string, unknown>): Record<string, unknown> {
  const parameters = isRecord(node.parameters) ? { ...node.parameters } : {};
  const nodeName = normalizedNodeName(node);

  const existingJsCode = typeof parameters.jsCode === "string" ? parameters.jsCode : "";
  const legacyCode = typeof parameters.code === "string" ? parameters.code : "";

  if (!existingJsCode && legacyCode) {
    parameters.jsCode = legacyCode;
    delete parameters.code;
  }

  const isSampleNode = nodeName.includes("sample");
  const isExtractNode = nodeName.includes("extract");
  const isClassifyNode = nodeName.includes("classify");

  if (isSampleSupportMessageNodeName(nodeName)) {
    parameters.jsCode = [
      "return [{",
      "  json: {",
      "    source_channel: \"support inbox sample\",",
      "    subject: \"Cannot access account\",",
      "    customer_name: \"Sample Customer\",",
      "    customer_message: \"Sample support message for safe draft testing only. Do not send.\",",
      "    issue_summary: \"Customer cannot access account.\",",
      "    topic: \"account_access\",",
      "    urgency: \"high\",",
      "    account_identifier: \"\",",
      "    review_status: \"pending\",",
      "    send_status: \"not_sent\",",
      "    draft_only: true,",
      "    requires_human_approval: true",
      "  }",
      "}];",
    ].join("\n");
  } else if (isSampleNode) {
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

  if (isExtractNode && isSupportNodeName(nodeName)) {
    parameters.jsCode = [
      "return items.map((item) => {",
      "  const body = String(item.json.customer_message || item.json.body || \"\");",
      "",
      "  return {",
      "    json: {",
      "      ...item.json,",
      "      customer_name: item.json.customer_name || \"\",",
      "      issue_summary: item.json.issue_summary || body.slice(0, 240),",
      "      urgency: item.json.urgency || \"\",",
      "      account_identifier: item.json.account_identifier || \"\",",
      "      review_status: \"pending\",",
      "      send_status: \"not_sent\",",
      "      draft_only: true,",
      "      requires_human_approval: true",
      "    }",
      "  };",
      "});",
    ].join("\n");
  } else if (isExtractNode && nodeName.includes("candidate")) {
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

  if (isClassifyNode && isSupportClassificationNodeName(nodeName)) {
    parameters.jsCode = [
      "return items.map((item) => {",
      "  const text = `${item.json.issue_summary || \"\"} ${item.json.customer_message || \"\"} ${item.json.body || \"\"}`.toLowerCase();",
      "  const topic = text.includes(\"refund\") || text.includes(\"charge\")",
      "    ? \"billing\"",
      "    : text.includes(\"login\") || text.includes(\"access\") || text.includes(\"password\")",
      "      ? \"account_access\"",
      "      : \"general_support\";",
      "  const urgency = /urgent|cannot|unable|blocked|down|complaint|threat|refund|charge/.test(text)",
      "    ? \"high\"",
      "    : \"normal\";",
      "",
      "  return {",
      "    json: {",
      "      ...item.json,",
      "      topic,",
      "      urgency,",
      "      priority: urgency,",
      "      review_status: \"pending\",",
      "      send_status: \"not_sent\",",
      "      draft_only: true,",
      "      requires_human_approval: true",
      "    }",
      "  };",
      "});",
    ].join("\n");
  } else if (isClassifyNode) {
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

  if (isDraftReplyNodeName(nodeName)) {
    parameters.jsCode = [
      "return items.map((item) => {",
      "  const issue = String(item.json.issue_summary || item.json.customer_message || \"the support request\");",
      "  const draftReply = `Thanks for contacting support. We reviewed: ${issue}. A support team lead should review this draft before any reply is sent.`;",
      "",
      "  return {",
      "    json: {",
      "      ...item.json,",
      "      draft_reply: draftReply,",
      "      internal_response_suggestion: draftReply,",
      "      review_status: \"pending\",",
      "      send_status: \"not_sent\",",
      "      draft_only: true,",
      "      requires_human_approval: true",
      "    }",
      "  };",
      "});",
    ].join("\n");
  } else if (isReviewOrApprovalNodeName(nodeName) && isSupportDraftFlowNodeName(nodeName)) {
    parameters.jsCode = [
      "return items.map((item) => ({",
      "  json: {",
      "    ...item.json,",
      "    review_owner: item.json.review_owner || \"support team lead\",",
      "    review_status: \"pending\",",
      "    send_status: \"not_sent\",",
      "    draft_only: true,",
      "    requires_human_approval: true,",
      "    manual_review_required: true,",
      "    next_action: \"Support team lead reviews the draft before any reply is sent.\"",
      "  }",
      "}));",
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
    parameters.content = "Manual review required before sending external messages, contacting customers or candidates, or connecting production systems.";
  }

  return {
    ...node,
    parameters,
  };
}

function normalizeSetNodeParameters(node: Record<string, unknown>): Record<string, unknown> {
  const parameters = isRecord(node.parameters) ? { ...node.parameters } : {};
  const values = isRecord(parameters.values) ? { ...parameters.values } : {};
  const nodeName = normalizedNodeName(node);

  if (nodeName.includes("extract candidate")) {
    parameters.values = {
      candidate_name: values.candidate_name || "={{ $json.candidate_name }}",
      role: values.role || "={{ $json.role }}",
      portfolio_link: values.portfolio_link || "={{ $json.portfolio_link }}",
      application_source: values.application_source || "={{ $json.application_source }}",
    };
  }

  const currentValues = isRecord(parameters.values) ? parameters.values : values;
  const shouldAddSupportSafetyFields = isSupportDraftFlowNodeName(nodeName);

  if (isSampleSupportMessageNodeName(nodeName)) {
    parameters.values = safeDraftReviewFields({
      ...currentValues,
      source_channel: currentValues.source_channel || "support inbox sample",
      customer_name: currentValues.customer_name || "Sample Customer",
      customer_message: currentValues.customer_message || "Sample support message for safe draft testing only. Do not send.",
      issue_summary: currentValues.issue_summary || "Customer needs support review.",
    });
  } else if (nodeName.includes("extract support")) {
    parameters.values = safeDraftReviewFields({
      ...currentValues,
      customer_name: currentValues.customer_name || "={{ $json.customer_name }}",
      issue_summary: currentValues.issue_summary || "={{ $json.issue_summary }}",
      urgency: currentValues.urgency || "={{ $json.urgency }}",
      account_identifier: currentValues.account_identifier || "={{ $json.account_identifier }}",
    });
  } else if (isSupportClassificationNodeName(nodeName)) {
    parameters.values = safeDraftReviewFields({
      ...currentValues,
      topic: currentValues.topic || "={{ $json.topic }}",
      urgency: currentValues.urgency || "={{ $json.urgency }}",
      priority: currentValues.priority || "={{ $json.priority }}",
    });
  } else if (isDraftReplyNodeName(nodeName)) {
    parameters.values = safeDraftReviewFields({
      ...currentValues,
      draft_reply: currentValues.draft_reply || "Draft reply for support lead review only. Do not send automatically.",
      internal_response_suggestion: currentValues.internal_response_suggestion || "Draft-only support response suggestion.",
    });
  } else if (isReviewOrApprovalNodeName(nodeName)) {
    parameters.values = safeDraftReviewFields({
      ...currentValues,
      review_owner: currentValues.review_owner || "support team lead",
      manual_review_required: currentValues.manual_review_required ?? true,
      next_action: currentValues.next_action || "Manual review required before any reply is sent.",
    });
  } else if (shouldAddSupportSafetyFields) {
    parameters.values = safeDraftReviewFields(currentValues);
  }

  return {
    ...node,
    parameters,
  };
}

function placeholderCredentialToken(credentialType: string): string {
  const token = credentialType
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return `PLACEHOLDER_${token || "N8N"}_CREDENTIAL`;
}

function normalizeCredentialReferences(node: Record<string, unknown>): Record<string, unknown> {
  if (node.credentials === null) {
    const { credentials: _credentials, ...withoutCredentials } = node;
    return withoutCredentials;
  }

  if (!isRecord(node.credentials)) {
    return node;
  }

  const credentials = Object.fromEntries(
    Object.entries(node.credentials).map(([credentialType, reference]) => {
      if (!isRecord(reference)) {
        return [credentialType, reference];
      }

      const placeholder = placeholderCredentialToken(credentialType);
      const id = typeof reference.id === "string" ? reference.id : undefined;
      const name = typeof reference.name === "string" ? reference.name : undefined;
      const looksConfigured = [id, name].some((value) => value && !value.includes("PLACEHOLDER_"));

      return [
        credentialType,
        looksConfigured
          ? { ...reference, id: placeholder, name: placeholder }
          : reference,
      ];
    }),
  );

  return { ...node, credentials };
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

      const normalizedNode = normalizeCredentialReferences(node);

      if (normalizedNode.type === "n8n-nodes-base.code") {
        const parameters = isRecord(normalizedNode.parameters)
          ? { ...normalizedNode.parameters }
          : {};

        if (typeof parameters.jsCode !== "string" && typeof parameters.code === "string") {
          parameters.jsCode = parameters.code;
          delete parameters.code;
        }

        return { ...normalizedNode, parameters };
      }

      if (normalizedNode.type === "n8n-nodes-base.stickyNote") {
        return normalizeStickyNoteParameters(normalizedNode);
      }

      return normalizedNode;
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

const advisoryExternalConnectorMarkers = [
  "airtable", "asana", "email", "gmail", "googlesheets", "hubspot", "http",
  "jira", "linear", "mailchimp", "mysql", "notion", "paypal", "postgres",
  "quickbooks", "salesforce", "sendgrid", "shopify", "slack", "stripe",
  "supabase", "trello", "twilio", "webhook", "zendesk",
];

const advisoryExternalActionMarkers = [
  "add", "append", "archive", "charge", "create", "delete", "insert", "invite",
  "message", "pay", "payment", "post", "publish", "refund", "remove", "reply",
  "send", "transfer", "update", "upsert", "write",
];

function workflowHasExternalAction(workflow: N8nWorkflow): boolean {
  return workflow.nodes.some((node) => {
    const typeText = node.type.toLowerCase().replace(/[^a-z0-9]/g, "");
    const text = normalizedNodeText(node);

    return includesAny(typeText, advisoryExternalConnectorMarkers)
      && includesAny(text, advisoryExternalActionMarkers);
  });
}

export function collectN8nWorkflowWarnings(
  workflow: N8nWorkflow,
  compactInput: CompactN8nGenerationInput,
): string[] {
  const warnings = [
    "The workflow is generated inactive and must be reviewed before activation.",
    "Test the workflow with sample data before activation.",
  ];

  if (workflow.nodes.some((node) => node.credentials && Object.keys(node.credentials).length > 0)) {
    warnings.push("Credentials must be configured manually in n8n after import.");
  }

  if (workflowHasExternalAction(workflow)) {
    warnings.push("External actions may send, modify, delete, publish, pay, or update real data after activation.");
  }

  if (compactInput.human_approval_gates.length > 0) {
    warnings.push("Human approval is recommended at the approval boundary described in the clarified intent.");
  }

  return warnings;
}

function isProviderLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return /413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute/i.test(message);
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
  dependencies?: N8nWorkflowGeneratorDependencies,
): Promise<string> {
  const injectedCall = dependencies?.calls?.[provider];
  if (injectedCall) return injectedCall(prompt);

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
    return error.message;
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unknown provider error.");
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function normalizeAndValidateGeneratedWorkflow(
  rawResponse: string,
  compactInput: CompactN8nGenerationInput,
): N8nWorkflow {
  const parsed = parseStrictJson(rawResponse);
  const named = normalizeGeneratedWorkflowName(parsed, compactInput.workflow_name);
  const inactive = normalizeGeneratedWorkflowActiveFlag(named);
  const normalizedIds = normalizeGeneratedWorkflowIds(inactive);
  const normalizedConnections = normalizeGeneratedWorkflowConnections(normalizedIds);
  const normalizedParameters = normalizeGeneratedWorkflowNodeParameters(normalizedConnections);
  const normalizedStickyNotes = normalizeStickyNoteConnections(normalizedParameters);
  const normalized = normalizeGeneratedWorkflowNodePositions(normalizedStickyNotes);
  const validation = n8nWorkflowSchema.safeParse(normalized);

  if (!validation.success) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge technical validation.",
      formatIssues(validation.error.issues),
    );
  }

  return validation.data;
}

export async function runN8nWorkflowGeneratorAgent(input: {
  compileJob: CompileJob;
}, dependencies?: N8nWorkflowGeneratorDependencies): Promise<N8nGenerateResponse> {
  const compactInput = buildCompactN8nGenerationInput(input.compileJob);
  const prompt = buildN8nWorkflowGeneratorUserPrompt(compactInput);
  const providerAttempts: N8nGeneratorProviderAttempt[] = [];

  for (const provider of ["openai", "groq"] as const) {
    if (!providerConfigured(provider, dependencies)) {
      providerAttempts.push({
        provider,
        attempted: false,
        success: false,
        error_summary: provider === "openai"
          ? "OPENAI_API_KEY is not configured."
          : "GROQ_N8N_API_KEY is not configured.",
      });
      continue;
    }

    try {
      const rawResponse = await callN8nProvider(provider, prompt, dependencies);
      const workflow = normalizeAndValidateGeneratedWorkflow(rawResponse, compactInput);
      const fallbackUsed = providerAttempts.some((attempt) => attempt.attempted && !attempt.success);

      providerAttempts.push({ provider, attempted: true, success: true });
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
      });
    }
  }

  if (!providerAttempts.some((attempt) => attempt.attempted)) {
    throw new N8nWorkflowGeneratorConfigError(providerAttempts);
  }

  if (providerAttempts.every((attempt) => !attempt.success)
    && providerAttempts.some((attempt) => attempt.attempted && isProviderLimitError(attempt.error_summary))) {
    // Preserve the historical class for API compatibility; detailed attempts remain
    // available through the general providers-failed error in mixed-failure cases.
    if (providerAttempts.filter((attempt) => attempt.attempted).length === 1) {
      throw new N8nWorkflowGeneratorProviderLimitError();
    }
  }

  throw new N8nWorkflowGeneratorProvidersFailedError(providerAttempts);
}
