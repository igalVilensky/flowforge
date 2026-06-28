import process from "node:process";

type GroqCallOptions = {
  apiKeyEnv?: string;
  modelEnv?: string;
  maxTokensEnv?: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  maxTokensCap?: number;
  timeoutMs?: number;
};

export async function callGroq(
  prompt: string,
  systemPrompt: string,
  options: GroqCallOptions = {},
): Promise<string> {
  const apiKeyEnv = options.apiKeyEnv ?? "GROQ_API_KEY";
  const modelEnv = options.modelEnv ?? "GROQ_MODEL";
  const maxTokensEnv = options.maxTokensEnv ?? "GROQ_MAX_TOKENS";
  const apiKey = process.env[apiKeyEnv];
  const model = process.env[modelEnv] || options.defaultModel || "llama-3.1-8b-instant";
  const configuredMaxTokens = Number(process.env[maxTokensEnv] || options.defaultMaxTokens || 900);
  const maxTokens = options.maxTokensCap
    ? Math.min(configuredMaxTokens, options.maxTokensCap)
    : configuredMaxTokens;

  if (!apiKey) {
    throw new Error(`${apiKeyEnv} is not set.`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
      }),
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

    if (!content) {
      throw new Error("Groq API returned empty content.");
    }

    if (finishReason === "length") {
      throw new Error(
        `Groq response was truncated because max_tokens=${maxTokens} was too low.`,
      );
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}
