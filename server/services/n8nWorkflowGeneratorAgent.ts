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

export type N8nWorkflowValidationIssue = {
  path: string;
  message: string;
  code: string;
};

type N8nAiProvider = "openai" | "groq";

type ProviderAttempt = {
  provider: N8nAiProvider;
  attempted: boolean;
  success: boolean;
  error_summary?: string;
};

export type N8nWorkflowGeneratorDependencies = {
  calls?: Partial<
    Record<
      N8nAiProvider,
      (prompt: string) => Promise<string>
    >
  >;
  openaiFetch?: OpenAIFetch;
};

export function resolveN8nOpenAIModelSelection() {
  return resolveOpenAIModelSelection({
    modelEnv: "OPENAI_N8N_MODEL",
    fallbackModelEnv:
      "OPENAI_AGENT_MODEL",
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

  constructor(
    providerAttempts: ProviderAttempt[] = [],
  ) {
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

  constructor(
    message: string,
    issues: N8nWorkflowValidationIssue[],
  ) {
    super(message);
    this.name =
      "N8nWorkflowGeneratorValidationError";
    this.issues = issues;
  }
}

export class N8nWorkflowGeneratorProviderLimitError extends Error {
  constructor() {
    super(n8nGeneratorProviderLimitMessage);
    this.name =
      "N8nWorkflowGeneratorProviderLimitError";
  }
}

export class N8nWorkflowGeneratorProvidersFailedError extends Error {
  provider_attempts: ProviderAttempt[];
  provider: N8nAiProvider | "none";
  used_ai: boolean;
  fallback_used: boolean;
  warnings: string[];
  workflow: null;

  constructor(
    providerAttempts: ProviderAttempt[],
  ) {
    const attemptedProviders =
      providerAttempts.filter(
        (attempt) => attempt.attempted,
      );

    const details =
      attemptedProviders
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

    this.name =
      "N8nWorkflowGeneratorProvidersFailedError";

    this.provider_attempts =
      providerAttempts;

    this.provider =
      attemptedProviders.at(-1)?.provider ??
      "none";

    this.used_ai =
      attemptedProviders.length > 0;

    this.fallback_used =
      attemptedProviders.length > 1;

    this.warnings = [];
    this.workflow = null;
  }
}


function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}

function formatIssuePath(
  path: ZodIssue["path"],
): string {
  return path.length > 0
    ? path.map(String).join(".")
    : "(root)";
}

function formatIssues(
  issues: ZodIssue[],
): N8nWorkflowValidationIssue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

export function estimateN8nPromptBytes(
  input: CompactN8nGenerationInput,
): {
  compactPayloadBytes: number;
  promptBytes: number;
} {
  const prompt =
    buildN8nWorkflowGeneratorUserPrompt(
      input,
    );

  return {
    compactPayloadBytes:
      Buffer.byteLength(
        JSON.stringify(input),
        "utf8",
      ),
    promptBytes: Buffer.byteLength(
      `${n8nWorkflowGeneratorSystemPrompt}\n${prompt}`,
      "utf8",
    ),
  };
}

function stripMarkdownJsonFence(
  rawText: string,
): string {
  const match = rawText.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  );

  return match?.[1]
    ? match[1].trim()
    : rawText;
}

function extractFirstTopLevelJsonObject(
  rawText: string,
): string | null {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let index = 0;
    index < rawText.length;
    index += 1
  ) {
    const character =
      rawText[index];

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
        return rawText.slice(
          startIndex,
          index + 1,
        );
      }
    }
  }

  return null;
}

