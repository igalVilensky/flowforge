import assert from "node:assert/strict";
import type { CompactN8nGenerationInput, N8nWorkflow } from "../shared/types/n8nWorkflow";
import { validCompileJob } from "../server/fixtures/validCompileJob";
import { buildN8nImplementationBrief } from "../server/services/n8nImplementationBriefBuilder";
import {
  N8nWorkflowGeneratorValidationError,
  collectN8nWorkflowWarnings,
  normalizeAndValidateGeneratedWorkflow,
  runN8nWorkflowGeneratorAgent,
} from "../server/services/n8nWorkflowGeneratorAgent";

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

function node(input: Partial<N8nWorkflow["nodes"][number]> & Pick<N8nWorkflow["nodes"][number], "name" | "type">) {
  return {
    id: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    typeVersion: 1,
    position: [0, 0] as [number, number],
    parameters: {},
    ...input,
  };
}

function workflow(nodes: N8nWorkflow["nodes"], connections: Record<string, unknown> = {}, active = false) {
  return JSON.stringify({ name: "Provider workflow", nodes, connections, active });
}

function assertValidationError(action: () => unknown, message: string): void {
  assert.throws(action, (error) => error instanceof N8nWorkflowGeneratorValidationError, message);
}

const gmailJson = workflow([
  node({ name: "Start", type: "n8n-nodes-base.manualTrigger" }),
  node({
    name: "Send Email",
    type: "n8n-nodes-base.gmail",
    parameters: { resource: "message", operation: "send", to: "={{ $json.to }}" },
    credentials: { gmailOAuth2: { id: "12345", name: "My real-looking Gmail" } },
  }),
], {
  Start: { main: [[{ node: "Send Email", type: "main", index: 0 }]] },
}, true);

let groqCalled = false;
const gmailResult = await runN8nWorkflowGeneratorAgent(
  { compileJob: structuredClone(validCompileJob) },
  {
    calls: {
      openai: async () => gmailJson,
      groq: async () => {
        groqCalled = true;
        throw new Error("Groq must not run after a technically valid OpenAI result.");
      },
    },
  },
);

assert.equal(gmailResult.provider, "openai");
assert.equal(gmailResult.workflow_json.active, false);
assert.equal(groqCalled, false);
assert.match(gmailResult.warnings.join(" "), /credentials must be configured manually/i);
assert.match(gmailResult.warnings.join(" "), /external actions may send/i);
assert.equal(gmailResult.workflow_json.nodes[1]?.type, "n8n-nodes-base.gmail");
assert.match(JSON.stringify(gmailResult.workflow_json.nodes[1]?.credentials), /PLACEHOLDER_GMAIL_OAUTH2_CREDENTIAL/);

const fallbackResult = await runN8nWorkflowGeneratorAgent(
  { compileJob: structuredClone(validCompileJob) },
  {
    calls: {
      openai: async () => "invalid json",
      groq: async () => workflow([
        node({ name: "Fallback Start", type: "n8n-nodes-base.manualTrigger" }),
      ]),
    },
  },
);
assert.equal(fallbackResult.provider, "groq");
assert.equal(fallbackResult.fallback_used, true);
assert.equal(fallbackResult.provider_attempts?.[0]?.success, false);
assert.equal(fallbackResult.provider_attempts?.[0]?.validation_issues?.[0]?.code, "invalid_json");
assert.equal(fallbackResult.provider_attempts?.[1]?.success, true);

const slack = normalizeAndValidateGeneratedWorkflow(workflow([
  node({ name: "Post to team channel", type: "n8n-nodes-base.slack", parameters: { operation: "postMessage" } }),
]), compactInput);
assert.equal(slack.nodes[0]?.name, "Post to team channel");
assert.equal(slack.nodes[0]?.disabled, undefined);

