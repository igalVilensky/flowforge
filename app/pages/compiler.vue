<script setup lang="ts">
import type { CompileJob, CompileMode } from "../../shared/types/compileJob";
import type { AgentDebugInfo } from "../../shared/types/agentOutputs";
import type { N8nGenerateResponse, N8nWorkflow } from "../../shared/types/n8nWorkflow";
import type {
  ClarificationSession,
  ClarificationSessionAnswer,
  ClarificationSessionResponse,
} from "../../shared/types/clarificationSession";

type PanelView = "context" | "agents" | "details" | "trace";
type RunState = "idle" | "clarifying" | "compiling" | "ready" | "blocked" | "failed";
type N8nGeneratorState = "idle" | "generating" | "ready" | "failed";

type FlowStepLike = {
  id?: string;
  label?: string;
  title?: string;
  name?: string;
  description?: string;
  primitive?: string;
  automation_policy?: string;
  real_world_execution?: string;
};

type DetailItem = {
  label: string;
  value: string;
};

type ObservabilityCard = {
  label: string;
  value: string;
  note: string;
  tone: "success" | "warning" | "danger" | "neutral";
};

type AgentCard = {
  id: string;
  label: string;
  status: "active" | "done" | "idle" | "skipped" | "needs_detail";
  summary: string;
  provider: string;
  statusLabel: string;
  statusReason: string;
  providerTone: "ai" | "fallback" | "deterministic" | "standby" | "failed" | "skipped";
  debugId?: keyof NonNullable<CompileJob["agent_debug"]> | "guided_clarifier";
};

const processInput = ref("");
const mode = ref<CompileMode>("full");
const job = ref<CompileJob | null>(null);
const clarificationSession = ref<ClarificationSession | null>(null);
const clarificationOriginalInput = ref("");
const clarificationAnswers = ref<ClarificationSessionAnswer[]>([]);
const clarificationAnswerDraft = ref("");
const runState = ref<RunState>("idle");
const errorMessage = ref("");
const activePanel = ref<PanelView>("context");
const showAnswered = ref(false);
const selectedExampleLabel = ref<string | null>(null);
const clarificationRateLimitMessage = ref("");
const clarificationLastResponse = ref<ClarificationSessionResponse | null>(null);
const activeAgentDetailsId = ref<string | null>(null);
const showModeMenu = ref(false);
const handoffCopied = ref(false);
const n8nGeneratorState = ref<N8nGeneratorState>("idle");
const n8nGenerateError = ref("");
const n8nWorkflowDraft = ref<N8nWorkflow | null>(null);
const n8nWarnings = ref<string[]>([]);
const n8nStaticSafetyWarning =
  "Draft only. Review before importing. Credentials are placeholders. Production side effects remain disabled.";
const n8nProvider = ref("");
const n8nUsedAi = ref(false);
const n8nFallbackUsed = ref(false);
const n8nJsonCopied = ref(false);

const examples = [
  {
    label: "Support triage",
    value:
      "When a new customer message arrives in the support inbox, classify the topic and urgency, draft an internal response suggestion, and route it to the support team lead for review before any reply is sent.",
  },
  {
    label: "Internal intake",
    value:
      "Every morning, collect new job application emails from the admissions inbox, extract the candidate name, role, portfolio link, and application source, classify the application priority, and create an internal review task for the admissions team without sending any external messages.",
  },
  {
    label: "Too vague",
    value: "Automate my tasks.",
  },
  {
    label: "Unsafe auto-send",
    value:
      "When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.",
  },
];

const modes: Array<{ value: CompileMode; label: string; hint: string }> = [
  { value: "rule_only", label: "Rule", hint: "deterministic only" },
  { value: "balanced", label: "Balanced", hint: "router + clarifier AI" },
  { value: "full", label: "Full", hint: "all agents" },
];

const modeExpectations: Record<Exclude<CompileMode, "demo">, string> = {
  rule_only: "Expected: deterministic scanner, deterministic blueprint, deterministic safety review. No LLM agent should be used.",
  balanced: "Expected: AI router/clarifier when helpful, deterministic blueprint and deterministic safety review.",
  full: "Expected: AI router, Blueprint Architect, and Safety Critic when providers are available; deterministic fallback explains failures.",
};

const selectedMode = computed(() => modes.find((item) => item.value === mode.value) ?? modes.at(-1)!);

function selectMode(value: CompileMode) {
  mode.value = value;
  showModeMenu.value = false;
}

const trimmedInput = computed(() => processInput.value.trim());
const hasInput = computed(() => trimmedInput.value.length > 0);
const currentQuestion = computed(() => clarificationSession.value?.next_question ?? null);
const isBusy = computed(() => runState.value === "clarifying" || runState.value === "compiling");
const hasClarification = computed(() => Boolean(clarificationSession.value && currentQuestion.value));
const answeredCount = computed(() => clarificationAnswers.value.length);
const currentQuestionNumber = computed(() => answeredCount.value + 1);
const clarificationProgressLabel = computed(() => `Question ${currentQuestionNumber.value} · stops when ready`);
const safetyStatus = computed(() => job.value?.safety_critic?.overall_status ?? null);
const mainStatus = computed(() => {
  if (runState.value === "failed") return "Failed";
  if (hasClarification.value) return "Clarifying";
  if (!job.value) return "Ready";

  if (safetyStatus.value === "not_safe_to_automate") return "Not safe";
  if (safetyStatus.value === "needs_human_approval") return "Human gate";
  if (safetyStatus.value === "needs_clarification") return "Needs detail";
  if (safetyStatus.value === "safe_internal_preview") return "Blueprint ready";

  return "Blueprint ready";
});

const mainStatusTone = computed(() => {
  if (runState.value === "failed") return "danger";
  if (hasClarification.value) return "active";
  if (safetyStatus.value === "not_safe_to_automate") return "danger";
  if (safetyStatus.value === "needs_human_approval") return "warning";
  if (safetyStatus.value === "safe_internal_preview") return "success";
  return "neutral";
});

const agentRail = computed(() => [
  {
    label: "Input",
    state: hasInput.value ? "done" : "active",
  },
  {
    label: "Clarifier",
    state: hasClarification.value ? "active" : clarificationAnswers.value.length > 0 ? "done" : "idle",
  },
  {
    label: "Compiler",
    state: runState.value === "compiling" ? "active" : job.value ? "done" : "idle",
  },
  {
    label: "Safety",
    state: job.value?.safety_critic ? "done" : runState.value === "compiling" ? "active" : "idle",
  },
  {
    label: "Blueprint",
    state: job.value?.result ? "active" : "idle",
  },
]);


const agentCards = computed<AgentCard[]>(() => [
  {
    id: "guided_clarifier",
    label: "Guided Clarifier",
    status: hasClarification.value ? "active" : clarificationAnswers.value.length > 0 ? "done" : "idle",
    summary: clarificationSession.value?.reason
      || clarificationLastResponse.value?.session.reason
      || (clarificationAnswers.value.length > 0 ? "Clarification answers collected." : "Waiting for a clarification need."),
    provider: clarificationLastResponse.value?.provider || "standby",
    statusLabel: guidedClarifierStatusLabel(),
    statusReason: guidedClarifierStatusReason(),
    providerTone: guidedClarifierTone(),
    debugId: "guided_clarifier",
  },
  {
    id: "router",
    label: "Router",
    status: job.value?.router_decision ? "done" : runState.value === "compiling" ? "active" : "idle",
    summary: job.value?.router_decision?.reason || "Routes compile requests when needed.",
    provider: job.value?.router_decision?.provider || "standby",
    statusLabel: routerStatusLabel(),
    statusReason: routerStatusReason(),
    providerTone: routerProviderTone(),
  },
  {
    id: "clarification_agent",
    label: "Compile Clarifier",
    status: job.value?.clarification_agent ? agentOutputStatusToCardStatus(job.value.clarification_agent.status) : runState.value === "compiling" ? "active" : "idle",
    summary: job.value?.clarification_agent?.rewritten_summary
      || job.value?.clarification_plan?.reason
      || "Explains compile-time missing details when needed.",
    provider: job.value?.clarification_agent?.provider || "standby",
    statusLabel: agentStatusLabel(
      job.value?.clarification_agent?.provider,
      job.value?.clarification_agent?.used_ai,
      job.value?.clarification_agent?.fallback_used,
      job.value?.clarification_agent?.status,
    ),
    statusReason: agentStatusReason(
      job.value?.clarification_agent?.provider,
      job.value?.clarification_agent?.used_ai,
      job.value?.clarification_agent?.fallback_used,
      job.value?.clarification_agent?.reason,
      job.value?.clarification_agent?.status,
    ),
    providerTone: providerTone(
      job.value?.clarification_agent?.provider,
      job.value?.clarification_agent?.used_ai,
      job.value?.clarification_agent?.fallback_used,
      job.value?.clarification_agent?.status,
    ),
    debugId: "clarification_agent",
  },
  {
    id: "blueprint_architect_agent",
    label: "Blueprint Architect",
    status: job.value?.blueprint_architect_agent ? agentOutputStatusToCardStatus(job.value.blueprint_architect_agent.status) : runState.value === "compiling" ? "active" : "idle",
    summary: job.value?.blueprint_architect_agent?.summary || job.value?.result?.summary || "Builds the workflow preview.",
    provider: job.value?.blueprint_architect_agent?.provider || "standby",
    statusLabel: agentStatusLabel(
      job.value?.blueprint_architect_agent?.provider,
      job.value?.blueprint_architect_agent?.used_ai,
      job.value?.blueprint_architect_agent?.fallback_used,
      job.value?.blueprint_architect_agent?.status,
    ),
    statusReason: agentStatusReason(
      job.value?.blueprint_architect_agent?.provider,
      job.value?.blueprint_architect_agent?.used_ai,
      job.value?.blueprint_architect_agent?.fallback_used,
      job.value?.blueprint_architect_agent?.reason,
      job.value?.blueprint_architect_agent?.status,
    ),
    providerTone: providerTone(
      job.value?.blueprint_architect_agent?.provider,
      job.value?.blueprint_architect_agent?.used_ai,
      job.value?.blueprint_architect_agent?.fallback_used,
      job.value?.blueprint_architect_agent?.status,
    ),
    debugId: "blueprint_architect_agent",
  },
  {
    id: "safety_critic_agent",
    label: "Safety Critic",
    status: job.value?.safety_critic_agent ? agentOutputStatusToCardStatus(job.value.safety_critic_agent.status) : job.value?.safety_critic ? "done" : runState.value === "compiling" ? "active" : "idle",
    summary: job.value?.safety_critic_agent?.critic_summary
      || job.value?.safety_critic?.summary
      || "Checks gates, blocked actions, and next safe action.",
    provider: job.value?.safety_critic_agent?.provider || (job.value?.safety_critic ? "deterministic" : "standby"),
    statusLabel: agentStatusLabel(
      job.value?.safety_critic_agent?.provider,
      job.value?.safety_critic_agent?.used_ai,
      job.value?.safety_critic_agent?.fallback_used,
      job.value?.safety_critic_agent?.status,
    ),
    statusReason: agentStatusReason(
      job.value?.safety_critic_agent?.provider,
      job.value?.safety_critic_agent?.used_ai,
      job.value?.safety_critic_agent?.fallback_used,
      job.value?.safety_critic_agent?.reason,
      job.value?.safety_critic_agent?.status,
    ),
    providerTone: providerTone(
      job.value?.safety_critic_agent?.provider,
      job.value?.safety_critic_agent?.used_ai,
      job.value?.safety_critic_agent?.fallback_used,
      job.value?.safety_critic_agent?.status,
    ),
    debugId: "safety_critic_agent",
  },
]);

