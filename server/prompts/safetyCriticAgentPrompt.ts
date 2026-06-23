import type { BlueprintArchitectOutput } from "../../shared/types/agentOutputs";
import type {
    ClarificationPlan,
    RouterDecision,
} from "../../shared/types/compileJob";
import type {
    AutomationReadinessScore,
    RiskSummary,
    SafeAutomationBlueprint,
    SignalSummary,
} from "../../shared/types/workflow";

export const safetyCriticAgentSystemPrompt = `You are the FlowForge Safety Critic Agent.

Your job is to critique a proposed automation blueprint and explain risks clearly.

You do not decide the final safety status.
You do not execute anything.
You do not approve automatic real-world actions.
You do not override deterministic safety rules.
You do not remove required human approval gates.
You do not downgrade blockers.

The deterministic Safety Guard will make the final decision after your critique.

Return only valid JSON.
Do not include Markdown.
Do not include commentary outside JSON.

The JSON must match this shape:

{
  "critic_summary": "short plain-English critique summary",
  "concerns": [
    {
      "id": "stable_snake_case_id",
      "type": "human_approval_required",
      "severity": "warning",
      "title": "short concern title",
      "explanation": "why this concern matters",
      "recommendation": "safe recommendation",
      "related_step_ids": ["step_id"],
      "related_risk_ids": ["risk_id"],
      "related_gate_ids": ["gate_id"]
    }
  ],
  "recommended_human_gates": ["specific approval gate"],
  "draft_only_warnings": ["specific draft-only warning"],
  "blocked_or_not_recommended": ["specific blocked or not recommended action"],
  "safer_alternative": "safe internal or human-reviewed version of the workflow",
  "final_advice": "what the user should do next"
}

Allowed concern type values:
- safe_to_automate
- draft_only
- human_approval_required
- blocked_in_mvp
- needs_clarification
- implementation_warning

Allowed severity values:
- info
- warning
- blocker

Rules:
- Treat generated replies, emails, notifications, and messages as draft-only unless explicitly human-approved.
- Treat refunds, payments, account changes, employment decisions, and external communication as human-approval required.
- Treat legal decisions, medical advice or diagnosis, visa/immigration decisions, account access changes, deletion, cancellation, or destructive actions as blocked or not recommended for the MVP.
- If the request is vague, raise needs_clarification concerns.
- Always recommend the safest useful alternative.
- Never say that FlowForge can execute production actions.
- Never say that automatic sending, refunding, deleting, account updating, or high-stakes decisions are safe.`;

export function buildSafetyCriticAgentUserPrompt(input: {
    processInput: string;
    signals: SignalSummary;
    risks: RiskSummary;
    readiness: AutomationReadinessScore;
    routerDecision: RouterDecision;
    clarificationPlan: ClarificationPlan;
    deterministicBlueprint: SafeAutomationBlueprint;
    blueprintArchitectOutput?: BlueprintArchitectOutput;
}): string {
    return JSON.stringify(
        {
            task: "Critique this non-executing automation blueprint proposal.",
            process_input: input.processInput,
            router_decision: input.routerDecision,
            signal_summary: {
                has_trigger: input.signals.has_trigger,
                has_external_action: input.signals.has_external_action,
                has_sensitive_data: input.signals.has_sensitive_data,
                has_clear_output: input.signals.has_clear_output,
                has_decision_points: input.signals.has_decision_points,
                has_human_actor: input.signals.has_human_actor,
                risk_flags: input.signals.risk_flags,
                missing_critical_info: input.signals.missing_critical_info,
                workflow_primitives: input.signals.workflow_primitives,
            },
            risk_summary: {
                risk_level: input.risks.risk_level,
                requires_human_review: input.risks.requires_human_review,
                categories: input.risks.categories,
            },
            readiness: input.readiness,
            clarification_plan: input.clarificationPlan,
            deterministic_blueprint: {
                workflow_name: input.deterministicBlueprint.workflow_name,
                summary: input.deterministicBlueprint.summary,
                automation_boundary: input.deterministicBlueprint.automation_boundary,
                steps: input.deterministicBlueprint.steps,
                human_approval_gates: input.deterministicBlueprint.human_approval_gates,
                risks: input.deterministicBlueprint.risks,
                safe_to_automate: input.deterministicBlueprint.safe_to_automate,
                needs_human_approval: input.deterministicBlueprint.needs_human_approval,
                not_recommended: input.deterministicBlueprint.not_recommended,
                not_safe_to_automate: input.deterministicBlueprint.not_safe_to_automate,
                assumptions: input.deterministicBlueprint.assumptions,
                open_questions: input.deterministicBlueprint.open_questions,
            },
            blueprint_architect_output: input.blueprintArchitectOutput ?? null,
            output_requirements: {
                return_json_only: true,
                final_safety_guard_will_decide: true,
                critique_only: true,
            },
        },
        null,
        2,
    );
}