import { randomUUID } from "node:crypto";
import process from "node:process";
import { z } from "zod";
import { callGroqAgent } from "../services/groqProvider";
import { callOpenAI } from "../services/openaiProvider";

const discoveryCategories = [
  "surprise",
  "customer_support",
  "sales_crm",
  "marketing_content",
  "hr_recruiting",
  "finance_admin",
  "operations_projects",
  "ecommerce",
  "personal_productivity",
] as const;

type DiscoveryCategory =
  (typeof discoveryCategories)[number];

type ResolvedDiscoveryCategory = Exclude<
  DiscoveryCategory,
  "surprise"
>;

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

const requestSchema = z.object({
  category: z.enum(discoveryCategories),
});

const suggestionSchema = z.object({
  title: z
    .string()
    .min(5)
    .max(140),

  fitType: z.enum([
    "automation_only",
    "agent_only",
    "agentic_workflow",
  ]),

  painPoint: z
    .string()
    .min(10)
    .max(700),

  targetUser: z
    .string()
    .min(3)
    .max(300),

  whyItMatters: z
    .string()
    .min(10)
    .max(700),

  valueLevel: z.enum([
    "low",
    "medium",
    "high",
  ]),

  difficulty: z.enum([
    "low",
    "medium",
    "high",
  ]),

  confidence: z
    .number()
    .min(0)
    .max(100),

  workflowIntent: z
    .string()
    .min(20)
    .max(1200),

  suggestedSteps: z
    .array(
      z
        .string()
        .min(3)
        .max(300),
    )
    .min(3)
    .max(6),

  sourceIndex: z
    .number()
    .int()
    .min(0)
    .nullable(),
});

const categoryLabels: Record<
  DiscoveryCategory,
  string
> = {
  surprise: "Surprise me",
  customer_support: "Customer Support",
  sales_crm: "Sales and CRM",
  marketing_content: "Marketing and Content",
  hr_recruiting: "HR and Recruiting",
  finance_admin: "Finance and Administration",
  operations_projects:
    "Operations and Project Management",
  ecommerce: "E-commerce",
  personal_productivity:
    "Personal Productivity",
};

const categorySearchQueries: Record<
  ResolvedDiscoveryCategory,
  string
> = {
  customer_support:
    "common repetitive customer support workflow problems manual triage shared inbox escalation",

  sales_crm:
    "common sales CRM workflow problems manual data entry lead follow up deal handoff",

  marketing_content:
    "common marketing content workflow problems manual review publishing reporting",

  hr_recruiting:
    "common HR recruiting workflow problems manual screening scheduling onboarding",

  finance_admin:
    "common finance administration workflow problems invoice processing reconciliation approval",

  operations_projects:
    "common operations project management workflow problems handoffs status updates missing information",

  ecommerce:
    "common ecommerce workflow problems order fulfilment inventory exceptions returns customer notifications",

  personal_productivity:
    "common personal productivity workflow problems email tasks notes reminders information overload",
};

const surpriseCategories =
  discoveryCategories.filter(
    (
      category,
    ): category is ResolvedDiscoveryCategory =>
      category !== "surprise",
  );

const systemPrompt = `
You generate one practical automation opportunity for a lightweight idea-discovery feature.

The user is looking for inspiration, not a production implementation.

Turn real workflow pain points into one understandable automation idea.

Return valid JSON only.

Use exactly this structure:

{
  "title": "...",
  "fitType": "automation_only | agent_only | agentic_workflow",
  "painPoint": "...",
  "targetUser": "...",
  "whyItMatters": "...",
  "valueLevel": "low | medium | high",
  "difficulty": "low | medium | high",
  "confidence": 0,
  "workflowIntent": "...",
  "suggestedSteps": [
    "...",
    "...",
    "..."
  ],
  "sourceIndex": 0
}

Rules:

- Generate exactly one idea.
- Keep it understandable for a non-technical user.
- Focus on one useful and repetitive workflow problem.
- Do not create a technical implementation plan.
- Do not mention n8n nodes, APIs, schemas, prompts, deterministic logic, or software architecture.
- Do not ask clarification questions.
- Do not depend on a specific software product unless the research clearly requires it.
- Prefer generic terms such as shared inbox, CRM, task manager, project management tool, spreadsheet, internal review queue, or responsible team member.
- The workflow must contain a clear trigger, useful actions, and a final result.
- suggestedSteps must contain between 3 and 6 short steps.
- Keep each suggested step concrete and easy to understand.
- Do not include credentials, private data, or real people.
- Do not suggest fully automatic high-impact decisions.
- Include human review when the workflow involves payments, external messages, account changes, hiring decisions, legal decisions, refunds, or production updates.
- sourceIndex must refer to the most relevant research source using its zero-based index.
- If no research source directly supports the idea, use null.
- confidence must reflect how strongly the research supports the idea.
- When there is no research source, confidence should usually be between 55 and 75.
`.trim();

