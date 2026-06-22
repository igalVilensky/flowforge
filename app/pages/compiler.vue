<script setup lang="ts">
import type { CompileJob, CompileMode, RouterDecision } from "../../shared/types/compileJob";
import type {
  HumanApprovalGate,
  RiskItem,
  RiskLevel,
  StepAutomationPolicy,
  WorkflowStep,
} from "../../shared/types/workflow";

useHead({
  title: "FlowForge Compiler Preview",
  meta: [
    {
      name: "description",
      content: "Preview a safe automation blueprint compile in FlowForge.",
    },
  ],
});

const examples = [
  {
    label: "Refund",
    value:
      "When a customer asks for a refund, classify the reason, detect angry or legal language, draft a reply, and route high-risk cases to a human.",
  },
  {
    label: "Student",
    value:
      "When a student asks about a course, classify the inquiry, draft a helpful reply, and create a follow-up task for admissions if needed.",
  },
  {
    label: "Risky send",
    value:
      "When a student asks about visa eligibility or payment problems, draft a reply and send it automatically.",
  },
];

const modes: Array<{ label: string; value: CompileMode }> = [
  { label: "Demo", value: "demo" },
  { label: "Rule", value: "rule_only" },
  { label: "Balanced", value: "balanced" },
  { label: "Full", value: "full" },
];

type CompileStage = {
  id: string;
  label: string;
  description: string;
  durationMs: number;
  demoDescription?: string;
  aiDescription?: string;
};

type CompileRunState = "idle" | "running" | "finishing" | "complete" | "failed";

type TextDisplayItem = {
  label: string;
  value: string;
};

type ProviderAttemptDisplay = {
  provider: string;
  status: string;
  detail: string;
};

const FINAL_STAGE_HOLD_MS = 600;
const PREVIEW_TEXT_LIMIT = 180;
const routerRoleCopy = "AI is used only to choose the routing decision. It does not generate or execute the blueprint.";
const deterministicBoundaryCopy = "Blueprint generation remained deterministic after the router decision.";

const compileStages: CompileStage[] = [
  {
    id: "prepare",
    label: "Prepare job",
    durationMs: 900,
    description: "Reading the process description and creating a local compile job.",
  },
  {
    id: "signals",
    label: "Scan signals",
    durationMs: 1100,
    description: "Detecting trigger, repeated process shape, outputs, and workflow primitives.",
  },
  {
    id: "risks",
    label: "Review safety",
    durationMs: 1200,
    description: "Checking external actions, sensitive data, high-stakes decisions, and execution risk.",
  },
  {
    id: "router",
    label: "Route request",
    durationMs: 1300,
    description: "Choosing whether this should compile, ask for clarification, or suggest a safer workflow.",
  },
  {
    id: "provider",
    label: "Provider decision",
    durationMs: 1600,
    description: "Selecting router provider strategy.",
    demoDescription: "AI router is skipped in this mode. Deterministic routing will be used.",
    aiDescription: "Trying Groq first. Gemini can be used as fallback.",
  },
  {
    id: "blueprint",
    label: "Build blueprint",
    durationMs: 1200,
    description: "Building the deterministic non-executing blueprint preview.",
  },
  {
    id: "validate",
    label: "Validate output",
    durationMs: 900,
    description: "Validating the compile job schema before showing results.",
  },
];

const processInput = ref("");
const mode = ref<CompileMode>("demo");
const job = ref<CompileJob | null>(null);
const pendingJob = ref<CompileJob | null>(null);
const isCompiling = ref(false);
const activeCompileStageIndex = ref(0);
const compileRunState = ref<CompileRunState>("idle");
const compileReplayFinished = ref(false);
const errorMessage = ref("");

let compileRunToken = 0;
const compileReplayTimers = new Set<number>();

const expandedSteps = ref<Record<string, boolean>>({});
const expandedRisks = ref<Record<string, boolean>>({});
const expandedGates = ref<Record<string, boolean>>({});
const expandedSections = ref<Record<string, boolean>>({
  trigger: false,
  risks: false,
  gates: false,
  dryRuns: false,
  beforeImplementation: false,
  technicalTrace: false,
});

const activeExample = computed(() => {
  return examples.find((example) => example.value === processInput.value)?.label ?? "";
});

const compiledBlueprint = computed(() => job.value?.result ?? null);
const gateCount = computed(() => compiledBlueprint.value?.human_approval_gates.length ?? 0);
const riskLevel = computed<RiskLevel>(() => job.value?.risks?.risk_level ?? "medium");
const routerDecision = computed(() => job.value?.router_decision ?? null);

