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
  } finally {
    restoreProviderEnvironment(
      savedEnvironment,
    );
  }

  return checks;
}