function previewRawModelOutput(
  rawText: string,
): string {
  const normalized = rawText
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "(empty output)";
  }

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 239)}...`;
}

function parseStrictJson(
  rawText: string,
): unknown {
  const trimmed = rawText.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with safe cleanup.
  }

  const withoutFence =
    stripMarkdownJsonFence(trimmed);

  if (withoutFence !== trimmed) {
    try {
      return JSON.parse(withoutFence);
    } catch {
      // Continue with object extraction.
    }
  }

  const extractedObject =
    extractFirstTopLevelJsonObject(
      withoutFence,
    );

  if (extractedObject) {
    try {
      return JSON.parse(
        extractedObject,
      );
    } catch {
      // Fall through to the validation error.
    }
  }

  throw new N8nWorkflowGeneratorValidationError(
    "n8n generator returned invalid JSON.",
    [
      {
        path: "(root)",
        message:
          "Model output must contain one valid JSON object.",
        code: "invalid_json",
      },
      {
        path: "(root)",
        message:
          `Raw output preview: ${previewRawModelOutput(rawText)}`,
        code: "invalid_json_preview",
      },
    ],
  );
}

function slugifyNodeId(
  value: unknown,
  fallback: string,
): string {
  const source =
    typeof value === "string" &&
    value.trim()
      ? value
      : fallback;

  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function uniqueNodeId(
  baseId: string,
  usedIds: Set<string>,
): string {
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate =
      `${baseId}_${suffix}`;

    suffix += 1;
  }

  usedIds.add(candidate);

  return candidate;
}

function nodeAlias(
  value: unknown,
): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}

function isGenericGeneratedWorkflowName(
  value: unknown,
): boolean {
  const normalized =
    normalizeText(value).toLowerCase();

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

export function normalizeGeneratedWorkflowName(
  input: unknown,
  workflowName: string,
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  if (
    !isGenericGeneratedWorkflowName(
      input.name,
    )
  ) {
    return input;
  }

  return {
    ...input,
    name: workflowName,
  };
}

export function normalizeGeneratedWorkflowActiveFlag(
  input: unknown,
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    active: false,
  };
}

export function normalizeGeneratedWorkflowIds(
  input: unknown,
): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes)
  ) {
    return input;
  }

  const usedIds =
    new Set<string>();

  return {
    ...input,
    nodes: input.nodes.map(
      (node, index) => {
        if (!isRecord(node)) {
          return node;
        }

        const existingId =
          normalizeText(node.id);

        const baseId =
          slugifyNodeId(
            existingId ||
              node.name,
            `node_${index + 1}`,
          );

        return {
          ...node,
          id: uniqueNodeId(
            baseId,
            usedIds,
          ),
        };
      },
    ),
  };
}

function fallbackNodePosition(
  index: number,
): [number, number] {
  return [
    index * 260,
    0,
  ];
}

function isFiniteNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

export function normalizeGeneratedWorkflowNodePositions(
  input: unknown,
): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes)
  ) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map(
      (node, index) => {
        if (!isRecord(node)) {
          return node;
        }

        const position =
          Array.isArray(
            node.position,
          )
            ? node.position
            : [];

        const fallback =
          fallbackNodePosition(index);

        return {
          ...node,
          position: [
            isFiniteNumber(
              position[0],
            )
              ? position[0]
              : fallback[0],

            isFiniteNumber(
              position[1],
            )
              ? position[1]
              : fallback[1],
          ],
        };
      },
    ),
  };
}

function buildNodeNameAliases(
  input: Record<string, unknown>,
): Map<string, string> {
  const aliases =
    new Map<string, string>();

  const nodes =
    Array.isArray(input.nodes)
      ? input.nodes
      : [];

  for (const node of nodes) {
    if (
      !isRecord(node) ||
      typeof node.name !==
        "string" ||
      !node.name.trim()
    ) {
      continue;
    }

    aliases.set(
      nodeAlias(node.name),
      node.name,
    );

    if (
      typeof node.id === "string"
    ) {
      aliases.set(
        nodeAlias(node.id),
        node.name,
      );
    }
  }

  return aliases;
}

function resolveConnectionNodeName(
  value: string,
  aliases: Map<string, string>,
): string {
  return (
    aliases.get(nodeAlias(value)) ??
    value
  );
}

function normalizeConnectionTarget(
  target: unknown,
  aliases: Map<string, string>,
): unknown {
  if (typeof target === "string") {
    return {
      node:
        resolveConnectionNodeName(
          target,
          aliases,
        ),
      type: "main",
      index: 0,
    };
  }

  if (
    !isRecord(target) ||
    typeof target.node !== "string"
  ) {
    return target;
  }

  return {
    ...target,
    node:
      resolveConnectionNodeName(
        target.node,
        aliases,
      ),
    type:
      typeof target.type ===
      "string"
        ? target.type
        : "main",
    index:
      typeof target.index ===
      "number"
        ? target.index
        : 0,
  };
}

function normalizeConnectionGroup(
  group: unknown,
  aliases: Map<string, string>,
): unknown {
  if (Array.isArray(group)) {
    return group.map((target) =>
      normalizeConnectionTarget(
        target,
        aliases,
      ),
    );
  }

  if (
    typeof group === "string" ||
    (
      isRecord(group) &&
      typeof group.node ===
        "string"
    )
  ) {
    return [
      normalizeConnectionTarget(
        group,
        aliases,
      ),
    ];
  }

  return group;
}

function normalizeConnectionOutput(
  output: unknown,
  aliases: Map<string, string>,
): unknown {
  if (Array.isArray(output)) {
    return output.map((group) =>
      normalizeConnectionGroup(
        group,
        aliases,
      ),
    );
  }

  if (
    typeof output === "string" ||
    (
      isRecord(output) &&
      typeof output.node ===
        "string"
    )
  ) {
    return [[
      normalizeConnectionTarget(
        output,
        aliases,
      ),
    ]];
  }

  return output;
}

export function normalizeGeneratedWorkflowConnections(
  input: unknown,
): unknown {
  if (
    !isRecord(input) ||
    !isRecord(input.connections)
  ) {
    return input;
  }

  const aliases =
    buildNodeNameAliases(input);

  const connections =
    Object.fromEntries(
      Object.entries(
        input.connections,
      ).map(
        ([
          sourceName,
          nodeConnections,
        ]) => {
          if (
            !isRecord(
              nodeConnections,
            )
          ) {
            return [
              sourceName,
              nodeConnections,
            ];
          }

          const resolvedSource =
            resolveConnectionNodeName(
              sourceName,
              aliases,
            );

          return [
            resolvedSource,
            Object.fromEntries(
              Object.entries(
                nodeConnections,
              ).map(
                ([
                  connectionType,
                  output,
                ]) => [
                  connectionType,
                  normalizeConnectionOutput(
                    output,
                    aliases,
                  ),
                ],
              ),
            ),
          ];
        },
      ),
    );

  return {
    ...input,
    connections,
  };
}

function safeReviewValues(
  compactInput:
    CompactN8nGenerationInput,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const owner =
    compactInput.human_owner ||
    "responsible human reviewer";

  const approvalBoundary =
    compactInput.approval_boundary ||
    "Human approval is required before external action.";

  const externalBoundary =
    compactInput.external_action_boundary ||
    "No external action is allowed before human review.";

  return {
    ...existing,
    review_owner: owner,
    review_status: "pending",
    manual_review_required: true,
    requires_human_approval: true,
    draft_only: true,
    send_status: "not_sent",
    approval_boundary:
      approvalBoundary,
    external_action_boundary:
      externalBoundary,
    next_action:
      `${owner} reviews and approves the package before any external communication or production action.`,
  };
}

function fieldKey(
  field: string,
): string {
  return field
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function samplePayloadForInput(
  compactInput:
    CompactN8nGenerationInput,
): Record<string, unknown> {
  const payload:
    Record<string, unknown> = {
      source_system:
        compactInput.source,
      source_type:
        compactInput.source_type,
      source_is_placeholder: true,
      sample_only: true,
    };

  for (
    const field of
    compactInput.extracted_fields
  ) {
    const key = fieldKey(field);

    if (key) {
      payload[key] = "";
    }
  }

  if (
    compactInput.domain ===
    "admissions"
  ) {
    payload.subject =
      "Sample admissions application";
    payload.email_body =
      "Applicant Name: \nApplication ID: \nCourse: \nApplication Summary: ";
  } else if (
    compactInput.domain ===
    "support"
  ) {
    payload.subject =
      "Sample support request";
    payload.message =
      "Sample support request for safe preview only.";
  } else if (
    compactInput.domain ===
    "finance"
  ) {
    payload.subject =
      "Sample finance request";
    payload.message =
      "Sample finance request for safe preview only.";
  } else if (
    compactInput.domain ===
    "marketing"
  ) {
    payload.subject =
      "Sample campaign brief";
    payload.message =
      "Sample campaign brief for safe preview only.";
  } else {
    payload.subject =
      "Sample internal input";
    payload.message =
      "Sample data for safe preview only.";
  }

  return payload;
}

function sampleCodeForInput(
  compactInput:
    CompactN8nGenerationInput,
): string {
  return `return [{ json: ${JSON.stringify(
    samplePayloadForInput(
      compactInput,
    ),
    null,
    2,
  )} }];`;
}

function extractionCodeForInput(
  compactInput:
    CompactN8nGenerationInput,
): string {
  const entries =
    compactInput.extracted_fields
      .map((field) => {
        const key = fieldKey(field);

        return `      ${JSON.stringify(
          key,
        )}: item.json[${JSON.stringify(
          key,
        )}] ?? ""`;
      })
      .join(",\n");

  return [
    "return items.map((item) => ({",
    "  json: {",
    "    ...item.json,",
    entries ||
      "    extracted_value: item.json.extracted_value ?? \"\"",
    "  }",
    "}));",
  ].join("\n");
}

function classificationCodeForInput(
  compactInput:
    CompactN8nGenerationInput,
): string {
  const targetKey =
    fieldKey(
      compactInput.classification_target ||
        "classification",
    );

  if (
    compactInput.domain ===
    "admissions"
  ) {
    return [
      "return items.map((item) => {",
      "  const requiredFields = [",
      ...compactInput.extracted_fields.map(
        (field) =>
          `    ${JSON.stringify(fieldKey(field))},`,
      ),
      "  ];",
      "",
      "  const missingFields = requiredFields.filter((field) => !String(item.json[field] || \"\").trim());",
      "  const priority = missingFields.length > 0 ? \"needs_manual_review\" : \"normal\";",
      "",
      "  return {",
      "    json: {",
      "      ...item.json,",
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
    "    ...item.json,",
    `    ${JSON.stringify(targetKey)}: item.json[${JSON.stringify(targetKey)}] || "needs_manual_review",`,
    "    classification_is_internal_only: true",
    "  }",
    "}));",
  ].join("\n");
}

function reviewCodeForInput(
  compactInput:
    CompactN8nGenerationInput,
): string {
  const reviewValues =
    safeReviewValues(
      compactInput,
    );

  const assignments =
    Object.entries(reviewValues)
      .map(
        ([key, value]) =>
          `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
      )
      .join(",\n");

  return [
    "return items.map((item) => ({",
    "  json: {",
    "    ...item.json,",
    assignments,
    "  }",
    "}));",
  ].join("\n");
}

