import type { CompactN8nGenerationInput } from "../../shared/types/n8nWorkflow";

export const n8nWorkflowGeneratorSystemPrompt = [
  "Return only valid JSON. Generate a safe draft n8n workflow from this compact n8n implementation brief.",
  "",
  "Rules:",
  "- Generate workflow.name from workflow_name exactly unless it is missing.",
  "- Generate from workflow_goal, trigger_description, source, extracted_fields, classification_target, internal_outputs, blocked_or_not_safe_actions, and recommended_nodes.",
  "- Do not treat FlowForge compiler, router, safety, or preview steps as the workflow plan.",
  "- Do not create nodes named \"Capture process description\", \"Classify the request\", \"Extract required fields\", \"Check safety boundary\", \"Prepare internal record\", or \"Build non-executing preview\" unless the user explicitly asked to automate FlowForge itself.",
  "- Use domain-specific node names. Prefer recommended_nodes as the node names when they fit.",
  "- Allowed node types only: n8n-nodes-base.manualTrigger, n8n-nodes-base.scheduleTrigger, n8n-nodes-base.set, n8n-nodes-base.code, n8n-nodes-base.if, n8n-nodes-base.stickyNote.",
  "- Do not invent node types such as n8n-nodes-base.extractFields, n8n-nodes-base.classify, n8n-nodes-base.manualReview, or other connector/action nodes.",
  "- Represent extraction with a Set or Code node, classification with a Code or IF node, and manual review with a Sticky Note plus a Set node with review_status:\"pending\".",
  "- Draft only. No production credentials.",
  "- Use placeholder credentials only.",
  "- Keep workflow inactive with active:false.",
  "- No real email sending, record updates, deletes, refunds, payments, or production writes.",
  "- If an external action is needed, create a manual review/approval placeholder instead.",
  "- Use at most 7 nodes.",
  "- Prefer Schedule Trigger or Manual Trigger, Set nodes for sample/extracted/internal payloads, IF only when a branch is useful, and placeholder review nodes.",
  "- Do not name nodes only \"Prepare Data\", \"Code\", or \"Sticky Note\".",
  "- Every node must include string id, name, type, numeric typeVersion, position array, and parameters object.",
  "- Use short stable node ids based on the domain-specific node names.",
  "- Use compact node parameters. No verbose notes. No huge sample data.",
  "- For sample input, prefer a Code node with jsCode returning [{ json: { subject: 'Job Application', candidate_name: '', role: '', portfolio_link: '', application_source: '' } }].",
  "- If using Set nodes, use simple fields and values. Do not put escaped JSON or a whole object inside a single string field named value.",
  "- Avoid JSON-stringified values inside Set node values; use normal fields, arrays, or objects instead of strings containing JSON.",
  "- Do not invent onTrue or onFalse inside IF parameters. Use connections to define flow and branch outputs.",
  "- Connections must use n8n connection objects, not raw node-name strings: { \"Source\": { \"main\": [[{ \"node\": \"Target\", \"type\": \"main\", \"index\": 0 }]] } }.",
  "- Output one n8n workflow object with nodes, connections, and active:false. No markdown.",
].join("\n");

export function buildN8nWorkflowGeneratorUserPrompt(input: CompactN8nGenerationInput): string {
  return [
    "Compact n8n implementation brief:",
    JSON.stringify(input),
  ].join("\n");
}
