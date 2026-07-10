import type { ClarificationSessionAnswer } from "../../shared/types/clarificationSession";
import type { StructuredWorkflowIntent } from "../../shared/types/structuredWorkflowIntent";
import type { FixtureValidationCheck } from "../services/schemaValidator";
import {
  buildDeterministicClarificationSession,
  normalizeAgentSession,
  runClarificationConversationAgent,
} from "../services/clarificationConversationAgent";
import {
  buildDeterministicBlueprintArchitectFallback,
  runBlueprintArchitectAgent,
  type RunBlueprintArchitectAgentInput,
} from "../services/blueprintArchitectAgent";
import { buildBlueprint, detectBlueprintDomain } from "../services/blueprintBuilder";
import {
  inferStructuredWorkflowIntent,
  normalizeHumanOwner,
  splitOutputDestinationAnswer,
} from "../services/clarificationFacts";
import { resolveOpenAIAgentModel } from "../services/openaiProvider";
import { buildBlueprintArchitectUserPrompt } from "../prompts/blueprintArchitectPrompt";
import { scoreReadiness } from "../services/readinessScorer";
import { scanRisks } from "../services/riskScanner";
import { scanSignals } from "../services/signalScanner";
import {
  buildWorkflowIntentSection,
  LEGACY_STRUCTURED_COMPILE_INPUT_PREFIX,
  normalizeCompileRequest,
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
    question_id: "desired_output",
    question: "What should the workflow produce?",
    answer: "Draft images, voice, video, captions, and post text for review.",
  },
  {
    question_id: "workflow_trigger",
    question: "When should this workflow start?",
    answer: "On demand.",
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
];

const sourceAnswer: ClarificationSessionAnswer = {
  question_id: "content_source_material",
  question: "What source material should the workflow use to generate the social media content?",
  answer: "A product description, campaign brief, brand assets, and key marketing points.",
};

const destinationAnswer: ClarificationSessionAnswer = {
  question_id: "output_destination",
  question: "Where should the generated assets be saved or delivered for review?",
  answer: "Save all generated assets in a shared Google Drive folder called “Promo Drafts” and send the marketing manager an email notification with links for review.",
};

const humanOwnerAnswer: ClarificationSessionAnswer = {
  question_id: "human_reviewer",
  question: "Who reviews and approves the result?",
  answer: "The marketing manager reviews and approves all generated images, voice, video, captions, and post text before anything is published.",
};

function check(name: string, success: boolean, message: string): FixtureValidationCheck {
  return {
    name,
    success,
    issues: success
      ? []
      : [{ path: "(regression)", message, code: "pipeline_regression" }],
  };
}

function buildBlueprintForInput(input: string | StructuredWorkflowIntent) {
  const intent = typeof input === "string" ? normalizeCompileRequest(input).intent : input;
  const semanticIntent = buildWorkflowIntentSection(intent);
  const signals = scanSignals(intent);
  const risks = scanRisks(signals);
  const readiness = scoreReadiness(signals, risks);
  const blueprint = buildBlueprint({
    jobId: "pipeline_regression",
    processInput: semanticIntent,
    intent,
    signals,
    risks,
    readiness,
    mode: "rule_only",
  });

  return { intent, semanticIntent, signals, risks, readiness, blueprint };
}

function contentIntent(): StructuredWorkflowIntent {
  return inferStructuredWorkflowIntent({
    originalInput,
    answers: [...socialAnswers, sourceAnswer, destinationAnswer],
  });
}

function architectInput(intent: StructuredWorkflowIntent): RunBlueprintArchitectAgentInput {
  const built = buildBlueprintForInput(intent);
  return {
    intent,
    safetyConstraints: [
      "Build a non-executing FlowForge workflow blueprint.",
      "Do not issue refunds.",
    ],
    mode: "full",
    signals: built.signals,
    risks: built.risks,
    readiness: built.readiness,
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
      reason: "Canonical workflow intent is ready.",
      missing_fields: [],
      questions: [],
      suggested_template: "",
      improved_prompt_starter: "",
    },
  };
}

