export type N8nConditionalBranch =
  | "true"
  | "false";

export type SelectedN8nNode = {
  /**
   * One or more 1-based blueprint step numbers represented by this node.
   * Multiple steps may be merged when one node naturally represents them.
   */
  stepIds: number[];

  /**
   * Must exactly match a key from N8N_NODE_CATALOG.
   */
  nodeKey: string;

  /**
   * Human-readable name shown on the n8n canvas.
   */
  name: string;

  /**
   * Short explanation used for debugging and preview UI.
   */
  reason?: string;

  /**
   * Optional output branch of the nearest preceding conditional node.
   *
   * For an n8n If node:
   * - "true" maps to main output 0
   * - "false" maps to main output 1
   */
  branch?: N8nConditionalBranch;
};

export type N8nNodeSelection = {
  workflowName: string;
  nodes: SelectedN8nNode[];
};

export type N8nNodeSelectionIssue = {
  path: string;
  message: string;
  code: string;
};