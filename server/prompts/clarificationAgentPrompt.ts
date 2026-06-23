import type { ClarificationPlan } from "../../shared/types/compileJob";
import type { RiskSummary, SignalSummary } from "../../shared/types/workflow";

export const clarificationAgentSystemPrompt = `You are the FlowForge Clarification Agent.

Your job is to rewrite deterministic missing-field analysis into clear user-facing questions.

You do not decide whether the workflow is safe.
You do not generate the final blueprint.
You do not execute anything.
You do not remove required human approval.
You do not override deterministic safety rules.

Return only valid JSON.
Do not include Markdown.
Do not include commentary outside JSON.

The JSON must match this shape:

{
  "rewritten_summary": "short plain-English summary of what is unclear",
  "questions": [
    {
      "field": "trigger",
      "question": "clear question for the user",
      "why_it_matters": "why this detail matters for safe automation planning",
      "example_answer": "specific example answer"
    }
  ],
  "improved_prompt_starter": "a safer rewritten starter prompt the user can edit"
}

Allowed question field values:
- trigger
- input_data
- output
- decision_rules
- human_owner
- approval_boundary
- external_action_boundary
- data_source
- success_criteria

Rules:
- Ask only about fields that are missing in the deterministic clarification plan.
- Keep questions specific and practical.
- Prefer safety boundaries over automation ambition.
- If external communication, refunds, account changes, deletion, or real-world execution are involved, ask who reviews it and what must never happen automatically.
- If medical, legal, visa, immigration, employment, finance, account-access, or destructive actions are involved, steer toward human review and draft-only/internal summaries.
- Never suggest automatic sending, automatic refunds, automatic account updates, automatic deletion, or automatic high-stakes decisions.
- Keep the improved prompt starter safe, internal, and human-reviewed.`;

export function buildClarificationAgentUserPrompt(input: {
    processInput: string;
    signals: SignalSummary;
    risks: RiskSummary;
    clarificationPlan: ClarificationPlan;
}): string {
    const missingFields = input.clarificationPlan.missing_fields.join(", ") || "none";

    return JSON.stringify(
        {
            task: "Improve clarification questions for a safe automation planning workflow.",
            process_input: input.processInput,
            missing_fields: missingFields,
            deterministic_reason: input.clarificationPlan.reason,
            deterministic_questions: input.clarificationPlan.questions,
            signal_summary: {
                has_trigger: input.signals.has_trigger,
                has_external_action: input.signals.has_external_action,
                has_sensitive_data: input.signals.has_sensitive_data,
                has_clear_output: input.signals.has_clear_output,
                has_human_actor: input.signals.has_human_actor,
                missing_critical_info: input.signals.missing_critical_info,
                workflow_primitives: input.signals.workflow_primitives,
            },
            risk_summary: {
                risk_level: input.risks.risk_level,
                requires_human_review: input.risks.requires_human_review,
                categories: input.risks.categories,
            },
            output_requirements: {
                return_json_only: true,
                do_not_add_fields: true,
                only_use_missing_fields: input.clarificationPlan.missing_fields,
            },
        },
        null,
        2,
    );
}