export default defineEventHandler(
  async (event) => {
    const body =
      await readBody<unknown>(event);

    const parsedRequest =
      requestSchema.safeParse(body);

    if (!parsedRequest.success) {
      throw createError({
        statusCode: 400,

        statusMessage:
          "Select a valid discovery category.",

        data: {
          message:
            "Select a valid discovery category.",
        },
      });
    }

    const selectedCategory =
      resolveCategory(
        parsedRequest.data.category,
      );

    let researchResults:
      TavilySearchResult[] = [];

    try {
      researchResults =
        await searchWorkflowPainPoints(
          selectedCategory,
        );
    } catch (error) {
      console.warn(
        "[suggest-automation] Tavily research unavailable:",
        safeErrorMessage(error),
      );
    }

    const prompt =
      buildSuggestionPrompt(
        selectedCategory,
        researchResults,
      );

    try {
      const openAIContent =
        await callOpenAI(
          prompt,
          systemPrompt,
          {
            modelEnv:
              "OPENAI_DISCOVERY_MODEL",

            fallbackModelEnv:
              "OPENAI_AGENT_MODEL",

            defaultModel:
              "gpt-4.1-mini",

            maxOutputTokensEnv:
              "OPENAI_DISCOVERY_MAX_OUTPUT_TOKENS",

            fallbackMaxOutputTokensEnv:
              "OPENAI_AGENT_MAX_OUTPUT_TOKENS",

            defaultMaxOutputTokens: 1800,

            maxOutputTokensCap: 3000,

            timeoutEnv:
              "OPENAI_DISCOVERY_TIMEOUT_MS",

            fallbackTimeoutEnv:
              "OPENAI_AGENT_TIMEOUT_MS",

            defaultTimeoutMs: 40_000,

            jsonMode: true,
          },
        );

      const generated =
        parseSuggestionResponse(
          openAIContent,
        );

      return buildPublicSuggestion(
        generated,
        selectedCategory,
        researchResults,
        {
          provider: "openai",
          fallbackUsed: false,
          openAIError: null,
        },
      );
    } catch (error) {
      const openAIError =
        safeErrorMessage(error);

      console.warn(
        "[suggest-automation] OpenAI failed:",
        openAIError,
      );

      try {
        const groqContent =
          await callGroqAgent(
            prompt,
            systemPrompt,
            {
              modelEnv:
                "GROQ_DISCOVERY_MODEL",

              fallbackModelEnv:
                "GROQ_AGENT_MODEL",

              maxTokensEnv:
                "GROQ_DISCOVERY_MAX_TOKENS",

              fallbackMaxTokensEnv:
                "GROQ_AGENT_MAX_TOKENS",

              defaultModel:
                "llama-3.1-8b-instant",

              defaultMaxTokens: 1400,
              maxTokensCap: 2400,
              timeoutMs: 25_000,
              jsonMode: true,
            },
          );

        const generated =
          parseSuggestionResponse(
            groqContent,
          );

        return buildPublicSuggestion(
          generated,
          selectedCategory,
          researchResults,
          {
            provider: "groq",
            fallbackUsed: true,
            openAIError,
          },
        );
      } catch (groqError) {
        const groqErrorMessage =
          safeErrorMessage(groqError);

        console.error(
          "[suggest-automation] All providers failed:",
          {
            openai: openAIError,
            groq: groqErrorMessage,
          },
        );

        throw createError({
          statusCode: 502,

          statusMessage:
            "Could not generate an automation idea.",

          data: {
            message:
              "OpenAI and the Groq fallback could not generate an automation idea. Check the provider configuration and try again.",

            providerAttempts: [
              {
                provider: "openai",
                success: false,
                error: openAIError,
              },
              {
                provider: "groq",
                success: false,
                error: groqErrorMessage,
              },
            ],
          },
        });
      }
    }
  },
);

function resolveCategory(
  requestedCategory: DiscoveryCategory,
): ResolvedDiscoveryCategory {
  if (
    requestedCategory !== "surprise"
  ) {
    return requestedCategory;
  }

  const randomIndex =
    Math.floor(
      Math.random() *
        surpriseCategories.length,
    );

  return surpriseCategories[
    randomIndex
  ]!;
}

