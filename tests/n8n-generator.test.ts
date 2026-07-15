import type { CompactN8nGenerationInput, N8nWorkflow } from "../shared/types/n8nWorkflow";
import { validCompileJob } from "../server/fixtures/validCompileJob";
import { buildN8nImplementationBrief } from "../server/services/n8nImplementationBriefBuilder";
import {
  N8nWorkflowGeneratorValidationError,
  collectN8nWorkflowWarnings,
  normalizeAndValidateGeneratedWorkflow,
  runN8nWorkflowGeneratorAgent,
} from "../server/services/n8nWorkflowGeneratorAgent";

function fail(message: string): never {
  throw new Error(message);
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message = "Values are not equal.",
): void {
  if (actual !== expected) {
    fail(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message = "Values are not deeply equal.",
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    fail(`${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
}

function assertMatch(
  value: unknown,
  pattern: RegExp,
  message = `Value does not match ${pattern}.`,
): void {
  if (!pattern.test(String(value))) {
    fail(`${message}\nActual: ${String(value)}`);
  }
}

function assertDoesNotMatch(
  value: unknown,
  pattern: RegExp,
  message = `Value unexpectedly matches ${pattern}.`,
): void {
  if (pattern.test(String(value))) {
    fail(`${message}\nActual: ${String(value)}`);
  }
}

function assertOk(
  value: unknown,
  message = "Expected a truthy value.",
): asserts value {
  if (!value) fail(message);
}

const compactInput: CompactN8nGenerationInput = {
  original_request: "Send the requested update.",
  workflow_name: "Requested External Action",
  blueprint_summary: "Preserve the requested action.",
  safety_status: "safe_with_human_approval",
  safety_summary: "Review before activation.",
  next_safe_action: "Import and configure.",
  workflow_goal: "Perform the clarified action.",
  trigger_description: "Manual",
  source: "User input",
  extracted_fields: [],
  classification_target: "",
  classification_rules: [],
  internal_outputs: [],
  human_approval_gates: [],
  blocked_or_not_safe_actions: [],
  warnings: [],
  recommended_nodes: [],
};

function node(
  input: Partial<N8nWorkflow["nodes"][number]>
    & Pick<N8nWorkflow["nodes"][number], "name" | "type">,
) {
  return {
    id: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: {},
    ...input,
  };
}

function workflow(
  nodes: N8nWorkflow["nodes"],
  connections: Record<string, unknown> = {},
  active = false,
) {
  return JSON.stringify({
    name: "Provider workflow",
    nodes,
    connections,
    active,
  });
}

function assertValidationError(
  action: () => unknown,
  message: string,
): void {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof N8nWorkflowGeneratorValidationError) {
      return;
    }

    throw error;
  }

  fail(message);
}

function selection(
  workflowName: string,
  nodes: Array<{
    stepIds?: number[];
    nodeKey: string;
    name: string;
    reason?: string;
  }>,
) {
  return JSON.stringify({
    workflowName,
    nodes: nodes.map((item) => ({
      stepIds: item.stepIds ?? [],
      nodeKey: item.nodeKey,
      name: item.name,
      ...(item.reason ? { reason: item.reason } : {}),
    })),
  });
}

let groqCalled = false;

const gmailResult = await runN8nWorkflowGeneratorAgent(
  {
    compileJob: structuredClone(validCompileJob),
  },
  {
    calls: {
      openai: async () =>
        selection(
          "Requested External Action",
          [
            {
              stepIds: [1],
              nodeKey: "manualTrigger",
              name: "Start",
              reason: "Begin from a manual trigger.",
            },
            {
              stepIds: [2],
              nodeKey: "gmail",
              name: "Gmail",
              reason: "Use the native Gmail integration.",
            },
          ],
        ),
      groq: async () => {
        groqCalled = true;
        throw new Error(
          "Groq must not run after a valid OpenAI node selection.",
        );
      },
    },
  },
);

assertEqual(gmailResult.provider, "openai");
assertEqual(gmailResult.workflow_json.active, false);
assertEqual(groqCalled, false);
assertEqual(
  gmailResult.workflow_json.nodes[0]?.type,
  "n8n-nodes-base.manualTrigger",
);
assertEqual(
  gmailResult.workflow_json.nodes[1]?.type,
  "n8n-nodes-base.gmail",
);
assertDeepEqual(
  gmailResult.workflow_json.connections.Start,
  {
    main: [
      [
        {
          node: "Gmail",
          type: "main",
          index: 0,
        },
      ],
    ],
  },
);
assertMatch(
  gmailResult.warnings.join(" "),
  /generated inactive/i,
);
assertMatch(
  gmailResult.warnings.join(" "),
  /configure the selected nodes/i,
);

const fallbackResult = await runN8nWorkflowGeneratorAgent(
  {
    compileJob: structuredClone(validCompileJob),
  },
  {
    calls: {
      openai: async () => "invalid json",
      groq: async () =>
        selection(
          "Fallback Workflow",
          [
            {
              stepIds: [1],
              nodeKey: "manualTrigger",
              name: "Fallback Start",
            },
          ],
        ),
    },
  },
);

assertEqual(fallbackResult.provider, "groq");
assertEqual(fallbackResult.fallback_used, true);
assertEqual(
  fallbackResult.workflow_json.nodes[0]?.type,
  "n8n-nodes-base.manualTrigger",
);
assertEqual(
  fallbackResult.provider_attempts?.[0]?.success,
  false,
);
assertEqual(
  fallbackResult.provider_attempts?.[0]
    ?.validation_issues?.[0]?.code,
  "invalid_json",
);
assertEqual(
  fallbackResult.provider_attempts?.[1]?.success,
  true,
);

const aiSelectionResult = await runN8nWorkflowGeneratorAgent(
  {
    compileJob: structuredClone(validCompileJob),
  },
  {
    calls: {
      openai: async () =>
        selection(
          "Application Review",
          [
            {
              stepIds: [1],
              nodeKey: "gmailTrigger",
              name: "Gmail Trigger",
            },
            {
              stepIds: [2],
              nodeKey: "informationExtractor",
              name: "Information Extractor",
            },
            {
              stepIds: [3],
              nodeKey: "textClassifier",
              name: "Text Classifier",
            },
            {
              stepIds: [4],
              nodeKey: "notion",
              name: "Notion",
            },
          ],
        ),
    },
  },
);

const aiModelNode = aiSelectionResult.workflow_json.nodes.find(
  (item) =>
    item.type
    === "@n8n/n8n-nodes-langchain.lmChatOpenAi",
);

assertOk(
  aiModelNode,
  "AI workflows should receive the default chat model.",
);

assertDeepEqual(
  aiSelectionResult.workflow_json.connections[
    aiModelNode.name
  ],
  {
    ai_languageModel: [
      [
        {
          node: "Information Extractor",
          type: "ai_languageModel",
          index: 0,
        },
        {
          node: "Text Classifier",
          type: "ai_languageModel",
          index: 0,
        },
      ],
    ],
  },
);

assertDeepEqual(
  aiSelectionResult.workflow_json.connections[
    "Text Classifier"
  ],
  {
    main: [
      [
        {
          node: "Notion",
          type: "main",
          index: 0,
        },
      ],
    ],
  },
);

const classifierNode =
  aiSelectionResult.workflow_json.nodes.find(
    (item) =>
      item.type
      === "@n8n/n8n-nodes-langchain.textClassifier",
  );

assertOk(
  classifierNode,
  "The generated workflow should contain a Text Classifier node.",
);

assertDeepEqual(
  classifierNode.parameters.categories,
  {
    categories: [
      {
        category: "High",
        description: "Urgent or high-priority item",
      },
      {
        category: "Normal",
        description: "Standard-priority item",
      },
    ],
  },
);

const slack = normalizeAndValidateGeneratedWorkflow(
  workflow([
    node({
      name: "Post to team channel",
      type: "n8n-nodes-base.slack",
      parameters: {
        operation: "postMessage",
      },
    }),
  ]),
  compactInput,
);

assertEqual(
  slack.nodes[0]?.name,
  "Post to team channel",
);
assertEqual(
  slack.nodes[0]?.disabled,
  undefined,
);

const update = normalizeAndValidateGeneratedWorkflow(
  workflow([
    node({
      name: "Update CRM Record",
      type: "n8n-nodes-base.hubspot",
      parameters: {
        operation: "update",
      },
    }),
  ]),
  compactInput,
);

assertEqual(
  update.nodes[0]?.type,
  "n8n-nodes-base.hubspot",
);
assertEqual(
  update.nodes[0]?.parameters.operation,
  "update",
);
assertMatch(
  collectN8nWorkflowWarnings(
    update,
    compactInput,
  ).join(" "),
  /external integration node/i,
);

const codeSend = normalizeAndValidateGeneratedWorkflow(
  workflow([
    node({
      name: "Send custom webhook",
      type: "n8n-nodes-base.code",
      parameters: {
        jsCode:
          "return items; // caller-provided external action",
      },
    }),
  ]),
  compactInput,
);

assertEqual(
  codeSend.nodes[0]?.disabled,
  undefined,
);
assertEqual(
  codeSend.nodes[0]?.parameters.jsCode,
  "return items; // caller-provided external action",
);

const draft = normalizeAndValidateGeneratedWorkflow(
  workflow([
    node({
      name: "Create Gmail Draft",
      type: "n8n-nodes-base.gmail",
      parameters: {
        resource: "draft",
        operation: "create",
      },
    }),
  ]),
  {
    ...compactInput,
    original_request: "Create an email draft.",
  },
);

assertEqual(
  draft.nodes[0]?.parameters.resource,
  "draft",
);
assertEqual(
  draft.nodes[0]?.parameters.operation,
  "create",
);

const approval = normalizeAndValidateGeneratedWorkflow(
  workflow(
    [
      node({
        name: "Human Approval",
        type: "n8n-nodes-base.if",
        parameters: {
          conditions: {
            boolean: [],
          },
        },
      }),
      node({
        name: "Send approved email",
        type: "n8n-nodes-base.gmail",
        parameters: {
          operation: "send",
        },
      }),
    ],
    {
      "Human Approval": {
        main: [
          [
            {
              node: "Send approved email",
              type: "main",
              index: 0,
            },
          ],
        ],
      },
    },
  ),
  {
    ...compactInput,
    human_approval_gates: [
      "A human approves before send.",
    ],
  },
);

assertDeepEqual(
  approval.nodes.map((item) => item.name),
  [
    "Human Approval",
    "Send approved email",
  ],
);

assertValidationError(
  () =>
    normalizeAndValidateGeneratedWorkflow(
      "not json",
      compactInput,
    ),
  "Invalid JSON must remain a hard error.",
);

assertValidationError(
  () =>
    normalizeAndValidateGeneratedWorkflow(
      JSON.stringify({
        nodes: "bad",
        connections: {},
        active: false,
      }),
      compactInput,
    ),
  "Invalid nodes must remain a hard error.",
);

assertValidationError(
  () =>
    normalizeAndValidateGeneratedWorkflow(
      workflow(
        [
          node({
            name: "Start",
            type: "n8n-nodes-base.manualTrigger",
          }),
        ],
        {
          Start: {
            main: [
              [
                {
                  node: "Missing",
                  type: "main",
                  index: 0,
                },
              ],
            ],
          },
        },
      ),
      compactInput,
    ),
  "Unrepairable connection references must remain a hard error.",
);

const activeSafeWorkflow =
  normalizeAndValidateGeneratedWorkflow(
    workflow(
      [
        node({
          name: "Start",
          type: "n8n-nodes-base.manualTrigger",
        }),
        node({
          name: "Prepare Data",
          type: "n8n-nodes-base.set",
          parameters: {
            values: {
              ok: true,
            },
          },
        }),
      ],
      {
        Start: {
          main: [
            [
              {
                node: "Prepare Data",
                type: "main",
                index: 0,
              },
            ],
          ],
        },
      },
      true,
    ),
    compactInput,
  );

assertEqual(
  activeSafeWorkflow.active,
  false,
);
assertEqual(
  activeSafeWorkflow.nodes.length,
  2,
);

const automaticSendJob =
  structuredClone(validCompileJob);

automaticSendJob.input.raw =
  "Automatically send a Slack message when a new approved record arrives.";
automaticSendJob.input.trimmed =
  automaticSendJob.input.raw;
automaticSendJob.signals.has_external_action = true;

if (
  !automaticSendJob.risks.categories.includes(
    "real_world_execution",
  )
) {
  automaticSendJob.risks.categories.push(
    "real_world_execution",
  );
}

automaticSendJob.result.not_safe_to_automate = [];
automaticSendJob.result.not_recommended = [];

if (automaticSendJob.safety_critic) {
  automaticSendJob.safety_critic
    .blocked_or_not_recommended = [];
  automaticSendJob.safety_critic
    .must_remain_draft_only = [];
}

const automaticBrief =
  buildN8nImplementationBrief(
    automaticSendJob,
  );

assertEqual(
  automaticBrief.blocked_or_not_safe_actions.some(
    (item) =>
      /external messages must remain draft|do not execute production/i.test(
        item,
      ),
  ),
  false,
  "External action risk alone must not silently rewrite clarified automatic-send intent.",
);

const supportSummaryJob =
  structuredClone(validCompileJob);

supportSummaryJob.input.raw =
  "Automate my tasks. Support emails from students. A summary. When a new email arrives in the student-support@university.edu inbox.";
supportSummaryJob.input.trimmed =
  supportSummaryJob.input.raw;
supportSummaryJob.result.human_approval_gates = [];
supportSummaryJob.result.not_safe_to_automate = [];
supportSummaryJob.result.not_recommended = [];
supportSummaryJob.risks.categories.splice(0);
supportSummaryJob.risks.requires_human_review = false;

if (supportSummaryJob.safety_critic) {
  supportSummaryJob.safety_critic
    .blocked_or_not_recommended = [];
  supportSummaryJob.safety_critic
    .must_remain_draft_only = [];
}

const supportSummaryBrief =
  buildN8nImplementationBrief(
    supportSummaryJob,
  );

const supportSummaryBriefText =
  JSON.stringify(
    supportSummaryBrief,
  ).toLowerCase();

assertMatch(
  supportSummaryBrief.recommended_nodes[0] ?? "",
  /email trigger/i,
);

assertOk(
  supportSummaryBrief.internal_outputs.includes(
    "summary",
  ),
  "Support summary brief should include summary output.",
);

assertMatch(
  supportSummaryBrief.recommended_nodes.join(" "),
  /summarizer|summary/i,
);

assertDoesNotMatch(
  supportSummaryBriefText,
  /order id|complaint reason|urgency|customer name|account identifier|review task|draft reply|manual trigger|sample support/,
);

const unknownEmailProviderWarnings =
  collectN8nWorkflowWarnings(
    normalizeAndValidateGeneratedWorkflow(
      workflow([
        node({
          name: "Configurable Email Trigger",
          type: "n8n-nodes-base.emailReadImap",
        }),
        node({
          name: "Summarize Incoming Content",
          type: "n8n-nodes-base.code",
          parameters: {
            jsCode: "return items;",
          },
        }),
      ]),
      compactInput,
    ),
    {
      ...compactInput,
      trigger_description:
        supportSummaryBrief.trigger_description,
      source: supportSummaryBrief.source,
    },
  );

assertMatch(
  unknownEmailProviderWarnings.join(" "),
  /email provider is unspecified/i,
);

const supportSlackJob =
  structuredClone(supportSummaryJob);

supportSlackJob.input.raw =
  "When a support email arrives, summarize it and send the summary to the support team in Slack.";
supportSlackJob.input.trimmed =
  supportSlackJob.input.raw;

const supportSlackBrief =
  buildN8nImplementationBrief(
    supportSlackJob,
  );

assertOk(
  supportSlackBrief.internal_outputs.includes(
    "Slack message",
  ),
);
assertOk(
  supportSlackBrief.internal_outputs.includes("Slack message"),
  "Support Slack brief should include a Slack message output.",
);

console.log(
  "PASS n8n generator selector and validation regressions",
);