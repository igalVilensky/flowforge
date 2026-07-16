import type {
  CompactN8nGenerationInput,
} from "../../shared/types/n8nWorkflow";
import type {
  N8nConditionalBranch,
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

export class N8nNodeSelectionError
  extends Error {
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
  return (
    process.env.N8N_SELECTOR_DEBUG
    === "true"
  );
}

function debugLog(
  provider: N8nNodeSelectorProvider,
  message: string,
  value?: unknown,
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const prefix =
    `[n8n selector:${provider}]`;

  if (value === undefined) {
    console.log(prefix, message);
    return;
  }

  console.log(
    prefix,
    message,
    value,
  );
}

function debugError(
  provider: N8nNodeSelectorProvider,
  message: string,
  value?: unknown,
): void {
  if (!isDebugEnabled()) {
    return;
  }

  const prefix =
    `[n8n selector:${provider}]`;

  if (value === undefined) {
    console.error(prefix, message);
    return;
  }

  console.error(
    prefix,
    message,
    value,
  );
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

function normalizeText(
  value: unknown,
): string {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function stripJsonFence(
  value: string,
): string {
  const trimmed = value.trim();

  const match = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  );

  return (
    match?.[1]?.trim()
    ?? trimmed
  );
}

function parseSelectionJson(
  raw: string,
): unknown {
  const cleaned =
    stripJsonFence(raw);

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

function normalizeStepIds(
  value: unknown,
): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value.filter(
        (
          item,
        ): item is number =>
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
    return value
      .trim()
      .slice(0, 100);
  }

  return (
    getN8nNodeByKey(
      nodeKey,
    )?.displayName
    ?? nodeKey
  );
}

function normalizeReason(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "string"
    || !value.trim()
  ) {
    return undefined;
  }

  return value
    .trim()
    .slice(0, 240);
}

function normalizeConditionalBranch(
  value: unknown,
): N8nConditionalBranch
  | undefined {
  const normalized =
    normalizeText(value);

  if (normalized === "true") {
    return "true";
  }

  if (normalized === "false") {
    return "false";
  }

  return undefined;
}

function isConditionalNodeKey(
  nodeKey: string,
): boolean {
  return (
    nodeKey === "if"
    || nodeKey === "switch"
    || nodeKey === "filter"
  );
}

/**
 * Resolve exact catalog keys and case-only differences.
 *
 * The lowercase value must be calculated before calling
 * isKnownN8nNodeKey(). Otherwise TypeScript can narrow the
 * false branch and incorrectly treat `trimmed` as `never`.
 */
function resolveKnownNodeKey(
  value: string,
): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

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

  return (
    caseInsensitiveMatch?.key
    ?? null
  );
}

function deriveWorkflowName(
  brief: CompactN8nGenerationInput,
): string {
  const request =
    normalizeText(
      brief.original_request,
    );

  if (
    request.includes("invoice")
    && (
      request.includes(
        "purchase order",
      )
      || request.includes(
        "goods receipt",
      )
      || request.includes("match")
      || request.includes("compare")
    )
  ) {
    return (
      "Invoice Matching and Review Workflow"
    );
  }

  if (
    request.includes("content")
    && request.includes("gap")
  ) {
    return (
      "Content Gap Review Workflow"
    );
  }

  if (
    request.includes("low stock")
    || request.includes(
      "replenishment",
    )
  ) {
    return (
      "Low Stock Replenishment Workflow"
    );
  }

  if (
    request.includes("candidate")
    || request.includes(
      "job application",
    )
  ) {
    return (
      "Job Application Review Workflow"
    );
  }

  const briefName =
    typeof brief.workflow_name
      === "string"
      ? brief.workflow_name.trim()
      : "";

  if (briefName) {
    return briefName.slice(
      0,
      120,
    );
  }

  return "Generated n8n Workflow";
}

/**
 * Only original_request is trusted when deciding whether a
 * domain term belongs in the workflow title.
 *
 * Safety and deterministic fallback text may contain terms such
 * as "refund" even when the user never requested a refund.
 */
function workflowNameContainsUnrelatedTerm(
  workflowName: string,
  brief: CompactN8nGenerationInput,
): boolean {
  const normalizedName =
    normalizeText(workflowName);

  const originalRequest =
    normalizeText(
      brief.original_request,
    );

  const guardedTerms = [
    "refund",
    "replenishment",
    "low stock",
    "candidate",
    "admissions",
    "invoice",
    "content gap",
  ];

  return guardedTerms.some(
    (term) =>
      normalizedName.includes(term)
      && !originalRequest.includes(term),
  );
}

