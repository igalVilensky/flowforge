import { z } from "zod";
import type { N8nGenerateResponse } from "../../shared/types/n8nWorkflow";
import { compileJobSchema } from "../schemas/compileJob.schema";
import {
  N8nWorkflowGeneratorConfigError,
  N8nWorkflowGeneratorProviderLimitError,
  N8nWorkflowGeneratorValidationError,
  runN8nWorkflowGeneratorAgent,
} from "../services/n8nWorkflowGeneratorAgent";

const n8nGenerateRequestSchema = z
  .object({
    compile_job: compileJobSchema,
    implementation_prompt: z.string().min(1),
  })
  .strict();

export default defineEventHandler(async (event): Promise<N8nGenerateResponse> => {
  const body = await readBody<unknown>(event);
  const parsed = n8nGenerateRequestSchema.safeParse(body);

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: "n8n generation request must include a valid compile_job and implementation_prompt.",
      data: parsed.error.flatten(),
    });
  }

  const compileJob = parsed.data.compile_job;
  const safetyStatus = compileJob.safety_critic?.overall_status;

  if (compileJob.status !== "done") {
    throw createError({
      statusCode: 400,
      statusMessage: "n8n JSON drafts can only be generated from completed compile jobs.",
    });
  }

  if (safetyStatus === "not_safe_to_automate" || safetyStatus === "needs_clarification") {
    throw createError({
      statusCode: 400,
      statusMessage: "n8n JSON drafts can only be generated for reviewed safe or human-gated blueprints.",
    });
  }

  try {
    return await runN8nWorkflowGeneratorAgent({
      compileJob,
    });
  } catch (error) {
    if (error instanceof N8nWorkflowGeneratorConfigError) {
      throw createError({
        statusCode: 503,
        statusMessage: error.message,
      });
    }

    if (error instanceof N8nWorkflowGeneratorProviderLimitError) {
      throw createError({
        statusCode: 413,
        statusMessage: error.message,
      });
    }

    if (error instanceof N8nWorkflowGeneratorValidationError) {
      throw createError({
        statusCode: 422,
        statusMessage: error.message,
        data: {
          issues: error.issues,
        },
      });
    }

    throw createError({
      statusCode: 502,
      statusMessage: "n8n JSON generation failed. Try again with a shorter workflow or check provider configuration.",
      data: {
        detail: error instanceof Error ? error.message : "Unknown provider error.",
      },
    });
  }
});
