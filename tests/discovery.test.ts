import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAutomationDiscoveryRequester,
  sendSuggestionToCompiler,
} from "../shared/automationDiscoveryClient";
import type {
  AutomationSuggestion,
  DiscoveryCategory,
} from "../shared/types/discovery";
import {
  automationSuggestionSystemPrompt,
  buildAutomationSuggestionPrompt,
} from "../server/prompts/automationSuggestionPrompt";
import {
  automationSuggestionModelResponseSchema,
  automationSuggestionSchema,
} from "../server/schemas/discovery.schema";
import {
  type AutomationSuggestionDiagnostic,
  AutomationSuggestionGenerationError,
  generateAutomationSuggestion,
  parseAutomationSuggestionModelResponse,
} from "../server/services/automationSuggestionGenerator";
import {
  NoUsefulTavilyResultsError,
  TavilyRequestError,
  searchWorkflowPainPoints,
  selectDiscoveryQuery,
} from "../server/services/tavilySearch";
import {
  buildDeterministicClarificationSession,
  createContextualFallbackQuestion,
  normalizeAgentSession,
} from "../server/services/clarificationConversationAgent";
import {
  createEmptyStructuredWorkflowIntent,
  factConfidence,
  getClarificationAnswerKind,
  inferStructuredWorkflowIntent,
} from "../server/services/clarificationFacts";
import type { StructuredWorkflowIntent } from "../shared/types/structuredWorkflowIntent";
import { scanSignals } from "../server/services/signalScanner";
import { selectFinalBlueprint } from "../server/services/blueprintSelection";
import { validBlueprint } from "../server/fixtures/validBlueprint";
import type { BlueprintArchitectOutput } from "../shared/types/agentOutputs";
import {
  normalizeExternalActionSafety,
  runN8nWorkflowGeneratorAgent,
} from "../server/services/n8nWorkflowGeneratorAgent";
import { buildCompactN8nGenerationInput } from "../server/services/n8nImplementationBriefBuilder";
import { validCompileJob } from "../server/fixtures/validCompileJob";
import { n8nWorkflowSchema } from "../server/schemas/n8nWorkflow.schema";

const signals = [
  {
    title: "Support teams lose context during escalations",
    url: "https://example.com/support-handoffs",
    content: "Agents manually copy email details into the CRM and chase specialists for urgent escalations.",
  },
  {
    title: "Manual ticket categorization creates queues",
    url: "https://example.com/ticket-triage",
    content: "A shared inbox is reviewed repeatedly to classify urgency and ownership.",
  },
  {
    title: "Weekly support reporting is spreadsheet-heavy",
    url: "https://example.com/support-reporting",
    content: "Leads consolidate ticket and escalation data by hand each Friday.",
  },
];

function validSuggestion(
  category: DiscoveryCategory = "customer_support",
  source: AutomationSuggestion["source"] = {
    title: signals[0]!.title,
    url: signals[0]!.url,
  },
): AutomationSuggestion {
  return {
    id: "suggestion-1",
    title: "Context-rich support escalation queue",
    category,
    fitType: "agentic_workflow",
    painPoint: "Urgent support requests lose context during manual handoffs.",
    targetUser: "Customer support leads",
    whyItMatters: "Faster, better-informed escalation reduces delays without auto-reply risk.",
    valueLevel: "high",
    difficulty: "medium",
    confidence: 0.87,
    workflowIntent: "When a new support email arrives, extract the customer and issue details, classify its topic and urgency, retrieve account context from the CRM, route urgent cases to the responsible specialist, create an internal review task, and log the outcome without automatically replying to the customer.",
    suggestedSteps: [
      "Receive the support email",
      "Extract customer and issue details",
      "Classify topic and urgency",
      "Retrieve account context",
      "Route urgent cases for internal review",
      "Log the outcome",
    ],
    source,
  };
}

function validModelResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const { id: _id, category: _category, ...content } = validSuggestion();
  return { ...content, ...overrides };
}

function tavilyResponse(results: unknown[], ok = true): Response {
  return new Response(JSON.stringify({ results }), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}

test("Surprise Me discovery accepts a creative valid suggestion", async () => {
  const prompts: string[] = [];
  const result = await generateAutomationSuggestion("surprise", signals, {
    modelCall: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify(validModelResponse());
    },
  });

  assert.equal(result.category, "surprise");
  assert.match(result.id, /^[0-9a-f-]{36}$/i);
  assert.match(prompts[0]!, /Surprise me/);
  assert.equal(prompts.length, 1);
});

test("a selected business category guides the query and generation prompt", () => {
  const query = selectDiscoveryQuery("finance_admin", () => 0);
  const prompt = buildAutomationSuggestionPrompt("finance_admin", signals);

  assert.match(query, /invoice|finance|expense/i);
  assert.match(prompt, /Finance & Administration/);
  assert.match(prompt, /Internal value: finance_admin/);
  assert.doesNotMatch(automationSuggestionSystemPrompt, /id, title, category/);
  assert.match(automationSuggestionSystemPrompt, /Do not return id or category/);
  assert.notEqual(
    selectDiscoveryQuery("finance_admin", () => 0),
    selectDiscoveryQuery("finance_admin", () => 0.99),
  );
});

