import { z } from "zod";
import type {
  CompileInput,
  CompileJob,
  CompileJobStatus,
  CompileMode,
  PipelineStep,
  PipelineStepStatus,
  TokenUsage,
} from "../../shared/types/compileJob";
import type {
  AgentTraceActor,
  AgentTraceEvent,
  AgentTraceStatus,
} from "../../shared/types/agentTrace";
import {
  automationReadinessScoreSchema,
  riskSummarySchema,
  safeAutomationBlueprintSchema,
  signalSummarySchema,
} from "./workflow.schema";
import { routerDecisionSchema } from "./router.schema";

const requiredString = z.string().min(1, "Required string cannot be empty.");

export const compileModeSchema = z.enum([
  "demo",
  "rule_only",
  "balanced",
  "full",
]) satisfies z.ZodType<CompileMode>;

export const compileJobStatusSchema = z.enum([
  "queued",
  "running",
  "needs_user",
  "done",
  "failed",
]) satisfies z.ZodType<CompileJobStatus>;

export const pipelineStepStatusSchema = z.enum([
  "queued",
  "running",
  "done",
  "skipped",
  "failed",
]) satisfies z.ZodType<PipelineStepStatus>;

export const pipelineStepSchema = z
  .object({
    id: requiredString,
    label: requiredString,
    description: requiredString,
    status: pipelineStepStatusSchema,
    tool_name: requiredString.optional(),
    output_summary: requiredString.optional(),
    token_cost: z.number().nonnegative().optional(),
  })
  .strict() satisfies z.ZodType<PipelineStep>;

export const tokenUsageSchema = z
  .object({
    mode: compileModeSchema,
    llm_calls_used: z.number().int().nonnegative(),
    llm_calls_limit: z.number().int().nonnegative(),
    estimated_input_tokens: z.number().int().nonnegative(),
    rule_based_checks: z.number().int().nonnegative(),
    skipped_ai_calls: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<TokenUsage>;

export const compileInputSchema = z
  .object({
    raw: z.string(),
    trimmed: requiredString,
  })
  .strict() satisfies z.ZodType<CompileInput>;

export const agentTraceActorSchema = z.enum([
  "compiler_agent",
  "tool",
  "llm",
  "system",
]) satisfies z.ZodType<AgentTraceActor>;

export const agentTraceStatusSchema = z.enum([
  "started",
  "completed",
  "failed",
  "skipped",
]) satisfies z.ZodType<AgentTraceStatus>;

export const agentTraceEventSchema = z
  .object({
    id: requiredString,
    timestamp: requiredString,
    actor: agentTraceActorSchema,
    action: requiredString,
    status: agentTraceStatusSchema,
    tool_name: requiredString.optional(),
    input_summary: requiredString.optional(),
    output_summary: requiredString.optional(),
    reason: requiredString.optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict() satisfies z.ZodType<AgentTraceEvent>;

export const compileJobSchema = z
  .object({
    id: requiredString,
    status: compileJobStatusSchema,
    mode: compileModeSchema,
    created_at: requiredString,
    updated_at: requiredString,
    input: compileInputSchema,
    steps: z.array(pipelineStepSchema),
    signals: signalSummarySchema,
    risks: riskSummarySchema,
    readiness: automationReadinessScoreSchema,
    router_decision: routerDecisionSchema.optional(),
    result: safeAutomationBlueprintSchema,
    agent_trace: z.array(agentTraceEventSchema),
    token_usage: tokenUsageSchema,
    error: requiredString.optional(),
  })
  .strict() satisfies z.ZodType<CompileJob>;