const activeAgentCard = computed(() => agentCards.value.find((agent) => agent.id === activeAgentDetailsId.value) ?? null);

const activeAgentDebug = computed<AgentDebugInfo | null>(() => {
  const id = activeAgentDetailsId.value;

  if (!id || id === "guided_clarifier") return null;

  return job.value?.agent_debug?.[id as keyof NonNullable<CompileJob["agent_debug"]>] ?? null;
});

const activeAgentOutcome = computed(() => {
  const id = activeAgentDetailsId.value;

  if (!id) return null;

  if (id === "guided_clarifier") {
    return clarificationLastResponse.value
      ? {
          session: clarificationLastResponse.value.session,
          provider: clarificationLastResponse.value.provider,
          used_ai: clarificationLastResponse.value.used_ai,
          fallback_used: clarificationLastResponse.value.fallback_used,
          raw_response: clarificationLastResponse.value.raw_response,
        }
      : clarificationSession.value;
  }

  if (id === "clarification_agent") return job.value?.clarification_agent ?? null;
  if (id === "blueprint_architect_agent") return job.value?.blueprint_architect_agent ?? null;
  if (id === "safety_critic_agent") return job.value?.safety_critic_agent ?? job.value?.safety_critic ?? null;
  if (id === "router") return job.value?.router_decision ?? null;

  return null;
});

function openAgentDetails(agentId: string) {
  activeAgentDetailsId.value = agentId;
}

function closeAgentDetails() {
  activeAgentDetailsId.value = null;
}

function formatDebugValue(value: unknown) {
  if (value === null || value === undefined) return "No data available.";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactText(value: unknown, maxLength = 220) {
  const text = typeof value === "string" ? value : String(value ?? "");
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function providerDisplayName(provider?: string) {
  if (!provider) return "Provider";
  if (provider === "groq") return "Groq";
  if (provider === "gemini") return "Gemini";
  if (provider === "deterministic") return "Deterministic";

  return provider.replaceAll("_", " ");
}

function normalizeProviderFailureMessage(provider: unknown, errorSummary: unknown) {
  const providerName = providerDisplayName(typeof provider === "string" ? provider : undefined);
  const rawText = typeof errorSummary === "string" ? errorSummary : String(errorSummary ?? "");
  const normalized = rawText.toLowerCase();

  if (
    normalized.includes("429")
    || normalized.includes("too many requests")
    || normalized.includes("rate limit")
    || normalized.includes("rate_limit")
  ) {
    return `${providerName} rate limit reached. Try again later or use deterministic fallback.`;
  }

  if (
    normalized.includes("aborted")
    || normalized.includes("aborterror")
    || normalized.includes("timed out")
    || normalized.includes("timeout")
  ) {
    return `${providerName} request timed out or was aborted.`;
  }

  if (
    normalized.includes("schema")
    || normalized.includes("validation")
    || normalized.includes("invalid json")
    || normalized.includes("no valid json")
    || normalized.includes("failed to parse")
    || normalized.includes("unexpected token")
  ) {
    return "Invalid AI output rejected by schema.";
  }

  if (normalized.includes("api_key") || normalized.includes("is not set") || normalized.includes("not configured")) {
    return `${providerName} is not configured. Deterministic fallback can still complete the run.`;
  }

  if (!rawText) return "Unknown provider failure.";

  return rawText.length <= 120
    ? rawText
    : `${providerName} provider failed. Deterministic fallback can still complete the run.`;
}

function cleanFallbackReason(reason?: string) {
  const text = reason ?? "";
  const normalized = text.toLowerCase();

  if (
    normalized.includes("safety critic ai was unavailable")
    || normalized.includes("safety critic agent provider")
  ) {
    return "Fallback used: deterministic safety review completed because AI provider output was unavailable.";
  }

  if (normalized.includes("deterministic fallback was used") && normalized.includes("provider key")) {
    return "Fallback used: deterministic review completed because no AI provider key was configured.";
  }

  if (!text) return "Fallback used: deterministic checks completed this step.";

  return compactText(text, 150);
}

function addFact(items: DetailItem[], label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return;
  items.push({ label, value: String(value) });
}

function countAgentOutput(provider?: string, usedAi?: boolean, fallback?: boolean) {
  if (!provider) return "Not run";
  if (usedAi) return `${provider} · AI`;
  if (fallback) return `${provider} · fallback`;
  return provider;
}

function providerTone(provider?: string, usedAi?: boolean, fallback?: boolean, status?: unknown): AgentCard["providerTone"] {
  if (status === "skipped") return "skipped";
  if (status === "failed_validation") return "failed";
  if (!provider || provider === "standby") return "standby";
  if (usedAi) return "ai";
  if (fallback) return "fallback";
  if (provider === "deterministic") return "deterministic";
  return "standby";
}

function agentStatusLabel(provider?: string, usedAi?: boolean, fallback?: boolean, status?: unknown) {
  if (status === "skipped") return "Skipped";
  if (status === "failed_validation") return "Needs fix";
  if (!provider || provider === "standby") return "Standby";
  if (usedAi) return "AI used";
  if (fallback) return "Fallback";
  if (provider === "deterministic") return "Rules";
  return "Ready";
}

function agentStatusReason(provider?: string, usedAi?: boolean, fallback?: boolean, reason?: string, status?: unknown) {
  if (status === "skipped") return "Not needed for this run.";
  if (!provider || provider === "standby") return "Waiting for a compile run.";
  if (usedAi) return `This agent successfully used ${provider}.`;
  if (fallback) return cleanFallbackReason(reason);
  if (reason) return compactText(reason, 150);
  if (provider === "deterministic") return "This step used deterministic rules, not an LLM.";
  return "No extra status detail returned.";
}

function shouldShowAgentReason(agent: AgentCard) {
  return compactText(agent.summary, 150) !== compactText(agent.statusReason, 150);
}

function routerProviderTone() {
  const decision = job.value?.router_decision;
  if (!decision) return "standby";
  if (decision.used_ai) return "ai";
  if (decision.fallback_used) return "fallback";
  if (decision.provider === "deterministic") return "deterministic";
  return "standby";
}

function routerStatusLabel() {
  const decision = job.value?.router_decision;
  if (!decision) return "Standby";
  if (decision.used_ai) return "AI used";
  if (decision.fallback_used) return "Fallback";
  if (decision.provider === "deterministic") return "Rules";
  return "Done";
}

function routerStatusReason() {
  const decision = job.value?.router_decision;
  if (!decision) return "Waiting for a compile request.";
  return compactText(decision.reason || "Router selected the compile path.", 150);
}

function guidedClarifierTone(): AgentCard["providerTone"] {
  if (hasClarification.value) return clarificationLastResponse.value?.used_ai ? "ai" : "deterministic";
  if (clarificationLastResponse.value?.fallback_used) return "fallback";
  if (clarificationLastResponse.value?.used_ai) return "ai";
  return "standby";
}

function guidedClarifierStatusLabel() {
  if (hasClarification.value) return clarificationLastResponse.value?.used_ai ? "AI asking" : "Clarifying";
  if (clarificationAnswers.value.length > 0) return "Answered";
  return "Standby";
}

function guidedClarifierStatusReason() {
  if (hasClarification.value) return "Asking one contextual question before compile.";
  if (clarificationAnswers.value.length > 0) return "Collected clarification answers for this run.";
  return "Only runs when the request is too vague or needs guided detail.";
}

function allProviderAttempts() {
  const debug = job.value?.agent_debug;
  if (!debug) return [];

  return Object.entries(debug).flatMap(([agentId, agentDebug]) =>
    (agentDebug?.provider_attempts ?? []).map((attempt) => ({
      agentId,
      ...attempt,
    })),
  );
}

const agentExecutionSummary = computed(() => {
  const cards = agentCards.value.filter((agent) => agent.id !== "guided_clarifier");
  const aiUsed = cards.filter((agent) => agent.providerTone === "ai");
  const fallbacks = cards.filter((agent) => agent.providerTone === "fallback");
  const skipped = cards.filter((agent) => agent.providerTone === "skipped");
  const deterministic = cards.filter((agent) => agent.providerTone === "deterministic");

  return {
    cards,
    aiUsed,
    fallbacks,
    skipped,
    deterministic,
  };
});

const providerFailureItems = computed(() => {
  return allProviderAttempts()
    .filter((attempt) => attempt.attempted && !attempt.success && attempt.error_summary)
    .map((attempt) => ({
      label: `${attempt.agentId.replaceAll("_", " ")} · ${providerDisplayName(attempt.provider)}`,
      value: compactText(normalizeProviderFailureMessage(attempt.provider, attempt.error_summary), 180),
    }));
});

const observabilityCards = computed<ObservabilityCard[]>(() => {
  if (!job.value) {
    return [
      {
        label: "Run state",
        value: "No compile yet",
        note: "Compile a workflow to see observability data.",
        tone: "neutral",
      },
    ];
  }

  const aiCount = agentExecutionSummary.value.aiUsed.length;
  const fallbackCount = agentExecutionSummary.value.fallbacks.length;
  const failedCount = providerFailureItems.value.length;
  const tokenUsage = job.value.token_usage;
  const expectedMode = modeExpectations[(job.value.mode === "demo" ? "rule_only" : job.value.mode) as Exclude<CompileMode, "demo">];
  const safetyCriticFallback = job.value.safety_critic_agent?.fallback_used === true;

  return [
    {
      label: "Mode expectation",
      value: job.value.mode === "demo" ? "rule" : job.value.mode,
      note: expectedMode,
      tone: "neutral",
    },
    {
      label: "AI agents used",
      value: `${aiCount}`,
      note: aiCount
        ? agentExecutionSummary.value.aiUsed.map((agent) => agent.label).join(", ")
        : "No agent used an LLM successfully in this run.",
      tone: aiCount ? "success" : "neutral",
    },
    {
      label: "Fallbacks",
      value: `${fallbackCount}`,
      note: fallbackCount
        ? safetyCriticFallback
          ? "Safety Critic: deterministic safety review completed because AI provider output was unavailable."
          : agentExecutionSummary.value.fallbacks.map((agent) => agent.label).join(", ")
        : "No agent fallback was needed.",
      tone: fallbackCount ? "warning" : "success",
    },
    {
      label: "Provider failures",
      value: `${failedCount}`,
      note: failedCount
        ? safetyCriticFallback
          ? "Safety Critic AI providers were unavailable. Deterministic safety fallback completed successfully."
          : "Open the failed provider rows below or the agent modal for raw details."
        : "No failed provider attempts were reported.",
      tone: failedCount ? safetyCriticFallback ? "warning" : "danger" : "success",
    },
    {
      label: "LLM attempts used",
      value: `${tokenUsage?.llm_calls_used ?? 0}/${tokenUsage?.llm_calls_limit ?? 0}`,
      note: "Provider attempts used in this compile run compared with the selected mode limit.",
      tone: (tokenUsage?.llm_calls_used ?? 0) > (tokenUsage?.llm_calls_limit ?? 0) ? "warning" : "neutral",
    },
    {
      label: "Trust note",
      value: job.value.safety_critic?.overall_status ?? job.value.status,
      note: fallbackCount || failedCount
        ? "Final safety result is deterministic and valid; AI provider failures are listed for transparency."
        : "No provider fallback was reported; inspect agent details for prompt/response evidence.",
      tone: fallbackCount || failedCount ? "warning" : "success",
    },
  ];
});

const knownFactItems = computed<DetailItem[]>(() => {
  const items: DetailItem[] = [];
  const facts = clarificationSession.value?.known_facts;

  if (facts?.workflow_goal) addFact(items, "Goal", facts.workflow_goal);
  if (facts?.task_type) addFact(items, "Task", facts.task_type);
  if (facts?.trigger) addFact(items, "Trigger", facts.trigger);
  if (facts?.data_source) addFact(items, "Source", facts.data_source);
  if (facts?.desired_output) addFact(items, "Output", facts.desired_output);
  if (facts?.human_owner) addFact(items, "Owner", facts.human_owner);
  if (facts?.approval_boundary) addFact(items, "Gate", facts.approval_boundary);
  if (facts?.external_action_boundary) addFact(items, "Boundary", facts.external_action_boundary);

  if (job.value) {
    addFact(items, "Compile mode", job.value.mode);
    addFact(items, "Mode expectation", modeExpectations[(job.value.mode === "demo" ? "rule_only" : job.value.mode) as Exclude<CompileMode, "demo">]);
    addFact(items, "Expected result", job.value.safety_critic?.overall_status ?? job.value.status);
    addFact(items, "Workflow", job.value.result?.workflow_name);
    addFact(items, "Router route", job.value.router_decision?.route);
    addFact(items, "Router reason", compactText(job.value.router_decision?.reason, 180));
    addFact(items, "Risk level", job.value.risks?.risk_level);
    addFact(items, "Readiness", job.value.readiness?.score);
    addFact(items, "Human gates", job.value.result?.human_approval_gates?.length ?? 0);
    addFact(items, "Blueprint Architect", countAgentOutput(
      job.value.blueprint_architect_agent?.provider,
      job.value.blueprint_architect_agent?.used_ai,
      job.value.blueprint_architect_agent?.fallback_used,
    ));
    addFact(items, "Safety Critic Agent", countAgentOutput(
      job.value.safety_critic_agent?.provider,
      job.value.safety_critic_agent?.used_ai,
      job.value.safety_critic_agent?.fallback_used,
    ));
    addFact(items, "LLM attempts", `${job.value.token_usage?.llm_calls_used ?? 0}/${job.value.token_usage?.llm_calls_limit ?? 0}`);
  } else if (!facts) {
    addFact(items, "Selected mode", mode.value);
    addFact(items, "Mode expectation", modeExpectations[(mode.value === "demo" ? "rule_only" : mode.value) as Exclude<CompileMode, "demo">]);
  }

  return items;
});

const workflowSteps = computed<FlowStepLike[]>(() => {
  const result = job.value?.result as unknown as { steps?: FlowStepLike[] } | null | undefined;
  return Array.isArray(result?.steps) ? result.steps : [];
});

function workflowStepLabel(step: FlowStepLike, index: number) {
  return step.label || step.title || step.name || `Step ${index + 1}`;
}

function workflowStepTone(step: FlowStepLike) {
  const policy = step.automation_policy ?? "";
  const execution = step.real_world_execution ?? "";

  if (policy === "blocked_in_mvp" || policy === "not_recommended" || execution === "blocked_in_mvp") {
    return "blocked";
  }

  if (policy === "human_approval" || execution === "requires_human_trigger") {
    return "approval";
  }

  if (policy === "draft_only") {
    return "draft";
  }

  if (policy === "assist_only") {
    return "assist";
  }

  return "safe";
}

function formatStepValue(value?: string) {
  if (!value || value === "none") return "No external action";
  return value.replaceAll("_", " ");
}

function automationPolicyLabel(value?: string) {
  if (value === "automate") return "Can be automated";
  if (value === "assist_only") return "Assist only";
  if (value === "draft_only") return "Draft only";
  if (value === "human_approval") return "Human approval";
  if (value === "blocked_in_mvp") return "Blocked in MVP";
  if (value === "not_recommended") return "Not recommended";
  return formatStepValue(value);
}

function executionBoundaryLabel(value?: string) {
  if (!value || value === "none") return "No real-world execution";
  if (value === "draft_only") return "Draft only";
  if (value === "requires_human_trigger") return "Requires human trigger";
  if (value === "blocked_in_mvp") return "Blocked in MVP";
  return formatStepValue(value);
}

function primitiveLabel(value?: string) {
  return formatStepValue(value || "workflow step");
}


function sourceInputText(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "Not available.";

  const record = value as Record<string, unknown>;
  const likelyText = record.text || record.prompt || record.idea || record.input || record.description || record.workflow;

  if (typeof likelyText === "string") return likelyText;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Not available.";
  }
}

function readableList(items: unknown[], fallback: string) {
  const cleanItems = items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.description || record.label || record.title || record.action || "");
      }
      return "";
    })
    .filter(Boolean);

  return cleanItems.length ? cleanItems.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function arrayFromRecord(record: unknown, keys: string[]) {
  if (!record || typeof record !== "object") return [];

  const source = record as Record<string, unknown>;

  return keys.flatMap((key) => {
    const value = source[key];
    return Array.isArray(value) ? value : [];
  });
}

