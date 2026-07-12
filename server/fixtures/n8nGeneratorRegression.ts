import process from "node:process";
import type { CompileJob } from "../../shared/types/compileJob";
import type { FixtureValidationCheck } from "../services/schemaValidator";
import { validCompileJob } from "./validCompileJob";
import { buildN8nImplementationBrief } from "../services/n8nImplementationBriefBuilder";
import {
  N8nWorkflowGeneratorConfigError,
  N8nWorkflowGeneratorProvidersFailedError,
  resolveN8nOpenAIModelSelection,
  runN8nWorkflowGeneratorAgent,
} from "../services/n8nWorkflowGeneratorAgent";
import { resolveBlueprintOpenAIModelSelection } from "../services/blueprintArchitectAgent";
import {
  OpenAIAPIError,
  buildOpenAIResponsesRequest,
  callOpenAI,
} from "../services/openaiProvider";
import {
  normalizeCompileRequest,
  serializeStructuredCompileInput,
} from "../services/structuredCompileInput";

const admissionsRequest =
  "When a new application email arrives in the shared admissions Gmail inbox, extract the applicant name, application ID, course, and application summary. Classify the application priority for internal triage only, prepare an internal admissions review package, and assign it to the admissions manager, Jane Doe. No external communication may be sent before Jane Doe manually reviews and approves it.";

const approvalBoundary =
  "No external communication may be sent before Jane Doe manually reviews and approves it.";

const validProviderResponse = JSON.stringify({
  name: "Admissions Application Review Draft",
  nodes: [
    {
      id: "manual-review-trigger",
      name: "Manual Review Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
  active: false,
});

function openAISuccessResponse(
  content = validProviderResponse,
): Response {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: content,
            },
          ],
        },
      ],
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

function openAIErrorResponse(input: {
  message: string;
  type?: string;
  param?: string;
  code?: string;
  status?: number;
  statusText?: string;
}): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: input.message,
        type:
          input.type ??
          "invalid_request_error",
        param: input.param,
        code: input.code,
      },
    }),
    {
      status: input.status ?? 400,
      statusText:
        input.statusText ??
        "Bad Request",
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

function check(
  name: string,
  success: boolean,
  message: string,
): FixtureValidationCheck {
  return {
    name,
    success,
    issues: success
      ? []
      : [{
          path: "(n8n regression)",
          message,
          code: "n8n_generator_regression",
        }],
  };
}

function fixtureRecord(
  value: unknown,
): Record<string, unknown> | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<
        string,
        unknown
      >
    : null;
}

function firstMainTarget(
  connections:
    Record<string, unknown>,
  sourceName: string,
): string {
  const source = fixtureRecord(
    connections[sourceName],
  );
  const main = source?.main;
  const firstGroup =
    Array.isArray(main)
      ? main[0]
      : null;
  const firstTarget =
    Array.isArray(firstGroup)
      ? fixtureRecord(
          firstGroup[0],
        )
      : null;

  return typeof firstTarget?.node ===
    "string"
    ? firstTarget.node
    : "";
}

function admissionsCompileJob(): CompileJob {
  const normalized =
    normalizeCompileRequest(
      admissionsRequest,
    );

  const compileJob =
    structuredClone(validCompileJob);

  compileJob.input = {
    raw: admissionsRequest,
    trimmed:
      normalized.semantic_intent,
  };

  return compileJob;
}

function canonicalAdmissionsCompileJob(): CompileJob {
  const compileJob =
    structuredClone(validCompileJob);

  const intent = {
    ...normalizeCompileRequest(
      "Prepare incoming application triage.",
    ).intent,
    input_sources: [
      "Shared admissions Gmail inbox",
    ],
    human_owner:
      "Jane Doe (admissions manager)",
    approval_boundary:
      approvalBoundary,
    external_action_boundary:
      approvalBoundary,
  };

  compileJob.input = {
    raw: serializeStructuredCompileInput({
      intent,
      clarification_answers: [],
      safety_constraints: [],
    }),
    trimmed: "WORKFLOW INTENT",
  };

  return compileJob;
}

type SavedProviderEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_N8N_MODEL?: string;
  OPENAI_BLUEPRINT_MODEL?: string;
  OPENAI_AGENT_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_N8N_API_KEY?: string;
};

function saveProviderEnvironment(): SavedProviderEnvironment {
  return {
    OPENAI_API_KEY:
      process.env.OPENAI_API_KEY,
    OPENAI_N8N_MODEL:
      process.env.OPENAI_N8N_MODEL,
    OPENAI_BLUEPRINT_MODEL:
      process.env.OPENAI_BLUEPRINT_MODEL,
    OPENAI_AGENT_MODEL:
      process.env.OPENAI_AGENT_MODEL,
    GROQ_API_KEY:
      process.env.GROQ_API_KEY,
    GROQ_N8N_API_KEY:
      process.env.GROQ_N8N_API_KEY,
  };
}

