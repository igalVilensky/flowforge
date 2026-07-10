import { ZodError } from "zod";
import type {
  ClarificationNextQuestion,
  ClarificationQuestionKind,
  ClarificationSession,
  ClarificationSessionAnswer,
  ClarificationSessionResponse,
} from "../../shared/types/clarificationSession";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
import {
  clarificationSessionResponseSchema,
  clarificationSessionSchema,
} from "../schemas/clarificationSession.schema";
import {
  buildClarificationConversationUserPrompt,
  clarificationConversationSystemPrompt,
} from "../prompts/clarificationConversationPrompt";
import {
  getClarificationAnswerKind,
  inferStructuredWorkflowIntent,
  isConcreteKnownFact,
} from "./clarificationFacts";
import { callGeminiAgent } from "./geminiProvider";
import { callGroqAgent } from "./groqProvider";
import { callOpenAIAgent } from "./openaiProvider";
import { serializeStructuredCompileInput } from "./structuredCompileInput";
import { assessStructuredWorkflowIntentReadiness } from "./structuredIntentReadiness";

type AgentProvider = Exclude<
  ClarificationSessionResponse["provider"],
  "deterministic"
>;

type RunClarificationConversationAgentInput = {
  originalInput: string;
  answers: ClarificationSessionAnswer[];
};

type ClarificationProviderCall = (
  userPrompt: string,
  systemPrompt: string,
) => Promise<string>;

export type ClarificationProviderDependencies = {
  calls?: Partial<Record<AgentProvider, ClarificationProviderCall>>;
  availability?: Partial<Record<AgentProvider, boolean>>;
};

const SOFT_MAX_CLARIFICATION_QUESTIONS = 6;
const HARD_MAX_CLARIFICATION_QUESTIONS = 9;

const PROVIDER_ORDER: readonly AgentProvider[] = [
  "openai",
  "groq",
  "gemini",
];

const QUESTION_ID_ALIASES = new Map<
  string,
  {
    questionId: string;
    kind: ClarificationQuestionKind;
  }
>([
  [
    "desired_output",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "desired_outputs",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "desired_output_formats",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "output_formats",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "asset_formats",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "generated_assets",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "deliverables",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "content_specifications",
    {
      questionId: "desired_output",
      kind: "desired_output",
    },
  ],
  [
    "input_data",
    {
      questionId: "input_data",
      kind: "input_data",
    },
  ],
  [
    "input_data_details",
    {
      questionId: "input_data",
      kind: "input_data",
    },
  ],
  [
    "input_requirements",
    {
      questionId: "input_data",
      kind: "input_data",
    },
  ],
  [
    "product_information",
    {
      questionId: "input_data",
      kind: "input_data",
    },
  ],
  [
    "human_owner",
    {
      questionId: "human_owner",
      kind: "human_owner",
    },
  ],
  [
    "human_reviewer",
    {
      questionId: "human_owner",
      kind: "human_owner",
    },
  ],
  [
    "reviewer",
    {
      questionId: "human_owner",
      kind: "human_owner",
    },
  ],
  [
    "approver",
    {
      questionId: "human_owner",
      kind: "human_owner",
    },
  ],
]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeQuestionId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function aliasForQuestionId(
  questionId: string,
): {
  questionId: string;
  kind: ClarificationQuestionKind;
} | undefined {
  const normalizedId = normalizeQuestionId(questionId);
  const directAlias = QUESTION_ID_ALIASES.get(normalizedId);

  if (directAlias) {
    return directAlias;
  }

  if (
    /^(?:desired_)?output(?:s)?(?:_|$)/.test(normalizedId) ||
    /^(?:output|asset)_formats?$/.test(normalizedId)
  ) {
    return {
      questionId: "desired_output",
      kind: "desired_output",
    };
  }

  if (
    /^input_(?:data|details|requirements?|material)/.test(
      normalizedId,
    )
  ) {
    return {
      questionId: "input_data",
      kind: "input_data",
    };
  }

  if (
    /^(?:human_)?(?:owner|reviewer)$/.test(normalizedId) ||
    normalizedId === "approver"
  ) {
    return {
      questionId: "human_owner",
      kind: "human_owner",
    };
  }

  return undefined;
}

function normalizeClarificationAnswer(
  answer: ClarificationSessionAnswer,
): ClarificationSessionAnswer {
  const alias = aliasForQuestionId(answer.question_id);

  if (!alias) {
    return answer;
  }

  return {
    ...answer,
    question_id: alias.questionId,
  };
}

function normalizeClarificationAnswers(
  answers: ClarificationSessionAnswer[],
): ClarificationSessionAnswer[] {
  return answers.map(normalizeClarificationAnswer);
}

function normalizedInput(
  input: RunClarificationConversationAgentInput,
): RunClarificationConversationAgentInput {
  return {
    ...input,
    answers: normalizeClarificationAnswers(input.answers),
  };
}

function answerKind(
  answer: Pick<
    ClarificationSessionAnswer,
    "question_id" | "question"
  >,
): ClarificationQuestionKind | undefined {
  const alias = aliasForQuestionId(answer.question_id);

  return alias?.kind ?? getClarificationAnswerKind(answer);
}

function summarizeError(error: unknown): string {
  let summary: string;

  if (error instanceof ZodError) {
    summary = error.issues
      .slice(0, 5)
      .map((issue) => {
        const path =
          issue.path.length > 0
            ? issue.path.join(".")
            : "root";

        return `${path}: ${issue.message}`;
      })
      .join("; ");
  } else if (error instanceof Error) {
    summary = error.message;
  } else {
    summary = "Unknown error.";
  }

  return summary
    .replace(/\s*\|?\s*Response body:[\s\S]*/i, "")
    .slice(0, 300);
}

function safeParseJSON(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error(
        "No valid JSON object found in Clarification Conversation Agent response.",
      );
    }

    return JSON.parse(match[0]);
  }
}

