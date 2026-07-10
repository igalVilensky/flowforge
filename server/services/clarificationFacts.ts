import type {
  ClarificationKnownFacts,
  ClarificationQuestionKind,
  ClarificationSessionAnswer,
} from "../../shared/types/clarificationSession";

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

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

  if ((field === "workflow_goal" || field === "task_type")
    && VAGUE_GOAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return true;
}

export function getConcreteKnownFacts(knownFacts: ClarificationKnownFacts): ClarificationKnownFacts {
  const concrete: ClarificationKnownFacts = {};

  for (const [rawField, value] of Object.entries(knownFacts)) {
    const field = rawField as keyof ClarificationKnownFacts;

    if (!isConcreteKnownFact(value, field)) {
      continue;
    }

    if (Array.isArray(value)) {
      const concreteValues = value.filter((item) => isConcreteKnownFact(item, field));

      if (concreteValues.length > 0) {
        (concrete as Record<string, unknown>)[field] = concreteValues;
      }
    } else {
      (concrete as Record<string, unknown>)[field] = normalize(value);
    }
  }

  return concrete;
}

export function getClarificationAnswerKind(
  answer: Pick<ClarificationSessionAnswer, "question_id" | "question">,
): ClarificationQuestionKind | undefined {
  const id = answer.question_id.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const question = answer.question.toLowerCase();

  if (/task_type|task_category|choose_task|workflow_type|content_type/.test(id)) return "task_type";
  if (/trigger|timing|schedule|start/.test(id)) return "trigger";
  if (/data_source|workflow_source|content_source|source_material|input_source/.test(id)) return "data_source";
  if (/input_data|input_material|source_input/.test(id)) return "input_data";
  if (/desired_output|workflow_output|expected_output|deliverable/.test(id)) return "desired_output";
  if (/decision_rule|routing_rule|condition/.test(id)) return "decision_rules";
  if (/human_owner|human_reviewer|reviewer|approver|channel_owner/.test(id)) return "human_owner";
  if (/approval_boundary|approval_process|approval_rule|human_approval/.test(id)) return "approval_boundary";
  if (/external_action|publishing_boundary|posting_boundary|execution_boundary/.test(id)) return "external_action_boundary";
  if (/success_criteria|definition_of_done|verification/.test(id)) return "success_criteria";
  if (/workflow_goal|automation_goal/.test(id)) return "workflow_goal";

  if (/what kind of tasks|task category|type of (?:task|workflow|content)/.test(question)) return "task_type";
  if (/when should|what (?:starts|triggers)|how often|on demand|schedule/.test(question)) return "trigger";
  if (/source material|where (?:will|should|does)|data source|read .* from|what .* use to generate/.test(question)) return "data_source";
  if (/what (?:data|fields|details|material|input)/.test(question)) return "input_data";
  if (/what should .* (?:produce|create|generate)|desired output|expected output/.test(question)) return "desired_output";
  if (/who (?:reviews|approves|owns)|human owner|reviewer|approver/.test(question)) return "human_owner";
  if (/what must stay|approval|before .* (?:sent|posted|published|changed)/.test(question)) return "approval_boundary";
  if (/success|worked correctly|definition of done/.test(question)) return "success_criteria";

  return undefined;
}

export function isSafetyBoundaryAnswer(answer: ClarificationSessionAnswer): boolean {
  const kind = getClarificationAnswerKind(answer);
  return kind === "approval_boundary" || kind === "external_action_boundary";
}