async function buildProviderRoutingChecks(
  baseInput: RunBlueprintArchitectAgentInput,
  validProviderResponse: string,
): Promise<FixtureValidationCheck[]> {
  const successCalls: string[] = [];
  const openAiSuccess = await runBlueprintArchitectAgent(baseInput, {
    availability: { openai: true, groq: true, gemini: true },
    calls: {
      openai: async () => { successCalls.push("openai"); return validProviderResponse; },
      groq: async () => { successCalls.push("groq"); return validProviderResponse; },
      gemini: async () => { successCalls.push("gemini"); return validProviderResponse; },
    },
  });

  const groqCalls: string[] = [];
  const groqSuccess = await runBlueprintArchitectAgent(baseInput, {
    availability: { openai: true, groq: true, gemini: true },
    calls: {
      openai: async () => { groqCalls.push("openai"); throw new Error("mock OpenAI failure"); },
      groq: async () => { groqCalls.push("groq"); return validProviderResponse; },
      gemini: async () => { groqCalls.push("gemini"); return validProviderResponse; },
    },
  });

  const geminiCalls: string[] = [];
  const geminiSuccess = await runBlueprintArchitectAgent(baseInput, {
    availability: { openai: true, groq: true, gemini: true },
    calls: {
      openai: async () => { geminiCalls.push("openai"); throw new Error("mock OpenAI failure"); },
      groq: async () => { geminiCalls.push("groq"); throw new Error("mock Groq failure"); },
      gemini: async () => { geminiCalls.push("gemini"); return validProviderResponse; },
    },
  });

  const fallbackCalls: string[] = [];
  const deterministicFallback = await runBlueprintArchitectAgent(baseInput, {
    availability: { openai: true, groq: true, gemini: true },
    calls: {
      openai: async () => { fallbackCalls.push("openai"); throw new Error("mock OpenAI failure"); },
      groq: async () => { fallbackCalls.push("groq"); throw new Error("mock Groq failure"); },
      gemini: async () => { fallbackCalls.push("gemini"); throw new Error("mock Gemini failure"); },
    },
  });

  const missingOpenAiCalls: string[] = [];
  const missingOpenAi = await runBlueprintArchitectAgent(baseInput, {
    availability: { openai: false, groq: true, gemini: true },
    calls: {
      openai: async () => { missingOpenAiCalls.push("openai"); return validProviderResponse; },
      groq: async () => { missingOpenAiCalls.push("groq"); return validProviderResponse; },
      gemini: async () => { missingOpenAiCalls.push("gemini"); return validProviderResponse; },
    },
  });

  return [
    check(
      "openAiSuccessStopsProviderFallback",
      successCalls.join(",") === "openai"
        && openAiSuccess.output.provider === "openai",
      "OpenAI success must prevent Groq and Gemini calls.",
    ),
    check(
      "openAiFailureReachesGroq",
      groqCalls.join(",") === "openai,groq"
        && groqSuccess.output.provider === "groq",
      "An OpenAI failure must continue to Groq and stop after Groq succeeds.",
    ),
    check(
      "openAiAndGroqFailureReachGemini",
      geminiCalls.join(",") === "openai,groq,gemini"
        && geminiSuccess.output.provider === "gemini",
      "OpenAI and Groq failures must continue to Gemini.",
    ),
    check(
      "allProviderFailureUsesDeterministicFallback",
      fallbackCalls.join(",") === "openai,groq,gemini"
        && deterministicFallback.output.provider === "deterministic"
        && deterministicFallback.output.fallback_used,
      "All provider failures must reach the deterministic fallback.",
    ),
    check(
      "missingOpenAiKeySkipsSafely",
      missingOpenAiCalls.join(",") === "groq"
        && missingOpenAi.output.provider === "groq"
        && missingOpenAi.debug.provider_attempts[0]?.provider === "openai"
        && missingOpenAi.debug.provider_attempts[0]?.attempted === false,
      "A missing OpenAI key must record OpenAI as unavailable and continue to Groq.",
    ),
  ];
}