function buildSessionId(
  originalInput: string,
  answers: ClarificationSessionAnswer[],
): string {
  const seed =
    `${originalInput}:${answers.length}:` +
    answers.map((answer) => answer.answer).join("|");

  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash =
      ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }

  return `clarify_${Math.abs(hash).toString(36)}`;
}

function buildCurrentSummary(
  intent: StructuredWorkflowIntent,
): string {
  if (
    intent.task_type &&
    intent.desired_outputs.length > 0
  ) {
    return normalizeText(
      `${intent.task_type}, producing ${intent.desired_outputs.join("; ")}.`,
    );
  }

  if (intent.goal) {
    return normalizeText(intent.goal);
  }

  if (intent.task_type) {
    return normalizeText(intent.task_type);
  }

  return normalizeText(intent.original_input);
}

function buildCompilePrompt(
  input: RunClarificationConversationAgentInput,
  intent: StructuredWorkflowIntent,
): string {
  return serializeStructuredCompileInput({
    intent,
    clarification_answers: input.answers,
    safety_constraints: [
      intent.approval_boundary,
      intent.external_action_boundary,
      "Build a non-executing FlowForge workflow blueprint.",
      "Keep external actions human-reviewed or draft-only.",
      "Do not connect production credentials or execute real-world actions.",
    ].filter(
      (constraint): constraint is string =>
        Boolean(constraint),
    ),
  });
}

function buildReadySession(
  input: RunClarificationConversationAgentInput,
  intent: StructuredWorkflowIntent,
  reason: string,
): ClarificationSession {
  return {
    session_id: buildSessionId(
      input.originalInput,
      input.answers,
    ),
    original_input: normalizeText(input.originalInput),
    current_summary: buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: null,
    status: "ready_to_compile",
    ready_to_compile: true,
    rewritten_compile_prompt: buildCompilePrompt(
      input,
      intent,
    ),
    reason,
  };
}

function buildCannotContinueSession(
  input: RunClarificationConversationAgentInput,
  intent: StructuredWorkflowIntent,
  reason: string,
): ClarificationSession {
  return {
    session_id: buildSessionId(
      input.originalInput,
      input.answers,
    ),
    original_input: normalizeText(input.originalInput),
    current_summary: buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: null,
    status: "cannot_continue",
    ready_to_compile: false,
    reason,
  };
}

function questionWasAlreadyAnswered(
  input: RunClarificationConversationAgentInput,
  question: ClarificationNextQuestion,
): boolean {
  const normalizedQuestionId = aliasForQuestionId(
    question.id,
  )?.questionId ?? normalizeQuestionId(question.id);

  const questionKind =
    aliasForQuestionId(question.id)?.kind ??
    question.kind;

  return input.answers.some((answer) => {
    const normalizedAnswer =
      normalizeClarificationAnswer(answer);

    const previousKind = answerKind(normalizedAnswer);

    const normalizedAnswerId =
      normalizeQuestionId(
        normalizedAnswer.question_id,
      );

    return (
      normalizedAnswerId === normalizedQuestionId ||
      normalizedAnswer.question.toLowerCase() ===
        question.question.toLowerCase() ||
      (
        previousKind === questionKind &&
        isConcreteKnownFact(
          normalizedAnswer.answer,
          questionKind,
        )
      )
    );
  });
}