function safetyFindingDescriptions(safety: unknown, acceptedTypes: string[]) {
  if (!safety || typeof safety !== "object") return [];

  const findings = (safety as Record<string, unknown>).findings;
  if (!Array.isArray(findings)) return [];

  return findings
    .filter((finding) => {
      if (!finding || typeof finding !== "object") return false;
      const type = String((finding as Record<string, unknown>).type ?? "");
      return acceptedTypes.some((acceptedType) => type.includes(acceptedType));
    })
    .map((finding) => {
      const record = finding as Record<string, unknown>;
      return record.description || record.summary || record.message || record.title;
    })
    .filter(Boolean);
}


const n8nImplementationPrompt = computed(() => {
  if (!job.value) return "";

  const result = job.value.result;
  const safety = job.value.safety_critic;
  const steps = workflowSteps.value;
  const originalIdea = sourceInputText(job.value.input);

  const stepLines = steps.length
    ? steps.map((step, index) => [
        `${index + 1}. ${workflowStepLabel(step, index)}`,
        `   Purpose: ${step.description || "No description provided."}`,
        `   Suggested n8n node role: ${primitiveLabel(step.primitive)}`,
        `   Safety policy: ${automationPolicyLabel(step.automation_policy)}`,
        `   Execution rule: ${executionBoundaryLabel(step.real_world_execution)}`,
      ].join("\n")).join("\n\n")
    : "No structured step list was provided. Build the implementation from the original idea and safety constraints.";

  const humanGates = [
    ...arrayFromRecord(result, ["human_gates", "human_approval_gates", "approval_gates", "required_human_gates"]),
    ...arrayFromRecord(safety, ["required_human_gates", "human_gates", "human_approval_gates", "approval_gates"]),
    ...safetyFindingDescriptions(safety, ["human", "approval"]),
  ].filter(Boolean);

  const blockedActions = [
    ...arrayFromRecord(result, ["not_safe_to_automate", "blocked_actions", "excluded_actions"]),
    ...arrayFromRecord(safety, ["blocked_actions", "not_safe_to_automate", "excluded_actions"]),
    ...safetyFindingDescriptions(safety, ["blocked", "unsafe", "not_safe"]),
  ].filter(Boolean);

  const warnings = [
    ...arrayFromRecord(safety, ["warnings", "concerns", "implementation_notes"]),
    ...safetyFindingDescriptions(safety, ["warning", "risk", "concern"]),
  ].filter(Boolean);

  return [
    "Create an n8n workflow implementation plan from this FlowForge blueprint.",
    "",
    "Goal:",
    "- Turn the blueprint into a practical n8n node-by-node plan.",
    "- Do not execute anything now.",
    "- Do not invent production side effects that are not explicitly approved below.",
    "",
    "Original automation request:",
    originalIdea,
    "",
    "FlowForge decision:",
    `- Safety status: ${safety?.overall_status ?? job.value.status}`,
    `- Blueprint summary: ${result?.summary ?? "No summary provided."}`,
    `- Next safe action: ${safety?.next_safe_action ?? "Review the implementation before connecting real services."}`,
    "",
    "Implementation constraints:",
    "- Use test credentials or mocked/sample data first.",
    "- Any email sending must be a draft or manual approval step unless explicitly allowed.",
    "- Any production write, customer/account update, deletion, refund, payment, or external action must require manual approval.",
    "- Prefer internal tasks, labels, summaries, draft messages, review queues, and notifications.",
    "- Add error handling and logging nodes where useful.",
    "",
    "Workflow nodes to design:",
    stepLines,
    "",
    "Human approval gates to include:",
    readableList(humanGates, "Add a manual approval step before any real-world action."),
    "",
    "Actions that must stay blocked or disabled:",
    readableList(blockedActions, "Keep production side effects disabled until reviewed."),
    "",
    "Warnings / notes:",
    readableList(warnings, "Keep the workflow in draft/test mode until reviewed."),
    "",
    "Return format:",
    "1. Proposed n8n node list in execution order.",
    "2. For each node: node type, purpose, input data, output data, and safety boundary.",
    "3. Manual approval points.",
    "4. Test data to use for a dry run.",
    "5. What must remain disabled before production.",
    "",
    "Do not return vague advice. Return a concrete implementation plan that a developer can build in n8n.",
  ].join("\n");
});

async function copyN8nImplementationPrompt() {
  if (!n8nImplementationPrompt.value) return;

  await navigator.clipboard.writeText(n8nImplementationPrompt.value);
  handoffCopied.value = true;
  window.setTimeout(() => {
    handoffCopied.value = false;
  }, 1800);
}

const n8nWorkflowJsonText = computed(() => {
  return n8nWorkflowDraft.value ? JSON.stringify(n8nWorkflowDraft.value, null, 2) : "";
});

const displayedN8nWarnings = computed(() => {
  return n8nWarnings.value.filter((warning) => warning !== n8nStaticSafetyWarning);
});

const canGenerateN8nJson = computed(() => {
  return Boolean(
    job.value
    && n8nImplementationPrompt.value
    && n8nGeneratorState.value !== "generating"
    && safetyStatus.value !== "not_safe_to_automate"
    && safetyStatus.value !== "needs_clarification",
  );
});

const n8nGeneratorMeta = computed(() => {
  if (!n8nWorkflowDraft.value) return "";

  return [
    n8nProvider.value || "provider unknown",
    n8nUsedAi.value ? "AI draft" : "no AI used",
    n8nFallbackUsed.value ? "fallback" : "validated",
  ].join(" · ");
});

const n8nJsonFileName = computed(() => {
  const source = job.value?.result?.workflow_name || "flowforge-n8n-draft";
  const safeName = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `${safeName || "flowforge-n8n-draft"}.json`;
});