test("Tavily returns several useful results with a bounded search request", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const result = await searchWorkflowPainPoints("customer_support", {
    apiKey: "test-key",
    random: () => 0,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return tavilyResponse(signals);
    },
  });

  assert.equal(result.length, 3);
  assert.equal(requestBody?.max_results, 5);
  assert.equal(requestBody?.include_raw_content, false);
});

test("Tavily no-useful-results response is explicit", async () => {
  await assert.rejects(
    searchWorkflowPainPoints("surprise", {
      apiKey: "test-key",
      fetchImpl: async () => tavilyResponse([
        { title: "", url: "not-a-url", content: "" },
      ]),
    }),
    NoUsefulTavilyResultsError,
  );
});

test("Tavily request failures are normalized without provider details", async () => {
  await assert.rejects(
    searchWorkflowPainPoints("surprise", {
      apiKey: "test-key",
      fetchImpl: async () => { throw new Error("secret upstream failure"); },
    }),
    (error: unknown) =>
      error instanceof TavilyRequestError
      && !error.message.includes("secret upstream failure"),
  );
});

test("the model's valid structured output passes shape validation unchanged", async () => {
  const expected = validModelResponse();
  const result = await generateAutomationSuggestion("customer_support", signals, {
    modelCall: async () => JSON.stringify(expected),
  });

  assert.equal(result.category, "customer_support");
  assert.equal(result.workflowIntent, expected.workflowIntent);
  assert.equal(automationSuggestionSchema.parse(result).workflowIntent, expected.workflowIntent);
});

test("malformed model output gets one retry and then a clear generation error", async () => {
  let calls = 0;
  await assert.rejects(
    generateAutomationSuggestion("customer_support", signals, {
      logger: () => {},
      modelCall: async () => {
        calls += 1;
        return calls === 1 ? "not json" : JSON.stringify({ title: "still incomplete" });
      },
    }),
    AutomationSuggestionGenerationError,
  );
  assert.equal(calls, 2);
});

test("a valid suggestion may omit its source URL by using null", () => {
  const parsed = automationSuggestionSchema.parse(validSuggestion("customer_support", null));
  assert.equal(parsed.source, null);
});

test("server supplies missing id and category metadata", async () => {
  const result = await generateAutomationSuggestion("finance_admin", signals, {
    modelCall: async () => JSON.stringify(validModelResponse()),
  });

  assert.equal(result.category, "finance_admin");
  assert.match(result.id, /^[0-9a-f-]{36}$/i);
});

test("confidence accepts a normalized numeric string", () => {
  const parsed = parseAutomationSuggestionModelResponse(
    JSON.stringify(validModelResponse({ confidence: "0.84" })),
  );
  assert.equal(parsed.confidence, 0.84);
});

test("confidence accepts a percentage-like number and normalizes it", () => {
  const parsed = parseAutomationSuggestionModelResponse(
    JSON.stringify(validModelResponse({ confidence: 84 })),
  );
  assert.equal(parsed.confidence, 0.84);
});

test("raw model validation strips harmless extra properties", () => {
  const parsed = automationSuggestionModelResponseSchema.parse(
    validModelResponse({ creativeRationale: "Combined two useful signals." }),
  ) as Record<string, unknown>;
  assert.equal(parsed.creativeRationale, undefined);
});

test("an omitted source is normalized to null", () => {
  const response = validModelResponse();
  delete response.source;
  const parsed = automationSuggestionModelResponseSchema.parse(response);
  assert.equal(parsed.source, null);
});

