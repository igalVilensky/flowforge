import { validBlueprint } from "./validBlueprint";

export const invalidBlueprint: unknown = {
  ...validBlueprint,
  id: "blueprint_fixture_invalid",
  trigger: {
    type: "incoming_message",
    source: "support_inbox",
  },
  steps: [
    {
      id: "auto_send_invalid_step",
      label: "Automatically send refund reply",
      description: "This intentionally invalid step tries to send a message and execute work automatically.",
      primitive: "notification",
      actor: "ai",
      input: "Draft reply",
      output: "Sent customer reply",
      automation_policy: "send_automatically",
      approval_required: false,
      risk_level: "critical",
      risk_categories: ["external_communication", "refund_or_payment"],
      real_world_execution: "execute_now",
    },
    ...validBlueprint.steps.slice(1),
  ],
};
