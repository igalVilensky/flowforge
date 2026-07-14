import type { ClarificationSessionAnswer } from "../../shared/types/clarificationSession";
import type { FixtureValidationCheck } from "../services/schemaValidator";
import {
  buildDeterministicClarificationSession,
  inferKnownFacts,
  normalizeAgentSession,
} from "../services/clarificationConversationAgent";
import {
  buildDeterministicBlueprintArchitectFallback,
} from "../services/blueprintArchitectAgent";
import { buildBlueprint, detectBlueprintDomain } from "../services/blueprintBuilder";
import { scoreReadiness } from "../services/readinessScorer";
import { scanRisks } from "../services/riskScanner";
import { scanSignals } from "../services/signalScanner";
import {
  parseCompileAnalysisInput,
  serializeStructuredCompileInput,
} from "../services/structuredCompileInput";

const originalInput = "Automate my tasks.";

const socialAnswers: ClarificationSessionAnswer[] = [
  {
    question_id: "choose_task_category",
    question: "What kind of tasks should FlowForge help with first?",
    answer: "Content generation for social media.",
  },
  {
    question_id: "human_reviewer",
    question: "Who reviews the result before anything is posted?",
    answer: "The channel owner.",
  },
  {
    question_id: "approval_process",
    question: "What must stay human-approved or draft-only?",
    answer: "The channel owner reviews and explicitly approves every post before posting.",
  },
  {
    question_id: "workflow_trigger",
    question: "When should this workflow start?",
    answer: "On demand.",
  },
];

const sourceAnswer: ClarificationSessionAnswer = {
  question_id: "content_source_material",
  question: "What source material should the workflow use to generate the social media content?",
  answer: "A product description, campaign brief, brand assets, and key marketing points.",
};

const jobApplicationInput = "Handle new job applications automatically.";
const jobApplicationAnswers: ClarificationSessionAnswer[] = [
  {
    question_id: "choose_task_category",
    question: "What should the workflow do?",
    answer: "Automatically send an acknowledgement email to applicants.",
  },
  {
    question_id: "desired_output",
    question: "What should the workflow produce?",
    answer: "Produce a summary, acknowledgement email, tags, and an internal review task.",
  },
  {
    question_id: "workflow_trigger",
    question: "When should this workflow start?",
    answer: "Trigger when an email with subject Job Application arrives in the HR inbox.",
  },
];

function check(name: string, success: boolean, message: string): FixtureValidationCheck {
  return {
    name,
    success,
    issues: success
      ? []
      : [{
        path: "(regression)",
        message,
        code: "pipeline_regression",
      }],
  };
}

function buildBlueprintForIntent(intent: string) {
  const signals = scanSignals(intent);
  const risks = scanRisks(signals);
  const readiness = scoreReadiness(signals, risks);
  const blueprint = buildBlueprint({
    jobId: "pipeline_regression",
    processInput: intent,
    signals,
    risks,
    readiness,
    mode: "rule_only",
  });

  return { signals, risks, readiness, blueprint };
}

