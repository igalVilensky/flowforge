import { z } from "zod";
import type { RouterDecision } from "../../shared/types/compileJob";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const routerDecisionSchema = z
  .object({
    route: z.enum([
      "compile_blueprint",
      "needs_clarification",
      "suggest_safer_workflow",
      "assistant_only",
      "reject",
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    reason: requiredString,
    safety_note: requiredString,
    suggested_next_step: requiredString,
    provider: z.enum(["openai", "groq", "gemini", "deterministic"]),
    used_ai: z.boolean(),
    fallback_used: z.boolean(),
  })
  .strict() satisfies z.ZodType<RouterDecision>;