function normalizeWorkflowName(
  value: unknown,
  brief: CompactN8nGenerationInput,
): string {
  const candidate =
    typeof value === "string"
    && value.trim()
      ? value
          .trim()
          .slice(0, 120)
      : "";

  if (
    !candidate
    || workflowNameContainsUnrelatedTerm(
      candidate,
      brief,
    )
  ) {
    return deriveWorkflowName(
      brief,
    );
  }

  return candidate;
}

function normalizeSelection(
  parsed: unknown,
  brief: CompactN8nGenerationInput,
): N8nNodeSelection {
  if (!isRecord(parsed)) {
    throw new N8nNodeSelectionError(
      "Node selector returned an invalid selection.",
      [
        {
          path: "(root)",
          message:
            "The result must be a JSON object.",
          code:
            "invalid_selection",
        },
      ],
    );
  }

  if (!Array.isArray(parsed.nodes)) {
    throw new N8nNodeSelectionError(
      "Node selector returned no node array.",
      [
        {
          path: "nodes",
          message:
            "nodes must be an array.",
          code: "invalid_nodes",
        },
      ],
    );
  }

  const issues:
    N8nNodeSelectionIssue[] = [];

  const workflowName =
    normalizeWorkflowName(
      parsed.workflowName,
      brief,
    );

  const nodes:
    SelectedN8nNode[] = [];

  parsed.nodes.forEach(
    (rawNode, index) => {
      if (!isRecord(rawNode)) {
        issues.push({
          path: `nodes.${index}`,
          message:
            "Each selected node must be an object.",
          code: "invalid_node",
        });

        return;
      }

      const rawKey =
        typeof rawNode.nodeKey
          === "string"
          ? rawNode.nodeKey
          : "";

      const nodeKey =
        resolveKnownNodeKey(
          rawKey,
        );

      if (!nodeKey) {
        issues.push({
          path:
            `nodes.${index}.nodeKey`,
          message:
            `Unknown catalog node key "${rawKey}".`,
          code:
            "unknown_node_key",
        });

        return;
      }

      /*
       * Conditional nodes create branches and cannot belong to
       * one of their own outputs. Remove harmless model mistakes
       * such as branch: "true" on an If node.
       */
      const branch =
        isConditionalNodeKey(
          nodeKey,
        )
          ? undefined
          : normalizeConditionalBranch(
              rawNode.branch,
            );

      nodes.push({
        stepIds:
          normalizeStepIds(
            rawNode.stepIds,
          ),
        nodeKey,
        name:
          normalizeNodeName(
            rawNode.name,
            nodeKey,
          ),
        reason:
          normalizeReason(
            rawNode.reason,
          ),
        branch,
      });
    },
  );

  if (issues.length > 0) {
    throw new N8nNodeSelectionError(
      "Node selector result failed normalization.",
      issues,
    );
  }

  return {
    workflowName,
    nodes,
  };
}

function triggerContext(
  brief: CompactN8nGenerationInput,
): string {
  return normalizeText(
    [
      brief.trigger_description,
      brief.source,
    ].join(" "),
  );
}