function resetN8nGeneratorState() {
  n8nGeneratorState.value = "idle";
  n8nGenerateError.value = "";
  n8nWorkflowDraft.value = null;
  n8nWarnings.value = [];
  n8nProvider.value = "";
  n8nUsedAi.value = false;
  n8nFallbackUsed.value = false;
  n8nJsonCopied.value = false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function issueSummaryFromErrorData(data: unknown) {
  const record = asRecord(data);
  const nestedData = asRecord(record?.data);
  const issues = nestedData?.issues;

  if (!Array.isArray(issues)) return "";

  return issues
    .slice(0, 3)
    .map((issue) => {
      const issueRecord = asRecord(issue);
      const path = typeof issueRecord?.path === "string" ? issueRecord.path : "workflow";
      const message = typeof issueRecord?.message === "string" ? issueRecord.message : "Invalid n8n workflow JSON.";
      return `${path}: ${message}`;
    })
    .join("; ");
}

function apiErrorMessage(error: unknown, fallback: string) {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  const responseData = asRecord(asRecord(record?.response)?._data);
  const base =
    (typeof data?.statusMessage === "string" && data.statusMessage)
    || (typeof data?.message === "string" && data.message)
    || (typeof responseData?.statusMessage === "string" && responseData.statusMessage)
    || (typeof record?.statusMessage === "string" && record.statusMessage)
    || (typeof record?.message === "string" && record.message)
    || fallback;

  if (/413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute|groq api error/i.test(base)) {
    return "n8n JSON generation request was too large for the configured Groq tier. FlowForge now sends a compact implementation brief, but this request still exceeded the provider limit. Try a shorter workflow or reduce workflow details.";
  }

  const issueSummary = issueSummaryFromErrorData(data);

  return issueSummary ? `${base} ${issueSummary}` : base;
}

async function generateN8nWorkflowDraft() {
  if (!job.value || !canGenerateN8nJson.value) return;

  n8nGeneratorState.value = "generating";
  n8nGenerateError.value = "";
  n8nJsonCopied.value = false;

  try {
    const response = await $fetch<N8nGenerateResponse>("/api/n8n-generate", {
      method: "POST",
      body: {
        compile_job: job.value,
        implementation_prompt: n8nImplementationPrompt.value,
      },
    });

    n8nWorkflowDraft.value = response.workflow_json;
    n8nWarnings.value = response.warnings;
    n8nProvider.value = response.provider;
    n8nUsedAi.value = response.used_ai;
    n8nFallbackUsed.value = response.fallback_used;
    n8nGeneratorState.value = "ready";
  } catch (error) {
    n8nWorkflowDraft.value = null;
    n8nWarnings.value = [];
    n8nGenerateError.value = apiErrorMessage(error, "Could not generate n8n JSON draft.");
    n8nGeneratorState.value = "failed";
  }
}

async function copyN8nWorkflowJson() {
  if (!n8nWorkflowJsonText.value) return;

  await navigator.clipboard.writeText(n8nWorkflowJsonText.value);
  n8nJsonCopied.value = true;
  window.setTimeout(() => {
    n8nJsonCopied.value = false;
  }, 1800);
}

function downloadN8nWorkflowJson() {
  if (!n8nWorkflowJsonText.value) return;

  const blob = new Blob([n8nWorkflowJsonText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = n8nJsonFileName.value;
  anchor.click();
  URL.revokeObjectURL(url);
}

const resultTitle = computed(() => {
  if (hasClarification.value) return "Clarifier is asking for one detail";
  if (!job.value) return "Describe an automation";
  if (safetyStatus.value === "not_safe_to_automate") return "Do not automate this";
  if (safetyStatus.value === "needs_human_approval") return "Workflow blueprint with human gates";
  if (safetyStatus.value === "safe_internal_preview") return "Workflow blueprint";
  return "Workflow preview";
});

const resultSubtitle = computed(() => {
  if (hasClarification.value) {
    return clarificationSession.value?.current_summary || "FlowForge is collecting the next useful detail.";
  }

  if (!job.value) {
    return "Start with a messy request or a clear workflow. FlowForge will clarify or compile safely.";
  }

  return job.value.safety_critic?.summary
    || job.value.result?.summary
    || "Non-executing preview generated with safety boundaries.";
});

const nextSafeAction = computed(() => {
  return job.value?.safety_critic?.next_safe_action
    || "Keep this as a non-executing preview. Review all external or sensitive actions manually.";
});

const canContinueClarification = computed(() => {
  return Boolean(currentQuestion.value && clarificationAnswerDraft.value.trim().length > 0 && !isBusy.value);
});

function chooseExample(example: { label: string; value: string }) {
  processInput.value = example.value;
  selectedExampleLabel.value = example.label;
  resetRun();
  selectedExampleLabel.value = example.label;
}

function resetRun() {
  job.value = null;
  clarificationSession.value = null;
  clarificationOriginalInput.value = "";
  clarificationAnswers.value = [];
  clarificationAnswerDraft.value = "";
  errorMessage.value = "";
  clarificationRateLimitMessage.value = "";
  clarificationLastResponse.value = null;
  activeAgentDetailsId.value = null;
  runState.value = "idle";
  showAnswered.value = false;
  resetN8nGeneratorState();
}

function answerPayload(extraAnswer?: ClarificationSessionAnswer) {
  return extraAnswer ? [...clarificationAnswers.value, extraAnswer] : clarificationAnswers.value;
}

function agentOutputStatusToCardStatus(status: unknown): AgentCard["status"] {
  if (status === "skipped") return "skipped";
  if (status === "failed_validation") return "needs_detail";
  if (status === "fallback_used" || status === "used_ai") return "done";
  return "idle";
}

function hasNeedsDetailReason(value: unknown): boolean {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /needs? (more )?(detail|clarification)|clarify|missing|not enough|underspecified/i.test(raw);
}

function resultIsGenericFallbackBlueprint(result: CompileJob | null): boolean {
  if (!result) return false;

  const steps = result.result?.steps ?? [];
  const genericStepCount = steps.filter((step) =>
    /^Step \\d+$/i.test(step.label)
    || /submitted process text|likely workflow shape|deterministic rules|safe blueprint preview/i.test(step.description),
  ).length;

  return steps.length > 0 && genericStepCount >= Math.min(3, steps.length);
}

function compileResultNeedsClarification(result: CompileJob): boolean {
  const finalStatus = result.safety_critic?.overall_status;

  // Deterministic final safety outcome wins.
  // A cautious router or skipped optional agent must not send a clear safe/human-gated/blocked result back into clarification.
  if (
    finalStatus === "safe_internal_preview"
    || finalStatus === "needs_human_approval"
    || finalStatus === "not_safe_to_automate"
  ) {
    return false;
  }

  if (result.status === "needs_user") return true;
  if (finalStatus === "needs_clarification") return true;
  if (result.clarification_plan?.needed === true) return true;

  const architectSkippedForDetail =
    result.blueprint_architect_agent?.status === "skipped"
    && hasNeedsDetailReason(result.blueprint_architect_agent);

  const criticSkippedForDetail =
    result.safety_critic_agent?.status === "skipped"
    && hasNeedsDetailReason(result.safety_critic_agent);

  return architectSkippedForDetail || criticSkippedForDetail;
}

async function startClarificationForInput(originalInput: string) {
  clarificationOriginalInput.value = originalInput;
  clarificationAnswers.value = [];
  clarificationSession.value = null;
  clarificationAnswerDraft.value = "";
  runState.value = "clarifying";

  const response = await $fetch<ClarificationSessionResponse>("/api/clarify", {
    method: "POST",
    body: {
      original_input: originalInput,
      answers: [],
    },
  });

  await handleClarificationResponse(response);
}

async function startGuidedCompile() {
  if (!hasInput.value || isBusy.value) return;

  const originalInput = trimmedInput.value;
  resetRun();

  try {
    await startClarificationForInput(originalInput);
  } catch (error) {
    setFriendlyError(error, "Could not start guided clarification.");
  }
}

async function continueClarification() {
  if (!currentQuestion.value || !canContinueClarification.value) return;

  const question = currentQuestion.value;
  const answer: ClarificationSessionAnswer = {
    question_id: question.id,
    question: question.question,
    answer: clarificationAnswerDraft.value.trim(),
  };

  clarificationAnswerDraft.value = "";
  runState.value = "clarifying";

  try {
    const nextAnswers = answerPayload(answer);
    clarificationAnswers.value = nextAnswers;

    const response = await $fetch<ClarificationSessionResponse>("/api/clarify", {
      method: "POST",
      body: {
        original_input: clarificationOriginalInput.value || trimmedInput.value,
        answers: nextAnswers,
      },
    });

    await handleClarificationResponse(response);
  } catch (error) {
    setFriendlyError(error, "Could not continue clarification.");
  }
}

async function handleClarificationResponse(response: ClarificationSessionResponse) {
  clarificationLastResponse.value = response;
  clarificationSession.value = response.session;

  if (response.session.ready_to_compile && response.session.rewritten_compile_prompt) {
    await compilePrompt(response.session.rewritten_compile_prompt);
    return;
  }

  if (response.session.ready_to_compile && !response.session.rewritten_compile_prompt) {
    await compilePrompt(buildPromptFromAnswers());
    return;
  }

  runState.value = "idle";
}

function buildPromptFromAnswers() {
  const answerText = clarificationAnswers.value
    .map((answer, index) => `${index + 1}. ${answer.question}\nAnswer: ${answer.answer}`)
    .join("\n\n");

  return `${clarificationOriginalInput.value || trimmedInput.value}\n\nClarified details:\n${answerText}`;
}

function extractRetrySeconds(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const match = raw.match(/(?:try again in|retry after|wait)\s+([0-9.]+)\s*(s|sec|second|seconds|m|minute|minutes)?/i);

  if (!match) return null;

  const amount = match[1];
  const unit = match[2]?.toLowerCase() ?? "seconds";

  if (unit.startsWith("m")) {
    return `${amount} minute${amount === "1" ? "" : "s"}`;
  }

  return `${amount} second${amount === "1" ? "" : "s"}`;
}

function setFriendlyError(error: unknown, fallback: string) {
  const retrySeconds = extractRetrySeconds(error);

  if (retrySeconds) {
    clarificationRateLimitMessage.value = `Provider rate limit reached. Wait ${retrySeconds}, then press Continue again. Your answers are still saved.`;
    errorMessage.value = "";
    runState.value = "idle";
    return;
  }

  errorMessage.value = error instanceof Error ? error.message : fallback;
  runState.value = "failed";
}

async function compileDirectly() {
  if (!hasInput.value || isBusy.value) return;

  resetRun();
  await compilePrompt(trimmedInput.value);
}

async function compilePrompt(input: string) {
  runState.value = "compiling";
  errorMessage.value = "";

  try {
    const response = await $fetch<CompileJob>("/api/compile", {
      method: "POST",
      body: {
        input,
        mode: mode.value,
      },
    });

    if (compileResultNeedsClarification(response)) {
      job.value = null;
      await startClarificationForInput(input);
      return;
    }

    job.value = response;
    resetN8nGeneratorState();
    runState.value = response.safety_critic?.overall_status === "not_safe_to_automate" ? "blocked" : "ready";
    activePanel.value = "context";
  } catch (error) {
    setFriendlyError(error, "Compile failed.");
  }
}

function backToInput() {
  resetRun();
}

function copyBlueprint() {
  const payload = job.value?.result ?? job.value;
  if (!payload) return;
  void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
}

function actionLabel() {
  if (hasClarification.value) return "Continue";
  if (job.value) return "Copy blueprint";
  if (isBusy.value) return "Working";
  return "Compile";
}

function primaryAction() {
  if (job.value) {
    copyBlueprint();
    return;
  }

  if (hasClarification.value) {
    void continueClarification();
    return;
  }

  void compileDirectly();
}

function isPrimaryDisabled() {
  if (job.value) return false;
  if (hasClarification.value) return !canContinueClarification.value;
  return !hasInput.value || isBusy.value;
}
</script>

<template>
  <main class="console-shell">
    <header class="topbar">
      <div class="brandline">
        <span class="brand-mark">FF</span>
        <span class="brand-path">FlowForge / Compiler</span>
      </div>

      <div class="topbar-status">
        <span class="status-pill" :class="`tone-${mainStatusTone}`">
          <span class="pulse-dot" />
          {{ mainStatus }}
        </span>

        <div class="mode-menu-wrap">
          <button
            type="button"
            class="mode-menu-trigger"
            :class="{ open: showModeMenu }"
            @click="showModeMenu = !showModeMenu"
          >
            <span class="mode-menu-kicker">Mode</span>
            <strong>{{ selectedMode.label }}</strong>
            <small>{{ selectedMode.hint }}</small>
            <span class="mode-chevron">⌄</span>
          </button>

          <div v-if="showModeMenu" class="mode-menu-popover">
            <button
              v-for="item in modes"
              :key="item.value"
              type="button"
              class="mode-menu-option"
              :class="{ selected: mode === item.value }"
              @click="selectMode(item.value)"
            >
              <strong>{{ item.label }}</strong>
              <small>{{ item.hint }}</small>
            </button>
          </div>
        </div>
      </div>
    </header>

    <section class="console-grid">
      <aside class="agent-rail" aria-label="FlowForge agent stages">
        <div
          v-for="agent in agentRail"
          :key="agent.label"
          class="rail-item"
          :class="`rail-${agent.state}`"
        >
          <span class="rail-dot" />
          <span>{{ agent.label }}</span>
        </div>
      </aside>

      <section class="workspace-panel">
        <div v-if="!job && !hasClarification" class="input-stage">
          <div class="input-header">
            <p class="eyebrow">Automation request</p>
            <h1>What do you want FlowForge to plan?</h1>
          </div>

          <textarea
            v-model="processInput"
            class="process-input"
            placeholder="Example: Automate support email triage, draft replies, tag urgency, and create internal tasks for review."
            rows="7"
            @input="errorMessage = ''"
          />

          <div class="example-row">
            <button
              v-for="example in examples"
              :key="example.label"
              type="button"
              class="example-chip"
              :class="{ selected: selectedExampleLabel === example.label }"
              @click="chooseExample(example)"
            >
              {{ example.label }}
            </button>
          </div>

          <p class="input-note">
            FlowForge will clarify vague requests first. Clear requests compile into a safe, non-executing workflow preview.
          </p>
        </div>

        <div v-else-if="hasClarification && currentQuestion" class="clarify-stage">
          <div class="stage-kicker">
            <span>Guided clarification</span>
            <span>{{ clarificationProgressLabel }}</span>
          </div>

          <div class="question-card">
            <div class="question-kind">{{ currentQuestion.kind.replaceAll("_", " ") }}</div>
            <h2>{{ currentQuestion.question }}</h2>
            <p>{{ currentQuestion.why_it_matters }}</p>

            <textarea
              v-model="clarificationAnswerDraft"
              class="answer-input"
              rows="4"
              :placeholder="currentQuestion.example_answer || 'Type a short answer...'"
              @keydown.meta.enter.prevent="continueClarification"
              @keydown.ctrl.enter.prevent="continueClarification"
            />

            <div v-if="currentQuestion.example_answer" class="example-answer">
              <span>Example</span>
              {{ currentQuestion.example_answer }}
            </div>
          </div>
        </div>

        <div v-else-if="job" class="result-stage">
          <div class="stage-kicker">
            <span>{{ safetyStatus || "compiled" }}</span>
            <span>non-executing preview</span>
          </div>

          <section v-if="safetyStatus === 'not_safe_to_automate'" class="blocked-panel">
            <div class="blocked-icon">!</div>
            <div>
              <h1>{{ resultTitle }}</h1>
              <p>{{ resultSubtitle }}</p>
              <div class="safe-move">
                <span>Next safe move</span>
                <strong>{{ nextSafeAction }}</strong>
              </div>
            </div>
          </section>

          <section v-else class="blueprint-panel">
            <div class="blueprint-heading">
              <div>
                <p class="eyebrow">Automation blueprint</p>
                <h1>{{ resultTitle }}</h1>
                <p>{{ resultSubtitle }}</p>
              </div>
            </div>

            <div v-if="workflowSteps.length" class="flow-map">
              <article
                v-for="(step, index) in workflowSteps"
                :key="step.id || step.label || step.title || step.name || index"
                class="flow-node"
                :class="`flow-${workflowStepTone(step)}`"
                :style="`--flow-index: ${index}`"
              >
                <div class="node-index">{{ index + 1 }}</div>
                <div class="node-body">
                  <h3>{{ workflowStepLabel(step, index) }}</h3>
                  <p>{{ step.description || "Safe workflow step." }}</p>
                  <dl class="node-meta">
                    <div v-if="step.primitive">
                      <dt>Step type</dt>
                      <dd>{{ primitiveLabel(step.primitive) }}</dd>
                    </div>
                    <div v-if="step.automation_policy">
                      <dt>Automation policy</dt>
                      <dd>{{ automationPolicyLabel(step.automation_policy) }}</dd>
                    </div>
                    <div>
                      <dt>Execution boundary</dt>
                      <dd>{{ executionBoundaryLabel(step.real_world_execution) }}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            </div>

            <div v-else class="empty-flow">
              Workflow details are available in the raw result, but no step list was returned.
            </div>

            <section v-if="job" class="handoff-card">
              <div class="handoff-head">
                <div>
                  <p class="eyebrow">Implementation handoff</p>
                  <h2>n8n builder prompt</h2>
                  <p>
                    Safe implementation brief generated from this blueprint. It keeps FlowForge non-executing and requires human approval before real-world actions.
                  </p>
                </div>

                <button type="button" class="handoff-copy" @click="copyN8nImplementationPrompt">
                  {{ handoffCopied ? "Copied" : "Copy prompt" }}
                </button>
              </div>

              <details class="handoff-preview">
                <summary>Preview implementation prompt</summary>
                <pre>{{ n8nImplementationPrompt }}</pre>
              </details>

              <section class="n8n-json-draft" aria-label="n8n JSON draft generator">
                <div class="n8n-json-head">
                  <div>
                    <h3>n8n JSON draft</h3>
                    <p>
                      Generate an importable workflow JSON draft from this safe blueprint while keeping production side effects disabled.
                    </p>
                  </div>

                  <button
                    type="button"
                    class="n8n-generate-button"
                    :disabled="!canGenerateN8nJson"
                    @click="generateN8nWorkflowDraft"
                  >
                    <span v-if="n8nGeneratorState === 'generating'" class="mini-loader" />
                    <span>{{ n8nGeneratorState === "generating" ? "Generating" : "Generate n8n JSON draft" }}</span>
                  </button>
                </div>

                <p class="n8n-safety-note">
                  {{ n8nStaticSafetyWarning }}
                </p>

                <p v-if="n8nGenerateError" class="n8n-error">
                  {{ n8nGenerateError }}
                </p>

                <ul v-if="displayedN8nWarnings.length" class="n8n-warning-list">
                  <li v-for="warning in displayedN8nWarnings" :key="warning">{{ warning }}</li>
                </ul>

                <div v-if="n8nWorkflowDraft" class="n8n-json-output">
                  <div class="n8n-json-toolbar">
                    <span>{{ n8nGeneratorMeta }}</span>
                    <div>
                      <button type="button" class="handoff-copy" @click="copyN8nWorkflowJson">
                        {{ n8nJsonCopied ? "Copied" : "Copy JSON" }}
                      </button>
                      <button type="button" class="handoff-copy" @click="downloadN8nWorkflowJson">
                        Download JSON
                      </button>
                    </div>
                  </div>

                  <pre>{{ n8nWorkflowJsonText }}</pre>
                </div>
              </section>
            </section>
          </section>
        </div>

        <div v-else-if="runState === 'failed'" class="error-panel">
          <h1>Something failed</h1>
          <p>{{ errorMessage }}</p>
          <button type="button" class="ghost-button" @click="backToInput">Back to input</button>
        </div>
      </section>

      <aside class="side-panel">
        <nav class="panel-tabs">
          <button
            type="button"
            :class="{ active: activePanel === 'context' }"
            @click="activePanel = 'context'"
          >
            Context
          </button>
          <button
            type="button"
            :class="{ active: activePanel === 'agents' }"
            @click="activePanel = 'agents'"
          >
            Agents
          </button>
          <button
            type="button"
            :class="{ active: activePanel === 'details' }"
            @click="activePanel = 'details'"
          >
            Details
          </button>
          <button
            type="button"
            :class="{ active: activePanel === 'trace' }"
            @click="activePanel = 'trace'"
          >
            Trace
          </button>
        </nav>

        <div class="panel-scroll">
          <section v-if="activePanel === 'context'" class="side-section">
            <div class="side-title">
              <h2>Known facts</h2>
              <span>{{ knownFactItems.length }}</span>
            </div>

            <div v-if="knownFactItems.length" class="fact-list">
              <div v-for="item in knownFactItems" :key="item.label" class="fact-item">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>

            <p v-else class="muted">
              Context will appear here after clarification or compile.
            </p>

            <div class="answers-box">
              <button type="button" class="answers-toggle" @click="showAnswered = !showAnswered">
                <span>Collected answers</span>
                <strong>{{ clarificationAnswers.length }}</strong>
              </button>

              <div v-if="showAnswered" class="answer-history">
                <article v-for="answer in clarificationAnswers" :key="answer.question_id" class="history-item">
                  <span>{{ answer.question }}</span>
                  <p>{{ answer.answer }}</p>
                </article>
              </div>
            </div>
          </section>

          <section v-else-if="activePanel === 'agents'" class="side-section">
            <div class="side-title">
              <h2>Agent work</h2>
              <span>{{ agentCards.filter((agent) => agent.status === "done").length }}/{{ agentCards.length }}</span>
            </div>

            <div class="agent-card-list">
              <article
                v-for="agent in agentCards"
                :key="agent.id"
                class="agent-card"
                :class="`agent-${agent.status}`"
              >
                <div class="agent-card-head">
                  <span class="agent-orb" />
                  <strong>{{ agent.label }}</strong>
                  <small>{{ agent.status }}</small>
                </div>

                <div class="agent-status-line">
                  <span :class="`agent-provider-pill tone-${agent.providerTone}`">{{ agent.statusLabel }}</span>
                  <span>{{ agent.provider }}</span>
                </div>

                <p>{{ agent.summary }}</p>
                <p v-if="shouldShowAgentReason(agent)" class="agent-status-reason">{{ agent.statusReason }}</p>

                <footer>
                  <span>{{ agent.providerTone }}</span>
                  <button
                    v-if="agent.debugId || agent.id === 'router'"
                    type="button"
                    class="agent-details-button"
                    @click="openAgentDetails(agent.id)"
                  >
                    Details
                  </button>
                </footer>
              </article>
            </div>

            <p class="muted agent-note">
              Agents are visible here while they work. Full raw debug can stay hidden, but the user should always see which agent is active.
            </p>
          </section>

          <section v-else-if="activePanel === 'details'" class="side-section">
            <div class="side-title">
              <h2>Run observability</h2>
              <span>{{ safetyStatus || "none" }}</span>
            </div>

            <div class="observability-grid">
              <article
                v-for="card in observabilityCards"
                :key="card.label"
                class="observability-card"
                :class="`tone-${card.tone}`"
              >
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
                <p>{{ card.note }}</p>
              </article>
            </div>

            <template v-if="job">
              <div class="side-title compact-title">
                <h2>Safety details</h2>
                <span>{{ job.risks?.risk_level || "unknown" }}</span>
              </div>

              <div class="detail-card">
                <span>Risk</span>
                <strong>{{ job.risks?.risk_level || "unknown" }}</strong>
              </div>

              <div class="detail-card">
                <span>Readiness</span>
                <strong>{{ job.readiness?.score ?? "n/a" }}</strong>
              </div>

              <div class="detail-card">
                <span>Next safe action</span>
                <strong>{{ nextSafeAction }}</strong>
              </div>

              <div v-if="providerFailureItems.length" class="side-title compact-title">
                <h2>Provider failures</h2>
                <span>{{ providerFailureItems.length }}</span>
              </div>

              <div v-if="providerFailureItems.length" class="failure-list">
                <article v-for="item in providerFailureItems" :key="item.label" class="failure-item">
                  <span>{{ item.label }}</span>
                  <p>{{ item.value }}</p>
                </article>
              </div>
            </template>
          </section>

          <section v-else class="side-section">
            <div class="side-title">
              <h2>Trace</h2>
              <span>{{ job?.agent_trace?.length || 0 }}</span>
            </div>

            <div v-if="job?.agent_trace?.length" class="trace-list">
              <article v-for="(event, index) in job.agent_trace" :key="index" class="trace-item">
                <div class="trace-head">
                  <strong>{{ event.action || event.tool_name || `Trace ${index + 1}` }}</strong>
                  <span :class="`trace-status trace-${event.status || 'completed'}`">{{ event.status || "completed" }}</span>
                </div>
                <p>{{ compactText(event.output_summary || event.input_summary || event.reason || "Completed", 260) }}</p>
                <details v-if="event.reason || event.metadata" class="trace-details">
                  <summary>Why / metadata</summary>
                  <pre>{{ formatDebugValue({ reason: event.reason, metadata: event.metadata }) }}</pre>
                </details>
              </article>
            </div>

            <p v-else class="muted">
              Agent and compiler trace appears here after compile.
            </p>
          </section>
        </div>
      </aside>
    </section>


    <div v-if="activeAgentDetailsId" class="agent-modal-backdrop" @click.self="closeAgentDetails">
      <section class="agent-modal" role="dialog" aria-modal="true">
        <header class="agent-modal-header">
          <div>
            <p class="eyebrow">Agent details</p>
            <h2>{{ activeAgentCard?.label || "Agent" }}</h2>
          </div>
          <button type="button" class="modal-close" @click="closeAgentDetails">×</button>
        </header>

        <div class="agent-modal-grid">
          <article class="modal-section">
            <h3>Prompt</h3>
            <template v-if="activeAgentDebug">
              <h4>System prompt</h4>
              <pre>{{ activeAgentDebug.system_prompt }}</pre>
              <h4>User prompt</h4>
              <pre>{{ activeAgentDebug.user_prompt }}</pre>
            </template>
            <template v-else-if="activeAgentDetailsId === 'guided_clarifier'">
              <pre>Guided clarification session endpoint: /api/clarify

The current endpoint returns the agent outcome and raw provider response when available. It does not yet expose the full prompt bundle in the response.</pre>
            </template>
            <template v-else>
              <pre>No prompt debug was returned for this agent.</pre>
            </template>
          </article>

          <article class="modal-section">
            <h3>Outcome</h3>
            <pre>{{ formatDebugValue(activeAgentDebug?.final_output ?? activeAgentOutcome) }}</pre>
          </article>

          <article class="modal-section full">
            <h3>Provider attempts</h3>
            <template v-if="activeAgentDebug?.provider_attempts?.length">
              <div class="provider-attempts">
                <article
                  v-for="attempt in activeAgentDebug.provider_attempts"
                  :key="attempt.provider"
                  class="provider-attempt"
                  :class="{ success: attempt.success }"
                >
                  <strong>{{ attempt.provider }}</strong>
                  <span>{{ attempt.success ? "success" : attempt.attempted ? "failed" : "not attempted" }}</span>
                  <p v-if="attempt.error_summary">{{ attempt.error_summary }}</p>
                  <details v-if="attempt.raw_error_summary">
                    <summary>Raw error</summary>
                    <pre>{{ attempt.raw_error_summary }}</pre>
                  </details>
                  <details v-if="attempt.raw_response">
                    <summary>Raw response</summary>
                    <pre>{{ attempt.raw_response }}</pre>
                  </details>
                </article>
              </div>
            </template>
            <pre v-else>No provider attempts were returned for this agent.</pre>
          </article>
        </div>
      </section>
    </div>

    <footer class="action-bar">
      <div class="action-left">
        <button v-if="job || hasClarification" type="button" class="ghost-button" @click="backToInput">
          Edit input
        </button>
        <button v-if="!job && !hasClarification" type="button" class="ghost-button" :disabled="!hasInput || isBusy" @click="startGuidedCompile">
          Clarify first
        </button>
      </div>

      <div class="action-status">
        <span v-if="isBusy" class="mini-loader" />
        <span v-if="clarificationRateLimitMessage">{{ clarificationRateLimitMessage }}</span>
        <span v-else-if="errorMessage">{{ errorMessage }}</span>
        <span v-else-if="hasClarification">Answer the current question. Previous answers stay in Context.</span>
        <span v-else-if="job">Blueprint is ready. Details are optional.</span>
        <span v-else>Start guided compile or use a preset.</span>
      </div>

      <button
        type="button"
        class="primary-action"
        :disabled="isPrimaryDisabled()"
        @click="primaryAction"
      >
        {{ actionLabel() }}
        <span>→</span>
      </button>
    </footer>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(89, 111, 255, 0.18), transparent 32rem),
    radial-gradient(circle at bottom right, rgba(22, 190, 180, 0.12), transparent 28rem),
    #070a12;
  color: #eef3ff;
}

.console-shell {
  min-height: 100vh;
  padding: 56px 16px 96px;
  box-sizing: border-box;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

/* Firefox */
.console-shell,
.console-shell * {
  scrollbar-width: thin;
  scrollbar-color: rgba(102, 227, 255, 0.5) rgba(8, 12, 22, 0.42);
}

/* Chromium / Safari / Edge */
.console-shell ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.console-shell ::-webkit-scrollbar-track {
  border: 1px solid rgba(145, 166, 255, 0.1);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01)),
    rgba(8, 12, 22, 0.48);
}