function restoreProviderEnvironment(
  saved: SavedProviderEnvironment,
): void {
  for (const key of [
    "OPENAI_API_KEY",
    "OPENAI_N8N_MODEL",
    "OPENAI_BLUEPRINT_MODEL",
    "OPENAI_AGENT_MODEL",
    "GROQ_API_KEY",
    "GROQ_N8N_API_KEY",
  ] as const) {
    const value = saved[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function buildN8nGeneratorRegressionChecks(): Promise<
  FixtureValidationCheck[]
> {
  const compileJob =
    admissionsCompileJob();

  const brief =
    buildN8nImplementationBrief(
      compileJob,
    );

  const canonicalBrief =
    buildN8nImplementationBrief(
      canonicalAdmissionsCompileJob(),
    );

  const savedEnvironment =
    saveProviderEnvironment();

  const unsupportedModelRequest =
    buildOpenAIResponsesRequest({
      model: "gpt-4-turbo",
      prompt: "Return workflow data.",
      systemPrompt:
        "Return structured data.",
      maxOutputTokens: 1200,
      reasoningEffort: "minimal",
      verbosity: "low",
      structuredOutputMode:
        "json_object",
    });

  const supportedModelRequest =
    buildOpenAIResponsesRequest({
      model: "gpt-5-nano",
      prompt: "Return workflow data.",
      systemPrompt:
        "Return structured data.",
      maxOutputTokens: 1200,
      reasoningEffort: "minimal",
      verbosity: "low",
      structuredOutputMode:
        "json_object",
    });

  const checks: FixtureValidationCheck[] = [
    check(
      "n8nPreservesJaneDoeOwner",
      brief.human_owner ===
        "Jane Doe (admissions manager)",
      "The n8n brief must preserve Jane Doe together with the admissions-manager role.",
    ),
    check(
      "n8nPreservesExactApprovalBoundary",
      brief.approval_boundary ===
        approvalBoundary &&
        brief.external_action_boundary ===
          approvalBoundary,
      "The exact user-stated external-communication approval boundary must be preserved.",
    ),
    check(
      "n8nUsesAdmissionsFields",
      brief.domain === "admissions" &&
        brief.extracted_fields.join("|") ===
          "applicant name|application ID|course|application summary" &&
        !brief.extracted_fields.some((field) =>
          /candidate|job role|portfolio|recruit/i.test(
            field,
          ),
        ),
      "Admissions workflows must use applicant/application fields rather than recruitment fields.",
    ),
    check(
      "n8nPreservesCanonicalOwnerAndSource",
      canonicalBrief.human_owner ===
        "Jane Doe (admissions manager)" &&
        canonicalBrief.source ===
          "Shared admissions Gmail inbox" &&
        canonicalBrief.source_type ===
          "gmail" &&
        canonicalBrief.approval_boundary ===
          approvalBoundary,
      "Canonical clarification facts must remain authoritative for the n8n owner, source, and approval boundary.",
    ),
    check(
      "openAIRequestOmitsUnsupportedOptionalFields",
      unsupportedModelRequest.reasoning ===
        undefined &&
        unsupportedModelRequest.text ===
          undefined &&
        unsupportedModelRequest.model ===
          "gpt-4-turbo" &&
        unsupportedModelRequest.max_output_tokens ===
          1200 &&
        unsupportedModelRequest.store ===
          false,
      "The Responses request builder must omit reasoning, verbosity, and structured-output fields for unsupported models.",
    ),
    check(
      "openAIRequestIncludesSupportedOptionalFields",
      supportedModelRequest.reasoning
        ?.effort === "minimal" &&
        supportedModelRequest.text
          ?.verbosity === "low" &&
        supportedModelRequest.text
          ?.format?.type ===
          "json_object",
      "The Responses request builder must include allowed optional fields for a supported GPT-5 model.",
    ),
  ];

  try {
    process.env.OPENAI_API_KEY =
      "test-openai-key";
    delete process.env.OPENAI_N8N_MODEL;
    process.env.OPENAI_AGENT_MODEL =
      "gpt-5-nano";
    process.env.OPENAI_BLUEPRINT_MODEL =
      "gpt-5-nano";
    process.env.GROQ_N8N_API_KEY =
      "test-n8n-groq-key";

    const n8nModelResolution =
      resolveN8nOpenAIModelSelection();

    const blueprintModelResolution =
      resolveBlueprintOpenAIModelSelection();

    checks.push(
      check(
        "openAIModelResolutionIsSafeAndStageAware",
        n8nModelResolution.primaryModelEnv ===
          "OPENAI_N8N_MODEL" &&
          n8nModelResolution.fallbackModelEnv ===
            "OPENAI_AGENT_MODEL" &&
          n8nModelResolution.fallbackUsed &&
          n8nModelResolution.model ===
            "gpt-5-nano" &&
          n8nModelResolution.endpoint ===
            "https://api.openai.com/v1/responses" &&
          blueprintModelResolution.primaryModelEnv ===
            "OPENAI_BLUEPRINT_MODEL" &&
          !blueprintModelResolution.fallbackUsed &&
          blueprintModelResolution.model ===
            "gpt-5-nano",
        "Model diagnostics must safely report stage env names, fallback use, final model, and endpoint.",
      ),
    );

    const retryBodies: Array<
      Record<string, unknown>
    > = [];
    const retryGroqCalls: string[] = [];

    const retrySuccess =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          openaiFetch: async (
            _input,
            init,
          ) => {
            retryBodies.push(
              JSON.parse(
                typeof init?.body ===
                  "string"
                  ? init.body
                  : "{}",
              ) as Record<
                string,
                unknown
              >,
            );

            if (
              retryBodies.length === 1
            ) {
              return openAIErrorResponse({
                message:
                  "Unsupported parameter: 'reasoning.effort'.",
                param:
                  "reasoning.effort",
                code:
                  "unsupported_parameter",
              });
            }

            return openAISuccessResponse();
          },
          calls: {
            groq: async () => {
              retryGroqCalls.push(
                "groq",
              );
              return validProviderResponse;
            },
          },
        },
      );

    checks.push(
      check(
        "openAIUnsupportedParameterRetriesOnceWithMinimalRequest",
        retryBodies.length === 2 &&
          retryBodies[0]?.reasoning !==
            undefined &&
          (
            retryBodies[0]?.text as
              Record<string, unknown>
          )?.format === undefined &&
          retryBodies[1]?.reasoning ===
            undefined &&
          retryBodies[1]?.text ===
            undefined &&
          Object.keys(
            retryBodies[1] ?? {},
          ).sort().join(",") ===
            "input,instructions,max_output_tokens,model,store" &&
          retrySuccess.provider ===
            "openai" &&
          !retrySuccess.fallback_used &&
          retrySuccess.provider_attempts
            ?.length === 1 &&
          retrySuccess.provider_attempts[0]
            ?.success === true &&
          retryGroqCalls.length === 0,
        "An unsupported optional parameter must trigger one minimal retry that remains the same successful OpenAI attempt.",
      ),
    );

    let nonCapabilityCalls = 0;
    let nonCapabilityError:
      OpenAIAPIError | null = null;

    try {
      await callOpenAI(
        "Return json workflow data.",
        "Return only workflow data.",
        {
          modelEnv:
            "OPENAI_N8N_MODEL",
          fallbackModelEnv:
            "OPENAI_AGENT_MODEL",
          maxOutputTokensEnv:
            "OPENAI_N8N_MAX_OUTPUT_TOKENS",
          defaultMaxOutputTokens:
            1200,
          reasoningEffort: "minimal",
          verbosity: "low",
          structuredOutputMode:
            "json_object",
          fetchImpl: async () => {
            nonCapabilityCalls += 1;
            return openAIErrorResponse({
              message:
                "Invalid max_output_tokens value.",
              param:
                "max_output_tokens",
              code: "invalid_value",
            });
          },
        },
      );
    } catch (error) {
      if (
        error instanceof OpenAIAPIError
      ) {
        nonCapabilityError = error;
      }
    }

    checks.push(
      check(
        "openAINonCapability400DoesNotRetry",
        nonCapabilityCalls === 1 &&
          nonCapabilityError
            ?.details.param ===
            "max_output_tokens" &&
          nonCapabilityError
            ?.details.code ===
            "invalid_value",
        "An arbitrary 400 such as invalid max_output_tokens must not trigger the optional-field compatibility retry.",
      ),
    );

    const openAiCalls: string[] = [];
    const openAiSuccess =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              openAiCalls.push("openai");
              return validProviderResponse;
            },
            groq: async () => {
              openAiCalls.push("groq");
              return validProviderResponse;
            },
          },
        },
      );

    checks.push(
      check(
        "n8nUsesOpenAiFirst",
        openAiCalls.join(",") ===
          "openai" &&
          openAiSuccess.provider ===
            "openai" &&
          !openAiSuccess.fallback_used &&
          openAiSuccess.provider_attempts?.[0]
            ?.provider === "openai" &&
          openAiSuccess.provider_attempts?.[0]
            ?.success === true,
        "OpenAI must be attempted first, and an OpenAI success must not be marked as fallback.",
      ),
    );

    const nullCredentialCalls:
      string[] = [];
    const nullCredentialResult =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              nullCredentialCalls.push(
                "openai",
              );

              return JSON.stringify({
                workflow: {
                  name:
                    "Admissions null credential draft",
                  nodes: [
                    {
                      id: "start",
                      name: "Manual Start",
                      type: "n8n-nodes-base.manualTrigger",
                      typeVersion: 1,
                      position: [0, 0],
                      parameters: {},
                    },
                    {
                      id: "extract",
                      name:
                        "Extract Applicant Fields",
                      type: "n8n-nodes-base.code",
                      typeVersion: "1",
                      position: [260, 0],
                      parameters: null,
                      credentials: null,
                    },
                  ],
                  connections: {
                    start: {
                      main: "extract",
                    },
                  },
                  active: true,
                },
              });
            },
            groq: async () => {
              nullCredentialCalls.push(
                "groq",
              );
              return validProviderResponse;
            },
          },
        },
      );

    const normalizedExtractNode =
      nullCredentialResult.workflow_json.nodes
        .find(
          (node) =>
            node.name ===
            "Extract Applicant Fields",
        );

    checks.push(
      check(
        "n8nNormalizesNullOptionalNodeFields",
        nullCredentialCalls.join(",") ===
          "openai" &&
          nullCredentialResult.provider ===
            "openai" &&
          normalizedExtractNode
            ?.credentials === undefined &&
          normalizedExtractNode
            ?.typeVersion === 1 &&
          typeof normalizedExtractNode
            ?.parameters.jsCode ===
            "string" &&
          nullCredentialResult.workflow_json
            .active === false,
        "Recoverable workflow envelopes, null optional fields, numeric type versions, missing parameters, and active drafts must be normalized before validation without reaching Groq.",
      ),
    );

    const wrappedConnectionResult =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () =>
              JSON.stringify({
                name:
                  "Wrapped connections draft",
                nodes: [
                  {
                    id: "start_id",
                    name: "Manual Start",
                    type: "n8n-nodes-base.manualTrigger",
                    typeVersion: 1,
                    position: [0, 0],
                    parameters: {},
                  },
                  {
                    id: "finish_id",
                    name:
                      "Internal Draft Output",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [260, 0],
                    parameters: {},
                  },
                ],
                connections: {
                  start_id: {
                    Source: {
                      main: "finish_id",
                    },
                  },
                },
                active: false,
              }),
            groq: async () => {
              throw new Error(
                "Groq must not be called for recoverable wrapped connections.",
              );
            },
          },
        },
      );

    const wrappedConnections =
      JSON.stringify(
        wrappedConnectionResult
          .workflow_json.connections,
      );

    checks.push(
      check(
        "n8nNormalizesWrappedAndIdBasedConnections",
        wrappedConnectionResult.provider ===
          "openai" &&
          wrappedConnections.includes(
            "Manual Start",
          ) &&
          wrappedConnections.includes(
            "Internal Draft Output",
          ) &&
          !wrappedConnections.includes(
            "start_id",
          ) &&
          !wrappedConnections.includes(
            "finish_id",
          ) &&
          !wrappedConnections.includes(
            "Source",
          ),
        "Recoverable wrapper objects and node-id connection references must normalize to the generated node names.",
      ),
    );

    const unsupportedExternalResult =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () =>
              JSON.stringify({
                name:
                  "External connector preview",
                nodes: [{
                  id: "gmail",
                  name:
                    "Gmail Inbox Trigger Placeholder",
                  type: "n8n-nodes-base.gmailTrigger",
                  typeVersion: 1,
                  position: [0, 0],
                  parameters: {
                    operation: "watch",
                  },
                  credentials: {
                    gmailOAuth2: {
                      id: "real-id",
                      name: "real-name",
                    },
                  },
                }],
                connections: {},
                active: false,
              }),
            groq: async () => {
              throw new Error(
                "Groq must not be called for a safely replaceable external node.",
              );
            },
          },
        },
      );

    const normalizedExternalNode =
      unsupportedExternalResult
        .workflow_json.nodes[0];

    checks.push(
      check(
        "n8nSafelyNormalizesUnsupportedExternalNodes",
        unsupportedExternalResult.provider ===
          "openai" &&
          normalizedExternalNode?.type ===
            "n8n-nodes-base.set" &&
          normalizedExternalNode?.disabled ===
            true &&
          normalizedExternalNode
            ?.credentials === undefined,
        "Unsupported external connector nodes must become disabled safe-preview set nodes with real credential references removed.",
      ),
    );

    const duplicateReviewResult =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () =>
              JSON.stringify({
                name:
                  "Duplicate review draft",
                nodes: [
                  {
                    id: "start",
                    name: "Manual Start",
                    type: "n8n-nodes-base.manualTrigger",
                    typeVersion: 1,
                    position: [0, 0],
                    parameters: {},
                  },
                  {
                    id: "prepare",
                    name:
                      "Prepare Admissions Review Package",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [260, 0],
                    parameters: {},
                  },
                  {
                    id: "pending",
                    name:
                      "Mark Pending Human Review",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [520, 0],
                    parameters: {},
                  },
                  {
                    id: "finish",
                    name:
                      "Internal Draft Output",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [780, 0],
                    parameters: {},
                  },
                  {
                    id: "duplicate_pending",
                    name:
                      "Pending Review Status",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [1040, 0],
                    parameters: {},
                  },
                ],
                connections: {
                  start: {
                    main: "prepare",
                  },
                  prepare: {
                    main: "pending",
                  },
                  pending: {
                    main:
                      "duplicate_pending",
                  },
                  duplicate_pending: {
                    main: "finish",
                  },
                },
                active: false,
              }),
            groq: async () => {
              throw new Error(
                "Groq must not be called after duplicate cleanup.",
              );
            },
          },
        },
      );

    const duplicateWorkflowText =
      JSON.stringify(
        duplicateReviewResult
          .workflow_json,
      );

    checks.push(
      check(
        "n8nDuplicateRemovalLeavesNoStaleConnections",
        duplicateReviewResult.provider ===
          "openai" &&
          duplicateWorkflowText.includes(
            "Mark Pending Human Review",
          ) &&
          !duplicateWorkflowText.includes(
            "Pending Review Status",
          ) &&
          duplicateReviewResult
            .workflow_json.nodes.some(
              (node) =>
                node.name ===
                "Prepare Admissions Review Package",
            ),
        "Removing duplicate pending-review markers must retain the canonical review-package and final pending-review nodes without stale source or target references.",
      ),
    );

    const directRepairCalls:
      string[] = [];
    const repairedDirectWorkflow =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              directRepairCalls.push(
                "openai",
              );

              return JSON.stringify({
                name:
                  "Admissions Application Review Workflow",
                nodes: [
                  {
                    id: "trigger",
                    name:
                      "Admissions Application Review Trigger",
                    type: "n8n-nodes-base.manualTrigger",
                    typeVersion: 1,
                    position: [940, 380],
                    parameters: {},
                  },
                  {
                    id: "sample",
                    name:
                      "Sample Admissions Application",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [120, 760],
                    parameters: {
                      values: {
                        role:
                          "Software Engineer",
                        portfolio_link:
                          "https://example.test",
                        application_source:
                          "Recruitment portal",
                        candidate_name:
                          "Wrong Candidate",
                        source_system:
                          "generic inbox",
                      },
                    },
                  },
                  {
                    id: "extract",
                    name:
                      "Extract Applicant Fields",
                    type: "n8n-nodes-base.code",
                    typeVersion: 1,
                    position: [40, 40],
                    parameters: {
                      jsCode:
                        "return [{ json: { role: 'Engineer', portfolio_link: 'wrong', candidate_name: 'Wrong' } }];",
                    },
                  },
                  {
                    id: "classify",
                    name:
                      "Classify Application Priority",
                    type: "n8n-nodes-base.if",
                    typeVersion: 2,
                    position: [80, 80],
                    parameters: {
                      conditions: {},
                    },
                  },
                  {
                    id: "package",
                    name:
                      "Prepare Admissions Review Package",
                    type: "n8n-nodes-base.set",
                    typeVersion: 1,
                    position: [60, 900],
                    parameters: {
                      values: {
                        review_owner:
                          "responsible human reviewer",
                        role: "Engineer",
                        portfolio_link:
                          "wrong",
                      },
                    },
                  },
                  {
                    id: "note",
                    name:
                      "Review Guidance",
                    type: "n8n-nodes-base.stickyNote",
                    typeVersion: 1,
                    position: [0, 0],
                    parameters: {
                      content:
                        "Use a generic reviewer and generic source.",
                    },
                  },
                ],
                connections: {},
                active: true,
                workflow_goal:
                  "Leaked implementation brief",
                trigger_description:
                  "Leaked trigger",
                source: "generic inbox",
                source_type: "unknown",
                source_is_placeholder:
                  false,
                domain: "recruitment",
                extracted_fields: [
                  "role",
                  "portfolio_link",
                ],
                classification_target:
                  "candidate quality",
                classification_rules: [
                  "Use recruitment fields",
                ],
                internal_outputs: [
                  "candidate package",
                ],
                human_owner:
                  "responsible human reviewer",
                human_approval_gates: [],
                approval_boundary:
                  "Generic approval",
                external_action_boundary:
                  "Generic boundary",
                blocked_or_not_safe_actions:
                  [],
                warnings: [],
                recommended_nodes: [],
                draft_only: false,
              });
            },
            groq: async () => {
              directRepairCalls.push(
                "groq",
              );
              return validProviderResponse;
            },
          },
        },
      );

    const repairedWorkflow =
      repairedDirectWorkflow
        .workflow_json;
    const expectedChain = [
      "Admissions Application Review Trigger",
      "Sample Admissions Application",
      "Extract Applicant Fields",
      "Classify Application Priority",
      "Prepare Admissions Review Package",
      "Mark Pending Human Review",
    ];
    const repairedExecutableNodes =
      repairedWorkflow.nodes.filter(
        (node) =>
          node.type !==
            "n8n-nodes-base.stickyNote" &&
          node.disabled !== true,
      );
    const repairedNodeByName =
      new Map(
        repairedWorkflow.nodes.map(
          (node) => [
            node.name,
            node,
          ],
        ),
      );
    const repairedSampleValues =
      fixtureRecord(
        repairedNodeByName.get(
          "Sample Admissions Application",
        )?.parameters.values,
      );
    const repairedReviewValues =
      fixtureRecord(
        repairedNodeByName.get(
          "Mark Pending Human Review",
        )?.parameters.values,
      );
    const repairedMeta =
      fixtureRecord(
        repairedWorkflow.meta,
      );
    const repairedWorkflowText =
      JSON.stringify(
        repairedWorkflow,
      );
    const leakedRootFields = [
      "workflow_goal",
      "trigger_description",
      "source",
      "source_type",
      "source_is_placeholder",
      "domain",
      "extracted_fields",
      "classification_target",
      "classification_rules",
      "internal_outputs",
      "human_owner",
      "human_approval_gates",
      "approval_boundary",
      "external_action_boundary",
      "blocked_or_not_safe_actions",
      "warnings",
      "recommended_nodes",
      "draft_only",
    ];

    checks.push(
      check(
        "n8nRepairsEmptyCanonicalChainAndLayout",
        repairedExecutableNodes
          .map((node) => node.name)
          .join("|") ===
          expectedChain.join("|") &&
          expectedChain.every(
            (name, index) =>
              JSON.stringify(
                repairedNodeByName.get(
                  name,
                )?.position,
              ) ===
                JSON.stringify([
                  index * 260,
                  0,
                ]) &&
              (
                index ===
                  expectedChain.length - 1
                  ? firstMainTarget(
                      repairedWorkflow.connections,
                      name,
                    ) === ""
                  : firstMainTarget(
                      repairedWorkflow.connections,
                      name,
                    ) ===
                    expectedChain[index + 1]
              ),
          ),
        "Empty connections must be rebuilt as the canonical recommended-node chain with deterministic 260px horizontal spacing and a terminal review node.",
      ),
      check(
        "n8nEnforcesCanonicalAdmissionsFieldsAndContext",
        repairedSampleValues
          ?.source_system ===
          "shared admissions Gmail inbox" &&
          repairedSampleValues
            ?.source_type === "gmail" &&
          [
            "applicant_name",
            "application_id",
            "course",
            "application_summary",
          ].every((field) =>
            repairedWorkflowText.includes(
              field,
            ),
          ) &&
          [
            "candidate_name",
            "role",
            "portfolio_link",
            "application_source",
          ].every(
            (field) =>
              !repairedWorkflowText.includes(
                field,
              ),
          ) &&
          repairedMeta?.domain ===
            "admissions" &&
          repairedMeta?.source ===
            "shared admissions Gmail inbox" &&
          repairedMeta?.human_owner ===
            "Jane Doe (admissions manager)" &&
          repairedMeta
            ?.approval_boundary ===
            approvalBoundary &&
          repairedMeta
            ?.external_action_boundary ===
            approvalBoundary,
        "The direct workflow must overwrite model-owned recruitment fields and generic context with the canonical admissions fields, source, Jane Doe owner, and exact boundaries.",
      ),
      check(
        "n8nCreatesTerminalReviewAndRepairsMeaninglessIf",
        repairedNodeByName.get(
          "Classify Application Priority",
        )?.type ===
          "n8n-nodes-base.code" &&
          repairedNodeByName.get(
            "Mark Pending Human Review",
          )?.type ===
            "n8n-nodes-base.set" &&
          repairedReviewValues
            ?.review_owner ===
            "Jane Doe (admissions manager)" &&
          repairedReviewValues
            ?.review_status ===
            "pending" &&
          repairedReviewValues
            ?.manual_review_required ===
            true &&
          repairedReviewValues
            ?.requires_human_approval ===
            true &&
          repairedReviewValues
            ?.draft_only === true &&
          repairedReviewValues
            ?.send_status ===
            "not_sent" &&
          repairedReviewValues
            ?.approval_boundary ===
            approvalBoundary &&
          repairedReviewValues
            ?.external_action_boundary ===
            approvalBoundary,
        "A meaningless classification If node must become canonical Code logic, and a missing safe pending-review Set node must be created with exact canonical review values.",
      ),
      check(
        "n8nRemovesImplementationBriefRootLeakage",
        repairedWorkflow.active ===
          false &&
          leakedRootFields.every(
            (field) =>
              !Object.hasOwn(
                repairedWorkflow,
                field,
              ),
          ) &&
          repairedWorkflow.nodes.every(
            (node) =>
              !/(?:gmail|emailSend|httpRequest|slack)/i.test(
                node.type,
              ) || node.disabled === true,
          ),
        "The downloadable workflow root must contain n8n fields rather than implementation-brief properties and must not contain enabled production connectors.",
      ),
      check(
        "n8nValidRepairedOpenAiStopsBeforeGroq",
        directRepairCalls.join(",") ===
          "openai" &&
          repairedDirectWorkflow.provider ===
            "openai" &&
          !repairedDirectWorkflow.fallback_used &&
          repairedDirectWorkflow
            .provider_attempts?.length ===
            1 &&
          repairedDirectWorkflow
            .provider_attempts[0]
            ?.success === true,
        "A repaired valid OpenAI direct workflow must succeed without calling Groq.",
      ),
    );

    const diagnosticSecret =
      "sk-diagnostic-secret-123456789";

    process.env.OPENAI_API_KEY =
      diagnosticSecret;

    const invalidValidationCalls:
      string[] = [];
    const invalidNodes = Array.from(
      { length: 6 },
      (_, index) => ({
        id: `invalid_${index}`,
        name:
          index === 0
            ? `Invalid ${diagnosticSecret}`
            : `Invalid ${index}`,
        type:
          index === 0
            ? diagnosticSecret
            : `unsupported.node.${index}`,
        typeVersion: 1,
        position: [index * 220, 0],
        parameters: {},
      }),
    );

    const detailedFallback =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              invalidValidationCalls.push(
                "openai",
              );
              return JSON.stringify({
                name:
                  "Invalid diagnostics draft",
                nodes: invalidNodes,
                connections: {},
                active: false,
              });
            },
            groq: async () => {
              invalidValidationCalls.push(
                "groq",
              );
              return validProviderResponse;
            },
          },
        },
      );

    const failedOpenAIAttempt =
      detailedFallback
        .provider_attempts?.[0];
    const validationDiagnosticsText =
      JSON.stringify({
        error:
          failedOpenAIAttempt
            ?.error_summary,
        issues:
          failedOpenAIAttempt
            ?.validation_issues,
        preview:
          failedOpenAIAttempt
            ?.raw_response_preview,
      });

    checks.push(
      check(
        "n8nValidationDiagnosticsAreDetailedBoundedAndSecretSafe",
        invalidValidationCalls.join(",") ===
          "openai,groq" &&
          detailedFallback.provider ===
            "groq" &&
          detailedFallback.fallback_used &&
          failedOpenAIAttempt
            ?.validation_issues?.length ===
            5 &&
          failedOpenAIAttempt
            .validation_issues[0]?.path ===
            "nodes.0.type" &&
          failedOpenAIAttempt
            .validation_issues[0]?.message
            .includes(
              "Unsupported n8n node type",
            ) === true &&
          failedOpenAIAttempt
            .error_summary?.includes(
              "nodes.0.type",
            ) === true &&
          (
            failedOpenAIAttempt
              .error_summary?.length ?? 0
          ) <= 800 &&
          (
            failedOpenAIAttempt
              .raw_response_preview?.length ??
            0
          ) <= 600 &&
          validationDiagnosticsText.includes(
            "[REDACTED]",
          ) &&
          !validationDiagnosticsText.includes(
            diagnosticSecret,
          ),
        "Validation failures must retain the first five issue paths and messages plus a bounded raw preview, while redacting secrets before Groq fallback succeeds.",
      ),
    );

    process.env.OPENAI_API_KEY =
      "test-openai-key";

    const fallbackCalls: string[] = [];
    const groqFallback =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              fallbackCalls.push("openai");
              throw new Error(
                "OpenAI exact test failure",
              );
            },
            groq: async () => {
              fallbackCalls.push("groq");
              return validProviderResponse;
            },
          },
        },
      );

    checks.push(
      check(
        "n8nUsesSuccessfulGroqFallback",
        fallbackCalls.join(",") ===
          "openai,groq" &&
          groqFallback.provider === "groq" &&
          groqFallback.fallback_used &&
          groqFallback.provider_attempts?.[0]
            ?.error_summary ===
            "OpenAI exact test failure" &&
          groqFallback.provider_attempts?.[1]
            ?.success === true,
        "A failed OpenAI attempt must remain visible when the dedicated Groq fallback succeeds.",
      ),
    );

    const openAISecret =
      "sk-test-openai-secret-123456789";
    const leakedAuthorizationValue =
      "sk-leaked-authorization-987654321";

    process.env.OPENAI_API_KEY =
      openAISecret;

    let totalFailure:
      N8nWorkflowGeneratorProvidersFailedError |
      null = null;

    try {
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          openaiFetch: async () =>
            openAIErrorResponse({
              message:
                `Unknown field 'mystery'. Authorization: Bearer ${leakedAuthorizationValue}. OPENAI_API_KEY=${openAISecret}`,
              type:
                "invalid_request_error",
              param: "mystery",
              code: "unknown_field",
            }),
          calls: {
            groq: async () => {
              throw new Error(
                "Groq exact total failure",
              );
            },
          },
        },
      );
    } catch (error) {
      if (
        error instanceof
        N8nWorkflowGeneratorProvidersFailedError
      ) {
        totalFailure = error;
      }
    }

    checks.push(
      check(
        "n8nPreservesSanitizedProviderAttemptsOnTotalFailure",
        totalFailure?.fallback_used === true &&
          totalFailure.provider_attempts.length ===
            2 &&
          totalFailure.provider_attempts[0]
            ?.provider === "openai" &&
          totalFailure.provider_attempts[0]
            ?.attempted === true &&
          totalFailure.provider_attempts[0]
            ?.success === false &&
          totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes(
              "Unknown field 'mystery'.",
            ) === true &&
          totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes(
              "type: invalid_request_error",
            ) === true &&
          totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes("param: mystery") ===
            true &&
          totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes(
              "code: unknown_field",
            ) === true &&
          totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes("[REDACTED]") ===
            true &&
          !totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes(openAISecret) &&
          !totalFailure.provider_attempts[0]
            ?.error_summary
            ?.includes(
              leakedAuthorizationValue,
            ) &&
          (
            totalFailure.provider_attempts[0]
              ?.error_summary?.length ?? 0
          ) <= 500 &&
          totalFailure.provider_attempts[1]
            ?.provider === "groq" &&
          totalFailure.provider_attempts[1]
            ?.attempted === true &&
          totalFailure.provider_attempts[1]
            ?.success === false &&
          totalFailure.provider_attempts[1]
            ?.error_summary ===
            "Groq exact total failure",
        "Total failure must preserve bounded OpenAI error fields and the Groq error while redacting API keys and Authorization values.",
      ),
    );

    delete process.env.OPENAI_API_KEY;
    process.env.GROQ_API_KEY =
      "general-groq-key-must-not-be-used";
    delete process.env.GROQ_N8N_API_KEY;

    const generalKeyCalls: string[] = [];
    let dedicatedKeyError:
      N8nWorkflowGeneratorConfigError |
      null = null;

    try {
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            groq: async () => {
              generalKeyCalls.push("groq");
              return validProviderResponse;
            },
          },
        },
      );
    } catch (error) {
      if (
        error instanceof
        N8nWorkflowGeneratorConfigError
      ) {
        dedicatedKeyError = error;
      }
    }

    process.env.GROQ_N8N_API_KEY =
      "dedicated-groq-key";

    const dedicatedKeyCalls: string[] = [];
    const dedicatedGroqSuccess =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            groq: async () => {
              dedicatedKeyCalls.push("groq");
              return validProviderResponse;
            },
          },
        },
      );

    checks.push(
      check(
        "n8nUsesOnlyDedicatedGroqKey",
        generalKeyCalls.length === 0 &&
          dedicatedKeyError
            ?.provider_attempts[1]
            ?.error_summary ===
            "GROQ_N8N_API_KEY is not configured." &&
          dedicatedKeyCalls.join(",") ===
            "groq" &&
          dedicatedGroqSuccess.provider ===
            "groq" &&
          !dedicatedGroqSuccess.fallback_used &&
          dedicatedGroqSuccess.provider_attempts?.[0]
            ?.attempted === false,
        "The general GROQ_API_KEY must not configure n8n generation; only GROQ_N8N_API_KEY may enable Groq.",
      ),
    );
    // ─── Fixture: Sticky Note sample node + missing sample set repair ────────
    // Verifies 7 quality improvements in a single agent run:
    //  1. Manual trigger parameters stripped to {}
    //  2. Deterministic layout at y=0 for executable chain
    //  3. Repaired sample set node gets synthetic values from samplePayloadForInput
    //  4. Extract node name is preserved (not renamed to Normalize)
    //  5. Admissions classifier emits high / needs_manual_review triage
    //  6. Set nodes have typeVersion 1
    //  7. A sticky note named Sample… is ignored; graph repair inserts a set node
    const validationFixesResult =
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => JSON.stringify({
              name: "Validation Fixes Test",
              nodes: [
                {
                  id: "trigger",
                  name: "Manual Start",
                  type: "n8n-nodes-base.manualTrigger",
                  typeVersion: 1,
                  position: [33, 44],
                  // This param must be stripped to {}:
                  parameters: { someParam: "shouldBeRemoved" },
                },
                {
                  // A sticky note whose name starts with "Sample" must NOT
                  // become the canonical sample-data set node:
                  id: "sample_sticky",
                  name: "Sample Admissions Application",
                  type: "n8n-nodes-base.stickyNote",
                  typeVersion: 1,
                  position: [111, -222],
                  parameters: { content: "Sample Data" },
                },
                {
                  id: "extract",
                  name: "Extract Applicant Fields",
                  type: "n8n-nodes-base.code",
                  typeVersion: 1,
                  position: [555, 666],
                  parameters: {},
                },
                {
                  id: "classify",
                  name: "Classify Application Priority",
                  type: "n8n-nodes-base.code",
                  typeVersion: 1,
                  position: [777, 888],
                  parameters: {},
                },
                {
                  id: "review",
                  name: "Mark Pending Human Review",
                  type: "n8n-nodes-base.set",
                  typeVersion: 1,
                  position: [999, 0],
                  parameters: {},
                },
              ],
              connections: {
                "Manual Start": {
                  main: [[{ node: "Extract Applicant Fields", type: "main", index: 0 }]],
                },
                "Extract Applicant Fields": {
                  main: [[{ node: "Classify Application Priority", type: "main", index: 0 }]],
                },
                "Classify Application Priority": {
                  main: [[{ node: "Mark Pending Human Review", type: "main", index: 0 }]],
                },
              },
              active: false,
            }),
            groq: async () => validProviderResponse,
          },
        },
      );

    // OpenAI must succeed without Groq fallback.
    const openAISucceeded =
      validationFixesResult.provider === "openai" &&
      !validationFixesResult.fallback_used;

    const valWorkflow = validationFixesResult.workflow_json;
    const vfTriggerNode = valWorkflow.nodes.find(
      (n) => n.type === "n8n-nodes-base.manualTrigger",
    ) as Record<string, unknown> | undefined;
    const vfStickyNode = valWorkflow.nodes.find(
      (n) => n.type === "n8n-nodes-base.stickyNote",
    ) as Record<string, unknown> | undefined;
    // Graph repair inserts a sample Set node because the sticky-note is ignored:
    const vfSampleSetNode = valWorkflow.nodes.find(
      (n) =>
        n.type === "n8n-nodes-base.set" &&
        n.name.toLowerCase().includes("sample"),
    ) as Record<string, unknown> | undefined;
    const vfExtractNode = valWorkflow.nodes.find(
      (n) => String(n.name).includes("Extract Applicant"),
    ) as Record<string, unknown> | undefined;
    const vfClassifyNode = valWorkflow.nodes.find(
      (n) => String(n.name).includes("Classify Application"),
    ) as Record<string, unknown> | undefined;

    const vfTriggerPos = vfTriggerNode?.position as number[] | undefined;
    const vfExtractPos = vfExtractNode?.position as number[] | undefined;

    checks.push(
      check(
        "n8nNormalizesManualTriggerParameters",
        openAISucceeded &&
          vfTriggerNode !== undefined &&
          Object.keys(
            (vfTriggerNode.parameters as Record<string, unknown>) || {},
          ).length === 0,
        "Manual trigger parameters must be normalized to empty {}.",
      ),
      check(
        "n8nAppliesDeterministicLayout",
        openAISucceeded &&
          vfTriggerPos?.[0] === 0 &&
          vfTriggerPos?.[1] === 0 &&
          Array.isArray(vfExtractPos) &&
          (vfExtractPos[1] as number) === 0,
        "Executable chain nodes must land at y=0 with 260px horizontal spacing.",
      ),
      check(
        "n8nGeneratesSyntheticSampleValues",
        openAISucceeded &&
          vfSampleSetNode !== undefined &&
          JSON.stringify(
            vfSampleSetNode.parameters || {},
          ).includes("Alex Example"),
        "The repaired sample Set node must contain recognizable synthetic field data.",
      ),
      check(
        "n8nPreservesCanonicalExtractionNodeName",
        openAISucceeded &&
          vfExtractNode !== undefined &&
          String(vfExtractNode.name) === "Extract Applicant Fields" &&
          String(vfExtractNode.notes ?? "").includes(
            "Normalizes pre-extracted",
          ),
        "Extract nodes must keep their original name and receive an explanatory note.",
      ),
      check(
        "n8nAdmissionsClassificationSupportsHighPriority",
        openAISucceeded &&
          JSON.stringify(
            vfClassifyNode?.parameters || {},
          ).includes("needs_manual_review") &&
          JSON.stringify(
            vfClassifyNode?.parameters || {},
          ).includes("high"),
        "Admissions classifier must emit both 'high' and 'needs_manual_review' triage values.",
      ),
      check(
        "n8nEnforcesSetNodeCompatibility",
        openAISucceeded && vfSampleSetNode?.typeVersion === 1,
        "Set nodes must use the compatible typeVersion 1 format.",
      ),
      check(
        "n8nRepairsMissingSampleNodeGracefully",
        openAISucceeded &&
          vfStickyNode !== undefined &&
          vfSampleSetNode !== undefined,
        "A sticky note named Sample… must be ignored; graph repair must insert an executable sample Set node.",
      ),
    );
  } finally {
    restoreProviderEnvironment(
      savedEnvironment,
    );
  }

  return checks;
}
