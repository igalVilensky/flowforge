import { randomUUID } from "node:crypto";
import process from "node:process";
import { z } from "zod";
import type {
  AutomationSuggestion,
  DiscoveryCategory,
} from "../../shared/types/discovery";
import {
  automationSuggestionSystemPrompt,
  buildAutomationSuggestionPrompt,
  buildAutomationSuggestionRepairPrompt,
} from "../prompts/automationSuggestionPrompt";
import {
  automationSuggestionModelResponseSchema,
  automationSuggestionSchema,
  type AutomationSuggestionModelResponse,
} from "../schemas/discovery.schema";
import { callOpenAIAgent } from "./openaiProvider";
import type { WorkflowPainPointSignal } from "./tavilySearch";

export class AutomationSuggestionConfigurationError extends Error {}
export class AutomationSuggestionGenerationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AutomationSuggestionGenerationError";
  }
}

export type AutomationSuggestionDiagnosticStage =
  | "initial_model_call"
  | "initial_response_validation"
  | "repair_model_call"
  | "repaired_response_validation";

export type AutomationSuggestionDiagnostic = {
  scope: "automation_discovery";
  stage: AutomationSuggestionDiagnosticStage;
  message: string;
  issues?: Array<{
    path: string;
    code: string;
    message: string;
  }>;
  response_preview?: string;
};

export type AutomationSuggestionLogger = (
  diagnostic: AutomationSuggestionDiagnostic,
) => void;

export type SuggestionModelCall = (
  prompt: string,
  systemPrompt: string,
) => Promise<string>;

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found.");
    return JSON.parse(match[0]);
  }
}

function redactSensitiveText(value: string): string {
  const secrets = [
    process.env.OPENAI_API_KEY,
    process.env.TAVILY_API_KEY,
  ].filter((secret): secret is string => Boolean(secret?.trim()));

  let redacted = value;
  for (const secret of secrets) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }

  return redacted
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|tvly)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function boundedSafeText(value: string, maxLength: number): string {
  const compact = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength)}…`;
}

function safeErrorMessage(error: unknown): string {
  return boundedSafeText(
    error instanceof Error ? error.message : String(error ?? "Unknown error"),
    500,
  );
}

function safeErrorCause(error: unknown): Error {
  const cause = new Error(safeErrorMessage(error));
  cause.name = error instanceof Error ? error.name : "Error";
  return cause;
}

function zodIssues(error: unknown): AutomationSuggestionDiagnostic["issues"] {
  if (!(error instanceof z.ZodError)) return undefined;
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
    code: issue.code,
    message: boundedSafeText(issue.message, 240),
  }));
}

function responsePreview(raw: string): string {
  return boundedSafeText(raw, 1200);
}

function defaultLogger(diagnostic: AutomationSuggestionDiagnostic): void {
  console.error("[automation-discovery]", diagnostic);
}

function logDiagnostic(
  logger: AutomationSuggestionLogger,
  stage: AutomationSuggestionDiagnosticStage,
  error: unknown,
  rawResponse?: string,
): void {
  const issues = zodIssues(error);
  logger({
    scope: "automation_discovery",
    stage,
    message: safeErrorMessage(error),
    ...(issues ? { issues } : {}),
    ...(rawResponse === undefined
      ? {}
      : { response_preview: responsePreview(rawResponse) }),
  });
}

export function parseAutomationSuggestionModelResponse(
  raw: string,
): AutomationSuggestionModelResponse {
  const parsed = parseJsonObject(raw);
  return automationSuggestionModelResponseSchema.parse(parsed);
}

function buildFinalSuggestion(
  content: AutomationSuggestionModelResponse,
  category: DiscoveryCategory,
): AutomationSuggestion {
  return automationSuggestionSchema.parse({
    id: randomUUID(),
    category,
    ...content,
  });
}

function defaultModelCall(prompt: string, systemPrompt: string): Promise<string> {
  return callOpenAIAgent(prompt, systemPrompt, {
    modelEnv: "OPENAI_DISCOVERY_MODEL",
    fallbackModelEnv: "OPENAI_DISCOVERY_MODEL",
    defaultModel: "gpt-4.1-mini",
    maxOutputTokensEnv: "OPENAI_DISCOVERY_MAX_OUTPUT_TOKENS",
    fallbackMaxOutputTokensEnv: "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: 3000,
    maxOutputTokensCap: 5000,
    reasoningEffort: "minimal",
    verbosity: "medium",
    structuredOutputMode: "json_object",
  });
}

export async function generateAutomationSuggestion(
  category: DiscoveryCategory,
  signals: WorkflowPainPointSignal[],
  options: {
    modelCall?: SuggestionModelCall;
    logger?: AutomationSuggestionLogger;
  } = {},
): Promise<AutomationSuggestion> {
  if (!options.modelCall && !process.env.OPENAI_API_KEY?.trim()) {
    throw new AutomationSuggestionConfigurationError("OPENAI_API_KEY is not configured.");
  }

  const modelCall = options.modelCall ?? defaultModelCall;
  const logger = options.logger ?? defaultLogger;
  let firstResponse: string;
  try {
    firstResponse = await modelCall(
      buildAutomationSuggestionPrompt(category, signals),
      automationSuggestionSystemPrompt,
    );
  } catch (error) {
    logDiagnostic(logger, "initial_model_call", error);
    throw new AutomationSuggestionGenerationError(
      "The AI model could not create a suggestion.",
      safeErrorCause(error),
    );
  }

  try {
    return buildFinalSuggestion(
      parseAutomationSuggestionModelResponse(firstResponse),
      category,
    );
  } catch (error) {
    logDiagnostic(logger, "initial_response_validation", error, firstResponse);
  }

  let repairedResponse: string;
  try {
    repairedResponse = await modelCall(
      buildAutomationSuggestionRepairPrompt(category, firstResponse, signals),
      automationSuggestionSystemPrompt,
    );
  } catch (error) {
    logDiagnostic(logger, "repair_model_call", error);
    throw new AutomationSuggestionGenerationError(
      "The AI model could not repair its suggestion.",
      safeErrorCause(error),
    );
  }

  try {
    return buildFinalSuggestion(
      parseAutomationSuggestionModelResponse(repairedResponse),
      category,
    );
  } catch (error) {
    logDiagnostic(logger, "repaired_response_validation", error, repairedResponse);
    throw new AutomationSuggestionGenerationError(
      "The AI model returned an invalid suggestion.",
      safeErrorCause(error),
    );
  }
}