const activeCompileMode = computed<CompileMode>(() => {
  if (isCompiling.value) {
    return mode.value;
  }

  return job.value?.mode ?? mode.value;
});
const compileRunVisible = computed(() => compileRunState.value !== "idle" || Boolean(job.value));
const compileRunComplete = computed(() => compileRunState.value === "complete" && Boolean(job.value));
const currentCompileStage = computed<CompileStage>(() => {
  return compileStages[activeCompileStageIndex.value] ?? (compileStages[0] as CompileStage);
});
const currentCompileStageDescription = computed(() => {
  return getStageDescription(currentCompileStage.value, activeCompileMode.value);
});
const compileProgressPercent = computed(() => {
  if (compileRunComplete.value) {
    return "100%";
  }

  const finalIndex = compileStages.length - 1;
  return `${Math.round((activeCompileStageIndex.value / finalIndex) * 100)}%`;
});
const llmCallsLabel = computed(() => {
  const usage = job.value?.token_usage;

  if (!usage) {
    return "0 / 0";
  }

  return `${usage.llm_calls_used} / ${usage.llm_calls_limit}`;
});
const llmCallsUsed = computed(() => job.value?.token_usage.llm_calls_used ?? 0);
const technicalPipelineSteps = computed(() => job.value?.steps ?? []);
const technicalTokenUsage = computed(() => job.value?.token_usage ?? null);
const technicalAgentTrace = computed(() => job.value?.agent_trace ?? []);
const compileRunStateLabel = computed(() => {
  if (compileRunState.value === "running" && compileReplayFinished.value && !pendingJob.value) {
    return "Waiting";
  }

  return sentenceLabel(compileRunState.value);
});
const compileRunTitle = computed(() => {
  if (compileRunState.value === "running") {
    return "FlowForge is compiling";
  }

  if (compileRunState.value === "finishing") {
    return "Finalizing compile run";
  }

  if (compileRunState.value === "failed") {
    return "Compile run failed";
  }

  if (compileRunState.value === "complete") {
    return "Compile run complete";
  }

  return "Compile run";
});
const compileRunStateClass = computed(() => {
  if (compileRunState.value === "complete") {
    return "ff-status-safe";
  }

  if (compileRunState.value === "failed") {
    return "ff-status-blocked";
  }

  return "ff-status-approval";
});
const routerRunStatus = computed(() => {
  const currentJob = job.value;
  const decision = routerDecision.value;

  if (!currentJob || !decision) {
    return "Pending";
  }

  if (currentJob.mode === "demo" || currentJob.mode === "rule_only") {
    return "Skipped";
  }

  if (decision.provider === "deterministic") {
    return "Fallback";
  }

  if (decision.fallback_used) {
    return "Fallback";
  }

  return "Completed";
});
const currentCompileStatus = computed(() => {
  if (compileRunState.value === "running") {
    if (compileReplayFinished.value && !pendingJob.value) {
      return "Waiting for compile response...";
    }

    return currentCompileStageDescription.value;
  }

  if (compileRunState.value === "finishing") {
    return "Final schema check passed. Preparing the updated preview.";
  }

  if (compileRunState.value === "failed") {
    return "Compile failed before FlowForge could show a valid preview.";
  }

  if (job.value && routerDecision.value) {
    return compileCompleteSummary(job.value, routerDecision.value);
  }

  if (job.value) {
    return "Compile finished. Blueprint generation: deterministic.";
  }

  return "Ready to compile.";
});
const compileSummaryItems = computed(() => {
  if (!job.value || compileRunState.value !== "complete") {
    return [];
  }

  return [
    {
      label: "Signal scan",
      value: pipelineStepStatus("rule_based_signal_scan"),
    },
    {
      label: "Risk review",
      value: pipelineStepStatus("rule_based_risk_review"),
    },
    {
      label: "Router",
      value: routerRunStatus.value,
    },
    {
      label: "Blueprint",
      value: pipelineStepStatus("dynamic_blueprint_preview"),
    },
    {
      label: "LLM calls",
      value: llmCallsLabel.value,
    },
    {
      label: "Provider",
      value: providerLabel(routerDecision.value?.provider),
    },
  ];
});
const aiUsageVisible = computed(() => {
  if (isCompiling.value) {
    return true;
  }

  return compileRunState.value !== "failed" && Boolean(job.value?.router_decision);
});
const providerPathCopy = computed(() => {
  if (isCompiling.value) {
    if (activeCompileMode.value === "demo" || activeCompileMode.value === "rule_only") {
      return "AI router skipped because this mode is deterministic.";
    }

    return "Groq is the primary router provider. Gemini is available as the fallback router provider.";
  }

  const currentJob = job.value;
  const decision = routerDecision.value;

  if (!currentJob || !decision) {
    return "Router usage will appear after the compile run finishes.";
  }

  if (currentJob.mode === "demo" || currentJob.mode === "rule_only") {
    return "AI router skipped because this mode is deterministic.";
  }

  if (decision.provider === "groq" && decision.used_ai) {
    return "Groq handled the router decision because it is the primary configured provider.";
  }

  if (decision.provider === "gemini" && decision.used_ai) {
    return "Groq failed or was unavailable, so Gemini handled the router decision.";
  }

  return "No valid AI router decision was available, so deterministic fallback handled routing.";
});
const routerInputItems = computed<TextDisplayItem[]>(() => {
  if (isCompiling.value) {
    return [
      { label: "Process text", value: "Submitted input" },
      { label: "Signal scan", value: "Pending" },
      { label: "Risk summary", value: "Pending" },
      { label: "Readiness score", value: "Pending" },
      { label: "Mode", value: activeCompileMode.value },
    ];
  }

  if (!job.value) {
    return [];
  }

  return [
    { label: "Process text", value: "Submitted input" },
    { label: "Signal scan", value: `${job.value.signals.workflow_primitives.length} primitives` },
    { label: "Risk summary", value: `${sentenceLabel(job.value.risks.risk_level)} risk` },
    { label: "Readiness score", value: `${job.value.readiness.score}/100` },
    { label: "Mode", value: job.value.mode },
  ];
});
const routerOutputItems = computed<TextDisplayItem[]>(() => {
  const decision = routerDecision.value;

  if (isCompiling.value || !decision) {
    return [
      { label: "Route", value: "Pending" },
      { label: "Confidence", value: "Pending" },
      { label: "Reason", value: "Pending" },
      { label: "Safety note", value: "Pending" },
      { label: "Suggested next step", value: "Pending" },
      {
        label: "Provider",
        value: activeCompileMode.value === "demo" || activeCompileMode.value === "rule_only" ? "Deterministic fallback" : "Pending",
      },
      { label: "Fallback used", value: "Pending" },
      { label: "LLM calls", value: usesAiRouter(activeCompileMode.value) ? "Pending" : "0 / 0" },
    ];
  }

  return [
    { label: "Route", value: routeLabel(decision.route) },
    { label: "Confidence", value: confidenceLabel(decision.confidence) },
    { label: "Reason", value: decision.reason },
    { label: "Safety note", value: decision.safety_note },
    { label: "Suggested next step", value: decision.suggested_next_step },
    { label: "Provider", value: providerLabel(decision.provider) },
    { label: "Fallback used", value: yesNo(decision.fallback_used) },
    { label: "LLM calls", value: llmCallsLabel.value },
  ];
});
const providerAttemptItems = computed<ProviderAttemptDisplay[]>(() => {
  const currentJob = job.value;
  const decision = routerDecision.value;

  if (isCompiling.value || !currentJob || !decision) {
    return [
      { provider: "Groq", status: usesAiRouter(activeCompileMode.value) ? "Pending" : "Skipped", detail: usesAiRouter(activeCompileMode.value) ? "Primary router provider." : "AI skipped for deterministic mode." },
      { provider: "Gemini", status: usesAiRouter(activeCompileMode.value) ? "Pending" : "Skipped", detail: usesAiRouter(activeCompileMode.value) ? "Fallback router provider." : "AI skipped for deterministic mode." },
      { provider: "Deterministic", status: usesAiRouter(activeCompileMode.value) ? "Pending" : "Used", detail: usesAiRouter(activeCompileMode.value) ? "Used only if no valid AI router decision is available." : "Routing handled by deterministic rules." },
    ];
  }

  return [
    providerAttemptStatus(currentJob, "groq"),
    providerAttemptStatus(currentJob, "gemini"),
    deterministicAttemptStatus(currentJob, decision),
  ];
});

const isLowRiskInternalPreview = computed(() => {
  return riskLevel.value === "low" && gateCount.value === 0;
});

const primaryGate = computed(() => {
  return compiledBlueprint.value?.human_approval_gates[0] ?? null;
});

const visibleWorkflowSteps = computed(() => {
  return compiledBlueprint.value?.steps ?? [];
});

const visibleRisks = computed(() => {
  return compiledBlueprint.value?.risks ?? [];
});

const visibleGates = computed(() => {
  return compiledBlueprint.value?.human_approval_gates ?? [];
});

const capabilityText = computed(() => {
  const steps = visibleWorkflowSteps.value;
  const capabilities = new Set<string>();

  for (const step of steps) {
    if (step.id === "intake_process" || step.id === "build_non_executing_preview") {
      continue;
    }

    if (step.primitive === "classification") {
      capabilities.add("classify the request");
    }

    if (step.primitive === "risk_detection") {
      capabilities.add("check the safety boundary");
    }

    if (step.primitive === "routing" || step.primitive === "escalation") {
      capabilities.add("route risky cases to a human");
    }

    if (step.primitive === "drafting") {
      capabilities.add("draft a response");
    }

    if (step.primitive === "notification") {
      capabilities.add("prepare notification drafts");
    }

    if (step.primitive === "record_creation") {
      capabilities.add("prepare an internal review task preview");
    }

    if (step.primitive === "extraction") {
      capabilities.add("extract useful fields");
    }

    if (step.primitive === "summarization") {
      capabilities.add("summarize the context");
    }

    if (step.primitive === "reporting") {
      capabilities.add("prepare a report preview");
    }
  }

  const list = [...capabilities];

  if (list.length === 0) {
    return "inspect the process and create a non-executing preview";
  }

  return new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format(list);
});

const plainEnglishResult = computed(() => {
  if (!compiledBlueprint.value) {
    return "";
  }

  if (isLowRiskInternalPreview.value) {
    return `FlowForge can ${capabilityText.value}. It does not connect to email or task systems yet.`;
  }

  return `FlowForge can ${capabilityText.value}. It keeps risky actions behind human approval and does not execute anything.`;
});

const primaryDecision = computed(() => {
  if (!compiledBlueprint.value) {
    return "";
  }

  if (compiledBlueprint.value.automation_boundary === "not_safe_to_automate") {
    return "Blocked from auto-running";
  }

  if (compiledBlueprint.value.automation_boundary === "human_approval_required") {
    return "Human approval required";
  }

  const routerDecision = job.value?.router_decision?.route;

  if (routerDecision === "compile_blueprint" && isLowRiskInternalPreview.value) {
    return "Internal preview";
  }

  if (compiledBlueprint.value.automation_boundary === "assistant_only") {
    return "Assistant-only preview";
  }

  return "Partially automatable";
});

const mainDecisionCopy = computed(() => {
  if (isLowRiskInternalPreview.value) {
    return "FlowForge produced a non-executing internal workflow preview. It can help prepare extraction and review-task steps, but it does not connect to email or task systems yet.";
  }

  return "FlowForge produced a non-executing workflow plan. Risky actions stay draft-only or human-approved.";
});

