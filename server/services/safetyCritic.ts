import type {
    ClarificationPlan,
    RouterDecision,
    SafetyCriticFinding,
    SafetyCriticFindingType,
    SafetyCriticReview,
    SafetyCriticSeverity,
} from "../../shared/types/compileJob";
import type {
    AutomationReadinessScore,
    HumanApprovalGate,
    RiskCategory,
    RiskItem,
    RiskSummary,
    SafeAutomationBlueprint,
    SignalSummary,
    WorkflowStep,
} from "../../shared/types/workflow";

export type BuildSafetyCriticReviewInput = {
    signals: SignalSummary;
    risks: RiskSummary;
    readiness: AutomationReadinessScore;
    routerDecision?: RouterDecision;
    clarificationPlan?: ClarificationPlan;
    blueprint: SafeAutomationBlueprint;
};

/**
 * Hard blockers are cases the MVP should not turn into automation even with gates.
 * Refund/payment/financial/external communication are intentionally NOT here:
 * those should become human-approval workflows, not blanket "do not automate".
 */
const HARD_BLOCKED_CATEGORIES: RiskCategory[] = [
    "legal",
    "medical",
    "visa_or_immigration",
    "delete_or_destructive_action",
];

const HUMAN_APPROVAL_CATEGORIES: RiskCategory[] = [
    "financial",
    "refund_or_payment",
    "employment",
    "external_communication",
    "personal_data",
    "account_access",
    "high_stakes_decision",
    "real_world_execution",
];

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function stepIdsByPolicy(steps: WorkflowStep[], policies: WorkflowStep["automation_policy"][]): string[] {
    return steps
        .filter((step) => policies.includes(step.automation_policy))
        .map((step) => step.id);
}

function stepIdsByExecutionPolicy(steps: WorkflowStep[], policies: WorkflowStep["real_world_execution"][]): string[] {
    return steps
        .filter((step) => policies.includes(step.real_world_execution))
        .map((step) => step.id);
}

function riskIdsByCategories(risks: RiskItem[], categories: RiskCategory[]): string[] {
    return risks
        .filter((risk) => categories.includes(risk.category))
        .map((risk) => risk.id);
}

function requiredGateIds(gates: HumanApprovalGate[]): string[] {
    return gates.filter((gate) => gate.required).map((gate) => gate.id);
}

function hasDraftOnlySteps(blueprint: SafeAutomationBlueprint): boolean {
    return blueprint.steps.some((step) =>
        step.automation_policy === "draft_only"
        || step.primitive === "drafting"
        || step.primitive === "notification"
        || step.real_world_execution === "draft_only",
    );
}

function hasExplicitlyBlockedSteps(blueprint: SafeAutomationBlueprint): boolean {
    return blueprint.steps.some((step) =>
        step.automation_policy === "blocked_in_mvp"
        || step.automation_policy === "not_recommended"
        || step.real_world_execution === "blocked_in_mvp",
    );
}

function hasHardBlockedRisk(blueprint: SafeAutomationBlueprint, risks: RiskSummary): boolean {
    return risks.categories.some((category) => HARD_BLOCKED_CATEGORIES.includes(category))
        || blueprint.risks.some((risk) => HARD_BLOCKED_CATEGORIES.includes(risk.category));
}

function hasHumanApprovalRisk(blueprint: SafeAutomationBlueprint, risks: RiskSummary): boolean {
    return risks.categories.some((category) => HUMAN_APPROVAL_CATEGORIES.includes(category))
        || blueprint.risks.some((risk) => HUMAN_APPROVAL_CATEGORIES.includes(risk.category));
}

function isSafeInternalPreview(input: BuildSafetyCriticReviewInput): boolean {
    const { signals, risks, clarificationPlan, blueprint, routerDecision } = input;

    return risks.risk_level === "low"
        && !risks.requires_human_review
        && !signals.has_external_action
        && clarificationPlan?.needed !== true
        && routerDecision?.route !== "reject"
        && blueprint.human_approval_gates.length === 0
        && !hasExplicitlyBlockedSteps(blueprint)
        && !hasHardBlockedRisk(blueprint, risks)
        && (blueprint.automation_boundary === "fully_automatable" || blueprint.automation_boundary === "partially_automatable");
}


function hasBlockingClarificationNeed(clarificationPlan?: ClarificationPlan): boolean {
    if (clarificationPlan?.needed !== true) return false;

    return clarificationPlan.missing_fields.some((field) => field !== "success_criteria");
}

