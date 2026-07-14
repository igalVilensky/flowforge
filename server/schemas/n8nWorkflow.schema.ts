import { z } from "zod";
import type {
  N8nAllowedNodeType,
  N8nWorkflow,
  N8nWorkflowNode,
} from "../../shared/types/n8nWorkflow";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const allowedN8nNodeTypes = [
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.scheduleTrigger",
  "n8n-nodes-base.set",
  "n8n-nodes-base.code",
  "n8n-nodes-base.if",
  "n8n-nodes-base.stickyNote",
] as const satisfies readonly N8nAllowedNodeType[];

const allowedN8nNodeTypeSet = new Set<string>(allowedN8nNodeTypes);

const externalConnectorMarkers = [
  "airtable",
  "asana",
  "email",
  "emailsend",
  "gmail",
  "googlesheets",
  "hubspot",
  "http",
  "httprequest",
  "jira",
  "linear",
  "mailchimp",
  "mysql",
  "notion",
  "paypal",
  "postgres",
  "quickbooks",
  "salesforce",
  "sendgrid",
  "shopify",
  "slack",
  "stripe",
  "supabase",
  "trello",
  "twilio",
  "webhook",
  "zendesk",
];

const dangerousActionMarkers = [
  "add",
  "append",
  "archive",
  "cancel",
  "charge",
  "close",
  "create",
  "delete",
  "insert",
  "invite",
  "message",
  "patch",
  "pay",
  "payment",
  "post",
  "publish",
  "put",
  "refund",
  "remove",
  "reply",
  "send",
  "submit",
  "transfer",
  "update",
  "upsert",
  "write",
];

const safetyGateMarkers = [
  "approval",
  "approve",
  "blocked",
  "draft",
  "draft_only",
  "disabled",
  "do not execute",
  "do not send",
  "human",
  "manual review",
  "manual",
  "no-op",
  "noop",
  "not sent",
  "not_sent",
  "pending",
  "placeholder",
  "requires_human_approval",
  "review",
];

const safeInertDraftMarkers = [
  "approval",
  "approve",
  "blocked",
  "draft",
  "draft_only",
  "do not send",
  "human approval",
  "internal",
  "manual",
  "no-op",
  "noop",
  "not sent",
  "not_sent",
  "pending",
  "placeholder",
  "requires_human_approval",
  "review",
  "sample",
];

const executableExternalActionMarkers = [
  "$http",
  "axios",
  "fetch(",
  "gmail.users.messages",
  "http.request",
  "https.request",
  "nodemailer",
  "sendmail",
  "slack.chat.postmessage",
  "stripe.",
  "twilio.",
];

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

