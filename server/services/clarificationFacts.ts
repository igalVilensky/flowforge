import type {
  ClarificationQuestionKind,
  ClarificationSessionAnswer,
} from "../../shared/types/clarificationSession";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";

const PLACEHOLDER_PATTERNS = [
  /\bmentioned by the user\b/i,
  /\bprovided by the user\b/i,
  /\bthe (?:requested|relevant|appropriate) (?:source|data|details|output|system)\b/i,
  /\brequested fields\b/i,
  /\bsource item\b/i,
  /\ba new item arrives or a scheduled review runs\b/i,
  /\bticket or message details\b/i,
  /\ba summary, draft, tags, routing, or internal task\b/i,
  /\ba human reviewer mentioned\b/i,
  /\bto be (?:provided|confirmed|determined|decided)\b/i,
  /\bnot (?:provided|specified|known)\b/i,
  /\bunknown\b/i,
  /\btbd\b/i,
];

const VAGUE_GOAL_PATTERNS = [
  /^(?:please\s+)?automate (?:my|our|the)?\s*(?:task|tasks|work|workflow|workflows|process|processes|stuff|things)\.?$/i,
  /^(?:make|build|create|do) (?:an? )?automation\.?$/i,
];

const QUESTION_ID_KIND = new Map<string, ClarificationQuestionKind>([
  ["workflow_goal", "workflow_goal"],
  ["automation_goal", "workflow_goal"],
  ["choose_task_category", "task_type"],
  ["task_type", "task_type"],
  ["task_category", "task_type"],
  ["workflow_type", "task_type"],
  ["content_type", "task_type"],
  ["workflow_trigger", "trigger"],
  ["trigger", "trigger"],
  ["timing", "trigger"],
  ["schedule", "trigger"],
  ["content_source", "data_source"],
  ["content_source_material", "data_source"],
  ["input_source", "data_source"],
  ["workflow_source", "data_source"],
  ["source_material", "data_source"],
  ["data_source", "data_source"],
  ["input_data", "input_data"],
  ["input_requirements", "input_data"],
  ["product_information", "input_data"],
  ["input_material", "input_data"],
  ["desired_output", "desired_output"],
  ["workflow_output", "desired_output"],
  ["expected_output", "desired_output"],
  ["generated_assets", "desired_output"],
  ["deliverables", "desired_output"],
  ["output_destination", "output_destination"],
  ["save_location", "output_destination"],
  ["delivery_location", "output_destination"],
  ["review_location", "output_destination"],
  ["notification_target", "notification_target"],
  ["notify_reviewer", "notification_target"],
  ["notification_recipient", "notification_target"],
  ["decision_rules", "decision_rules"],
  ["routing_rule", "decision_rules"],
  ["human_owner", "human_owner"],
  ["human_reviewer", "human_owner"],
  ["reviewer", "human_owner"],
  ["approver", "human_owner"],
  ["channel_owner", "human_owner"],
  ["approval_boundary", "approval_boundary"],
  ["approval_process", "approval_boundary"],
  ["approval_rule", "approval_boundary"],
  ["human_approval", "approval_boundary"],
  ["external_action_boundary", "external_action_boundary"],
  ["publishing_boundary", "external_action_boundary"],
  ["posting_boundary", "external_action_boundary"],
  ["execution_boundary", "external_action_boundary"],
  ["success_criteria", "success_criteria"],
  ["definition_of_done", "success_criteria"],
  ["verification", "success_criteria"],
]);

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/\s+/g, " ");
}

