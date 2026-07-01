import process from "node:process";

type GeminiCallOptions = {
  modelEnv?: string;
  fallbackModelEnv?: string;
  maxOutputTokensEnv?: string;
  fallbackMaxOutputTokensEnv?: string;
  defaultModel?: string;
  defaultMaxOutputTokens?: number;
  maxOutputTokensCap?: number;
  timeoutMs?: number;
  truncationSuggestion?: string;
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

function outputTokensSettingLabel(envName: string | undefined, maxOutputTokens: number): string {
  return envName ? `${envName}=${maxOutputTokens}` : `maxOutputTokens=${maxOutputTokens}`;
}

export async function callGemini(
  prompt: string,
  systemPrompt: string,
  options: GeminiCallOptions = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelEnv = options.modelEnv ?? "GEMINI_MODEL";
  const maxOutputTokensEnv = options.maxOutputTokensEnv ?? "GEMINI_MAX_OUTPUT_TOKENS";
  const selectedModel = firstConfiguredEnvValue(modelEnv, options.fallbackModelEnv);
  const model = selectedModel.value || options.defaultModel || "gemini-1.5-flash";
  const configuredMaxOutputTokens = selectedNumberFromEnv(
    maxOutputTokensEnv,
    options.fallbackMaxOutputTokensEnv,
    options.defaultMaxOutputTokens ?? 1800,
  );
  const maxOutputTokens = options.maxOutputTokensCap
    ? Math.min(configuredMaxOutputTokens.value, options.maxOutputTokensCap)
    : configuredMaxOutputTokens.value;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");

      throw new Error(
        [
          `Gemini API error: ${response.status} ${response.statusText}`,
          errorBody ? `Response body: ${errorBody.slice(0, 800)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
        finishReason?: string;
      }>;
    };

    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text;
    const finishReason = candidate?.finishReason;

    if (finishReason === "MAX_TOKENS") {
      const tokenSetting = outputTokensSettingLabel(
        configuredMaxOutputTokens.envName,
        maxOutputTokens,
      );
      const suggestion = options.truncationSuggestion
        ?? `Raise ${configuredMaxOutputTokens.envName ?? "the Gemini max output token setting"} and retry.`;

      throw new Error(
        `Gemini response was truncated because ${tokenSetting} was too low for model ${model}. ${suggestion}`,
      );
    }

    if (!content) {
      throw new Error("Gemini API returned empty content.");
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

type GeminiAgentCallOptions = GeminiCallOptions;

export function callGeminiAgent(
  prompt: string,
  systemPrompt: string,
  options: GeminiAgentCallOptions = {},
): Promise<string> {
  return callGemini(prompt, systemPrompt, {
    ...options,
    modelEnv: options.modelEnv ?? "GEMINI_AGENT_MODEL",
    fallbackModelEnv: options.fallbackModelEnv ?? "GEMINI_AGENT_MODEL",
    maxOutputTokensEnv: options.maxOutputTokensEnv ?? "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
    fallbackMaxOutputTokensEnv:
      options.fallbackMaxOutputTokensEnv ?? "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
    defaultModel: options.defaultModel ?? "gemini-1.5-flash",
    defaultMaxOutputTokens: options.defaultMaxOutputTokens ?? 2200,
    maxOutputTokensCap: options.maxOutputTokensCap ?? 4000,
  });
}
