export type AgentTraceActor = "compiler_agent" | "tool" | "llm" | "system";

export type AgentTraceStatus = "started" | "completed" | "failed" | "skipped";

export type AgentTraceEvent = {
  id: string;
  timestamp: string;
  actor: AgentTraceActor;
  action: string;
  status: AgentTraceStatus;
  tool_name?: string;
  input_summary?: string;
  output_summary?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean>;
};
