import type { CompactN8nGenerationInput } from "../../shared/types/n8nWorkflow";
import type {
  N8nNodeSelection,
  N8nNodeSelectionIssue,
  SelectedN8nNode,
} from "../../shared/types/n8nNodeSelection";
import {
  getN8nNodeByKey,
  isKnownN8nNodeKey,
  N8N_NODE_CATALOG,
} from "../catalogs/n8nNodeCatalog";
import {
  buildN8nNodeSelectorUserPrompt,
  n8nNodeSelectorSystemPrompt,
} from "../prompts/n8nNodeSelectorPrompt";

export type N8nNodeSelectorProvider =
  | "openai"
  | "groq"
  | "unknown";

export type N8nNodeSelectorCall = (
  prompt: string,
  systemPrompt: string,
) => Promise<string>;

export class N8nNodeSelectionError extends Error {
  issues: N8nNodeSelectionIssue[];

  constructor(
    message: string,
    issues: N8nNodeSelectionIssue[],
  ) {
    super(message);
    this.name = "N8nNodeSelectionError";
    this.issues = issues;
  }
}

function isDebugEnabled(): boolean {
  return process.env.N8N_SELECTOR_DEBUG === "true";
}

function debugLog(
  provider: N8nNodeSelectorProvider,
  message: string,
  value?: unknown,
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const prefix = `[n8n selector:${provider}]`;

  if (value === undefined) {
    console.log(prefix, message);
    return;
  }

  console.log(prefix, message, value);
}

function debugError(
  provider: N8nNodeSelectorProvider,
  message: string,
  value?: unknown,
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const prefix = `[n8n selector:${provider}]`;

  if (value === undefined) {
    console.error(prefix, message);
    return;
  }

  console.error(prefix, message, value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();

  const match = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  );

  return match?.[1]?.trim() ?? trimmed;
}

function parseSelectionJson(raw: string): unknown {
  const cleaned = stripJsonFence(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new N8nNodeSelectionError(
      "Node selector returned invalid JSON.",
      [
        {
          path: "(root)",
          message:
            "The selector must return one valid JSON object.",
          code: "invalid_json",
        },
      ],
    );
  }
}

function normalizeStepIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (item): item is number =>
          typeof item === "number"
          && Number.isInteger(item)
          && item > 0,
      ),
    ),
  ];
}

function normalizeNodeName(
  value: unknown,
  nodeKey: string,
): string {
  if (
    typeof value === "string"
    && value.trim()
  ) {
    return value.trim().slice(0, 100);
  }

  return (
    getN8nNodeByKey(nodeKey)?.displayName
    ?? nodeKey
  );
}

/**
 * Resolve exact catalog keys and case-only differences.
 *
 * Accepted:
 * - "asana" -> "asana"
 * - "Asana" -> "asana"
 * - "Notion" -> "notion"
 *
 * Rejected:
 * - "asena"
 * - "emailTrigger"
 * - "ai-informationExtractor"
 */
function resolveKnownNodeKey(
  value: string,
): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  // Calculate before the type-guard call.
  // Otherwise TypeScript may narrow `trimmed` to `never`.
  const lowerCaseValue =
    trimmed.toLowerCase();

  if (isKnownN8nNodeKey(trimmed)) {
    return trimmed;
  }

  const caseInsensitiveMatch =
    N8N_NODE_CATALOG.find(
      (entry) =>
        entry.key.toLowerCase()
        === lowerCaseValue,
    );

  return caseInsensitiveMatch?.key ?? null;
}

/**
 * Determines whether the workflow clearly starts from an
 * external event rather than from a person clicking "Execute".
 *
 * This intentionally uses strong signals only. When the trigger
 * remains genuinely unclear, manualTrigger is still allowed.
 */
function isClearlyEventDriven(
  brief: CompactN8nGenerationInput,
): boolean {
  const source = normalizeText(brief.source);

  const triggerDescription = normalizeText(
    brief.trigger_description,
  );

  const originalRequest = normalizeText(
    brief.original_request,
  );

  const context =
    `${source} ${triggerDescription} ${originalRequest}`;

  if (
    source.includes("event source")
    || source.includes("webhook")
  ) {
    return true;
  }

  if (
    /^(when|whenever|once)\b/.test(
      triggerDescription,
    )
  ) {
    return true;
  }

  const eventPatterns: RegExp[] = [
    /\bwhen\s+.+\s+drops?\s+below\b/,
    /\bwhen\s+.+\s+rises?\s+above\b/,
    /\bwhen\s+.+\s+falls?\s+below\b/,
    /\bwhen\s+.+\s+changes?\b/,
    /\bwhen\s+.+\s+is\s+created\b/,
    /\bwhen\s+.+\s+is\s+updated\b/,
    /\bwhen\s+.+\s+is\s+submitted\b/,
    /\bwhen\s+.+\s+is\s+received\b/,
    /\bwhen\s+.+\s+arrives?\b/,
    /\bwhenever\s+.+\b/,
    /\bon\s+.+\s+event\b/,
    /\btriggered\s+by\s+.+\b/,
    /\bwebhook\b/,
  ];

  return eventPatterns.some((pattern) =>
    pattern.test(context)
  );
}

