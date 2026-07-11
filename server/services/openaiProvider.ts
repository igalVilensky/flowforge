import process from "node:process";

export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
export type OpenAITextVerbosity = "low" | "medium" | "high";
export type OpenAIStructuredOutputMode = "none" | "json_object";
export type OpenAIFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const OPENAI_RESPONSES_ENDPOINT =
  "https://api.openai.com/v1/responses";

export type OpenAICallOptions = {
  modelEnv?: string;
  fallbackModelEnv?: string;
  defaultModel?: string;
  maxOutputTokensEnv?: string;
  fallbackMaxOutputTokensEnv?: string;
  defaultMaxOutputTokens?: number;
  maxOutputTokensCap?: number;
  timeoutMs?: number;
  timeoutEnv?: string;
  reasoningEffort?: OpenAIReasoningEffort;
  verbosity?: OpenAITextVerbosity;
  structuredOutputMode?: OpenAIStructuredOutputMode;
  fetchImpl?: OpenAIFetch;
};

export type OpenAIModelResolution = {
  primaryModelEnv?: string;
  fallbackModelEnv: string;
  selectedModelEnv?: string;
  fallbackUsed: boolean;
  model: string;
  endpoint: typeof OPENAI_RESPONSES_ENDPOINT;
};

export type OpenAIModelCapabilities = {
  reasoningControls: boolean;
  verbosity: boolean;
  jsonObjectFormat: boolean;
};

export type BuildOpenAIResponsesRequestInput = {
  model: string;
  prompt: string;
  systemPrompt: string;
  maxOutputTokens: number;
  reasoningEffort?: OpenAIReasoningEffort;
  verbosity?: OpenAITextVerbosity;
  structuredOutputMode?: OpenAIStructuredOutputMode;
  minimal?: boolean;
};

export type OpenAIResponsesRequest = {
  model: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  store: false;
  reasoning?: {
    effort: OpenAIReasoningEffort;
  };
  text?: {
    verbosity?: OpenAITextVerbosity;
    format?: {
      type: "json_object";
    };
  };
};

type SelectedEnvValue = {
  envName?: string;
  value?: string;
};

type OpenAIResponseData = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

export type OpenAIErrorResponseFields = {
  message?: string;
  type?: string;
  param?: string;
  code?: string;
};

export class OpenAIAPIError extends Error {
  status: number;
  statusText: string;
  details: OpenAIErrorResponseFields;

  constructor(input: {
    status: number;
    statusText: string;
    details: OpenAIErrorResponseFields;
    message: string;
  }) {
    super(input.message);
    this.name = "OpenAIAPIError";
    this.status = input.status;
    this.statusText = input.statusText;
    this.details = input.details;
  }
}

function firstConfiguredEnvValue(
  primaryEnv?: string,
  fallbackEnv?: string,
): SelectedEnvValue {
  const envNames = [primaryEnv, fallbackEnv].filter(
    (envName, index, values): envName is string =>
      Boolean(envName) && values.indexOf(envName) === index,
  );

  for (const envName of envNames) {
    const value = process.env[envName];

    if (value !== undefined && value.trim() !== "") {
      return {
        envName,
        value: value.trim(),
      };
    }
  }

  return {};
}

function selectedNumberFromEnv(
  primaryEnv: string | undefined,
  fallbackEnv: string | undefined,
  defaultValue: number,
): number {
  const selected = firstConfiguredEnvValue(primaryEnv, fallbackEnv);
  const parsedValue = selected.value ? Number(selected.value) : Number.NaN;

  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : defaultValue;
}

