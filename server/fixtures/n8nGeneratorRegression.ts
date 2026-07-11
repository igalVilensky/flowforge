import process from "node:process";
import type { CompileJob } from "../../shared/types/compileJob";
import type { FixtureValidationCheck } from "../services/schemaValidator";
import { validCompileJob } from "./validCompileJob";
import { buildN8nImplementationBrief } from "../services/n8nImplementationBriefBuilder";
import {
  N8nWorkflowGeneratorConfigError,
  N8nWorkflowGeneratorProvidersFailedError,
  runN8nWorkflowGeneratorAgent,
} from "../services/n8nWorkflowGeneratorAgent";
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
  GROQ_API_KEY?: string;
  GROQ_N8N_API_KEY?: string;
};

function saveProviderEnvironment(): SavedProviderEnvironment {
  return {
    OPENAI_API_KEY:
      process.env.OPENAI_API_KEY,
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
  ];

  try {
    process.env.OPENAI_API_KEY =
      "test-openai-key";
    process.env.GROQ_N8N_API_KEY =
      "test-n8n-groq-key";

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

    let totalFailure:
      N8nWorkflowGeneratorProvidersFailedError |
      null = null;

    try {
      await runN8nWorkflowGeneratorAgent(
        { compileJob },
        {
          calls: {
            openai: async () => {
              throw new Error(
                "OpenAI exact total failure",
              );
            },
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
        "n8nPreservesProviderAttemptsOnTotalFailure",
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
            ?.error_summary ===
            "OpenAI exact total failure" &&
          totalFailure.provider_attempts[1]
            ?.provider === "groq" &&
          totalFailure.provider_attempts[1]
            ?.attempted === true &&
          totalFailure.provider_attempts[1]
            ?.success === false &&
          totalFailure.provider_attempts[1]
            ?.error_summary ===
            "Groq exact total failure",
        "Total failure must preserve ordered OpenAI and Groq attempt details and exact error summaries.",
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