function normalizeCodeNodeParameters(
  node: Record<string, unknown>,
  compactInput:
    CompactN8nGenerationInput,
): Record<string, unknown> {
  const parameters =
    isRecord(node.parameters)
      ? { ...node.parameters }
      : {};

  const nodeName =
    normalizeText(
      node.name,
    ).toLowerCase();

  if (
    typeof parameters.jsCode !==
      "string" &&
    typeof parameters.code ===
      "string"
  ) {
    parameters.jsCode =
      parameters.code;

    delete parameters.code;
  }

  if (
    nodeName.includes("sample")
  ) {
    parameters.jsCode =
      sampleCodeForInput(
        compactInput,
      );
  } else if (
    nodeName.includes("extract")
  ) {
    parameters.jsCode =
      extractionCodeForInput(
        compactInput,
      );
  } else if (
    nodeName.includes("classify") ||
    nodeName.includes(
      "categorize",
    ) ||
    nodeName.includes("triage")
  ) {
    parameters.jsCode =
      classificationCodeForInput(
        compactInput,
      );
  } else if (
    nodeName.includes("review") ||
    nodeName.includes("approval") ||
    nodeName.includes("pending")
  ) {
    parameters.jsCode =
      reviewCodeForInput(
        compactInput,
      );
  }

  return {
    ...node,
    parameters,
  };
}