async function searchWorkflowPainPoints(
  category: ResolvedDiscoveryCategory,
): Promise<TavilySearchResult[]> {
  const apiKey =
    process.env.TAVILY_API_KEY?.trim();

  if (!apiKey) {
    return [];
  }

  const query =
    categorySearchQueries[category];

  const configuredTimeout =
    Number(
      process.env
        .TAVILY_DISCOVERY_TIMEOUT_MS ||
        15_000,
    );

  const timeoutMs =
    Number.isFinite(
      configuredTimeout,
    ) &&
    configuredTimeout > 0
      ? configuredTimeout
      : 15_000;

  const controller =
    new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "basic",
          topic: "general",
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
        }),

        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const responseText =
        await response
          .text()
          .catch(() => "");

      throw new Error(
        [
          `Tavily API error: ${response.status} ${response.statusText}`,

          responseText
            ? responseText.slice(
                0,
                300,
              )
            : "",
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    const data =
      (await response.json()) as {
        results?: TavilySearchResult[];
      };

    return (data.results ?? [])
      .filter(
        (result) =>
          typeof result.title ===
            "string" &&
          typeof result.url ===
            "string" &&
          typeof result.content ===
            "string",
      )
      .slice(0, 5);
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Tavily request timed out after ${timeoutMs}ms.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSuggestionPrompt(
  category: ResolvedDiscoveryCategory,
  researchResults:
    TavilySearchResult[],
): string {
  const researchText =
    researchResults.length > 0
      ? researchResults
          .map(
            (
              result,
              index,
            ) => `
Source ${index}

Title:
${cleanText(result.title)}

URL:
${cleanText(result.url)}

Relevant extract:
${cleanText(result.content)}
`.trim(),
          )
          .join("\n\n")
      : `
No external research results are available.

Generate a practical idea from common workflow knowledge.

Keep the confidence conservative and use null for sourceIndex.
`.trim();

  return `
Generate one practical automation opportunity.

Selected category:
${categoryLabels[category]}

Research signals:
${researchText}

The result is for an idea-inspiration feature.

It should feel useful and specific, but remain simple.

The user may later convert the idea into one workflow sentence containing:

- a trigger;
- the main actions;
- a final result.

Do not generate that final sentence yet.

Return JSON only.
`.trim();
}

function parseSuggestionResponse(
  rawContent: string,
): z.infer<
  typeof suggestionSchema
> {
  const parsedJson =
    extractJsonObject(rawContent);

  const parsedSuggestion =
    suggestionSchema.safeParse(
      parsedJson,
    );

  if (
    !parsedSuggestion.success
  ) {
    const issues =
      parsedSuggestion.error.issues
        .slice(0, 4)
        .map(
          (issue) =>
            `${issue.path.join(".")}: ${issue.message}`,
        )
        .join("; ");

    throw new Error(
      `The AI provider returned an invalid suggestion: ${issues}`,
    );
  }

  const cleanedSteps =
    parsedSuggestion.data
      .suggestedSteps
      .map(cleanText)
      .filter(Boolean);

  if (cleanedSteps.length < 3) {
    throw new Error(
      "The AI provider returned fewer than three valid workflow steps.",
    );
  }

  return {
    ...parsedSuggestion.data,

    title: cleanText(
      parsedSuggestion.data.title,
    ),

    painPoint: cleanText(
      parsedSuggestion.data
        .painPoint,
    ),

    targetUser: cleanText(
      parsedSuggestion.data
        .targetUser,
    ),

    whyItMatters: cleanText(
      parsedSuggestion.data
        .whyItMatters,
    ),

    workflowIntent: cleanText(
      parsedSuggestion.data
        .workflowIntent,
    ),

    suggestedSteps:
      cleanedSteps,
  };
}

function buildPublicSuggestion(
  generated: z.infer<
    typeof suggestionSchema
  >,
  category:
    ResolvedDiscoveryCategory,
  researchResults:
    TavilySearchResult[],
  metadata: {
    provider: "openai" | "groq";
    fallbackUsed: boolean;
    openAIError: string | null;
  },
) {
  const selectedSource =
    generated.sourceIndex !== null
      ? researchResults[
          generated.sourceIndex
        ]
      : undefined;

  return {
    id: randomUUID(),

    title:
      generated.title,

    category,

    fitType:
      generated.fitType,

    painPoint:
      generated.painPoint,

    targetUser:
      generated.targetUser,

    whyItMatters:
      generated.whyItMatters,

    valueLevel:
      generated.valueLevel,

    difficulty:
      generated.difficulty,

    confidence:
      Math.round(
        generated.confidence,
      ),

    workflowIntent:
      generated.workflowIntent,

    suggestedSteps:
      generated.suggestedSteps,

    source:
      selectedSource?.title &&
      selectedSource?.url
        ? {
            title: cleanText(
              selectedSource.title,
            ),

            url:
              selectedSource.url,
          }
        : null,

    provider:
      metadata.provider,

    fallbackUsed:
      metadata.fallbackUsed,

    openAIError:
      metadata.openAIError,
  };
}

function extractJsonObject(
  rawContent: string,
): unknown {
  const trimmed =
    rawContent.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch =
      trimmed.match(
        /```(?:json)?\s*([\s\S]*?)```/i,
      );

    if (fencedMatch?.[1]) {
      try {
        return JSON.parse(
          fencedMatch[1].trim(),
        );
      } catch {
        // Continue to object extraction.
      }
    }

    const firstBrace =
      trimmed.indexOf("{");

    const lastBrace =
      trimmed.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      return JSON.parse(
        trimmed.slice(
          firstBrace,
          lastBrace + 1,
        ),
      );
    }

    throw new Error(
      "The AI provider did not return valid JSON.",
    );
  }
}

function cleanText(
  value: unknown,
): string {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .trim();
}

function safeErrorMessage(
  error: unknown,
): string {
  if (
    !(error instanceof Error)
  ) {
    return "Unknown provider error.";
  }

  return error.message
    .replace(
      /\bsk-(?:proj-)?[a-z0-9_-]{8,}\b/gi,
      "[REDACTED]",
    )
    .replace(
      /\bBearer\s+[^\s,}"']+/gi,
      "Bearer [REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}