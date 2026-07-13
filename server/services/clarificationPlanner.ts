import type {
  ClarificationField,
  ClarificationPlan,
  ClarificationQuestion,
  RouterDecision,
} from "../../shared/types/compileJob";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
import type { AutomationReadinessScore, RiskSummary, SignalSummary } from "../../shared/types/workflow";
import type { StructuredIntentReadiness } from "./structuredIntentReadiness";

const GENERIC_TEMPLATE =
  "When [trigger happens], read [input source], process [input data], create [desired output], and route [external actions] to [human owner] before anything is sent, updated, charged, deleted, or executed.";

const QUESTION_MAP: Record<ClarificationField, Omit<ClarificationQuestion, "field">> = {
  task_type: {
    question: "What kind of workflow should FlowForge build?",
    why_it_matters: "A concrete goal or task type is required before the workflow can be designed.",
    example_answer: "Generate a reviewable social media content package.",
  },
  trigger: {
    question: "What starts this workflow?",
    why_it_matters: "A reliable blueprint needs a confirmed starting event or schedule.",
    example_answer: "When a new message arrives in the support inbox.",
  },
  input_source: {
    question: "Where should the workflow read its source material or items from?",
    why_it_matters: "The workflow needs a confirmed input source or input-data description.",
    example_answer: "A campaign brief and product description in the marketing workspace.",
  },
  input_data: {
    question: "What data or messages should the workflow read?",
    why_it_matters: "The workflow needs to know what will be processed, classified, extracted, or reviewed.",
    example_answer: "Customer emails including subject, body, sender, and order ID if present.",
  },
  desired_output: {
    question: "What should the workflow produce?",
    why_it_matters: "A confirmed desired output is required before the workflow can be designed.",
    example_answer: "Draft images, captions, voice, video, and post text for review.",
  },
  output_destination: {
    question: "Where should the generated result be saved or delivered for review?",
    why_it_matters: "The output destination is separate from the source material.",
    example_answer: "The Promo Drafts Google Drive folder.",
  },
  notification_target: {
    question: "Who should be notified when the result is ready?",
    why_it_matters: "A notification recipient is separate from input data and output storage.",
    example_answer: "The marketing manager by email.",
  },
  decision_rules: {
    question: "What rules or conditions determine the outcome for different cases?",
    why_it_matters: "Decision rules make classification and routing steps concrete.",
    example_answer: "If the complaint mentions a charge, route to finance. Otherwise, route to support.",
  },
  human_owner: {
    question: "Who is responsible for reviewing or approving the result?",
    why_it_matters: "External or high-stakes actions require accountable human ownership.",
    example_answer: "The support team lead.",
  },
  approval_boundary: {
    question: "Which actions must stay human-approved before anything is executed?",
    why_it_matters: "An approval boundary keeps sensitive or external actions human-gated.",
    example_answer: "No message can be sent without support-lead approval.",
  },
  external_action_boundary: {
    question: "What must never be sent, updated, or changed automatically without a human step?",
    why_it_matters: "A clear external-action boundary prevents unintended real-world execution.",
    example_answer: "No messages or account changes happen automatically.",
  },
  success_criteria: {
    question: "How would you know the workflow ran correctly?",
    why_it_matters: "Success criteria give reviewers a way to verify a dry run.",
    example_answer: "A review task is created in the right queue and no messages are sent.",
  },
};

function missingReadinessFields(readiness: StructuredIntentReadiness): ClarificationField[] {
  return readiness.missing_fields.map((field) => {
    if (field === "goal_or_task_type") return "task_type";
    if (field === "input_source_or_data") return "input_source";
    if (field === "desired_output") return "desired_output";
    if (field === "approval_or_external_action_boundary") return "approval_boundary";
    return field;
  });
}

function buildQuestions(missingFields: ClarificationField[]): ClarificationQuestion[] {
  return missingFields.map((field) => ({ field, ...QUESTION_MAP[field] }));
}

function buildImprovedPromptStarter(
  intent: StructuredWorkflowIntent,
  signals: SignalSummary,
  risks: RiskSummary,
): string {
  const hasFinancial = risks.categories.some((category) => ["financial", "refund_or_payment"].includes(category));
  const hasVisaOrMedical = risks.categories.some((category) => ["visa_or_immigration", "medical", "legal"].includes(category));
  const hasEmployment = risks.categories.includes("employment");

  if (hasFinancial) {
    return "When a customer reports a billing issue, read the confirmed request data, prepare an internal finance review task, and require the confirmed human owner to approve before any refund or message is sent.";
  }

  if (hasVisaOrMedical) {
    return "When a sensitive question arrives from the confirmed source, prepare a cautious internal summary and route it to a qualified human owner before any reply or decision.";
  }

  if (hasEmployment) {
    return "When a candidate or employee request arrives, extract the confirmed input data and route an internal review package to the human owner before any response or decision.";
  }

  if (signals.has_external_action) {
    return "When the confirmed trigger occurs, read the confirmed input, prepare the requested draft output, and require the human owner to approve before any external action.";
  }

  if (signals.has_scheduled_trigger) {
    return "On the confirmed schedule, read the confirmed input source, create the requested internal output, and keep any external action human-reviewed.";
  }

  return intent.goal ?? intent.task_type ?? GENERIC_TEMPLATE;
}

function buildReason(
  missingFields: ClarificationField[],
  readiness: AutomationReadinessScore,
  route: RouterDecision["route"],
): string {
  const labels = missingFields.map((field) => field.replaceAll("_", " ")).join(", ");
  const routeNote = route === "needs_clarification"
    ? "The router also recommended clarification. "
    : "";
  return `${routeNote}Canonical workflow intent is missing confirmed ${labels}. Current readiness score: ${readiness.score}/100.`;
}

export type BuildClarificationPlanInput = {
  intent: StructuredWorkflowIntent;
  intentReadiness: StructuredIntentReadiness;
  signals: SignalSummary;
  risks: RiskSummary;
  readiness: AutomationReadinessScore;
  route: RouterDecision["route"];
};

export function buildClarificationPlan(input: BuildClarificationPlanInput): ClarificationPlan {
  const missingFields = missingReadinessFields(input.intentReadiness);

  if (input.intentReadiness.ready) {
    return {
      needed: false,
      reason: "",
      missing_fields: [],
      questions: [],
      suggested_template: GENERIC_TEMPLATE,
      improved_prompt_starter: "",
    };
  }

  return {
    needed: true,
    reason: buildReason(missingFields, input.readiness, input.route),
    missing_fields: missingFields,
    questions: buildQuestions(missingFields),
    suggested_template: GENERIC_TEMPLATE,
    improved_prompt_starter: buildImprovedPromptStarter(input.intent, input.signals, input.risks),
  };
}