export function buildPipelineRegressionChecks(): FixtureValidationCheck[] {
  const partialInput = { originalInput, answers: socialAnswers };
  const partialFacts = inferKnownFacts(partialInput);
  const providerNeedsSource = normalizeAgentSession({
    current_summary: "An on-demand social content workflow with channel-owner approval still needs source material.",
    known_facts: {
      ...partialFacts,
      data_source: "The source mentioned by the user.",
      input_data: ["ticket or message details mentioned by the user"],
    },
    next_question: {
      id: "content_source_material",
      kind: "data_source",
      question: "What source material should the workflow use to generate the social media content?",
      why_it_matters: "Content generation needs a concrete source.",
      example_answer: "A product description, campaign brief, blog post, image assets, or key marketing points.",
    },
    status: "needs_answer",
    ready_to_compile: false,
    reason: "Source material is still missing.",
  }, partialInput);
  const partialIntent = [originalInput, ...socialAnswers.map((answer) => answer.answer)].join("\n");

  const completedAnswers = [...socialAnswers, sourceAnswer];
  const completedSession = buildDeterministicClarificationSession(
    { originalInput, answers: completedAnswers },
    "Regression fixture deterministic clarification.",
  );
  const completedAnalysis = parseCompileAnalysisInput(completedSession.rewritten_compile_prompt ?? "");
  const completed = buildBlueprintForIntent(completedAnalysis.intent);
  const completedStepText = completed.blueprint.steps.map((step) => `${step.label} ${step.description}`).join(" ").toLowerCase();

  const boilerplatePrompt = serializeStructuredCompileInput({
    original_input: originalInput,
    clarified_intent: "Generate social media content on demand from a campaign brief.",
    known_facts: {
      workflow_goal: "Generate social media content for review.",
      task_type: "Content generation for social media",
      trigger: "On demand",
      data_source: "Campaign brief and product description",
      desired_output: "Draft social post package",
      human_owner: "Channel owner",
      approval_boundary: "Channel owner approval is required before posting",
    },
    clarification_answers: [...completedAnswers],
    safety_constraints: [
      "Do not issue refunds.",
      "Keep payments human-reviewed.",
      "Do not change accounts automatically.",
      "Do not delete production data.",
    ],
  });
  const boilerplateAnalysis = parseCompileAnalysisInput(boilerplatePrompt);
  const boilerplate = buildBlueprintForIntent(boilerplateAnalysis.intent);
  const boilerplateText = `${boilerplate.blueprint.workflow_name} ${boilerplate.blueprint.steps.map((step) => step.label).join(" ")}`.toLowerCase();
  const rawBoundaryOnly = buildBlueprintForIntent(
    "Generate social media content from a campaign brief. Do not issue refunds. Keep payments human-reviewed. Do not change accounts automatically. Do not delete production data.",
  );
  const genericBoundaryOnlyIntent = "Prepare a weekly internal report from the operations spreadsheet. Do not issue refunds. Keep payments human-reviewed. Do not change accounts automatically.";
  const genericBoundaryOnly = buildBlueprintForIntent(genericBoundaryOnlyIntent);

  const refundIntent = "When a customer submits a refund request, collect the order and amount, prepare a finance review task, and require a finance manager to approve before any refund is issued.";
  const refund = buildBlueprintForIntent(refundIntent);
  const refundText = `${refund.blueprint.workflow_name} ${refund.blueprint.steps.map((step) => step.label).join(" ")}`.toLowerCase();

  const architectFallback = buildDeterministicBlueprintArchitectFallback({
    processInput: completedAnalysis.intent,
    mode: "full",
    signals: completed.signals,
    risks: completed.risks,
    readiness: completed.readiness,
    routerDecision: {
      route: "compile_blueprint",
      confidence: "high",
      reason: "Regression fixture route.",
      safety_note: "External publishing requires approval.",
      suggested_next_step: "Build a non-executing preview.",
      provider: "deterministic",
      used_ai: false,
      fallback_used: true,
    },
    clarificationPlan: {
      needed: false,
      reason: "Concrete source material is available.",
      missing_fields: [],
      questions: [],
      suggested_template: "",
      improved_prompt_starter: completedAnalysis.intent,
    },
  }, "deterministic", "Groq and Gemini were unavailable in the regression fixture.");
  const fallbackText = `${architectFallback.workflow_name} ${architectFallback.proposed_steps.map((step) => step.label).join(" ")}`.toLowerCase();

  const duplicateQuestion = normalizeAgentSession({
    current_summary: "Social content workflow details collected.",
    known_facts: partialFacts,
    next_question: {
      id: "workflow_trigger",
      kind: "trigger",
      question: "When should this workflow start?",
      why_it_matters: "A trigger is required.",
    },
    status: "needs_answer",
    ready_to_compile: false,
    reason: "Ask for a trigger.",
  }, partialInput);
  const jobApplicationSession = buildDeterministicClarificationSession(
    { originalInput: jobApplicationInput, answers: jobApplicationAnswers },
    "Regression fixture minimal readiness.",
  );
  const cautiousJobApplicationSession = normalizeAgentSession({
    current_summary: "Job application acknowledgement workflow.",
    known_facts: jobApplicationSession.known_facts,
    next_question: {
      id: "human_reviewer",
      kind: "human_owner",
      question: "Who reviews the result?",
      why_it_matters: "Optional governance detail.",
    },
    status: "needs_answer",
    ready_to_compile: false,
    reason: "Provider requested an optional owner.",
  }, { originalInput: jobApplicationInput, answers: jobApplicationAnswers });
  const jobApplicationIntent = [
    jobApplicationInput,
    ...jobApplicationAnswers.map((answer) => answer.answer),
  ].join(" ");
  const jobApplicationBlueprint = buildBlueprintForIntent(jobApplicationIntent).blueprint;
  const supportSummaryIntent = [
    "Automate my tasks.",
    "Support emails from students.",
    "A summary.",
    "When a new email arrives in the student-support@university.edu inbox.",
  ].join(" ");
  const supportSummary = buildBlueprintForIntent(supportSummaryIntent);
  const supportSummaryText = supportSummary.blueprint.steps
    .map((step) => `${step.label} ${step.description} ${step.output}`)
    .join(" ")
    .toLowerCase();
  const supportSlack = buildBlueprintForIntent(
    "When a support email arrives, summarize it and send the summary to the support team in Slack.",
  );
  const extremeRefundSession = buildDeterministicClarificationSession({
    originalInput: "Automatically issue refunds for approved customer requests.",
    answers: [
      {
        question_id: "desired_output",
        question: "What should the workflow produce?",
        answer: "Issue the approved refund and create a receipt.",
      },
      {
        question_id: "workflow_trigger",
        question: "When should this workflow start?",
        answer: "When an approved refund request arrives from the billing form.",
      },
    ],
  }, "Regression fixture extreme action boundary.");

  return [
    check(
      "socialContentClarificationRemainsOpen",
      providerNeedsSource.status === "needs_answer"
        && !providerNeedsSource.ready_to_compile
        && providerNeedsSource.next_question?.kind === "data_source"
        && detectBlueprintDomain(partialIntent) === "content",
      "A valid provider needs_answer response for missing social content source material must remain open and content-domain.",
    ),
    check(
      "completedSocialContentWorkflow",
      completedSession.ready_to_compile
        && detectBlueprintDomain(completedAnalysis.intent) === "content"
        && completed.blueprint.workflow_name.toLowerCase().includes("content")
        && completedStepText.includes("channel owner")
        && completedStepText.includes("block automatic social publishing")
        && !completedStepText.includes("refund"),
      "Completed social content clarification must produce a relevant human-approved content blueprint without refund steps.",
    ),
    check(
      "safetyBoilerplateDoesNotCreateFinanceDomain",
      detectBlueprintDomain(boilerplateAnalysis.intent) === "content"
        && !boilerplate.risks.categories.includes("financial")
        && !boilerplate.risks.categories.includes("refund_or_payment")
        && !boilerplate.risks.categories.includes("account_access")
        && !rawBoundaryOnly.risks.categories.includes("financial")
        && !rawBoundaryOnly.risks.categories.includes("refund_or_payment")
        && !rawBoundaryOnly.risks.categories.includes("account_access")
        && !rawBoundaryOnly.risks.categories.includes("delete_or_destructive_action")
        && detectBlueprintDomain(genericBoundaryOnlyIntent) === "generic"
        && !genericBoundaryOnly.blueprint.workflow_name.toLowerCase().includes("refund")
        && !boilerplateText.includes("refund"),
      "Separated generic safety constraints must not create finance/account risks or workflow steps.",
    ),
    check(
      "realRefundWorkflowStillWorks",
      detectBlueprintDomain(refundIntent) === "finance"
        && refund.risks.categories.includes("refund_or_payment")
        && refund.blueprint.human_approval_gates.length > 0
        && refundText.includes("refund"),
      "An explicit refund-request workflow must retain finance detection and human approval.",
    ),
    check(
      "providerFailureUsesContentFallback",
      architectFallback.fallback_used
        && fallbackText.includes("content")
        && fallbackText.includes("social media post package")
        && fallbackText.includes("block automatic social publishing")
        && !fallbackText.includes("refund"),
      "Blueprint Architect provider failure must use the deterministic content-generation fallback.",
    ),
    check(
      "duplicateClarificationQuestionDoesNotLoop",
      duplicateQuestion.ready_to_compile
        && duplicateQuestion.status === "ready_to_compile"
        && duplicateQuestion.next_question === null,
      "A provider question that was already answered must not create another clarification loop.",
    ),
    check(
      "jobApplicationCoreFactsCompileImmediately",
      jobApplicationSession.ready_to_compile
        && jobApplicationSession.status === "ready_to_compile"
        && jobApplicationSession.next_question === null
        && Boolean(jobApplicationSession.rewritten_compile_prompt),
      "Trigger, source, action, and output must be sufficient without owner, boundary, or success-criteria questions.",
    ),
    check(
      "optionalProviderQuestionDoesNotBlockCompile",
      cautiousJobApplicationSession.ready_to_compile
        && cautiousJobApplicationSession.status === "ready_to_compile"
        && cautiousJobApplicationSession.next_question === null,
      "A cautious provider must not override deterministic readiness with an optional human-owner question.",
    ),
    check(
      "requestedAcknowledgementActionIsPreserved",
      jobApplicationBlueprint.steps.some((step) =>
        step.label === "Send acknowledgement email" && step.automation_policy === "automate",
      ),
      "The blueprint must preserve the requested acknowledgement send action.",
    ),
    check(
      "inboundSupportEmailDoesNotInventActions",
      supportSummary.signals.workflow_primitives.includes("summarization")
        && !supportSummary.signals.has_external_action
        && supportSummary.blueprint.human_approval_gates.length === 0
        && supportSummaryText.includes("collect support email")
        && supportSummaryText.includes("summarize source item")
        && !/order id|complaint reason|urgency|customer name|review task|draft|reply|approval/.test(supportSummaryText),
      "An inbound support email summarized internally must not invent fields, review tasks, drafts, replies, or approval gates.",
    ),
    check(
      "explicitSlackSendIsPreserved",
      supportSlack.signals.has_external_action
        && supportSlack.signals.workflow_primitives.includes("notification")
        && supportSlack.blueprint.steps.some((step) => step.label === "Send requested Slack message")
        && supportSlack.blueprint.human_approval_gates.length === 0,
      "An explicitly requested Slack send must remain in the blueprint without an invented approval gate.",
    ),
    check(
      "extremeAutomaticRefundStillNeedsBoundary",
      !extremeRefundSession.ready_to_compile
        && extremeRefundSession.next_question?.kind === "approval_boundary",
      "An automatic refund workflow without an approval boundary must still ask one blocking safety question.",
    ),
  ];
}