function normalizeSetNodeParameters(
  node: Record<string, unknown>,
  compactInput:
    CompactN8nGenerationInput,
): Record<string, unknown> {
  const parameters =
    isRecord(node.parameters)
      ? { ...node.parameters }
      : {};

  const values =
    isRecord(parameters.values)
      ? { ...parameters.values }
      : {};

  const nodeName =
    normalizeText(
      node.name,
    ).toLowerCase();

  if (
    nodeName.includes("sample")
  ) {
    parameters.values = {
      ...values,
      ...samplePayloadForInput(
        compactInput,
      ),
    };
  } else if (
    nodeName.includes("extract")
  ) {
    const extracted:
      Record<string, unknown> = {};

    for (
      const field of
      compactInput.extracted_fields
    ) {
      const key = fieldKey(field);

      extracted[key] =
        `={{ $json.${key} }}`;
    }

    parameters.values = {
      ...values,
      ...extracted,
    };
  } else if (
    nodeName.includes("review") ||
    nodeName.includes("approval") ||
    nodeName.includes("pending")
  ) {
    parameters.values =
      safeReviewValues(
        compactInput,
        values,
      );
  } else {
    parameters.values = values;
  }

  return {
    ...node,
    parameters,
  };
}

function normalizeStickyNoteParameters(
  node: Record<string, unknown>,
  compactInput:
    CompactN8nGenerationInput,
): Record<string, unknown> {
  const parameters =
    isRecord(node.parameters)
      ? { ...node.parameters }
      : {};

  if (
    typeof parameters.content !==
      "string" &&
    typeof parameters.text !==
      "string" &&
    typeof parameters.note !==
      "string"
  ) {
    parameters.content = [
      `Source represented safely: ${compactInput.source}.`,
      `Human owner: ${compactInput.human_owner}.`,
      compactInput.approval_boundary,
      compactInput.external_action_boundary,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    ...node,
    parameters,
  };
}

function isUnsafeExternalNode(
  node: Record<string, unknown>,
): boolean {
  const type =
    normalizeText(
      node.type,
    ).toLowerCase();

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
  compactInput:
    CompactN8nGenerationInput,
): Record<string, unknown> {
  return {
    ...node,
    type: "n8n-nodes-base.set",
    disabled: true,
    notes:
      "Disabled safe-preview placeholder. No external action is executed.",
    parameters: {
      values:
        safeReviewValues(
          compactInput,
          {
            blocked_external_action:
              normalizeText(
                node.name,
              ) ||
              "external action",
            action_status:
              "blocked",
          },
        ),
      keepOnlySet: false,
    },
  };
}

export function normalizeGeneratedWorkflowNodeParameters(
  input: unknown,
  compactInput:
    CompactN8nGenerationInput,
): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes)
  ) {
    return input;
  }

  return {
    ...input,
    nodes: input.nodes.map(
      (node) => {
        if (!isRecord(node)) {
          return node;
        }

        if (
          isUnsafeExternalNode(node)
        ) {
          return normalizeUnsafeExternalNode(
            node,
            compactInput,
          );
        }

        if (
          node.type ===
          "n8n-nodes-base.code"
        ) {
          return normalizeCodeNodeParameters(
            node,
            compactInput,
          );
        }

        if (
          node.type ===
          "n8n-nodes-base.set"
        ) {
          return normalizeSetNodeParameters(
            node,
            compactInput,
          );
        }

        if (
          node.type ===
          "n8n-nodes-base.stickyNote"
        ) {
          return normalizeStickyNoteParameters(
            node,
            compactInput,
          );
        }

        return node;
      },
    ),
  };
}