function buildOverallStatus(input: BuildSafetyCriticReviewInput): SafetyCriticReview["overall_status"] {
    const { signals, risks, routerDecision, clarificationPlan, blueprint } = input;

    if (
        routerDecision?.route === "reject"
        || hasExplicitlyBlockedSteps(blueprint)
        || hasHardBlockedRisk(blueprint, risks)
    ) {
        return "not_safe_to_automate";
    }

    // Important: do not let the AI router alone force clarification.
    // The deterministic clarification plan is the source of truth for whether details are actually missing.
    if (hasBlockingClarificationNeed(clarificationPlan)) {
        return "needs_clarification";
    }

    if (isSafeInternalPreview(input)) {
        return "safe_internal_preview";
    }

    if (
        risks.requires_human_review
        || risks.risk_level === "medium"
        || risks.risk_level === "high"
        || signals.has_external_action
        || hasHumanApprovalRisk(blueprint, risks)
        || blueprint.human_approval_gates.length > 0
        || blueprint.automation_boundary === "human_approval_required"
        || blueprint.automation_boundary === "assistant_only"
        || blueprint.automation_boundary === "not_safe_to_automate"
        || routerDecision?.route === "suggest_safer_workflow"
        || routerDecision?.route === "assistant_only"
        || routerDecision?.route === "needs_clarification"
    ) {
        return "needs_human_approval";
    }

    return "safe_internal_preview";
}

function createFinding(input: {
    id: string;
    type: SafetyCriticFindingType;
    severity: SafetyCriticSeverity;
    title: string;
    explanation: string;
    recommendation: string;
    related_step_ids?: string[];
    related_risk_ids?: string[];
    related_gate_ids?: string[];
}): SafetyCriticFinding {
    return {
        id: input.id,
        type: input.type,
        severity: input.severity,
        title: input.title,
        explanation: input.explanation,
        recommendation: input.recommendation,
        related_step_ids: input.related_step_ids ?? [],
        related_risk_ids: input.related_risk_ids ?? [],
        related_gate_ids: input.related_gate_ids ?? [],
    };
}

function buildFindings(input: BuildSafetyCriticReviewInput, overallStatus: SafetyCriticReview["overall_status"]): SafetyCriticFinding[] {
    const { risks, readiness, clarificationPlan, blueprint } = input;
    const findings: SafetyCriticFinding[] = [];

    if (overallStatus === "safe_internal_preview") {
        findings.push(createFinding({
            id: "safety_finding_safe_internal_preview",
            type: "safe_to_automate",
            severity: "info",
            title: "Internal preview is safe",
            explanation:
                "This workflow can be represented as a non-executing internal automation preview. It can classify, extract, summarize, and prepare internal task data without sending messages or changing production systems.",
            recommendation:
                "Review the flow and dry-run cases before connecting any future implementation to real tools.",
            related_step_ids: blueprint.steps.map((step) => step.id),
        }));
    }

    if (hasBlockingClarificationNeed(clarificationPlan)) {
        findings.push(createFinding({
            id: "safety_finding_needs_clarification",
            type: "needs_clarification",
            severity: "warning",
            title: "Clarification needed before implementation",
            explanation:
                clarificationPlan?.reason
                || "The process description is not specific enough to trust as an implementation-ready automation blueprint.",
            recommendation:
                "Answer the clarification questions, improve the prompt, and recompile before implementation.",
        }));
    }

    if (hasDraftOnlySteps(blueprint)) {
        findings.push(createFinding({
            id: "safety_finding_draft_only",
            type: "draft_only",
            severity: risks.risk_level === "low" ? "info" : "warning",
            title: "Generated text must stay draft-only",
            explanation:
                "FlowForge can safely describe draft creation, but generated messages or notifications should not be sent automatically from this MVP blueprint.",
            recommendation:
                "Keep generated text human-reviewed and require explicit approval before any external message is sent.",
            related_step_ids: stepIdsByPolicy(blueprint.steps, ["draft_only"]),
            related_risk_ids: riskIdsByCategories(blueprint.risks, ["external_communication"]),
        }));
    }

    if (
        overallStatus === "needs_human_approval"
        || blueprint.human_approval_gates.length > 0
        || hasHumanApprovalRisk(blueprint, risks)
    ) {
        findings.push(createFinding({
            id: "safety_finding_human_approval_required",
            type: "human_approval_required",
            severity: "warning",
            title: "Human approval required before sensitive action",
            explanation:
                "This workflow can be previewed safely, but payments, refunds, external messages, account changes, or other real-world outcomes must remain human-approved.",
            recommendation:
                "Assign the owner, keep the approval checklist, and do not allow automatic refunds, account updates, or message sending.",
            related_step_ids: unique(blueprint.human_approval_gates.flatMap((gate) => gate.applies_to_step_ids)),
            related_risk_ids: blueprint.risks.map((risk) => risk.id),
            related_gate_ids: requiredGateIds(blueprint.human_approval_gates),
        }));
    }

    if (
        overallStatus === "not_safe_to_automate"
        || hasExplicitlyBlockedSteps(blueprint)
        || hasHardBlockedRisk(blueprint, risks)
    ) {
        findings.push(createFinding({
            id: "safety_finding_blocked_in_mvp",
            type: "blocked_in_mvp",
            severity: "blocker",
            title: "Unsafe automation is blocked",
            explanation:
                "This workflow includes hard-blocked automation boundaries such as legal, medical, visa/immigration, or destructive actions.",
            recommendation:
                "Convert the workflow into internal review, draft-only output, or human-approved task creation.",
            related_step_ids: unique([
                ...stepIdsByPolicy(blueprint.steps, ["blocked_in_mvp", "not_recommended"]),
                ...stepIdsByExecutionPolicy(blueprint.steps, ["blocked_in_mvp"]),
            ]),
            related_risk_ids: riskIdsByCategories(blueprint.risks, HARD_BLOCKED_CATEGORIES),
            related_gate_ids: requiredGateIds(blueprint.human_approval_gates),
        }));
    }

    if (blueprint.not_safe_to_automate.length > 0 && overallStatus !== "not_safe_to_automate") {
        findings.push(createFinding({
            id: "safety_finding_mvp_boundary",
            type: "implementation_warning",
            severity: "info",
            title: "MVP execution boundary",
            explanation:
                "The blueprint lists actions that FlowForge should not execute in the MVP. This does not make the whole workflow unsafe; it means those actions stay outside the preview.",
            recommendation:
                "Keep production execution, external sending, account updates, refunds, deletion, and similar actions outside the MVP automation.",
        }));
    }

    if (readiness.score < 70 || blueprint.open_questions.length > 0 || readiness.weaknesses.length > 0) {
        findings.push(createFinding({
            id: "safety_finding_implementation_warning",
            type: "implementation_warning",
            severity: readiness.score < 50 ? "warning" : "info",
            title: "Implementation details still need review",
            explanation:
                "Readiness weaknesses or open questions should be resolved before connecting this blueprint to real tools or production data.",
            recommendation:
                "Review the open questions, assumptions, readiness weaknesses, and dry-run cases before implementation.",
        }));
    }

    if (findings.length === 0) {
        findings.push(createFinding({
            id: "safety_finding_default_review",
            type: "implementation_warning",
            severity: "info",
            title: "Review before implementation",
            explanation:
                "FlowForge produced a non-executing preview. Even low-risk internal workflows should be reviewed before being connected to real systems.",
            recommendation:
                "Confirm the workflow map, inputs, outputs, and dry-run tests before implementation.",
        }));
    }

    return findings;
}

