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

Your job is to critique a proposed automation blueprint and explain the main safety risks clearly.

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

Keep the JSON compact.
Return at most 3 concerns.
Use short strings.

The JSON must match this exact shape:

{
  "critic_summary": "short critique summary",
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
  "safer_alternative": "safe internal or human-reviewed version",
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
- Generated replies, emails, notifications, and messages must stay draft-only unless explicitly human-approved.
- Refunds, payments, account changes, employment decisions, and external communication require human approval.
- Legal decisions, medical advice, visa or immigration decisions, account access changes, deletion, cancellation, or destructive actions are blocked or not recommended for the MVP.
- If the request is vague, raise a needs_clarification concern.
- Always recommend the safest useful alternative.
- Never say FlowForge can execute production actions.
- Never say automatic sending, refunding, deleting, account updating, or high-stakes decisions are safe.`;

function compactStep(step: SafeAutomationBlueprint["steps"][number]) {
    return {
        id: step.id,
        label: step.label,
        primitive: step.primitive,
        automation_policy: step.automation_policy,
        approval_required: step.approval_required,
        risk_level: step.risk_level,
        risk_categories: step.risk_categories,
    };
}

function compactGate(gate: SafeAutomationBlueprint["human_approval_gates"][number]) {
    return {
        id: gate.id,
        label: gate.label,
        applies_to_step_ids: gate.applies_to_step_ids,
        reason: gate.reason,
    };
}

function compactRisk(risk: SafeAutomationBlueprint["risks"][number]) {
    return {
        id: risk.id,
        label: risk.label,
        category: risk.category,
        risk_level: risk.risk_level,
        step_ids: risk.step_ids,
    };
}

function compactBlueprintArchitectOutput(output?: BlueprintArchitectOutput) {
    if (!output) {
        return null;
    }

    return {
        provider: output.provider,
        used_ai: output.used_ai,
        status: output.status,
        workflow_name: output.workflow_name,
        summary: output.summary,
        proposed_step_count: output.proposed_steps.length,
        proposed_gate_count: output.proposed_human_approval_gates.length,
        proposed_risk_count: output.proposed_risks.length,
        must_remain_draft_only: output.must_remain_draft_only.slice(0, 3),
        requires_human_approval: output.requires_human_approval.slice(0, 3),
        blocked_or_not_recommended: output.blocked_or_not_recommended.slice(0, 3),
        safer_alternative: output.safer_alternative,
    };
}

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
    const blueprint = input.deterministicBlueprint;

    return JSON.stringify(
        {
            task: "Critique this non-executing automation blueprint proposal. Keep response compact.",
            process_input: input.processInput.slice(0, 900),
            router_decision: {
                route: input.routerDecision.route,
                confidence: input.routerDecision.confidence,
                reason: input.routerDecision.reason,
                safety_note: input.routerDecision.safety_note,
            },
            signal_summary: {
                has_trigger: input.signals.has_trigger,
                has_external_action: input.signals.has_external_action,
                has_sensitive_data: input.signals.has_sensitive_data,
                has_clear_output: input.signals.has_clear_output,
                has_decision_points: input.signals.has_decision_points,
                has_human_actor: input.signals.has_human_actor,
                risk_flags: input.signals.risk_flags,
                missing_critical_info: input.signals.missing_critical_info.slice(0, 5),
                workflow_primitives: input.signals.workflow_primitives,
            },
            risk_summary: {
                risk_level: input.risks.risk_level,
                requires_human_review: input.risks.requires_human_review,
                categories: input.risks.categories,
                reasons: input.risks.reasons.slice(0, 5),
            },
            readiness: {
                score: input.readiness.score,
                strengths: input.readiness.strengths.slice(0, 3),
                weaknesses: input.readiness.weaknesses.slice(0, 3),
            },
            clarification_plan: {
                needed: input.clarificationPlan.needed,
                missing_fields: input.clarificationPlan.missing_fields,
                question_count: input.clarificationPlan.questions.length,
            },
            deterministic_blueprint_summary: {
                workflow_name: blueprint.workflow_name,
                summary: blueprint.summary,
                automation_boundary: blueprint.automation_boundary,
                step_count: blueprint.steps.length,
                gate_count: blueprint.human_approval_gates.length,
                risk_count: blueprint.risks.length,
                steps: blueprint.steps.slice(0, 8).map(compactStep),
                human_approval_gates: blueprint.human_approval_gates.slice(0, 5).map(compactGate),
                risks: blueprint.risks.slice(0, 5).map(compactRisk),
                safe_to_automate: blueprint.safe_to_automate.slice(0, 5),
                needs_human_approval: blueprint.needs_human_approval.slice(0, 5),
                not_recommended: blueprint.not_recommended.slice(0, 5),
                not_safe_to_automate: blueprint.not_safe_to_automate.slice(0, 5),
                open_questions: blueprint.open_questions.slice(0, 5),
            },
            blueprint_architect_output: compactBlueprintArchitectOutput(input.blueprintArchitectOutput),
            output_requirements: {
                return_json_only: true,
                max_concerns: 3,
                final_safety_guard_will_decide: true,
                critique_only: true,
            },
        },
        null,
        2,
    );
}