function connectionTargetName(
  target: unknown,
): string | null {
  return (
    isRecord(target) &&
    typeof target.node ===
      "string" &&
    target.node.trim()
  )
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

      return group.filter(
        (target) => {
          const targetName =
            connectionTargetName(
              target,
            );

          return (
            !targetName ||
            !names.has(targetName)
          );
        },
      );
    })
    .filter(
      (group) =>
        !Array.isArray(group) ||
        group.length > 0,
    );
}

export function normalizeStickyNoteConnections(
  input: unknown,
): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes) ||
    !isRecord(input.connections)
  ) {
    return input;
  }

  const stickyNoteNames =
    new Set(
      input.nodes
        .filter(
          (node) =>
            isRecord(node) &&
            node.type ===
              "n8n-nodes-base.stickyNote" &&
            typeof node.name ===
              "string",
        )
        .map(
          (node) =>
            (node as Record<
              string,
              unknown
            >).name,
        )
        .filter(
          (name): name is string =>
            typeof name ===
              "string",
        ),
    );

  if (
    stickyNoteNames.size === 0
  ) {
    return input;
  }

  const connections:
    Record<string, unknown> = {};

  for (
    const [
      sourceName,
      nodeConnections,
    ] of Object.entries(
      input.connections,
    )
  ) {
    if (
      stickyNoteNames.has(
        sourceName,
      )
    ) {
      continue;
    }

    if (
      !isRecord(
        nodeConnections,
      )
    ) {
      connections[sourceName] =
        nodeConnections;

      continue;
    }

    const cleaned:
      Record<string, unknown> = {};

    for (
      const [
        connectionType,
        output,
      ] of Object.entries(
        nodeConnections,
      )
    ) {
      const normalized =
        removeNodeNamesFromOutput(
          output,
          stickyNoteNames,
        );

      if (
        !Array.isArray(
          normalized,
        ) ||
        normalized.length > 0
      ) {
        cleaned[connectionType] =
          normalized;
      }
    }

    if (
      Object.keys(cleaned).length >
      0
    ) {
      connections[sourceName] =
        cleaned;
    }
  }

  return {
    ...input,
    connections,
  };
}