function isClearlyEventDriven(
  brief: CompactN8nGenerationInput,
): boolean {
  const source =
    normalizeText(
      brief.source,
    );

  const triggerDescription =
    normalizeText(
      brief.trigger_description,
    );

  const originalRequest =
    normalizeText(
      brief.original_request,
    );

  const context = [
    source,
    triggerDescription,
    originalRequest,
  ].join(" ");

  if (
    source.includes(
      "event source",
    )
    || source.includes("webhook")
  ) {
    return true;
  }

  if (
    /^(when|whenever|once|after)\b/.test(
      triggerDescription,
    )
  ) {
    return true;
  }

  const eventPatterns:
    RegExp[] = [
      /\bwhen\s+.+\s+drops?\s+below\b/,
      /\bwhen\s+.+\s+falls?\s+below\b/,
      /\bwhen\s+.+\s+rises?\s+above\b/,
      /\bwhen\s+.+\s+exceeds?\b/,
      /\bwhen\s+.+\s+reaches?\b/,
      /\bwhen\s+.+\s+changes?\b/,
      /\bwhen\s+.+\s+becomes?\b/,
      /\bwhen\s+.+\s+is\s+created\b/,
      /\bwhen\s+.+\s+is\s+updated\b/,
      /\bwhen\s+.+\s+is\s+submitted\b/,
      /\bwhen\s+.+\s+is\s+received\b/,
      /\bwhen\s+.+\s+is\s+completed\b/,
      /\bwhen\s+.+\s+is\s+finished\b/,
      /\bwhen\s+.+\s+is\s+approved\b/,
      /\bwhen\s+.+\s+is\s+rejected\b/,
      /\bwhen\s+.+\s+is\s+closed\b/,
      /\bwhen\s+.+\s+is\s+opened\b/,
      /\bwhen\s+.+\s+is\s+published\b/,
      /\bwhen\s+.+\s+is\s+deleted\b/,
      /\bwhen\s+.+\s+is\s+archived\b/,
      /\bwhen\s+.+\s+is\s+assigned\b/,
      /\bwhen\s+.+\s+is\s+moved\b/,
      /\bwhen\s+.+\s+is\s+added\b/,
      /\bwhen\s+.+\s+is\s+removed\b/,
      /\bwhen\s+.+\s+completes?\b/,
      /\bwhen\s+.+\s+finishes?\b/,
      /\bwhen\s+.+\s+arrives?\b/,
      /\bwhen\s+.+\s+submits?\b/,
      /\bwhen\s+.+\s+publishes?\b/,
      /\bwhen\s+.+\s+fails?\b/,
      /\bwhenever\s+.+\b/,
      /\bon\s+.+\s+event\b/,
      /\btriggered\s+by\s+.+\b/,
      /\bafter\s+.+\s+is\s+completed\b/,
      /\bafter\s+.+\s+is\s+finished\b/,
      /\bafter\s+.+\s+is\s+approved\b/,
      /\bwebhook\b/,
    ];

  return eventPatterns.some(
    (pattern) =>
      pattern.test(context),
  );
}

function isExplicitGmailTrigger(
  brief: CompactN8nGenerationInput,
): boolean {
  const context =
    triggerContext(brief);

  return (
    context.includes("gmail")
    || /\bgmail\s+(?:message|email|event|inbox)\b/.test(
      context,
    )
  );
}

function isExplicitOutlookTrigger(
  brief: CompactN8nGenerationInput,
): boolean {
  const context =
    triggerContext(brief);

  return (
    context.includes("outlook")
    || context.includes(
      "microsoft 365",
    )
    || /\boutlook\s+(?:message|email|event|inbox)\b/.test(
      context,
    )
  );
}

function isExplicitChatTrigger(
  brief: CompactN8nGenerationInput,
): boolean {
  const context =
    triggerContext(brief);

  return (
    context.includes("n8n chat")
    || context.includes(
      "chat message",
    )
    || context.includes(
      "chat trigger",
    )
  );
}

function isExplicitScheduledTrigger(
  brief: CompactN8nGenerationInput,
): boolean {
  const context =
    normalizeText(
      [
        brief.trigger_description,
        brief.source,
        brief.original_request,
      ].join(" "),
    );

  return (
    context.includes("schedule")
    || context.includes(
      "scheduled",
    )
    || context.includes(
      "every morning",
    )
    || context.includes(
      "each morning",
    )
    || context.includes(
      "every day",
    )
    || context.includes("daily")
    || context.includes(
      "every weekday",
    )
    || context.includes("weekly")
    || context.includes("monthly")
    || context.includes(
      "every quarter",
    )
    || context.includes(
      "quarterly",
    )
  );
}

function findTriggerIndexes(
  nodes: SelectedN8nNode[],
): number[] {
  return nodes
    .map(
      (node, index) => ({
        index,
        entry:
          getN8nNodeByKey(
            node.nodeKey,
          ),
      }),
    )
    .filter(
      ({ entry }) =>
        entry?.group
        === "trigger",
    )
    .map(
      ({ index }) => index,
    );
}

/**
 * This generator currently builds one connected n8n workflow.
 *
 * If the model returns multiple independent triggers, preserve
 * the first workflow and remove the secondary trigger together
 * with every node after it.
 */