.console-shell ::-webkit-scrollbar-thumb {
  border: 2px solid rgba(7, 10, 18, 0.88);
  border-radius: 999px;
  background:
    linear-gradient(135deg, rgba(102, 227, 255, 0.78), rgba(140, 125, 255, 0.72));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 0 14px rgba(102, 227, 255, 0.14);
}

.console-shell ::-webkit-scrollbar-thumb:hover {
  background:
    linear-gradient(135deg, rgba(102, 227, 255, 0.96), rgba(67, 224, 166, 0.82));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    0 0 18px rgba(102, 227, 255, 0.28);
}

.console-shell ::-webkit-scrollbar-corner {
  background: rgba(8, 12, 22, 0.48);
}

.topbar {
  position: fixed;
  z-index: 40;
  inset: 0 0 auto 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.18);
  background: rgba(7, 10, 18, 0.86);
  backdrop-filter: blur(18px);
}

.brandline,
.topbar-status {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(129, 150, 255, 0.4);
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(82, 104, 255, 0.24), rgba(18, 210, 191, 0.16));
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.brand-path {
  font-size: 13px;
  color: #c7d2ff;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 112px;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid rgba(145, 166, 255, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.045);
  font-size: 12px;
  color: #dfe6ff;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #7d8cff;
  box-shadow: 0 0 16px rgba(125, 140, 255, 0.8);
}

