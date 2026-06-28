export type N8nWorkflowPosition = [number, number];

export type N8nWorkflowNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: N8nWorkflowPosition;
  parameters: Record<string, unknown>;
  disabled?: boolean;
  credentials?: Record<string, unknown>;
  notes?: string;
  notesInFlow?: boolean;
  [key: string]: unknown;
};

export type N8nWorkflow = {
  name?: string;
  nodes: N8nWorkflowNode[];
  connections: Record<string, unknown>;
  active?: boolean;
  settings?: Record<string, unknown>;
  tags?: unknown[];
  meta?: Record<string, unknown>;
  [key: string]: unknown;
};

export type N8nGenerateRequest = {
  compile_job: unknown;
  implementation_prompt: string;
};

export type CompactN8nWorkflowStep = {
  label: string;
  description: string;
  primitive: string;
  automation_policy: string;
  real_world_execution: string;
};

export type CompactN8nGenerationInput = {
  original_request: string;
  workflow_name: string;
  blueprint_summary: string;
  safety_status: string;
  safety_summary: string;
  next_safe_action: string;
  risk_level?: string;
  readiness_score?: number;
  workflow_steps: CompactN8nWorkflowStep[];
  human_approval_gates: string[];
  blocked_or_not_safe_actions: string[];
  warnings: string[];
};

export type N8nGenerateResponse = {
  workflow_json: N8nWorkflow;
  warnings: string[];
  provider: "groq";
  used_ai: boolean;
  fallback_used: boolean;
};
