import type { ClarificationField, ClarificationPlan, ClarificationQuestion, RouterDecision } from "../../shared/types/compileJob";
import type { AutomationReadinessScore, RiskSummary, SignalSummary } from "../../shared/types/workflow";

const GENERIC_TEMPLATE =
  "When [trigger happens], read [data source], extract/classify [important fields], create [safe internal output], and route [risky or external actions] to [human/team] before anything is sent, updated, charged, deleted, or executed.";

function countWords(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

function isVagueInput(processInput: string, signals: SignalSummary): boolean {
  const words = countWords(processInput);
  // Very short OR has almost no primitives detected (just intake)
  return words < 20 && signals.workflow_primitives.filter((p) => p !== "intake").length === 0;
}

function detectMissingFields(
  processInput: string,
  signals: SignalSummary,
  risks: RiskSummary,
  readiness: AutomationReadinessScore,
): ClarificationField[] {
  const missing: ClarificationField[] = [];

  if (!signals.has_trigger) {
    missing.push("trigger");
  }

  if (!signals.has_clear_output) {
    missing.push("output");
  }

  // No primitives that imply a data source or clear input data
  const hasDataPrimitive =
    signals.workflow_primitives.some((p) =>
      ["classification", "extraction", "summarization", "drafting", "record_creation"].includes(p),
    );

  if (!hasDataPrimitive || isVagueInput(processInput, signals)) {
    if (!missing.includes("output")) {
      // Only add data_source if we have no clear data handling either
      const hasDataHandling = signals.workflow_primitives.some((p) =>
        ["extraction", "summarization"].includes(p),
      );

      if (!hasDataHandling) {
        missing.push("data_source");
      }
    }
  }

  // If there's external action risk but no human actor, ask for human owner and boundary
  if (signals.has_external_action && !signals.has_human_actor) {
    missing.push("human_owner");
    missing.push("external_action_boundary");
  } else if (signals.has_external_action) {
    // Has external action AND human actor, but still clarify what stays draft-only
    if (!missing.includes("external_action_boundary")) {
      missing.push("approval_boundary");
    }
  }

  // High-stakes risks but no human actor mentioned
  const highStakesRisks = [
    "financial",
    "refund_or_payment",
    "legal",
    "medical",
    "visa_or_immigration",
    "employment",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
    "delete_or_destructive_action",
  ] as const;

  const hasHighStakes = risks.categories.some((c) => highStakesRisks.includes(c as (typeof highStakesRisks)[number]));

  if (hasHighStakes && !signals.has_human_actor) {
    if (!missing.includes("human_owner")) {
      missing.push("human_owner");
    }

    if (!missing.includes("approval_boundary") && !missing.includes("external_action_boundary")) {
      missing.push("approval_boundary");
    }
  }

  // Vague or empty primitives → ask for decision rules
  if (isVagueInput(processInput, signals) && !missing.includes("decision_rules")) {
    missing.push("decision_rules");
  }

  // Remove duplicates while preserving order
  return [...new Set(missing)];
}

const QUESTION_MAP: Record<ClarificationField, Omit<ClarificationQuestion, "field">> = {
  trigger: {
    question: "What starts this workflow?",
    why_it_matters:
      "Without a trigger, FlowForge cannot decide when the automation should run. A reliable blueprint needs a clear starting event.",
    example_answer: "When a new message arrives in the support inbox.",
  },
  input_data: {
    question: "What data or messages should the workflow read?",
    why_it_matters: "Without a data source, FlowForge cannot describe what will be processed or extracted.",
    example_answer: "Customer emails in the support@company.com inbox.",
  },
  output: {
    question: "What should the workflow produce — a draft reply, a tag, a task, or a summary?",
    why_it_matters:
      "Without a clear output, the blueprint cannot describe what gets created. Knowing the output also determines which steps are safe to automate.",
    example_answer: "An internal review task assigned to the support team.",
  },
  decision_rules: {
    question: "What rules or conditions determine the outcome for different cases?",
    why_it_matters:
      "Decision rules help FlowForge generate accurate classification and routing steps rather than a vague placeholder.",
    example_answer: "If the complaint mentions a charge, route to finance. Otherwise, route to support.",
  },
  human_owner: {
    question: "Who is responsible for reviewing or approving the result?",
    why_it_matters:
      "Human ownership is required for any workflow that touches sensitive data, external messages, or high-stakes decisions. Without it, FlowForge cannot generate safe approval gates.",
    example_answer: "The support team lead, or the finance team for refunds.",
  },
  approval_boundary: {
    question: "Which actions must stay human-approved before anything is executed?",
    why_it_matters:
      "Approval boundaries let FlowForge mark steps as human-gated so that sensitive changes, payments, or messages do not happen automatically.",
    example_answer: "No refund can be issued without finance approval. No message can be sent without a human review.",
  },
  external_action_boundary: {
    question: "What must never be sent, updated, or changed automatically without a human step?",
    why_it_matters:
      "Without a clear external action boundary, FlowForge cannot enforce a safe non-executing preview. This is the most important safety question for workflows that interact with real systems.",
    example_answer: "No messages sent. No account changes. No charges. All external actions remain draft-only.",
  },
  data_source: {
    question: "What customer messages, emails, or records should FlowForge read?",
    why_it_matters:
      "Without a data source, the blueprint is too abstract to validate or plan safely.",
    example_answer: "New inbound emails in the admissions inbox, or Zendesk tickets tagged as unread.",
  },
  success_criteria: {
    question: "How would you know the workflow ran correctly?",
    why_it_matters:
      "Success criteria help FlowForge generate dry-run test cases and give reviewers a way to verify that the workflow did the right thing.",
    example_answer: "A review task was created in the right queue, no messages were sent, and the ticket was tagged.",
  },
};

function buildQuestions(missingFields: ClarificationField[]): ClarificationQuestion[] {
  return missingFields.map((field) => ({
    field,
    ...QUESTION_MAP[field],
  }));
}

function buildSuggestedTemplate(): string {
  return GENERIC_TEMPLATE;
}

function buildImprovedPromptStarter(
  processInput: string,
  signals: SignalSummary,
  risks: RiskSummary,
): string {
  // Detect likely domain for a more targeted starter
  const hasExternalComm = risks.categories.includes("external_communication");
  const hasFinancial = risks.categories.some((c) => ["financial", "refund_or_payment"].includes(c));
  const hasVisa = risks.categories.includes("visa_or_immigration");
  const hasEmployment = risks.categories.includes("employment");
  const hasMedical = risks.categories.includes("medical");

  if (hasFinancial) {
    return "When a customer reports a billing issue or charge dispute, classify the complaint, extract the order ID and payment amount, draft an internal case summary, and route it to [finance team/owner] for review before any refund or message is sent.";
  }

  if (hasVisa || hasMedical) {
    return "When a [student/patient/applicant] asks a [visa/medical] question, summarize the question, draft a cautious internal note, and route it to [advisor/reviewer] for review before any reply is sent.";
  }

  if (hasEmployment) {
    return "When a [candidate/employee] submits a [request/application], extract the relevant fields, classify priority, and route to [hiring team/HR] for review before any response or decision is made.";
  }

  if (hasExternalComm) {
    return "When a new [customer/student] message arrives in [channel], classify the topic and urgency, draft an internal response suggestion, and route it to [support owner/team] for review before any reply is sent.";
  }

  if (signals.has_scheduled_trigger) {
    return "Every [morning/week], collect [new items] from [source/inbox], extract [key fields], classify [priority/type], and create an internal review task for [team] without sending any external messages.";
  }

  // Generic fallback for vague inputs
  return "When [trigger happens], read [data source], extract and classify [important fields], create an internal [task/summary/draft] for [team/owner] to review, and keep all external actions draft-only until a human approves.";
}

function buildClarificationReason(
  processInput: string,
  signals: SignalSummary,
  readiness: AutomationReadinessScore,
  route: RouterDecision["route"],
): string {
  const parts: string[] = [];

  if (route === "needs_clarification") {
    parts.push("The router determined this process needs clarification before a reliable blueprint can be built.");
  }

  if (readiness.score < 40) {
    parts.push(`Readiness score is ${readiness.score}/100 — the process description is too vague for a safe blueprint.`);
  } else if (readiness.score < 60) {
    parts.push(`Readiness score is ${readiness.score}/100 — additional detail will make the blueprint more reliable.`);
  }

  if (!signals.has_trigger) {
    parts.push("No clear trigger was detected.");
  }

  if (!signals.has_clear_output) {
    parts.push("No clear expected output was detected.");
  }

  if (signals.missing_critical_info.length > 0) {
    parts.push(`Missing critical information: ${signals.missing_critical_info.join(" ")}`);
  }

  if (parts.length === 0) {
    parts.push("Some important workflow details are missing or unclear.");
  }

  return parts.join(" ");
}

export type BuildClarificationPlanInput = {
  processInput: string;
  signals: SignalSummary;
  risks: RiskSummary;
  readiness: AutomationReadinessScore;
  route: RouterDecision["route"];
};

export function buildClarificationPlan(input: BuildClarificationPlanInput): ClarificationPlan {
  const { processInput, signals, risks, readiness, route } = input;

  // Determine whether clarification is needed
  const routeNeedsClarification = route === "needs_clarification";
  const lowReadiness = readiness.score < 60;
  const hasMissingCriticalInfo = signals.missing_critical_info.length > 0;
  const noTrigger = !signals.has_trigger;
  const noOutput = !signals.has_clear_output;
  const vague = isVagueInput(processInput, signals);
  const externalWithoutHuman = signals.has_external_action && !signals.has_human_actor;

  // High stakes without human owner
  const highStakesRisks = [
    "financial",
    "refund_or_payment",
    "legal",
    "medical",
    "visa_or_immigration",
    "employment",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
    "delete_or_destructive_action",
  ] as const;

  const hasHighStakes = risks.categories.some((c) => highStakesRisks.includes(c as (typeof highStakesRisks)[number]));
  const highStakesWithoutHuman = hasHighStakes && !signals.has_human_actor;

  const needed =
    routeNeedsClarification ||
    (lowReadiness && (noTrigger || noOutput || hasMissingCriticalInfo || vague)) ||
    externalWithoutHuman ||
    highStakesWithoutHuman;

  if (!needed) {
    return {
      needed: false,
      reason: "",
      missing_fields: [],
      questions: [],
      suggested_template: GENERIC_TEMPLATE,
      improved_prompt_starter: "",
    };
  }

  const missingFields = detectMissingFields(processInput, signals, risks, readiness);
  const questions = buildQuestions(missingFields);
  const reason = buildClarificationReason(processInput, signals, readiness, route);
  const suggestedTemplate = buildSuggestedTemplate();
  const improvedPromptStarter = buildImprovedPromptStarter(processInput, signals, risks);

  return {
    needed: true,
    reason,
    missing_fields: missingFields,
    questions,
    suggested_template: suggestedTemplate,
    improved_prompt_starter: improvedPromptStarter,
  };
}
