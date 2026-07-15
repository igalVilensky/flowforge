export type SelectedN8nNode = {
  /**
   * One or more 1-based blueprint step numbers represented by this node.
   * Multiple steps may be merged when one node is sufficient.
   */
  stepIds: number[];
  /**
   * Must match a key from N8N_NODE_CATALOG.
   */
  nodeKey: string;
  /**
   * Human-readable node name shown on the n8n canvas.
   */
  name: string;
  /**
   * Short selection explanation for debugging and UI preview.
   */
  reason?: string;
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