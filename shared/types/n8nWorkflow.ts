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

export type N8nAllowedNodeType =
  | "n8n-nodes-base.manualTrigger"
  | "n8n-nodes-base.scheduleTrigger"
  | "n8n-nodes-base.set"
  | "n8n-nodes-base.code"
  | "n8n-nodes-base.if"
  | "n8n-nodes-base.stickyNote";

export type N8nImplementationBrief = {
  workflow_goal: string;
  trigger_description: string;

  /**
   * Human-readable safe representation of the real source.
   * The generated draft still uses a manual or sample trigger rather
   * than connecting production credentials.
   */
  source: string;
  source_type: string;
  source_is_placeholder: boolean;

  domain: "admissions" | "support" | "finance" | "marketing" | "generic";

  extracted_fields: string[];
  classification_target: string;
  classification_rules: string[];
  internal_outputs: string[];

  human_owner: string;
  human_approval_gates: string[];
  approval_boundary: string;
  external_action_boundary: string;

  blocked_or_not_safe_actions: string[];
  warnings: string[];
  recommended_nodes: string[];
};

export type CompactN8nGenerationInput =
  N8nImplementationBrief & {
    original_request: string;
    workflow_name: string;
    blueprint_summary: string;
    safety_status: string;
    safety_summary: string;
    next_safe_action: string;
    risk_level?: string;
    readiness_score?: number;
  };

export type N8nGeneratorProvider =
  | "openai"
  | "groq"
  | "deterministic";

export type N8nGenerateResponse = {
  workflow_json: N8nWorkflow;
  warnings: string[];
  provider: N8nGeneratorProvider;
  used_ai: boolean;
  fallback_used: boolean;
  provider_attempts?: Array<{
    provider: "openai" | "groq";
    attempted: boolean;
    success: boolean;
    error_summary?: string;
  }>;
};