function keepPrimaryWorkflowOnly(
  selection: N8nNodeSelection,
): N8nNodeSelection {
  const triggerIndexes =
    findTriggerIndexes(
      selection.nodes,
    );

  if (triggerIndexes.length <= 1) {
    return selection;
  }

  const secondaryTriggerIndex =
    triggerIndexes[1];

  if (
    secondaryTriggerIndex
    === undefined
  ) {
    return selection;
  }

  return {
    ...selection,
    nodes: selection.nodes.slice(
      0,
      secondaryTriggerIndex,
    ),
  };
}

function validateTriggerSemantics(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  const triggerIndexes =
    findTriggerIndexes(nodes);

  if (
    triggerIndexes.length === 0
  ) {
    issues.push({
      path: "nodes",
      message:
        "The workflow must contain one trigger.",
      code: "missing_trigger",
    });

    return;
  }

  if (
    triggerIndexes.length > 1
  ) {
    issues.push({
      path: "nodes",
      message:
        "The workflow must contain exactly one main trigger.",
      code:
        "multiple_triggers",
    });

    return;
  }

  const triggerIndex =
    triggerIndexes[0];

  if (
    triggerIndex === undefined
  ) {
    return;
  }

  const triggerNode =
    nodes[triggerIndex];

  if (!triggerNode) {
    return;
  }

  if (
    isClearlyEventDriven(brief)
    && triggerNode.nodeKey
      === "manualTrigger"
  ) {
    issues.push({
      path:
        `nodes.${triggerIndex}.nodeKey`,
      message:
        'manualTrigger is invalid for this event-driven workflow. Use "webhook" when the concrete event source is unspecified.',
      code:
        "invalid_trigger_source",
    });
  }

  if (
    triggerNode.nodeKey
      === "gmailTrigger"
    && !isExplicitGmailTrigger(
      brief,
    )
  ) {
    issues.push({
      path:
        `nodes.${triggerIndex}.nodeKey`,
      message:
        'gmailTrigger is invalid because Gmail is not explicitly the source. Do not infer Gmail from a generic inbox.',
      code:
        "invalid_trigger_source",
    });
  }

  if (
    triggerNode.nodeKey
      === "microsoftOutlookTrigger"
    && !isExplicitOutlookTrigger(
      brief,
    )
  ) {
    issues.push({
      path:
        `nodes.${triggerIndex}.nodeKey`,
      message:
        "microsoftOutlookTrigger is invalid because Outlook is not explicitly the source.",
      code:
        "invalid_trigger_source",
    });
  }

  if (
    triggerNode.nodeKey
      === "chatTrigger"
    && !isExplicitChatTrigger(
      brief,
    )
  ) {
    issues.push({
      path:
        `nodes.${triggerIndex}.nodeKey`,
      message:
        "chatTrigger is invalid because the workflow is not started by an n8n chat message.",
      code:
        "invalid_trigger_source",
    });
  }

  if (
    triggerNode.nodeKey
      === "scheduleTrigger"
    && !isExplicitScheduledTrigger(
      brief,
    )
  ) {
    issues.push({
      path:
        `nodes.${triggerIndex}.nodeKey`,
      message:
        "scheduleTrigger is invalid because the request does not describe a scheduled start.",
      code:
        "invalid_trigger_source",
    });
  }
}

function findNearestConditionIndex(
  nodes: SelectedN8nNode[],
  fromIndex: number,
): number {
  for (
    let index =
      fromIndex - 1;
    index >= 0;
    index -= 1
  ) {
    const node =
      nodes[index];

    if (
      node
      && isConditionalNodeKey(
        node.nodeKey,
      )
    ) {
      return index;
    }
  }

  return -1;
}

function requestHasConditionalActions(
  brief: CompactN8nGenerationInput,
): boolean {
  const request =
    normalizeText(
      brief.original_request,
    );

  return (
    /\bif\s+.+\s+(?:is|are)\s+(?:found|detected|identified)\b/.test(
      request,
    )
    || /\bif\s+(?:gaps?|issues?|errors?|matches?|records?|items?)\b/.test(
      request,
    )
    || /\bwhen\s+(?:gaps?|issues?|errors?)\s+(?:are\s+)?found\b/.test(
      request,
    )
    || request.includes("either")
    || request.includes(
      "otherwise",
    )
    || request.includes(
      "discrepancies",
    )
  );
}