function configuredPositiveNumber(
  envName: string | undefined,
): number | undefined {
  if (!envName) {
    return undefined;
  }

  const value = process.env[envName];

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function inferStageMaxOutputTokensEnv(
  modelEnv: string | undefined,
): string | undefined {
  if (modelEnv === "OPENAI_CLARIFIER_MODEL") {
    return "OPENAI_CLARIFIER_MAX_OUTPUT_TOKENS";
  }

  if (modelEnv === "OPENAI_BLUEPRINT_MODEL") {
    return "OPENAI_BLUEPRINT_MAX_OUTPUT_TOKENS";
  }

  if (modelEnv === "OPENAI_SAFETY_MODEL") {
    return "OPENAI_SAFETY_MAX_OUTPUT_TOKENS";
  }

  return undefined;
}

function inferStageTimeoutEnv(
  modelEnv: string | undefined,
): string | undefined {
  if (modelEnv === "OPENAI_CLARIFIER_MODEL") {
    return "OPENAI_CLARIFIER_TIMEOUT_MS";
  }

  if (modelEnv === "OPENAI_BLUEPRINT_MODEL") {
    return "OPENAI_BLUEPRINT_TIMEOUT_MS";
  }

  if (modelEnv === "OPENAI_SAFETY_MODEL") {
    return "OPENAI_SAFETY_TIMEOUT_MS";
  }

  return undefined;
}

export function resolveOpenAIModelSelection(
  options: Pick<
    OpenAICallOptions,
    "modelEnv" | "fallbackModelEnv" | "defaultModel"
  > = {},
): OpenAIModelResolution {
  const fallbackModelEnv =
    options.fallbackModelEnv ??
    "OPENAI_AGENT_MODEL";

  const selected = firstConfiguredEnvValue(
    options.modelEnv,
    fallbackModelEnv,
  );

  return {
    primaryModelEnv: options.modelEnv,
    fallbackModelEnv,
    selectedModelEnv: selected.envName,
    fallbackUsed: Boolean(
      options.modelEnv &&
      options.modelEnv !== fallbackModelEnv &&
      selected.envName === fallbackModelEnv
    ),
    model:
      selected.value ??
      options.defaultModel ??
      "gpt-5-nano",
    endpoint: OPENAI_RESPONSES_ENDPOINT,
  };
}

export function resolveOpenAIAgentModel(
  options: Pick<
    OpenAICallOptions,
    "modelEnv" | "fallbackModelEnv" | "defaultModel"
  > = {},
): string {
  return resolveOpenAIModelSelection(
    options,
  ).model;
}

export function resolveOpenAIModelCapabilities(
  model: string,
): OpenAIModelCapabilities {
  const normalized = model
    .trim()
    .toLowerCase();

  const isGpt5 =
    /(?:^|:)gpt-5(?:[.-]|$)/.test(
      normalized,
    );

  const supportsModernStructuredOutput =
    isGpt5 ||
    /(?:^|:)gpt-4o(?:[.-]|$)/.test(
      normalized,
    ) ||
    /(?:^|:)gpt-4\.1(?:[.-]|$)/.test(
      normalized,
    ) ||
    /(?:^|:)o[134](?:[.-]|$)/.test(
      normalized,
    );

  return {
    reasoningControls: isGpt5,
    verbosity: isGpt5,
    jsonObjectFormat:
      supportsModernStructuredOutput,
  };
}

export function buildOpenAIResponsesRequest(
  input: BuildOpenAIResponsesRequestInput,
): OpenAIResponsesRequest {
  const request: OpenAIResponsesRequest = {
    model: input.model,
    instructions: input.systemPrompt,
    input: input.prompt,
    max_output_tokens:
      input.maxOutputTokens,
    store: false,
  };

  if (input.minimal) {
    return request;
  }

  const capabilities =
    resolveOpenAIModelCapabilities(
      input.model,
    );

  if (
    input.reasoningEffort &&
    capabilities.reasoningControls
  ) {
    request.reasoning = {
      effort: input.reasoningEffort,
    };
  }

  const text:
    NonNullable<
      OpenAIResponsesRequest["text"]
    > = {};

  if (
    input.verbosity &&
    capabilities.verbosity
  ) {
    text.verbosity = input.verbosity;
  }

  if (
    input.structuredOutputMode ===
      "json_object" &&
    capabilities.jsonObjectFormat
  ) {
    text.format = {
      type: "json_object",
    };
  }

  if (Object.keys(text).length > 0) {
    request.text = text;
  }

  return request;
}

function boundedText(
  value: string,
  maxLength = 500,
): string {
  const normalized = value
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(
    0,
    Math.max(0, maxLength - 1),
  )}…`;
}

function redactSensitiveText(
  value: string,
  secrets: readonly string[],
): string {
  let redacted = value;

  for (const secret of secrets) {
    const normalizedSecret =
      secret.trim();

    if (normalizedSecret) {
      redacted = redacted.replaceAll(
        normalizedSecret,
        "[REDACTED]",
      );
    }
  }

  return redacted
    .replace(
      /(["']?authorization["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^"',\s}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\bbearer\s+[^"',\s}]+/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      /\bOPENAI_API_KEY\s*[:=]\s*[^\s,"'}]+/gi,
      "OPENAI_API_KEY=[REDACTED]",
    )
    .replace(
      /\bsk-(?:proj-)?[a-z0-9_-]{8,}\b/gi,
      "[REDACTED]",
    );
}

function safeErrorField(
  value: unknown,
  secrets: readonly string[],
): string | undefined {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }

  return boundedText(
    redactSensitiveText(
      String(value),
      secrets,
    ),
    360,
  );
}

export function parseOpenAIErrorResponse(
  responseBody: string,
  secrets: readonly string[] = [],
): OpenAIErrorResponseFields {
  try {
    const parsed = JSON.parse(
      responseBody,
    ) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const root = parsed as
      Record<string, unknown>;

    const candidate =
      root.error &&
      typeof root.error === "object" &&
      !Array.isArray(root.error)
        ? root.error as
            Record<string, unknown>
        : root;

    return {
      message: safeErrorField(
        candidate.message,
        secrets,
      ),
      type: safeErrorField(
        candidate.type,
        secrets,
      ),
      param: safeErrorField(
        candidate.param,
        secrets,
      ),
      code: safeErrorField(
        candidate.code,
        secrets,
      ),
    };
  } catch {
    return {};
  }
}

export function sanitizeOpenAIErrorResponse(
  responseBody: string,
  options: {
    secrets?: readonly string[];
    maxLength?: number;
  } = {},
): string {
  const secrets = options.secrets ?? [];
  const details = parseOpenAIErrorResponse(
    responseBody,
    secrets,
  );

  const fields = [
    details.message
      ? `message: ${details.message}`
      : "",
    details.type
      ? `type: ${details.type}`
      : "",
    details.param
      ? `param: ${details.param}`
      : "",
    details.code
      ? `code: ${details.code}`
      : "",
  ].filter(Boolean);

  const summary = fields.length > 0
    ? fields.join(" | ")
    : responseBody
      ? `response: ${redactSensitiveText(
          responseBody,
          secrets,
        )}`
      : "";

  return boundedText(
    summary,
    options.maxLength ?? 500,
  );
}

function buildOpenAIAPIError(
  response: Response,
  responseBody: string,
  secrets: readonly string[],
): OpenAIAPIError {
  const details = parseOpenAIErrorResponse(
    responseBody,
    secrets,
  );

  const responseSummary =
    sanitizeOpenAIErrorResponse(
      responseBody,
      {
        secrets,
        maxLength: 400,
      },
    );

  const statusSummary =
    `OpenAI API error: ${response.status}${
      response.statusText
        ? ` ${response.statusText}`
        : ""
    }`;

  return new OpenAIAPIError({
    status: response.status,
    statusText:
      response.statusText,
    details,
    message: boundedText(
      responseSummary
        ? `${statusSummary} | ${responseSummary}`
        : statusSummary,
      500,
    ),
  });
}

export function shouldRetryOpenAIWithMinimalRequest(
  error: OpenAIAPIError,
): boolean {
  if (error.status !== 400) {
    return false;
  }

  const detailText = [
    error.details.message,
    error.details.type,
    error.details.param,
    error.details.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /auth|api.?key|billing|quota|credit|balance|rate.?limit/.test(
      detailText,
    )
  ) {
    return false;
  }

  return (
    /\breasoning(?:\.effort)?\b/.test(
      detailText,
    ) ||
    /\b(?:text\.)?verbosity\b/.test(
      detailText,
    ) ||
    /\btext\.format\b/.test(
      detailText,
    ) ||
    /\bjson_object\b/.test(
      detailText,
    ) ||
    /unsupported response format/.test(
      detailText,
    )
  );
}

function extractOutputText(data: OpenAIResponseData): string | undefined {
  for (const item of data.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error(
          content.refusal?.trim()
            ? `OpenAI declined the request: ${content.refusal.trim()}`
            : "OpenAI declined to produce the requested structured response.",
        );
      }

      if (content.type === "output_text" && content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  return undefined;
}

function buildIncompleteResponseError(data: OpenAIResponseData): Error {
  const reason = data.incomplete_details?.reason ?? "unknown reason";

  if (reason === "max_output_tokens") {
    return new Error(
      "OpenAI response was incomplete: max_output_tokens. " +
      "The model exhausted its output budget before completing the structured response.",
    );
  }

  return new Error(`OpenAI response was incomplete: ${reason}.`);
}

export async function callOpenAI(
  prompt: string,
  systemPrompt: string,
  options: OpenAICallOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = resolveOpenAIAgentModel(options);

  const stageMaxOutputTokensEnv = inferStageMaxOutputTokensEnv(
    options.modelEnv,
  );

  const configuredMaxOutputTokens = selectedNumberFromEnv(
    options.maxOutputTokensEnv ?? stageMaxOutputTokensEnv,
    options.fallbackMaxOutputTokensEnv ?? "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    options.defaultMaxOutputTokens ?? 2200,
  );

  const maxOutputTokens = options.maxOutputTokensCap
    ? Math.min(configuredMaxOutputTokens, options.maxOutputTokensCap)
    : configuredMaxOutputTokens;

  const stageTimeoutEnv = inferStageTimeoutEnv(options.modelEnv);

  const timeoutMs =
    options.timeoutMs ??
    configuredPositiveNumber(options.timeoutEnv ?? stageTimeoutEnv) ??
    configuredPositiveNumber("OPENAI_AGENT_TIMEOUT_MS") ??
    45000;

  const reasoningEffort = options.reasoningEffort ?? "minimal";
  const verbosity = options.verbosity ?? "low";
  const structuredOutputMode =
    options.structuredOutputMode ??
    "json_object";
  const fetchImpl =
    options.fetchImpl ?? fetch;

  const requestInput:
    BuildOpenAIResponsesRequestInput = {
      model,
      prompt,
      systemPrompt,
      maxOutputTokens,
      reasoningEffort,
      verbosity,
      structuredOutputMode,
    };

  const firstRequest =
    buildOpenAIResponsesRequest(
      requestInput,
    );

  const minimalRequest =
    buildOpenAIResponsesRequest({
      ...requestInput,
      minimal: true,
    });

  const secrets = [
    apiKey,
    prompt,
    systemPrompt,
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const executeRequest = (
    body: OpenAIResponsesRequest,
  ) => fetchImpl(
    OPENAI_RESPONSES_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${apiKey.trim()}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    },
  );

  try {
    let response =
      await executeRequest(
        firstRequest,
      );

    if (!response.ok) {
      const responseBody =
        await response.text().catch(
          () => "",
        );

      const firstError =
        buildOpenAIAPIError(
          response,
          responseBody,
          secrets,
        );

      const hasOptionalFields =
        Boolean(
          firstRequest.reasoning ||
          firstRequest.text,
        );

      if (
        !hasOptionalFields ||
        !shouldRetryOpenAIWithMinimalRequest(
          firstError,
        )
      ) {
        throw firstError;
      }

      response = await executeRequest(
        minimalRequest,
      );

      if (!response.ok) {
        const retryResponseBody =
          await response.text().catch(
            () => "",
          );

        const retryError =
          buildOpenAIAPIError(
            response,
            retryResponseBody,
            secrets,
          );

        const initialDetail = [
          firstError.details.message,
          firstError.details.param
            ? `param: ${firstError.details.param}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");

        throw new OpenAIAPIError({
          status: retryError.status,
          statusText:
            retryError.statusText,
          details: retryError.details,
          message: boundedText(
            `OpenAI compatibility retry failed` +
            (initialDetail
              ? ` | initial: ${initialDetail}`
              : "") +
            ` | retry: ${retryError.message}`,
            500,
          ),
        });
      }
    }

    const data = await response.json() as OpenAIResponseData;

    if (data.status === "incomplete") {
      throw buildIncompleteResponseError(data);
    }

    const content = extractOutputText(data);

    if (!content) {
      throw new Error("OpenAI API returned empty content.");
    }

    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `OpenAI request timed out after ${timeoutMs}ms.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function callOpenAIAgent(
  prompt: string,
  systemPrompt: string,
  options: OpenAICallOptions = {},
): Promise<string> {
  return callOpenAI(prompt, systemPrompt, {
    ...options,
    modelEnv: options.modelEnv ?? "OPENAI_AGENT_MODEL",
    fallbackModelEnv:
      options.fallbackModelEnv ?? "OPENAI_AGENT_MODEL",
    defaultModel: options.defaultModel ?? "gpt-5-nano",
    fallbackMaxOutputTokensEnv:
      options.fallbackMaxOutputTokensEnv ??
      "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens:
      options.defaultMaxOutputTokens ?? 2200,
    maxOutputTokensCap:
      options.maxOutputTokensCap ?? 5000,
    reasoningEffort:
      options.reasoningEffort ?? "minimal",
    verbosity:
      options.verbosity ?? "low",
  });
}