function isReviewMarkerNode(
  node: unknown,
): node is Record<string, unknown> {
  if (!isRecord(node)) {
    return false;
  }

  const name =
    normalizeText(
      node.name,
    ).toLowerCase();

  return (
    (
      node.type ===
        "n8n-nodes-base.set" ||
      node.type ===
        "n8n-nodes-base.code"
    ) &&
    (
      name.includes("review") ||
      name.includes("approval") ||
      name.includes("pending")
    )
  );
}

export function normalizeDuplicateReviewSetNodes(
  input: unknown,
): unknown {
  if (
    !isRecord(input) ||
    !Array.isArray(input.nodes) ||
    !isRecord(input.connections)
  ) {
    return input;
  }

  const reviewNodes =
    input.nodes.filter(
      isReviewMarkerNode,
    );

  if (reviewNodes.length <= 1) {
    return input;
  }

  const preferred =
    reviewNodes.find((node) => {
      const name =
        normalizeText(
          node.name,
        ).toLowerCase();

      return (
        name.includes(
          "mark pending",
        ) ||
        name.includes(
          "prepare admissions",
        ) ||
        name.includes(
          "prepare review",
        )
      );
    }) ?? reviewNodes[0];

  const preferredName =
    normalizeText(
      preferred?.name,
    );

  const duplicateNames =
    new Set(
      reviewNodes
        .map((node) =>
          normalizeText(
            node.name,
          ),
        )
        .filter(
          (name) =>
            name &&
            name !==
              preferredName,
        ),
    );

  if (
    duplicateNames.size === 0
  ) {
    return input;
  }

  const nodes =
    input.nodes.filter(
      (node) =>
        !(
          isRecord(node) &&
          typeof node.name ===
            "string" &&
          duplicateNames.has(
            node.name,
          )
        ),
    );

  const connections:
    Record<string, unknown> = {};

  for (
    const [
      sourceName,
      nodeConnections,
    ] of Object.entries(
      input.connections,
    )
  ) {
    if (
      duplicateNames.has(
        sourceName,
      )
    ) {
      continue;
    }

    if (
      !isRecord(
        nodeConnections,
      )
    ) {
      connections[sourceName] =
        nodeConnections;

      continue;
    }

    const cleaned:
      Record<string, unknown> = {};

    for (
      const [
        connectionType,
        output,
      ] of Object.entries(
        nodeConnections,
      )
    ) {
      const normalized =
        removeNodeNamesFromOutput(
          output,
          duplicateNames,
        );

      if (
        !Array.isArray(
          normalized,
        ) ||
        normalized.length > 0
      ) {
        cleaned[connectionType] =
          normalized;
      }
    }

    if (
      Object.keys(cleaned).length >
      0
    ) {
      connections[sourceName] =
        cleaned;
    }
  }

  return {
    ...input,
    nodes,
    connections,
  };
}