async function buildClarifierProviderCheck(): Promise<FixtureValidationCheck> {
  const calls: string[] = [];
  const needsTaskResponse = JSON.stringify({
    current_summary: originalInput,
    workflow_intent: inferStructuredWorkflowIntent({ originalInput, answers: [] }),
    next_question: {
      id: "choose_task_category",
      kind: "task_type",
      question: "What kind of tasks should FlowForge help with first?",
      why_it_matters: "The task type is required.",
    },
    status: "needs_answer",
    ready_to_compile: false,
    reason: "Task type is missing.",
  });
  const result = await runClarificationConversationAgent(
    { originalInput, answers: [] },
    {
      availability: { openai: true, groq: true, gemini: true },
      calls: {
        openai: async () => { calls.push("openai"); throw new Error("mock OpenAI failure"); },
        groq: async () => { calls.push("groq"); return needsTaskResponse; },
        gemini: async () => { calls.push("gemini"); return needsTaskResponse; },
      },
    },
  );

  return check(
    "clarifierUsesOpenAiThenGroq",
    calls.join(",") === "openai,groq"
      && result.provider === "groq"
      && result.session.status === "needs_answer",
    "The Clarifier must try OpenAI first, continue to Groq on failure, and preserve a valid needs_answer response.",
  );
}