.tone-success .pulse-dot {
  background: #43e0a6;
  box-shadow: 0 0 16px rgba(67, 224, 166, 0.8);
}

.tone-warning .pulse-dot {
  background: #ffd166;
  box-shadow: 0 0 16px rgba(255, 209, 102, 0.8);
}

.tone-danger .pulse-dot {
  background: #ff6b6b;
  box-shadow: 0 0 16px rgba(255, 107, 107, 0.8);
}

.tone-active .pulse-dot {
  background: #66e3ff;
  box-shadow: 0 0 16px rgba(102, 227, 255, 0.8);
}

.mode-segment {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.mode-menu-trigger,
.mode-menu-option,
.ghost-button,
.example-chip,
.panel-tabs button,
.answers-toggle {
  border: 1px solid rgba(145, 166, 255, 0.18);
  color: #dbe4ff;
  background: rgba(255, 255, 255, 0.045);
  border-radius: 11px;
  cursor: pointer;
}

.mode-segment button {
  height: 26px;
  padding: 0 9px;
  font-size: 11px;
  border-color: transparent;
  background: transparent;
}

.mode-menu-wrap {
  position: relative;
  flex: 0 0 auto;
  width: 176px;
}

.mode-menu-trigger {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "kicker chevron"
    "label chevron"
    "hint chevron";
  align-items: center;
  width: 100%;
  height: 44px;
  padding: 7px 10px;
  border: 1px solid rgba(102, 227, 255, 0.26);
  border-radius: 14px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.12), transparent 8rem),
    rgba(255, 255, 255, 0.045);
  color: #eef3ff;
  cursor: pointer;
  text-align: left;
}

.mode-menu-trigger.open,
.mode-menu-trigger:hover {
  border-color: rgba(102, 227, 255, 0.58);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.18), transparent 8rem),
    rgba(102, 227, 255, 0.08);
}

.mode-menu-kicker {
  grid-area: kicker;
  color: #7d8cff;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.mode-menu-trigger strong {
  grid-area: label;
  margin-top: 1px;
  color: #eef3ff;
  font-size: 12px;
  font-weight: 950;
  line-height: 1;
}

.mode-menu-trigger small {
  grid-area: hint;
  margin-top: 2px;
  color: #9ba9d8;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

.mode-chevron {
  grid-area: chevron;
  color: #66e3ff;
  font-size: 17px;
  line-height: 1;
}

.mode-menu-popover {
  position: absolute;
  z-index: 80;
  right: 0;
  top: calc(100% + 8px);
  display: grid;
  width: 230px;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(145, 166, 255, 0.22);
  border-radius: 16px;
  background: rgba(7, 10, 18, 0.98);
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.45);
}

.mode-menu-option {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #eef3ff;
  cursor: pointer;
  text-align: left;
}

.mode-menu-option:hover,
.mode-menu-option.selected {
  border-color: rgba(102, 227, 255, 0.34);
  background: rgba(102, 227, 255, 0.09);
}

