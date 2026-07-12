import type { ZodIssue } from "zod";
import { compileJobSchema } from "../schemas/compileJob.schema";
import { safeAutomationBlueprintSchema } from "../schemas/workflow.schema";
import type { CompileJob } from "../../shared/types/compileJob";
import type { SafeAutomationBlueprint } from "../../shared/types/workflow";

export type SchemaValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export type SafeSchemaValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      issues: SchemaValidationIssue[];
    };

export type FixtureValidationCheck = {
  name: string;
  success: boolean;
  issues: SchemaValidationIssue[];
};

export type FixtureValidationSummary = {
  success: boolean;
  checks: FixtureValidationCheck[];
};

type RuntimeProcess = {
  argv: string[];
  exitCode?: number;
};

function formatIssuePath(path: ZodIssue["path"]): string {
  return path.length > 0 ? path.map(String).join(".") : "(root)";
}

function formatIssues(issues: ZodIssue[]): SchemaValidationIssue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

export function validateBlueprint(input: unknown): SafeAutomationBlueprint {
  return safeAutomationBlueprintSchema.parse(input);
}

export function safeValidateBlueprint(input: unknown): SafeSchemaValidationResult<SafeAutomationBlueprint> {
  const result = safeAutomationBlueprintSchema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    issues: formatIssues(result.error.issues),
  };
}

export function validateCompileJob(input: unknown): CompileJob {
  return compileJobSchema.parse(input);
}

export function safeValidateCompileJob(input: unknown): SafeSchemaValidationResult<CompileJob> {
  const result = compileJobSchema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    issues: formatIssues(result.error.issues),
  };
}

export async function validateFixtures(): Promise<FixtureValidationSummary> {
  const [
    { validBlueprint },
    { invalidBlueprint },
    { validCompileJob },
    { buildPipelineRegressionChecks },
    { buildN8nGeneratorRegressionChecks },
    { buildExecutionJourneyRegressionChecks },
  ] = await Promise.all([
    import("../fixtures/validBlueprint"),
    import("../fixtures/invalidBlueprint"),
    import("../fixtures/validCompileJob"),
    import("../fixtures/pipelineRegression"),
    import("../fixtures/n8nGeneratorRegression"),
    import("../fixtures/executionJourneyRegression"),
  ]);

  const validBlueprintResult = safeValidateBlueprint(validBlueprint);
  const invalidBlueprintResult = safeValidateBlueprint(invalidBlueprint);
  const validCompileJobResult = safeValidateCompileJob(validCompileJob);
  const pipelineRegressionChecks = await buildPipelineRegressionChecks();
  const n8nGeneratorRegressionChecks = await buildN8nGeneratorRegressionChecks();
  const executionJourneyRegressionChecks = await buildExecutionJourneyRegressionChecks();

  const invalidFixtureIssues =
    invalidBlueprintResult.success
      ? [
          {
            path: "(root)",
            message: "Invalid blueprint fixture unexpectedly passed validation.",
            code: "fixture_expected_failure",
          },
        ]
      : invalidBlueprintResult.issues;

  const checks: FixtureValidationCheck[] = [
    {
      name: "validBlueprint",
      success: validBlueprintResult.success,
      issues: validBlueprintResult.success ? [] : validBlueprintResult.issues,
    },
    {
      name: "invalidBlueprint",
      success: !invalidBlueprintResult.success,
      issues: invalidFixtureIssues,
    },
    {
      name: "validCompileJob",
      success: validCompileJobResult.success,
      issues: validCompileJobResult.success ? [] : validCompileJobResult.issues,
    },
    ...pipelineRegressionChecks,
    ...n8nGeneratorRegressionChecks,
    ...executionJourneyRegressionChecks,
  ];

  return {
    success: checks.every((check) => check.success),
    checks,
  };
}

function getRuntimeProcess(): RuntimeProcess | undefined {
  return (globalThis as typeof globalThis & { process?: RuntimeProcess }).process;
}

function isDirectRun(): boolean {
  const entry = getRuntimeProcess()?.argv[1];

  if (!entry) {
    return false;
  }

  return entry.endsWith("server/services/schemaValidator.ts");
}

function printFixtureValidationSummary(summary: FixtureValidationSummary): void {
  for (const check of summary.checks) {
    const label = check.success ? "PASS" : "FAIL";
    console.log(`${label} ${check.name}`);

    if (check.issues.length > 0) {
      for (const issue of check.issues) {
        console.log(`  - ${issue.path}: ${issue.message} (${issue.code})`);
      }
    }
  }
}

if (isDirectRun()) {
  validateFixtures()
    .then((summary) => {
      printFixtureValidationSummary(summary);

      if (!summary.success) {
        const runtimeProcess = getRuntimeProcess();

        if (runtimeProcess) {
          runtimeProcess.exitCode = 1;
        }
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      const runtimeProcess = getRuntimeProcess();

      if (runtimeProcess) {
        runtimeProcess.exitCode = 1;
      }
    });
}
