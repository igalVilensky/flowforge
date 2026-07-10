import process from "node:process";

export type OpenAICallOptions = {
  modelEnv?: string;
  fallbackModelEnv?: string;
  defaultModel?: string;
  maxOutputTokensEnv?: string;
  fallbackMaxOutputTokensEnv?: string;
  defaultMaxOutputTokens?: number;
  maxOutputTokensCap?: number;
  timeoutMs?: number;
};

type SelectedEnvValue = {
  envName?: string;
  value?: string;
};

function firstConfiguredEnvValue(primaryEnv?: string, fallbackEnv?: string): SelectedEnvValue {
  const envNames = [primaryEnv, fallbackEnv].filter(
    (envName, index, values): envName is string => Boolean(envName) && values.indexOf(envName) === index,
  );

  for (const envName of envNames) {
    const value = process.env[envName];
    if (value !== undefined && value.trim() !== "") return { envName, value: value.trim() };
  }

  return {};
}

function selectedNumberFromEnv(
  primaryEnv: string | undefined,
  fallbackEnv: string | undefined,
  defaultValue: number,
): number {
  const selected = firstConfiguredEnvValue(primaryEnv, fallbackEnv);
  const parsedValue = selected.value ? Number(selected.value) : NaN;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

export function resolveOpenAIAgentModel(options: Pick<OpenAICallOptions, "modelEnv" | "fallbackModelEnv" | "defaultModel"> = {}): string {
  return firstConfiguredEnvValue(
    options.modelEnv,
    options.fallbackModelEnv ?? "OPENAI_AGENT_MODEL",
  ).value ?? options.defaultModel ?? "gpt-5-nano";
}

function extractOutputText(data: {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
}): string | undefined {
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;

    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new Error("OpenAI declined to produce the requested structured response.");
      }

      if (content.type === "output_text" && content.text?.trim()) {
        return content.text;
      }
    }
  }

  return undefined;
}

export async function callOpenAI(
  prompt: string,
  systemPrompt: string,
  options: OpenAICallOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = resolveOpenAIAgentModel(options);
  const configuredMaxOutputTokens = selectedNumberFromEnv(
    options.maxOutputTokensEnv,
    options.fallbackMaxOutputTokensEnv,
    options.defaultMaxOutputTokens ?? 2200,
  );
  const maxOutputTokens = options.maxOutputTokensCap
    ? Math.min(configuredMaxOutputTokens, options.maxOutputTokensCap)
    : configuredMaxOutputTokens;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: prompt,
        max_output_tokens: maxOutputTokens,
        store: false,
        text: {
          format: { type: "json_object" },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}.`);
    }

    const data = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
          refusal?: string;
        }>;
      }>;
    };

    if (data.status === "incomplete") {
      const reason = data.incomplete_details?.reason ?? "unknown reason";
      throw new Error(`OpenAI response was incomplete: ${reason}.`);
    }

    const content = extractOutputText(data);
    if (!content) throw new Error("OpenAI API returned empty content.");
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI request timed out.");
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
    fallbackModelEnv: options.fallbackModelEnv ?? "OPENAI_AGENT_MODEL",
    defaultModel: options.defaultModel ?? "gpt-5-nano",
    maxOutputTokensEnv: options.maxOutputTokensEnv ?? "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    fallbackMaxOutputTokensEnv: options.fallbackMaxOutputTokensEnv ?? "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
    defaultMaxOutputTokens: options.defaultMaxOutputTokens ?? 2200,
    maxOutputTokensCap: options.maxOutputTokensCap ?? 4000,
  });
}