.mode-menu-option strong {
  font-size: 12px;
}

.mode-menu-option small {
  color: #9ba9d8;
  font-size: 11px;
}

.console-grid {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 340px;
  gap: 14px;
  max-width: 1480px;
  margin: 0 auto;
}

.agent-rail,
.workspace-panel,
.side-panel {
  border: 1px solid rgba(145, 166, 255, 0.16);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82);
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24);
}

.agent-rail {
  border-radius: 22px;
  padding: 14px;
  align-self: start;
  position: sticky;
  top: 58px;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  font-size: 13px;
  color: #7e8dbd;
}

.rail-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 1px solid rgba(145, 166, 255, 0.35);
  background: rgba(255, 255, 255, 0.06);
}

.rail-done {
  color: #b9c7ff;
}

.rail-done .rail-dot {
  background: #43e0a6;
  border-color: #43e0a6;
}

.rail-active {
  color: #eef3ff;
}

.rail-active .rail-dot {
  background: #66e3ff;
  border-color: #66e3ff;
  box-shadow: 0 0 18px rgba(102, 227, 255, 0.75);
}

.workspace-panel {
  min-height: calc(100vh - 168px);
  border-radius: 26px;
  padding: 22px;
  overflow: hidden;
}

.input-stage,
.clarify-stage,
.result-stage,
.error-panel {
  min-height: calc(100vh - 212px);
  display: flex;
  flex-direction: column;
}

.input-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.eyebrow,
.stage-kicker {
  color: #7d8cff;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 800;
  font-size: 11px;
}

.input-header h1,
.blueprint-heading h1,
.blocked-panel h1,
.error-panel h1 {
  margin: 0;
  font-size: clamp(22px, 3vw, 38px);
  letter-spacing: -0.04em;
}

.process-input,
.answer-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(10, 17, 33, 0.96), rgba(8, 12, 22, 0.96));
  color: #eef3ff;
  outline: none;
  padding: 18px;
  font: inherit;
  line-height: 1.55;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.process-input:focus,
.answer-input:focus {
  border-color: rgba(102, 227, 255, 0.62);
  box-shadow:
    0 0 0 3px rgba(102, 227, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.example-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.example-chip {
  padding: 8px 11px;
  font-size: 12px;
}

.input-note,
.muted,
.blueprint-heading p,
.blocked-panel p,
.question-card p {
  color: #9ba9d8;
}

.stage-kicker {
  display: flex;
  justify-content: space-between;
  margin-bottom: 14px;
}

.question-card {
  border: 1px solid rgba(102, 227, 255, 0.18);
  border-radius: 26px;
  padding: 22px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.11), transparent 22rem),
    rgba(255, 255, 255, 0.035);
}

.question-kind {
  display: inline-flex;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid rgba(102, 227, 255, 0.26);
  color: #9decff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.question-card h2 {
  margin: 14px 0 8px;
  max-width: 850px;
  font-size: clamp(24px, 4vw, 44px);
  line-height: 1.04;
  letter-spacing: -0.055em;
}

.answer-input {
  margin-top: 18px;
  min-height: 122px;
}

.example-answer {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px dashed rgba(145, 166, 255, 0.25);
  border-radius: 16px;
  color: #c8d4ff;
  background: rgba(255, 255, 255, 0.035);
}

.example-answer span {
  display: block;
  margin-bottom: 4px;
  color: #7d8cff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 800;
}

.blocked-panel,
.blueprint-panel {
  border-radius: 26px;
  border: 1px solid rgba(145, 166, 255, 0.16);
  background: rgba(255, 255, 255, 0.035);
  padding: 22px;
}

.blocked-panel {
  display: flex;
  gap: 18px;
  border-color: rgba(255, 107, 107, 0.26);
}

.blocked-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 16px;
  background: rgba(255, 107, 107, 0.14);
  color: #ff9a9a;
  font-weight: 900;
  font-size: 24px;
}

.safe-move {
  margin-top: 18px;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.045);
}

.safe-move span {
  display: block;
  color: #7d8cff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 800;
  margin-bottom: 6px;
}

.flow-map {
  --connector-gap: 34px;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 28px var(--connector-gap);
  margin-top: 20px;
  padding: 8px;
  overflow: visible;
}

.flow-node {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  flex: 1 1 240px;
  min-width: 220px;
  max-width: 300px;
}

/* n8n-style cable between nodes. No arrows. */
.flow-node:not(:last-child)::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: calc(50% + 26px);
  left: 100%;
  width: var(--connector-gap);
  height: 2px;
  border-radius: 999px;
  background: rgba(102, 227, 255, 0.22);
  transform: translateY(-50%);
}

.flow-node:not(:last-child)::after {
  content: "";
  position: absolute;
  z-index: 1;
  top: calc(50% + 26px);
  left: 100%;
  width: var(--connector-gap);
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(102, 227, 255, 0.95),
    rgba(140, 125, 255, 0.95),
    transparent
  );
  transform: translateY(-50%) scaleX(0);
  transform-origin: left center;
  filter: drop-shadow(0 0 8px rgba(102, 227, 255, 0.55));
  animation: flowSignal 3.2s ease-in-out infinite;
  animation-delay: calc(var(--flow-index) * 180ms);
}

.node-index {
  z-index: 2;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(102, 227, 255, 0.28);
  border-radius: 15px;
  color: #07101c;
  font-weight: 900;
  background: linear-gradient(135deg, #66e3ff, #8c7dff);
  box-shadow: 0 0 22px rgba(102, 227, 255, 0.14);
}

.node-body {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-rows: auto minmax(76px, 1fr) auto;
  min-height: 220px;
  border: 1px solid rgba(145, 166, 255, 0.15);
  border-radius: 18px;
  padding: 14px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.07), transparent 10rem),
    rgba(6, 10, 20, 0.88);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.18);
}

.flow-safe .node-body {
  border-color: rgba(67, 224, 166, 0.25);
}

.flow-assist .node-body,
.flow-draft .node-body {
  border-color: rgba(255, 209, 102, 0.25);
  background:
    radial-gradient(circle at top right, rgba(255, 209, 102, 0.08), transparent 10rem),
    rgba(6, 10, 20, 0.88);
}

.flow-approval .node-body {
  border-color: rgba(140, 125, 255, 0.34);
  background:
    radial-gradient(circle at top right, rgba(140, 125, 255, 0.11), transparent 10rem),
    rgba(6, 10, 20, 0.88);
}

.flow-blocked .node-body {
  border-color: rgba(255, 107, 107, 0.3);
  background:
    radial-gradient(circle at top right, rgba(255, 107, 107, 0.09), transparent 10rem),
    rgba(6, 10, 20, 0.88);
}

.flow-assist .node-index,
.flow-draft .node-index {
  background: linear-gradient(135deg, #ffd166, #8c7dff);
}

.flow-approval .node-index {
  background: linear-gradient(135deg, #8c7dff, #66e3ff);
}

.flow-blocked .node-index {
  background: linear-gradient(135deg, #ff6b6b, #ffd166);
}

.node-body h3 {
  margin: 0 0 6px;
  font-size: 15px;
  line-height: 1.18;
}

.node-body p {
  margin: 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.42;
}

.node-meta {
  display: grid;
  gap: 7px;
  margin: 12px 0 0;
}

.node-meta div {
  display: grid;
  gap: 3px;
  padding: 7px 8px;
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.node-meta dt {
  color: #7d8cff;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.node-meta dd {
  margin: 0;
  color: #dbe4ff;
  font-size: 11px;
  line-height: 1.2;
  text-transform: capitalize;
}

@keyframes flowSignal {
  0% {
    opacity: 0;
    transform: translateY(-50%) scaleX(0);
  }

  12% {
    opacity: 1;
    transform: translateY(-50%) scaleX(1);
  }

  24% {
    opacity: 0;
    transform: translateY(-50%) scaleX(1);
  }

  100% {
    opacity: 0;
    transform: translateY(-50%) scaleX(1);
  }
}

.handoff-card {
  margin-top: 22px;
  padding: 16px;
  border: 1px solid rgba(102, 227, 255, 0.18);
  border-radius: 22px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.08), transparent 18rem),
    rgba(255, 255, 255, 0.035);
}

.handoff-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}

.handoff-head h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.handoff-head p {
  margin: 0;
  max-width: 760px;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.45;
}

.handoff-copy {
  flex: 0 0 auto;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(102, 227, 255, 0.32);
  border-radius: 13px;
  background: rgba(102, 227, 255, 0.08);
  color: #66e3ff;
  font-weight: 900;
  cursor: pointer;
}

.handoff-copy:hover {
  border-color: rgba(102, 227, 255, 0.62);
  background: rgba(102, 227, 255, 0.13);
}

.handoff-copy:disabled,
.n8n-generate-button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.handoff-preview {
  margin-top: 14px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 16px;
  background: rgba(4, 8, 16, 0.52);
  overflow: hidden;
}

.handoff-preview summary {
  padding: 12px 14px;
  color: #cbd6ff;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.handoff-preview pre {
  max-height: 320px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-top: 1px solid rgba(145, 166, 255, 0.13);
  color: #dbe4ff;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.n8n-json-draft {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 14px;
  border: 1px solid rgba(67, 224, 166, 0.18);
  border-radius: 16px;
  background: rgba(67, 224, 166, 0.035);
}

.n8n-json-head,
.n8n-json-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.n8n-json-head h3 {
  margin: 0 0 5px;
  color: #e9efff;
  font-size: 15px;
}

.n8n-json-head p,
.n8n-safety-note {
  margin: 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.4;
}

.n8n-generate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  flex: 0 0 auto;
  padding: 0 14px;
  border: 1px solid rgba(67, 224, 166, 0.34);
  border-radius: 13px;
  background: rgba(67, 224, 166, 0.1);
  color: #8ff5cc;
  font-weight: 900;
  cursor: pointer;
}

.n8n-generate-button:hover:not(:disabled) {
  border-color: rgba(67, 224, 166, 0.62);
  background: rgba(67, 224, 166, 0.15);
}

.n8n-safety-note {
  padding: 10px 12px;
  border: 1px solid rgba(255, 209, 102, 0.22);
  border-radius: 12px;
  background: rgba(255, 209, 102, 0.055);
  color: #ffe7a3;
}

.n8n-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 107, 107, 0.25);
  border-radius: 12px;
  background: rgba(255, 107, 107, 0.055);
  color: #ffb3b3;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.n8n-warning-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.n8n-warning-list li {
  padding: 9px 11px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 12px;
  color: #cbd6ff;
  background: rgba(255, 255, 255, 0.035);
  font-size: 12px;
  line-height: 1.35;
}

.n8n-json-output {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 16px;
  background: rgba(4, 8, 16, 0.62);
}

.n8n-json-toolbar {
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.13);
}

.n8n-json-toolbar span {
  color: #9ba9d8;
  font-size: 12px;
  min-width: 0;
}

.n8n-json-toolbar div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.n8n-json-output pre {
  max-height: 420px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  color: #dbe4ff;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre;
}

.empty-flow {
  margin-top: 16px;
  padding: 16px;
  border-radius: 16px;
  color: #9ba9d8;
  background: rgba(255, 255, 255, 0.035);
}

.side-panel {
  border-radius: 22px;
  height: calc(100vh - 168px);
  min-height: 520px;
  position: sticky;
  top: 58px;
  overflow: hidden;
}