function requestHasAlternativeOutcomes(
  brief: CompactN8nGenerationInput,
): boolean {
  const request =
    normalizeText(
      brief.original_request,
    );

  return (
    (
      request.includes("either")
      && request.includes(" or ")
    )
    || request.includes(
      "otherwise",
    )
    || request.includes("if not")
    || request.includes(
      "if unmatched",
    )
    || request.includes(
      "if discrepancies",
    )
    || request.includes(
      "when discrepancies",
    )
    || (
      request.includes(
        "matched invoices",
      )
      && request.includes(
        "discrepancies",
      )
    )
    || (
      request.includes("if ")
      && request.includes("else")
    )
  );
}

function validateConditionalOrdering(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  if (
    !requestHasConditionalActions(
      brief,
    )
  ) {
    return;
  }

  const conditionIndex =
    nodes.findIndex(
      (node) =>
        isConditionalNodeKey(
          node.nodeKey,
        ),
    );

  if (
    conditionIndex === -1
  ) {
    issues.push({
      path: "nodes",
      message:
        "The request contains conditional actions, but no If, Switch, or Filter node was selected.",
      code:
        "missing_condition_node",
    });

    return;
  }

  /*
   * Only branch-labelled nodes are guarded outcome actions.
   * Retrieval and comparison HTTP Request nodes are allowed
   * before the condition.
   */
  const guardedActionBeforeCondition =
    nodes.findIndex(
      (node, index) =>
        index < conditionIndex
        && node.branch !== undefined,
    );

  if (
    guardedActionBeforeCondition
    !== -1
  ) {
    issues.push({
      path:
        `nodes.${guardedActionBeforeCondition}`,
      message:
        "A branch action appears before its conditional node.",
      code:
        "branch_action_before_condition",
    });
  }
}

function validateConditionalBranches(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  nodes.forEach(
    (node, index) => {
      if (!node.branch) {
        return;
      }

      const conditionIndex =
        findNearestConditionIndex(
          nodes,
          index,
        );

      if (
        conditionIndex === -1
      ) {
        issues.push({
          path:
            `nodes.${index}.branch`,
          message:
            `Node "${node.name}" declares branch "${node.branch}" but no preceding conditional node exists.`,
          code:
            "branch_without_condition",
        });
      }
    },
  );

  if (
    !requestHasAlternativeOutcomes(
      brief,
    )
  ) {
    return;
  }

  const conditionIndex =
    nodes.findIndex(
      (node) =>
        isConditionalNodeKey(
          node.nodeKey,
        ),
    );

  if (
    conditionIndex === -1
  ) {
    issues.push({
      path: "nodes",
      message:
        "The original request contains alternative outcomes, but no conditional node was selected.",
      code:
        "missing_branch_condition",
    });

    return;
  }

  const nodesAfterCondition =
    nodes.slice(
      conditionIndex + 1,
    );

  const hasTrueBranch =
    nodesAfterCondition.some(
      (node) =>
        node.branch === "true",
    );

  const hasFalseBranch =
    nodesAfterCondition.some(
      (node) =>
        node.branch === "false",
    );

  if (
    !hasTrueBranch
    || !hasFalseBranch
  ) {
    issues.push({
      path:
        `nodes.${conditionIndex}`,
      message:
        'The request contains mutually exclusive outcomes. Add at least one node with branch "true" and one node with branch "false".',
      code:
        "missing_conditional_branches",
    });
  }
}

function requestRequiresComparison(
  brief: CompactN8nGenerationInput,
): boolean {
  const request =
    normalizeText(
      brief.original_request,
    );

  return (
    request.includes("compare")
    || request.includes(
      "matching",
    )
    || request.includes(
      "matched",
    )
    || request.includes(
      "reconcile",
    )
  );
}

function nodeLooksLikeExtraction(
  node: SelectedN8nNode,
): boolean {
  return (
    node.nodeKey
    === "informationExtractor"
  );
}

function nodeLooksLikeComparison(
  node: SelectedN8nNode,
): boolean {
  const text =
    normalizeText(
      [
        node.name,
        node.reason ?? "",
      ].join(" "),
    );

  const comparisonLanguage =
    text.includes("compare")
    || text.includes(
      "comparison",
    )
    || text.includes("match")
    || text.includes(
      "reconcile",
    )
    || text.includes(
      "validate against",
    );

  const retrievalLanguage =
    text.includes("retrieve")
    || text.includes("fetch")
    || text.includes("load")
    || text.includes(
      "look up",
    )
    || text.includes(
      "lookup",
    );

  const documentLanguage =
    text.includes(
      "purchase order",
    )
    || text.includes(" po ")
    || text.includes(
      "goods receipt",
    )
    || text.includes(" gr ")
    || text.includes("erp");

  return (
    (comparisonLanguage
      || retrievalLanguage)
    && documentLanguage
  );
}