function createFallbackQuestion(
  intent: StructuredWorkflowIntent,
): ClarificationNextQuestion {
  const readiness =
    assessStructuredWorkflowIntentReadiness(intent);

  const missing = readiness.missing_fields;

  if (missing.includes("goal_or_task_type")) {
    return {
      id: "choose_task_category",
      kind: "task_type",
      question:
        "What kind of tasks should FlowForge help with first — emails, tickets, documents, leads, scheduling, or internal admin work?",
      why_it_matters:
        "FlowForge needs the task category before it can ask useful workflow questions.",
      example_answer:
        "Support emails from students, or weekly admin reports.",
    };
  }

  if (missing.includes("trigger")) {
    return {
      id: "workflow_trigger",
      kind: "trigger",
      question: "When should this workflow start?",
      why_it_matters:
        "A safe automation blueprint needs a clear starting event.",
      example_answer:
        "When a new support ticket is created, or every Friday at 16:00.",
    };
  }

  if (missing.includes("input_source_or_data")) {
    const isContentWorkflow =
      /social media|content generation|marketing content|social post/i.test(
        `${intent.task_type ?? ""} ${intent.desired_outputs.join(" ")}`,
      );

    if (isContentWorkflow) {
      return {
        id: "content_source_material",
        kind: "data_source",
        question:
          "What source material should the workflow use to generate the social media content, such as a product description, campaign brief, blog post, image assets, or key marketing points?",
        why_it_matters:
          "The workflow needs concrete source material before it can generate an accurate content draft.",
        example_answer:
          "A product description, campaign brief, brand assets, and the key marketing points for the post.",
      };
    }

    return {
      id: "workflow_source",
      kind: "data_source",
      question:
        "Where will the workflow read the items from?",
      why_it_matters:
        "The source tells FlowForge what system or inbox the workflow watches.",
      example_answer:
        "The support inbox, Zendesk, Intercom, or a Google Sheet.",
    };
  }

  if (missing.includes("desired_output")) {
    return {
      id: "desired_output",
      kind: "desired_output",
      question: "What should the workflow produce?",
      why_it_matters:
        "The output determines the safe workflow structure.",
      example_answer:
        "A summary, draft reply, tags, and an internal task.",
    };
  }

  if (missing.includes("human_owner")) {
    return {
      id: "human_reviewer",
      kind: "human_owner",
      question:
        "Who reviews the result before anything is sent, published, or changed?",
      why_it_matters:
        "External actions need accountable human ownership.",
      example_answer:
        "The marketing manager reviews every generated content package.",
    };
  }

  if (
    missing.includes(
      "approval_or_external_action_boundary",
    )
  ) {
    return {
      id: "approval_boundary",
      kind: "approval_boundary",
      question:
        "What must stay human-approved or draft-only?",
      why_it_matters:
        "This prevents FlowForge from planning automatic external actions.",
      example_answer:
        "Nothing is published automatically. The marketing manager must approve all assets first.",
    };
  }

  return {
    id: "success_criteria",
    kind: "success_criteria",
    question:
      "How will you know the workflow worked correctly?",
    why_it_matters:
      "Success criteria help FlowForge generate useful dry-run checks.",
    example_answer:
      "The content package is complete, stored correctly, and waiting for human approval.",
  };
}

export function buildDeterministicClarificationSession(
  rawInput: RunClarificationConversationAgentInput,
  reason: string,
): ClarificationSession {
  const input = normalizedInput(rawInput);

  const intent = inferStructuredWorkflowIntent(input);

  const readiness =
    assessStructuredWorkflowIntentReadiness(intent);

  if (readiness.ready) {
    return buildReadySession(
      input,
      intent,
      "Enough confirmed clarification has been collected to compile a safe preview.",
    );
  }

  if (
    input.answers.length >=
    HARD_MAX_CLARIFICATION_QUESTIONS
  ) {
    return buildCannotContinueSession(
      input,
      intent,
      `Clarification hard limit reached. Missing required fields: ${readiness.missing_fields.join(", ")}.`,
    );
  }

  const nextQuestion = createFallbackQuestion(intent);

  if (questionWasAlreadyAnswered(input, nextQuestion)) {
    return buildCannotContinueSession(
      input,
      intent,
      `A duplicate clarification question was prevented. Missing required fields: ${readiness.missing_fields.join(", ")}.`,
    );
  }

  return {
    session_id: buildSessionId(
      input.originalInput,
      input.answers,
    ),
    original_input: normalizeText(input.originalInput),
    current_summary: buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: nextQuestion,
    status: "needs_answer",
    ready_to_compile: false,
    reason,
  };
}