.panel-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.12);
}

.panel-tabs button {
  height: 32px;
  font-size: 12px;
}

.panel-tabs button.active {
  border-color: rgba(102, 227, 255, 0.45);
  background: rgba(102, 227, 255, 0.1);
  color: #effcff;
}

.panel-scroll {
  height: calc(100% - 54px);
  overflow: auto;
  padding: 14px;
}

.side-title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.side-title h2 {
  margin: 0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #cbd6ff;
}

.side-title span {
  color: #7d8cff;
  font-size: 12px;
}

.fact-list,
.trace-list {
  display: grid;
  gap: 8px;
}

.fact-item,
.detail-card,
.trace-item,
.history-item {
  padding: 11px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.035);
}

.fact-item span,
.detail-card span,
.history-item span {
  display: block;
  color: #7d8cff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 800;
  margin-bottom: 5px;
}

.fact-item strong,
.detail-card strong {
  font-size: 13px;
  color: #e9efff;
  font-weight: 600;
}

.observability-grid,
.failure-list {
  display: grid;
  gap: 8px;
}

.observability-card {
  display: grid;
  gap: 5px;
  padding: 11px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.035);
}

.observability-card span,
.failure-item span {
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.observability-card strong {
  color: #e9efff;
  font-size: 17px;
  font-weight: 950;
}

.observability-card p,
.failure-item p {
  margin: 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.35;
}

.observability-card.tone-success {
  border-color: rgba(67, 224, 166, 0.24);
  background: rgba(67, 224, 166, 0.055);
}

.observability-card.tone-warning {
  border-color: rgba(255, 209, 102, 0.26);
  background: rgba(255, 209, 102, 0.055);
}

.observability-card.tone-danger {
  border-color: rgba(255, 107, 107, 0.26);
  background: rgba(255, 107, 107, 0.055);
}

.compact-title {
  margin-top: 16px;
}

.failure-item {
  display: grid;
  gap: 5px;
  padding: 11px;
  border: 1px solid rgba(255, 107, 107, 0.22);
  border-radius: 15px;
  background: rgba(255, 107, 107, 0.04);
  min-width: 0;
  overflow-wrap: anywhere;
}

.answers-box {
  margin-top: 16px;
}

.answers-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: 10px 11px;
}

.answer-history {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  max-height: 300px;
  overflow: auto;
}

.history-item p,
.trace-item p {
  margin: 0;
  color: #9ba9d8;
  font-size: 13px;
}

.trace-item strong {
  display: block;
  margin-bottom: 5px;
}

.action-bar {
  position: fixed;
  z-index: 50;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  width: min(1120px, calc(100vw - 28px));
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 190px;
  gap: 12px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 22px;
  background: rgba(7, 10, 18, 0.9);
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.38);
}

.action-left {
  display: flex;
  gap: 8px;
}

.ghost-button {
  height: 42px;
  padding: 0 14px;
  white-space: nowrap;
}

.ghost-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #8ea0d6;
  font-size: 13px;
  min-width: 0;
  text-align: center;
}

.mini-loader {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(102, 227, 255, 0.2);
  border-top-color: #66e3ff;
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

.primary-action {
  height: 46px;
  border: 0;
  border-radius: 16px;
  color: #07101c;
  background: linear-gradient(135deg, #66e3ff, #8c7dff);
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 10px 30px rgba(102, 227, 255, 0.22);
}

.primary-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}


.mode-menu-trigger,
.mode-menu-option,
.example-chip,
.panel-tabs button,
.answers-toggle,
.ghost-button,
.primary-action,
.n8n-generate-button,
.agent-card,
.flow-node,
.question-card {
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    opacity 160ms ease;
}

.mode-menu-trigger:hover,
.mode-menu-option:hover,
.example-chip:hover,
.panel-tabs button:hover,
.answers-toggle:hover,
.ghost-button:hover {
  transform: translateY(-1px);
  border-color: rgba(102, 227, 255, 0.42);
  background: rgba(102, 227, 255, 0.08);
}

.example-chip.selected {
  color: #07101c;
  background: linear-gradient(135deg, #66e3ff, #8c7dff);
  border-color: transparent;
  font-weight: 900;
  box-shadow: 0 8px 24px rgba(102, 227, 255, 0.18);
}

.primary-action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 14px 36px rgba(102, 227, 255, 0.28);
}

.agent-card-list {
  display: grid;
  gap: 9px;
}

.agent-card {
  padding: 12px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.035);
}

.agent-card-head {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.agent-orb {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1px solid rgba(145, 166, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
}

.agent-card strong {
  font-size: 13px;
  color: #e9efff;
}

.agent-card small,

.agent-skipped {
  opacity: 0.72;
  border-color: rgba(255, 209, 102, 0.2);
}

.agent-skipped .agent-orb {
  background: #ffd166;
  border-color: #ffd166;
}

.agent-needs_detail {
  border-color: rgba(255, 107, 107, 0.25);
  background: rgba(255, 107, 107, 0.04);
}

.agent-needs_detail .agent-orb {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.agent-card footer {
  color: #7d8cff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.agent-card p {
  margin: 8px 0 10px;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.45;
}

.agent-active {
  border-color: rgba(102, 227, 255, 0.45);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.1), transparent 10rem),
    rgba(102, 227, 255, 0.045);
}

.agent-active .agent-orb {
  background: #66e3ff;
  border-color: #66e3ff;
  box-shadow: 0 0 18px rgba(102, 227, 255, 0.75);
  animation: agentPulse 1.2s ease-in-out infinite;
}

.agent-done .agent-orb {
  background: #43e0a6;
  border-color: #43e0a6;
}

.agent-note {
  margin-top: 12px;
}


.agent-status-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  align-items: center;
}

.agent-status-line > span:last-child {
  color: #7d8cff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-provider-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 999px;
  color: #9ba9d8;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-provider-pill.tone-ai {
  border-color: rgba(67, 224, 166, 0.28);
  background: rgba(67, 224, 166, 0.08);
  color: #43e0a6;
}

.agent-provider-pill.tone-fallback {
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.08);
  color: #ffd166;
}

.agent-provider-pill.tone-deterministic {
  border-color: rgba(145, 166, 255, 0.24);
  background: rgba(145, 166, 255, 0.07);
  color: #b9c7ff;
}

.agent-provider-pill.tone-failed {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.08);
  color: #ff9a9a;
}

.agent-provider-pill.tone-skipped,
.agent-provider-pill.tone-standby {
  border-color: rgba(145, 166, 255, 0.16);
  background: rgba(255, 255, 255, 0.03);
  color: #7e8dbd;
}

.agent-status-reason {
  margin-top: -4px !important;
  color: #7e8dbd !important;
  font-size: 12px !important;
}

@keyframes agentPulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.35);
    opacity: 1;
  }
}



.agent-skipped {
  opacity: 0.72;
  border-color: rgba(255, 209, 102, 0.2);
}

.agent-skipped .agent-orb {
  background: #ffd166;
  border-color: #ffd166;
}

.agent-needs_detail {
  border-color: rgba(255, 107, 107, 0.25);
  background: rgba(255, 107, 107, 0.04);
}

.agent-needs_detail .agent-orb {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.agent-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-details-button {
  border: 1px solid rgba(102, 227, 255, 0.24);
  border-radius: 999px;
  background: rgba(102, 227, 255, 0.08);
  color: #9decff;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
}

.agent-details-button:hover {
  transform: translateY(-1px);
  border-color: rgba(102, 227, 255, 0.55);
  background: rgba(102, 227, 255, 0.14);
}

.agent-modal-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 5, 12, 0.72);
  backdrop-filter: blur(16px);
}

.agent-modal {
  display: flex;
  flex-direction: column;
  width: min(1120px, calc(100vw - 32px));
  max-height: calc(100vh - 40px);
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.22);
  border-radius: 26px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.1), transparent 26rem),
    rgba(8, 12, 22, 0.96);
  box-shadow: 0 30px 110px rgba(0, 0, 0, 0.55);
}

.agent-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.15);
}

.agent-modal-header h2 {
  margin: 4px 0 0;
  font-size: 24px;
  letter-spacing: -0.04em;
}

.modal-close {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  color: #e9efff;
  cursor: pointer;
  font-size: 22px;
}

.agent-modal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 14px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.modal-section {
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.035);
  padding: 14px;
  min-width: 0;
}

.modal-section.full {
  grid-column: 1 / -1;
}

.modal-section h3,
.modal-section h4 {
  margin: 0 0 10px;
  color: #cbd6ff;
}

.modal-section h4 {
  margin-top: 14px;
  color: #7d8cff;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.modal-section pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #dbe4ff;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.22);
  padding: 12px;
}

.provider-attempts {
  display: grid;
  gap: 10px;
  padding-bottom: 18px;
}

.provider-attempt {
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.025);
}

.provider-attempt.success {
  border-color: rgba(67, 224, 166, 0.28);
}

.provider-attempt span {
  margin-left: 8px;
  color: #7d8cff;
  font-size: 12px;
}

.provider-attempt p {
  color: #ffb4b4;
}

.provider-attempt summary {
  cursor: pointer;
  color: #9decff;
  margin-top: 8px;
}



.trace-item,
.trace-item *,
.agent-card,
.agent-card *,
.provider-attempt,
.provider-attempt *,
.action-status {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.trace-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.trace-status {
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 999px;
  color: #9ba9d8;
  font-size: 10px;
  text-transform: uppercase;
}

.trace-completed {
  border-color: rgba(67, 224, 166, 0.28);
  color: #43e0a6;
}

.trace-failed {
  border-color: rgba(255, 107, 107, 0.28);
  color: #ff9a9a;
}

.trace-skipped {
  border-color: rgba(255, 209, 102, 0.28);
  color: #ffd166;
}

.trace-details {
  margin-top: 8px;
}

.trace-details summary {
  cursor: pointer;
  color: #9decff;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.trace-details pre {
  margin: 8px 0 0;
  max-width: 100%;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #dbe4ff;
  font-size: 11px;
  line-height: 1.45;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
  padding: 10px;
}

@media (max-width: 1100px) {
  .console-grid {
    grid-template-columns: 120px minmax(0, 1fr);
  }

  .side-panel {
    display: none;
  }
}

@media (max-width: 760px) {
  .console-shell {
    padding: 56px 10px 112px;
  }

  .console-grid {
    grid-template-columns: 1fr;
  }

  .agent-rail {
    position: static;
    display: flex;
    overflow-x: auto;
    gap: 12px;
  }

  .rail-item {
    min-width: max-content;
  }

  .workspace-panel {
    padding: 14px;
  }

  .action-bar {
    grid-template-columns: 1fr;
  }

  .action-left {
    order: 2;
  }

  .primary-action {
    order: 1;
  }

  .action-status {
    order: 3;
  }

  .brand-path {
    display: none;
  }

  .flow-node {
    min-width: 100%;
    max-width: none;
  }

  .flow-node:not(:last-child)::before,
  .flow-node:not(:last-child)::after {
    display: none;
  }

  .node-body {
    min-height: 170px;
  }

  .handoff-head {
    flex-direction: column;
  }

  .n8n-json-head,
  .n8n-json-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .handoff-copy {
    width: 100%;
  }

  .n8n-generate-button,
  .n8n-json-toolbar div {
    width: 100%;
  }

}
</style>
