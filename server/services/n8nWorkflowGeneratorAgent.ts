import process from "node:process";
import type { ZodIssue } from "zod";
import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nGenerateResponse,
  N8nWorkflow,
} from "../../shared/types/n8nWorkflow";
import {
  buildCompactN8nGenerationInput,
  buildN8nWorkflowGeneratorUserPrompt,
  n8nWorkflowGeneratorSystemPrompt,
} from "../prompts/n8nWorkflowGeneratorPrompt";
import { n8nWorkflowSchema } from "../schemas/n8nWorkflow.schema";
import { callGroq } from "./groqProvider";

export const n8nGeneratorNotConfiguredMessage =
  "n8n JSON generator is not configured. Add GROQ_N8N_API_KEY to enable this feature.";

export const n8nGeneratorProviderLimitMessage =
  "n8n JSON generation request was too large for the configured Groq tier. FlowForge now sends a compact blueprint summary, but this request still exceeded the provider limit. Try a shorter workflow or reduce blueprint steps.";

export type N8nWorkflowValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class N8nWorkflowGeneratorConfigError extends Error {
  constructor() {
    super(n8nGeneratorNotConfiguredMessage);
    this.name = "N8nWorkflowGeneratorConfigError";
  }
}

export class N8nWorkflowGeneratorValidationError extends Error {
  issues: N8nWorkflowValidationIssue[];

  constructor(message: string, issues: N8nWorkflowValidationIssue[]) {
    super(message);
    this.name = "N8nWorkflowGeneratorValidationError";
    this.issues = issues;
  }
}

export class N8nWorkflowGeneratorProviderLimitError extends Error {
  constructor() {
    super(n8nGeneratorProviderLimitMessage);
    this.name = "N8nWorkflowGeneratorProviderLimitError";
  }
}

export function estimateN8nPromptBytes(input: CompactN8nGenerationInput): {
  compactPayloadBytes: number;
  promptBytes: number;
} {
  const prompt = buildN8nWorkflowGeneratorUserPrompt(input);

  return {
    compactPayloadBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
    promptBytes: Buffer.byteLength(`${n8nWorkflowGeneratorSystemPrompt}\n${prompt}`, "utf8"),
  };
}

function formatIssuePath(path: ZodIssue["path"]): string {
  return path.length > 0 ? path.map(String).join(".") : "(root)";
}

function formatIssues(issues: ZodIssue[]): N8nWorkflowValidationIssue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

function parseStrictJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new N8nWorkflowGeneratorValidationError(
      "n8n generator returned non-JSON output.",
      [
        {
          path: "(root)",
          message: "Model output must be valid JSON with no markdown or surrounding explanation.",
          code: "invalid_json",
        },
      ],
    );
  }
}

function slugifyNodeId(value: unknown, fallback: string): string {
  const source = typeof value === "string" && value.trim() ? value : fallback;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function uniqueNodeId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

export function normalizeGeneratedWorkflowIds(input: unknown): unknown {
  if (!input || typeof input !== "object" || !Array.isArray((input as { nodes?: unknown }).nodes)) {
    return input;
  }

  const workflow = input as Record<string, unknown> & { nodes: unknown[] };
  const usedIds = new Set<string>();

  return {
    ...workflow,
    nodes: workflow.nodes.map((node, index) => {
      if (!node || typeof node !== "object") {
        return node;
      }

      const record = node as Record<string, unknown>;
      const existingId = typeof record.id === "string" ? record.id.trim() : "";
      const baseId = slugifyNodeId(existingId || record.name, `node_${index + 1}`);

      return {
        ...record,
        id: uniqueNodeId(baseId, usedIds),
      };
    }),
  };
}

function workflowWarnings(workflow: N8nWorkflow): string[] {
  const disabledNodes = workflow.nodes.filter((node) => node.disabled === true);
  const warnings = [
    "Draft only. Review before importing. Credentials are placeholders. Production side effects remain disabled.",
  ];

  if (disabledNodes.length > 0) {
    warnings.push(`${disabledNodes.length} external or side-effect placeholder node(s) are disabled in the draft.`);
  }

  return warnings;
}

function isProviderLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return /413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute/i.test(message);
}

export async function runN8nWorkflowGeneratorAgent(input: {
  compileJob: CompileJob;
}): Promise<N8nGenerateResponse> {
  if (!process.env.GROQ_N8N_API_KEY) {
    throw new N8nWorkflowGeneratorConfigError();
  }

  const compactInput = buildCompactN8nGenerationInput(input.compileJob);
  const prompt = buildN8nWorkflowGeneratorUserPrompt(compactInput);
  let rawResponse: string;

  try {
    rawResponse = await callGroq(prompt, n8nWorkflowGeneratorSystemPrompt, {
      apiKeyEnv: "GROQ_N8N_API_KEY",
      modelEnv: "GROQ_N8N_MODEL",
      maxTokensEnv: "GROQ_N8N_MAX_TOKENS",
      defaultMaxTokens: 2200,
      maxTokensCap: 2200,
      timeoutMs: 30000,
    });
  } catch (error) {
    if (isProviderLimitError(error)) {
      throw new N8nWorkflowGeneratorProviderLimitError();
    }

    throw error;
  }

  const parsed = parseStrictJson(rawResponse);
  const normalized = normalizeGeneratedWorkflowIds(parsed);
  const validation = n8nWorkflowSchema.safeParse(normalized);

  if (!validation.success) {
    throw new N8nWorkflowGeneratorValidationError(
      "Generated n8n workflow JSON did not pass FlowForge safety validation.",
      formatIssues(validation.error.issues),
    );
  }

  return {
    workflow_json: validation.data,
    warnings: workflowWarnings(validation.data),
    provider: "groq",
    used_ai: true,
    fallback_used: false,
  };
}