function validateTriggerSemantics(input: {
  brief: CompactN8nGenerationInput;
  nodes: SelectedN8nNode[];
  issues: N8nNodeSelectionIssue[];
}): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  if (!isClearlyEventDriven(brief)) {
    return;
  }

  const manualTriggerIndex =
    nodes.findIndex(
      (node) =>
        node.nodeKey === "manualTrigger",
    );

  if (manualTriggerIndex === -1) {
    return;
  }

  issues.push({
    path: `nodes.${manualTriggerIndex}.nodeKey`,
    message:
      'manualTrigger is not valid for this clearly event-driven workflow. Select an event-compatible trigger from the catalog, normally "webhook" when the concrete source integration is not specified.',
    code: "invalid_type",
  });
}

function validateAndNormalizeSelection(
  input: unknown,
  fallbackWorkflowName: string,
  brief: CompactN8nGenerationInput,
): N8nNodeSelection {
  const issues: N8nNodeSelectionIssue[] = [];

  if (!isRecord(input)) {
    throw new N8nNodeSelectionError(
      "Node selector returned an invalid result.",
      [
        {
          path: "(root)",
          message: "Expected a JSON object.",
          code: "invalid_type",
        },
      ],
    );
  }

  const rawNodes = Array.isArray(input.nodes)
    ? input.nodes
    : [];

  if (rawNodes.length === 0) {
    issues.push({
      path: "nodes",
      message:
        "At least one selected node is required.",
      code: "too_small",
    });
  }

  const nodes: SelectedN8nNode[] = [];

  rawNodes.forEach((rawNode, index) => {
    const path = `nodes.${index}`;

    if (!isRecord(rawNode)) {
      issues.push({
        path,
        message:
          "Expected a node selection object.",
        code: "invalid_type",
      });

      return;
    }

    const rawNodeKey =
      typeof rawNode.nodeKey === "string"
        ? rawNode.nodeKey.trim()
        : "";

    const nodeKey =
      resolveKnownNodeKey(rawNodeKey);

    if (!nodeKey) {
      issues.push({
        path: `${path}.nodeKey`,
        message:
          `Unknown catalog node key: ${
            rawNodeKey || "(empty)"
          }.`,
        code: "unknown_node_key",
      });

      return;
    }

    nodes.push({
      stepIds: normalizeStepIds(
        rawNode.stepIds,
      ),
      nodeKey,
      name: normalizeNodeName(
        rawNode.name,
        nodeKey,
      ),
      ...(typeof rawNode.reason === "string"
      && rawNode.reason.trim()
        ? {
            reason: rawNode.reason
              .trim()
              .slice(0, 240),
          }
        : {}),
    });
  });

  const mainTriggers = nodes.filter(
    (node) =>
      getN8nNodeByKey(node.nodeKey)
        ?.group === "trigger",
  );

  if (mainTriggers.length > 1) {
    issues.push({
      path: "nodes",
      message:
        "The selected main workflow contains more than one trigger. Choose one main trigger.",
      code: "multiple_triggers",
    });
  }

  for (
    let index = 1;
    index < nodes.length;
    index += 1
  ) {
    const previous = getN8nNodeByKey(
      nodes[index - 1]!.nodeKey,
    );

    const current = getN8nNodeByKey(
      nodes[index]!.nodeKey,
    );

    if (
      previous?.group === "trigger"
      && current?.group === "trigger"
    ) {
      issues.push({
        path: `nodes.${index}`,
        message:
          "A trigger cannot follow another trigger in the main path.",
        code: "trigger_after_trigger",
      });
    }
  }

  validateTriggerSemantics({
    brief,
    nodes,
    issues,
  });

  if (issues.length > 0) {
    throw new N8nNodeSelectionError(
      "Node selector returned an invalid architecture.",
      issues,
    );
  }

  const workflowName =
    typeof input.workflowName === "string"
    && input.workflowName.trim()
      ? input.workflowName
          .trim()
          .slice(0, 120)
      : fallbackWorkflowName;

  return {
    workflowName,
    nodes,
  };
}

function formatRepairIssues(
  issues: N8nNodeSelectionIssue[],
): string {
  return issues
    .map(
      (issue) =>
        `- ${issue.path}: ${issue.message}`,
    )
    .join("\n");
}

function buildRepairPrompt(input: {
  originalPrompt: string;
  rawResponse: string;
  issues: N8nNodeSelectionIssue[];
}): string {
  return `
Your previous node-selection response failed validation.

Validation errors:
${formatRepairIssues(input.issues)}

Previous invalid response:
${input.rawResponse}

Repair instructions:
- Return the complete corrected JSON object.
- Use only exact, case-sensitive nodeKey values from the catalog in the original request.
- Copy catalog keys exactly.
- Do not invent node keys.
- Do not use display names as nodeKey values.
- Do not add prefixes or suffixes to node keys.
- Correct every listed validation error.
- Correct only what is necessary.
- Preserve valid node selections unless they must change to fix validation.
- When manualTrigger is rejected because the workflow is event-driven, select an event-compatible trigger.
- When the external event source is not a named catalog integration, normally use the exact catalog key "webhook".
- Return JSON only.
- Do not include markdown fences.
- Do not include explanations.

Original node-selection request:
${input.originalPrompt}
`.trim();
}

