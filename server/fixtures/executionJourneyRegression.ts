import { buildExecutionJourney } from "../../shared/executionJourney";
import type {
  N8nGenerationTrace,
  N8nGeneratorProviderAttempt,
  N8nWorkflow,
} from "../../shared/types/n8nWorkflow";
import type { FixtureValidationCheck } from "../services/schemaValidator";
import { validCompileJob } from "./validCompileJob";

function check(name: string, success: boolean, message: string): FixtureValidationCheck {
  return {
    name,
    success,
    issues: success ? [] : [{ path: "(execution journey)", message, code: "execution_journey_regression" }],
  };
}

const workflow: N8nWorkflow = {
  name: "Support Triage Review Draft",
  nodes: [
    {
      id: "manual-trigger",
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
  active: false,
};

const processing = {
  normalization_actions: [
    {
      id: "node_parameters",
      description: "Rebuilt generated node parameters from canonical fields.",
      function_names: ["normalizeGeneratedWorkflowNodeParameters()"],
    },
  ],
  repair_actions: [
    {
      id: "workflow_graph",
      description: "Rebuilt broken workflow connections.",
      function_names: ["repairGeneratedWorkflowGraph()"],
    },
  ],
  canonical_fields_restored: ["human_owner", "approval_boundary"],
  schema_validation_passed: true,
  quality_validation_passed: true,
  validation_issues: [],
};

const attempts: N8nGeneratorProviderAttempt[] = [
  {
    provider: "openai",
    attempted: true,
    success: false,
    error_summary: "Generated workflow failed direct-workflow quality validation.",
    validation_issues: [
      {
        path: "nodes.Sample.parameters",
        message: "Canonical extracted field urgency is missing.",
        code: "custom",
      },
    ],
  },
  {
    provider: "groq",
    attempted: true,
    success: true,
    processing_trace: processing,
  },
];

const generationTrace: N8nGenerationTrace = {
  implementation_input: {
    original_request: validCompileJob.input.raw,
    workflow_name: "Support Triage Review Draft",
    blueprint_summary: validCompileJob.result.summary,
    safety_status: "safe_internal_preview",
    safety_summary: validCompileJob.safety_critic?.summary ?? "",
    next_safe_action: validCompileJob.safety_critic?.next_safe_action ?? "",
    risk_level: validCompileJob.risks.risk_level,
    readiness_score: validCompileJob.readiness.score,
    workflow_goal: "Triage support messages for internal review.",
    trigger_description: "A new support inbox message arrives.",
    source: "support inbox",
    source_type: "email",
    source_is_placeholder: true,
    domain: "support",
    extracted_fields: ["customer_name", "issue_summary", "urgency"],
    classification_target: "topic and urgency",
    classification_rules: ["Classify urgency from visible message content."],
    internal_outputs: ["Internal support review package"],
    human_owner: "support team lead",
    human_approval_gates: ["Review before any reply"],
    approval_boundary: "A human must approve any external reply.",
    external_action_boundary: "No external reply is sent automatically.",
    blocked_or_not_safe_actions: ["Automatic external replies"],
    warnings: [],
    recommended_nodes: ["Manual Trigger", "Sample Intake", "Mark Pending Human Review"],
  },
  processing,
};

export async function buildExecutionJourneyRegressionChecks(): Promise<FixtureValidationCheck[]> {
  const journey = buildExecutionJourney({
    job: structuredClone(validCompileJob),
    n8n: {
      state: "ready",
      workflow,
      provider: "groq",
      used_ai: true,
      fallback_used: true,
      provider_attempts: attempts,
      generation_trace: generationTrace,
      warnings: ["Draft only."],
    },
  });
  const clarification = journey.find((step) => step.id === "clarification");
  const openAi = journey.find((step) => step.id === "n8n_provider_openai_0");
  const groq = journey.find((step) => step.id === "n8n_provider_groq_1");
  const repair = journey.find((step) => step.id === "n8n_normalization_repair");
  const implementation = journey.find((step) => step.id === "implementation_brief");
  const orderIsChronological = journey.every((step, index) => step.order === index + 1)
    && (journey.findIndex((step) => step.id === "router") < journey.findIndex((step) => step.id === "clarification"))
    && (journey.findIndex((step) => step.id === "final_guard") < journey.findIndex((step) => step.id === "implementation_brief"));

  const sparseJob = structuredClone(validCompileJob);
  delete sparseJob.router_decision;
  delete sparseJob.clarification_agent;
  delete sparseJob.blueprint_architect_agent;
  delete sparseJob.safety_critic_agent;
  delete sparseJob.agent_debug;
  sparseJob.agent_trace = [];
  const sparseJourney = buildExecutionJourney({ job: sparseJob });

  return [
    check(
      "executionJourneyChronologicalOrdering",
      orderIsChronological,
      "Journey steps must be numbered and ordered by the real compile and generation path.",
    ),
    check(
      "executionJourneySkippedClarificationReason",
      clarification?.status === "skipped"
        && clarification.actions.some((action) => action.includes("no blocking clarification"))
        && Boolean(clarification.next_step?.reason),
      "A skipped clarification stage must explain the decision and its handoff.",
    ),
    check(
      "executionJourneyProviderFallbackVisibility",
      openAi?.status === "failed"
        && openAi.method === "openai"
        && groq?.status === "fallback"
        && groq.method === "groq",
      "OpenAI failure and Groq fallback must appear as separate provider steps.",
    ),
    check(
      "executionJourneyValidationFailureExplanation",
      openAi?.output_summary.some((item) => item.label === "Validation failures" && item.value.includes("urgency")) === true,
      "Rejected provider drafts must show their quality-validation issue.",
    ),
    check(
      "executionJourneyRepairedOutputExplanation",
      repair?.status === "repaired"
        && repair.actions.some((action) => action.includes("broken workflow connections"))
        && repair.function_names?.includes("repairGeneratedWorkflowGraph()") === true,
      "Applied deterministic repairs and their function names must be visible.",
    ),
    check(
      "executionJourneyNextStepReason",
      journey.filter((step) => step.next_step).every((step) => Boolean(step.next_step?.reason.trim())),
      "Every displayed handoff must include a reason.",
    ),
    check(
      "executionJourneyFieldPurposeExplanations",
      implementation?.field_explanations?.some((item) => item.field === "extracted_fields" && item.used_by?.includes("Normalization")) === true,
      "Actual implementation fields must explain why downstream stages need them.",
    ),
    check(
      "executionJourneySummariesDoNotRequireRawJson",
      journey.every((step) => step.purpose && step.actions.length > 0 && step.input_summary.length > 0 && step.output_summary.length > 0),
      "Every journey card must stand on its compact summary without opening raw JSON.",
    ),
    check(
      "executionJourneyHandlesMissingOptionalTraceData",
      sparseJourney.length > 0
        && sparseJourney.every((step) => step.order > 0 && step.actions.length > 0),
      "Missing optional agent and trace metadata must not break journey derivation.",
    ),
  ];
}