function nodeSearchText(node: Pick<N8nWorkflowNode, "name" | "type" | "parameters"> & {
  credentials?: Record<string, unknown>;
  notes?: unknown;
}): string {
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

function containsMarker(value: string, markers: string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

function nodeTypeSearchText(node: Pick<N8nWorkflowNode, "type">): string {
  return node.type.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function credentialValueStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(credentialValueStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(credentialValueStrings);
  }

  return [];
}

function credentialsUsePlaceholders(credentials: Record<string, unknown> | undefined): boolean {
  if (!credentials) return true;

  const values = credentialValueStrings(credentials);

  return values.length > 0 && values.every((value) => value.includes("PLACEHOLDER_"));
}

function hasExecutableExternalActionCode(node: N8nWorkflowNode): boolean {
  const parametersText = safeStringify(node.parameters).toLowerCase();

  return containsMarker(parametersText, executableExternalActionMarkers);
}

function hasSafeInertDraftLanguage(node: N8nWorkflowNode): boolean {
  return containsMarker(nodeSearchText(node), safeInertDraftMarkers);
}

function nodeNameHasSafeInertDraftLanguage(node: N8nWorkflowNode): boolean {
  return containsMarker(node.name.toLowerCase(), safeInertDraftMarkers);
}

function nodeNameLooksLikeExternalActionCommand(node: N8nWorkflowNode): boolean {
  const nodeName = node.name.toLowerCase();
  const hasDangerousAction = containsMarker(nodeName, dangerousActionMarkers);

  return hasDangerousAction && !nodeNameHasSafeInertDraftLanguage(node);
}

function isAllowedInertDraftNode(node: N8nWorkflowNode): boolean {
  const typeText = nodeTypeSearchText(node);

  return allowedN8nNodeTypeSet.has(node.type)
    && !containsMarker(typeText, externalConnectorMarkers)
    && credentialsUsePlaceholders(node.credentials)
    && hasSafeInertDraftLanguage(node)
    && !hasExecutableExternalActionCode(node);
}

export function isObviousDangerousExternalAction(node: N8nWorkflowNode): boolean {
  const text = nodeSearchText(node);
  const typeText = nodeTypeSearchText(node);
  const usesExternalConnectorType = containsMarker(typeText, externalConnectorMarkers);
  const usesExternalConnectorText = containsMarker(text, externalConnectorMarkers);
  const usesExternalConnector =
    usesExternalConnectorType
    || usesExternalConnectorText;

  if (!usesExternalConnector) {
    return false;
  }

  if (
    !usesExternalConnectorType
    && isAllowedInertDraftNode(node)
    && !nodeNameLooksLikeExternalActionCommand(node)
  ) {
    return false;
  }

  return containsMarker(text, dangerousActionMarkers)
    || (usesExternalConnectorText && hasExecutableExternalActionCode(node));
}

function hasSafetyGateLanguage(node: N8nWorkflowNode): boolean {
  return containsMarker(nodeSearchText(node), safetyGateMarkers);
}

function isApprovalGateNode(node: N8nWorkflowNode): boolean {
  const text = nodeSearchText(node);

  return (
    text.includes("approval")
    || text.includes("manual review")
    || text.includes("human review")
    || text.includes("review gate")
    || text.includes("approval gate")
  );
}

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

  if (typeof target.index !== "number") {
    ctx.addIssue({
      code: "custom",
      path: [...path, "index"],
      message: "Connection target index must be a number.",
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
  .passthrough()
  .superRefine((node, ctx) => {
    if (!allowedN8nNodeTypeSet.has(node.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: `Unsupported n8n node type "${node.type}". Use only the safe draft subset: ${allowedN8nNodeTypes.join(", ")}.`,
      });
    }

    if (!credentialsUsePlaceholders(node.credentials)) {
      ctx.addIssue({
        code: "custom",
        path: ["credentials"],
        message: "Credential references must use placeholder credential names such as PLACEHOLDER_GMAIL_CREDENTIAL.",
      });
    }

    if (!isObviousDangerousExternalAction(node)) {
      return;
    }

    if (node.disabled !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["disabled"],
        message: "External send, update, delete, payment, refund, or production-write nodes must be disabled or replaced with a placeholder/no-op node.",
      });
    }

    if (!hasSafetyGateLanguage(node)) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: "Dangerous external action nodes must be clearly marked as draft, placeholder, disabled, or manual-review gated.",
      });
    }
  }) satisfies z.ZodType<N8nWorkflowNode>;

export const n8nWorkflowSchema = z
  .object({
    name: requiredString.optional(),
    nodes: z.array(n8nWorkflowNodeSchema).min(1, "Workflow must include at least one node."),
    connections: z.record(z.string(), z.unknown()),
    active: z.boolean().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((workflow, ctx) => {
    if (workflow.active === true) {
      ctx.addIssue({
        code: "custom",
        path: ["active"],
        message: "Generated n8n workflow drafts must not be active.",
      });
    }

    const dangerousNodes = workflow.nodes.filter(isObviousDangerousExternalAction);
    const nodeNames = new Set(workflow.nodes.map((node) => node.name));

    if (dangerousNodes.length > 0 && !workflow.nodes.some(isApprovalGateNode)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Dangerous external action placeholders require a visible manual approval or review gate node.",
      });
    }

    validateWorkflowConnections(workflow.connections, nodeNames, ctx);
  }) satisfies z.ZodType<N8nWorkflow>;