const policyLabels: Record<StepAutomationPolicy, { label: string; className: string }> = {
  automate: {
    label: "Automatable",
    className: "policy-safe",
  },
  draft_only: {
    label: "Draft only",
    className: "policy-draft",
  },
  assist_only: {
    label: "Assist only",
    className: "policy-assist",
  },
  human_approval: {
    label: "Human approval",
    className: "policy-approval",
  },
  not_recommended: {
    label: "Not recommended",
    className: "policy-blocked",
  },
  blocked_in_mvp: {
    label: "Blocked in MVP",
    className: "policy-blocked",
  },
};

function formatEnum(value: string): string {
  return value
    .split("_")
    .map((part) => (part === "mvp" ? "MVP" : part))
    .join(" ");
}

function sentenceLabel(value: string): string {
  const label = formatEnum(value);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function providerLabel(provider?: RouterDecision["provider"]): string {
  if (provider === "groq") {
    return "Groq";
  }

  if (provider === "gemini") {
    return "Gemini";
  }

  if (provider === "deterministic") {
    return "Deterministic fallback";
  }

  return "Pending";
}

function compileCompleteSummary(currentJob: CompileJob, decision: RouterDecision): string {
  if (currentJob.mode === "demo" || currentJob.mode === "rule_only") {
    return "Compile complete. FlowForge used deterministic routing and deterministic blueprint generation. No AI provider was called.";
  }

  if (decision.provider === "groq" && decision.used_ai) {
    return "Compile complete. FlowForge scanned the process with deterministic rules, used Groq only for the router decision, then built a deterministic non-executing blueprint.";
  }

  if (decision.provider === "gemini" && decision.used_ai) {
    return "Compile complete. Groq failed or was unavailable, Gemini handled the router decision, and the blueprint was built deterministically.";
  }

  return "Compile complete. AI routing was skipped or unavailable, so deterministic fallback handled the router decision. The blueprint was built deterministically.";
}

function routeLabel(route?: RouterDecision["route"]): string {
  return route ? sentenceLabel(route) : "Pending";
}

function confidenceLabel(confidence?: RouterDecision["confidence"]): string {
  return confidence ? sentenceLabel(confidence) : "Pending";
}

function statusLabel(status?: string): string {
  if (status === "done" || status === "completed") {
    return "Completed";
  }

  return status ? sentenceLabel(status) : "Pending";
}

function pipelineStepStatus(stepId: string): string {
  return statusLabel(job.value?.steps.find((step) => step.id === stepId)?.status);
}

function policyLabel(policy: StepAutomationPolicy): string {
  return policyLabels[policy]?.label ?? formatEnum(policy);
}

function policyClass(policy: StepAutomationPolicy): string {
  return policyLabels[policy]?.className ?? "policy-assist";
}

function riskClass(level: RiskLevel): string {
  return `risk-${level}`;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function textValue(value?: string | null): string {
  return value?.trim() ?? "";
}

function previewText(value?: string | null, limit = PREVIEW_TEXT_LIMIT): string {
  const text = textValue(value);

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 3)}...`;
}

function hasFullText(value?: string | null, limit = PREVIEW_TEXT_LIMIT): boolean {
  return textValue(value).length > limit;
}

function usesAiRouter(selectedMode: CompileMode): boolean {
  return selectedMode === "balanced" || selectedMode === "full";
}

function getStageDescription(stage: CompileStage, selectedMode: CompileMode): string {
  if (stage.id === "provider") {
    return usesAiRouter(selectedMode)
      ? stage.aiDescription ?? stage.description
      : stage.demoDescription ?? stage.description;
  }

  return stage.description;
}

function providerAttemptStatus(currentJob: CompileJob, provider: "groq" | "gemini"): ProviderAttemptDisplay {
  const traceEvent = currentJob.agent_trace.find((event) => event.action === `Router attempt: ${provider}`);
  const providerName = providerLabel(provider);

  if (!traceEvent) {
    return {
      provider: providerName,
      status: "Not used",
      detail: provider === "groq" ? "Primary router provider was not reached." : "Fallback router provider was not reached.",
    };
  }

  if (traceEvent.status === "completed") {
    return {
      provider: providerName,
      status: "Completed",
      detail: provider === "groq"
        ? "Returned a validated constrained JSON router decision."
        : "Returned a validated constrained JSON router decision after Groq was unavailable or failed.",
    };
  }

  if (traceEvent.status === "skipped") {
    return {
      provider: providerName,
      status: "Skipped",
      detail: traceEvent.reason ?? "Provider was skipped before any HTTP call.",
    };
  }

  return {
    provider: providerName,
    status: "Failed",
    detail: traceEvent.reason ?? "Provider call failed or returned an invalid router decision.",
  };
}

function deterministicAttemptStatus(currentJob: CompileJob, decision: RouterDecision): ProviderAttemptDisplay {
  const traceEvent = currentJob.agent_trace.find((event) => event.action === "Router attempt: deterministic");

  if (traceEvent?.status === "completed" || decision.provider === "deterministic") {
    return {
      provider: "Deterministic",
      status: "Used",
      detail: currentJob.mode === "demo" || currentJob.mode === "rule_only"
        ? "Routing was deterministic because this mode does not call AI providers."
        : "Fallback routing handled the request after no valid AI router decision was available.",
    };
  }

  return {
    provider: "Deterministic",
    status: "Not used",
    detail: "A validated AI router decision was available, so fallback routing was not needed.",
  };
}

function compileStageState(index: number): "complete" | "active" | "pending" {
  if (compileRunComplete.value) {
    return "complete";
  }

  if (compileRunState.value === "failed") {
    if (index < activeCompileStageIndex.value) {
      return "complete";
    }

    if (index === activeCompileStageIndex.value) {
      return "active";
    }

    return "pending";
  }

  if (!compileRunVisible.value) {
    return "pending";
  }

  if (index < activeCompileStageIndex.value) {
    return "complete";
  }

  if (index === activeCompileStageIndex.value) {
    return "active";
  }

  return "pending";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      compileReplayTimers.delete(timer);
      resolve();
    }, ms);

    compileReplayTimers.add(timer);
  });
}

function clearCompileReplayTimers() {
  for (const timer of compileReplayTimers) {
    window.clearTimeout(timer);
  }

  compileReplayTimers.clear();
}

async function runCompileReplay(runToken: number) {
  compileReplayFinished.value = false;

  for (let index = 0; index < compileStages.length; index += 1) {
    if (runToken !== compileRunToken || compileRunState.value === "failed") {
      return;
    }

    activeCompileStageIndex.value = index;
    await sleep(compileStages[index]?.durationMs ?? 900);
  }

  if (runToken === compileRunToken && compileRunState.value !== "failed") {
    compileReplayFinished.value = true;
  }
}

function chooseExample(value: string) {
  processInput.value = value;
}

function resetExpandedState() {
  expandedSteps.value = {};
  expandedRisks.value = {};
  expandedGates.value = {};
  expandedSections.value = {
    trigger: false,
    risks: false,
    gates: false,
    dryRuns: false,
    beforeImplementation: false,
    technicalTrace: false,
  };
}

function toggleStep(stepId: string) {
  expandedSteps.value = {
    ...expandedSteps.value,
    [stepId]: !expandedSteps.value[stepId],
  };
}

function toggleRisk(riskId: string) {
  expandedRisks.value = {
    ...expandedRisks.value,
    [riskId]: !expandedRisks.value[riskId],
  };
}

function toggleGate(gateId: string) {
  expandedGates.value = {
    ...expandedGates.value,
    [gateId]: !expandedGates.value[gateId],
  };
}

function toggleSection(section: keyof typeof expandedSections.value) {
  expandedSections.value = {
    ...expandedSections.value,
    [section]: !expandedSections.value[section],
  };
}

function isStepExpanded(step: WorkflowStep): boolean {
  return Boolean(expandedSteps.value[step.id]);
}

function isRiskExpanded(risk: RiskItem): boolean {
  return Boolean(expandedRisks.value[risk.id]);
}

function isGateExpanded(gate: HumanApprovalGate): boolean {
  return Boolean(expandedGates.value[gate.id]);
}

async function compilePreview() {
  if (isCompiling.value) {
    return;
  }

  errorMessage.value = "";
  pendingJob.value = null;
  isCompiling.value = true;
  compileRunState.value = "running";
  activeCompileStageIndex.value = 0;
  compileReplayFinished.value = false;
  const runToken = compileRunToken + 1;
  compileRunToken = runToken;
  resetExpandedState();

  const requestPromise = $fetch<CompileJob>("/api/compile", {
    method: "POST",
    body: {
      input: processInput.value,
      mode: mode.value,
    },
  }).then((result) => {
    if (runToken === compileRunToken) {
      pendingJob.value = result;
    }

    return result;
  });

  try {
    const [result] = await Promise.all([
      requestPromise,
      runCompileReplay(runToken),
    ]);

    if (runToken !== compileRunToken) {
      return;
    }

    pendingJob.value = result;
    compileRunState.value = "finishing";
    activeCompileStageIndex.value = compileStages.length - 1;

    await sleep(FINAL_STAGE_HOLD_MS);

    if (runToken !== compileRunToken) {
      return;
    }

    job.value = result;
    pendingJob.value = null;
    compileRunState.value = "complete";
  } catch (error) {
    if (runToken === compileRunToken) {
      clearCompileReplayTimers();
      pendingJob.value = null;
      compileRunState.value = "failed";
      errorMessage.value =
        error instanceof Error ? error.message : "Compile preview failed.";
    }
  } finally {
    if (runToken === compileRunToken) {
      isCompiling.value = false;
    }
  }
}

onBeforeUnmount(() => {
  compileRunToken += 1;
  clearCompileReplayTimers();
});
</script>

<template>
  <main class="ff-page">
    <section class="ff-shell">
      <header class="ff-topbar">
        <NuxtLink to="/" class="ff-brand" aria-label="FlowForge home">
          <span class="ff-brand-mark">F</span>
          <span>FlowForge</span>
        </NuxtLink>

        <nav class="ff-nav" aria-label="Primary navigation">
          <span class="ff-status ff-status-neutral">Compiler preview</span>
          <NuxtLink to="/" class="ff-toplink">Home</NuxtLink>
        </nav>
      </header>

      <section class="ff-grid compiler-grid" aria-label="Compiler workspace">
        <form class="ff-tile input-tile" @submit.prevent="compilePreview">
          <div class="ff-tile-inner input-inner">
            <div class="input-head">
              <div>
                <p class="ff-kicker">Input</p>
                <h1 class="ff-page-title">Describe the process.</h1>
              </div>
              <span class="ff-status ff-status-neutral">{{ mode }}</span>
            </div>

            <label class="ff-field-label" for="process-input">
              Process
              <textarea
                id="process-input"
                v-model="processInput"
                class="ff-textarea"
                :disabled="isCompiling"
                placeholder="When a customer asks for a refund, classify the request, draft a reply, and route risky cases to a human."
              />
            </label>

            <div class="compact-row" aria-label="Example processes">
              <button
                v-for="example in examples"
                :key="example.label"
                type="button"
                :class="['ff-chip-button', { 'is-active': activeExample === example.label }]"
                @click="chooseExample(example.value)"
              >
                {{ example.label }}
              </button>
            </div>

            <div class="input-actions">
              <fieldset class="mode-group">
                <legend>Mode</legend>
                <label v-for="item in modes" :key="item.value" class="mode-option">
                  <input
                    v-model="mode"
                    type="radio"
                    name="mode"
                    :value="item.value"
                    :disabled="isCompiling"
                  />
                  <span>{{ item.label }}</span>
                </label>
              </fieldset>

              <button class="ff-button compile-button" type="submit" :disabled="isCompiling">
                {{ isCompiling ? "Building..." : "Compile preview" }}
              </button>
            </div>
          </div>
        </form>

        <article v-if="errorMessage" class="ff-tile error-tile">
          <div class="ff-tile-inner">
            <p class="ff-kicker">Error</p>
            <h2 class="ff-page-title">Compile failed</h2>
            <p class="ff-copy">{{ errorMessage }}</p>
          </div>
        </article>

        <article
          v-if="compileRunVisible"
          :class="[
            'ff-tile',
            'compile-run-tile',
            {
              'is-running': compileRunState === 'running' || compileRunState === 'finishing',
              'is-complete': compileRunComplete,
              'is-failed': compileRunState === 'failed',
            },
          ]"
          :aria-busy="isCompiling"
          aria-live="polite"
        >
          <div class="ff-tile-inner compile-run-inner">
            <div class="compile-run-head">
              <div>
                <p class="ff-kicker">Compile run</p>
                <h2 class="ff-section-title">{{ compileRunTitle }}</h2>
                <p class="ff-copy compile-run-status">{{ currentCompileStatus }}</p>
              </div>

              <span :class="['ff-status', compileRunStateClass]">
                {{ compileRunStateLabel }}
              </span>
            </div>

            <div
              class="compile-progress-track"
              :style="{ '--compile-progress': compileProgressPercent }"
              aria-hidden="true"
            >
              <span
                v-for="(stage, index) in compileStages"
                :key="`${stage.id}-segment`"
                :class="['compile-progress-segment', `is-${compileStageState(index)}`]"
              />
            </div>

            <ol v-if="isCompiling" class="compile-stage-list">
              <li
                v-for="(stage, index) in compileStages"
                :key="stage.id"
                :class="['compile-stage-item', `is-${compileStageState(index)}`]"
                :aria-current="compileStageState(index) === 'active' ? 'step' : undefined"
              >
                <span class="compile-stage-marker" aria-hidden="true">
                  <span v-if="compileStageState(index) !== 'complete'">{{ index + 1 }}</span>
                </span>
                <span class="compile-stage-copy">
                  <strong>{{ stage.label }}</strong>
                  <small>{{ getStageDescription(stage, activeCompileMode) }}</small>
                </span>
              </li>
            </ol>

            <dl
              v-else-if="job && compileRunState === 'complete'"
              class="compile-summary-grid"
              aria-label="Compile run summary"
            >
              <div v-for="item in compileSummaryItems" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article v-if="aiUsageVisible" class="ff-tile ai-usage-tile">
          <div class="ff-tile-inner ai-router-inner">
            <div class="ai-router-head">
              <div>
                <p class="ff-kicker">AI router explanation</p>
                <h2 class="ff-section-title">AI router explanation</h2>
              </div>
              <span class="ff-status ff-status-neutral">Router only</span>
            </div>

            <div class="ai-explanation-grid">
              <section class="ai-explanation-card">
                <h3>Router role</h3>
                <p>{{ routerRoleCopy }}</p>
                <p>AI providers return only a constrained JSON router decision, and FlowForge validates that decision before using it.</p>
              </section>

              <section class="ai-explanation-card">
                <h3>Provider path</h3>
                <p>{{ providerPathCopy }}</p>
                <ul class="provider-attempt-list" aria-label="Provider attempts">
                  <li v-for="item in providerAttemptItems" :key="item.provider">
                    <span class="provider-attempt-name">{{ item.provider }}</span>
                    <span class="provider-attempt-status">{{ item.status }}</span>
                    <small>{{ item.detail }}</small>
                  </li>
                </ul>
              </section>

              <section class="ai-explanation-card">
                <h3>Router inputs</h3>
                <ul class="router-input-list" aria-label="Router inputs">
                  <li v-for="item in routerInputItems" :key="item.label">
                    <strong>{{ item.label }}</strong>
                    <span>{{ item.value }}</span>
                  </li>
                </ul>
              </section>

              <section class="ai-explanation-card router-output-card">
                <h3>Router output</h3>
                <dl class="router-output-grid">
                  <div v-for="item in routerOutputItems" :key="item.label">
                    <dt>{{ item.label }}</dt>
                    <dd>
                      <span>{{ previewText(item.value) }}</span>
                      <details v-if="hasFullText(item.value)" class="expandable-text">
                        <summary>Show full</summary>
                        <p>{{ textValue(item.value) }}</p>
                      </details>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <p class="ff-copy ai-boundary-copy">
              {{ deterministicBoundaryCopy }} The blueprint builder then created a deterministic non-executing preview.
            </p>
          </div>
        </article>

        <article v-if="compileRunState !== 'failed' && !isCompiling && !job" class="ff-tile result-state-tile">
          <div class="ff-tile-inner result-state-inner">
            <p class="ff-kicker">Ready</p>
            <h2 class="ff-page-title">
              Paste a process or choose an example, then run a safe compile preview.
            </h2>
          </div>
        </article>

        <template v-else-if="compiledBlueprint">
          <article
            :class="['ff-tile', 'result-hero-tile', { 'is-updating': isCompiling }]"
            :aria-busy="isCompiling"
          >
            <div class="ff-tile-inner result-hero-inner">
              <div class="result-hero-main">
                <p class="ff-kicker">Result</p>
                <h2 class="result-title">{{ compiledBlueprint.workflow_name }}</h2>
                <p class="result-summary">{{ plainEnglishResult }}</p>
              </div>

              <div class="hero-badges" aria-label="Compile status">
                <span class="policy-badge policy-approval">{{ primaryDecision }}</span>
                <span :class="['policy-badge', riskClass(riskLevel)]">{{ riskLevel }} risk</span>
                <span class="policy-badge policy-safe">No execution</span>
              </div>

              <dl class="result-metrics" aria-label="Compile summary">
                <div>
                  <dt>Steps</dt>
                  <dd>{{ compiledBlueprint.steps.length }}</dd>
                </div>
                <div>
                  <dt>Gates</dt>
                  <dd>{{ gateCount }}</dd>
                </div>
                <div>
                  <dt>LLM</dt>
                  <dd>{{ llmCallsUsed }}</dd>
                </div>
              </dl>
            </div>
            <span v-if="isCompiling" class="result-update-badge">Updating preview...</span>
          </article>

          <article class="ff-tile decision-tile">
            <div class="ff-tile-inner decision-inner">
              <div>
                <p class="ff-kicker">Main decision</p>
                <h2 class="ff-section-title">Plan first. Execute later.</h2>
                <p class="ff-copy">{{ mainDecisionCopy }}</p>
              </div>

              <div v-if="primaryGate" class="primary-gate">
                <span class="policy-badge policy-approval">Main approval</span>
                <strong>{{ primaryGate.label }}</strong>
                <span>{{ primaryGate.reason }}</span>
              </div>
            </div>
          </article>

          <article v-if="job?.router_decision" class="ff-tile router-tile">
            <div class="ff-tile-inner router-inner">
              <div class="router-main">
                <p class="ff-kicker">Router decision</p>
                <h2 class="ff-section-title">Route: {{ routeLabel(job.router_decision.route) }}</h2>
                <div class="expandable-copy">
                  <strong>Reason</strong>
                  <p>{{ previewText(job.router_decision.reason) }}</p>
                  <details v-if="hasFullText(job.router_decision.reason)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(job.router_decision.reason) }}</p>
                  </details>
                </div>
                <div class="expandable-copy">
                  <strong>Safety note</strong>
                  <p>{{ previewText(job.router_decision.safety_note) }}</p>
                  <details v-if="hasFullText(job.router_decision.safety_note)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(job.router_decision.safety_note) }}</p>
                  </details>
                </div>
                <div class="expandable-copy">
                  <strong>Next step</strong>
                  <p>{{ previewText(job.router_decision.suggested_next_step) }}</p>
                  <details v-if="hasFullText(job.router_decision.suggested_next_step)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(job.router_decision.suggested_next_step) }}</p>
                  </details>
                </div>
              </div>
              <div class="router-metrics">
                <span class="policy-badge">Provider: {{ providerLabel(job.router_decision.provider) }}</span>
                <span class="policy-badge">Confidence: {{ confidenceLabel(job.router_decision.confidence) }}</span>
              </div>
            </div>
          </article>

          <section class="blueprint-section workflow-section" aria-labelledby="workflow-plan-title">
            <div class="section-head">
              <div>
                <p class="ff-kicker">Workflow plan</p>
                <h2 id="workflow-plan-title" class="ff-section-title">What happens next</h2>
              </div>
              <span class="ff-status ff-status-neutral">{{ visibleWorkflowSteps.length }} steps</span>
            </div>

            <ol class="workflow-list">
              <li
                v-for="(step, index) in visibleWorkflowSteps"
                :key="step.id"
                :class="['workflow-card', riskClass(step.risk_level)]"
              >
                <button class="workflow-summary" type="button" @click="toggleStep(step.id)">
                  <span class="step-number">{{ index + 1 }}</span>

                  <span class="workflow-title-block">
                    <strong>{{ step.label }}</strong>
                    <small>{{ step.description }}</small>
                  </span>

                  <span class="workflow-badges">
                    <span :class="['policy-badge', policyClass(step.automation_policy)]">
                      {{ policyLabel(step.automation_policy) }}
                    </span>
                    <span
                      v-if="step.risk_level !== 'low'"
                      :class="['policy-badge', riskClass(step.risk_level)]"
                    >
                      {{ step.risk_level }}
                    </span>
                    <span v-if="step.approval_required" class="policy-badge policy-approval">
                      Approval
                    </span>
                  </span>

                  <span class="expand-label">
                    {{ isStepExpanded(step) ? "Hide" : "Details" }}
                  </span>
                </button>

                <div v-if="isStepExpanded(step)" class="workflow-details">
                  <dl class="meta-grid" aria-label="Step details">
                    <div>
                      <dt>Primitive</dt>
                      <dd>{{ formatEnum(step.primitive) }}</dd>
                    </div>
                    <div>
                      <dt>Actor</dt>
                      <dd>{{ formatEnum(step.actor) }}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd>{{ policyLabel(step.automation_policy) }}</dd>
                    </div>
                    <div>
                      <dt>Risk</dt>
                      <dd>{{ step.risk_level }}</dd>
                    </div>
                    <div>
                      <dt>Approval</dt>
                      <dd>{{ yesNo(step.approval_required) }}</dd>
                    </div>
                    <div>
                      <dt>Execution</dt>
                      <dd>{{ formatEnum(step.real_world_execution) }}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            </ol>
          </section>

          <section class="blueprint-section compact-section" aria-label="Key safety output">
            <div class="section-head">
              <div>
                <p class="ff-kicker">Safety output</p>
                <h2 class="ff-section-title">What is allowed, gated, or blocked</h2>
              </div>
            </div>

            <div class="safety-grid">
              <article class="safety-card">
                <span class="policy-badge policy-safe">Safe</span>
                <h3>Can automate</h3>
                <ul>
                  <li v-for="item in compiledBlueprint.safe_to_automate.slice(0, 4)" :key="item">
                    {{ item }}
                  </li>
                </ul>
              </article>

              <article class="safety-card">
                <span class="policy-badge policy-approval">Approval</span>
                <h3>Needs human review</h3>
                <ul>
                  <li v-for="item in compiledBlueprint.needs_human_approval.slice(0, 4)" :key="item">
                    {{ item }}
                  </li>
                </ul>
              </article>

              <article class="safety-card">
                <span class="policy-badge policy-blocked">Blocked</span>
                <h3>Must not auto-run</h3>
                <ul>
                  <li v-for="item in compiledBlueprint.not_safe_to_automate.slice(0, 4)" :key="item">
                    {{ item }}
                  </li>
                </ul>
              </article>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('gates')">
              <span>
                <span class="ff-kicker">Human gates</span>
                <strong>Approval requirements</strong>
              </span>
              <span class="section-toggle-right">
                <span class="ff-status ff-status-approval">{{ visibleGates.length }} gates</span>
                <span>{{ expandedSections.gates ? "Hide" : "Show" }}</span>
              </span>
            </button>

            <div v-if="expandedSections.gates" class="output-grid">
              <article v-if="visibleGates.length === 0" class="output-card">
                <h3>No approval gates generated</h3>
                <p>
                  The scanner did not detect a gate-worthy risk, but the preview still does not execute external actions.
                </p>
              </article>

              <article v-for="gate in visibleGates" :key="gate.id" class="output-card">
                <button class="card-toggle" type="button" @click="toggleGate(gate.id)">
                  <strong>{{ gate.label }}</strong>
                  <span>{{ isGateExpanded(gate) ? "Hide checklist" : "Show checklist" }}</span>
                </button>

                <p>{{ gate.reason }}</p>

                <ul v-if="isGateExpanded(gate)" class="checklist">
                  <li v-for="item in gate.review_checklist" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('risks')">
              <span>
                <span class="ff-kicker">Risks</span>
                <strong>Why this decision happened</strong>
              </span>
              <span class="section-toggle-right">
                <span :class="['ff-status', riskClass(riskLevel)]">{{ riskLevel }}</span>
                <span>{{ expandedSections.risks ? "Hide" : "Show" }}</span>
              </span>
            </button>

            <div v-if="expandedSections.risks" class="output-grid">
              <article v-if="visibleRisks.length === 0" class="output-card">
                <h3>No obvious risk flags detected</h3>
                <p>
                  FlowForge still keeps this as a non-executing preview until a human verifies the workflow boundary.
                </p>
              </article>

              <article
                v-for="risk in visibleRisks"
                :key="risk.id"
                :class="['output-card', riskClass(risk.risk_level)]"
              >
                <button class="card-toggle" type="button" @click="toggleRisk(risk.id)">
                  <strong>{{ risk.label }}</strong>
                  <span :class="['policy-badge', riskClass(risk.risk_level)]">
                    {{ risk.risk_level }}
                  </span>
                </button>

                <div v-if="isRiskExpanded(risk)" class="card-expanded">
                  <p><strong>Reason:</strong> {{ risk.reason }}</p>
                  <p><strong>Recommendation:</strong> {{ risk.recommendation }}</p>
                </div>
              </article>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('trigger')">
              <span>
                <span class="ff-kicker">Trigger</span>
                <strong>Input and inferred trigger</strong>
              </span>
              <span>{{ expandedSections.trigger ? "Hide" : "Show" }}</span>
            </button>

            <div v-if="expandedSections.trigger" class="ff-tile nested-tile">
              <div class="ff-tile-inner">
                <div class="expandable-copy">
                  <strong>Summary</strong>
                  <p>{{ previewText(compiledBlueprint.summary) }}</p>
                  <details v-if="hasFullText(compiledBlueprint.summary)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(compiledBlueprint.summary) }}</p>
                  </details>
                </div>

                <div v-if="job?.input.trimmed" class="expandable-copy">
                  <strong>Submitted process</strong>
                  <p>{{ previewText(job.input.trimmed) }}</p>
                  <details v-if="hasFullText(job.input.trimmed)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(job.input.trimmed) }}</p>
                  </details>
                </div>

                <dl class="meta-grid trigger-grid" aria-label="Trigger details">
                  <div>
                    <dt>Trigger type</dt>
                    <dd>{{ formatEnum(compiledBlueprint.trigger.type) }}</dd>
                  </div>
                  <div>
                    <dt>Trigger source</dt>
                    <dd>{{ compiledBlueprint.trigger.source ?? "Not specified" }}</dd>
                  </div>
                  <div>
                    <dt>Boundary</dt>
                    <dd>{{ formatEnum(compiledBlueprint.automation_boundary) }}</dd>
                  </div>
                  <div>
                    <dt>Description</dt>
                    <dd>
                      <span>{{ previewText(compiledBlueprint.trigger.description) }}</span>
                      <details v-if="hasFullText(compiledBlueprint.trigger.description)" class="expandable-text">
                        <summary>Show full</summary>
                        <p>{{ textValue(compiledBlueprint.trigger.description) }}</p>
                      </details>
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('dryRuns')">
              <span>
                <span class="ff-kicker">Dry runs</span>
                <strong>Generated test cases</strong>
              </span>
              <span class="section-toggle-right">
                <span class="ff-status ff-status-neutral">{{ compiledBlueprint.test_cases.length }} cases</span>
                <span>{{ expandedSections.dryRuns ? "Hide" : "Show" }}</span>
              </span>
            </button>

            <div v-if="expandedSections.dryRuns" class="output-grid">
              <article
                v-for="testCase in compiledBlueprint.test_cases"
                :key="testCase.id"
                class="output-card"
              >
                <div class="output-card-head">
                  <h3>{{ testCase.name }}</h3>
                  <span
                    :class="[
                      'policy-badge',
                      testCase.expected_human_gate ? 'policy-approval' : 'policy-safe',
                    ]"
                  >
                    {{ testCase.expected_human_gate ? "Human gate" : "No gate" }}
                  </span>
                </div>

                <div class="expandable-copy">
                  <strong>Input event</strong>
                  <p>{{ previewText(testCase.input_event) }}</p>
                  <details v-if="hasFullText(testCase.input_event)" class="expandable-text">
                    <summary>Show full</summary>
                    <p>{{ textValue(testCase.input_event) }}</p>
                  </details>
                </div>

                <dl class="meta-grid mini-grid">
                  <div>
                    <dt>Expected route</dt>
                    <dd>{{ formatEnum(testCase.expected_route) }}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>
                      <span>{{ previewText(testCase.reason) }}</span>
                      <details v-if="hasFullText(testCase.reason)" class="expandable-text">
                        <summary>Show full</summary>
                        <p>{{ textValue(testCase.reason) }}</p>
                      </details>
                    </dd>
                  </div>
                </dl>
              </article>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('beforeImplementation')">
              <span>
                <span class="ff-kicker">Before implementation</span>
                <strong>Assumptions and open questions</strong>
              </span>
              <span class="section-toggle-right">
                <span class="ff-status ff-status-neutral">{{ compiledBlueprint.open_questions.length }} questions</span>
                <span>{{ expandedSections.beforeImplementation ? "Hide" : "Show" }}</span>
              </span>
            </button>

            <div v-if="expandedSections.beforeImplementation" class="output-grid">
              <article class="output-card">
                <h3>Assumptions</h3>
                <ul class="checklist">
                  <li v-for="assumption in compiledBlueprint.assumptions" :key="assumption">
                    {{ assumption }}
                  </li>
                </ul>
              </article>

              <article class="output-card">
                <h3>Clarify before building</h3>
                <ul class="checklist">
                  <li v-for="question in compiledBlueprint.open_questions" :key="question">
                    {{ question }}
                  </li>
                </ul>
              </article>
            </div>
          </section>

          <section class="blueprint-section">
            <button class="section-toggle" type="button" @click="toggleSection('technicalTrace')">
              <span>
                <span class="ff-kicker">Technical trace</span>
                <strong>Developer details</strong>
              </span>
              <span>{{ expandedSections.technicalTrace ? "Hide" : "Show" }}</span>
            </button>

            <div v-if="expandedSections.technicalTrace" class="output-grid">
              <article class="output-card">
                <h3>Pipeline</h3>
                <ol class="detail-list">
                  <li v-for="step in technicalPipelineSteps" :key="step.id">
                    <strong>{{ step.label }}</strong>
                    <span>{{ previewText(step.output_summary) }}</span>
                    <details v-if="hasFullText(step.output_summary)" class="expandable-text">
                      <summary>Show full</summary>
                      <p>{{ textValue(step.output_summary) }}</p>
                    </details>
                  </li>
                </ol>
              </article>

              <article v-if="technicalTokenUsage" class="output-card">
                <h3>Token usage</h3>
                <dl class="meta-grid mini-grid">
                  <div>
                    <dt>Mode</dt>
                    <dd>{{ technicalTokenUsage.mode }}</dd>
                  </div>
                  <div>
                    <dt>LLM calls</dt>
                    <dd>{{ technicalTokenUsage.llm_calls_used }} / {{ technicalTokenUsage.llm_calls_limit }}</dd>
                  </div>
                  <div>
                    <dt>Rule checks</dt>
                    <dd>{{ technicalTokenUsage.rule_based_checks }}</dd>
                  </div>
                </dl>
              </article>

              <article class="output-card">
                <h3>Agent trace</h3>
                <ul class="detail-list">
                  <li v-for="event in technicalAgentTrace" :key="event.id">
                    <strong>{{ event.action }}</strong>
                    <span>{{ event.status }}</span>
                    <template v-if="event.reason">
                      <small>Reason</small>
                      <span>{{ previewText(event.reason) }}</span>
                      <details v-if="hasFullText(event.reason)" class="expandable-text">
                        <summary>Show full</summary>
                        <p>{{ textValue(event.reason) }}</p>
                      </details>
                    </template>
                    <template v-if="event.output_summary">
                      <small>Output</small>
                      <span>{{ previewText(event.output_summary) }}</span>
                      <details v-if="hasFullText(event.output_summary)" class="expandable-text">
                        <summary>Show full</summary>
                        <p>{{ textValue(event.output_summary) }}</p>
                      </details>
                    </template>
                  </li>
                </ul>
              </article>
            </div>
          </section>
        </template>
      </section>
    </section>
  </main>
</template>

<style scoped>
.compiler-grid {
  grid-auto-flow: dense;
}

.input-tile {
  grid-column: span 8;
}

.result-hero-tile {
  grid-column: span 4;
}

.input-inner {
  display: grid;
  gap: 14px;
}

.input-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.compact-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.input-actions {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.mode-group legend {
  width: 100%;
  color: var(--ff-muted);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.mode-option {
  position: relative;
}

.mode-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mode-option span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--ff-border);
  border-radius: 999px;
  background: #ffffff;
  color: var(--ff-muted);
  font-size: 0.82rem;
  font-weight: 850;
  cursor: pointer;
}

.mode-option input:checked + span {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
  color: var(--ff-primary-strong);
}

.compile-button {
  flex: 0 0 auto;
}

.error-tile,
.compile-run-tile,
.result-state-tile,
.decision-tile,
.ai-usage-tile,
.router-tile,
.blueprint-section {
  grid-column: span 12;
}

.compile-run-tile.is-running {
  border-color: var(--ff-primary);
  box-shadow: 0 0 0 3px var(--ff-primary-soft), var(--ff-shadow);
}

.compile-run-tile.is-failed {
  border-color: #f2b8b5;
  box-shadow: 0 0 0 3px var(--ff-blocked-soft), var(--ff-shadow);
}

@media (prefers-reduced-motion: no-preference) {
  .compile-run-tile.is-running {
    animation: compile-run-pulse 1.8s ease-in-out infinite;
  }
}

@keyframes compile-run-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px var(--ff-primary-soft), var(--ff-shadow);
  }

  50% {
    box-shadow: 0 0 0 6px rgba(0, 124, 120, 0.16), var(--ff-shadow);
  }
}

.compile-run-inner {
  display: grid;
  gap: 14px;
}

.compile-run-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.compile-run-status {
  margin-top: 6px;
}

.compile-progress-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}

.compile-progress-track::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--compile-progress);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ff-primary) 15%, transparent);
  content: "";
  pointer-events: none;
}

.compile-progress-segment {
  position: relative;
  z-index: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--ff-neutral-soft);
}

.compile-progress-segment.is-complete {
  background: var(--ff-safe);
}

.compile-progress-segment.is-active {
  background: var(--ff-primary);
}

.compile-stage-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.compile-stage-item {
  display: grid;
  min-width: 0;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  align-items: flex-start;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: #ffffff;
}

.compile-stage-item.is-active {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
}

.compile-stage-item.is-complete {
  border-color: #b7ebcb;
  background: #f7fff9;
}

.compile-stage-item.is-pending {
  opacity: 0.62;
}

.compile-stage-marker {
  position: relative;
  display: inline-grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid var(--ff-border);
  border-radius: 999px;
  background: #ffffff;
  color: var(--ff-muted);
  font-size: 0.76rem;
  font-weight: 950;
}

.compile-stage-item.is-active .compile-stage-marker {
  border-color: var(--ff-primary);
  background: var(--ff-primary);
  color: #ffffff;
}

.compile-stage-item.is-complete .compile-stage-marker {
  border-color: var(--ff-safe);
  background: var(--ff-safe);
}

.compile-stage-item.is-complete .compile-stage-marker::after {
  width: 6px;
  height: 10px;
  border-right: 2px solid #ffffff;
  border-bottom: 2px solid #ffffff;
  content: "";
  transform: rotate(45deg) translate(-1px, -1px);
}

.compile-stage-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.compile-stage-copy strong {
  color: var(--ff-ink);
  font-size: 0.88rem;
  line-height: 1.2;
}

.compile-stage-copy small {
  color: var(--ff-muted);
  font-size: 0.78rem;
  line-height: 1.3;
}

.compile-summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.compile-summary-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: var(--ff-surface-muted);
}

.compile-summary-grid dt {
  color: var(--ff-muted);
  font-size: 0.7rem;
  font-weight: 950;
  text-transform: uppercase;
}

.compile-summary-grid dd {
  margin: 3px 0 0;
  color: var(--ff-ink);
  font-size: 0.86rem;
  font-weight: 900;
  overflow-wrap: anywhere;
}

.result-state-inner {
  display: grid;
  min-height: 170px;
  align-content: center;
}

.result-hero-tile {
  position: relative;
}

.result-hero-tile.is-updating {
  border-color: var(--ff-primary);
}

.result-hero-tile.is-updating .result-hero-inner {
  opacity: 0.68;
}

.result-update-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border: 1px solid var(--ff-primary);
  border-radius: 999px;
  background: #ffffff;
  color: var(--ff-primary-strong);
  font-size: 0.74rem;
  font-weight: 950;
  box-shadow: var(--ff-shadow);
}

.result-hero-inner {
  display: grid;
  gap: 22px;
}

.result-hero-main {
  display: grid;
  gap: 10px;
}

.result-title {
  margin: 0;
  color: var(--ff-ink);
  font-size: clamp(1.75rem, 4vw, 2.8rem);
  line-height: 1.02;
}

.result-summary {
  margin: 0;
  color: var(--ff-muted);
  font-size: 1rem;
  line-height: 1.45;
}

.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.result-metrics div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 12px;
  background: var(--ff-surface-muted);
}

.result-metrics dt {
  color: var(--ff-muted);
  font-size: 0.74rem;
  font-weight: 900;
  text-transform: uppercase;
}

.result-metrics dd {
  margin: 0;
  color: var(--ff-ink);
  font-size: 1.05rem;
  font-weight: 950;
}

.decision-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 360px);
  gap: 18px;
  align-items: stretch;
}

.ai-router-inner {
  display: grid;
  gap: 16px;
}

.ai-router-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.ai-explanation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ai-explanation-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: var(--ff-surface-muted);
}

.ai-explanation-card h3 {
  margin: 0 0 8px;
  color: var(--ff-ink);
  font-size: 0.98rem;
}

.ai-explanation-card p,
.ai-boundary-copy {
  margin: 0;
}

.ai-explanation-card p + p {
  margin-top: 8px;
}

.router-output-card {
  grid-column: 1 / -1;
}

.provider-attempt-list,
.router-input-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.provider-attempt-list li,
.router-input-list li {
  display: grid;
  min-width: 0;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 8px;
  background: #ffffff;
}

.provider-attempt-name,
.router-input-list strong {
  color: var(--ff-ink);
  font-size: 0.86rem;
  font-weight: 950;
}

.provider-attempt-status,
.router-input-list span {
  color: var(--ff-primary-strong);
  font-size: 0.78rem;
  font-weight: 950;
  text-transform: uppercase;
}

.provider-attempt-list small {
  color: var(--ff-muted);
  font-size: 0.82rem;
  line-height: 1.35;
}

.router-output-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.router-output-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 8px;
  background: #ffffff;
}

.router-output-grid dt {
  color: var(--ff-muted);
  font-size: 0.7rem;
  font-weight: 950;
  text-transform: uppercase;
}

.router-output-grid dd {
  margin: 4px 0 0;
  color: var(--ff-ink);
  font-size: 0.88rem;
  font-weight: 850;
  overflow-wrap: anywhere;
}

.expandable-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.expandable-copy > strong {
  color: var(--ff-ink);
  font-size: 0.84rem;
  font-weight: 950;
}

.expandable-copy p,
.expandable-text p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.expandable-copy p {
  color: var(--ff-muted);
  font-size: 0.92rem;
  line-height: 1.4;
}

.expandable-text {
  margin-top: 4px;
}

.expandable-text summary {
  width: fit-content;
  color: var(--ff-primary-strong);
  font-size: 0.78rem;
  font-weight: 950;
  cursor: pointer;
}

.expandable-text p {
  margin-top: 6px;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 8px;
  background: #ffffff;
  color: var(--ff-ink);
  font-size: 0.9rem;
  line-height: 1.45;
}

.router-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
}

.router-main {
  display: grid;
  gap: 8px;
}

.router-metrics {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-end;
}

.primary-gate {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid #f2b8b5;
  border-radius: var(--ff-radius);
  background: var(--ff-blocked-soft);
}

.primary-gate strong {
  color: var(--ff-ink);
  font-size: 1rem;
}

.primary-gate span:last-child {
  color: var(--ff-muted);
  font-size: 0.92rem;
  line-height: 1.35;
}

.blueprint-section {
  display: grid;
  gap: 12px;
}

.section-head,
.section-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.section-head {
  padding: 0 2px;
}

.section-toggle {
  padding: 16px;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: var(--ff-surface);
  color: inherit;
  text-align: left;
  box-shadow: var(--ff-shadow);
  cursor: pointer;
}

.section-toggle strong {
  display: block;
  margin-top: 3px;
  color: var(--ff-ink);
  font-size: 1.12rem;
}

.section-toggle-right {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  color: var(--ff-muted);
  font-size: 0.86rem;
  font-weight: 850;
}

.workflow-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-card {
  overflow: hidden;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: #ffffff;
  box-shadow: var(--ff-shadow);
}

.workflow-card.risk-low {
  border-color: #b7ebcb;
}

.workflow-card.risk-medium {
  border-color: #f2d78c;
}

.workflow-card.risk-high {
  border-color: #f2b8b5;
}

.workflow-summary {
  display: grid;
  width: 100%;
  grid-template-columns: 44px minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.step-number {
  display: inline-grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 999px;
  background: var(--ff-primary);
  color: #ffffff;
  font-size: 0.95rem;
  font-weight: 950;
}

.workflow-title-block {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.workflow-title-block strong {
  color: var(--ff-ink);
  font-size: 1rem;
  line-height: 1.2;
}

.workflow-title-block small {
  display: block;
  max-width: 760px;
  color: var(--ff-muted);
  font-size: 0.88rem;
  line-height: 1.35;
}

.workflow-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.expand-label {
  color: var(--ff-muted);
  font-size: 0.8rem;
  font-weight: 900;
  text-transform: uppercase;
}

.workflow-details {
  padding: 0 14px 14px 70px;
}

.meta-grid {
  display: grid;
  gap: 10px;
  margin: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.meta-grid div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: var(--ff-surface-muted);
}

.meta-grid dt {
  color: var(--ff-muted);
  font-size: 0.72rem;
  font-weight: 950;
  text-transform: uppercase;
}

.meta-grid dd {
  margin: 2px 0 0;
  color: var(--ff-ink);
  font-size: 0.9rem;
  font-weight: 850;
  overflow-wrap: anywhere;
}

.trigger-grid div:last-child {
  grid-column: 1 / -1;
}

.mini-grid {
  grid-template-columns: 1fr;
}

.safety-grid,
.output-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.output-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.safety-card,
.output-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: #ffffff;
  box-shadow: var(--ff-shadow);
}

.safety-card h3,
.output-card h3 {
  margin: 10px 0 8px;
  color: var(--ff-ink);
  font-size: 1rem;
}

.safety-card ul,
.detail-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.safety-card li,
.detail-list li {
  color: var(--ff-muted);
  font-size: 0.9rem;
  line-height: 1.35;
}

.output-card p {
  margin: 8px 0 0;
  color: var(--ff-muted);
  font-size: 0.92rem;
  line-height: 1.4;
}

.output-card.risk-low {
  border-color: #b7ebcb;
  background: #f7fff9;
}

.output-card.risk-medium {
  border-color: #f2d78c;
  background: #fffdf2;
}

.output-card.risk-high {
  border-color: #f2b8b5;
  background: #fff7f7;
}

.output-card-head,
.card-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-toggle {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.card-toggle strong {
  color: var(--ff-ink);
  font-size: 1rem;
}

.card-toggle > span:not(.policy-badge) {
  color: var(--ff-muted);
  font-size: 0.8rem;
  font-weight: 900;
  text-transform: uppercase;
}

.card-expanded {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ff-border);
}

.checklist {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.checklist li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--ff-muted);
  font-size: 0.92rem;
  line-height: 1.35;
}

.checklist li::before {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--ff-primary);
  content: "";
}

.detail-list li {
  display: grid;
  gap: 3px;
}

.detail-list strong {
  color: var(--ff-ink);
}

.nested-tile {
  grid-column: span 12;
}

.policy-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--ff-border);
  border-radius: 999px;
  background: var(--ff-neutral-soft);
  color: var(--ff-muted);
  font-size: 0.76rem;
  font-weight: 900;
  text-transform: capitalize;
  white-space: nowrap;
}

.policy-safe,
.policy-badge.risk-low,
.ff-status.risk-low {
  border-color: #b7ebcb;
  background: var(--ff-safe-soft);
  color: var(--ff-safe);
}

.policy-draft,
.policy-assist,
.policy-badge.risk-medium,
.ff-status.risk-medium {
  border-color: #f2d78c;
  background: var(--ff-approval-soft);
  color: var(--ff-approval);
}

.policy-approval,
.policy-blocked,
.policy-badge.risk-high,
.ff-status.risk-high {
  border-color: #f2b8b5;
  background: var(--ff-blocked-soft);
  color: var(--ff-blocked);
}

@media (max-width: 1040px) {
  .input-tile,
  .result-hero-tile,
  .decision-tile,
  .ai-usage-tile,
  .router-tile,
  .blueprint-section {
    grid-column: span 12;
  }

  .decision-inner,
  .router-inner {
    grid-template-columns: 1fr;
  }

  .ai-explanation-grid,
  .router-output-grid {
    grid-template-columns: 1fr;
  }

  .router-metrics {
    align-items: flex-start;
  }

  .workflow-summary {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .workflow-badges,
  .expand-label {
    grid-column: 2;
    justify-content: flex-start;
  }

  .safety-grid,
  .output-grid,
  .meta-grid,
  .compile-summary-grid {
    grid-template-columns: 1fr;
  }

  .workflow-details {
    padding-left: 14px;
  }
}

@media (max-width: 760px) {
  .compile-run-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .ai-router-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .compile-stage-list {
    grid-template-columns: 1fr;
  }

  .input-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .compile-button {
    width: 100%;
  }

  .result-metrics {
    grid-template-columns: 1fr;
  }

  .section-head,
  .section-toggle,
  .output-card-head,
  .card-toggle {
    align-items: flex-start;
    flex-direction: column;
  }

  .section-toggle-right {
    justify-content: flex-start;
  }

  .workflow-summary {
    grid-template-columns: 1fr;
  }

  .workflow-badges,
  .expand-label {
    grid-column: auto;
  }
}
</style>