export function normalizeAgentSession(
  parsed: unknown,
  rawInput: RunClarificationConversationAgentInput,
): ClarificationSession {
  const input = normalizedInput(rawInput);

  const raw =
    parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};

  const intent = inferStructuredWorkflowIntent(input);

  const candidate = {
    session_id: buildSessionId(
      input.originalInput,
      input.answers,
    ),
    original_input: normalizeText(input.originalInput),
    current_summary:
      raw.current_summary ??
      buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: raw.next_question ?? null,
    status: raw.status,
    ready_to_compile: raw.ready_to_compile,
    reason:
      raw.reason ??
      "Clarification agent updated the session.",
  };

  const parsedSession =
    clarificationSessionSchema.parse(candidate);

  const readiness =
    assessStructuredWorkflowIntentReadiness(intent);

  if (readiness.ready) {
    return buildReadySession(
      input,
      intent,
      "Enough confirmed clarification has been collected to compile a safe preview.",
    );
  }

  if (
    input.answers.length >=
    HARD_MAX_CLARIFICATION_QUESTIONS
  ) {
    return buildCannotContinueSession(
      input,
      intent,
      `Clarification hard limit reached. Missing required fields: ${readiness.missing_fields.join(", ")}.`,
    );
  }

  const isExplicitNeedsAnswer =
    parsedSession.status === "needs_answer" &&
    parsedSession.ready_to_compile === false &&
    parsedSession.next_question !== null;

  if (isExplicitNeedsAnswer) {
    if (
      questionWasAlreadyAnswered(
        input,
        parsedSession.next_question!,
      )
    ) {
      return buildDeterministicClarificationSession(
        input,
        "The provider repeated an answered question; deterministic clarification selected the next missing required field.",
      );
    }

    return parsedSession;
  }

  return buildDeterministicClarificationSession(
    input,
    parsedSession.ready_to_compile ||
      parsedSession.status === "ready_to_compile"
      ? "The provider marked the session ready without enough confirmed facts; deterministic clarification continues."
      : "The provider response did not contain a usable next question; deterministic clarification continues.",
  );
}

function providerIsAvailable(
  provider: AgentProvider,
  dependencies: ClarificationProviderDependencies,
): boolean {
  const override =
    dependencies.availability?.[provider];

  if (override !== undefined) {
    return override;
  }

  const keyName =
    provider === "openai"
      ? "OPENAI_API_KEY"
      : provider === "groq"
        ? "GROQ_API_KEY"
        : "GEMINI_API_KEY";

  return Boolean(process.env[keyName]);
}

function providerCall(
  provider: AgentProvider,
  dependencies: ClarificationProviderDependencies,
): ClarificationProviderCall {
  const override = dependencies.calls?.[provider];

  if (override) {
    return override;
  }

  if (provider === "openai") {
    return (userPrompt, systemPrompt) =>
      callOpenAIAgent(
        userPrompt,
        systemPrompt,
        {
          modelEnv: "OPENAI_CLARIFIER_MODEL",
          fallbackModelEnv: "OPENAI_AGENT_MODEL",
          maxOutputTokensEnv:
            "OPENAI_CLARIFIER_MAX_OUTPUT_TOKENS",
          fallbackMaxOutputTokensEnv:
            "OPENAI_AGENT_MAX_OUTPUT_TOKENS",
          defaultMaxOutputTokens: 1000,
          maxOutputTokensCap: 1800,
          reasoningEffort: "minimal",
          verbosity: "low",
        },
      );
  }

  if (provider === "groq") {
    return (userPrompt, systemPrompt) =>
      callGroqAgent(
        userPrompt,
        systemPrompt,
        {
          modelEnv: "GROQ_CLARIFIER_MODEL",
          fallbackModelEnv: "GROQ_AGENT_MODEL",
          maxTokensEnv:
            "GROQ_CLARIFIER_MAX_TOKENS",
          fallbackMaxTokensEnv:
            "GROQ_AGENT_MAX_TOKENS",
          defaultMaxTokens: 1000,
          maxTokensCap: 1800,
          truncationSuggestion:
            "Raise GROQ_CLARIFIER_MAX_TOKENS to around 1200-1800.",
        },
      );
  }

  return (userPrompt, systemPrompt) =>
    callGeminiAgent(
      userPrompt,
      systemPrompt,
      {
        modelEnv: "GEMINI_CLARIFIER_MODEL",
        fallbackModelEnv: "GEMINI_AGENT_MODEL",
        maxOutputTokensEnv:
          "GEMINI_CLARIFIER_MAX_OUTPUT_TOKENS",
        fallbackMaxOutputTokensEnv:
          "GEMINI_AGENT_MAX_OUTPUT_TOKENS",
        defaultMaxOutputTokens: 1000,
        maxOutputTokensCap: 1800,
        truncationSuggestion:
          "Raise GEMINI_CLARIFIER_MAX_OUTPUT_TOKENS to around 1200-1800.",
      },
    );
}