function enforceCanonicalMetadata(
  input: unknown,
  compactInput:
    CompactN8nGenerationInput,
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const existingMeta =
    isRecord(input.meta)
      ? input.meta
      : {};

  return {
    ...input,
    active: false,
    meta: {
      ...existingMeta,
      flowforge_preview: true,
      domain:
        compactInput.domain,
      source:
        compactInput.source,
      source_type:
        compactInput.source_type,
      source_is_placeholder:
        true,
      human_owner:
        compactInput.human_owner,
      approval_boundary:
        compactInput.approval_boundary,
      external_action_boundary:
        compactInput.external_action_boundary,
      safety_status:
        compactInput.safety_status,
    },
  };
}

function workflowWarnings(
  workflow: N8nWorkflow,
): string[] {
  const disabledNodes =
    workflow.nodes.filter(
      (node) =>
        node.disabled === true,
    );

  const warnings = [
    "Draft only. Review before importing. Credentials are placeholders. Production side effects remain disabled.",
  ];

  if (
    disabledNodes.length > 0
  ) {
    warnings.push(
      `${disabledNodes.length} external or side-effect placeholder node(s) are disabled in the draft.`,
    );
  }

  return warnings;
}

function providerConfigured(
  provider: N8nAiProvider,
): boolean {
  if (provider === "openai") {
    return Boolean(
      process.env.OPENAI_API_KEY,
    );
  }

  /*
   * n8n generation must use its dedicated Groq account.
   * Do not silently use the general GROQ_API_KEY.
   */
  return Boolean(
    process.env.GROQ_N8N_API_KEY,
  );
}

async function callN8nProvider(
  provider: N8nAiProvider,
  prompt: string,
  dependencies?:
    N8nWorkflowGeneratorDependencies,
): Promise<string> {
  const injectedCall =
    dependencies?.calls?.[provider];

  if (injectedCall) {
    return injectedCall(prompt);
  }

  if (provider === "openai") {
    return callOpenAIAgent(
      prompt,
      n8nWorkflowGeneratorSystemPrompt,
      {
        modelEnv:
          "OPENAI_N8N_MODEL",

        fallbackModelEnv:
          "OPENAI_AGENT_MODEL",

        maxOutputTokensEnv:
          "OPENAI_N8N_MAX_OUTPUT_TOKENS",

        fallbackMaxOutputTokensEnv:
          "OPENAI_AGENT_MAX_OUTPUT_TOKENS",

        defaultMaxOutputTokens: 4500,
        maxOutputTokensCap: 6000,

        timeoutEnv:
          "OPENAI_N8N_TIMEOUT_MS",

        reasoningEffort: "minimal",
        verbosity: "low",
        structuredOutputMode: "none",
        fetchImpl:
          dependencies?.openaiFetch,
      },
    );
  }

  return callGroq(
    prompt,
    n8nWorkflowGeneratorSystemPrompt,
    {
      /*
       * Always use the dedicated n8n Groq key.
       */
      apiKeyEnv:
        "GROQ_N8N_API_KEY",

      modelEnv:
        "GROQ_N8N_MODEL",

      maxTokensEnv:
        "GROQ_N8N_MAX_TOKENS",

      defaultMaxTokens: 4096,
      maxTokensCap: 6000,
      timeoutMs: 45000,

      truncationSuggestion:
        "Raise GROQ_N8N_MAX_TOKENS to 4096 or 5000.",

      jsonMode: false,
    },
  );
}

