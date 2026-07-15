import type {
  N8nWorkflow,
  N8nWorkflowNode,
} from "../../shared/types/n8nWorkflow";
import type {
  N8nNodeSelection,
} from "../../shared/types/n8nNodeSelection";
import {
  getN8nNodeByKey,
  type N8nNodeCatalogEntry,
} from "../catalogs/n8nNodeCatalog";

type ConnectionTarget = {
  node: string;
  type: string;
  index: number;
};

type ResolvedSelectedNode = {
  entry: N8nNodeCatalogEntry;
  id: string;
  name: string;
  position: [number, number];
};

const DEFAULT_AI_MODEL_KEY = "lmChatOpenAi";

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function uniqueName(
  requestedName: string,
  usedNames: Set<string>,
): string {
  const baseName = requestedName.trim() || "Workflow Node";
  let candidate = baseName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function uniqueId(
  requestedId: string,
  usedIds: Set<string>,
): string {
  let candidate = requestedId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${requestedId}_${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function addConnection(
  connections: Record<string, unknown>,
  sourceName: string,
  connectionType: string,
  target: ConnectionTarget,
): void {
  const source = (
    connections[sourceName] ??= {}
  ) as Record<string, unknown>;

  const outputGroups = (
    source[connectionType] ??= [[]]
  ) as ConnectionTarget[][];

  if (!Array.isArray(outputGroups[0])) {
    outputGroups[0] = [];
  }

  outputGroups[0].push(target);
}

function isMainNode(entry: N8nNodeCatalogEntry): boolean {
  return entry.connectionRole === "main";
}

function requiresAiModel(entry: N8nNodeCatalogEntry): boolean {
  return entry.connectionRole === "main" && entry.requiresAiModel === true;
}

function defaultParametersForNode(
  entry: N8nNodeCatalogEntry,
): Record<string, unknown> {
  switch (entry.key) {
    case "scheduleTrigger":
      return {
        rule: {
          interval: [{}],
        },
      };

    case "gmail":
    case "microsoftOutlook":
    case "slack":
    case "microsoftTeams":
    case "discord":
    case "googleSheets":
    case "googleDrive":
    case "googleCalendar":
    case "airtable":
    case "asana":
    case "trello":
    case "jira":
    case "httpRequest":
    case "code":
    case "set":
    case "if":
    case "switch":
    case "filter":
    case "merge":
    case "aggregate":
    case "splitOut":
    case "splitInBatches":
    case "wait":
    case "agent":
    case "chainLlm":
    case "chainSummarization":
    case "sentimentAnalysis":
    case "outputParserStructured":
    case "lmChatOpenAi":
    case "lmChatGoogleGemini":
    case "lmChatGroq":
      return {
        options: {},
      };

    case "informationExtractor":
      return {
        text: "={{ $json.text || $json.body || $json.message }}",
        options: {},
      };

    case "textClassifier":
      return {
        inputText: "={{ $json.text || $json.body || $json.message }}",
        categories: {
          categories: [
            {
              category: "High",
              description: "Urgent or high-priority item",
            },
            {
              category: "Normal",
              description: "Standard-priority item",
            },
          ],
        },
        options: {},
      };

    case "notion":
      return {
        pageId: {
          __rl: true,
          mode: "url",
          value: "",
        },
        options: {},
      };

    case "webhook":
      return {
        httpMethod: "POST",
        path: "configure-webhook-path",
        options: {},
      };

    case "chatTrigger":
      return {
        public: false,
        options: {},
      };

    case "gmailTrigger":
    case "microsoftOutlookTrigger":
      return {
        options: {},
      };

    default:
      return {};
  }
}

function withDefaultAiModel(
  selection: N8nNodeSelection,
): N8nNodeSelection {
  const hasAiRoot = selection.nodes.some((node) => {
    const entry = getN8nNodeByKey(node.nodeKey);
    return entry ? requiresAiModel(entry) : false;
  });

  if (!hasAiRoot) return selection;

  const hasModel = selection.nodes.some((node) => {
    const entry = getN8nNodeByKey(node.nodeKey);
    return entry?.connectionRole === "ai-model";
  });

  if (hasModel) return selection;

  const modelEntry = getN8nNodeByKey(DEFAULT_AI_MODEL_KEY);

  if (!modelEntry) {
    throw new Error(
      `Default AI model key "${DEFAULT_AI_MODEL_KEY}" is missing from the n8n node catalog.`,
    );
  }

  return {
    ...selection,
    nodes: [
      ...selection.nodes,
      {
        stepIds: [],
        nodeKey: DEFAULT_AI_MODEL_KEY,
        name: modelEntry.displayName,
        reason: "Default chat model for selected AI nodes.",
      },
    ],
  };
}

function nearestCompatibleAiRoot(
  nodes: ResolvedSelectedNode[],
  subnodeIndex: number,
): ResolvedSelectedNode | undefined {
  for (let index = subnodeIndex - 1; index >= 0; index -= 1) {
    const candidate = nodes[index];

    if (candidate && requiresAiModel(candidate.entry)) {
      return candidate;
    }
  }

  return nodes.find(
    (candidate) => requiresAiModel(candidate.entry),
  );
}

function buildWorkflowNode(
  node: ResolvedSelectedNode,
): N8nWorkflowNode {
  return {
    id: node.id,
    name: node.name,
    type: node.entry.type,
    typeVersion: node.entry.version,
    position: node.position,
    parameters: defaultParametersForNode(node.entry),
  };
}

/**
 * Converts semantic catalog selections into minimal n8n workflow JSON.
 *
 * The workflow contains real node types and enough structural parameters for
 * n8n to preserve important inputs and outputs. Credentials, resource IDs,
 * operations, prompts, filters, and field mappings still require builder
 * configuration after import.
 */
export function buildMinimalN8nWorkflowFromSelection(
  originalSelection: N8nNodeSelection,
  workflowName?: string,
): N8nWorkflow {
  const selection = withDefaultAiModel(originalSelection);
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  let mainNodeIndex = 0;
  let subnodeIndex = 0;

  const selectedNodes: ResolvedSelectedNode[] = selection.nodes.map(
    (selectedNode, index) => {
      const entry = getN8nNodeByKey(selectedNode.nodeKey);

      if (!entry) {
        throw new Error(
          `Unknown n8n catalog key: ${selectedNode.nodeKey}`,
        );
      }

      const name = uniqueName(
        selectedNode.name || entry.displayName,
        usedNames,
      );

      const id = uniqueId(
        slugify(name, `node_${index + 1}`),
        usedIds,
      );

      let position: [number, number];

      if (isMainNode(entry)) {
        position = [mainNodeIndex * 280, 0];
        mainNodeIndex += 1;
      } else {
        position = [subnodeIndex * 220 + 280, 220];
        subnodeIndex += 1;
      }

      return {
        entry,
        id,
        name,
        position,
      };
    },
  );

  const nodes = selectedNodes.map(buildWorkflowNode);
  const connections: Record<string, unknown> = {};

  const mainNodes = selectedNodes.filter(
    ({ entry }) => isMainNode(entry),
  );

  for (let index = 0; index < mainNodes.length - 1; index += 1) {
    const source = mainNodes[index];
    const target = mainNodes[index + 1];

    if (!source || !target) continue;

    addConnection(
      connections,
      source.name,
      "main",
      {
        node: target.name,
        type: "main",
        index: 0,
      },
    );
  }

  const aiRoots = selectedNodes.filter(
    ({ entry }) => requiresAiModel(entry),
  );

  for (const node of selectedNodes) {
    if (node.entry.connectionRole !== "ai-model") continue;

    for (const aiRoot of aiRoots) {
      addConnection(
        connections,
        node.name,
        "ai_languageModel",
        {
          node: aiRoot.name,
          type: "ai_languageModel",
          index: 0,
        },
      );
    }
  }

  selectedNodes.forEach((node, index) => {
    if (
      node.entry.connectionRole !== "ai-parser"
      && node.entry.connectionRole !== "ai-tool"
      && node.entry.connectionRole !== "ai-memory"
    ) {
      return;
    }

    const aiRoot = nearestCompatibleAiRoot(selectedNodes, index);
    if (!aiRoot) return;

    const connectionTypeByRole = {
      "ai-parser": "ai_outputParser",
      "ai-tool": "ai_tool",
      "ai-memory": "ai_memory",
    } as const;

    const connectionType =
      connectionTypeByRole[
        node.entry.connectionRole as keyof typeof connectionTypeByRole
      ];

    addConnection(
      connections,
      node.name,
      connectionType,
      {
        node: aiRoot.name,
        type: connectionType,
        index: 0,
      },
    );
  });

  return {
  name:
    workflowName?.trim()
    || selection.workflowName
    || "Generated n8n Workflow",
    nodes,
    connections,
    active: false,
    settings: {},
    tags: [],
  };
}