export async function buildPipelineRegressionChecks(): Promise<FixtureValidationCheck[]> {
  const partialInput = { originalInput, answers: socialAnswers };
  const providerNeedsSource = normalizeAgentSession({
    current_summary: "An on-demand social content workflow with channel-owner approval still needs source material.",
    workflow_intent: {
      ...inferStructuredWorkflowIntent(partialInput),
      input_sources: ["The source mentioned by the user."],
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

  const completedAnswers = [...socialAnswers, sourceAnswer, destinationAnswer];
  const completedSession = buildDeterministicClarificationSession(
    { originalInput, answers: completedAnswers },
    "Regression fixture deterministic clarification.",
  );
  const completedAnalysis = normalizeCompileRequest(completedSession.rewritten_compile_prompt ?? "");
  const completed = buildBlueprintForInput(completedAnalysis.intent);
  const completedStepText = completed.blueprint.steps.map((step) => `${step.label} ${step.description}`).join(" ").toLowerCase();

  const boilerplatePrompt = serializeStructuredCompileInput({
    intent: completedAnalysis.intent,
    clarification_answers: completedAnswers,
    safety_constraints: [
      "Do not issue refunds.",
      "Keep payments human-reviewed.",
      "Do not change accounts automatically.",
      "Do not delete production data.",
    ],
  });
  const boilerplateAnalysis = normalizeCompileRequest(boilerplatePrompt);
  const boilerplate = buildBlueprintForInput(boilerplateAnalysis.intent);
  const boilerplateText = `${boilerplate.blueprint.workflow_name} ${boilerplate.blueprint.steps.map((step) => step.label).join(" ")}`.toLowerCase();
  const rawBoundaryOnly = buildBlueprintForInput(
    "Generate social media content from a campaign brief. Do not issue refunds. Keep payments human-reviewed. Do not change accounts automatically. Do not delete production data.",
  );
  const genericBoundaryOnlyIntent = "Prepare a weekly internal report from the operations spreadsheet. Do not issue refunds. Keep payments human-reviewed. Do not change accounts automatically.";
  const genericBoundaryOnly = buildBlueprintForInput(genericBoundaryOnlyIntent);

  const refundIntent = "When a customer submits a refund request, collect the order and amount, prepare a finance review task, and require a finance manager to approve before any refund is issued.";
  const refund = buildBlueprintForInput(refundIntent);
  const refundText = `${refund.blueprint.workflow_name} ${refund.blueprint.steps.map((step) => step.label).join(" ")}`.toLowerCase();

  const baseArchitectInput = architectInput(completedAnalysis.intent);
  const architectFallback = buildDeterministicBlueprintArchitectFallback(
    baseArchitectInput,
    "deterministic",
    "OpenAI, Groq, and Gemini were unavailable in the regression fixture.",
  );
  const fallbackText = `${architectFallback.workflow_name} ${architectFallback.proposed_steps.map((step) => step.label).join(" ")}`.toLowerCase();

  const duplicateQuestion = normalizeAgentSession({
    current_summary: "Social content workflow details collected except for source material.",
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

  const destinationOnly = inferStructuredWorkflowIntent({
    originalInput,
    answers: [destinationAnswer],
  });
  const splitDestination = splitOutputDestinationAnswer(
    "Save assets in the Promo Drafts Google Drive folder and email the marketing manager.",
  );
  const destinationAndNotification = inferStructuredWorkflowIntent({
    originalInput,
    answers: [{
      ...destinationAnswer,
      answer: "Save assets in the Promo Drafts Google Drive folder and email the marketing manager.",
    }],
  });
  const ownerIntent = inferStructuredWorkflowIntent({ originalInput, answers: [humanOwnerAnswer] });

  const architectPrompt = buildBlueprintArchitectUserPrompt({
    intent: completedAnalysis.intent,
    safetyConstraints: ["Do not issue refunds."],
    signals: completed.signals,
    risks: completed.risks,
    readiness: completed.readiness,
    routerDecision: baseArchitectInput.routerDecision,
    clarificationPlan: baseArchitectInput.clarificationPlan,
  });
  const workflowIntentPromptSection = architectPrompt.split("\n\nSAFETY CONSTRAINTS")[0] ?? architectPrompt;
  const sourceLine = workflowIntentPromptSection.split("\n").find((line) => line.startsWith("- Input sources:")) ?? "";

  const legacyPrompt = `${LEGACY_STRUCTURED_COMPILE_INPUT_PREFIX}${JSON.stringify({
    original_input: "Prepare a weekly report.",
    clarified_intent: "Prepare a weekly report from the operations spreadsheet.",
    known_facts: {
      workflow_goal: "Prepare a weekly report.",
      task_type: "Reporting",
      trigger: "Weekly",
      data_source: "Operations spreadsheet",
      desired_output: "Weekly report",
    },
    clarification_answers: [],
    safety_constraints: [],
  })}`;
  const legacyAnalysis = normalizeCompileRequest(legacyPrompt);

  const originalOpenAiModel = process.env.OPENAI_AGENT_MODEL;
  const originalClarifierModel = process.env.OPENAI_CLARIFIER_MODEL;
  delete process.env.OPENAI_AGENT_MODEL;
  delete process.env.OPENAI_CLARIFIER_MODEL;
  const defaultOpenAiModel = resolveOpenAIAgentModel({
    modelEnv: "OPENAI_CLARIFIER_MODEL",
    fallbackModelEnv: "OPENAI_AGENT_MODEL",
  });
  if (originalOpenAiModel === undefined) delete process.env.OPENAI_AGENT_MODEL;
  else process.env.OPENAI_AGENT_MODEL = originalOpenAiModel;
  if (originalClarifierModel === undefined) delete process.env.OPENAI_CLARIFIER_MODEL;
  else process.env.OPENAI_CLARIFIER_MODEL = originalClarifierModel;

  const providerRoutingChecks = await buildProviderRoutingChecks(
    baseArchitectInput,
    JSON.stringify(architectFallback),
  );
  const clarifierProviderCheck = await buildClarifierProviderCheck();

  return [
    check(
      "socialContentClarificationRemainsOpen",
      providerNeedsSource.status === "needs_answer"
        && !providerNeedsSource.ready_to_compile
        && providerNeedsSource.next_question?.kind === "data_source"
        && detectBlueprintDomain(buildWorkflowIntentSection(providerNeedsSource.intent)) === "content",
      "A valid provider needs_answer response for missing social content source material must remain open and content-domain.",
    ),
    check(
      "completedSocialContentWorkflow",
      completedSession.ready_to_compile
        && detectBlueprintDomain(completed.semanticIntent) === "content"
        && completed.blueprint.workflow_name.toLowerCase().includes("content")
        && completedStepText.includes("channel owner")
        && completedStepText.includes("block automatic social publishing")
        && !completedStepText.includes("refund"),
      "Completed social content clarification must produce a relevant human-approved content blueprint without refund steps.",
    ),
    check(
      "safetyBoilerplateDoesNotCreateFinanceDomain",
      detectBlueprintDomain(boilerplate.semanticIntent) === "content"
        && !boilerplate.risks.categories.includes("financial")
        && !boilerplate.risks.categories.includes("refund_or_payment")
        && !boilerplate.risks.categories.includes("account_access")
        && !rawBoundaryOnly.risks.categories.includes("financial")
        && !rawBoundaryOnly.risks.categories.includes("refund_or_payment")
        && !rawBoundaryOnly.risks.categories.includes("account_access")
        && !rawBoundaryOnly.risks.categories.includes("delete_or_destructive_action")
        && detectBlueprintDomain(genericBoundaryOnly.semanticIntent) === "generic"
        && !genericBoundaryOnly.blueprint.workflow_name.toLowerCase().includes("refund")
        && !boilerplateText.includes("refund"),
      "Separated generic safety constraints must not create finance/account risks or workflow steps.",
    ),
    check(
      "realRefundWorkflowStillWorks",
      detectBlueprintDomain(refund.semanticIntent) === "finance"
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
      duplicateQuestion.status === "needs_answer"
        && !duplicateQuestion.ready_to_compile
        && duplicateQuestion.next_question?.kind === "data_source",
      "A provider question that was already answered must not loop or force compilation with missing facts.",
    ),
    check(
      "outputDestinationStaysSeparateFromInputSource",
      destinationOnly.output_destinations[0] === "shared Google Drive folder called Promo Drafts"
        && destinationOnly.notification_targets[0] === "marketing manager by email"
        && destinationOnly.input_sources.length === 0
        && !serializeStructuredCompileInput({ intent: destinationOnly, clarification_answers: [], safety_constraints: [] }).includes('"data_source"')
        && !sourceLine.toLowerCase().includes("promo drafts"),
      "An output_destination answer must not become an input source, legacy data_source, or source-material instruction.",
    ),
    check(
      "destinationAndNotificationAreBothPreserved",
      splitDestination.destination === "Promo Drafts Google Drive folder"
        && splitDestination.notificationTarget === "marketing manager by email"
        && destinationAndNotification.output_destinations[0] === "Promo Drafts Google Drive folder"
        && destinationAndNotification.notification_targets[0] === "marketing manager by email",
      "An obvious destination-plus-email answer must preserve both meanings.",
    ),
    check(
      "humanOwnerIsNormalizedWithFullBoundary",
      normalizeHumanOwner(humanOwnerAnswer.answer) === "marketing manager"
        && ownerIntent.human_owner === "marketing manager"
        && ownerIntent.approval_boundary === humanOwnerAnswer.answer,
      "A full approval sentence must produce a concise human owner while retaining the complete approval boundary.",
    ),
    check(
      "blueprintArchitectUsesCanonicalSections",
      workflowIntentPromptSection.startsWith("WORKFLOW INTENT")
        && workflowIntentPromptSection.includes("- Output destinations: shared Google Drive folder called Promo Drafts")
        && !workflowIntentPromptSection.includes("example_answer")
        && !workflowIntentPromptSection.includes("Do not issue refunds."),
      "Blueprint Architect input must come from canonical intent without clarification examples or safety boilerplate inside WORKFLOW INTENT.",
    ),
    check(
      "legacyCompileInputNormalizesOnce",
      legacyAnalysis.source === "legacy"
        && legacyAnalysis.intent.input_sources[0] === "Operations spreadsheet"
        && legacyAnalysis.intent.desired_outputs[0] === "Weekly report",
      "Legacy direct compile input must normalize into the canonical intent at the compile boundary.",
    ),
    check(
      "openAiDefaultModelIsGpt5Nano",
      defaultOpenAiModel === "gpt-5-nano",
      "OpenAI must default to gpt-5-nano when no model override is configured.",
    ),
    clarifierProviderCheck,
    ...providerRoutingChecks,
  ];
}