function validateRequiredComparison(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  if (
    !requestRequiresComparison(
      brief,
    )
  ) {
    return;
  }

  const conditionIndex =
    nodes.findIndex(
      (node) =>
        isConditionalNodeKey(
          node.nodeKey,
        ),
    );

  if (
    conditionIndex === -1
  ) {
    return;
  }

  const preconditionNodes =
    nodes.slice(
      0,
      conditionIndex,
    );

  const hasExplicitComparison =
    preconditionNodes.some(
      (node) =>
        nodeLooksLikeComparison(
          node,
        ),
    );

  if (!hasExplicitComparison) {
    issues.push({
      path:
        `nodes.${conditionIndex}`,
      message:
        "The request requires comparing related records, but no explicit retrieval or comparison node appears before the condition. Extraction alone is not comparison. Add a comparison step such as an HTTP Request that retrieves and compares the purchase order and goods receipt before the If node.",
      code:
        "missing_comparison_step",
    });
  }

  const onlyExtractionBeforeCondition =
    preconditionNodes.some(
      nodeLooksLikeExtraction,
    )
    && !hasExplicitComparison;

  if (
    onlyExtractionBeforeCondition
  ) {
    issues.push({
      path:
        `nodes.${conditionIndex}`,
      message:
        "Do not branch directly from Information Extractor output when external purchase-order or goods-receipt records still need to be retrieved and compared.",
      code:
        "condition_directly_after_extraction",
    });
  }
}

function summaryWasRequested(
  brief: CompactN8nGenerationInput,
): boolean {
  const outputContext =
    normalizeText(
      [
        ...brief.internal_outputs,
        brief.workflow_goal,
        brief.classification_target,
      ].join(" "),
    );

  return (
    outputContext.includes(
      "summary",
    )
    || outputContext.includes(
      "summarize",
    )
  );
}

function validateRequestedSummary(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  if (
    !summaryWasRequested(
      brief,
    )
  ) {
    return;
  }

  const hasSummarizationNode =
    nodes.some(
      (node) =>
        node.nodeKey
        === "chainSummarization",
    );

  if (hasSummarizationNode) {
    return;
  }

  /*
   * A request can describe two independent workflows, for example:
   *
   * 1. Process each incoming support message.
   * 2. Run a separate daily summary report.
   *
   * keepPrimaryWorkflowOnly() removes the secondary scheduled
   * workflow because this generator currently returns one connected
   * workflow. In that case, do not require the retained event-driven
   * workflow to contain the summary node that belonged exclusively
   * to the removed scheduled workflow.
   */
  const retainedTriggerIndexes =
    findTriggerIndexes(nodes);

  const retainedTrigger =
    retainedTriggerIndexes.length === 1
      ? nodes[
          retainedTriggerIndexes[0]
          ?? -1
        ]
      : undefined;

  const scheduledSummaryWasSeparated =
    isClearlyEventDriven(brief)
    && isExplicitScheduledTrigger(
      brief,
    )
    && retainedTrigger?.nodeKey
      !== "scheduleTrigger";

  if (scheduledSummaryWasSeparated) {
    return;
  }

  issues.push({
    path: "nodes",
    message:
      'The clarified output requests a summary. Include a "chainSummarization" node; a Set/Edit Fields node does not itself generate a natural-language summary.',
    code:
      "missing_summary_node",
  });
}

function paymentActionsAreBlocked(
  brief: CompactN8nGenerationInput,
): boolean {
  const blockedContext =
    normalizeText(
      [
        ...brief
          .blocked_or_not_safe_actions,
        ...brief.warnings,
        brief.safety_summary,
      ].join(" "),
    );

  return (
    blockedContext.includes(
      "payment",
    )
    && (
      blockedContext.includes(
        "block",
      )
      || blockedContext.includes(
        "blocked",
      )
      || blockedContext.includes(
        "not safe",
      )
      || blockedContext.includes(
        "automatic",
      )
      || blockedContext.includes(
        "approval",
      )
    )
  );
}

