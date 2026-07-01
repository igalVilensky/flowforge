import process from "node:process";

type GroqCallOptions = {
  apiKeyEnv?: string;
  modelEnv?: string;
  fallbackModelEnv?: string;
  maxTokensEnv?: string;
  fallbackMaxTokensEnv?: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  maxTokensCap?: number;
  timeoutMs?: number;
  truncationSuggestion?: string;
  jsonMode?: boolean;
};

type SelectedEnvValue = {
  envName?: string;
  value?: string;
};

function firstConfiguredEnvValue(primaryEnv?: string, fallbackEnv?: string): SelectedEnvValue {
  const envNames = [primaryEnv, fallbackEnv].filter(
    (envName, index, values): envName is string =>
      Boolean(envName) && values.indexOf(envName) === index,
  );

  for (const envName of envNames) {
    const value = process.env[envName];

    if (value !== undefined && value.trim() !== "") {
      return { envName, value };
    }
  }

  return {};
}

function selectedNumberFromEnv(
  primaryEnv: string | undefined,
  fallbackEnv: string | undefined,
  defaultValue: number,
): { envName?: string; value: number } {
  const selected = firstConfiguredEnvValue(primaryEnv, fallbackEnv);
  const parsedValue = selected.value ? Number(selected.value) : NaN;

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return { envName: selected.envName, value: parsedValue };
  }

  return { envName: selected.envName ?? primaryEnv ?? fallbackEnv, value: defaultValue };
}

function maxTokensSettingLabel(envName: string | undefined, maxTokens: number): string {
  return envName ? `${envName}=${maxTokens}` : `max_tokens=${maxTokens}`;
}

export async function callGroq(
  prompt: string,
  systemPrompt: string,
  options: GroqCallOptions = {},
): Promise<string> {
  const apiKeyEnv = options.apiKeyEnv ?? "GROQ_API_KEY";
  const modelEnv = options.modelEnv ?? "GROQ_MODEL";
  const maxTokensEnv = options.maxTokensEnv ?? "GROQ_MAX_TOKENS";
  const apiKey = process.env[apiKeyEnv];
  const selectedModel = firstConfiguredEnvValue(modelEnv, options.fallbackModelEnv);
  const model = selectedModel.value || options.defaultModel || "openai/gpt-oss-120b";
  const configuredMaxTokens = selectedNumberFromEnv(
    maxTokensEnv,
    options.fallbackMaxTokensEnv,
    options.defaultMaxTokens ?? 10000,
  );
  const maxTokens = options.maxTokensCap
    ? Math.min(configuredMaxTokens.value, options.maxTokensCap)
    : configuredMaxTokens.value;

  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is not set.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    };

    if (options.jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");

      throw new Error(
        [
          `Groq API error: ${response.status} ${response.statusText}`,
          errorBody ? `Response body: ${errorBody.slice(0, 800)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;

    if (finishReason === "length") {
      const tokenSetting = maxTokensSettingLabel(configuredMaxTokens.envName, maxTokens);
      const suggestion = options.truncationSuggestion
        ?? `Raise ${configuredMaxTokens.envName ?? "the Groq max token setting"} and retry.`;

      throw new Error(
        `Groq response was truncated because ${tokenSetting} was too low for model ${model}. ${suggestion}`,
      );
    }

    if (!content) {
      throw new Error("Groq API returned empty content.");
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

type GroqAgentCallOptions = Omit<GroqCallOptions, "apiKeyEnv">;

export function callGroqAgent(
  prompt: string,
  systemPrompt: string,
  options: GroqAgentCallOptions = {},
): Promise<string> {
  return callGroq(prompt, systemPrompt, {
    ...options,
    modelEnv: options.modelEnv ?? "GROQ_AGENT_MODEL",
    fallbackModelEnv: options.fallbackModelEnv ?? "GROQ_AGENT_MODEL",
    maxTokensEnv: options.maxTokensEnv ?? "GROQ_AGENT_MAX_TOKENS",
    fallbackMaxTokensEnv: options.fallbackMaxTokensEnv ?? "GROQ_AGENT_MAX_TOKENS",
    defaultModel: options.defaultModel ?? "llama-3.1-8b-instant",
    defaultMaxTokens: options.defaultMaxTokens ?? 2200,
    maxTokensCap: options.maxTokensCap ?? 4000,
  });
}