function buildSummary(status: SafetyCriticReview["overall_status"]): string {
    if (status === "safe_internal_preview") {
        return "Safety critic review: this workflow is safe as a non-executing internal automation preview.";
    }

    if (status === "needs_clarification") {
        return "Safety critic review: clarify the process before treating this as an implementation-ready blueprint.";
    }

    if (status === "not_safe_to_automate") {
        return "Safety critic review: this workflow is not safe to automate as described in the MVP.";
    }

    return "Safety critic review: this workflow can be previewed, but sensitive or external actions require human approval.";
}

function buildNextSafeAction(status: SafetyCriticReview["overall_status"]): string {
    if (status === "safe_internal_preview") {
        return "Review the flow and dry-run cases. Do not connect production tools until a human approves the implementation.";
    }

    if (status === "needs_clarification") {
        return "Answer the clarification questions, revise the process description, and recompile.";
    }

    if (status === "not_safe_to_automate") {
        return "Do not automate this as described. Convert it into a human-reviewed, draft-only, or internal task workflow.";
    }

    return "Assign the responsible reviewer and keep human approval gates before any external or sensitive action.";
}

export function buildSafetyCriticReview(input: BuildSafetyCriticReviewInput): SafetyCriticReview {
    const { blueprint } = input;
    const overallStatus = buildOverallStatus(input);
    const findings = buildFindings(input, overallStatus);

    return {
        overall_status: overallStatus,
        summary: buildSummary(overallStatus),
        findings,
        safe_to_automate: blueprint.safe_to_automate,
        must_remain_draft_only: blueprint.steps
            .filter((step) => step.automation_policy === "draft_only" || step.real_world_execution === "draft_only")
            .map((step) => step.label),
        requires_human_approval: unique([
            ...blueprint.needs_human_approval,
            ...blueprint.human_approval_gates.map((gate) => gate.label),
        ]),
        blocked_or_not_recommended:
            overallStatus === "not_safe_to_automate"
                ? unique([...blueprint.not_recommended, ...blueprint.not_safe_to_automate])
                : blueprint.not_recommended,
        next_safe_action: buildNextSafeAction(overallStatus),
    };
}