test("an invalid source URL triggers exactly one repair with allowed sources", async () => {
  let calls = 0;
  const prompts: string[] = [];
  const result = await generateAutomationSuggestion("customer_support", signals, {
    logger: () => {},
    modelCall: async (prompt) => {
      calls += 1;
      prompts.push(prompt);
      return calls === 1
        ? JSON.stringify(validModelResponse({
            source: { title: "Bad source", url: "javascript:alert(1)" },
          }))
        : JSON.stringify(validModelResponse());
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.source?.url, signals[0]!.url);
  assert.match(prompts[1]!, /ALLOWED SOURCES/);
  assert.match(prompts[1]!, new RegExp(signals[0]!.url.replaceAll("/", "\\/")));
});

test("wrong model-owned metadata cannot override the requested category", async () => {
  const result = await generateAutomationSuggestion("ecommerce", signals, {
    modelCall: async () => JSON.stringify(validModelResponse({
      id: "model-id",
      category: "personal_productivity",
    })),
  });

  assert.equal(result.category, "ecommerce");
  assert.notEqual(result.id, "model-id");
});

test("Zod diagnostics retain bounded issue paths and response context", async () => {
  const diagnostics: AutomationSuggestionDiagnostic[] = [];
  let calls = 0;

  await assert.rejects(
    generateAutomationSuggestion("customer_support", signals, {
      logger: (diagnostic) => diagnostics.push(diagnostic),
      modelCall: async () => {
        calls += 1;
        return JSON.stringify({ title: calls === 1 ? "Partial idea" : "Still partial" });
      },
    }),
    AutomationSuggestionGenerationError,
  );

  assert.equal(diagnostics[0]?.stage, "initial_response_validation");
  assert.ok(diagnostics[0]?.issues?.some((issue) => issue.path === "workflowIntent"));
  assert.match(diagnostics[0]?.response_preview ?? "", /Partial idea/);
  assert.equal(diagnostics[1]?.stage, "repaired_response_validation");
});

test("OpenAI-call errors retain a cause while diagnostics redact secrets", async () => {
  const diagnostics: AutomationSuggestionDiagnostic[] = [];
  const providerError = new Error("OpenAI 401 Bearer sk-super-secret-token");

  await assert.rejects(
    generateAutomationSuggestion("surprise", signals, {
      logger: (diagnostic) => diagnostics.push(diagnostic),
      modelCall: async () => { throw providerError; },
    }),
    (error: unknown) =>
      error instanceof AutomationSuggestionGenerationError
      && error.cause instanceof Error
      && !error.cause.message.includes("super-secret-token"),
  );

  assert.equal(diagnostics[0]?.stage, "initial_model_call");
  assert.doesNotMatch(diagnostics[0]?.message ?? "", /super-secret-token/);
});

test("repair-call failures are logged as their own stage with a safe cause", async () => {
  const diagnostics: AutomationSuggestionDiagnostic[] = [];
  let calls = 0;

  await assert.rejects(
    generateAutomationSuggestion("surprise", signals, {
      logger: (diagnostic) => diagnostics.push(diagnostic),
      modelCall: async () => {
        calls += 1;
        if (calls === 1) return "not json";
        throw new Error("repair failed with Bearer sk-repair-secret-token");
      },
    }),
    (error: unknown) =>
      error instanceof AutomationSuggestionGenerationError
      && error.cause instanceof Error
      && !error.cause.message.includes("repair-secret-token"),
  );

  assert.equal(calls, 2);
  assert.equal(diagnostics[0]?.stage, "initial_response_validation");
  assert.equal(diagnostics[1]?.stage, "repair_model_call");
  assert.doesNotMatch(diagnostics[1]?.message ?? "", /repair-secret-token/);
});

test("parses realistic fenced OpenAI output text", async () => {
  const rawContent = `Here is the requested JSON:\n\n\`\`\`json\n${JSON.stringify(
    validModelResponse({ confidence: "0.91" }),
    null,
    2,
  )}\n\`\`\``;
  const result = await generateAutomationSuggestion("customer_support", signals, {
    modelCall: async () => rawContent,
  });

  assert.equal(result.confidence, 0.91);
  assert.equal(result.category, "customer_support");
});

test("Try another reuses the selected category and starts a new request", async () => {
  const categories: DiscoveryCategory[] = [];
  const requester = createAutomationDiscoveryRequester(async (category) => {
    categories.push(category);
    return validSuggestion(category);
  });

  await requester.request("ecommerce");
  await requester.request("ecommerce");
  assert.deepEqual(categories, ["ecommerce", "ecommerce"]);
});

test("Use this idea sends workflowIntent through the supplied compiler entry point", async () => {
  const compiled: string[] = [];
  const suggestion = validSuggestion();
  await sendSuggestionToCompiler(suggestion, async (input) => {
    compiled.push(input);
  });

  assert.deepEqual(compiled, [suggestion.workflowIntent]);
});

test("the existing manual compiler pipeline still accepts plain text", async () => {
  (globalThis as typeof globalThis & {
    defineEventHandler: <T>(handler: T) => T;
  }).defineEventHandler = (handler) => handler;
  const { runCompilePipeline } = await import("../server/api/compile.post");
  const input = "When a support email arrives, classify urgency, create an internal review task, and do not send a reply automatically.";
  const result = await runCompilePipeline({ rawInput: input, mode: "rule_only" });

  assert.equal(result.input.raw, input);
  assert.ok(result.result);
  assert.equal(result.mode, "rule_only");
});

test("Tavily and model credential names are absent from client-side application code", async () => {
  const clientFiles = [
    "app/pages/compiler.vue",
    "shared/automationDiscoveryClient.ts",
    "shared/types/discovery.ts",
  ];
  const contents = await Promise.all(clientFiles.map((file) => readFile(file, "utf8")));

  for (const content of contents) {
    assert.doesNotMatch(content, /TAVILY_API_KEY|OPENAI_API_KEY/);
  }
});

test("repeated requests are ignored while discovery is loading", async () => {
  let resolveRequest!: (suggestion: AutomationSuggestion) => void;
  let calls = 0;
  const requester = createAutomationDiscoveryRequester(async () => {
    calls += 1;
    return await new Promise<AutomationSuggestion>((resolve) => {
      resolveRequest = resolve;
    });
  });

  const first = requester.request("surprise");
  const second = await requester.request("surprise");
  assert.equal(second, null);
  assert.equal(calls, 1);
  resolveRequest(validSuggestion("surprise"));
  await first;
  assert.equal(requester.isBusy, false);
});

const procurementWorkflowIntent = "This workflow triggers when a new purchase or operational request is submitted. It collects request details, determines required approvers based on amount, location, or business unit, routes approval requests, tracks responses, escalates missed deadlines, and requires human review for high-risk cases before final execution.";

function completeClarificationIntent(
  overrides: Partial<StructuredWorkflowIntent> = {},
): StructuredWorkflowIntent {
  return {
    ...createEmptyStructuredWorkflowIntent(
      "When a new request is submitted, route it for review and update the business system.",
    ),
    goal: "Route incoming requests for review.",
    task_type: "Request routing",
    trigger: "When a new request is submitted.",
    input_sources: ["Internal request form"],
    input_data: ["Request details"],
    desired_outputs: ["A reviewed request record"],
    human_owner: "Process owner",
    approval_boundary: "Human approval is required before updating the business system.",
    external_actions: ["Update the business system"],
    ...overrides,
  };
}

function providerSession(question: {
  id: string;
  kind: "task_type" | "other";
  question: string;
}) {
  return {
    current_summary: "A request-routing workflow needs clarification.",
    workflow_intent: {},
    next_question: {
      ...question,
      why_it_matters: "This resolves a material workflow ambiguity.",
      example_answer: "Choose the process that should be handled first.",
    },
    status: "needs_answer",
    ready_to_compile: false,
    reason: "One question is still needed.",
  };
}

test("a procurement workflow never receives stale admissions-email wording", () => {
  const session = buildDeterministicClarificationSession(
    { originalInput: procurementWorkflowIntent, answers: [] },
    "Provider unavailable in test.",
  );
  const rendered = JSON.stringify(session.next_question);

  assert.match(session.next_question?.question ?? "", /purchase or operational request/i);
  assert.doesNotMatch(rendered, /admissions|application emails|candidate|gmail|student/i);
});

test("a support workflow never receives procurement-specific fallback wording", () => {
  const session = buildDeterministicClarificationSession(
    {
      originalInput: "When a support request arrives, classify its urgency and prepare an internal summary.",
      answers: [],
    },
    "Provider unavailable in test.",
  );

  assert.doesNotMatch(
    JSON.stringify(session.next_question),
    /procurement|purchase|operational request/i,
  );
});

test("missing input source uses current task context when available", () => {
  const question = createContextualFallbackQuestion(
    completeClarificationIntent({
      original_input: procurementWorkflowIntent,
      trigger: procurementWorkflowIntent,
      input_sources: [],
      input_data: [],
    }),
  );

  assert.equal(question.kind, "data_source");
  assert.match(question.question, /purchase or operational request/i);
});

test("missing input source uses a neutral fallback without usable context", () => {
  const question = createContextualFallbackQuestion(
    completeClarificationIntent({
      original_input: "Run the workflow every weekday.",
      trigger: "Every weekday.",
      input_sources: [],
      input_data: [],
    }),
  );

  assert.equal(
    question.question,
    "Where does the information for this workflow currently come from?",
  );
  assert.doesNotMatch(JSON.stringify(question), /admissions|procurement|support ticket/i);
});

test("missing desired output uses a neutral relevant question", () => {
  const question = createContextualFallbackQuestion(
    completeClarificationIntent({ desired_outputs: [] }),
  );
  assert.equal(question.kind, "desired_output");
  assert.match(question.question, /produce or update/i);
});

test("missing human owner uses a neutral relevant question", () => {
  const question = createContextualFallbackQuestion(
    completeClarificationIntent({ human_owner: undefined }),
  );
  assert.equal(question.kind, "human_owner");
  assert.match(question.question, /review or own cases/i);
});

test("missing approval boundary uses a neutral relevant question", () => {
  const question = createContextualFallbackQuestion(
    completeClarificationIntent({
      approval_boundary: undefined,
      external_action_boundary: undefined,
    }),
  );
  assert.equal(question.kind, "approval_boundary");
  assert.match(question.question, /require human approval/i);
});

test("a previous clarification session cannot leak into a discovered suggestion", () => {
  const previous = buildDeterministicClarificationSession(
    {
      originalInput: "When a new admissions application email arrives, prepare it for review.",
      answers: [{
        question_id: "workflow_source",
        question: "Where does the information come from?",
        answer: "The admissions team inbox.",
      }],
    },
    "Previous session.",
  );
  const next = buildDeterministicClarificationSession(
    { originalInput: procurementWorkflowIntent, answers: [] },
    "New discovery session.",
  );

  assert.notEqual(previous.session_id, next.session_id);
  assert.equal(next.original_input, procurementWorkflowIntent);
  assert.deepEqual(next.answers, []);
  assert.doesNotMatch(JSON.stringify(next), /admissions|gmail|candidate/i);
});

test("the discovered-idea UI clears prior example and clarification state", async () => {
  const page = await readFile("app/pages/compiler.vue", "utf8");
  const handoff = page.slice(
    page.indexOf("async function useDiscoveredIdea()"),
    page.indexOf("onUnmounted("),
  );
  const reset = page.slice(
    page.indexOf("function resetRun()"),
    page.indexOf("function answerPayload("),
  );
  const clarificationStart = page.slice(
    page.indexOf("async function startClarificationForInput("),
    page.indexOf("async function startGuidedCompile("),
  );

  assert.match(handoff, /selectedExampleLabel\.value = null;/);
  assert.match(handoff, /resetRun\(\);[\s\S]*sendSuggestionToCompiler\(suggestion, compilePrompt\)/);
  assert.match(reset, /clarificationSession\.value = null;/);
  assert.match(reset, /clarificationAnswers\.value = \[\];/);
  assert.match(reset, /clarificationLastResponse\.value = null;/);
  assert.match(clarificationStart, /clarificationOriginalInput\.value = originalInput;/);
  assert.match(clarificationStart, /answers:\s*\[\]/);
});

test("a discovered workflowIntent still enters the normal clarifier path", async () => {
  const suggestion = validSuggestion("operations_projects");
  suggestion.workflowIntent = procurementWorkflowIntent;
  let clarificationInput = "";

  await sendSuggestionToCompiler(suggestion, async (input) => {
    clarificationInput = buildDeterministicClarificationSession(
      { originalInput: input, answers: [] },
      "Compiler requested clarification.",
    ).original_input;
  });

  assert.equal(clarificationInput, procurementWorkflowIntent);
});

test("a grounded provider scoping question may resolve a material ambiguity", () => {
  const question = {
    id: "task_scope",
    kind: "task_type" as const,
    question: "What is the primary category of the task you want to automate first: purchase approvals, operational requests, or both?",
  };
  const session = normalizeAgentSession(
    providerSession(question),
    { originalInput: procurementWorkflowIntent, answers: [] },
  );

  assert.equal(session.next_question?.question, question.question);
});

test("an unrelated provider question is replaced by contextual deterministic fallback", () => {
  const unrelated = "Which social media channel should publish the campaign first?";
  const session = normalizeAgentSession(
    providerSession({
      id: "campaign_channel",
      kind: "other",
      question: unrelated,
    }),
    { originalInput: procurementWorkflowIntent, answers: [] },
  );

  assert.notEqual(session.next_question?.question, unrelated);
  assert.match(session.next_question?.question ?? "", /purchase or operational request/i);
});

test("discovery suggestion typography stays readable and overflow-safe", async () => {
  const page = await readFile("app/pages/compiler.vue", "utf8");
  const suggestionStyles = page.slice(
    page.indexOf(".suggestion-card {"),
    page.indexOf(".process-input,"),
  );

  assert.match(suggestionStyles, /\.suggestion-details p,[\s\S]*font-size:\s*1rem;[\s\S]*line-height:\s*1\.65;/);
  assert.match(suggestionStyles, /\.suggestion-intent p\s*\{[\s\S]*font-size:\s*1\.05rem;/);
  assert.match(suggestionStyles, /\.suggestion-steps\s*\{[\s\S]*gap:\s*0\.65rem;[\s\S]*font-size:\s*1rem;/);
  assert.match(suggestionStyles, /overflow-wrap:\s*anywhere;/);
  assert.match(page, /@media \(max-width: 760px\)[\s\S]*\.suggestion-details\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test("the discovery card introduces no horizontal overflow at mobile widths", async () => {
  const page = await readFile("app/pages/compiler.vue", "utf8");
  assert.match(page, /\.suggestion-card\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(page, /\.suggestion-details > div,[\s\S]*\.suggestion-intent\s*\{[\s\S]*min-width:\s*0;/);
  assert.match(page, /\.suggestion-actions > \*\s*\{[\s\S]*max-width:\s*100%;/);
});

test("manual examples continue to use the unchanged compiler entry point", async () => {
  const page = await readFile("app/pages/compiler.vue", "utf8");
  assert.match(page, /function chooseExample\([\s\S]*processInput\.value = example\.value;/);
  assert.match(page, /async function startGuidedCompile\([\s\S]*startClarificationForInput\(originalInput\)/);
});

function clarificationAnswer(
  question_id: string,
  question: string,
  answer: string,
) {
  return { question_id, question, answer };
}

const realEstateOriginal = "Automate agent matching, mortgage pre-approval, closing coordination, and client updates.";

test("a specific human owner is not overwritten by a generic later answer", () => {
  const intent = inferStructuredWorkflowIntent({
    originalInput: realEstateOriginal,
    answers: [
      clarificationAnswer("real_estate_workflow_human_owner", "Who owns exceptions?", "Jane Doe, the lead real-estate coordinator."),
      clarificationAnswer("human_reviewer", "Who should review cases?", "The responsible team lead or process owner."),
    ],
  });
  assert.match(intent.human_owner ?? "", /jane doe/i);
  assert.doesNotMatch(intent.human_owner ?? "", /responsible team lead/i);
});

test("an explicit user correction may replace an earlier specific answer", () => {
  const intent = inferStructuredWorkflowIntent({
    originalInput: realEstateOriginal,
    answers: [
      clarificationAnswer("human_owner", "Who owns exceptions?", "Jane Doe, the lead real-estate coordinator."),
      clarificationAnswer("human_owner", "Who owns exceptions now?", "Actually, Priya Shah, the mortgage operations manager."),
    ],
  });
  assert.match(intent.human_owner ?? "", /priya shah/i);
});

test("custom clarification question IDs map to canonical fields", () => {
  assert.equal(getClarificationAnswerKind({
    question_id: "real_estate_workflow_human_owner",
    question: "Who is accountable for exceptions?",
  }), "human_owner");
  assert.equal(getClarificationAnswerKind({
    question_id: "buyer_intake_data_source",
    question: "Which system supplies the records?",
  }), "data_source");
});

test("a second custom human-owner question is rejected when a concrete owner is known", () => {
  const input = {
    originalInput: "When a buyer submits a form, prepare an internal matching summary and notify a coordinator.",
    answers: [clarificationAnswer("human_owner", "Who owns exceptions?", "Jane Doe, lead real-estate coordinator")],
  };
  const session = normalizeAgentSession(providerSession({
    id: "real_estate_workflow_human_owner",
    kind: "other",
    question: "Who should own matching exceptions?",
  }), input);
  assert.notEqual(session.next_question?.id, "real_estate_workflow_human_owner");
  assert.notEqual(session.next_question?.kind, "human_owner");
});

test("a second custom data-source question is rejected when a concrete source is known", () => {
  const input = {
    originalInput: "When a buyer request arrives, prepare a matching recommendation.",
    answers: [clarificationAnswer("data_source", "Where do requests originate?", "Buyer preference form in HubSpot")],
  };
  const session = normalizeAgentSession(providerSession({
    id: "buyer_matching_input_source",
    kind: "other",
    question: "Where should buyer requests be read from?",
  }), input);
  assert.notEqual(session.next_question?.id, "buyer_matching_input_source");
  assert.notEqual(session.next_question?.kind, "data_source");
});

test("generic example text is classified and retained as a visible placeholder", () => {
  const example = "A form, shared inbox, spreadsheet, or business system.";
  assert.equal(factConfidence(example, "answer"), "placeholder");
  const intent = inferStructuredWorkflowIntent({
    originalInput: "When a buyer request arrives, prepare a matching summary.",
    answers: [clarificationAnswer("workflow_source", "Where does it come from?", example)],
  });
  assert.match(intent.input_sources[0] ?? "", /^\[PLACEHOLDER\]/);
});

test("a marked placeholder can support only a non-executing draft", () => {
  const session = buildDeterministicClarificationSession({
    originalInput: "When a buyer request arrives, prepare an internal matching summary.",
    answers: [clarificationAnswer(
      "workflow_source",
      "Where does the information come from?",
      "A form, shared inbox, spreadsheet, or business system.",
    )],
  }, "Provider unavailable in test.");
  assert.equal(session.ready_to_compile, true);
  assert.match(session.reason, /placeholder values/i);
  assert.match(session.rewritten_compile_prompt ?? "", /\[PLACEHOLDER\]/);
});

test("placeholder answers do not overwrite confirmed facts", () => {
  const intent = inferStructuredWorkflowIntent({
    originalInput: realEstateOriginal,
    answers: [
      clarificationAnswer("human_owner", "Who owns exceptions?", "Jane Doe, lead real-estate coordinator"),
      clarificationAnswer("reviewer", "Who reviews?", "A suitable reviewer."),
    ],
  });
  assert.match(intent.human_owner ?? "", /jane doe/i);
});

test("original input remains preserved while current scope is refined", () => {
  const intent = inferStructuredWorkflowIntent({
    originalInput: realEstateOriginal,
    answers: [clarificationAnswer("workflow_scope", "Which workflow should start first?", "Start with agent matching only.")],
  });
  assert.equal(intent.original_input, realEstateOriginal);
  assert.match(intent.task_type ?? "", /agent matching/i);
  assert.doesNotMatch(intent.task_type ?? "", /mortgage pre-approval/i);
  assert.match(intent.goal ?? "", /agent matching/i);
});

test("a data-requirements answer is not stored as an approval boundary", () => {
  const intent = inferStructuredWorkflowIntent({
    originalInput: "Prepare mortgage pre-approval information for review.",
    answers: [clarificationAnswer(
      "approval_process",
      "What data and integrations are required for mortgage pre-approval?",
      "Collect annual income, employment status, debt, assets, credit score, and integrate with LenderA and LenderB APIs.",
    )],
  });
  assert.equal(intent.approval_boundary, undefined);
  assert.match(intent.input_data.join(" "), /annual income/i);
  assert.match(intent.output_destinations.join(" "), /LenderA/i);
});

test("goal, task type, and trigger are concise and semantically distinct", () => {
  const original = "When a prospective homebuyer submits a preference form, validate buyer information, match suitable agents, prepare recommendations, and route exceptions to a human coordinator.";
  const intent = inferStructuredWorkflowIntent({ originalInput: original, answers: [] });
  assert.match(intent.trigger ?? "", /when a prospective homebuyer submits/i);
  assert.ok((intent.task_type?.length ?? 999) < original.length);
  assert.ok((intent.goal?.length ?? 999) < original.length);
  assert.notEqual(intent.goal, intent.task_type);
  assert.notEqual(intent.trigger, intent.task_type);
  assert.equal(intent.original_input, original);
});

test("employment status in mortgage data does not create employment risk", () => {
  const signals = scanSignals("Collect annual income, employment status, debt, assets, and credit score for mortgage pre-approval review.");
  assert.ok(signals.risk_flags.includes("financial"));
  assert.ok(!signals.risk_flags.includes("employment"));
});

test("genuine candidate hiring decisions still create employment risk", () => {
  const signals = scanSignals("Review candidates and recommend which candidate to hire for the role.");
  assert.ok(signals.risk_flags.includes("employment"));
  assert.ok(signals.risk_flags.includes("high_stakes_decision"));
});

function architectProposal(overrides: Partial<BlueprintArchitectOutput> = {}): BlueprintArchitectOutput {
  return {
    provider: "openai",
    used_ai: true,
    fallback_used: false,
    confidence: "high",
    status: "used_ai",
    reason: "Validated mocked proposal.",
    workflow_name: "Buyer preference and agent matching review",
    summary: "Validate buyer preferences, match suitable agents, and route exceptions for coordinator approval.",
    proposed_steps: [
      { id: "receive_preferences", label: "Receive buyer preferences", primitive: "intake", description: "Receive a buyer preference form.", input: "Buyer preference form", output: "Buyer intake record", automation_policy: "automate", risk_level: "low", approval_required: false },
      { id: "validate_buyer", label: "Validate buyer information", primitive: "validation", description: "Check required buyer information.", input: "Buyer intake record", output: "Validated buyer record", automation_policy: "assist_only", risk_level: "medium", approval_required: false },
      { id: "match_agents", label: "Match suitable agents", primitive: "classification", description: "Match buyer preferences to suitable agents.", input: "Validated buyer preferences", output: "Agent recommendations", automation_policy: "assist_only", risk_level: "medium", approval_required: false },
      { id: "route_exceptions", label: "Route exceptions to coordinator", primitive: "routing", description: "Route uncertain matches to the human coordinator.", input: "Exceptions", output: "Coordinator review task", automation_policy: "human_approval", risk_level: "medium", approval_required: true },
      { id: "prepare_output", label: "Prepare internal review output", primitive: "reporting", description: "Prepare the internal agent recommendation package.", input: "Reviewed recommendations", output: "Internal review package", automation_policy: "draft_only", risk_level: "low", approval_required: true },
    ],
    proposed_human_approval_gates: [{ id: "coordinator_review", label: "Coordinator review", reason: "Exceptions require human review.", applies_to_step_ids: ["route_exceptions", "prepare_output"], required: true }],
    proposed_risks: [],
    safe_to_automate: ["Prepare internal recommendations."],
    must_remain_draft_only: ["External client communication."],
    requires_human_approval: ["Coordinator review before external communication."],
    blocked_or_not_recommended: [],
    assumptions: [],
    open_questions: [],
    safer_alternative: "Keep recommendations internal.",
    ...overrides,
  };
}

const matchingIntent = inferStructuredWorkflowIntent({
  originalInput: "When a buyer preference form arrives, validate buyer information, match suitable agents, prepare recommendations, and route exceptions to a human coordinator.",
  answers: [],
});

test("a valid AI architect proposal becomes the final enriched blueprint", () => {
  const selection = selectFinalBlueprint({ baseline: structuredClone(validBlueprint), proposal: architectProposal(), intent: matchingIntent });
  assert.equal(selection.source, "validated AI design with deterministic safety merge");
  assert.equal(selection.blueprint.workflow_name, "Buyer preference and agent matching review");
  assert.ok(selection.blueprint.steps.some((step) => step.id === "match_agents"));
});

test("mandatory deterministic safety gates remain in an enriched blueprint", () => {
  const baseline = structuredClone(validBlueprint);
  const selection = selectFinalBlueprint({ baseline, proposal: architectProposal(), intent: matchingIntent });
  for (const gate of baseline.human_approval_gates) {
    assert.ok(selection.blueprint.human_approval_gates.some((candidate) => candidate.id === gate.id));
  }
});

test("invalid or ungrounded AI proposals use the deterministic fallback", () => {
  const proposal = architectProposal({
    summary: "Publish social media advertisements.",
    workflow_name: "Unrelated campaign",
    proposed_steps: architectProposal().proposed_steps.map((step, index) => ({
      ...step,
      id: `campaign_${index}`,
      label: "Publish campaign asset",
      description: "Publish unrelated marketing content.",
      input: "Campaign",
      output: "Advertisement",
    })),
  });
  const selection = selectFinalBlueprint({ baseline: structuredClone(validBlueprint), proposal, intent: matchingIntent });
  assert.equal(selection.source, "deterministic fallback");
  assert.equal(selection.blueprint.workflow_name, validBlueprint.workflow_name);
});

test("a complex discovered idea retains scenario-specific AI steps", () => {
  const selection = selectFinalBlueprint({ baseline: structuredClone(validBlueprint), proposal: architectProposal(), intent: matchingIntent });
  assert.ok(selection.blueprint.steps.length >= 5);
  assert.match(selection.blueprint.steps.map((step) => step.label).join(" "), /buyer preferences|match suitable agents|coordinator/i);
  assert.doesNotMatch(selection.blueprint.steps.map((step) => step.label).join(" "), /Step 1|Step 2/);
});

test("blueprint selection observability names its authoritative source", () => {
  const selection = selectFinalBlueprint({ baseline: structuredClone(validBlueprint), proposal: architectProposal(), intent: matchingIntent });
  assert.equal(selection.source, "validated AI design with deterministic safety merge");
  assert.match(selection.blueprint.assumptions.join(" "), /Final blueprint source/i);
});

test("n8n external nodes are disabled, marked, and receive placeholder credentials", () => {
  const compact = buildCompactN8nGenerationInput(validCompileJob);
  const normalized = normalizeExternalActionSafety({
    name: "External action test",
    active: false,
    nodes: [{
      id: "send",
      name: "Send client email",
      type: "n8n-nodes-base.gmail",
      typeVersion: 2,
      position: [0, 0],
      parameters: { operation: "send" },
      credentials: { gmailOAuth2: { id: "real-secret-id", name: "Production Gmail" } },
    }],
    connections: {},
  }, compact) as { nodes: Array<Record<string, unknown>> };
  const node = normalized.nodes[0]!;
  assert.equal(node.disabled, true);
  assert.match(String(node.name), /^DISABLED -/);
  assert.match(JSON.stringify(node.credentials), /PLACEHOLDER_GMAIL_OAUTH2_CREDENTIAL/);
  assert.doesNotMatch(JSON.stringify(node), /real-secret-id|Production Gmail/);
});

test("ambiguous safe-subset nodes are not silently altered", () => {
  const compact = buildCompactN8nGenerationInput(validCompileJob);
  const node = { id: "process", name: "Process record", type: "n8n-nodes-base.code", typeVersion: 2, position: [0, 0], parameters: { jsCode: "return items;" } };
  const normalized = normalizeExternalActionSafety({ nodes: [node], connections: {}, active: false }, compact) as { nodes: unknown[] };
  assert.deepEqual(normalized.nodes[0], node);
});

test("normalized external placeholders pass the existing validator and remain inactive", () => {
  const compact = buildCompactN8nGenerationInput(validCompileJob);
  const normalized = normalizeExternalActionSafety({
    name: "Safe external placeholder",
    active: false,
    nodes: [
      { id: "review", name: "Human Approval Review", type: "n8n-nodes-base.set", typeVersion: 1, position: [0, 0], parameters: { values: { status: "pending" } } },
      { id: "send", name: "Send Gmail message", type: "n8n-nodes-base.gmail", typeVersion: 2, position: [260, 0], parameters: { operation: "send" }, credentials: { gmailOAuth2: { id: "real", name: "real" } } },
    ],
    connections: {},
  }, compact);
  const parsed = n8nWorkflowSchema.parse(normalized);
  assert.equal(parsed.active, false);
  assert.equal(parsed.nodes.find((node) => node.id === "send")?.disabled, true);
});

test("n8n safety normalization is recorded in the generation trace", async () => {
  const priorKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "mock-test-key";
  try {
    const result = await runN8nWorkflowGeneratorAgent({ compileJob: validCompileJob }, {
      calls: {
        openai: async () => JSON.stringify({
          name: "Mock external preview",
          active: false,
          nodes: [{ id: "gmail", name: "Gmail Trigger", type: "n8n-nodes-base.gmailTrigger", typeVersion: 1, position: [0, 0], parameters: {}, credentials: { gmailOAuth2: { id: "real", name: "real" } } }],
          connections: {},
        }),
      },
    });
    assert.ok(result.generation_trace?.processing.normalization_actions.some((action) => action.id === "external_action_safety"));
    assert.equal(result.workflow_json.active, false);
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  }
});

test("manual and Surprise Me inputs still share the same compiler function", async () => {
  const page = await readFile("app/pages/compiler.vue", "utf8");
  assert.match(page, /sendSuggestionToCompiler\(suggestion, compilePrompt\)/);
  assert.match(page, /startGuidedCompile\([\s\S]*startClarificationForInput\(originalInput\)/);
  assert.equal((page.match(/async function compilePrompt\(/g) ?? []).length, 1);
});
