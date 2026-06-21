export const readinessBaseScore = 50;

export const readinessBonuses = {
  clear_trigger: 10,
  clear_output: 10,
  decision_points: 8,
  workflow_primitives: 8,
  system_actor: 6,
  repeated_process: 6,
} as const;

export const readinessPenalties = {
  missing_critical_info: 10,
  external_action: 10,
  sensitive_data: 15,
  real_world_execution: 20,
  high_risk: 20,
} as const;
