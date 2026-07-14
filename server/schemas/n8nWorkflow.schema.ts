import { z } from "zod";
import type {
  N8nAllowedNodeType,
  N8nWorkflow,
  N8nWorkflowNode,
} from "../../shared/types/n8nWorkflow";

const requiredString = z.string().min(1, "Required string cannot be empty.");

// Retained for callers that use the small, credential-free preview subset. It is
// no longer an importability allow-list: real n8n connector nodes are valid too.
export const allowedN8nNodeTypes = [
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.set",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
  "n8n-nodes-base.stickyNote",
] as const satisfies readonly N8nAllowedNodeType[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateConnectionTarget(
  target: unknown,
  nodeNames: ReadonlySet<string>,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (!isRecord(target)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: "Connection targets must be n8n objects with node, type, and index fields.",
    });
    return;
  }

  if (typeof target.node !== "string" || !target.node.trim()) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "node"],
      message: "Connection target node must be a non-empty node name.",
    });
  } else if (!nodeNames.has(target.node)) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "node"],
      message: `Connection target node "${target.node}" does not match any generated node name.`,
    });
  }

  if (typeof target.type !== "string" || !target.type.trim()) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "type"],
      message: "Connection target type must be a non-empty string such as main.",
    });
  }

  if (typeof target.index !== "number" || !Number.isInteger(target.index) || target.index < 0) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "index"],
      message: "Connection target index must be a non-negative integer.",
    });
  }
}

function validateWorkflowConnections(
  connections: Record<string, unknown>,
  nodeNames: ReadonlySet<string>,
  ctx: z.RefinementCtx,
): void {
  for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
    if (!nodeNames.has(sourceNodeName)) {
      ctx.addIssue({
        code: "custom",
        path: ["connections", sourceNodeName],
        message: `Connection source node "${sourceNodeName}" does not match any generated node name.`,
      });
    }

    if (!isRecord(nodeConnections)) {
      ctx.addIssue({
        code: "custom",
        path: ["connections", sourceNodeName],
        message: "Each source node connection must be an object keyed by connection type.",
      });
      continue;
    }

    for (const [connectionType, outputGroups] of Object.entries(nodeConnections)) {
      if (!Array.isArray(outputGroups)) {
        ctx.addIssue({
          code: "custom",
          path: ["connections", sourceNodeName, connectionType],
          message: "Connection outputs must be arrays of target groups.",
        });
        continue;
      }

      outputGroups.forEach((group, groupIndex) => {
        if (!Array.isArray(group)) {
          ctx.addIssue({
            code: "custom",
            path: ["connections", sourceNodeName, connectionType, groupIndex],
            message: "Connection output groups must be arrays of target objects.",
          });
          return;
        }

        group.forEach((target, targetIndex) => {
          validateConnectionTarget(target, nodeNames, ctx, [
            "connections",
            sourceNodeName,
            connectionType,
            groupIndex,
            targetIndex,
          ]);
        });
      });
    }
  }
}

export const n8nWorkflowNodeSchema = z
  .object({
    id: requiredString,
    name: requiredString,
    type: requiredString,
    typeVersion: z.number().positive(),
    position: z.tuple([z.number(), z.number()]),
    parameters: z.record(z.string(), z.unknown()),
    disabled: z.boolean().optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
    notesInFlow: z.boolean().optional(),
  })
  .passthrough() satisfies z.ZodType<N8nWorkflowNode>;

export const n8nWorkflowSchema = z
  .object({
    name: requiredString.optional(),
    nodes: z.array(n8nWorkflowNodeSchema).min(1, "Workflow must include at least one node."),
    connections: z.record(z.string(), z.unknown()),
    active: z.literal(false),
    settings: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((workflow, ctx) => {
    const nodeNames = new Set(workflow.nodes.map((node) => node.name));
    validateWorkflowConnections(workflow.connections, nodeNames, ctx);
  }) satisfies z.ZodType<N8nWorkflow>;
