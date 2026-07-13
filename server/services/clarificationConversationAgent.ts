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
import {
  assessStructuredWorkflowIntentReadiness,
  type StructuredIntentReadinessField,
} from "./structuredIntentReadiness";

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

type ProviderWorkflowIntent = Partial<
  Omit<
    StructuredWorkflowIntent,
    "version" | "original_input"
  >
>;

type QuestionAlias = {
  questionId: string;
  kind: ClarificationQuestionKind;
};

export type ClarificationProviderDependencies = {
  calls?: Partial<
    Record<AgentProvider, ClarificationProviderCall>
  >;
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
  QuestionAlias
>([
  [
    "workflow_goal",
    {
      questionId: "workflow_goal",
      kind: "workflow_goal",
    },
  ],
  [
    "automation_goal",
    {
      questionId: "workflow_goal",
      kind: "workflow_goal",
    },
  ],
  [
    "task_category",
    {
      questionId: "task_type",
      kind: "task_type",
    },
  ],
  [
    "task_type",
    {
      questionId: "task_type",
      kind: "task_type",
    },
  ],
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
    "output_destination",
    {
      questionId: "output_destination",
      kind: "output_destination",
    },
  ],
  [
    "notification_target",
    {
      questionId: "notification_target",
      kind: "notification_target",
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
    "input_source",
    {
      questionId: "data_source",
      kind: "data_source",
    },
  ],
  [
    "data_source",
    {
      questionId: "data_source",
      kind: "data_source",
    },
  ],
  [
    "content_source",
    {
      questionId: "data_source",
      kind: "data_source",
    },
  ],
  [
    "content_source_material",
    {
      questionId: "data_source",
      kind: "data_source",
    },
  ],
  [
    "workflow_source",
    {
      questionId: "data_source",
      kind: "data_source",
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
  [
    "approval_boundary",
    {
      questionId: "approval_boundary",
      kind: "approval_boundary",
    },
  ],
  [
    "approval_process",
    {
      questionId: "approval_boundary",
      kind: "approval_boundary",
    },
  ],
  [
    "external_action_boundary",
    {
      questionId: "external_action_boundary",
      kind: "external_action_boundary",
    },
  ],
]);

const PROVIDER_PLACEHOLDER_PATTERNS = [
  /^optional$/i,
  /^none$/i,
  /^n\/a$/i,
  /^not applicable$/i,
  /^not provided$/i,
  /^not specified$/i,
  /^not known$/i,
  /^unknown$/i,
  /^tbd$/i,
  /^to be decided$/i,
  /^to be determined$/i,
  /^human reviewer$/i,
  /^human owner$/i,
  /^a reviewer$/i,
  /^the reviewer$/i,
];

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeQuestionId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function aliasForQuestionId(
  questionId: string,
): QuestionAlias | undefined {
  const normalizedId =
    normalizeQuestionId(questionId);

  const directAlias =
    QUESTION_ID_ALIASES.get(normalizedId);

  if (directAlias) {
    return directAlias;
  }

  if (
    /^(?:desired_)?output(?:s)?(?:_|$)/.test(
      normalizedId,
    ) ||
    /^(?:output|asset)_formats?$/.test(
      normalizedId,
    )
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
    /^(?:human_)?(?:owner|reviewer)$/.test(
      normalizedId,
    ) ||
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
  const alias =
    aliasForQuestionId(answer.question_id);

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
    answers: normalizeClarificationAnswers(
      input.answers,
    ),
  };
}

function answerKind(
  answer: Pick<
    ClarificationSessionAnswer,
    "question_id" | "question"
  >,
): ClarificationQuestionKind | undefined {
  const alias =
    aliasForQuestionId(answer.question_id);

  return (
    alias?.kind ??
    getClarificationAnswerKind(answer)
  );
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
    .replace(
      /\s*\|?\s*Response body:[\s\S]*/i,
      "",
    )
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
    answers
      .map((answer) => answer.answer)
      .join("|");

  let hash = 0;

  for (
    let index = 0;
    index < seed.length;
    index += 1
  ) {
    hash =
      ((hash << 5) -
        hash +
        seed.charCodeAt(index)) |
      0;
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
    original_input: normalizeText(
      input.originalInput,
    ),
    current_summary:
      buildCurrentSummary(intent),
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
    original_input: normalizeText(
      input.originalInput,
    ),
    current_summary:
      buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: null,
    status: "cannot_continue",
    ready_to_compile: false,
    reason,
  };
}

function isUsableProviderString(
  value: unknown,
  field?: string,
): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeText(value);

  if (
    PROVIDER_PLACEHOLDER_PATTERNS.some(
      (pattern) => pattern.test(normalized),
    )
  ) {
    return false;
  }

  return isConcreteKnownFact(
    normalized,
    field,
  );
}

function readUsableString(
  value: unknown,
  field?: string,
): string | undefined {
  return isUsableProviderString(value, field)
    ? normalizeText(value)
    : undefined;
}

function readUsableStringArray(
  value: unknown,
  field?: string,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) =>
          readUsableString(item, field),
        )
        .filter(
          (item): item is string =>
            Boolean(item),
        ),
    ),
  ];
}