export async function runClarificationConversationAgent(
  rawInput: RunClarificationConversationAgentInput,
  dependencies: ClarificationProviderDependencies = {},
): Promise<ClarificationSessionResponse> {
  const input = normalizedInput(rawInput);

  const preflightIntent =
    inferStructuredWorkflowIntent(input);

  const preflightReadiness =
    assessStructuredWorkflowIntentReadiness(
      preflightIntent,
    );

  if (preflightReadiness.ready) {
    return clarificationSessionResponseSchema.parse({
      session: buildReadySession(
        input,
        preflightIntent,
        "Enough confirmed clarification has been collected to compile a safe preview.",
      ),
      used_ai: false,
      provider: "deterministic",
      fallback_used: false,
      provider_attempts: [
        {
          provider: "deterministic",
          attempted: true,
          success: true,
        },
      ],
    });
  }

  if (
    input.answers.length >=
    HARD_MAX_CLARIFICATION_QUESTIONS
  ) {
    return clarificationSessionResponseSchema.parse({
      session: buildCannotContinueSession(
        input,
        preflightIntent,
        `Clarification hard limit reached. Missing required fields: ${preflightReadiness.missing_fields.join(", ")}.`,
      ),
      used_ai: false,
      provider: "deterministic",
      fallback_used: true,
      provider_attempts: [
        {
          provider: "deterministic",
          attempted: true,
          success: true,
        },
      ],
    });
  }

  /*
   * Six is now a soft limit.
   *
   * After this point, only required readiness fields are asked.
   * This avoids spending provider calls on optional wording or
   * refinements and prevents the flow from stopping too early.
   */
  if (
    input.answers.length >=
    SOFT_MAX_CLARIFICATION_QUESTIONS
  ) {
    return clarificationSessionResponseSchema.parse({
      session:
        buildDeterministicClarificationSession(
          input,
          `Soft clarification limit reached. Continuing with required fields only: ${preflightReadiness.missing_fields.join(", ")}.`,
        ),
      used_ai: false,
      provider: "deterministic",
      fallback_used: true,
      provider_attempts: [
        {
          provider: "deterministic",
          attempted: true,
          success: true,
        },
      ],
    });
  }

  const userPrompt =
    buildClarificationConversationUserPrompt({
      originalInput: input.originalInput,
      answers: input.answers,
      currentIntent: preflightIntent,
    });

  const providerErrors: string[] = [];

  const providerAttempts:
    ClarificationSessionResponse["provider_attempts"] =
      [];

  for (const provider of PROVIDER_ORDER) {
    if (!providerIsAvailable(provider, dependencies)) {
      providerErrors.push(`${provider}: unavailable`);

      providerAttempts.push({
        provider,
        attempted: false,
        success: false,
        error_summary:
          "Provider key is not configured.",
      });

      continue;
    }

    try {
      const rawResponse = await providerCall(
        provider,
        dependencies,
      )(
        userPrompt,
        clarificationConversationSystemPrompt,
      );

      const session = normalizeAgentSession(
        safeParseJSON(rawResponse),
        input,
      );

      providerAttempts.push({
        provider,
        attempted: true,
        success: true,
      });

      return clarificationSessionResponseSchema.parse({
        session,
        used_ai: true,
        provider,
        fallback_used: false,
        provider_attempts: providerAttempts,
        raw_response: rawResponse,
      });
    } catch (error) {
      const errorSummary = summarizeError(error);

      providerErrors.push(
        `${provider}: ${errorSummary}`,
      );

      providerAttempts.push({
        provider,
        attempted: true,
        success: false,
        error_summary: errorSummary,
      });
    }
  }

  const session =
    buildDeterministicClarificationSession(
      input,
      providerErrors.length > 0
        ? `Clarification agent fallback used. ${providerErrors.join(" | ")}`
        : "Clarification agent fallback used.",
    );

  providerAttempts.push({
    provider: "deterministic",
    attempted: true,
    success: true,
  });

  return clarificationSessionResponseSchema.parse({
    session,
    used_ai: false,
    provider: "deterministic",
    fallback_used: true,
    provider_attempts: providerAttempts,
  });
}