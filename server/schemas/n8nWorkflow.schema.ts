import { z } from "zod";
import type {
  N8nWorkflow,
  N8nWorkflowNode,
} from "../../shared/types/n8nWorkflow";

const requiredString = z.string().min(1, "Required string cannot be empty.");

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
  "transfer",
  "update",
  "upsert",
  "write",
];

const safetyGateMarkers = [
  "approval",
  "approve",
  "draft",
  "disabled",
  "do not execute",
  "do not send",
  "human",
  "manual review",
  "placeholder",
  "review",
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

function isObviousDangerousExternalAction(node: N8nWorkflowNode): boolean {
  const text = nodeSearchText(node);
  const typeText = node.type.toLowerCase().replace(/[^a-z0-9]/g, "");
  const usesExternalConnector =
    containsMarker(typeText, externalConnectorMarkers)
    || containsMarker(text, externalConnectorMarkers);

  if (!usesExternalConnector) {
    return false;
  }

  return containsMarker(text, dangerousActionMarkers);
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

    if (dangerousNodes.length > 0 && !workflow.nodes.some(isApprovalGateNode)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Dangerous external action placeholders require a visible manual approval or review gate node.",
      });
    }
  }) satisfies z.ZodType<N8nWorkflow>;
