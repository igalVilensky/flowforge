import type {
  N8nWorkflow,
  N8nWorkflowNode,
} from "../../shared/types/n8nWorkflow";
import type {
  N8nConditionalBranch,
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
  branch?: N8nConditionalBranch;
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

function uniqueName(requestedName: string, usedNames: Set<string>): string {
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

function uniqueId(requestedId: string, usedIds: Set<string>): string {
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
  outputIndex = 0,
): void {
  const source = (connections[sourceName] ??= {}) as Record<string, unknown>;

  const outputGroups = (source[connectionType] ??= []) as ConnectionTarget[][];

  while (outputGroups.length <= outputIndex) {
    outputGroups.push([]);
  }

  if (!Array.isArray(outputGroups[outputIndex])) {
    outputGroups[outputIndex] = [];
  }

  outputGroups[outputIndex]!.push(target);
}

function isMainNode(entry: N8nNodeCatalogEntry): boolean {
  return entry.connectionRole === "main";
}

function requiresAiModel(entry: N8nNodeCatalogEntry): boolean {
  return entry.connectionRole === "main" && entry.requiresAiModel === true;
}

function isConditionalEntry(entry: N8nNodeCatalogEntry): boolean {
  return entry.key === "if" || entry.key === "switch" || entry.key === "filter";
}

function branchOutputIndex(branch: N8nConditionalBranch): number {
  return branch === "true" ? 0 : 1;
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

function withDefaultAiModel(selection: N8nNodeSelection): N8nNodeSelection {
  const hasAiRoot = selection.nodes.some((node) => {
    const entry = getN8nNodeByKey(node.nodeKey);

    return entry ? requiresAiModel(entry) : false;
  });

  if (!hasAiRoot) {
    return selection;
  }

  const hasModel = selection.nodes.some((node) => {
    const entry = getN8nNodeByKey(node.nodeKey);

    return entry?.connectionRole === "ai-model";
  });

  if (hasModel) {
    return selection;
  }

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

  return nodes.find((candidate) => requiresAiModel(candidate.entry));
}

function buildWorkflowNode(node: ResolvedSelectedNode): N8nWorkflowNode {
  return {
    id: node.id,
    name: node.name,
    type: node.entry.type,
    typeVersion: node.entry.version,
    position: node.position,
    parameters: defaultParametersForNode(node.entry),
  };
}

function findNearestConditionIndex(
  nodes: ResolvedSelectedNode[],
  fromIndex: number,
): number {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    const node = nodes[index];

    if (node && isConditionalEntry(node.entry)) {
      return index;
    }
  }

  return -1;
}

function findPreviousNodeInBranch(
  nodes: ResolvedSelectedNode[],
  conditionIndex: number,
  currentIndex: number,
  branch: N8nConditionalBranch,
): ResolvedSelectedNode | undefined {
  for (let index = currentIndex - 1; index > conditionIndex; index -= 1) {
    const candidate = nodes[index];

    if (candidate?.branch === branch) {
      return candidate;
    }
  }

  return undefined;
}

function collectBranchTailsBeforeIndex(
  nodes: ResolvedSelectedNode[],
  currentIndex: number,
): ResolvedSelectedNode[] {
  const previousNode = nodes[currentIndex - 1];

  if (!previousNode?.branch) {
    return [];
  }

  const conditionIndex = findNearestConditionIndex(nodes, currentIndex - 1);

  if (conditionIndex === -1) {
    return [];
  }

  const branchNodes = nodes.slice(conditionIndex + 1, currentIndex);

  const tails: ResolvedSelectedNode[] = [];

  for (const branch of ["true", "false"] as const) {
    const branchTail = branchNodes
      .filter((node) => node.branch === branch)
      .at(-1);

    if (branchTail) {
      tails.push(branchTail);
    }
  }

  return tails;
}

function buildMainConnections(
  mainNodes: ResolvedSelectedNode[],
  connections: Record<string, unknown>,
): void {
  for (
    let index = 0;
    index < mainNodes.length;
    index += 1
  ) {
    const current = mainNodes[index];

    if (!current) {
      continue;
    }

    /*
     * Explicit conditional branches are connected either:
     *
     * condition output → first branch node
     *
     * or:
     *
     * previous node in the same branch → current branch node
     */
    if (current.branch) {
      const conditionIndex =
        findNearestConditionIndex(
          mainNodes,
          index,
        );

      if (conditionIndex === -1) {
        continue;
      }

      const conditionNode =
        mainNodes[conditionIndex];

      if (!conditionNode) {
        continue;
      }

      const previousBranchNode =
        findPreviousNodeInBranch(
          mainNodes,
          conditionIndex,
          index,
          current.branch,
        );

      if (previousBranchNode) {
        addConnection(
          connections,
          previousBranchNode.name,
          "main",
          {
            node: current.name,
            type: "main",
            index: 0,
          },
        );

        continue;
      }

      addConnection(
        connections,
        conditionNode.name,
        "main",
        {
          node: current.name,
          type: "main",
          index: 0,
        },
        branchOutputIndex(
          current.branch,
        ),
      );

      continue;
    }

    if (index === 0) {
      continue;
    }

    /*
     * When the current node is a Merge node, treat the two
     * immediately preceding main nodes as its two inputs.
     *
     * Example selection:
     *
     * Schedule
     * Get Messages
     * Get Notes
     * Merge
     *
     * Connections:
     *
     * Get Messages → Merge input 0
     * Get Notes    → Merge input 1
     */
    if (current.entry.key === "merge") {
      const firstMergeSource =
        mainNodes[index - 2];

      const secondMergeSource =
        mainNodes[index - 1];

      if (
        firstMergeSource
        && secondMergeSource
        && !firstMergeSource.branch
        && !secondMergeSource.branch
      ) {
        addConnection(
          connections,
          firstMergeSource.name,
          "main",
          {
            node: current.name,
            type: "main",
            index: 0,
          },
        );

        addConnection(
          connections,
          secondMergeSource.name,
          "main",
          {
            node: current.name,
            type: "main",
            index: 1,
          },
        );

        continue;
      }
    }

    const branchTails =
      collectBranchTailsBeforeIndex(
        mainNodes,
        index,
      );

    if (branchTails.length > 0) {
      for (const branchTail of branchTails) {
        addConnection(
          connections,
          branchTail.name,
          "main",
          {
            node: current.name,
            type: "main",
            index: 0,
          },
        );
      }

      continue;
    }

    const previous =
      mainNodes[index - 1];

    if (!previous) {
      continue;
    }

    /*
     * If the next node is Merge, the current node is the second
     * merge source. It should start from the same upstream node
     * as the first merge source instead of being connected after
     * the first source.
     *
     * Before:
     *
     * Trigger → Source A → Source B → Merge
     *
     * After:
     *
     * Trigger → Source A
     * Trigger → Source B
     */
    const next =
      mainNodes[index + 1];

    if (
      next?.entry.key === "merge"
      && index >= 2
    ) {
      const sharedUpstream =
        mainNodes[index - 2];

      if (
        sharedUpstream
        && !previous.branch
        && !current.branch
      ) {
        addConnection(
          connections,
          sharedUpstream.name,
          "main",
          {
            node: current.name,
            type: "main",
            index: 0,
          },
        );

        continue;
      }
    }

    addConnection(
      connections,
      previous.name,
      "main",
      {
        node: current.name,
        type: "main",
        index: 0,
      },
    );
  }
}

/**
 * Converts semantic catalog selections into an importable
 * n8n workflow skeleton.
 *
 * Credentials, operations, mappings, resource IDs, request
 * bodies, prompts, filters, and production configuration are
 * intentionally left for the person importing the workflow.
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
        throw new Error(`Unknown n8n catalog key: ${selectedNode.nodeKey}`);
      }

      const name = uniqueName(
        selectedNode.name || entry.displayName,
        usedNames,
      );

      const id = uniqueId(slugify(name, `node_${index + 1}`), usedIds);

      let position: [number, number];

      if (isMainNode(entry)) {
        const x = mainNodeIndex * 280;

        const y =
          selectedNode.branch === "true"
            ? -160
            : selectedNode.branch === "false"
              ? 160
              : 0;

        position = [x, y];

        mainNodeIndex += 1;
      } else {
        position = [subnodeIndex * 220 + 280, 260];

        subnodeIndex += 1;
      }

      return {
        entry,
        id,
        name,
        position,
        branch: selectedNode.branch,
      };
    },
  );

  const nodes = selectedNodes.map(buildWorkflowNode);

  const connections: Record<string, unknown> = {};

  const mainNodes = selectedNodes.filter(({ entry }) => isMainNode(entry));

  buildMainConnections(mainNodes, connections);

  const aiRoots = selectedNodes.filter(({ entry }) => requiresAiModel(entry));

  for (const node of selectedNodes) {
    if (node.entry.connectionRole !== "ai-model") {
      continue;
    }

    for (const aiRoot of aiRoots) {
      addConnection(connections, node.name, "ai_languageModel", {
        node: aiRoot.name,
        type: "ai_languageModel",
        index: 0,
      });
    }
  }

  selectedNodes.forEach((node, index) => {
    if (
      node.entry.connectionRole !== "ai-parser" &&
      node.entry.connectionRole !== "ai-tool" &&
      node.entry.connectionRole !== "ai-memory"
    ) {
      return;
    }

    const aiRoot = nearestCompatibleAiRoot(selectedNodes, index);

    if (!aiRoot) {
      return;
    }

    const connectionTypeByRole = {
      "ai-parser": "ai_outputParser",
      "ai-tool": "ai_tool",
      "ai-memory": "ai_memory",
    } as const;

    type AiSubnodeRole = keyof typeof connectionTypeByRole;

    const role = node.entry.connectionRole as AiSubnodeRole;

    const connectionType = connectionTypeByRole[role];

    addConnection(connections, node.name, connectionType, {
      node: aiRoot.name,
      type: connectionType,
      index: 0,
    });
  });

  return {
    name:
      selection.workflowName?.trim() ||
      workflowName?.trim() ||
      "Generated n8n Workflow",
    nodes,
    connections,
    active: false,
    settings: {},
    tags: [],
  };
}
