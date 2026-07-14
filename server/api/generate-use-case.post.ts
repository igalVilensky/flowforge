import { z } from "zod";
import { callGroqAgent } from "../services/groqProvider";
import { callOpenAI } from "../services/openaiProvider";

const suggestionSchema = z.object({
  id: z.string().min(1),

  title: z.string().min(1),

  category: z.string().min(1),

  fitType: z.enum([
    "automation_only",
    "agent_only",
    "agentic_workflow",
  ]),

  painPoint: z.string().min(1),

  targetUser: z.string().min(1),

  whyItMatters: z.string().min(1),

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

  confidence: z.number(),

  workflowIntent: z.string().min(1),

  suggestedSteps: z
    .array(z.string())
    .default([]),

  source: z
    .object({
      title: z.string(),
      url: z.string(),
    })
    .nullable()
    .optional(),

  provider: z
    .enum(["openai", "groq"])
    .optional(),

  fallbackUsed: z
    .boolean()
    .optional(),

  openAIError: z
    .string()
    .nullable()
    .optional(),
});

const requestSchema = z.object({
  suggestion: suggestionSchema,
});

const providerResponseSchema = z.object({
  useCase: z
    .string()
    .min(20)
    .max(1800),
});

const systemPrompt = `
You convert an automation opportunity into one simple workflow use case.

The result must be easy for a normal user to understand and edit.

Create exactly one concise workflow description with this structure:

1. Trigger
Start with a clear triggering event such as:
- When something happens
- Whenever something changes
- Every morning
- Every week
- After something is completed

2. Main workflow
Explain the minimum important actions that happen after the trigger.

3. Final result
End with the useful outcome produced by the workflow.

Return valid JSON only.

Use exactly this JSON structure:

{
  "useCase": "..."
}

Rules:

- Return one complete paragraph.
- Prefer one sentence.
- Two sentences are allowed only when necessary for clarity.
- Do not create a technical implementation plan.
- Do not mention n8n nodes, APIs, schemas, prompts, agents, deterministic logic, or software architecture.
- Do not ask clarification questions.
- When a small detail is missing, make a reasonable generic assumption.
- Do not invent specific people, email addresses, prices, product names, company rules, or credentials.
- Prefer generic terms such as CRM, shared inbox, spreadsheet, project management tool, internal review task, responsible team member, or operations team.
- Preserve the original business purpose.
- Keep the workflow simple.
- Include only the minimum actions required to understand the idea.
- The final text must clearly contain a trigger, the actions in between, and the final result.
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
          "Invalid automation suggestion.",

        data: {
          message:
            "The generated idea is missing required information and cannot be converted into a use case.",

          issues:
            parsedRequest.error.issues,
        },
      });
    }

    const suggestion =
      parsedRequest.data.suggestion;

    const prompt =
      buildPrompt(suggestion);

    try {
      const openAIContent =
        await callOpenAI(
          prompt,
          systemPrompt,
          {
            modelEnv:
              "OPENAI_USE_CASE_MODEL",

            fallbackModelEnv:
              "OPENAI_AGENT_MODEL",

            defaultModel:
              "gpt-4.1-mini",

            maxOutputTokensEnv:
              "OPENAI_USE_CASE_MAX_OUTPUT_TOKENS",

            fallbackMaxOutputTokensEnv:
              "OPENAI_AGENT_MAX_OUTPUT_TOKENS",

            defaultMaxOutputTokens: 900,

            maxOutputTokensCap: 1600,

            timeoutEnv:
              "OPENAI_USE_CASE_TIMEOUT_MS",

            fallbackTimeoutEnv:
              "OPENAI_AGENT_TIMEOUT_MS",

            defaultTimeoutMs: 30_000,

            jsonMode: true,
          },
        );

      const useCase =
        parseProviderResponse(
          openAIContent,
        );

      return {
        useCase,

        provider:
          "openai" as const,

        fallbackUsed: false,

        openAIError: null,
      };
    } catch (error) {
      const openAIError =
        safeErrorMessage(error);

      console.warn(
        "[generate-use-case] OpenAI failed:",
        openAIError,
      );

      try {
        const groqContent =
          await callGroqAgent(
            prompt,
            systemPrompt,
            {
              modelEnv:
                "GROQ_USE_CASE_MODEL",

              fallbackModelEnv:
                "GROQ_AGENT_MODEL",

              maxTokensEnv:
                "GROQ_USE_CASE_MAX_TOKENS",

              fallbackMaxTokensEnv:
                "GROQ_AGENT_MAX_TOKENS",

              defaultModel:
                "llama-3.1-8b-instant",

              defaultMaxTokens: 700,

              maxTokensCap: 1200,

              timeoutMs: 20_000,

              jsonMode: true,
            },
          );

        const useCase =
          parseProviderResponse(
            groqContent,
          );

        return {
          useCase,

          provider:
            "groq" as const,

          fallbackUsed: true,

          openAIError,
        };
      } catch (groqError) {
        const groqErrorMessage =
          safeErrorMessage(groqError);

        console.error(
          "[generate-use-case] All providers failed:",
          {
            openai: openAIError,
            groq: groqErrorMessage,
          },
        );

        throw createError({
          statusCode: 502,

          statusMessage:
            "AI providers unavailable.",

          data: {
            message:
              "OpenAI and the Groq fallback could not generate the use case. Check the provider configuration and try again.",

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

function buildPrompt(
  suggestion: z.infer<
    typeof suggestionSchema
  >,
): string {
  const steps =
    suggestion.suggestedSteps.length > 0
      ? suggestion.suggestedSteps
          .map(
            (step, index) =>
              `${index + 1}. ${step}`,
          )
          .join("\n")
      : "No suggested steps were provided.";

  return `
Convert this automation opportunity into one simple editable workflow use case.

Title:
${suggestion.title}

Target user:
${suggestion.targetUser}

Pain point:
${suggestion.painPoint}

Why it matters:
${suggestion.whyItMatters}

Initial workflow intent:
${suggestion.workflowIntent}

Possible workflow steps:
${steps}

Create one simple workflow description containing:

- a clear trigger;
- the minimum important actions;
- a clear final result.

Do not add implementation details.

Return JSON only.
`.trim();
}

function parseProviderResponse(
  rawContent: string,
): string {
  const parsedJson =
    extractJsonObject(rawContent);

  const parsedResponse =
    providerResponseSchema.safeParse(
      parsedJson,
    );

  if (!parsedResponse.success) {
    const issues =
      parsedResponse.error.issues
        .slice(0, 3)
        .map(
          (issue) =>
            `${issue.path.join(".")}: ${issue.message}`,
        )
        .join("; ");

    throw new Error(
      `The AI provider returned an invalid use-case response: ${issues}`,
    );
  }

  return normalizeUseCase(
    parsedResponse.data.useCase,
  );
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

function normalizeUseCase(
  value: string,
): string {
  const normalized =
    value
      .replace(/\s+/g, " ")
      .trim();

  if (normalized.length < 20) {
    throw new Error(
      "The generated use case was too short.",
    );
  }

  if (normalized.length > 1800) {
    return normalized
      .slice(0, 1800)
      .trim();
  }

  return normalized;
}

function safeErrorMessage(
  error: unknown,
): string {
  if (!(error instanceof Error)) {
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