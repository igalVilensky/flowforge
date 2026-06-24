import process from "node:process";

export async function callGemini(
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const maxOutputTokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1800);

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

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

    if (!content) {
      throw new Error("Gemini API returned empty content.");
    }

    if (finishReason === "MAX_TOKENS") {
      throw new Error(
        `Gemini response was truncated because maxOutputTokens=${maxOutputTokens} was too low.`,
      );
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}