import type { CompileJob } from "../../shared/types/compileJob";
import type {
  CompactN8nGenerationInput,
  N8nImplementationBrief,
} from "../../shared/types/n8nWorkflow";
import { normalizeCompileRequest } from "./structuredCompileInput";

type BriefDomain =
  | "admissions"
  | "support"
  | "finance"
  | "marketing"
  | "generic";

type CanonicalRequestFacts = {
  humanOwner: string;
  approvalBoundary: string;
  externalActionBoundary: string;
};

function truncateText(
  value: unknown,
  maxLength: number,
): string {
  const text =
    typeof value === "string"
      ? value
      : String(value ?? "");

  const normalized = text
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized
    .slice(0, Math.max(0, maxLength - 3))
    .trimEnd()}...`;
}

function normalizeInput(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(
  items: string[],
  item: unknown,
  maxLength = 160,
): void {
  const text = truncateText(
    item,
    maxLength,
  );

  if (text && !items.includes(text)) {
    items.push(text);
  }
}

function uniqueStrings(
  items: unknown[],
  maxItems: number,
  maxLength: number,
): string[] {
  const result: string[] = [];

  for (const item of items) {
    addUnique(
      result,
      item,
      maxLength,
    );

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function hasAny(
  input: string,
  phrases: readonly string[],
): boolean {
  return phrases.some((phrase) =>
    input.includes(phrase),
  );
}

function titleCase(value: string): string {
  return value.replace(
    /\b[a-z]/g,
    (letter) => letter.toUpperCase(),
  );
}

function originalRequest(
  compileJob: CompileJob,
): string {
  const canonicalOriginalInput =
    normalizeCompileRequest(
      compileJob.input.raw,
    ).intent.original_input.trim();

  return (
    canonicalOriginalInput ||
    compileJob.input.raw ||
    compileJob.input.trimmed
  ).trim();
}

function detectDomain(
  input: string,
): BriefDomain {
  if (
    hasAny(input, [
      "admissions",
      "admission application",
      "student application",
      "programme application",
      "program application",
      "applicant",
      "enrolment",
      "enrollment",
    ])
  ) {
    return "admissions";
  }

  if (
    hasAny(input, [
      "support",
      "ticket",
      "customer",
      "helpdesk",
      "zendesk",
      "complaint",
    ])
  ) {
    return "support";
  }

  if (
    hasAny(input, [
      "invoice",
      "refund",
      "billing",
      "payment",
      "charge",
      "receipt",
    ])
  ) {
    return "finance";
  }

  if (
    hasAny(input, [
      "marketing",
      "campaign",
      "social media",
      "linkedin post",
      "instagram",
      "promotional content",
      "product launch",
    ])
  ) {
    return "marketing";
  }

  return "generic";
}

function cleanPersonOrRole(
  value: string,
): string {
  return value
    .replace(
      /^(?:the|a|an)\s+/i,
      "",
    )
    .replace(
      /\s+(?:must|should|will|who)\s+.*$/i,
      "",
    )
    .replace(/[.;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRoleAndName(
  value: string,
): string {
  const cleaned =
    cleanPersonOrRole(value);

  /*
   * Handles:
   * "the admissions manager, Jane Doe"
   * "admissions manager Jane Doe"
   */
  const commaMatch = cleaned.match(
    /^(.+?),\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)+)$/,
  );

  if (commaMatch) {
    const role =
      commaMatch[1]?.trim();

    const name =
      commaMatch[2]?.trim();

    if (role && name) {
      return `${name} (${role})`;
    }
  }

  const roleNameMatch = cleaned.match(
    /^(.+?\b(?:manager|lead|owner|reviewer|director|officer|specialist|coordinator|administrator))\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)+)$/,
  );

  if (roleNameMatch) {
    const role =
      roleNameMatch[1]?.trim();

    const name =
      roleNameMatch[2]?.trim();

    if (role && name) {
      return `${name} (${role})`;
    }
  }

  return cleaned;
}

function extractHumanOwnerFromRequest(
  request: string,
): string {
  const patterns = [
    /\bassign(?:\s+it|\s+the\s+(?:task|package|result))?\s+to\s+(.+?)(?=\.|;\s*|\bno external\b|\bbefore\b|$)/i,

    /\b(?:reviewed|approved|owned|handled)\s+by\s+(.+?)(?=\.|;|\bbefore\b|$)/i,

    /\b(?:human owner|review owner|responsible reviewer|approver)\s*(?:is|:)\s*(.+?)(?=\.|;|$)/i,

    /\b(?:manager|reviewer|approver)\s*,?\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)+)/,
  ];

  for (const pattern of patterns) {
    const match =
      request.match(pattern);

    const candidate =
      match?.[1]?.trim();

    if (candidate) {
      return formatRoleAndName(
        candidate,
      );
    }
  }

  const approvalNameMatch =
    request.match(
      /\bbefore\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)+)\s+(?:manually\s+)?(?:reviews?|approves?)/,
    );

  if (approvalNameMatch?.[1]) {
    return approvalNameMatch[1].trim();
  }

  return "";
}

function splitRequestSentences(
  request: string,
): string[] {
  return request
    .split(/(?<=[.!?])\s+/)
    .map((sentence) =>
      sentence.trim(),
    )
    .filter(Boolean);
}

function extractExplicitApprovalBoundary(
  request: string,
): string {
  const sentences =
    splitRequestSentences(request);

  const explicitExternalBoundary =
    sentences.find((sentence) =>
      /\b(?:external communication|external action|send|sent|publish|published|reply|message|email)\b/i.test(
        sentence,
      ) &&
      /\b(?:no|not|never|cannot|can't|may not|must not|without|until|before)\b/i.test(
        sentence,
      ) &&
      /\b(?:review(?:ed|s)?|approv(?:e|ed|es)|approval)\b/i.test(
        sentence,
      ),
    );

  const explicitSentence =
    explicitExternalBoundary ||
    sentences.find((sentence) =>
      (
        /\b(?:before|until|unless)\b/i.test(
          sentence,
        ) &&
        /\b(?:review(?:ed|s)?|approv(?:e|ed|es)|approval)\b/i.test(
          sentence,
        )
      ) ||
      (
        /\bmust\b/i.test(sentence) &&
        /\b(?:review(?:ed|s)?|approv(?:e|ed|es)|approval)\b/i.test(
          sentence,
        )
      ),
    );

  if (explicitSentence) {
    return truncateText(
      explicitSentence,
      220,
    );
  }

  const inlineMatch =
    request.match(
      /(?:no external communication|no external action|nothing may be sent|do not send|must not be sent).+?(?:review(?:ed|s)?|approv(?:e|ed|es)|approval).+?(?:[.!?]|$)/i,
    );

  return truncateText(
    inlineMatch?.[0] ?? "",
    220,
  );
}

function extractExternalActionBoundary(
  request: string,
): string {
  const sentences =
    splitRequestSentences(request);

  const explicitSentence =
    sentences.find((sentence) =>
      (
        /\b(?:no|not|never|without|before|until)\b/i.test(
          sentence,
        ) &&
        /\b(?:external communication|external action|send|sent|publish|published|reply|message|email)\b/i.test(
          sentence,
        )
      ),
    );

  if (explicitSentence) {
    return truncateText(
      explicitSentence,
      220,
    );
  }

  return "";
}

function extractCanonicalRequestFacts(
  compileJob: CompileJob,
): CanonicalRequestFacts {
  const canonicalIntent =
    normalizeCompileRequest(
      compileJob.input.raw,
    ).intent;

  const request =
    originalRequest(compileJob);

  return {
    humanOwner:
      canonicalIntent.human_owner ||
      extractHumanOwnerFromRequest(
        request,
      ) ||
      "",

    approvalBoundary:
      canonicalIntent.approval_boundary ||
      extractExplicitApprovalBoundary(
        request,
      ),

    externalActionBoundary:
      canonicalIntent.external_action_boundary ||
      extractExternalActionBoundary(
        request,
      ),
  };
}

function detectTriggerDescription(
  input: string,
  compileJob: CompileJob,
): string {
  if (
    hasAny(input, [
      "every morning",
      "each morning",
    ])
  ) {
    return "Every morning";
  }

  if (input.includes("every weekday")) {
    return "Every weekday";
  }

  if (
    hasAny(input, [
      "daily",
      "every day",
      "each day",
    ])
  ) {
    return "Daily";
  }

  if (
    hasAny(input, [
      "weekly",
      "every week",
    ])
  ) {
    return "Weekly";
  }

  if (
    hasAny(input, [
      "monthly",
      "every month",
    ])
  ) {
    return "Monthly";
  }

  const whenMatch = input.match(
    /\b(when(?:ever)?|after|once)\s+(.+?)(?:,|\.|$)/,
  );

  if (whenMatch?.[0]) {
    return titleCase(
      truncateText(
        whenMatch[0].replace(
          /[,.]$/,
          "",
        ),
        140,
      ),
    );
  }

  if (
    compileJob.result.trigger
      ?.description
  ) {
    return truncateText(
      compileJob.result.trigger.description.replace(
        /^rule-based .+ inferred from:\s*/i,
        "",
      ),
      180,
    );
  }

  return "Manual safe-preview trigger";
}

function detectSource(
  input: string,
  domain: BriefDomain,
  canonicalSources: readonly string[],
): string {
  const canonicalSource =
    canonicalSources.find((source) =>
      source.trim(),
    );

  if (canonicalSource) {
    return truncateText(
      canonicalSource,
      160,
    );
  }

  const sourcePhrases = [
    "shared admissions gmail inbox",
    "admissions gmail inbox",
    "shared admissions inbox",
    "admissions inbox",
    "shared support gmail inbox",
    "support gmail inbox",
    "support inbox",
    "shared finance gmail inbox",
    "finance gmail inbox",
    "finance inbox",
    "shared inbox",
    "gmail inbox",
    "email inbox",
  ];

  const detected =
    sourcePhrases.find((source) =>
      input.includes(source),
    );

  if (detected) {
    return detected;
  }

  const sourceMatch = input.match(
    /\b(?:arrives?|received|comes?)\s+(?:in|from|through)\s+(?:the\s+)?(.+?)(?:,|\.|\band\s+(?:extract|classify|create|prepare|route)|$)/i,
  );

  if (sourceMatch?.[1]) {
    return truncateText(
      sourceMatch[1],
      160,
    );
  }

  if (
    input.includes("email") ||
    input.includes("emails")
  ) {
    if (domain === "admissions") {
      return "admissions application inbox";
    }

    if (domain === "support") {
      return "support inbox";
    }

    if (domain === "finance") {
      return "finance inbox";
    }

    return "incoming email source";
  }

  return "user-provided internal input";
}

function sourceType(
  source: string,
): string {
  const normalized =
    normalizeInput(source);

  if (normalized.includes("gmail")) {
    return "gmail";
  }

  if (
    normalized.includes("email") ||
    normalized.includes("inbox")
  ) {
    return "email_inbox";
  }

  if (
    normalized.includes("sheet")
  ) {
    return "spreadsheet";
  }

  if (normalized.includes("form")) {
    return "form";
  }

  if (
    normalized.includes("database")
  ) {
    return "database";
  }

  return "internal_input";
}

function cleanFieldName(
  value: string,
): string {
  return value
    .replace(
      /^(?:the|a|an)\s+/,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();
}

function detectExplicitExtractedFields(
  input: string,
): string[] {
  const fields: string[] = [];

  const extractMatch = input.match(
    /\bextract\s+(?:the\s+)?(.+?)(?:,\s*(?:classify|create|prepare|route|draft|write|send|notify|assign|without|do not|don't)\b|\s+and\s+(?:classify|create|prepare|route|draft|write|send|notify|assign)\b|\.|$)/,
  );

  const fieldText =
    extractMatch?.[1]?.split(
      /\bfrom\s+(?:the\s+)?/,
    )[0] ?? "";

  for (
    const rawField of fieldText
      .replace(/\s+and\s+/g, ", ")
      .split(/[,;]/)
  ) {
    addUnique(
      fields,
      cleanFieldName(rawField),
      80,
    );
  }

  return fields;
}

function detectExtractedFields(
  input: string,
  domain: BriefDomain,
): string[] {
  const fields =
    detectExplicitExtractedFields(
      input,
    );

  if (domain === "admissions") {
    for (let index = 0; index < fields.length; index += 1) {
      const normalizedField =
        normalizeInput(fields[index] ?? "");

      if (
        normalizedField === "candidate name" ||
        normalizedField === "student name"
      ) {
        fields[index] = "applicant name";
      } else if (
        normalizedField === "application id" ||
        normalizedField === "application identifier"
      ) {
        fields[index] = "application ID";
      }
    }

    if (
      fields.length === 0 ||
      input.includes(
        "applicant details",
      ) ||
      input.includes(
        "candidate details",
      )
    ) {
      addUnique(
        fields,
        "applicant name",
        80,
      );

      addUnique(
        fields,
        "application ID",
        80,
      );

      addUnique(
        fields,
        "course",
        80,
      );

      addUnique(
        fields,
        "application summary",
        80,
      );
    }
  }

  if (
    domain === "support" &&
    fields.length === 0
  ) {
    addUnique(
      fields,
      "customer name",
      80,
    );

    addUnique(
      fields,
      "issue summary",
      80,
    );

    addUnique(
      fields,
      "urgency",
      80,
    );
  }

  if (
    domain === "finance" &&
    fields.length === 0
  ) {
    addUnique(
      fields,
      "customer name",
      80,
    );

    addUnique(
      fields,
      "invoice number",
      80,
    );

    addUnique(
      fields,
      "amount",
      80,
    );

    addUnique(
      fields,
      "billing reason",
      80,
    );
  }

  if (
    domain === "marketing" &&
    fields.length === 0
  ) {
    addUnique(
      fields,
      "product name",
      80,
    );

    addUnique(
      fields,
      "target audience",
      80,
    );

    addUnique(
      fields,
      "key features",
      80,
    );

    addUnique(
      fields,
      "campaign tone",
      80,
    );
  }

  return uniqueStrings(
    fields,
    8,
    80,
  );
}

function detectClassificationTarget(
  input: string,
  domain: BriefDomain,
): string {
  const classifyMatch = input.match(
    /\bclassify\s+(?:the\s+)?([a-z0-9 -]{2,80}?)(?:,|\.|\band\s+(?:create|prepare|route|draft|send|notify|log|assign)\b|\bwithout\b|$)/,
  );

  const target = cleanFieldName(
    classifyMatch?.[1] ?? "",
  );

  if (target) {
    if (
      (
        target === "priority" ||
        target.startsWith(
          "application priority",
        )
      ) &&
      domain === "admissions"
    ) {
      return "application priority";
    }

    if (
      target === "priority" &&
      domain === "support"
    ) {
      return "support priority";
    }

    return truncateText(
      target,
      80,
    );
  }

  if (
    hasAny(input, [
      "classify",
      "categorize",
      "triage",
      "label",
    ])
  ) {
    if (domain === "admissions") {
      return "application priority";
    }

    if (domain === "support") {
      return "support priority";
    }

    if (domain === "finance") {
      return "finance review category";
    }

    if (domain === "marketing") {
      return "content type";
    }

    return "internal review category";
  }

  return "";
}

function buildClassificationRules(
  target: string,
  domain: BriefDomain,
): string[] {
  if (!target) {
    return [];
  }

  if (domain === "admissions") {
    return [
      "Use only visible application content and extracted fields.",
      "Mark missing or ambiguous information as needs manual review.",
      "Priority is internal triage only and must not decide admissions outcomes.",
    ];
  }

  if (domain === "support") {
    return [
      "Use issue urgency, impact, and missing information.",
      "Escalate complaints, refunds, account-access issues, and threats.",
      "Keep external responses draft-only until human approval.",
    ];
  }

  if (domain === "finance") {
    return [
      "Use invoice, amount, reason, and visible account details.",
      "Route payments, refunds, and billing changes to human review.",
      "Do not execute financial actions automatically.",
    ];
  }

  if (domain === "marketing") {
    return [
      "Use only supplied campaign and product information.",
      "Keep generated content as a draft.",
      "Require human approval before publication.",
    ];
  }

  return [
    "Use only supplied source data.",
    "Flag missing details for human review.",
    "Keep downstream external action blocked until approval.",
  ];
}

function detectInternalOutputs(
  input: string,
  domain: BriefDomain,
  classificationTarget: string,
): string[] {
  const outputs: string[] = [];

  if (domain === "admissions") {
    addUnique(
      outputs,
      "internal admissions review package",
      120,
    );

    addUnique(
      outputs,
      "applicant summary",
      120,
    );

    if (classificationTarget) {
      addUnique(
        outputs,
        "application priority label",
        120,
      );
    }
  } else if (domain === "support") {
    addUnique(
      outputs,
      "support triage task",
      120,
    );

    addUnique(
      outputs,
      "issue summary",
      120,
    );
  } else if (domain === "finance") {
    addUnique(
      outputs,
      "finance review task",
      120,
    );
  } else if (domain === "marketing") {
    addUnique(
      outputs,
      "draft marketing content package",
      120,
    );
  }

  if (
    hasAny(input, [
      "review task",
      "internal task",
      "review package",
      "internal review package",
    ])
  ) {
    addUnique(
      outputs,
      domain === "admissions"
        ? "internal admissions review package"
        : "internal review package",
      120,
    );
  }

  if (
    hasAny(input, [
      "draft reply",
      "draft response",
    ])
  ) {
    addUnique(
      outputs,
      "draft reply for human review",
      120,
    );
  }

  if (outputs.length === 0) {
    addUnique(
      outputs,
      "safe internal review package",
      120,
    );
  }

  return uniqueStrings(
    outputs,
    6,
    120,
  );
}

function humanGateText(
  gate: unknown,
): string {
  if (
    !gate ||
    typeof gate !== "object"
  ) {
    return truncateText(
      gate,
      180,
    );
  }

  const record =
    gate as Record<string, unknown>;

  const label = truncateText(
    record.label ??
      record.name ??
      "Human review",
    90,
  );

  const reason = truncateText(
    record.reason ??
      record.description ??
      "",
    110,
  );

  return reason
    ? `${label}: ${reason}`
    : label;
}

function detectBlockedActions(
  compileJob: CompileJob,
  request: string,
  canonicalFacts: CanonicalRequestFacts,
): string[] {
  const result: string[] = [];

  if (
    canonicalFacts
      .externalActionBoundary
  ) {
    addUnique(
      result,
      canonicalFacts.externalActionBoundary,
      220,
    );
  }

  if (
    /\bno external communication\b/i.test(
      request,
    ) ||
    /\bmust not be sent\b/i.test(
      request,
    )
  ) {
    addUnique(
      result,
      "Do not send external communication before the designated human owner approves it.",
      180,
    );
  }

  for (const action of [
    ...(compileJob.result
      .not_safe_to_automate ?? []),
    ...(compileJob.result
      .not_recommended ?? []),
    ...(compileJob.safety_critic
      ?.blocked_or_not_recommended ??
      []),
    ...(compileJob.safety_critic
      ?.must_remain_draft_only ??
      []),
  ]) {
    addUnique(
      result,
      action,
      180,
    );
  }

  return result.slice(0, 8);
}

function detectHumanApprovalGates(
  compileJob: CompileJob,
  canonicalFacts: CanonicalRequestFacts,
  blockedActions: readonly string[],
): string[] {
  const gates = uniqueStrings(
    (
      compileJob.result
        .human_approval_gates ?? []
    ).map(humanGateText),
    8,
    180,
  );

  if (
    canonicalFacts.approvalBoundary
  ) {
    gates.unshift(
      canonicalFacts.approvalBoundary,
    );
  }

  const uniqueGates =
    uniqueStrings(
      gates,
      8,
      220,
    );

  if (
    uniqueGates.length === 0 &&
    (
      compileJob.risks
        .requires_human_review ||
      blockedActions.length > 0
    )
  ) {
    uniqueGates.push(
      "Manual review required before external communication or production execution.",
    );
  }

  return uniqueGates;
}

function buildWorkflowGoal(
  domain: BriefDomain,
  source: string,
  extractedFields: readonly string[],
  classificationTarget: string,
  internalOutputs: readonly string[],
): string {
  const parts: string[] = [
    `collect safe-preview input representing ${source}`,
  ];

  if (extractedFields.length > 0) {
    parts.push(
      domain === "admissions"
        ? "extract applicant details"
        : `extract ${extractedFields
            .slice(0, 4)
            .join(", ")}`,
    );
  }

  if (classificationTarget) {
    parts.push(
      `classify ${classificationTarget}`,
    );
  }

  if (internalOutputs.length > 0) {
    parts.push(
      `prepare ${internalOutputs[0]}`,
    );
  }

  return truncateText(
    parts.join(", "),
    260,
  );
}

function workflowName(
  domain: BriefDomain,
): string {
  if (domain === "admissions") {
    return "Admissions Application Review Workflow";
  }

  if (domain === "support") {
    return "Support Triage Review Workflow";
  }

  if (domain === "finance") {
    return "Finance Request Review Workflow";
  }

  if (domain === "marketing") {
    return "Marketing Content Review Workflow";
  }

  return "Internal Review Workflow";
}

function recommendedNodes(
  domain: BriefDomain,
  classificationTarget: string,
  hasApproval: boolean,
): string[] {
  const nodes: string[] = [];

  if (domain === "admissions") {
    nodes.push(
      "Admissions Application Review Trigger",
      "Sample Admissions Application",
      "Extract Applicant Fields",
    );
  } else if (domain === "support") {
    nodes.push(
      "Support Review Trigger",
      "Sample Support Request",
      "Extract Support Fields",
    );
  } else if (domain === "finance") {
    nodes.push(
      "Finance Review Trigger",
      "Sample Finance Request",
      "Extract Finance Fields",
    );
  } else if (domain === "marketing") {
    nodes.push(
      "Marketing Review Trigger",
      "Sample Campaign Brief",
      "Extract Campaign Fields",
    );
  } else {
    nodes.push(
      "Internal Review Trigger",
      "Sample Internal Input",
      "Extract Input Fields",
    );
  }

  if (classificationTarget) {
    nodes.push(
      `Classify ${titleCase(
        classificationTarget,
      )}`,
    );
  }

  nodes.push(
    domain === "admissions"
      ? "Prepare Admissions Review Package"
      : "Prepare Internal Review Package",
  );

  if (hasApproval) {
    nodes.push(
      "Mark Pending Human Review",
    );
  }

  return nodes.slice(0, 7);
}

function buildWarnings(
  compileJob: CompileJob,
  domain: BriefDomain,
): string[] {
  const warnings = uniqueStrings(
    [
      ...(compileJob.risks
        .reasons ?? []),
      ...(compileJob
        .safety_critic_agent
        ?.draft_only_warnings ??
        []),
      ...(compileJob
        .safety_critic_agent
        ?.blocked_or_not_recommended ??
        []),
    ],
    6,
    180,
  );

  if (
    domain === "admissions"
  ) {
    addUnique(
      warnings,
      "Application priority is internal triage only and must not decide admissions outcomes.",
      180,
    );
  }

  return warnings.slice(0, 6);
}

export function buildN8nImplementationBrief(
  compileJob: CompileJob,
): N8nImplementationBrief {
  const canonicalIntent =
    normalizeCompileRequest(
      compileJob.input.raw,
    ).intent;

  const request =
    originalRequest(compileJob);

  const normalizedRequest =
    normalizeInput(
      [
        request,
        canonicalIntent.goal,
        canonicalIntent.task_type,
        canonicalIntent.trigger,
        ...canonicalIntent.input_sources,
        ...canonicalIntent.input_data,
        ...canonicalIntent.desired_outputs,
        ...canonicalIntent.decision_rules,
      ]
        .filter(Boolean)
        .join(" "),
    );

  const canonicalFacts =
    extractCanonicalRequestFacts(
      compileJob,
    );

  const domain =
    detectDomain(
      normalizedRequest,
    );

  const triggerDescription =
    detectTriggerDescription(
      normalizedRequest,
      compileJob,
    );

  const source =
    detectSource(
      normalizedRequest,
      domain,
      canonicalIntent.input_sources,
    );

  const extractedFields =
    detectExtractedFields(
      normalizedRequest,
      domain,
    );

  const classificationTarget =
    detectClassificationTarget(
      normalizedRequest,
      domain,
    );

  const classificationRules =
    buildClassificationRules(
      classificationTarget,
      domain,
    );

  const internalOutputs =
    detectInternalOutputs(
      normalizedRequest,
      domain,
      classificationTarget,
    );

  const blockedActions =
    detectBlockedActions(
      compileJob,
      request,
      canonicalFacts,
    );

  const humanApprovalGates =
    detectHumanApprovalGates(
      compileJob,
      canonicalFacts,
      blockedActions,
    );

  const humanOwner =
    canonicalFacts.humanOwner ||
    "responsible human reviewer";

  const approvalBoundary =
    canonicalFacts.approvalBoundary ||
    humanApprovalGates[0] ||
    "Human approval is required before external action.";

  const externalActionBoundary =
    canonicalFacts
      .externalActionBoundary ||
    blockedActions[0] ||
    "No external action is allowed before human review.";

  return {
    workflow_goal:
      buildWorkflowGoal(
        domain,
        source,
        extractedFields,
        classificationTarget,
        internalOutputs,
      ),

    trigger_description:
      triggerDescription,

    source,
    source_type:
      sourceType(source),
    source_is_placeholder: true,

    domain,

    extracted_fields:
      extractedFields,

    classification_target:
      classificationTarget,

    classification_rules:
      classificationRules,

    internal_outputs:
      internalOutputs,

    human_owner:
      humanOwner,

    human_approval_gates:
      humanApprovalGates,

    approval_boundary:
      approvalBoundary,

    external_action_boundary:
      externalActionBoundary,

    blocked_or_not_safe_actions:
      blockedActions,

    warnings:
      buildWarnings(
        compileJob,
        domain,
      ),

    recommended_nodes:
      recommendedNodes(
        domain,
        classificationTarget,
        humanApprovalGates.length > 0 ||
          blockedActions.length > 0,
      ),
  };
}

export function buildCompactN8nGenerationInput(
  compileJob: CompileJob,
): CompactN8nGenerationInput {
  const implementationBrief =
    buildN8nImplementationBrief(
      compileJob,
    );

  const safety =
    compileJob.safety_critic;

  return {
    original_request:
      truncateText(
        originalRequest(compileJob),
        1000,
      ),

    workflow_name:
      workflowName(
        implementationBrief.domain,
      ),

    blueprint_summary:
      truncateText(
        compileJob.result.summary,
        500,
      ),

    safety_status:
      safety?.overall_status ??
      compileJob.status,

    safety_summary:
      truncateText(
        safety?.summary ?? "",
        500,
      ),

    next_safe_action:
      truncateText(
        safety?.next_safe_action ??
          "",
        300,
      ),

    risk_level:
      compileJob.risks
        ?.risk_level,

    readiness_score:
      compileJob.readiness
        ?.score,

    ...implementationBrief,
  };
}