function shouldRepairWithOpenAI(
  provider: N8nNodeSelectorProvider,
  error: unknown,
): error is N8nNodeSelectionError {
  return (
    provider === "openai"
    && error instanceof N8nNodeSelectionError
  );
}

function parseAndValidateSelection(input: {
  raw: string;
  fallbackWorkflowName: string;
  provider: N8nNodeSelectorProvider;
  stage: "initial" | "repair";
  brief: CompactN8nGenerationInput;
}): N8nNodeSelection {
  const {
    raw,
    fallbackWorkflowName,
    provider,
    stage,
    brief,
  } = input;

  let parsed: unknown;

  try {
    parsed = parseSelectionJson(raw);
  } catch (error) {
    debugError(
      provider,
      `${stage} JSON parsing failed`,
      {
        rawResponse: raw,
        error:
          error instanceof Error
            ? error.message
            : String(error),
        issues:
          error instanceof N8nNodeSelectionError
            ? error.issues
            : [],
      },
    );

    throw error;
  }

  debugLog(
    provider,
    `${stage} parsed model response`,
    safeJsonStringify(parsed),
  );

  try {
    const selection =
      validateAndNormalizeSelection(
        parsed,
        fallbackWorkflowName,
        brief,
      );

    debugLog(
      provider,
      `${stage} validated node selection`,
      safeJsonStringify(selection),
    );

    return selection;
  } catch (error) {
    debugError(
      provider,
      `${stage} architecture validation failed`,
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
        issues:
          error instanceof N8nNodeSelectionError
            ? error.issues
            : [],
        parsedResponse: parsed,
        rawResponse: raw,
      },
    );

    throw error;
  }
}

export async function selectN8nNodes(
  brief: CompactN8nGenerationInput,
  callModel: N8nNodeSelectorCall,
  provider: N8nNodeSelectorProvider =
    "unknown",
): Promise<N8nNodeSelection> {
  const prompt =
    buildN8nNodeSelectorUserPrompt({
      brief,
    });

  const fallbackWorkflowName =
    brief.workflow_name
    || "Generated n8n Workflow";

  debugLog(provider, "request started", {
    workflowName: brief.workflow_name,
    originalRequest:
      brief.original_request,
    triggerDescription:
      brief.trigger_description,
    source: brief.source,
    clearlyEventDriven:
      isClearlyEventDriven(brief),
    promptLength: prompt.length,
    systemPromptLength:
      n8nNodeSelectorSystemPrompt.length,
  });

  let initialRaw: string;

  try {
    initialRaw = await callModel(
      prompt,
      n8nNodeSelectorSystemPrompt,
    );
  } catch (error) {
    debugError(
      provider,
      "provider request failed",
      {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );

    throw error;
  }

  debugLog(
    provider,
    "raw model response",
    initialRaw,
  );

  try {
    return parseAndValidateSelection({
      raw: initialRaw,
      fallbackWorkflowName,
      provider,
      stage: "initial",
      brief,
    });
  } catch (initialError) {
    if (
      !shouldRepairWithOpenAI(
        provider,
        initialError,
      )
    ) {
      throw initialError;
    }

    debugLog(
      provider,
      "starting one repair attempt",
      {
        issues: initialError.issues,
      },
    );

    const repairPrompt =
      buildRepairPrompt({
        originalPrompt: prompt,
        rawResponse: initialRaw,
        issues: initialError.issues,
      });

    debugLog(
      provider,
      "repair request prepared",
      {
        repairPromptLength:
          repairPrompt.length,
        issueCount:
          initialError.issues.length,
      },
    );

    let repairedRaw: string;

    try {
      repairedRaw = await callModel(
        repairPrompt,
        n8nNodeSelectorSystemPrompt,
      );
    } catch (repairCallError) {
      debugError(
        provider,
        "repair provider request failed",
        {
          error:
            repairCallError instanceof Error
              ? repairCallError.message
              : String(repairCallError),
        },
      );

      throw initialError;
    }

    debugLog(
      provider,
      "repair raw model response",
      repairedRaw,
    );

    try {
      return parseAndValidateSelection({
        raw: repairedRaw,
        fallbackWorkflowName,
        provider,
        stage: "repair",
        brief,
      });
    } catch (repairValidationError) {
      debugError(
        provider,
        "repair attempt failed; provider fallback will continue",
        {
          originalIssues:
            initialError.issues,
          repairIssues:
            repairValidationError
              instanceof N8nNodeSelectionError
              ? repairValidationError.issues
              : [],
        },
      );

      throw repairValidationError;
    }
  }
}