function nodeLooksLikeDirectPaymentAction(
  node: SelectedN8nNode,
): boolean {
  const text =
    normalizeText(
      [
        node.name,
        node.reason ?? "",
      ].join(" "),
    );

  const directAction =
    text.includes(
      "schedule payment",
    )
    || text.includes(
      "initiate payment",
    )
    || text.includes(
      "execute payment",
    )
    || text.includes(
      "process payment",
    )
    || text.includes(
      "send payment",
    )
    || text.includes(
      "pay invoice",
    );

  const safeHandoff =
    text.includes(
      "approval and payment scheduling",
    )
    || (
      text.includes("approval")
      && text.includes(
        "forward",
      )
    );

  return (
    directAction
    && !safeHandoff
  );
}

function validateBlockedPaymentActions(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  if (
    !paymentActionsAreBlocked(
      brief,
    )
  ) {
    return;
  }

  nodes.forEach(
    (node, index) => {
      if (
        !nodeLooksLikeDirectPaymentAction(
          node,
        )
      ) {
        return;
      }

      issues.push({
        path: `nodes.${index}`,
        message:
          'Automatic payment actions are blocked. Remove the separate payment-scheduling node and use one safe handoff action such as "Forward Invoice for Approval and Payment Scheduling".',
        code:
          "blocked_payment_action",
      });
    },
  );
}

function validateUnrequestedFinalActions(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  const request =
    normalizeText(
      brief.original_request,
    );

  nodes.forEach(
    (node, index) => {
      const nodeDescription =
        normalizeText(
          [
            node.name,
            node.reason ?? "",
          ].join(" "),
        );

      const looksUnrequested =
        nodeDescription.includes(
          "log final status",
        )
        || nodeDescription.includes(
          "notify sender",
        )
        || nodeDescription.includes(
          "reply to sender",
        )
        || nodeDescription.includes(
          "send confirmation",
        )
        || nodeDescription.includes(
          "send acknowledgement",
        )
        || nodeDescription.includes(
          "send acknowledgment",
        );

      if (!looksUnrequested) {
        return;
      }

      const explicitlyRequested =
        request.includes(
          "notify sender",
        )
        || request.includes(
          "reply to sender",
        )
        || request.includes(
          "send confirmation",
        )
        || request.includes(
          "send acknowledgement",
        )
        || request.includes(
          "send acknowledgment",
        )
        || request.includes(
          "log final status",
        );

      if (
        !explicitlyRequested
      ) {
        issues.push({
          path:
            `nodes.${index}`,
          message:
            "This final reply, acknowledgement, sender notification, or status-log action was not requested.",
          code:
            "unrequested_action",
        });
      }
    },
  );
}

function validateCurrentWorkflowTerminology(
  input: {
    brief:
      CompactN8nGenerationInput;
    nodes:
      SelectedN8nNode[];
    issues:
      N8nNodeSelectionIssue[];
  },
): void {
  const {
    brief,
    nodes,
    issues,
  } = input;

  const currentContext =
    normalizeText(
      brief.original_request,
    );

  const domainTerms = [
    "replenishment",
    "inventory",
    "low stock",
    "candidate",
    "admissions",
    "refund",
    "support ticket",
  ];

  nodes.forEach(
    (node, index) => {
      const nodeText =
        normalizeText(
          [
            node.name,
            node.reason ?? "",
          ].join(" "),
        );

      for (
        const term
        of domainTerms
      ) {
        if (
          nodeText.includes(term)
          && !currentContext.includes(
            term,
          )
        ) {
          issues.push({
            path:
              `nodes.${index}.name`,
            message:
              `The node contains unrelated terminology "${term}" that is absent from the original request.`,
            code:
              "unrelated_workflow_term",
          });

          break;
        }
      }
    },
  );
}