function summarizeProviderError(
  error: unknown,
): string {
  if (error instanceof OpenAIAPIError) {
    return error.message
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  if (error instanceof Error) {
    return error.message
      .replace(
        /\s*\|?\s*Response body:[\s\S]*/i,
        "",
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }

  return String(
    error ??
      "Unknown provider error.",
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function normalizeAndValidateGeneratedWorkflow(
  rawResponse: string,
  compactInput:
    CompactN8nGenerationInput,
): N8nWorkflow {
  const parsed =
    parseStrictJson(rawResponse);

  const named =
    normalizeGeneratedWorkflowName(
      parsed,
      compactInput.workflow_name,
    );

  const inactive =
    normalizeGeneratedWorkflowActiveFlag(
      named,
    );

  const normalizedIds =
    normalizeGeneratedWorkflowIds(
      inactive,
    );

  const normalizedConnections =
    normalizeGeneratedWorkflowConnections(
      normalizedIds,
    );

  const normalizedParameters =
    normalizeGeneratedWorkflowNodeParameters(
      normalizedConnections,
      compactInput,
    );

  const normalizedStickyNotes =
    normalizeStickyNoteConnections(
      normalizedParameters,
    );

  const normalizedDuplicates =
    normalizeDuplicateReviewSetNodes(
      normalizedStickyNotes,
    );

  const normalizedPositions =
    normalizeGeneratedWorkflowNodePositions(
      normalizedDuplicates,
    );

  const normalized =
    enforceCanonicalMetadata(
      normalizedPositions,
      compactInput,
    );

  const validation =
    n8nWorkflowSchema.safeParse(
      normalized,
    );

  if (!validation.success) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge safety validation.",
      formatIssues(
        validation.error.issues,
      ),
    );
  }

  return validation.data;
}

export async function runN8nWorkflowGeneratorAgent(
  input: {
    compileJob: CompileJob;
  },
  dependencies?:
    N8nWorkflowGeneratorDependencies,
): Promise<N8nGenerateResponse> {
  /*
   * Provider order is intentional:
   *
   * 1. OpenAI
   * 2. Dedicated n8n Groq account
   */
  const providers:
    readonly N8nAiProvider[] = [
      "openai",
      "groq",
    ];

  const compactInput =
    buildCompactN8nGenerationInput(
      input.compileJob,
    );

  const prompt =
    buildN8nWorkflowGeneratorUserPrompt(
      compactInput,
    );

  const providerAttempts:
    ProviderAttempt[] = [];

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

    try {
      const rawResponse =
        await callN8nProvider(
          provider,
          prompt,
          dependencies,
        );

      const workflow =
        normalizeAndValidateGeneratedWorkflow(
          rawResponse,
          compactInput,
        );

      /*
       * A provider is a fallback only when an earlier provider
       * was actually attempted and failed.
       *
       * A provider that was merely unconfigured does not count
       * as a runtime fallback.
       */
      const fallbackUsed =
        providerAttempts.some(
          (attempt) =>
            attempt.attempted &&
            !attempt.success,
        );

      providerAttempts.push({
        provider,
        attempted: true,
        success: true,
      });

      return {
        workflow_json: workflow,

        warnings:
          workflowWarnings(
            workflow,
          ),

        provider,

        used_ai: true,

        fallback_used:
          fallbackUsed,

        provider_attempts:
          providerAttempts,
      };
    } catch (error) {
      providerAttempts.push({
        provider,
        attempted: true,
        success: false,
        error_summary:
          summarizeProviderError(
            error,
          ),
      });
    }
  }

  /*
   * Do not replace the detailed provider history with a generic
   * rate-limit exception. The API/UI needs these fields to show
   * what happened to OpenAI and Groq separately.
   */
  if (
    !providerAttempts.some(
      (attempt) => attempt.attempted,
    )
  ) {
    throw new N8nWorkflowGeneratorConfigError(
      providerAttempts,
    );
  }

  throw new N8nWorkflowGeneratorProvidersFailedError(
    providerAttempts,
  );
}