const update = normalizeAndValidateGeneratedWorkflow(workflow([
  node({ name: "Update CRM Record", type: "n8n-nodes-base.hubspot", parameters: { operation: "update" } }),
]), compactInput);
assert.equal(update.nodes[0]?.type, "n8n-nodes-base.hubspot");
assert.equal(update.nodes[0]?.parameters.operation, "update");
assert.match(collectN8nWorkflowWarnings(update, compactInput).join(" "), /external actions may send/i);

const codeSend = normalizeAndValidateGeneratedWorkflow(workflow([
  node({
    name: "Send custom webhook",
    type: "n8n-nodes-base.code",
    parameters: { jsCode: "return items; // caller-provided external action" },
  }),
]), compactInput);
assert.equal(codeSend.nodes[0]?.disabled, undefined);
assert.equal(codeSend.nodes[0]?.parameters.jsCode, "return items; // caller-provided external action");

const draft = normalizeAndValidateGeneratedWorkflow(workflow([
  node({ name: "Create Gmail Draft", type: "n8n-nodes-base.gmail", parameters: { resource: "draft", operation: "create" } }),
]), { ...compactInput, original_request: "Create an email draft." });
assert.equal(draft.nodes[0]?.parameters.resource, "draft");
assert.equal(draft.nodes[0]?.parameters.operation, "create");

const approval = normalizeAndValidateGeneratedWorkflow(workflow([
  node({ name: "Human Approval", type: "n8n-nodes-base.if", parameters: { conditions: { boolean: [] } } }),
  node({ name: "Send approved email", type: "n8n-nodes-base.gmail", parameters: { operation: "send" } }),
], {
  "Human Approval": { main: [[{ node: "Send approved email", type: "main", index: 0 }]] },
}), { ...compactInput, human_approval_gates: ["A human approves before send."] });
assert.deepEqual(approval.nodes.map((item) => item.name), ["Human Approval", "Send approved email"]);

assertValidationError(
  () => normalizeAndValidateGeneratedWorkflow("not json", compactInput),
  "Invalid JSON must remain a hard error.",
);
assertValidationError(
  () => normalizeAndValidateGeneratedWorkflow(JSON.stringify({ nodes: "bad", connections: {}, active: false }), compactInput),
  "Invalid nodes must remain a hard error.",
);
assertValidationError(
  () => normalizeAndValidateGeneratedWorkflow(workflow([
    node({ name: "Start", type: "n8n-nodes-base.manualTrigger" }),
  ], { Start: { main: [[{ node: "Missing", type: "main", index: 0 }]] } }), compactInput),
  "Unrepairable connection references must remain a hard error.",
);

const activeSafeWorkflow = normalizeAndValidateGeneratedWorkflow(workflow([
  node({ name: "Start", type: "n8n-nodes-base.manualTrigger" }),
  node({ name: "Prepare Data", type: "n8n-nodes-base.set", parameters: { values: { ok: true } } }),
], {
  Start: { main: [[{ node: "Prepare Data", type: "main", index: 0 }]] },
}, true), compactInput);
assert.equal(activeSafeWorkflow.active, false);
assert.equal(activeSafeWorkflow.nodes.length, 2);

const automaticSendJob = structuredClone(validCompileJob);
automaticSendJob.input.raw = "Automatically send a Slack message when a new approved record arrives.";
automaticSendJob.input.trimmed = automaticSendJob.input.raw;
automaticSendJob.signals.has_external_action = true;
automaticSendJob.risks.categories = [...new Set([...automaticSendJob.risks.categories, "real_world_execution"] )];
automaticSendJob.result.not_safe_to_automate = [];
automaticSendJob.result.not_recommended = [];
if (automaticSendJob.safety_critic) {
  automaticSendJob.safety_critic.blocked_or_not_recommended = [];
  automaticSendJob.safety_critic.must_remain_draft_only = [];
}
const automaticBrief = buildN8nImplementationBrief(automaticSendJob);
assert.equal(
  automaticBrief.blocked_or_not_safe_actions.some((item) => /external messages must remain draft|do not execute production/i.test(item)),
  false,
  "External action risk alone must not silently rewrite clarified automatic-send intent.",
);

console.log("PASS n8n generator hard/soft validation regressions");
