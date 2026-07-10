import process from "node:process";

export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";
export type OpenAITextVerbosity = "low" | "medium" | "high";

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

export function resolveOpenAIAgentModel(
  options: Pick<
    OpenAICallOptions,
    "modelEnv" | "fallbackModelEnv" | "defaultModel"
  > = {},
): string {
  return firstConfiguredEnvValue(
    options.modelEnv,
    options.fallbackModelEnv ?? "OPENAI_AGENT_MODEL",
  ).value ?? options.defaultModel ?? "gpt-5-nano";
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: prompt,
        max_output_tokens: maxOutputTokens,
        reasoning: {
          effort: reasoningEffort,
        },
        text: {
          verbosity,
          format: {
            type: "json_object",
          },
        },
        store: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");

      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}` +
        (responseBody ? ` | Response body: ${responseBody}` : ""),
      );
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