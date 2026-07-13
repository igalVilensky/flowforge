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