function addUniqueStrings(
  current: string[],
  incoming: string[],
): string[] {
  return [
    ...new Set(
      [...current, ...incoming]
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
}

function parseProviderWorkflowIntent(
  value: unknown,
): ProviderWorkflowIntent {
  if (!isRecord(value)) {
    return {};
  }

  return {
    goal: readUsableString(
      value.goal,
      "goal",
    ),
    task_type: readUsableString(
      value.task_type,
      "task_type",
    ),
    trigger: readUsableString(
      value.trigger,
      "trigger",
    ),
    input_sources: readUsableStringArray(
      value.input_sources,
      "input_sources",
    ),
    input_data: readUsableStringArray(
      value.input_data,
      "input_data",
    ),
    desired_outputs: readUsableStringArray(
      value.desired_outputs,
      "desired_outputs",
    ),
    output_destinations:
      readUsableStringArray(
        value.output_destinations,
        "output_destinations",
      ),
    notification_targets:
      readUsableStringArray(
        value.notification_targets,
        "notification_targets",
      ),
    decision_rules: readUsableStringArray(
      value.decision_rules,
      "decision_rules",
    ),
    human_owner: readUsableString(
      value.human_owner,
      "human_owner",
    ),
    approval_boundary: readUsableString(
      value.approval_boundary,
      "approval_boundary",
    ),
    external_action_boundary:
      readUsableString(
        value.external_action_boundary,
        "external_action_boundary",
      ),
    external_actions: readUsableStringArray(
      value.external_actions,
      "external_actions",
    ),
    success_criteria: readUsableString(
      value.success_criteria,
      "success_criteria",
    ),
  };
}

function mergeStructuredWorkflowIntent(
  deterministicIntent: StructuredWorkflowIntent,
  providerIntent: ProviderWorkflowIntent,
): StructuredWorkflowIntent {
  /*
   * Provider output may improve summaries and extract boundaries
   * that the deterministic parser cannot infer cleanly.
   *
   * The original input and version remain deterministic.
   * Arrays are merged rather than overwritten.
   */
  return {
    version: "1",
    original_input:
      deterministicIntent.original_input,

    goal:
      providerIntent.goal ??
      deterministicIntent.goal,

    task_type:
      providerIntent.task_type ??
      deterministicIntent.task_type,

    trigger:
      providerIntent.trigger ??
      deterministicIntent.trigger,

    input_sources: addUniqueStrings(
      deterministicIntent.input_sources,
      providerIntent.input_sources ?? [],
    ),

    input_data: addUniqueStrings(
      deterministicIntent.input_data,
      providerIntent.input_data ?? [],
    ),

    desired_outputs: addUniqueStrings(
      deterministicIntent.desired_outputs,
      providerIntent.desired_outputs ?? [],
    ),

    output_destinations: addUniqueStrings(
      deterministicIntent.output_destinations,
      providerIntent.output_destinations ??
        [],
    ),

    notification_targets: addUniqueStrings(
      deterministicIntent.notification_targets,
      providerIntent.notification_targets ??
        [],
    ),

    decision_rules: addUniqueStrings(
      deterministicIntent.decision_rules,
      providerIntent.decision_rules ?? [],
    ),

    human_owner:
      providerIntent.human_owner ??
      deterministicIntent.human_owner,

    approval_boundary:
      providerIntent.approval_boundary ??
      deterministicIntent.approval_boundary,

    external_action_boundary:
      providerIntent.external_action_boundary ??
      deterministicIntent.external_action_boundary,

    external_actions: addUniqueStrings(
      deterministicIntent.external_actions,
      providerIntent.external_actions ?? [],
    ),

    success_criteria:
      providerIntent.success_criteria ??
      deterministicIntent.success_criteria,
  };
}

function questionWasAlreadyAnswered(
  input: RunClarificationConversationAgentInput,
  question: ClarificationNextQuestion,
): boolean {
  const alias =
    aliasForQuestionId(question.id);

  const normalizedQuestionId =
    alias?.questionId ??
    normalizeQuestionId(question.id);

  const questionKind =
    alias?.kind ?? question.kind;

  return input.answers.some((answer) => {
    const normalizedAnswer =
      normalizeClarificationAnswer(answer);

    const previousKind =
      answerKind(normalizedAnswer);

    const normalizedAnswerId =
      normalizeQuestionId(
        normalizedAnswer.question_id,
      );

    return (
      normalizedAnswerId ===
        normalizedQuestionId ||
      normalizedAnswer.question
        .toLowerCase() ===
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

function isUsableProviderQuestion(
  question: ClarificationNextQuestion,
): boolean {
  const text = normalizeText(
    question.question,
  );

  if (text.length < 12) {
    return false;
  }

  if (!text.endsWith("?")) {
    return false;
  }

  if (
    /\(\s*(?:e\.?g\.?|for example)\s*,?\s*\?\s*$/i.test(
      text,
    )
  ) {
    return false;
  }

  if (
    /(?:e\.?g\.?|for example)\s*,?\s*\?$/i.test(
      text,
    )
  ) {
    return false;
  }

  if (
    /[\(\[,;:-]\s*\?$/.test(text)
  ) {
    return false;
  }

  return true;
}

function readinessFieldForQuestionKind(
  kind: ClarificationQuestionKind,
): StructuredIntentReadinessField | undefined {
  if (
    kind === "workflow_goal" ||
    kind === "task_type"
  ) {
    return "goal_or_task_type";
  }

  if (kind === "trigger") {
    return "trigger";
  }

  if (
    kind === "data_source" ||
    kind === "input_data"
  ) {
    return "input_source_or_data";
  }

  if (kind === "desired_output") {
    return "desired_output";
  }

  if (kind === "human_owner") {
    return "human_owner";
  }

  if (
    kind === "approval_boundary" ||
    kind === "external_action_boundary"
  ) {
    return "approval_or_external_action_boundary";
  }

  return undefined;
}

function questionMatchesMissingField(
  question: ClarificationNextQuestion,
  missingFields:
    StructuredIntentReadinessField[],
): boolean {
  const alias =
    aliasForQuestionId(question.id);

  const effectiveKind =
    alias?.kind ?? question.kind;

  const readinessField =
    readinessFieldForQuestionKind(
      effectiveKind,
    );

  if (!readinessField) {
    return false;
  }

  return missingFields.includes(
    readinessField,
  );
}

function createFallbackQuestion(
  intent: StructuredWorkflowIntent,
): ClarificationNextQuestion {
  const readiness =
    assessStructuredWorkflowIntentReadiness(
      intent,
    );

  const missing =
    readiness.missing_fields;

  if (
    missing.includes(
      "goal_or_task_type",
    )
  ) {
    return {
      id: "choose_task_category",
      kind: "task_type",
      question:
        "What kind of task or process should FlowForge plan?",
      why_it_matters:
        "FlowForge needs a concrete task before it can create a useful workflow.",
      example_answer:
        "Review new admissions applications.",
    };
  }

  if (missing.includes("trigger")) {
    return {
      id: "workflow_trigger",
      kind: "trigger",
      question:
        "When should this workflow start?",
      why_it_matters:
        "A safe workflow blueprint needs a clear starting event.",
      example_answer:
        "When a new application email arrives.",
    };
  }

  if (
    missing.includes(
      "input_source_or_data",
    )
  ) {
    const combinedContext = [
      intent.goal,
      intent.task_type,
      ...intent.desired_outputs,
    ]
      .filter(Boolean)
      .join(" ");

    const isContentWorkflow =
      /social media|content generation|marketing content|social post/i.test(
        combinedContext,
      );

    const isEmailWorkflow =
      /\bemail|inbox|application\b/i.test(
        combinedContext,
      );

    if (isContentWorkflow) {
      return {
        id: "content_source_material",
        kind: "data_source",
        question:
          "What source material should the workflow use to generate the content?",
        why_it_matters:
          "The workflow needs concrete source material before it can generate accurate drafts.",
        example_answer:
          "A product description, campaign brief, brand assets, and key marketing points.",
      };
    }

    if (isEmailWorkflow) {
      return {
        id: "workflow_source",
        kind: "data_source",
        question:
          "Which inbox or email system should the workflow read the application emails from?",
        why_it_matters:
          "The workflow needs a concrete source for the incoming applications.",
        example_answer:
          "The shared admissions Gmail inbox.",
      };
    }

    return {
      id: "workflow_source",
      kind: "data_source",
      question:
        "Where should the workflow read its input from?",
      why_it_matters:
        "The workflow needs a concrete source or input system.",
      example_answer:
        "A shared inbox, form, Google Sheet, or internal database.",
    };
  }

  if (
    missing.includes("desired_output")
  ) {
    return {
      id: "desired_output",
      kind: "desired_output",
      question:
        "What should the workflow produce?",
      why_it_matters:
        "The output determines the workflow structure.",
      example_answer:
        "An internal review task with extracted details and a priority classification.",
    };
  }

  if (
    missing.includes("human_owner")
  ) {
    const isAdmissionsWorkflow =
      /\badmissions?|application|candidate\b/i.test(
        [
          intent.goal,
          intent.task_type,
          ...intent.desired_outputs,
        ]
          .filter(Boolean)
          .join(" "),
      );

    return {
      id: "human_reviewer",
      kind: "human_owner",
      question: isAdmissionsWorkflow
        ? "Who performs the manual admissions review before any external communication is allowed?"
        : "Who reviews the result before anything is sent, published, or changed?",
      why_it_matters:
        "External actions need accountable human ownership.",
      example_answer:
        isAdmissionsWorkflow
          ? "The admissions team reviews every application."
          : "The responsible team manager reviews every result.",
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
        "This prevents FlowForge from planning unapproved external actions.",
      example_answer:
        "No external communication is sent automatically. The responsible reviewer must approve it first.",
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
      "The internal task contains the correct details, priority, and approval status.",
  };
}

function buildDeterministicSessionFromIntent(
  input: RunClarificationConversationAgentInput,
  intent: StructuredWorkflowIntent,
  reason: string,
): ClarificationSession {
  const readiness =
    assessStructuredWorkflowIntentReadiness(
      intent,
    );

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

  const nextQuestion =
    createFallbackQuestion(intent);

  if (
    questionWasAlreadyAnswered(
      input,
      nextQuestion,
    )
  ) {
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
    original_input: normalizeText(
      input.originalInput,
    ),
    current_summary:
      buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question: nextQuestion,
    status: "needs_answer",
    ready_to_compile: false,
    reason,
  };
}

export function buildDeterministicClarificationSession(
  rawInput: RunClarificationConversationAgentInput,
  reason: string,
): ClarificationSession {
  const input = normalizedInput(rawInput);

  const intent =
    inferStructuredWorkflowIntent(input);

  return buildDeterministicSessionFromIntent(
    input,
    intent,
    reason,
  );
}

export function normalizeAgentSession(
  parsed: unknown,
  rawInput: RunClarificationConversationAgentInput,
): ClarificationSession {
  const input = normalizedInput(rawInput);

  const raw = isRecord(parsed)
    ? parsed
    : {};

  const deterministicIntent =
    inferStructuredWorkflowIntent(input);

  const providerIntent =
    parseProviderWorkflowIntent(
      raw.workflow_intent,
    );

  const intent =
    mergeStructuredWorkflowIntent(
      deterministicIntent,
      providerIntent,
    );

  const candidate = {
    session_id: buildSessionId(
      input.originalInput,
      input.answers,
    ),
    original_input: normalizeText(
      input.originalInput,
    ),
    current_summary:
      readUsableString(
        raw.current_summary,
      ) ??
      buildCurrentSummary(intent),
    intent,
    answers: input.answers,
    next_question:
      raw.next_question ?? null,
    status: raw.status,
    ready_to_compile:
      raw.ready_to_compile,
    reason:
      readUsableString(raw.reason) ??
      "Clarification agent updated the session.",
  };

  const parsedSession =
    clarificationSessionSchema.parse(
      candidate,
    );

  const readiness =
    assessStructuredWorkflowIntentReadiness(
      intent,
    );

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

  const providerQuestion =
    parsedSession.next_question;

  const providerWantsAnswer =
    parsedSession.status ===
      "needs_answer" &&
    parsedSession.ready_to_compile ===
      false &&
    providerQuestion !== null;

  if (providerWantsAnswer) {
    const questionIsUsable =
      isUsableProviderQuestion(
        providerQuestion,
      );

    const questionMatchesReadiness =
      questionMatchesMissingField(
        providerQuestion,
        readiness.missing_fields,
      );

    const questionWasAnswered =
      questionWasAlreadyAnswered(
        input,
        providerQuestion,
      );

    if (
      questionIsUsable &&
      questionMatchesReadiness &&
      !questionWasAnswered
    ) {
      return {
        ...parsedSession,
        intent,
        current_summary:
          candidate.current_summary,
      };
    }

    const rejectionReasons: string[] =
      [];

    if (!questionIsUsable) {
      rejectionReasons.push(
        "the provider question was incomplete or malformed",
      );
    }

    if (!questionMatchesReadiness) {
      rejectionReasons.push(
        `the provider question did not match the missing fields: ${readiness.missing_fields.join(", ")}`,
      );
    }

    if (questionWasAnswered) {
      rejectionReasons.push(
        "the provider repeated an answered question",
      );
    }

    return buildDeterministicSessionFromIntent(
      input,
      intent,
      `Provider question rejected because ${rejectionReasons.join(" and ")}. Deterministic clarification selected the next required field.`,
    );
  }

  return buildDeterministicSessionFromIntent(
    input,
    intent,
    parsedSession.ready_to_compile ||
      parsedSession.status ===
        "ready_to_compile"
      ? "The provider marked the session ready without enough confirmed facts; deterministic clarification continues."
      : "The provider response did not contain a usable next question; deterministic clarification continues.",
  );
}

function providerIsAvailable(
  provider: AgentProvider,
  dependencies:
    ClarificationProviderDependencies,
): boolean {
  const override =
    dependencies.availability?.[
      provider
    ];

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
  dependencies:
    ClarificationProviderDependencies,
): ClarificationProviderCall {
  const override =
    dependencies.calls?.[provider];

  if (override) {
    return override;
  }

  if (provider === "openai") {
    return (
      userPrompt,
      systemPrompt,
    ) =>
      callOpenAIAgent(
        userPrompt,
        systemPrompt,
        {
          modelEnv:
            "OPENAI_CLARIFIER_MODEL",
          fallbackModelEnv:
            "OPENAI_AGENT_MODEL",
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
    return (
      userPrompt,
      systemPrompt,
    ) =>
      callGroqAgent(
        userPrompt,
        systemPrompt,
        {
          modelEnv:
            "GROQ_CLARIFIER_MODEL",
          fallbackModelEnv:
            "GROQ_AGENT_MODEL",
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

  return (
    userPrompt,
    systemPrompt,
  ) =>
    callGeminiAgent(
      userPrompt,
      systemPrompt,
      {
        modelEnv:
          "GEMINI_CLARIFIER_MODEL",
        fallbackModelEnv:
          "GEMINI_AGENT_MODEL",
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
  rawInput:
    RunClarificationConversationAgentInput,
  dependencies:
    ClarificationProviderDependencies = {},
): Promise<ClarificationSessionResponse> {
  const input = normalizedInput(rawInput);

  const preflightIntent =
    inferStructuredWorkflowIntent(input);

  const preflightReadiness =
    assessStructuredWorkflowIntentReadiness(
      preflightIntent,
    );

  if (preflightReadiness.ready) {
    return clarificationSessionResponseSchema.parse(
      {
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
      },
    );
  }

  if (
    input.answers.length >=
    HARD_MAX_CLARIFICATION_QUESTIONS
  ) {
    return clarificationSessionResponseSchema.parse(
      {
        session:
          buildCannotContinueSession(
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
      },
    );
  }

  /*
   * Six questions is a soft limit.
   *
   * After the soft limit, only deterministic questions for
   * required readiness fields are allowed.
   */
  if (
    input.answers.length >=
    SOFT_MAX_CLARIFICATION_QUESTIONS
  ) {
    return clarificationSessionResponseSchema.parse(
      {
        session:
          buildDeterministicSessionFromIntent(
            input,
            preflightIntent,
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
      },
    );
  }

  const userPrompt =
    buildClarificationConversationUserPrompt(
      {
        originalInput:
          input.originalInput,
        answers: input.answers,
        currentIntent:
          preflightIntent,
      },
    );

  const providerErrors: string[] = [];

  const providerAttempts:
    ClarificationSessionResponse["provider_attempts"] =
      [];

  for (
    const provider of PROVIDER_ORDER
  ) {
    if (
      !providerIsAvailable(
        provider,
        dependencies,
      )
    ) {
      providerErrors.push(
        `${provider}: unavailable`,
      );

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
      const rawResponse =
        await providerCall(
          provider,
          dependencies,
        )(
          userPrompt,
          clarificationConversationSystemPrompt,
        );

      const session =
        normalizeAgentSession(
          safeParseJSON(rawResponse),
          input,
        );

      providerAttempts.push({
        provider,
        attempted: true,
        success: true,
      });

      return clarificationSessionResponseSchema.parse(
        {
          session,
          used_ai: true,
          provider,
          fallback_used: false,
          provider_attempts:
            providerAttempts,
          raw_response: rawResponse,
        },
      );
    } catch (error) {
      const errorSummary =
        summarizeError(error);

      providerErrors.push(
        `${provider}: ${errorSummary}`,
      );

      providerAttempts.push({
        provider,
        attempted: true,
        success: false,
        error_summary:
          errorSummary,
      });
    }
  }

  const session =
    buildDeterministicSessionFromIntent(
      input,
      preflightIntent,
      providerErrors.length > 0
        ? `Clarification agent fallback used. ${providerErrors.join(" | ")}`
        : "Clarification agent fallback used.",
    );

  providerAttempts.push({
    provider: "deterministic",
    attempted: true,
    success: true,
  });

  return clarificationSessionResponseSchema.parse(
    {
      session,
      used_ai: false,
      provider: "deterministic",
      fallback_used: true,
      provider_attempts:
        providerAttempts,
    },
  );
}