function withoutWrappingPunctuation(value: string): string {
  return normalize(value)
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .replace(/["']/g, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function uniqueConcreteStrings(values: readonly string[], field?: string): string[] {
  return [...new Set(
    values
      .map(normalize)
      .filter((value) => isConcreteKnownFact(value, field)),
  )];
}

export function isConcreteKnownFact(
  value: string | string[] | undefined,
  field?: string,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => isConcreteKnownFact(item, field));
  }

  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalize(value);

  if (normalized.length < 2 || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if ((field === "goal" || field === "task_type" || field === "workflow_goal")
    && VAGUE_GOAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return true;
}

export function createEmptyStructuredWorkflowIntent(originalInput: string): StructuredWorkflowIntent {
  return {
    version: "1",
    original_input: normalize(originalInput),
    input_sources: [],
    input_data: [],
    desired_outputs: [],
    output_destinations: [],
    notification_targets: [],
    decision_rules: [],
    external_actions: [],
  };
}

export function getConcreteStructuredWorkflowIntent(
  intent: StructuredWorkflowIntent,
): StructuredWorkflowIntent {
  const normalized = createEmptyStructuredWorkflowIntent(intent.original_input);

  for (const field of [
    "goal",
    "task_type",
    "trigger",
    "human_owner",
    "approval_boundary",
    "external_action_boundary",
    "success_criteria",
  ] as const) {
    const value = intent[field];

    if (isConcreteKnownFact(value, field)) {
      normalized[field] = normalize(value!);
    }
  }

  normalized.input_sources = uniqueConcreteStrings(intent.input_sources, "input_sources");
  normalized.input_data = uniqueConcreteStrings(intent.input_data, "input_data");
  normalized.desired_outputs = uniqueConcreteStrings(intent.desired_outputs, "desired_outputs");
  normalized.output_destinations = uniqueConcreteStrings(intent.output_destinations, "output_destinations");
  normalized.notification_targets = uniqueConcreteStrings(intent.notification_targets, "notification_targets");
  normalized.decision_rules = uniqueConcreteStrings(intent.decision_rules, "decision_rules");
  normalized.external_actions = uniqueConcreteStrings(intent.external_actions, "external_actions");

  return normalized;
}

export function getClarificationAnswerKind(
  answer: Pick<ClarificationSessionAnswer, "question_id" | "question">,
): ClarificationQuestionKind | undefined {
  const id = answer.question_id.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const knownIdKind = QUESTION_ID_KIND.get(id);

  if (knownIdKind) {
    return knownIdKind;
  }

  const question = answer.question.toLowerCase();

  if (/what kind of tasks|task category|type of (?:task|workflow|content)/.test(question)) return "task_type";
  if (/when should|what (?:starts|triggers)|how often|on demand|schedule/.test(question)) return "trigger";
  if (/where should .*\b(?:saved|delivered|stored)\b|save location|delivery location|review location/.test(question)) return "output_destination";
  if (/who should be notified|notification recipient|notify whom|who gets? (?:the )?notification/.test(question)) return "notification_target";
  if (/source material|where (?:will|does) .*\b(?:read|receive|collect)\b|data source|read .* from|what .* use to generate/.test(question)) return "data_source";
  if (/what (?:data|fields|details|material|input)/.test(question)) return "input_data";
  if (/what should .* (?:produce|create|generate)|desired output|expected output/.test(question)) return "desired_output";
  if (/who (?:reviews|approves|owns)|human owner|reviewer|approver/.test(question)) return "human_owner";
  if (/what must stay|approval|before .* (?:sent|posted|published|changed)/.test(question)) return "approval_boundary";
  if (/success|worked correctly|definition of done/.test(question)) return "success_criteria";

  return undefined;
}

function notificationTargetFromClause(clause: string): string | undefined {
  const normalized = normalize(clause).replace(/[.]+$/g, "");
  const emailTarget = normalized.match(/^email\s+(?:the\s+)?(.+?)(?:\s+with\b.*)?$/i)?.[1];
  const notifyByEmailTarget = normalized.match(/^notify\s+(?:the\s+)?(.+?)\s+by\s+email(?:\s+.*)?$/i)?.[1];
  const sendTarget = normalized.match(/^send\s+(?:the\s+)?(.+?)\s+an?\s+email(?:\s+notification)?(?:\s+.*)?$/i)?.[1];
  const sendToTarget = normalized.match(/^send\s+an?\s+email(?:\s+notification)?\s+to\s+(?:the\s+)?(.+?)(?:\s+with\b.*)?$/i)?.[1];
  const genericTarget = normalized.match(/^notify\s+(?:the\s+)?(.+?)(?:\s+with\b.*)?$/i)?.[1];
  const target = emailTarget ?? notifyByEmailTarget ?? sendTarget ?? sendToTarget ?? genericTarget;

  if (!target) {
    return undefined;
  }

  const cleanedTarget = withoutWrappingPunctuation(target);
  const byEmail = /\bemail\b/i.test(normalized);
  return cleanedTarget ? `${cleanedTarget}${byEmail ? " by email" : ""}` : undefined;
}

export function splitOutputDestinationAnswer(answer: string): {
  destination: string;
  notificationTarget?: string;
} {
  const normalized = normalize(answer);
  const split = normalized.match(
    /^(?:save|store|deliver|place|put)\s+(?:(?:all|the)\s+)*(?:(?:generated|finished)\s+)?(?:assets?|outputs?|deliverables?|files?)\s+(?:in|to)\s+(.+?)\s+and\s+((?:send|email|notify)\b.+)$/i,
  );

  if (!split) {
    return { destination: normalized };
  }

  const notificationTarget = notificationTargetFromClause(split[2] ?? "");

  if (!notificationTarget) {
    return { destination: normalized };
  }

  return {
    destination: withoutWrappingPunctuation(split[1] ?? normalized),
    notificationTarget,
  };
}

export function normalizeHumanOwner(answer: string): string {
  const normalized = normalize(answer).replace(/[.]+$/g, "");
  const leadingRole = normalized.match(
    /^(?:the\s+)?(.+?\b(?:manager|lead|owner|reviewer|approver|director|coordinator|administrator|advisor|team|staff|agent))\s+(?:reviews?|approves?|owns?|checks?|must|will|is)\b/i,
  )?.[1];
  const reviewedByRole = normalized.match(
    /\b(?:reviewed|approved|owned)\s+by\s+(?:the\s+)?(.+?\b(?:manager|lead|owner|reviewer|approver|director|coordinator|administrator|advisor|team|staff|agent))\b/i,
  )?.[1];
  const candidate = leadingRole ?? reviewedByRole;

  if (candidate) {
    return withoutWrappingPunctuation(candidate).toLowerCase();
  }

  const words = normalized.split(/\s+/);
  if (words.length <= 8 && !/\b(?:reviews?|approves?|before|after|when|must|will)\b/i.test(normalized)) {
    return withoutWrappingPunctuation(normalized).toLowerCase();
  }

  return normalized;
}

function addUnique(items: string[], value: string): void {
  const normalized = normalize(value);
  if (normalized && !items.includes(normalized)) items.push(normalized);
}

function inferPlainTextFacts(originalInput: string): StructuredWorkflowIntent {
  const intent = createEmptyStructuredWorkflowIntent(originalInput);
  const text = normalize(originalInput);
  const lower = text.toLowerCase();

  if (isConcreteKnownFact(text, "goal")) {
    intent.goal = text;
    intent.task_type = text;
  }

  if (/\b(?:when|whenever|after|once|on demand|manually|every|daily|weekly|monthly|scheduled?)\b/i.test(text)) {
    intent.trigger = text;
  }

  const sourcePhrases = [
    "support inbox",
    "admissions inbox",
    "shared inbox",
    "zendesk",
    "intercom",
    "google sheet",
    "spreadsheet",
    "database",
    "campaign brief",
    "product description",
    "source material",
    "brand assets",
  ];
  for (const source of sourcePhrases) {
    if (lower.includes(source)) addUnique(intent.input_sources, source);
  }

  const inputPhrases = [
    "support email",
    "customer email",
    "ticket",
    "customer message",
    "product information",
    "campaign brief",
    "product description",
    "brand assets",
  ];
  for (const inputData of inputPhrases) {
    if (lower.includes(inputData)) addUnique(intent.input_data, inputData);
  }

  const outputPattern = /\b(?:produce|create|generate|draft|summarize|classify|extract|prepare|route)\s+(.+?)(?=\s+(?:from|using|into|to|and\s+(?:send|email|notify|save|store|deliver))\b|[.;]|$)/gi;
  for (const match of text.matchAll(outputPattern)) {
    if (match[1]) addUnique(intent.desired_outputs, match[1]);
  }

  const externalActionPattern = /\b(?:send|email|notify|publish|post|update|delete|refund|charge)\b/gi;
  for (const match of text.matchAll(externalActionPattern)) {
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 40), index);
    if (/\b(?:do not|don't|never|must not|should not|without|no automatic(?:ally)?)\b/i.test(prefix)) continue;
    addUnique(intent.external_actions, (match[0] ?? "").toLowerCase());
    break;
  }

  return getConcreteStructuredWorkflowIntent(intent);
}

export function inferStructuredWorkflowIntent(input: {
  originalInput: string;
  answers: ClarificationSessionAnswer[];
}): StructuredWorkflowIntent {
  const intent = inferPlainTextFacts(input.originalInput);

  for (const answer of input.answers) {
    const kind = getClarificationAnswerKind(answer);
    const value = normalize(answer.answer);

    if (!kind || !isConcreteKnownFact(value, kind)) continue;

    if (kind === "workflow_goal") intent.goal = value;
    if (kind === "task_type") intent.task_type = value;
    if (kind === "trigger") intent.trigger = value;
    if (kind === "data_source") addUnique(intent.input_sources, value);
    if (kind === "input_data") addUnique(intent.input_data, value);
    if (kind === "desired_output") addUnique(intent.desired_outputs, value);
    if (kind === "decision_rules") addUnique(intent.decision_rules, value);
    if (kind === "success_criteria") intent.success_criteria = value;

    if (kind === "output_destination") {
      const split = splitOutputDestinationAnswer(value);
      addUnique(intent.output_destinations, split.destination);
      if (split.notificationTarget) {
        addUnique(intent.notification_targets, split.notificationTarget);
        addUnique(intent.external_actions, `Email ${split.notificationTarget.replace(/ by email$/i, "")}`);
      }
    }

    if (kind === "notification_target") {
      const target = notificationTargetFromClause(value) ?? value;
      addUnique(intent.notification_targets, target);
      addUnique(intent.external_actions, `Notify ${target.replace(/ by email$/i, "")}`);
    }

    if (kind === "human_owner") {
      intent.human_owner = normalizeHumanOwner(value);
      if (/\b(?:review|approve)\w*\b/i.test(value) && intent.human_owner !== value) {
        intent.approval_boundary = value;
      }
    }

    if (kind === "approval_boundary") {
      intent.approval_boundary = value;
      if (/\b(?:before|draft.only|no automatic|never automatically|must not)\b/i.test(value)) {
        intent.external_action_boundary = value;
      }
    }

    if (kind === "external_action_boundary") {
      intent.external_action_boundary = value;
    }
  }

  return getConcreteStructuredWorkflowIntent(intent);
}

export function isSafetyBoundaryAnswer(answer: ClarificationSessionAnswer): boolean {
  const kind = getClarificationAnswerKind(answer);
  return kind === "approval_boundary" || kind === "external_action_boundary";
}

export function structuredIntentHasExternalAction(intent: StructuredWorkflowIntent): boolean {
  if (intent.external_actions.length > 0 || intent.notification_targets.length > 0) return true;

  const semanticValues = [
    intent.goal,
    intent.task_type,
    ...intent.desired_outputs,
    intent.approval_boundary,
    intent.external_action_boundary,
  ].filter((value): value is string => Boolean(value)).join(" ");

  const clauses = semanticValues.split(/[.!?;]+/).map((clause) => clause.trim()).filter(Boolean);
  const actionPattern = /\b(?:send|email|notify|publish|post|update|change|delete|refund|charge)\b/gi;

  return clauses.some((clause) => {
    for (const match of clause.matchAll(actionPattern)) {
      const prefix = clause.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
      if (!/\b(?:do not|don't|never|must not|should not|without|no automatic(?:ally)?)\b/i.test(prefix)) {
        return true;
      }
    }

    return false;
  });
}