function validateSelection(
  brief: CompactN8nGenerationInput,
  selection: N8nNodeSelection,
): void {
  const issues:
    N8nNodeSelectionIssue[] = [];

  if (
    selection.nodes.length === 0
  ) {
    issues.push({
      path: "nodes",
      message:
        "At least one node must be selected.",
      code:
        "empty_selection",
    });
  }

  validateTriggerSemantics({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateConditionalOrdering({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateConditionalBranches({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateRequiredComparison({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateRequestedSummary({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateBlockedPaymentActions({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateUnrequestedFinalActions({
    brief,
    nodes: selection.nodes,
    issues,
  });

  validateCurrentWorkflowTerminology({
    brief,
    nodes: selection.nodes,
    issues,
  });

  if (issues.length > 0) {
    throw new N8nNodeSelectionError(
      "Node selection failed semantic validation.",
      issues,
    );
  }
}

function buildRepairPrompt(
  brief: CompactN8nGenerationInput,
  previousOutput: string,
  issues: N8nNodeSelectionIssue[],
): string {
  const hasMultipleTriggersIssue =
    issues.some(
      (issue) =>
        issue.code
        === "multiple_triggers",
    );

  const multipleTriggerInstructions =
    hasMultipleTriggersIssue
      ? [
          "",
          "MULTIPLE-TRIGGER REPAIR:",
          "- This generator supports exactly one trigger in one generated workflow.",
          "- Keep the primary workflow only.",
          "- Prefer the first immediate or event-driven trigger unless the original request clearly makes the scheduled workflow the main goal.",
          "- Remove every secondary trigger.",
          "- Also remove all nodes that belong only to the removed secondary workflow.",
          "- For a request combining an incoming-event workflow with a daily report, keep the incoming-event workflow and omit the separate daily-report workflow.",
          "- Do not replace the omitted workflow with unrelated reporting, forwarding, logging, or summary nodes.",
        ]
      : [];

  return [
    buildN8nNodeSelectorUserPrompt({
      brief,
    }),
    "",
    "Your previous result was invalid:",
    previousOutput
    || "(previous output unavailable)",
    "",
    "Validation errors:",
    JSON.stringify(
      issues,
      null,
      2,
    ),
    "",
    "Return one corrected complete JSON object.",
    "Do not explain the corrections.",
    "Base workflowName on original_request only.",
    "Do not put branch metadata on the If, Switch, or Filter node itself.",
    'Put branch "true" and branch "false" only on actions after the condition.',
    "Include explicit retrieval/comparison before a match condition.",
    'Use chainSummarization when the requested output is "a summary".',
    "Do not create a separate direct payment-scheduling action when payment actions are blocked.",
    'Use one safe action such as "Forward Invoice for Approval and Payment Scheduling".',
    ...multipleTriggerInstructions,
  ].join("\n");
}

async function callAndValidate(
  brief: CompactN8nGenerationInput,
  call: N8nNodeSelectorCall,
  provider:
    N8nNodeSelectorProvider,
  prompt: string,
): Promise<{
  raw: string;
  selection:
    N8nNodeSelection;
}> {
  const raw = await call(
    prompt,
    n8nNodeSelectorSystemPrompt,
  );

  debugLog(
    provider,
    "Raw selector output:",
    raw,
  );

  const parsed =
    parseSelectionJson(raw);

  const normalizedSelection =
    normalizeSelection(
      parsed,
      brief,
    );

  const selection =
    keepPrimaryWorkflowOnly(
      normalizedSelection,
    );

  if (
    selection.nodes.length
    !== normalizedSelection.nodes.length
  ) {
    debugLog(
      provider,
      "Removed secondary triggered workflow:",
      {
        originalNodeCount:
          normalizedSelection.nodes.length,
        retainedNodeCount:
          selection.nodes.length,
        removedNodes:
          normalizedSelection.nodes
            .slice(
              selection.nodes.length,
            )
            .map((node) => ({
              nodeKey: node.nodeKey,
              name: node.name,
            })),
      },
    );
  }

  debugLog(
    provider,
    "Normalized selection:",
    selection,
  );

  validateSelection(
    brief,
    selection,
  );

  return {
    raw,
    selection,
  };
}

export async function selectN8nNodes(
  brief: CompactN8nGenerationInput,
  call: N8nNodeSelectorCall,
  provider:
    N8nNodeSelectorProvider =
      "unknown",
): Promise<N8nNodeSelection> {
  const prompt =
    buildN8nNodeSelectorUserPrompt({
      brief,
    });

  try {
    const first =
      await callAndValidate(
        brief,
        call,
        provider,
        prompt,
      );

    return first.selection;
  } catch (error) {
    if (
      provider !== "openai"
      || !(
        error instanceof
          N8nNodeSelectionError
      )
    ) {
      throw error;
    }

    debugError(
      provider,
      "Initial selection failed validation. Retrying repair.",
      error.issues,
    );

    const repaired =
      await callAndValidate(
        brief,
        call,
        provider,
        buildRepairPrompt(
          brief,
          "",
          error.issues,
        ),
      );

    debugLog(
      provider,
      "Repaired selection validated.",
      repaired.selection,
    );

    return repaired.selection;
  }
}