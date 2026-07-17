<script setup lang="ts">
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  Loader2,
  BrainCircuit,
  Route,
  MessageCircleQuestion,
  ScanSearch,
  Blocks,
  FileCheck2,
  Bot,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Sparkles,
  Workflow,
  X,
} from "lucide-vue-next";
import type { CompileJob, CompileMode, CompileProgressEvent } from "../../shared/types/compileJob";
import type { AgentDebugInfo } from "../../shared/types/agentOutputs";
import type { N8nGenerateResponse, N8nWorkflow } from "../../shared/types/n8nWorkflow";
import type {
  ClarificationSession,
  ClarificationSessionAnswer,
  ClarificationSessionResponse,
} from "../../shared/types/clarificationSession";

type PanelView = "context" | "agents" | "details" | "trace";
type RunState = "idle" | "clarifying" | "compiling" | "ready" | "blocked" | "out_of_scope" | "failed";
type N8nGeneratorState = "idle" | "generating" | "ready" | "failed";

type FlowStepLike = {
  id?: string;
  label?: string;
  title?: string;
  name?: string;
  description?: string;
  primitive?: string;
  actor?: string;
  input?: string;
  output?: string;
  automation_policy?: string;
  real_world_execution?: string;
  approval_required?: boolean;
  risk_level?: string;
  risk_categories?: string[];
  suggested_n8n_role?: string;
  suggested_n8n_node_role?: string;
  n8n_role?: string;
  n8n_node_role?: string;
  safety_notes?: string[] | string;
  notes?: string[] | string;
  [key: string]: unknown;
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

type AgentUiState =
  | "waiting"
  | "running"
  | "ai_success"
  | "deterministic_success"
  | "fallback_success"
  | "skipped"
  | "failed";

type AgentUiCard = {
  id: string;
  label: string;
  state: AgentUiState;
  provider?: string;
  shortStatus: string;
  lastMessage?: string;
  updatedAt?: string;
  debugId?: keyof NonNullable<CompileJob["agent_debug"]> | "guided_clarifier";
};

type CompileStepDefinition = {
  id:
    | "router"
    | "clarification_planner"
    | "clarification_agent"
    | "blueprint_architect_agent"
    | "deterministic_blueprint"
    | "safety_critic_deterministic"
    | "safety_critic_agent"
    | "final_guard";
  label: string;
  waitingStatus: string;
  debugId?: keyof NonNullable<CompileJob["agent_debug"]>;
};

type AgentVisualTone = "violet" | "cyan" | "blue" | "green" | "amber" | "red";

function agentVisualMeta(agentId?: string | null) {
  const meta: Record<string, { icon: unknown; tone: AgentVisualTone; activity: string }> = {
    guided_clarifier: { icon: MessageCircleQuestion, tone: "violet", activity: "Clarifier is identifying the one detail needed to continue." },
    router: { icon: Route, tone: "cyan", activity: "Router is classifying the request and selecting the safest path." },
    clarification_planner: { icon: ScanSearch, tone: "violet", activity: "Clarification Planner is checking whether essential information is missing." },
    clarification_agent: { icon: MessageCircleQuestion, tone: "violet", activity: "Compile Clarifier is refining the request into an actionable workflow." },
    blueprint_architect_agent: { icon: Blocks, tone: "blue", activity: "Blueprint Architect is arranging the workflow steps and boundaries." },
    deterministic_blueprint: { icon: Workflow, tone: "cyan", activity: "Deterministic Blueprint is assembling the validated workflow structure." },
    safety_critic_deterministic: { icon: ShieldCheck, tone: "amber", activity: "Safety Review is checking execution boundaries and approval requirements." },
    safety_critic_agent: { icon: ShieldAlert, tone: "amber", activity: "Safety Critic is reviewing sensitive actions, risks, and human gates." },
    final_guard: { icon: FileCheck2, tone: "green", activity: "Final Guard is validating the result before the blueprint is released." },
    n8n_generator: { icon: Bot, tone: "green", activity: "n8n Generator is creating and validating the inactive workflow draft." },
  };

  return meta[agentId || ""] || {
    icon: BrainCircuit,
    tone: "cyan" as AgentVisualTone,
    activity: "FlowForge is preparing the next compiler action.",
  };
}

const compileStepDefinitions: CompileStepDefinition[] = [
  {
    id: "router",
    label: "Router",
    waitingStatus: "Waiting",
  },
  {
    id: "clarification_planner",
    label: "Clarification Planner",
    waitingStatus: "Waiting",
  },
  {
    id: "clarification_agent",
    label: "Compile Clarifier",
    waitingStatus: "Waiting",
    debugId: "clarification_agent",
  },
  {
    id: "blueprint_architect_agent",
    label: "Blueprint Architect",
    waitingStatus: "Waiting",
    debugId: "blueprint_architect_agent",
  },
  {
    id: "deterministic_blueprint",
    label: "Deterministic Blueprint",
    waitingStatus: "Waiting",
  },
  {
    id: "safety_critic_deterministic",
    label: "Safety Review",
    waitingStatus: "Waiting",
  },
  {
    id: "safety_critic_agent",
    label: "Safety Critic",
    waitingStatus: "Waiting",
    debugId: "safety_critic_agent",
  },
  {
    id: "final_guard",
    label: "Final Guard",
    waitingStatus: "Waiting",
  },
];

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
const activeWorkflowStepIndex = ref<number | null>(null);
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
const showN8nModal = ref(false);
const showN8nSuccess = ref(false);
const showBlueprintSuccess = ref(false);
const n8nLoadingStepIndex = ref(0);
let n8nLoadingTimer: ReturnType<typeof setInterval> | null = null;
const compileProgressEvents = ref<CompileProgressEvent[]>([]);
const compileAgentStateMap = ref<Record<string, AgentUiCard>>({});

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

const n8nLoadingSteps = [
  "Preparing the safe blueprint",
  "Mapping workflow nodes and connections",
  "Validating the inactive n8n draft",
];

const activeN8nLoadingStep = computed(
  () => n8nLoadingSteps[n8nLoadingStepIndex.value] ?? n8nLoadingSteps[0],
);

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
const unifiedLoadingTitle = computed(() =>
  runState.value === "clarifying"
    ? clarificationAnswers.value.length > 0
      ? "Processing your answer"
      : "Checking your request"
    : "Compiling workflow",
);
const unifiedLoadingMessage = computed(() => {
  if (runState.value === "clarifying") {
    return clarificationAnswers.value.length > 0
      ? "The clarifier is reviewing your answer and deciding whether another detail is needed."
      : "FlowForge is deciding whether it can compile directly or needs one useful clarification.";
  }

  return currentProcessStatus.value.message || "The multi-agent compiler is building and reviewing your workflow blueprint.";
});
const unifiedLoadingStep = computed(() => {
  if (runState.value === "clarifying") {
    return clarificationAnswers.value.length > 0
      ? "Clarifier · reviewing answer"
      : "Clarifier · analyzing request";
  }

  return currentProcessStatus.value.label || "Compiler · preparing";
});
const answeredCount = computed(() => clarificationAnswers.value.length);
const currentQuestionNumber = computed(() => answeredCount.value + 1);
const clarificationProgressLabel = computed(() => `Question ${currentQuestionNumber.value} · stops when ready`);
const safetyStatus = computed(() => job.value?.safety_critic?.overall_status ?? null);
const isOutOfScope = computed(
  () =>
    runState.value === "out_of_scope"
    || job.value?.router_decision?.route === "out_of_scope",
);
const isOrchestrating = computed(() => runState.value === "compiling");
const mainStatus = computed(() => {
  if (runState.value === "failed") return "Failed";
  if (runState.value === "out_of_scope") return "Outside scope";
  if (isOrchestrating.value) return "Compiling";
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
  if (runState.value === "out_of_scope") return "neutral";
  if (isOrchestrating.value) return "active";
  if (hasClarification.value) return "active";
  if (safetyStatus.value === "not_safe_to_automate") return "danger";
  if (safetyStatus.value === "needs_human_approval") return "warning";
  if (safetyStatus.value === "safe_internal_preview") return "success";
  return "neutral";
});

const agentRail = computed(() => {
  if (isOutOfScope.value) {
    return [
      {
        label: "Input",
        state: "done",
      },
      {
        label: "Clarifier",
        state: "idle",
      },
      {
        label: "Compiler",
        state: "idle",
      },
      {
        label: "Safety",
        state: "idle",
      },
      {
        label: "Blueprint",
        state: "idle",
      },
    ];
  }

  return [
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
      state: job.value ? "done" : isOrchestrating.value ? "active" : "idle",
    },
    {
      label: "Safety",
      state: job.value?.safety_critic ? "done" : currentCompileStep.value?.id.includes("safety") ? "active" : "idle",
    },
    {
      label: "Blueprint",
      state: job.value?.result ? "active" : "idle",
    },
  ];
});

function defaultAgentUiCard(definition: CompileStepDefinition): AgentUiCard {
  return {
    id: definition.id,
    label: definition.label,
    state: "waiting",
    shortStatus: definition.waitingStatus,
    debugId: definition.debugId,
  };
}

function resetCompileProgressState() {
  compileProgressEvents.value = [];
  compileAgentStateMap.value = Object.fromEntries(
    compileStepDefinitions.map((definition) => [definition.id, defaultAgentUiCard(definition)]),
  );
}

function progressStatusLabel(state: AgentUiState) {
  if (state === "running") return "Running";
  if (state === "ai_success") return "AI";
  if (state === "deterministic_success") return "Rules";
  if (state === "fallback_success") return "Fallback";
  if (state === "skipped") return "Skipped";
  if (state === "failed") return "Failed";
  return "Waiting";
}

function progressStateToAgentStatus(state: AgentUiState): AgentCard["status"] {
  if (state === "running") return "active";
  if (state === "waiting") return "idle";
  if (state === "skipped") return "skipped";
  if (state === "failed") return "needs_detail";
  return "done";
}

function progressStateToProviderTone(state: AgentUiState): AgentCard["providerTone"] {
  if (state === "running") return "deterministic";
  if (state === "ai_success") return "ai";
  if (state === "fallback_success") return "fallback";
  if (state === "deterministic_success") return "deterministic";
  if (state === "skipped") return "skipped";
  if (state === "failed") return "failed";
  return "standby";
}

function applyCompileProgressEvent(event: CompileProgressEvent) {
  compileProgressEvents.value = [...compileProgressEvents.value, event].slice(-40);

  if (event.type !== "step_started" && event.type !== "step_completed" && event.type !== "step_failed") return;

  const existing = compileAgentStateMap.value[event.step_id];
  const definition = compileStepDefinitions.find((step) => step.id === event.step_id);
  const state: AgentUiState = event.type === "step_started" ? "running" : event.status;

  compileAgentStateMap.value = {
    ...compileAgentStateMap.value,
    [event.step_id]: {
      id: event.step_id,
      label: existing?.label || definition?.label || event.label,
      state,
      provider: event.provider,
      shortStatus: progressStatusLabel(state),
      lastMessage: event.message,
      updatedAt: event.timestamp,
      debugId: existing?.debugId || definition?.debugId,
    },
  };
}

const compileProgressAgentCards = computed<AgentCard[]>(() =>
  compileStepDefinitions.map((definition) => {
    const card = compileAgentStateMap.value[definition.id] ?? defaultAgentUiCard(definition);
    const status = progressStateToAgentStatus(card.state);
    const providerToneValue = progressStateToProviderTone(card.state);

    return {
      id: card.id,
      label: card.label,
      status,
      summary: card.lastMessage || definition.waitingStatus,
      provider: card.provider || (card.state === "waiting" ? "standby" : "system"),
      statusLabel: card.shortStatus,
      statusReason: card.lastMessage || definition.waitingStatus,
      providerTone: providerToneValue,
      debugId: card.debugId,
    };
  }),
);

const currentCompileStep = computed(() =>
  Object.values(compileAgentStateMap.value).find((card) => card.state === "running") ?? null,
);

const recentCompileEvents = computed(() =>
  compileProgressEvents.value
    .filter((event) => event.type === "step_started" || event.type === "step_completed" || event.type === "step_failed")
    .slice(-4),
);

const latestSettledCompileEvent = computed(() =>
  [...compileProgressEvents.value]
    .reverse()
    .find((event) => event.type === "step_completed" || event.type === "step_failed") ?? null,
);

const activeCompilerVisual = computed(() => {
  if (runState.value === "clarifying") {
    return { id: "guided_clarifier", ...agentVisualMeta("guided_clarifier") };
  }

  const id = currentCompileStep.value?.id || "router";
  return { id, ...agentVisualMeta(id) };
});

const currentProcessStatus = computed(() => {
  const current = currentCompileStep.value;

  if (current) {
    return {
      label: current.label,
      message: current.lastMessage || "Running this compiler step.",
      stateLabel: current.shortStatus,
      state: current.state,
    };
  }

  const lastEvent = [...compileProgressEvents.value].reverse().find((event) => event.type !== "done");

  return {
    label: lastEvent && "label" in lastEvent ? lastEvent.label : "Preparing compile",
    message: lastEvent && "message" in lastEvent ? lastEvent.message : "Starting the compiler.",
    stateLabel: "Running",
    state: "running" as AgentUiState,
  };
});

function progressEventState(event: CompileProgressEvent): AgentUiState {
  if (event.type === "step_started") return "running";
  if (event.type === "step_completed" || event.type === "step_failed") return event.status;
  if (event.type === "error") return "failed";
  return "deterministic_success";
}

function progressEventLabel(event: CompileProgressEvent) {
  if ("label" in event) return event.label;
  if (event.type === "done") return "Final Guard";
  return "Compiler";
}

function progressEventMessage(event: CompileProgressEvent) {
  if (event.type === "step_started") return event.provider ? `Running · ${providerDisplayName(event.provider)}` : "Running";
  if (event.type === "step_completed") {
    const status = progressStatusLabel(event.status);
    return event.provider ? `${status} · ${providerDisplayName(event.provider)}` : status;
  }

  if (event.type === "step_failed") return event.message;
  if (event.type === "done") return "Compile ready";
  return event.message;
}

const n8nGeneratorAgentCard = computed<AgentCard | null>(() => {
  if (n8nGeneratorState.value === "idle" && !n8nWorkflowDraft.value && !n8nGenerateError.value) return null;

  let status: AgentCard["status"] = "idle";
  let providerToneValue: AgentCard["providerTone"] = "standby";
  let statusLabel = "Standby";
  let statusReason = "Waiting for a safe blueprint before generating n8n JSON.";

  if (n8nGeneratorState.value === "generating") {
    status = "active";
    providerToneValue = "deterministic";
    statusLabel = "Generating";
    statusReason = "Building a draft n8n workflow JSON from the approved blueprint.";
  } else if (n8nGeneratorState.value === "failed") {
    status = "needs_detail";
    providerToneValue = "failed";
    statusLabel = "Generation failed";
    statusReason = n8nGenerateError.value || "The n8n JSON draft could not be generated.";
  } else if (n8nGeneratorState.value === "ready") {
    status = "done";
    providerToneValue = n8nFallbackUsed.value ? "fallback" : n8nUsedAi.value ? "ai" : "deterministic";
    statusLabel = n8nFallbackUsed.value ? "Fallback used" : n8nUsedAi.value ? "AI draft ready" : "Draft ready";
    statusReason = n8nFallbackUsed.value
      ? "AI unavailable, rules completed the draft generation step."
      : "Validated n8n JSON draft is ready for review.";
  }

  return {
    id: "n8n_generator",
    label: "n8n Generator",
    status,
    summary: "Generates an importable n8n JSON draft from the safe blueprint.",
    provider: n8nProvider.value || (n8nGeneratorState.value === "generating" ? "pending" : "standby"),
    statusLabel,
    statusReason,
    providerTone: providerToneValue,
  };
});

const agentCards = computed<AgentCard[]>(() => {
  const guidedClarifierCard: AgentCard = {
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
  };

  if (isOutOfScope.value) {
    const skippedReason =
      "Skipped because the Router Agent classified this request as outside FlowForge scope.";

    return [
      guidedClarifierCard,
      {
        id: "router",
        label: "Router",
        status: "done",
        summary:
          job.value?.router_decision?.reason
          || "The request was classified as outside workflow automation scope.",
        provider:
          job.value?.router_decision?.provider
          || "standby",
        statusLabel:
          routerStatusLabel(),
        statusReason:
          routerStatusReason(),
        providerTone:
          routerProviderTone(),
      },
      {
        id: "clarification_planner",
        label: "Clarification Planner",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
      },
      {
        id: "clarification_agent",
        label: "Compile Clarifier",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
        debugId: "clarification_agent",
      },
      {
        id: "blueprint_architect_agent",
        label: "Blueprint Architect",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
        debugId: "blueprint_architect_agent",
      },
      {
        id: "deterministic_blueprint",
        label: "Deterministic Blueprint",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
      },
      {
        id: "safety_critic_deterministic",
        label: "Safety Review",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
      },
      {
        id: "safety_critic_agent",
        label: "Safety Critic",
        status: "skipped",
        summary: skippedReason,
        provider: "standby",
        statusLabel: "Skipped",
        statusReason: skippedReason,
        providerTone: "skipped",
        debugId: "safety_critic_agent",
      },
      {
        id: "final_guard",
        label: "Final Guard",
        status: "skipped",
        summary:
          "No workflow result needed final safety validation because compilation stopped at the router.",
        provider: "standby",
        statusLabel: "Skipped",
        statusReason:
          "The pipeline stopped before blueprint generation.",
        providerTone: "skipped",
      },
    ];
  }

  if (isOrchestrating.value && !job.value) {
    const cards = [guidedClarifierCard, ...compileProgressAgentCards.value];
    const n8nCard = n8nGeneratorAgentCard.value;
    if (n8nCard) cards.push(n8nCard);
    return cards;
  }

  const cards: AgentCard[] = [
    guidedClarifierCard,
    {
      id: "router",
      label: "Router",
      status: job.value?.router_decision ? "done" : "idle",
      summary: job.value?.router_decision?.reason || "Routes compile requests when needed.",
      provider: job.value?.router_decision?.provider || "standby",
      statusLabel: routerStatusLabel(),
      statusReason: routerStatusReason(),
      providerTone: routerProviderTone(),
    },
    {
      id: "clarification_planner",
      label: "Clarification Planner",
      status: job.value?.clarification_plan ? job.value.clarification_plan.needed ? "done" : "skipped" : "idle",
      summary: job.value?.clarification_plan?.reason || "Checks whether deterministic clarification is needed.",
      provider: job.value ? "deterministic" : "standby",
      statusLabel: job.value?.clarification_plan?.needed ? "Rules" : job.value ? "Skipped" : "Waiting",
      statusReason: job.value?.clarification_plan?.needed
        ? `Missing: ${job.value.clarification_plan.missing_fields.join(", ")}`
        : job.value ? "No clarification needed." : "Waiting for a compile run.",
      providerTone: job.value?.clarification_plan?.needed ? "deterministic" : job.value ? "skipped" : "standby",
    },
    {
      id: "clarification_agent",
      label: "Compile Clarifier",
      status: job.value?.clarification_agent ? agentOutputStatusToCardStatus(job.value.clarification_agent.status) : "idle",
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
      status: job.value?.blueprint_architect_agent ? agentOutputStatusToCardStatus(job.value.blueprint_architect_agent.status) : "idle",
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
      id: "deterministic_blueprint",
      label: "Deterministic Blueprint",
      status: job.value?.result ? "done" : "idle",
      summary: job.value?.result?.summary || "Builds the local safe blueprint preview.",
      provider: job.value ? "deterministic" : "standby",
      statusLabel: job.value ? "Rules" : "Waiting",
      statusReason: job.value?.result?.workflow_name || "Waiting for a compile run.",
      providerTone: job.value ? "deterministic" : "standby",
    },
    {
      id: "safety_critic_deterministic",
      label: "Safety Review",
      status: job.value?.safety_critic ? "done" : "idle",
      summary: job.value?.safety_critic?.summary || "Runs deterministic safety guardrails.",
      provider: job.value ? "deterministic" : "standby",
      statusLabel: job.value ? "Rules" : "Waiting",
      statusReason: job.value?.safety_critic?.next_safe_action || "Waiting for a compile run.",
      providerTone: job.value ? "deterministic" : "standby",
    },
    {
      id: "safety_critic_agent",
      label: "Safety Critic",
      status: job.value?.safety_critic_agent ? agentOutputStatusToCardStatus(job.value.safety_critic_agent.status) : job.value?.safety_critic ? "done" : "idle",
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
    finalGuardCard(),
  ];

  const n8nCard = n8nGeneratorAgentCard.value;
  if (n8nCard) cards.push(n8nCard);

  return cards;
});

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
  if (id === "clarification_planner") return job.value?.clarification_plan ?? null;
  if (id === "deterministic_blueprint") return job.value?.result ?? null;
  if (id === "safety_critic_deterministic") return job.value?.safety_critic ?? null;
  if (id === "safety_critic_agent") return job.value?.safety_critic_agent ?? job.value?.safety_critic ?? null;
  if (id === "router") return job.value?.router_decision ?? null;
  if (id === "final_guard") return job.value?.safety_critic ?? null;
  if (id === "n8n_generator") {
    return {
      state: n8nGeneratorState.value,
      provider: n8nProvider.value,
      used_ai: n8nUsedAi.value,
      fallback_used: n8nFallbackUsed.value,
      error: n8nGenerateError.value,
      warnings: n8nWarnings.value,
      workflow: n8nWorkflowDraft.value,
    };
  }

  return null;
});

function openAgentDetails(agentId: string) {
  activeWorkflowStepIndex.value = null;
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
    normalized.includes("truncated")
    || normalized.includes("max_tokens")
    || normalized.includes("maxoutputtokens")
    || normalized.includes("max output tokens")
  ) {
    return compactText(rawText, 240);
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

  if (
    normalized.includes("401")
    || normalized.includes("403")
    || normalized.includes("unauthorized")
    || normalized.includes("forbidden")
    || normalized.includes("api_key")
    || normalized.includes("is not set")
    || normalized.includes("not configured")
  ) {
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

  if (!text) return "AI unavailable, rules completed this step.";

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
  if (status === "failed_validation") return "Validation failed";
  if (!provider || provider === "standby") return "Standby";
  if (usedAi) return "AI used";
  if (fallback) return "Fallback used";
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
  if (decision.fallback_used) return "Fallback used";
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

function finalGuardCard(): AgentCard {
  if (isOutOfScope.value) {
    return {
      id: "final_guard",
      label: "Final Guard",
      status: "skipped",
      summary:
        "Compilation stopped at the Router Agent because the request is outside FlowForge scope.",
      provider: "standby",
      statusLabel: "Skipped",
      statusReason:
        "No workflow blueprint was produced.",
      providerTone: "skipped",
    };
  }

  const finalStatus = safetyStatus.value;
  const hasJob = Boolean(job.value);
  const needsDetail = job.value?.status === "failed" || finalStatus === "needs_clarification";
  const dangerTone = needsDetail || finalStatus === "not_safe_to_automate";

  return {
    id: "final_guard",
    label: "Final Guard",
    status: !hasJob ? "idle" : needsDetail ? "needs_detail" : "done",
    summary: job.value?.safety_critic?.summary || "Applies deterministic guardrails before returning the result.",
    provider: hasJob ? "deterministic" : "standby",
    statusLabel: finalGuardStatusLabel(),
    statusReason: finalGuardStatusReason(),
    providerTone: !hasJob ? "standby" : dangerTone ? "failed" : "deterministic",
  };
}

function finalGuardStatusLabel() {
  if (!job.value) return "Standby";
  if (job.value.status === "failed") return "Failed";
  if (safetyStatus.value === "not_safe_to_automate") return "Blocked";
  if (safetyStatus.value === "needs_clarification") return "Needs detail";
  if (safetyStatus.value === "needs_human_approval") return "Human gate";
  if (safetyStatus.value === "safe_internal_preview") return "Passed";
  return "Passed";
}

function finalGuardStatusReason() {
  if (!job.value) return "Waiting for the compiler to finish.";
  return job.value.safety_critic?.next_safe_action
    || job.value.safety_critic?.summary
    || "Final deterministic guardrails completed.";
}

function cardStatusText(status: AgentCard["status"]) {
  if (status === "active") return "running";
  if (status === "done") return "completed";
  if (status === "needs_detail") return "failed";
  return status;
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
  if (isOutOfScope.value && job.value) {
    return [
      {
        label: "Router outcome",
        value: "Outside scope",
        note:
          job.value.router_decision?.reason
          || "The request is unrelated to workflow automation design.",
        tone: "neutral",
      },
      {
        label: "Router provider",
        value:
          providerDisplayName(
            job.value.router_decision?.provider,
          ),
        note:
          `${job.value.router_decision?.confidence ?? "unknown"} confidence · pipeline stopped after routing.`,
        tone:
          job.value.router_decision?.used_ai
            ? "success"
            : "neutral",
      },
      {
        label: "LLM attempts used",
        value:
          `${job.value.token_usage?.llm_calls_used ?? 0}/${job.value.token_usage?.llm_calls_limit ?? 0}`,
        note:
          "Only routing was allowed to run. Blueprint and n8n generation were skipped.",
        tone: "neutral",
      },
    ];
  }

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

  if (isOutOfScope.value && job.value) {
    addFact(
      items,
      "Router route",
      job.value.router_decision?.route,
    );
    addFact(
      items,
      "Router reason",
      compactText(
        job.value.router_decision?.reason,
        220,
      ),
    );
    addFact(
      items,
      "Confidence",
      job.value.router_decision?.confidence,
    );
    addFact(
      items,
      "Provider",
      providerDisplayName(
        job.value.router_decision?.provider,
      ),
    );
    addFact(
      items,
      "Pipeline",
      "Stopped after semantic routing",
    );

    return items;
  }

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

const activeWorkflowStep = computed(() => {
  const index = activeWorkflowStepIndex.value;
  return index === null ? null : workflowSteps.value[index] ?? null;
});

const activeWorkflowStepNumber = computed(() => {
  return activeWorkflowStepIndex.value === null ? "" : String(activeWorkflowStepIndex.value + 1);
});

const activeWorkflowStepLabel = computed(() => {
  const step = activeWorkflowStep.value;
  const index = activeWorkflowStepIndex.value ?? 0;
  return step ? workflowStepLabel(step, index) : "Workflow step";
});

const activeWorkflowStepDescription = computed(() => {
  return activeWorkflowStep.value?.description || "No description provided.";
});

const activeWorkflowStepApprovalGates = computed(() => {
  const stepId = activeWorkflowStep.value?.id;
  const gates = job.value?.result?.human_approval_gates ?? [];

  if (!stepId) return [];

  return gates.filter((gate) => gate.applies_to_step_ids.includes(stepId));
});

const activeWorkflowStepDetailItems = computed<DetailItem[]>(() => {
  const step = activeWorkflowStep.value;
  if (!step) return [];

  const items: DetailItem[] = [];
  addStepDetail(items, "Primitive / step type", primitiveLabel(step.primitive));
  addStepDetail(items, "Suggested n8n role", suggestedN8nRoleLabel(step));
  addStepDetail(items, "Automation policy", automationPolicyLabel(step.automation_policy));
  addStepDetail(items, "Execution boundary", executionBoundaryLabel(step.real_world_execution));
  addStepDetail(items, "Human approval", approvalRequirementLabel(step));
  addStepDetail(items, "Actor", step.actor ? formatStepValue(step.actor) : "");
  addStepDetail(items, "Input", step.input);
  addStepDetail(items, "Output", step.output);

  return items;
});

const activeWorkflowStepSafetyNotes = computed(() => {
  const step = activeWorkflowStep.value;
  if (!step) return [];

  const stepId = step.id;
  const notes: string[] = [];

  appendStepNote(notes, step.safety_notes);
  appendStepNote(notes, step.notes);

  if (step.risk_level) {
    notes.push(`Risk level: ${formatStepValue(step.risk_level)}.`);
  }

  if (Array.isArray(step.risk_categories) && step.risk_categories.length > 0) {
    notes.push(`Risk categories: ${step.risk_categories.map(formatStepValue).join(", ")}.`);
  }

  for (const gate of activeWorkflowStepApprovalGates.value) {
    notes.push(`Human gate: ${gate.label}${gate.reason ? ` - ${gate.reason}` : ""}`);
  }

  if (stepId) {
    for (const risk of job.value?.result?.risks ?? []) {
      if (!risk.step_ids.includes(stepId)) continue;
      notes.push(`${risk.label}: ${risk.reason} Recommendation: ${risk.recommendation}`);
    }

    for (const finding of job.value?.safety_critic?.findings ?? []) {
      if (!finding.related_step_ids.includes(stepId)) continue;
      notes.push(`${finding.title}: ${finding.explanation} Recommendation: ${finding.recommendation}`);
    }

    for (const concern of job.value?.safety_critic_agent?.concerns ?? []) {
      if (!concern.related_step_ids.includes(stepId)) continue;
      notes.push(`${concern.title}: ${concern.explanation} Recommendation: ${concern.recommendation}`);
    }
  }

  return uniqueStrings(notes);
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

function normalizedWheelDelta(event: WheelEvent, pageSize: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * pageSize;
  return event.deltaY;
}

function handleFlowMapWheel(event: WheelEvent) {
  if (event.ctrlKey) return;

  const scroller = event.currentTarget as HTMLElement | null;
  if (!scroller) return;

  const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
  if (maxScrollLeft <= 1) return;

  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

  const delta = normalizedWheelDelta(event, scroller.clientWidth);
  if (delta === 0) return;

  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, scroller.scrollLeft + delta));
  if (nextScrollLeft === scroller.scrollLeft) return;

  scroller.scrollLeft = nextScrollLeft;
  event.preventDefault();
}

function openWorkflowStepDetails(index: number) {
  activeAgentDetailsId.value = null;
  activeWorkflowStepIndex.value = index;
}

function closeWorkflowStepDetails() {
  activeWorkflowStepIndex.value = null;
}

function addStepDetail(items: DetailItem[], label: string, value: unknown) {
  const text = detailValueText(value);

  if (text) {
    items.push({ label, value: text });
  }
}

function detailValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Required" : "Not required";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(detailValueText).filter(Boolean).join(", ");
  return "";
}

function approvalRequirementLabel(step: FlowStepLike) {
  if (typeof step.approval_required === "boolean") {
    return step.approval_required ? "Required" : "Not required";
  }

  return activeWorkflowStepApprovalGates.value.length > 0 ? "Required" : "";
}

function suggestedN8nRoleLabel(step: FlowStepLike) {
  const explicit =
    step.suggested_n8n_role
    || step.suggested_n8n_node_role
    || step.n8n_role
    || step.n8n_node_role;

  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  if (!step.primitive) return "";

  const roleByPrimitive: Record<string, string> = {
    intake: "Trigger or Set node for captured input",
    classification: "Code node for classification logic",
    extraction: "Set or Code node for structured fields",
    risk_detection: "Code node for risk checks",
    routing: "IF node or Set node for internal routing",
    drafting: "Set node for draft-only content",
    approval: "Manual review handoff marker",
    validation: "Code node for validation checks",
    notification: "Set node for notification draft",
    record_creation: "Set node for internal task fields",
    monitoring: "Schedule or Manual Trigger with review output",
    escalation: "Set node for escalation task",
    summarization: "Code node for summary output",
    reporting: "Set node for report fields",
    export: "Set node for draft export payload",
  };

  return roleByPrimitive[step.primitive] ?? primitiveLabel(step.primitive);
}

function appendStepNote(notes: string[], value: unknown) {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const item of value) appendStepNote(notes, item);
    return;
  }

  if (typeof value === "string" && value.trim()) {
    notes.push(value.trim());
  }
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))];
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
  if (!job.value || isOutOfScope.value) return "";

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
    && !isOutOfScope.value
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
  const source =
    n8nWorkflowDraft.value?.name
    || job.value?.result?.workflow_name
    || "flowforge-n8n-draft";

  const safeName = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `${safeName || "flowforge-n8n-draft"}.json`;
});

function stopN8nLoadingCycle() {
  if (n8nLoadingTimer) {
    clearInterval(n8nLoadingTimer);
    n8nLoadingTimer = null;
  }
}

function startN8nLoadingCycle() {
  stopN8nLoadingCycle();
  n8nLoadingStepIndex.value = 0;
  n8nLoadingTimer = setInterval(() => {
    n8nLoadingStepIndex.value = (n8nLoadingStepIndex.value + 1) % n8nLoadingSteps.length;
  }, 1500);
}

function triggerBlueprintSuccess() {
  showBlueprintSuccess.value = false;
  window.setTimeout(() => {
    showBlueprintSuccess.value = true;
    window.setTimeout(() => {
      showBlueprintSuccess.value = false;
    }, 1900);
  }, 100);
}

function triggerN8nSuccess() {
  showN8nSuccess.value = false;
  window.setTimeout(() => {
    showN8nSuccess.value = true;
    window.setTimeout(() => {
      showN8nSuccess.value = false;
    }, 1800);
  }, 80);
}

function openN8nModal() {
  showN8nModal.value = true;
}

function closeN8nModal() {
  if (n8nGeneratorState.value === "generating") return;
  showN8nModal.value = false;
  showN8nSuccess.value = false;
}

function handleN8nArtifactAction() {
  if (n8nWorkflowDraft.value) {
    openN8nModal();
    return;
  }

  void generateN8nWorkflowDraft();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && showN8nModal.value) {
    closeN8nModal();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
});

onUnmounted(() => {
  stopN8nLoadingCycle();
  window.removeEventListener("keydown", handleGlobalKeydown);
  document.body.style.overflow = "";
});

watch(
  [showN8nModal, activeWorkflowStep, activeAgentDetailsId],
  ([isN8nOpen, workflowStep, agentId]) => {
    document.body.style.overflow = isN8nOpen || Boolean(workflowStep) || Boolean(agentId) ? "hidden" : "";
  },
);

function resetN8nGeneratorState() {
  stopN8nLoadingCycle();
  showN8nModal.value = false;
  showN8nSuccess.value = false;
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

function errorIssuesFromData(data: unknown) {
  const record = asRecord(data);
  const nestedData = asRecord(record?.data);
  const directIssues = record?.issues;
  const nestedIssues = nestedData?.issues;

  if (Array.isArray(directIssues)) return directIssues;
  if (Array.isArray(nestedIssues)) return nestedIssues;
  return [];
}

function issueSummaryFromErrorData(data: unknown) {
  const issues = errorIssuesFromData(data);

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

function detailFromErrorData(data: unknown) {
  const record = asRecord(data);
  const nestedData = asRecord(record?.data);

  if (typeof record?.detail === "string" && record.detail.trim()) return record.detail;
  if (typeof nestedData?.detail === "string" && nestedData.detail.trim()) return nestedData.detail;

  return "";
}

function apiErrorMessage(error: unknown, fallback: string) {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  const responseData = asRecord(asRecord(record?.response)?._data);
  const statusCode = Number(record?.statusCode ?? data?.statusCode ?? responseData?.statusCode ?? 0);
  const base =
    (typeof data?.statusMessage === "string" && data.statusMessage)
    || (typeof data?.message === "string" && data.message)
    || (typeof responseData?.statusMessage === "string" && responseData.statusMessage)
    || (typeof record?.statusMessage === "string" && record.statusMessage)
    || (typeof record?.message === "string" && record.message)
    || fallback;
  const detail = detailFromErrorData(data) || detailFromErrorData(responseData);
  const issueSummary = issueSummaryFromErrorData(data) || issueSummaryFromErrorData(responseData);
  const detailOrBase = detail || base;
  const fullText = [base, detail].filter(Boolean).join(" ");
  const normalized = fullText.toLowerCase();

  if (issueSummary) return `${base} ${issueSummary}`;

  if (normalized.includes("json_validate_failed")) {
    return `Groq JSON mode failed before FlowForge could validate the n8n draft. ${compactText(detailOrBase, 320)}`;
  }

  if (
    normalized.includes("truncated")
    || normalized.includes("max_tokens")
    || normalized.includes("maxoutputtokens")
    || normalized.includes("max output tokens")
  ) {
    return `n8n generator provider failed: ${compactText(detailOrBase, 360)}`;
  }

  if (
    statusCode === 401
    || statusCode === 403
    || normalized.includes("401")
    || normalized.includes("403")
    || normalized.includes("unauthorized")
    || normalized.includes("forbidden")
    || normalized.includes("api_key")
  ) {
    return `n8n generator provider configuration failed: ${compactText(detailOrBase, 320)}`;
  }

  if (
    statusCode === 429
    || normalized.includes("429")
    || normalized.includes("too many requests")
    || normalized.includes("rate limit")
    || normalized.includes("rate_limit")
  ) {
    return `n8n generator provider rate limit reached: ${compactText(detailOrBase, 320)}`;
  }

  if (
    normalized.includes("aborted")
    || normalized.includes("aborterror")
    || normalized.includes("timed out")
    || normalized.includes("timeout")
  ) {
    return `n8n generator provider timed out: ${compactText(detailOrBase, 320)}`;
  }

  if (/413|payload too large|rate_limit_exceeded|tpm limit|requested tokens|tokens per minute/i.test(fullText)) {
    return "n8n JSON generation request was too large for the configured Groq tier. FlowForge now sends a compact implementation brief, but this request still exceeded the provider limit. Try a shorter workflow or reduce workflow details.";
  }

  if (detail && !base.includes(detail)) return `${base} ${compactText(detail, 360)}`;

  return base;
}

async function generateN8nWorkflowDraft() {
  if (!job.value || !canGenerateN8nJson.value) return;

  activePanel.value = "agents";
  openN8nModal();
  showN8nSuccess.value = false;
  n8nGeneratorState.value = "generating";
  n8nGenerateError.value = "";
  n8nJsonCopied.value = false;
  startN8nLoadingCycle();

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
    triggerN8nSuccess();
  } catch (error) {
    n8nWorkflowDraft.value = null;
    n8nWarnings.value = [];
    n8nGenerateError.value = apiErrorMessage(error, "Could not generate n8n JSON draft.");
    n8nGeneratorState.value = "failed";
  } finally {
    stopN8nLoadingCycle();
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
  if (isOutOfScope.value) return "Outside FlowForge scope";
  if (hasClarification.value) return "Clarifier is asking for one detail";
  if (!job.value) return "Describe an automation";
  if (safetyStatus.value === "not_safe_to_automate") return "Do not automate this";
  if (safetyStatus.value === "needs_human_approval") return "Workflow blueprint with human gates";
  if (safetyStatus.value === "safe_internal_preview") return "Workflow blueprint";
  return "Workflow preview";
});

const resultSubtitle = computed(() => {
  if (isOutOfScope.value) {
    return job.value?.router_decision?.user_message
      || "FlowForge only designs workflow automations and agentic processes.";
  }

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

const blueprintStatusMeta = computed(() => {
  if (safetyStatus.value === "not_safe_to_automate") {
    return {
      label: "Automation blocked",
      tone: "danger",
      icon: ShieldX,
    };
  }

  if (safetyStatus.value === "needs_human_approval") {
    return {
      label: "Human approval required",
      tone: "warning",
      icon: ShieldAlert,
    };
  }

  return {
    label: "Safe internal preview",
    tone: "success",
    icon: ShieldCheck,
  };
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
  activeWorkflowStepIndex.value = null;
  runState.value = "idle";
  showAnswered.value = false;
  showBlueprintSuccess.value = false;
  resetCompileProgressState();
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

  // The Router Agent is the single semantic entry point. It decides whether
  // this is a valid automation request, needs clarification, or is out of scope.
  await compilePrompt(originalInput);
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

async function applyCompileJobResponse(response: CompileJob, input: string) {
  if (response.router_decision?.route === "out_of_scope") {
    job.value = response;
    resetN8nGeneratorState();
    runState.value = "out_of_scope";
    activePanel.value = "context";
    return;
  }

  if (compileResultNeedsClarification(response)) {
    job.value = null;
    await startClarificationForInput(input);
    return;
  }

  job.value = response;
  resetN8nGeneratorState();
  runState.value = response.safety_critic?.overall_status === "not_safe_to_automate" ? "blocked" : "ready";

  if (runState.value === "ready") {
    triggerBlueprintSuccess();
  }
}

function compileProgressEventsFromBlock(block: string): CompileProgressEvent[] {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data) return [];

  return [JSON.parse(data) as CompileProgressEvent];
}

async function compileWithStream(input: string): Promise<boolean> {
  const response = await fetch("/api/compile-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      input,
      mode: mode.value,
    }),
  });

  if (!response.ok || !response.body) return false;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalJob: CompileJob | null = null;
  let streamError = "";
  let receivedProgress = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      for (const event of compileProgressEventsFromBlock(block)) {
        receivedProgress = true;
        applyCompileProgressEvent(event);

        if (event.type === "done") {
          finalJob = event.job;
        } else if (event.type === "error") {
          streamError = event.message;
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  const finalChunk = decoder.decode();
  if (finalChunk) buffer += finalChunk;

  if (buffer.trim()) {
    for (const event of compileProgressEventsFromBlock(buffer)) {
      receivedProgress = true;
      applyCompileProgressEvent(event);

      if (event.type === "done") {
        finalJob = event.job;
      } else if (event.type === "error") {
        streamError = event.message;
      }
    }
  }

  if (streamError) throw new Error(streamError);
  if (!receivedProgress || !finalJob) return false;

  await applyCompileJobResponse(finalJob, input);
  return true;
}

async function compileWithFallback(input: string) {
  const response = await $fetch<CompileJob>("/api/compile", {
    method: "POST",
    body: {
      input,
      mode: mode.value,
    },
  });

  await applyCompileJobResponse(response, input);
}

async function compilePrompt(input: string) {
  runState.value = "compiling";
  activePanel.value = "agents";
  errorMessage.value = "";
  resetCompileProgressState();

  try {
    const streamed = await compileWithStream(input);

    if (!streamed) {
      await compileWithFallback(input);
    }
  } catch (error) {
    if (compileProgressEvents.value.length === 0) {
      try {
        await compileWithFallback(input);
        return;
      } catch (fallbackError) {
        setFriendlyError(fallbackError, "Compile failed.");
        return;
      }
    }

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
  if (runState.value === "out_of_scope") return "Edit request";
  if (hasClarification.value) return "Continue";
  if (job.value) return "Copy blueprint";
  if (isBusy.value) return "Working";
  return "Compile";
}

function primaryAction() {
  if (runState.value === "out_of_scope") {
    backToInput();
    return;
  }

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
    <header class="topbar app-header">
      <div class="app-header-left">
        <NuxtLink to="/" class="brand-mark" aria-label="FlowForge home">
          FF
        </NuxtLink>

        <div class="crumb">
          <span class="crumb-root">FlowForge</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-leaf">
            <Workflow :size="14" />
            Compiler
          </span>
        </div>
      </div>

      <div class="app-header-right">
        <NuxtLink to="/automation-studio" class="studio-link">
          <Sparkles :size="14" />
          Automation Studio
          <ArrowRight :size="14" />
        </NuxtLink>

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
            <span class="mode-menu-label">Mode</span>
            <strong>{{ selectedMode.label }}</strong>
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
      <section class="workspace-column">
        <div v-if="isBusy" class="unified-loading-stage" aria-live="polite">
          <section class="live-activity-panel">
            <div class="live-activity-visual" aria-hidden="true">
              <div class="activity-core" :class="`tone-${activeCompilerVisual.tone}`">
                <component :is="activeCompilerVisual.icon" :size="32" :stroke-width="1.9" />
                <span class="activity-core-glow" />
              </div>
              <span class="activity-orbit orbit-one" />
              <span class="activity-orbit orbit-two" />
              <span class="activity-orbit orbit-three" />
              <span class="activity-scan" />
            </div>

            <div class="live-activity-copy">
              <div class="live-activity-topline">
                <span class="live-status-dot" />
                <span>{{ runState === "clarifying" ? "FlowForge is clarifying" : "FlowForge is working" }}</span>
              </div>

              <Transition name="activity-text" mode="out-in">
                <div :key="unifiedLoadingStep" class="live-activity-message">
                  <h1>{{ unifiedLoadingStep }}</h1>
                  <p>{{ currentProcessStatus.message || activeCompilerVisual.activity || unifiedLoadingMessage }}</p>
                  <span class="live-agent-activity">{{ activeCompilerVisual.activity }}</span>
                </div>
              </Transition>

              <div class="live-activity-progress">
                <span class="activity-progress-track">
                  <span class="activity-progress-runner" />
                </span>
                <span>{{ runState === "clarifying" ? "Reviewing the request" : "Building and checking the workflow" }}</span>
              </div>

              <Transition name="activity-text" mode="out-in">
                <div
                  v-if="runState === 'compiling' && latestSettledCompileEvent"
                  :key="progressEventLabel(latestSettledCompileEvent)"
                  class="live-activity-previous"
                >
                  <Check :size="14" />
                  <span>
                    {{ progressEventLabel(latestSettledCompileEvent) }} ·
                    {{ progressEventMessage(latestSettledCompileEvent) }}
                  </span>
                </div>
                <div v-else class="live-activity-previous is-muted">
                  <Loader2 class="spin" :size="14" />
                  <span>Preparing the first compiler action</span>
                </div>
              </Transition>
            </div>
          </section>
        </div>

        <div v-else-if="runState === 'failed'" class="error-panel">
          <h1>Something failed</h1>
          <p>{{ errorMessage }}</p>
          <button type="button" class="ghost-button" @click="backToInput">Back to input</button>
        </div>

        <section v-else-if="runState === 'out_of_scope'" class="out-of-scope-stage">
          <div class="out-of-scope-icon" aria-hidden="true">
            <Workflow :size="26" />
          </div>

          <div class="out-of-scope-copy">
            <p class="eyebrow">Outside FlowForge scope</p>
            <h1>FlowForge designs workflow automations</h1>
            <p>
              {{ job?.router_decision?.user_message
                || "This request does not appear to describe a workflow, automation, integration, or operational process." }}
            </p>
          </div>

          <div class="out-of-scope-example">
            <span>Try describing</span>
            <strong>What starts the process, what should happen, and the expected result.</strong>
            <p>Example: Every morning, collect new application emails, extract candidate details, classify priority, and create an internal review task.</p>
          </div>

          <button type="button" class="primary-action out-of-scope-edit" @click="backToInput">
            Edit request
            <span>→</span>
          </button>
        </section>

        <div v-else-if="!job && !hasClarification" class="input-stage">
          <section class="input-stage-card">
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
          </section>
        </div>

        <div v-else-if="hasClarification && currentQuestion" class="clarify-stage">
          <div class="clarification-header">
            <div>
              <p class="eyebrow">Guided clarification</p>
              <h1>One detail before compilation</h1>
            </div>
            <span class="clarification-progress-pill">{{ clarificationProgressLabel }}</span>
          </div>

          <div class="question-card refined-question-card">
            <div class="question-card-topline">
              <span class="question-kind">{{ currentQuestion.kind.replaceAll("_", " ") }}</span>
              <span class="question-thinking-state">
                <span class="status-dot" />
                Waiting for your answer
              </span>
            </div>

            <h2>{{ currentQuestion.question }}</h2>
            <p>{{ currentQuestion.why_it_matters }}</p>

            <label class="answer-field-label" for="clarification-answer">Your answer</label>
            <textarea
              id="clarification-answer"
              v-model="clarificationAnswerDraft"
              class="answer-input"
              rows="4"
              :placeholder="currentQuestion.example_answer || 'Type a short answer...'"
              @keydown.meta.enter.prevent="continueClarification"
              @keydown.ctrl.enter.prevent="continueClarification"
            />

            <div class="question-card-footer">
              <div v-if="currentQuestion.example_answer" class="example-answer">
                <span>Example</span>
                {{ currentQuestion.example_answer }}
              </div>
              <span class="keyboard-hint">Ctrl/⌘ + Enter to continue</span>
            </div>
          </div>
        </div>

        <div v-else-if="job" class="result-stage">
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

          <section v-else class="blueprint-panel" :class="{ 'is-success': showBlueprintSuccess }">
            <div v-if="showBlueprintSuccess" class="blueprint-success-sheen" aria-hidden="true" />
            <Transition name="success-chip">
              <span v-if="showBlueprintSuccess" class="blueprint-success-chip">
                <Check :size="14" />
                Final Guard passed · Blueprint ready
              </span>
            </Transition>
            <div class="blueprint-heading">
              <div>
                <p class="eyebrow">Automation blueprint</p>
                <h1>{{ resultTitle }}</h1>
                <p>{{ resultSubtitle }}</p>
              </div>

              <div class="blueprint-status-badge" :class="`tone-${blueprintStatusMeta.tone}`">
                <span class="blueprint-status-icon">
                  <component :is="blueprintStatusMeta.icon" :size="19" />
                </span>
                <div>
                  <span>Safety state</span>
                  <strong>{{ blueprintStatusMeta.label }}</strong>
                </div>
              </div>
            </div>

            <div v-if="workflowSteps.length" class="flow-map-shell">
              <div
                class="flow-map-scroll"
                tabindex="0"
                aria-label="Compiled workflow map"
                @wheel="handleFlowMapWheel"
              >
                <div class="flow-map">
                  <button
                    v-for="(step, index) in workflowSteps"
                    :key="step.id || step.label || step.title || step.name || index"
                    type="button"
                    class="flow-node"
                    :class="`flow-${workflowStepTone(step)}`"
                    :style="`--flow-index: ${index}`"
                    :aria-label="`Open details for ${workflowStepLabel(step, index)}`"
                    @click="openWorkflowStepDetails(index)"
                  >
                    <span class="node-body">
                      <span class="node-index">{{ index + 1 }}</span>
                      <span class="node-title">{{ workflowStepLabel(step, index) }}</span>
                      <ChevronRight class="node-chevron" :size="16" :stroke-width="2.4" aria-hidden="true" />
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="empty-flow">
              Workflow details are available in the raw result, but no step list was returned.
            </div>

            <section v-if="job" class="handoff-card">
              <section class="n8n-artifact-launcher" aria-label="n8n JSON draft generator">
                <div class="n8n-artifact-icon">
                  <Workflow :size="21" />
                </div>

                <div class="n8n-artifact-copy">
                  <span class="n8n-section-kicker">Primary artifact</span>
                  <h3>{{ n8nWorkflowDraft ? "n8n draft ready" : "n8n JSON draft" }}</h3>
                  <p v-if="n8nWorkflowDraft">
                    {{ n8nJsonFileName }} is ready to review, copy, or download. The workflow remains inactive by default.
                  </p>
                  <p v-else>
                    Generate an inactive, importable workflow skeleton without pushing a large JSON panel into the page.
                  </p>

                  <div class="n8n-artifact-meta">
                    <span><span class="n8n-safety-dot" /> Inactive by default</span>
                    <span v-if="n8nGeneratorMeta">{{ n8nGeneratorMeta }}</span>
                  </div>
                </div>

                <button
                  type="button"
                  class="n8n-generate-button n8n-launch-button"
                  :disabled="!canGenerateN8nJson && !n8nWorkflowDraft"
                  @click="handleN8nArtifactAction"
                >
                  <Sparkles v-if="!n8nWorkflowDraft" :size="17" />
                  <Workflow v-else :size="17" />
                  <span>{{ n8nWorkflowDraft ? "View JSON draft" : "Generate JSON draft" }}</span>
                </button>
              </section>

              <section class="prompt-secondary-card" aria-label="Secondary n8n implementation prompt">
                <div class="prompt-secondary-head">
                  <div>
                    <span class="n8n-section-kicker">Secondary artifact</span>
                    <h3>n8n builder prompt</h3>
                    <p>
                      Use the implementation brief when you want a readable node-by-node plan instead of the generated JSON file.
                    </p>
                  </div>

                  <button type="button" class="handoff-copy" @click="copyN8nImplementationPrompt">
                    {{ handoffCopied ? "Copied" : "Copy prompt" }}
                  </button>
                </div>

                <details class="handoff-preview secondary-prompt-preview">
                  <summary>Preview implementation prompt</summary>
                  <pre>{{ n8nImplementationPrompt }}</pre>
                </details>
              </section>
            </section>
          </section>
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

            <div class="agent-card-list agent-command-grid">
              <button
                v-for="agent in agentCards"
                :key="agent.id"
                type="button"
                class="agent-card agent-command-tile"
                :class="[`agent-${agent.status}`, `agent-tone-${agent.providerTone}`, `agent-visual-${agentVisualMeta(agent.id).tone}`]"
                :aria-label="`Open details for ${agent.label}`"
                @click="openAgentDetails(agent.id)"
              >
                <span class="agent-tile-topline">
                  <span class="agent-tile-icon" :class="`tone-${agentVisualMeta(agent.id).tone}`">
                    <component :is="agentVisualMeta(agent.id).icon" :size="17" :stroke-width="2" />
                  </span>
                  <span class="agent-tile-status">{{ cardStatusText(agent.status) }}</span>
                  <ChevronRight class="agent-tile-chevron" :size="17" :stroke-width="2.4" />
                </span>

                <strong class="agent-tile-name">{{ agent.label }}</strong>

                <span class="agent-tile-footer">
                  <span :class="`agent-provider-pill tone-${agent.providerTone}`">
                    {{ agent.statusLabel }}
                  </span>
                  <span v-if="agent.provider && agent.provider !== 'standby'" class="agent-tile-provider">
                    {{ providerDisplayName(agent.provider) }}
                  </span>
                </span>
              </button>
            </div>
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

            <template v-if="job && !isOutOfScope">
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


    <Teleport to="body">
      <Transition name="n8n-modal">
        <div
          v-if="showN8nModal"
        class="agent-modal-backdrop n8n-modal-backdrop"
        @click.self="closeN8nModal"
      >
        <section
          class="agent-modal n8n-artifact-modal"
          :class="{ 'is-success': showN8nSuccess }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="n8n-artifact-modal-title"
        >
          <div v-if="showN8nSuccess" class="n8n-success-sheen" aria-hidden="true" />

          <header class="agent-modal-header n8n-modal-header">
            <div class="n8n-modal-title-row">
              <span class="n8n-modal-icon">
                <Workflow :size="20" />
              </span>
              <div>
                <p class="eyebrow">Implementation artifact</p>
                <h2 id="n8n-artifact-modal-title">n8n JSON draft</h2>
              </div>
            </div>

            <div class="n8n-modal-header-actions">
              <Transition name="success-chip">
                <span v-if="showN8nSuccess" class="n8n-success-chip">
                  <Check :size="14" />
                  Draft ready
                </span>
              </Transition>
              <button
                type="button"
                class="modal-close"
                aria-label="Close n8n draft"
                :disabled="n8nGeneratorState === 'generating'"
                @click="closeN8nModal"
              >
                <X :size="18" :stroke-width="2.4" />
              </button>
            </div>
          </header>

          <div class="n8n-modal-body">
            <section v-if="n8nGeneratorState === 'generating'" class="n8n-modal-loading matched-n8n-loading" aria-live="polite">
              <div class="n8n-activity-visual" aria-hidden="true">
                <span class="n8n-activity-orbit orbit-one" />
                <span class="n8n-activity-orbit orbit-two" />
                <span class="n8n-activity-scan" />
                <span class="n8n-activity-core">
                  <Workflow :size="30" :stroke-width="1.8" />
                </span>
              </div>

              <div class="n8n-loading-copy">
                <span class="n8n-section-kicker">n8n Generator · working</span>
                <h3>Building your inactive workflow draft</h3>
                <p class="n8n-live-step">
                  {{ activeN8nLoadingStep }}
                </p>
              </div>

              <div class="n8n-loading-track" aria-hidden="true">
                <span class="n8n-loading-runner" />
              </div>

              <div class="n8n-loading-checklist" aria-hidden="true">
                <span
                  v-for="(step, index) in n8nLoadingSteps"
                  :key="step"
                  :class="{ active: index === n8nLoadingStepIndex, complete: index < n8nLoadingStepIndex }"
                >
                  <Check v-if="index < n8nLoadingStepIndex" :size="12" />
                  <span v-else class="n8n-check-dot" />
                  {{ step }}
                </span>
              </div>

              <div class="n8n-modal-safety-note matched-safety-note">
                <span class="n8n-safety-dot" />
                Credentials remain placeholders and every production action stays disabled.
              </div>
            </section>

            <section v-else-if="n8nGeneratorState === 'failed'" class="n8n-modal-error">
              <div class="n8n-error-mark">!</div>
              <span class="n8n-section-kicker">Generation failed</span>
              <h3>The draft could not be created</h3>
              <p>{{ n8nGenerateError }}</p>
              <button
                type="button"
                class="n8n-generate-button"
                :disabled="!canGenerateN8nJson"
                @click="generateN8nWorkflowDraft"
              >
                <Sparkles :size="17" />
                Try again
              </button>
            </section>

            <template v-else-if="n8nWorkflowDraft">
              <div class="n8n-modal-summary">
                <div class="n8n-file-meta">
                  <span class="n8n-file-icon">{ }</span>
                  <div>
                    <strong>{{ n8nJsonFileName }}</strong>
                    <span>Validated import draft · inactive</span>
                  </div>
                </div>
                <span v-if="n8nGeneratorMeta" class="n8n-meta-pill">{{ n8nGeneratorMeta }}</span>
              </div>

              <div class="n8n-safety-strip n8n-modal-safety-strip">
                <span class="n8n-safety-dot" />
                <div>
                  <strong>Review before importing</strong>
                  <p>{{ n8nStaticSafetyWarning }}</p>
                </div>
              </div>

              <div v-if="displayedN8nWarnings.length" class="n8n-message-panel tone-warning">
                <strong>Configuration notes</strong>
                <ul>
                  <li v-for="warning in displayedN8nWarnings" :key="warning">{{ warning }}</li>
                </ul>
              </div>

              <div class="n8n-json-output refined-json-output n8n-modal-json">
                <pre>{{ n8nWorkflowJsonText }}</pre>
              </div>
            </template>
          </div>

          <footer v-if="n8nWorkflowDraft && n8nGeneratorState !== 'generating'" class="n8n-modal-footer">
            <button type="button" class="n8n-toolbar-button" @click="generateN8nWorkflowDraft">
              <Sparkles :size="15" />
              Regenerate
            </button>
            <div class="n8n-modal-footer-primary">
              <button type="button" class="n8n-toolbar-button" @click="copyN8nWorkflowJson">
                <Check v-if="n8nJsonCopied" :size="15" />
                <Clipboard v-else :size="15" />
                {{ n8nJsonCopied ? "Copied" : "Copy JSON" }}
              </button>
              <button type="button" class="n8n-toolbar-button primary" @click="downloadN8nWorkflowJson">
                <Download :size="15" />
                Download JSON
              </button>
            </div>
          </footer>
          </section>
        </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <div v-if="activeWorkflowStep" class="agent-modal-backdrop" @click.self="closeWorkflowStepDetails">
      <section class="agent-modal step-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-step-modal-title">
        <header class="agent-modal-header">
          <div>
            <p class="eyebrow">Workflow step {{ activeWorkflowStepNumber }}</p>
            <h2 id="workflow-step-modal-title">{{ activeWorkflowStepLabel }}</h2>
          </div>
          <button type="button" class="modal-close" aria-label="Close step details" @click="closeWorkflowStepDetails">
            <X :size="18" :stroke-width="2.4" aria-hidden="true" />
          </button>
        </header>

        <div class="agent-modal-grid step-modal-grid">
          <article class="modal-section full">
            <h3>Description</h3>
            <p class="step-description">{{ activeWorkflowStepDescription }}</p>
          </article>

          <article class="modal-section">
            <h3>Step metadata</h3>
            <div class="modal-status-list step-detail-list">
              <div v-for="item in activeWorkflowStepDetailItems" :key="item.label">
                <span>{{ item.label }}</span>
                <p>{{ item.value }}</p>
              </div>
            </div>
          </article>

          <article class="modal-section">
            <h3>Safety notes</h3>
            <ul v-if="activeWorkflowStepSafetyNotes.length" class="step-note-list">
              <li v-for="note in activeWorkflowStepSafetyNotes" :key="note">{{ note }}</li>
            </ul>
            <p v-else class="step-empty-note">No step-specific safety notes were returned.</p>
          </article>

          <article v-if="activeWorkflowStepApprovalGates.length" class="modal-section full">
            <h3>Human approval gates</h3>
            <div class="step-gate-list">
              <article v-for="gate in activeWorkflowStepApprovalGates" :key="gate.id" class="step-gate-item">
                <strong>{{ gate.label }}</strong>
                <p>{{ gate.reason }}</p>
                <ul v-if="gate.review_checklist.length">
                  <li v-for="item in gate.review_checklist" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>
          </article>

          <article class="modal-section full">
            <details class="step-raw-json">
              <summary>Raw step JSON</summary>
              <pre>{{ formatDebugValue(activeWorkflowStep) }}</pre>
            </details>
          </article>
        </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
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
            <h3>Status</h3>
            <div class="modal-status-list">
              <div>
                <span>State</span>
                <strong>{{ activeAgentCard?.statusLabel || "Unknown" }}</strong>
              </div>
              <div>
                <span>Provider</span>
                <strong>{{ providerDisplayName(activeAgentCard?.provider) }}</strong>
              </div>
              <div>
                <span>Summary</span>
                <p>{{ activeAgentCard?.summary || "No summary available." }}</p>
              </div>
              <div>
                <span>Reason</span>
                <p>{{ activeAgentCard?.statusReason || "No status reason available." }}</p>
              </div>
            </div>
          </article>

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
    </Teleport>

    <footer class="action-bar">
      <div class="action-left">
        <button v-if="job || hasClarification" type="button" class="ghost-button" @click="backToInput">
          Edit input
        </button>
        <button v-if="!job && !hasClarification" type="button" class="ghost-button" :disabled="!hasInput || isBusy" @click="startGuidedCompile">
          Guided compile
        </button>
      </div>

      <div class="action-status">
        <span v-if="isBusy" class="mini-loader" />
        <span v-if="clarificationRateLimitMessage">{{ clarificationRateLimitMessage }}</span>
        <span v-else-if="errorMessage">{{ errorMessage }}</span>
        <span v-else-if="hasClarification">Answer the current question. Previous answers stay in Context.</span>
        <span v-else-if="runState === 'out_of_scope'">Describe a workflow or process you want FlowForge to design.</span>
        <span v-else-if="job">Blueprint is ready. Details are optional.</span>
        <span v-else>Start the semantic router or use a preset.</span>
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

.idea-generator-link {
  display: inline-flex;
  height: 44px;
  align-items: center;
  gap: 9px;
  padding: 6px 11px;
  border: 1px solid rgba(125, 140, 255, 0.38);
  border-radius: 14px;
  background:
    radial-gradient(
      circle at top left,
      rgba(125, 140, 255, 0.18),
      transparent 7rem
    ),
    rgba(255, 255, 255, 0.045);
  color: #eef3ff;
  text-decoration: none;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.idea-generator-link:hover {
  border-color: rgba(145, 166, 255, 0.72);
  background:
    radial-gradient(
      circle at top left,
      rgba(125, 140, 255, 0.28),
      transparent 7rem
    ),
    rgba(125, 140, 255, 0.1);
  transform: translateY(-1px);
}

.idea-generator-icon {
  display: grid;
  width: 27px;
  height: 27px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(145, 166, 255, 0.34);
  border-radius: 9px;
  background: rgba(125, 140, 255, 0.14);
  color: #b9c4ff;
  font-size: 15px;
  font-weight: 900;
}

.idea-generator-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.idea-generator-copy strong {
  color: #f3f6ff;
  font-size: 11px;
  font-weight: 850;
  line-height: 1;
  white-space: nowrap;
}

.idea-generator-copy small {
  color: #9eabd5;
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
}

.idea-generator-link > svg {
  flex: 0 0 auto;
  color: #8f9cff;
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
.orchestration-stage,
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

.eyebrow {
  color: #7d8cff;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 800;
  font-size: 11px;
}

.input-header h1,
.orchestration-head h1,
.process-status-head h1,
.blueprint-heading h1,
.blocked-panel h1,
.error-panel h1 {
  margin: 0;
  font-size: clamp(22px, 3vw, 38px);
  letter-spacing: -0.04em;
}

.process-status-panel {
  display: grid;
  gap: 18px;
  margin: auto 0;
  padding: 24px;
  border: 1px solid rgba(102, 227, 255, 0.22);
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.12), transparent 18rem),
    rgba(255, 255, 255, 0.035);
}

.process-status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.process-state-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(102, 227, 255, 0.3);
  border-radius: 999px;
  background: rgba(102, 227, 255, 0.08);
  color: #9decff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.process-state-pill.state-ai_success {
  border-color: rgba(67, 224, 166, 0.28);
  background: rgba(67, 224, 166, 0.08);
  color: #43e0a6;
}

.process-state-pill.state-fallback_success {
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.08);
  color: #ffd166;
}

.process-state-pill.state-failed {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.08);
  color: #ff9a9a;
}

.current-process-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 16px;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
}

.process-orb {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: #66e3ff;
  box-shadow:
    0 0 0 9px rgba(102, 227, 255, 0.08),
    0 0 28px rgba(102, 227, 255, 0.55);
  animation: agentPulse 1.2s ease-in-out infinite;
}

.current-process-card span:not(.process-orb),
.recent-events-title span {
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.current-process-card strong {
  display: block;
  margin-top: 3px;
  color: #eef3ff;
  font-size: 22px;
  font-weight: 950;
}

.current-process-card p {
  margin: 5px 0 0;
  color: #9ba9d8;
  font-size: 13px;
}

.recent-events {
  display: grid;
  gap: 8px;
}

.recent-event {
  display: grid;
  grid-template-columns: 12px minmax(110px, 0.5fr) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 8px 10px;
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.026);
}

.recent-event-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(145, 166, 255, 0.35);
}

.recent-event strong {
  color: #e9efff;
  font-size: 12px;
}

.recent-event span:last-child {
  min-width: 0;
  overflow: hidden;
  color: #9ba9d8;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-event.state-running .recent-event-dot {
  background: #66e3ff;
  box-shadow: 0 0 16px rgba(102, 227, 255, 0.7);
  animation: agentPulse 1.2s ease-in-out infinite;
}

.recent-event.state-ai_success .recent-event-dot {
  background: #43e0a6;
}

.recent-event.state-deterministic_success .recent-event-dot {
  background: #66e3ff;
}

.recent-event.state-fallback_success .recent-event-dot {
  background: #ffd166;
}

.recent-event.state-skipped .recent-event-dot {
  background: rgba(145, 166, 255, 0.28);
}

.recent-event.state-failed .recent-event-dot {
  background: #ff6b6b;
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
.orchestration-head p,
.blueprint-heading p,
.blocked-panel p,
.question-card p {
  color: #9ba9d8;
}

.orchestration-panel {
  display: grid;
  gap: 20px;
  border: 1px solid rgba(102, 227, 255, 0.18);
  border-radius: 26px;
  padding: 22px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.12), transparent 24rem),
    rgba(255, 255, 255, 0.035);
}

.orchestration-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.orchestration-head h1 {
  max-width: 760px;
}

.orchestration-head p {
  max-width: 720px;
  margin: 10px 0 0;
  line-height: 1.5;
}

.orchestration-count {
  flex: 0 0 auto;
  padding: 7px 10px;
  border: 1px solid rgba(102, 227, 255, 0.24);
  border-radius: 999px;
  background: rgba(102, 227, 255, 0.07);
  color: #9decff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.orchestration-pipeline {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.orchestration-step {
  position: relative;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 10px;
  min-height: 150px;
  padding: 13px;
  border: 1px solid rgba(145, 166, 255, 0.14);
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02)),
    rgba(6, 10, 20, 0.72);
}

.orchestration-step-marker {
  padding-top: 4px;
}

.orchestration-dot {
  display: block;
  width: 12px;
  height: 12px;
  border: 1px solid rgba(145, 166, 255, 0.32);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.orchestration-step-head {
  display: grid;
  gap: 7px;
}

.orchestration-step h2 {
  margin: 0;
  color: #eef3ff;
  font-size: 14px;
  line-height: 1.2;
}

.orchestration-step span {
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.orchestration-step p {
  margin: 10px 0 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.42;
}

.orchestration-running {
  border-color: rgba(102, 227, 255, 0.48);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.12), transparent 10rem),
    rgba(102, 227, 255, 0.045);
  box-shadow: 0 0 34px rgba(102, 227, 255, 0.1);
}

.orchestration-running .orchestration-dot {
  background: #66e3ff;
  border-color: #66e3ff;
  box-shadow: 0 0 18px rgba(102, 227, 255, 0.75);
  animation: agentPulse 1.2s ease-in-out infinite;
}

.orchestration-completed {
  border-color: rgba(67, 224, 166, 0.24);
  background: rgba(67, 224, 166, 0.04);
}

.orchestration-completed .orchestration-dot {
  background: #43e0a6;
  border-color: #43e0a6;
}

.orchestration-fallback {
  border-color: rgba(255, 209, 102, 0.28);
  background: rgba(255, 209, 102, 0.045);
}

.orchestration-fallback .orchestration-dot {
  background: #ffd166;
  border-color: #ffd166;
}

.orchestration-failed {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.045);
}

.orchestration-failed .orchestration-dot {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.orchestration-waiting,
.orchestration-skipped {
  opacity: 0.68;
}

.orchestration-skipped .orchestration-dot {
  background: rgba(145, 166, 255, 0.16);
}

.orchestration-live {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 12px 14px;
  border: 1px solid rgba(102, 227, 255, 0.2);
  border-radius: 16px;
  background: rgba(4, 8, 16, 0.48);
  color: #9ba9d8;
  font-size: 13px;
}

.orchestration-live > span:not(.mini-loader) {
  color: #9decff;
  font-weight: 900;
}

.orchestration-live strong {
  color: #dbe4ff;
  font-weight: 600;
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
  min-width: 0;
  border-radius: 26px;
  border: 1px solid rgba(145, 166, 255, 0.16);
  background: rgba(255, 255, 255, 0.035);
  padding: 22px;
}

.blueprint-panel {
  overflow: hidden;
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

.flow-map-shell {
  margin-top: 20px;
  min-width: 0;
}

.flow-map-scroll {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  padding: 10px 8px 14px;
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
    rgba(4, 8, 16, 0.34);
}

.flow-map {
  --connector-gap: 44px;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--connector-gap);
  width: max-content;
  min-width: 100%;
  padding: 2px 4px;
}

.flow-node {
  position: relative;
  display: grid;
  flex: 0 0 272px;
  width: 272px;
  min-width: 272px;
  max-width: 272px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

/* n8n-style cable between nodes. No arrows. */
.flow-node:not(:last-child)::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: 50%;
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
  top: 50%;
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
  grid-area: index;
  align-self: start;
  z-index: 2;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 24px;
  border: 1px solid rgba(145, 166, 255, 0.22);
  border-radius: 999px;
  color: #b9c7ff;
  font-weight: 900;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.055);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.node-body {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px;
  grid-template-areas:
    "index chevron"
    "title chevron";
  align-items: start;
  row-gap: 12px;
  column-gap: 12px;
  min-height: 112px;
  border: 1px solid rgba(145, 166, 255, 0.17);
  border-radius: 15px;
  padding: 14px;
  background: rgba(6, 10, 20, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    0 14px 34px rgba(0, 0, 0, 0.18);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.flow-safe .node-body {
  border-color: rgba(67, 224, 166, 0.22);
}

.flow-assist .node-body,
.flow-draft .node-body {
  border-color: rgba(255, 209, 102, 0.24);
}

.flow-approval .node-body {
  border-color: rgba(140, 125, 255, 0.34);
}

.flow-blocked .node-body {
  border-color: rgba(255, 107, 107, 0.3);
}

.flow-safe .node-index {
  border-color: rgba(67, 224, 166, 0.52);
  color: #8ff5cc;
  background: rgba(67, 224, 166, 0.14);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 16px rgba(67, 224, 166, 0.2);
}

.flow-assist .node-index,
.flow-draft .node-index {
  border-color: rgba(255, 209, 102, 0.56);
  color: #ffe29a;
  background: rgba(255, 209, 102, 0.14);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 16px rgba(255, 209, 102, 0.18);
}

.flow-approval .node-index {
  border-color: rgba(140, 125, 255, 0.58);
  color: #d8d2ff;
  background: rgba(140, 125, 255, 0.16);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 16px rgba(140, 125, 255, 0.22);
}

.flow-blocked .node-index {
  border-color: rgba(255, 107, 107, 0.58);
  color: #ffb7b7;
  background: rgba(255, 107, 107, 0.16);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 16px rgba(255, 107, 107, 0.2);
}

.node-title {
  grid-area: title;
  display: block;
  overflow: visible;
  color: #eef3ff;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.32;
  overflow-wrap: anywhere;
  white-space: normal;
}

.node-chevron {
  grid-area: chevron;
  align-self: center;
  justify-self: end;
  color: #7d8cff;
  opacity: 0.82;
}

.flow-node:hover .node-body,
.flow-node:focus-visible .node-body {
  transform: translateY(-2px);
  border-color: rgba(102, 227, 255, 0.56);
  background: rgba(9, 16, 31, 0.96);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 42px rgba(0, 0, 0, 0.28),
    0 0 0 3px rgba(102, 227, 255, 0.08);
}

.flow-node:focus-visible {
  outline: none;
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

.n8n-agent-inline {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid rgba(145, 166, 255, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.n8n-agent-inline .agent-orb {
  margin-top: 4px;
}

.n8n-agent-inline strong {
  color: #e9efff;
  font-size: 13px;
}

.n8n-agent-inline p {
  margin: 4px 0 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.4;
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
.n8n-agent-inline,
.orchestration-step,
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 7px 8px;
  align-items: center;
  min-height: 50px;
  padding: 9px 10px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
}

.agent-row-main {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agent-row-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
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
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  color: #e9efff;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-card small {
  color: #7e8dbd;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-row-meta {
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 6px;
}

.agent-provider-chip {
  grid-column: 1 / -1;
  width: fit-content;
  max-width: 100%;
  margin-left: 22px;
  overflow: hidden;
  color: #7d8cff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
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

.agent-tone-ai.agent-done {
  border-color: rgba(67, 224, 166, 0.24);
  background: rgba(67, 224, 166, 0.045);
}

.agent-tone-fallback.agent-done {
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.055);
}

.agent-tone-deterministic.agent-done {
  border-color: rgba(102, 227, 255, 0.24);
  background: rgba(102, 227, 255, 0.04);
}

.agent-tone-failed {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.055);
}

.agent-card.agent-tone-skipped,
.agent-card.agent-skipped {
  opacity: 0.62;
  border-color: rgba(145, 166, 255, 0.12);
  background: rgba(255, 255, 255, 0.025);
}

.agent-tone-fallback.agent-done .agent-orb {
  background: #ffd166;
  border-color: #ffd166;
}

.agent-tone-deterministic.agent-done .agent-orb {
  background: #66e3ff;
  border-color: #66e3ff;
}

.agent-tone-failed .agent-orb,
.agent-needs_detail .agent-orb {
  background: #ff6b6b;
  border-color: #ff6b6b;
}

.agent-tone-skipped .agent-orb,
.agent-skipped .agent-orb {
  background: rgba(145, 166, 255, 0.16);
  border-color: rgba(145, 166, 255, 0.24);
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
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
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

.modal-status-list {
  display: grid;
  gap: 10px;
}

.modal-status-list div {
  display: grid;
  gap: 4px;
}

.modal-status-list span {
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.modal-status-list strong {
  color: #e9efff;
  font-size: 14px;
}

.modal-status-list p {
  margin: 0;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.4;
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

.step-modal {
  width: min(940px, calc(100vw - 32px));
}

.step-modal-grid {
  grid-template-columns: 1fr 1fr;
}

.step-description,
.step-empty-note {
  margin: 0;
  color: #dbe4ff;
  font-size: 13px;
  line-height: 1.55;
}

.step-detail-list p {
  color: #dbe4ff;
}

.step-note-list,
.step-gate-item ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: #dbe4ff;
  font-size: 13px;
  line-height: 1.45;
}

.step-empty-note {
  color: #9ba9d8;
}

.step-gate-list {
  display: grid;
  gap: 10px;
}

.step-gate-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(140, 125, 255, 0.18);
  border-radius: 14px;
  background: rgba(140, 125, 255, 0.055);
}

.step-gate-item strong {
  color: #e9efff;
  font-size: 14px;
}

.step-gate-item p {
  margin: 0;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.45;
}

.step-raw-json {
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.step-raw-json summary {
  padding: 12px;
  color: #cbd6ff;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.step-raw-json pre {
  border-radius: 0;
  border-top: 1px solid rgba(145, 166, 255, 0.12);
  background: rgba(0, 0, 0, 0.18);
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
.idea-generator-copy {
  display: none;
}

.idea-generator-link {
  width: 40px;
  padding: 6px;
  justify-content: center;
}

.idea-generator-link > svg {
  display: none;
}
  .console-grid {
    grid-template-columns: 120px minmax(0, 1fr);
  }

  .side-panel {
    display: none;
  }
}

@media (max-width: 760px) {
.idea-generator-copy {
  display: none;
}

.idea-generator-link {
  width: 40px;
  padding: 6px;
  justify-content: center;
}

.idea-generator-link > svg {
  display: none;
}
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

  .orchestration-head {
    flex-direction: column;
  }

  .orchestration-pipeline {
    grid-template-columns: 1fr;
  }

  .orchestration-live {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
  }

  .orchestration-live strong {
    grid-column: 2;
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

  .flow-map {
    --connector-gap: 34px;
  }

  .flow-node {
    flex-basis: 236px;
    width: 236px;
    min-width: 236px;
    max-width: 236px;
  }

  .node-body {
    min-height: 104px;
    padding: 13px;
  }

  .node-title {
    font-size: 13px;
  }

  .agent-modal {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 24px);
  }

  .agent-modal-header h2 {
    font-size: 20px;
  }

  .agent-modal-grid,
  .step-modal-grid {
    grid-template-columns: 1fr;
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


/* ========================================================================== 
   Studio-aligned compiler refinement layer
   ========================================================================== */

:global(html) {
  color-scheme: dark;
  background: #090d16;
}

:global(body) {
  background: #090d16;
  color: #f4f7fb;
}

.console-shell {
  min-height: 100vh;
  padding: 60px 0 76px;
  background: #090d16;
  color: #f4f7fb;
}

.app-header {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 60px;
  padding: 0 22px;
  border: 0;
  border-bottom: 1px solid #263247;
  border-radius: 0;
  background: #0f1623;
  box-shadow: none;
  backdrop-filter: none;
}

.app-header-left,
.app-header-right {
  display: flex;
  align-items: center;
  min-width: 0;
}

.app-header-left {
  gap: 14px;
}

.app-header-right {
  justify-content: flex-end;
  gap: 12px;
}

.app-header .brand-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border: 1px solid #36445d;
  border-radius: 8px;
  background: rgba(124, 111, 242, 0.12);
  color: #f4f7fb;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-decoration: none;
}

.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.95rem;
  white-space: nowrap;
}

.crumb-root {
  color: #6f7b8e;
  font-weight: 600;
}

.crumb-sep {
  color: #36445d;
}

.crumb-leaf {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #f4f7fb;
  font-weight: 700;
}

.crumb-leaf svg {
  color: #7c6ff2;
}

.compiler-context-label {
  max-width: 260px;
  overflow: hidden;
  color: #a7b1c2;
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid #263247;
  border-radius: 7px;
  padding: 0 11px;
  color: #f4f7fb;
  font-size: 0.86rem;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}

.studio-link svg:first-child {
  color: #9185ff;
}

.studio-link:hover {
  border-color: #36445d;
  background: #131c2b;
}

.app-header .status-pill {
  min-height: 32px;
  border: 0;
  padding: 0 10px;
  box-shadow: none;
  font-size: 0.82rem;
}

.app-header .mode-menu-trigger {
  min-height: 38px;
  border: 1px solid #263247;
  border-radius: 8px;
  background: #131c2b;
  box-shadow: none;
}

.app-header .mode-menu-trigger:hover,
.app-header .mode-menu-trigger.open {
  border-color: #36445d;
  background: #182235;
}

.console-grid {
  min-height: calc(100vh - 136px);
  margin: 0;
  border: 0;
  border-radius: 0;
  background: #090d16;
  box-shadow: none;
}

.agent-rail,
.side-panel {
  background: #0f1623;
  border-color: #263247;
}

.workspace-panel {
  background: #090d16;
}

.action-bar {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 70;
  min-height: 76px;
  margin: 0;
  border: 0;
  border-top: 1px solid #263247;
  border-radius: 0;
  background: #0f1623;
  box-shadow: none;
  backdrop-filter: none;
}

/* Unified clarification and compile loader */

.unified-loading-stage {
  width: min(760px, 100%);
  margin: auto;
  padding: 28px;
}

.unified-loading-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  border: 1px solid #263247;
  border-radius: 12px;
  background: #131c2b;
  padding: 24px;
  box-shadow: none;
}

.unified-loading-main {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.unified-loading-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: rgba(124, 111, 242, 0.14);
  color: #9185ff;
}

.unified-loading-copy {
  min-width: 0;
}

.unified-loading-kicker {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 7px;
  color: #6f7b8e;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.unified-loading-state {
  border-radius: 999px;
  padding: 3px 8px;
  background: rgba(244, 184, 96, 0.1);
  color: #f4b860;
  letter-spacing: 0;
  text-transform: none;
}

.unified-loading-copy h1 {
  margin: 0;
  color: #f4f7fb;
  font-size: clamp(1.35rem, 2vw, 1.75rem);
  line-height: 1.25;
}

.unified-loading-copy p {
  max-width: 640px;
  margin: 8px 0 0;
  color: #a7b1c2;
  font-size: 0.94rem;
  line-height: 1.65;
}

.unified-current-step {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #263247;
  border-radius: 9px;
  background: #182235;
  padding: 13px 15px;
}

.unified-step-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #9185ff;
  box-shadow: 0 0 0 5px rgba(124, 111, 242, 0.1);
  animation: pulse 1.1s ease-in-out infinite;
}

.unified-current-step div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.unified-current-step span {
  color: #6f7b8e;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.unified-current-step strong {
  color: #f4f7fb;
  font-size: 0.94rem;
}

.unified-progress-list {
  display: grid;
  gap: 7px;
}

.unified-progress-item {
  display: grid;
  grid-template-columns: auto minmax(120px, 0.5fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 36px;
  border-bottom: 1px solid #263247;
  color: #a7b1c2;
  font-size: 0.84rem;
}

.unified-progress-item:last-child {
  border-bottom: 0;
}

.unified-progress-item strong {
  color: #f4f7fb;
}

.unified-loading-note {
  margin: 0;
  color: #6f7b8e;
  font-size: 0.85rem;
  line-height: 1.55;
}

/* Clarification */

.clarify-stage {
  width: min(760px, 100%);
  margin: auto;
  padding: 28px;
}

.clarification-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.clarification-header h1 {
  margin: 4px 0 0;
  color: #f4f7fb;
  font-size: 1.35rem;
}

.clarification-progress-pill {
  border: 1px solid #263247;
  border-radius: 999px;
  background: #131c2b;
  padding: 6px 10px;
  color: #a7b1c2;
  font-size: 0.8rem;
  font-weight: 700;
  white-space: nowrap;
}

.refined-question-card {
  border: 1px solid #263247;
  border-radius: 12px;
  background: #131c2b;
  padding: 22px;
  box-shadow: none;
}

.question-card-topline,
.question-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.question-thinking-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3ddc97;
  font-size: 0.8rem;
  font-weight: 650;
}

.question-thinking-state .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.refined-question-card h2 {
  max-width: 680px;
  margin: 18px 0 8px;
  color: #f4f7fb;
  font-size: clamp(1.2rem, 2vw, 1.55rem);
  line-height: 1.35;
}

.refined-question-card > p {
  margin: 0 0 20px;
  color: #a7b1c2;
  line-height: 1.6;
}

.answer-field-label {
  display: block;
  margin-bottom: 8px;
  color: #a7b1c2;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.refined-question-card .answer-input {
  width: 100%;
  border: 1px solid #263247;
  border-radius: 9px;
  background: #182235;
  color: #f4f7fb;
  box-shadow: none;
}

.refined-question-card .answer-input:focus {
  border-color: #7c6ff2;
  box-shadow: 0 0 0 3px rgba(124, 111, 242, 0.12);
  outline: none;
}

.question-card-footer {
  align-items: flex-start;
  margin-top: 12px;
}

.refined-question-card .example-answer {
  flex: 1 1 auto;
  margin: 0;
  border: 0;
  background: transparent;
  padding: 0;
  color: #6f7b8e;
}

.keyboard-hint {
  flex: 0 0 auto;
  color: #6f7b8e;
  font-size: 0.76rem;
  white-space: nowrap;
}

/* n8n JSON generator */

.refined-n8n-panel {
  margin-top: 18px;
  border: 1px solid #263247;
  border-radius: 12px;
  background: #0f1623;
  padding: 0;
  overflow: hidden;
  box-shadow: none;
}

.n8n-section-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid #263247;
}

.n8n-heading-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 9px;
  background: rgba(124, 111, 242, 0.14);
  color: #9185ff;
}

.n8n-section-kicker {
  display: block;
  margin-bottom: 3px;
  color: #6f7b8e;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.n8n-heading-copy h3 {
  margin: 0;
  color: #f4f7fb;
  font-size: 1.04rem;
}

.n8n-heading-copy p {
  max-width: 720px;
  margin: 5px 0 0;
  color: #a7b1c2;
  font-size: 0.86rem;
  line-height: 1.55;
}

.refined-n8n-panel .n8n-generate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 0;
  border-radius: 8px;
  background: #7c6ff2;
  padding: 0 15px;
  color: #f4f7fb;
  font-size: 0.86rem;
  font-weight: 700;
  box-shadow: none;
  white-space: nowrap;
}

.refined-n8n-panel .n8n-generate-button:hover:not(:disabled) {
  background: #9185ff;
}

.n8n-safety-strip,
.n8n-generation-status,
.n8n-message-panel {
  margin: 14px 20px 0;
}

.n8n-safety-strip {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  border: 1px solid rgba(244, 184, 96, 0.26);
  border-radius: 9px;
  background: rgba(244, 184, 96, 0.07);
  padding: 12px 14px;
}

.n8n-safety-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  margin-top: 5px;
  border-radius: 999px;
  background: #f4b860;
}

.n8n-safety-strip strong {
  color: #f4f7fb;
  font-size: 0.85rem;
}

.n8n-safety-strip p {
  margin: 3px 0 0;
  color: #a7b1c2;
  font-size: 0.82rem;
  line-height: 1.5;
}

.n8n-generation-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border: 1px solid #263247;
  border-radius: 9px;
  background: #131c2b;
  padding: 12px 14px;
}

.n8n-status-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(124, 111, 242, 0.12);
  color: #9185ff;
}

.n8n-generation-status strong {
  color: #f4f7fb;
  font-size: 0.88rem;
}

.n8n-generation-status p {
  margin: 3px 0 0;
  color: #a7b1c2;
  font-size: 0.82rem;
}

.n8n-meta-pill {
  border: 1px solid #263247;
  border-radius: 999px;
  background: #182235;
  padding: 5px 9px;
  color: #a7b1c2;
  font-size: 0.74rem;
  white-space: nowrap;
}

.n8n-message-panel {
  border: 1px solid #263247;
  border-radius: 9px;
  padding: 12px 14px;
}

.n8n-message-panel strong {
  color: #f4f7fb;
  font-size: 0.86rem;
}

.n8n-message-panel p,
.n8n-message-panel ul {
  margin: 6px 0 0;
  color: #a7b1c2;
  font-size: 0.82rem;
  line-height: 1.55;
}

.n8n-message-panel.tone-error {
  border-color: rgba(240, 106, 122, 0.35);
  background: rgba(240, 106, 122, 0.07);
}

.n8n-message-panel.tone-warning {
  border-color: rgba(244, 184, 96, 0.28);
  background: rgba(244, 184, 96, 0.06);
}

.refined-json-output {
  margin: 14px 20px 20px;
  border: 1px solid #263247;
  border-radius: 10px;
  background: #090d16;
  overflow: hidden;
}

.refined-json-output .n8n-json-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  border-bottom: 1px solid #263247;
  background: #131c2b;
  padding: 9px 11px 9px 14px;
}

.n8n-file-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.n8n-file-icon {
  display: grid;
  place-items: center;
  width: 31px;
  height: 31px;
  flex: 0 0 auto;
  border-radius: 7px;
  background: rgba(61, 220, 151, 0.1);
  color: #3ddc97;
  font-family: "Roboto Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  font-weight: 800;
}

.n8n-file-meta div {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.n8n-file-meta strong {
  overflow: hidden;
  color: #f4f7fb;
  font-size: 0.84rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.n8n-file-meta div span {
  color: #6f7b8e;
  font-size: 0.74rem;
}

.n8n-toolbar-actions {
  display: flex;
  gap: 7px;
}

.n8n-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 1px solid #263247;
  border-radius: 7px;
  background: #182235;
  padding: 0 10px;
  color: #f4f7fb;
  font-size: 0.78rem;
  font-weight: 650;
}

.n8n-toolbar-button:hover {
  border-color: #36445d;
}

.n8n-toolbar-button.primary {
  border-color: transparent;
  background: #7c6ff2;
}

.n8n-toolbar-button.primary:hover {
  background: #9185ff;
}

.refined-json-output pre {
  max-height: 520px;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: #090d16;
  padding: 18px;
  color: #dce3ec;
  font-family: "Roboto Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.65;
  overflow: auto;
}

.spin {
  animation: compiler-spin 0.9s linear infinite;
}

@keyframes compiler-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1180px) {
  .compiler-context-label {
    display: none;
  }
}

@media (max-width: 900px) {
  .app-header {
    padding: 0 14px;
  }

  .crumb-root,
  .crumb-sep,
  .studio-link span {
    display: none;
  }

  .studio-link {
    width: 36px;
    padding: 0;
    justify-content: center;
  }

  .studio-link svg:last-child {
    display: none;
  }

  .n8n-section-heading {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .refined-n8n-panel .n8n-generate-button {
    grid-column: 1 / -1;
    width: 100%;
  }
}

@media (max-width: 680px) {
  .app-header .status-pill {
    display: none;
  }

  .app-header .mode-menu-trigger small,
  .app-header .mode-menu-kicker {
    display: none;
  }

  .unified-loading-stage,
  .clarify-stage {
    padding: 16px;
  }

  .unified-loading-main,
  .clarification-header,
  .question-card-topline,
  .question-card-footer,
  .refined-json-output .n8n-json-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .unified-progress-item {
    grid-template-columns: auto 1fr;
  }

  .unified-progress-item > span:last-child {
    grid-column: 2;
  }

  .keyboard-hint {
    white-space: normal;
  }

  .n8n-generation-status {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .n8n-meta-pill {
    grid-column: 1 / -1;
    width: fit-content;
  }

  .n8n-toolbar-actions,
  .n8n-toolbar-button {
    width: 100%;
  }
}



/* ==========================================================================
   Layout correction layer
   Keeps the Studio visual language without inheriting obsolete positioning.
   ========================================================================== */

.console-shell {
  width: 100%;
  min-height: 100vh;
  padding: 84px 16px 108px;
  overflow-x: hidden;
}

.console-grid {
  width: min(1480px, 100%);
  max-width: 1480px;
  min-height: calc(100vh - 192px);
  margin: 0 auto;
  gap: 14px;
}

.workspace-panel {
  min-width: 0;
  min-height: calc(100vh - 192px);
  overflow: visible;
}

.result-stage,
.input-stage,
.clarify-stage,
.orchestration-stage,
.error-panel {
  min-height: auto;
}

.result-stage {
  padding-bottom: 20px;
}

.blueprint-panel,
.handoff-card,
.refined-n8n-panel,
.n8n-json-draft {
  min-width: 0;
  overflow: visible;
}

.refined-n8n-panel {
  margin-bottom: 8px;
}

.n8n-json-output,
.refined-json-output {
  min-width: 0;
  max-width: 100%;
}

.action-bar {
  position: fixed;
  inset: auto 0 0 0;
  left: 0;
  right: 0;
  bottom: 0;
  transform: none;
  width: 100%;
  max-width: none;
  min-height: 76px;
  display: grid;
  grid-template-columns: minmax(170px, auto) minmax(0, 1fr) minmax(170px, auto);
  gap: 12px;
  padding: 12px max(16px, calc((100vw - 1480px) / 2 + 16px));
  border: 0;
  border-top: 1px solid #263247;
  border-radius: 0;
  background: #0f1623;
  box-shadow: none;
  backdrop-filter: none;
}

.action-left,
.action-status,
.primary-action {
  min-width: 0;
}

.action-status {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1100px) {
  .console-grid {
    grid-template-columns: 130px minmax(0, 1fr) 300px;
  }
}

@media (max-width: 900px) {
  .console-shell {
    padding: 76px 12px 164px;
  }

  .console-grid {
    width: 100%;
    grid-template-columns: 1fr;
  }

  .workspace-panel {
    padding: 14px;
  }

  .action-bar {
    grid-template-columns: 1fr;
    padding: 10px 12px;
  }

  .primary-action {
    order: 1;
    width: 100%;
  }

  .action-left {
    order: 2;
    justify-content: center;
  }

  .action-status {
    order: 3;
    white-space: normal;
  }
}


/* ==========================================================================
   Implementation artifact hierarchy and viewport scrollbar correction
   ========================================================================== */

.handoff-card {
  padding-bottom: 22px;
}

.primary-handoff-head {
  margin-bottom: 2px;
}

.refined-n8n-panel {
  margin-top: 14px;
  padding-bottom: 20px;
  overflow: visible;
}

.n8n-safety-strip {
  margin-bottom: 0;
}

.n8n-safety-strip:last-child {
  margin-bottom: 0;
}

.prompt-secondary-card {
  margin-top: 16px;
  border: 1px solid #263247;
  border-radius: 10px;
  background: #131c2b;
  padding: 16px;
}

.prompt-secondary-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.prompt-secondary-head h3 {
  margin: 0;
  color: #f4f7fb;
  font-size: 0.98rem;
}

.prompt-secondary-head p {
  max-width: 720px;
  margin: 5px 0 0;
  color: #a7b1c2;
  font-size: 0.84rem;
  line-height: 1.5;
}

.secondary-prompt-preview {
  margin-top: 12px;
}

:global(html),
:global(body) {
  scrollbar-width: thin;
  scrollbar-color: rgba(145, 133, 255, 0.72) #0f1623;
}

:global(html::-webkit-scrollbar),
:global(body::-webkit-scrollbar) {
  width: 10px;
  height: 10px;
}

:global(html::-webkit-scrollbar-track),
:global(body::-webkit-scrollbar-track) {
  border-left: 1px solid #263247;
  background: #0f1623;
}

:global(html::-webkit-scrollbar-thumb),
:global(body::-webkit-scrollbar-thumb) {
  min-height: 42px;
  border: 2px solid #0f1623;
  border-radius: 999px;
  background: #7c6ff2;
}

:global(html::-webkit-scrollbar-thumb:hover),
:global(body::-webkit-scrollbar-thumb:hover) {
  background: #9185ff;
}

:global(html::-webkit-scrollbar-corner),
:global(body::-webkit-scrollbar-corner) {
  background: #0f1623;
}

@media (max-width: 760px) {
  .prompt-secondary-head {
    flex-direction: column;
  }

  .prompt-secondary-head .handoff-copy {
    width: 100%;
  }
}


/* ---------- n8n artifact modal ---------- */
.n8n-artifact-launcher {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px;
  border: 1px solid rgba(102, 227, 255, 0.2);
  border-radius: 20px;
  background:
    linear-gradient(135deg, rgba(102, 227, 255, 0.06), transparent 52%),
    rgba(255, 255, 255, 0.03);
}

.n8n-artifact-icon,
.n8n-modal-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(102, 227, 255, 0.3);
  border-radius: 13px;
  background: rgba(102, 227, 255, 0.09);
  color: #9decff;
}

.n8n-artifact-copy h3 {
  margin: 3px 0 5px;
  color: #eef3ff;
  font-size: 17px;
}

.n8n-artifact-copy p {
  margin: 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.55;
}

.n8n-artifact-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 9px;
  color: #7f8db8;
  font-size: 10px;
  font-weight: 750;
}

.n8n-artifact-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.n8n-launch-button {
  white-space: nowrap;
}

.n8n-modal-backdrop {
  z-index: 100;
  background: rgba(2, 5, 12, 0.78);
}

.n8n-artifact-modal {
  position: relative;
  width: min(980px, calc(100vw - 32px));
  max-height: min(850px, calc(100vh - 40px));
  border-color: rgba(102, 227, 255, 0.24);
  background:
    linear-gradient(180deg, rgba(16, 24, 40, 0.98), rgba(8, 12, 22, 0.99));
  transition: border-color 280ms ease, box-shadow 280ms ease;
}

.n8n-artifact-modal.is-success {
  border-color: rgba(67, 224, 166, 0.52);
  box-shadow:
    0 30px 110px rgba(0, 0, 0, 0.58),
    0 0 0 1px rgba(67, 224, 166, 0.08),
    0 0 34px rgba(67, 224, 166, 0.1);
}

.n8n-success-sheen {
  position: absolute;
  z-index: 2;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}

.n8n-success-sheen::before {
  content: "";
  position: absolute;
  top: -35%;
  bottom: -35%;
  left: -28%;
  width: 24%;
  transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(135, 255, 211, 0.16), transparent);
  animation: n8nSuccessSweep 760ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards;
}

.n8n-modal-header {
  position: relative;
  z-index: 3;
}

.n8n-modal-title-row,
.n8n-modal-header-actions,
.n8n-modal-footer-primary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.n8n-success-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(67, 224, 166, 0.34);
  border-radius: 999px;
  background: rgba(67, 224, 166, 0.1);
  color: #77edbf;
  font-size: 11px;
  font-weight: 850;
}

.n8n-modal-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
}

.n8n-modal-loading,
.n8n-modal-error {
  display: flex;
  min-height: 430px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 34px;
  text-align: center;
}

.n8n-loading-mark,
.n8n-error-mark {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin-bottom: 18px;
  border: 1px solid rgba(102, 227, 255, 0.3);
  border-radius: 18px;
  background: rgba(102, 227, 255, 0.08);
  color: #9decff;
}

.n8n-error-mark {
  border-color: rgba(255, 107, 107, 0.35);
  background: rgba(255, 107, 107, 0.08);
  color: #ff9a9a;
  font-size: 24px;
  font-weight: 900;
}

.n8n-modal-loading h3,
.n8n-modal-error h3 {
  margin: 7px 0 8px;
  color: #eef3ff;
  font-size: 24px;
  letter-spacing: -0.03em;
}

.n8n-modal-loading > p,
.n8n-modal-error > p {
  max-width: 590px;
  margin: 0;
  color: #9ba9d8;
  line-height: 1.6;
}

.n8n-loading-progress {
  display: flex;
  gap: 7px;
  margin-top: 24px;
}

.n8n-loading-progress span {
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: rgba(145, 166, 255, 0.16);
  transition: background 240ms ease, transform 240ms ease;
}

.n8n-loading-progress span.active {
  transform: scaleX(1.08);
  background: #66e3ff;
}

.n8n-modal-safety-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 25px;
  color: #7f8db8;
  font-size: 11px;
}

.n8n-modal-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 2px 2px 5px;
}

.n8n-modal-safety-strip {
  margin: 0;
}

.n8n-modal-json {
  display: flex;
  min-height: 280px;
  max-height: min(52vh, 520px);
  overflow: auto;
}

.n8n-modal-json pre {
  width: 100%;
  margin: 0;
}

.n8n-modal-footer {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-top: 1px solid rgba(145, 166, 255, 0.14);
  background: rgba(7, 10, 18, 0.72);
}

.n8n-modal-enter-active,
.n8n-modal-leave-active {
  transition: opacity 180ms ease;
}

.n8n-modal-enter-active .n8n-artifact-modal,
.n8n-modal-leave-active .n8n-artifact-modal {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease;
}

.n8n-modal-enter-from,
.n8n-modal-leave-to {
  opacity: 0;
}

.n8n-modal-enter-from .n8n-artifact-modal,
.n8n-modal-leave-to .n8n-artifact-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}

.success-chip-enter-active,
.success-chip-leave-active {
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.success-chip-enter-from,
.success-chip-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.96);
}

@keyframes n8nSuccessSweep {
  from { transform: translateX(0) skewX(-18deg); opacity: 0; }
  20% { opacity: 1; }
  to { transform: translateX(620%) skewX(-18deg); opacity: 0; }
}

@media (max-width: 760px) {
  .n8n-artifact-launcher {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .n8n-launch-button {
    grid-column: 1 / -1;
    width: 100%;
    justify-content: center;
  }

  .n8n-modal-header,
  .n8n-modal-footer,
  .n8n-modal-summary {
    align-items: stretch;
  }

  .n8n-modal-header-actions {
    align-self: flex-start;
  }

  .n8n-modal-footer {
    flex-direction: column-reverse;
  }

  .n8n-modal-footer-primary,
  .n8n-modal-footer-primary .n8n-toolbar-button,
  .n8n-modal-footer > .n8n-toolbar-button {
    width: 100%;
  }

  .n8n-modal-footer-primary {
    flex-direction: column;
  }

  .n8n-modal-summary {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .n8n-success-sheen::before,
  .n8n-modal-enter-active .n8n-artifact-modal,
  .n8n-modal-leave-active .n8n-artifact-modal {
    animation: none !important;
    transition-duration: 1ms !important;
  }
}

</style>

<style scoped>
/* Final alignment corrections */
.agent-card {
  position: relative;
}

.agent-row-main {
  grid-template-columns: minmax(0, 1fr);
  padding-left: 22px;
}

.agent-row-main .agent-orb {
  position: absolute;
  top: 50%;
  left: 12px;
  margin: 0;
  transform: translateY(-50%);
}

.agent-card-head .agent-orb {
  align-self: center;
  justify-self: center;
  margin: 0;
}

.n8n-safety-strip {
  align-items: center;
}

.n8n-safety-dot {
  align-self: center;
  margin-top: 0;
}


.out-of-scope-stage {
  display: grid;
  width: min(720px, 100%);
  margin: 0 auto;
  padding: 34px;
  gap: 22px;
  align-content: start;
  border: 1px solid #263247;
  border-radius: 18px;
  background: #0f1623;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
}

.out-of-scope-icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 1px solid rgba(124, 111, 242, 0.42);
  border-radius: 15px;
  background: rgba(124, 111, 242, 0.12);
  color: #9185ff;
}

.out-of-scope-copy {
  display: grid;
  gap: 10px;
}

.out-of-scope-copy h1 {
  margin: 0;
  color: #f4f7ff;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.08;
}

.out-of-scope-copy > p:last-child {
  max-width: 64ch;
  margin: 0;
  color: #aeb9ce;
  font-size: 15px;
  line-height: 1.7;
}

.out-of-scope-example {
  display: grid;
  gap: 7px;
  padding: 18px;
  border: 1px solid #263247;
  border-radius: 14px;
  background: #131c2b;
}

.out-of-scope-example span {
  color: #9185ff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.out-of-scope-example strong {
  color: #e8edfa;
  font-size: 14px;
}

.out-of-scope-example p {
  margin: 0;
  color: #8f9bb0;
  font-size: 13px;
  line-height: 1.55;
}

.out-of-scope-edit {
  width: fit-content;
}

@media (max-width: 720px) {
  .out-of-scope-stage {
    padding: 24px;
  }
}

/* ---------- n8n artifact modal ---------- */
.n8n-artifact-launcher {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px;
  border: 1px solid rgba(102, 227, 255, 0.2);
  border-radius: 20px;
  background:
    linear-gradient(135deg, rgba(102, 227, 255, 0.06), transparent 52%),
    rgba(255, 255, 255, 0.03);
}

.n8n-artifact-icon,
.n8n-modal-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(102, 227, 255, 0.3);
  border-radius: 13px;
  background: rgba(102, 227, 255, 0.09);
  color: #9decff;
}

.n8n-artifact-copy h3 {
  margin: 3px 0 5px;
  color: #eef3ff;
  font-size: 17px;
}

.n8n-artifact-copy p {
  margin: 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.55;
}

.n8n-artifact-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 9px;
  color: #7f8db8;
  font-size: 10px;
  font-weight: 750;
}

.n8n-artifact-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.n8n-launch-button {
  white-space: nowrap;
}

.n8n-modal-backdrop {
  z-index: 100;
  background: rgba(2, 5, 12, 0.78);
}

.n8n-artifact-modal {
  position: relative;
  width: min(980px, calc(100vw - 32px));
  max-height: min(850px, calc(100vh - 40px));
  border-color: rgba(102, 227, 255, 0.24);
  background:
    linear-gradient(180deg, rgba(16, 24, 40, 0.98), rgba(8, 12, 22, 0.99));
  transition: border-color 280ms ease, box-shadow 280ms ease;
}

.n8n-artifact-modal.is-success {
  border-color: rgba(67, 224, 166, 0.52);
  box-shadow:
    0 30px 110px rgba(0, 0, 0, 0.58),
    0 0 0 1px rgba(67, 224, 166, 0.08),
    0 0 34px rgba(67, 224, 166, 0.1);
}

.n8n-success-sheen {
  position: absolute;
  z-index: 2;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}

.n8n-success-sheen::before {
  content: "";
  position: absolute;
  top: -35%;
  bottom: -35%;
  left: -28%;
  width: 24%;
  transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(135, 255, 211, 0.16), transparent);
  animation: n8nSuccessSweep 760ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards;
}

.n8n-modal-header {
  position: relative;
  z-index: 3;
}

.n8n-modal-title-row,
.n8n-modal-header-actions,
.n8n-modal-footer-primary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.n8n-success-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid rgba(67, 224, 166, 0.34);
  border-radius: 999px;
  background: rgba(67, 224, 166, 0.1);
  color: #77edbf;
  font-size: 11px;
  font-weight: 850;
}

.n8n-modal-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  padding: 18px;
  overflow-y: auto;
}

.n8n-modal-loading,
.n8n-modal-error {
  display: flex;
  min-height: 430px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 34px;
  text-align: center;
}

.n8n-loading-mark,
.n8n-error-mark {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin-bottom: 18px;
  border: 1px solid rgba(102, 227, 255, 0.3);
  border-radius: 18px;
  background: rgba(102, 227, 255, 0.08);
  color: #9decff;
}

.n8n-error-mark {
  border-color: rgba(255, 107, 107, 0.35);
  background: rgba(255, 107, 107, 0.08);
  color: #ff9a9a;
  font-size: 24px;
  font-weight: 900;
}

.n8n-modal-loading h3,
.n8n-modal-error h3 {
  margin: 7px 0 8px;
  color: #eef3ff;
  font-size: 24px;
  letter-spacing: -0.03em;
}

.n8n-modal-loading > p,
.n8n-modal-error > p {
  max-width: 590px;
  margin: 0;
  color: #9ba9d8;
  line-height: 1.6;
}

.n8n-loading-progress {
  display: flex;
  gap: 7px;
  margin-top: 24px;
}

.n8n-loading-progress span {
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: rgba(145, 166, 255, 0.16);
  transition: background 240ms ease, transform 240ms ease;
}

.n8n-loading-progress span.active {
  transform: scaleX(1.08);
  background: #66e3ff;
}

.n8n-modal-safety-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 25px;
  color: #7f8db8;
  font-size: 11px;
}

.n8n-modal-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 2px 2px 5px;
}

.n8n-modal-safety-strip {
  margin: 0;
}

.n8n-modal-json {
  display: flex;
  min-height: 280px;
  max-height: min(52vh, 520px);
  overflow: auto;
}

.n8n-modal-json pre {
  width: 100%;
  margin: 0;
}

.n8n-modal-footer {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-top: 1px solid rgba(145, 166, 255, 0.14);
  background: rgba(7, 10, 18, 0.72);
}

.n8n-modal-enter-active,
.n8n-modal-leave-active {
  transition: opacity 180ms ease;
}

.n8n-modal-enter-active .n8n-artifact-modal,
.n8n-modal-leave-active .n8n-artifact-modal {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease;
}

.n8n-modal-enter-from,
.n8n-modal-leave-to {
  opacity: 0;
}

.n8n-modal-enter-from .n8n-artifact-modal,
.n8n-modal-leave-to .n8n-artifact-modal {
  opacity: 0;
  transform: translateY(10px) scale(0.985);
}

.success-chip-enter-active,
.success-chip-leave-active {
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.success-chip-enter-from,
.success-chip-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.96);
}

@keyframes n8nSuccessSweep {
  from { transform: translateX(0) skewX(-18deg); opacity: 0; }
  20% { opacity: 1; }
  to { transform: translateX(620%) skewX(-18deg); opacity: 0; }
}

@media (max-width: 760px) {
  .n8n-artifact-launcher {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .n8n-launch-button {
    grid-column: 1 / -1;
    width: 100%;
    justify-content: center;
  }

  .n8n-modal-header,
  .n8n-modal-footer,
  .n8n-modal-summary {
    align-items: stretch;
  }

  .n8n-modal-header-actions {
    align-self: flex-start;
  }

  .n8n-modal-footer {
    flex-direction: column-reverse;
  }

  .n8n-modal-footer-primary,
  .n8n-modal-footer-primary .n8n-toolbar-button,
  .n8n-modal-footer > .n8n-toolbar-button {
    width: 100%;
  }

  .n8n-modal-footer-primary {
    flex-direction: column;
  }

  .n8n-modal-summary {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .n8n-success-sheen::before,
  .n8n-modal-enter-active .n8n-artifact-modal,
  .n8n-modal-leave-active .n8n-artifact-modal {
    animation: none !important;
    transition-duration: 1ms !important;
  }
}


/* ---------- Blueprint completion success ---------- */
.blueprint-panel {
  position: relative;
  overflow: hidden;
  transition: border-color 280ms ease, box-shadow 280ms ease;
}

.blueprint-panel.is-success {
  border-color: rgba(67, 224, 166, 0.44);
  box-shadow:
    0 0 0 1px rgba(67, 224, 166, 0.06),
    0 0 32px rgba(67, 224, 166, 0.09);
}

.blueprint-success-sheen {
  position: absolute;
  z-index: 4;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}

.blueprint-success-sheen::before {
  content: "";
  position: absolute;
  top: -40%;
  bottom: -40%;
  left: -24%;
  width: 18%;
  transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(135, 255, 211, 0.13), transparent);
  animation: n8nSuccessSweep 720ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards;
}

.blueprint-success-chip {
  position: absolute;
  z-index: 6;
  top: 18px;
  right: 18px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border: 1px solid rgba(67, 224, 166, 0.34);
  border-radius: 999px;
  background: rgba(8, 24, 22, 0.94);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
  color: #77edbf;
  font-size: 11px;
  font-weight: 850;
  white-space: nowrap;
}

/* Keep every modal result section on the same content width. */
.n8n-modal-body > *,
.n8n-modal-body > template > * {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
}

.n8n-modal-summary,
.n8n-modal-safety-strip,
.n8n-modal-body .n8n-message-panel,
.n8n-modal-json {
  width: 100%;
  max-width: none;
  margin-left: 0;
  margin-right: 0;
  box-sizing: border-box;
}

.n8n-modal-json {
  align-self: stretch;
}

@media (max-width: 640px) {
  .blueprint-success-chip {
    position: relative;
    top: auto;
    right: auto;
    align-self: flex-start;
    margin-bottom: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .blueprint-success-sheen::before {
    animation: none;
  }
}
</style>

<style scoped>
/* ---------- Full-width compiler layout + viewport modal layer ---------- */

.console-shell {
  width: 100%;
  padding-inline: 14px;
}

.console-grid {
  width: 100%;
  max-width: none;
  margin-inline: 0;
  grid-template-columns:
    clamp(145px, 10vw, 190px)
    minmax(0, 1fr)
    clamp(310px, 22vw, 390px);
  gap: 16px;
}

.agent-rail,
.side-panel {
  min-width: 0;
}

.workspace-panel {
  min-width: 0;
  width: 100%;
}

/* Teleported dialogs live directly under body and always beat page chrome. */
.agent-modal-backdrop {
  position: fixed !important;
  z-index: 2147483000 !important;
  inset: 0 !important;
  width: 100vw;
  min-height: 100dvh;
  padding: 16px;
  overflow: auto;
  overscroll-behavior: contain;
  isolation: isolate;
  place-items: center;
}

.agent-modal-backdrop::before {
  content: "";
  position: fixed;
  z-index: -1;
  inset: 0;
  background: rgba(2, 5, 12, 0.8);
  backdrop-filter: blur(16px);
}

.agent-modal,
.n8n-artifact-modal {
  position: relative;
  z-index: 1;
  max-height: calc(100dvh - 32px);
  margin: auto;
}

.n8n-modal-backdrop {
  z-index: 2147483100 !important;
  background: transparent;
}

@media (min-width: 1700px) {
  .console-shell {
    padding-inline: 18px;
  }

  .console-grid {
    grid-template-columns: 190px minmax(0, 1fr) 390px;
    gap: 18px;
  }
}

@media (max-width: 1180px) {
  .console-grid {
    grid-template-columns: 135px minmax(0, 1fr) 300px;
    gap: 12px;
  }
}

@media (max-width: 980px) {
  .console-grid {
    grid-template-columns: 1fr;
  }

  .agent-rail,
  .side-panel {
    position: static;
    width: 100%;
  }
}

@media (max-width: 640px) {
  .console-shell {
    padding-inline: 10px;
  }

  .agent-modal-backdrop {
    padding: 8px;
    place-items: start center;
  }

  .agent-modal,
  .n8n-artifact-modal {
    width: 100%;
    max-height: calc(100dvh - 16px);
    border-radius: 18px;
  }
}
</style>


<style scoped>
/* ---------- Final three-column alignment correction ---------- */

.console-grid {
  align-items: start !important;
}

/* The center column is only a grid column now, not another visual card. */
.workspace-column {
  min-width: 0;
  width: 100%;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  overflow: visible;
  align-self: start !important;
}

/* All three columns share the exact same natural top edge. */
.agent-rail,
.workspace-column,
.side-panel {
  align-self: start !important;
  margin-top: 0 !important;
  transform: none !important;
}

.agent-rail,
.side-panel {
  top: 60px;
}

/* The actual center card owns its own visual surface. */
.workspace-column > .result-stage,
.workspace-column > .input-stage,
.workspace-column > .clarify-stage,
.workspace-column > .unified-loading-stage,
.workspace-column > .error-panel,
.workspace-column > .out-of-scope-stage {
  width: 100%;
  margin: 0;
}

@media (max-width: 980px) {
  .workspace-column {
    order: 2;
  }

  .agent-rail,
  .side-panel {
    position: static;
    top: auto;
  }
}
</style>


<style scoped>
/* ---------- Unified top alignment + command-station agent tiles ---------- */

/*
  The side columns previously remained sticky with independent top offsets.
  Keeping them in normal grid flow guarantees that all three columns begin on
  the exact same row. The panel itself still owns its internal scrolling.
*/
.console-grid {
  align-items: start !important;
  padding-top: 0 !important;
}

.console-grid > .agent-rail,
.console-grid > .workspace-column,
.console-grid > .side-panel {
  align-self: start !important;
  margin: 0 !important;
  inset-block-start: auto !important;
  top: auto !important;
  translate: none !important;
  transform: none !important;
}

.console-grid > .agent-rail,
.console-grid > .side-panel {
  position: relative !important;
}

.workspace-column,
.workspace-column > :first-child,
.side-panel,
.agent-rail {
  margin-top: 0 !important;
}

/* Two-up spacecraft-style agent console. */
.agent-command-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.agent-command-tile {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 118px;
  padding: 12px;
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 15px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
    rgba(8, 13, 24, 0.92);
  color: inherit;
  cursor: pointer;
  text-align: left;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    0 10px 24px rgba(0, 0, 0, 0.16);
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease,
    opacity 160ms ease;
}

.agent-command-tile::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(120deg, transparent 20%, rgba(255, 255, 255, 0.09), transparent 72%);
  transform: translateX(-110%);
}

.agent-command-tile:hover,
.agent-command-tile:focus-visible {
  z-index: 2;
  transform: translateY(-2px);
  border-color: rgba(102, 227, 255, 0.46);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 14px 34px rgba(0, 0, 0, 0.28),
    0 0 24px rgba(102, 227, 255, 0.08);
  outline: none;
}

.agent-tile-topline,
.agent-tile-footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  min-width: 0;
}

.agent-tile-status {
  color: #8290bc;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.agent-tile-chevron {
  flex: 0 0 auto;
  color: #7181b4;
  transition: transform 160ms ease, color 160ms ease;
}

.agent-command-tile:hover .agent-tile-chevron,
.agent-command-tile:focus-visible .agent-tile-chevron {
  color: #9decff;
  transform: translateX(2px);
}

.agent-tile-name {
  position: relative;
  z-index: 1;
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: #f0f4ff;
  font-size: 13px;
  font-weight: 850;
  line-height: 1.25;
  white-space: normal;
  text-overflow: initial;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.agent-tile-footer {
  align-items: flex-end;
}

.agent-tile-footer .agent-provider-pill {
  min-width: 0;
  max-width: 100%;
  padding-inline: 7px;
  overflow: hidden;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-tile-provider {
  min-width: 0;
  overflow: hidden;
  color: #7f8db9;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

/* Whole-tile state lighting replaces the small status orb. */
.agent-command-tile.agent-active {
  border-color: rgba(102, 227, 255, 0.72);
  background:
    radial-gradient(circle at 85% 12%, rgba(102, 227, 255, 0.2), transparent 54%),
    linear-gradient(145deg, rgba(102, 227, 255, 0.12), rgba(9, 24, 36, 0.88));
  box-shadow:
    inset 0 0 0 1px rgba(102, 227, 255, 0.08),
    0 0 24px rgba(102, 227, 255, 0.18);
  animation: agentTileLive 1.45s ease-in-out infinite;
}

.agent-command-tile.agent-active::before {
  opacity: 1;
  animation: agentTileScan 1.8s ease-in-out infinite;
}

.agent-command-tile.agent-tone-ai.agent-done {
  border-color: rgba(67, 224, 166, 0.48);
  background:
    radial-gradient(circle at 85% 10%, rgba(67, 224, 166, 0.14), transparent 52%),
    rgba(22, 63, 57, 0.32);
  box-shadow: inset 0 0 0 1px rgba(67, 224, 166, 0.045);
}

.agent-command-tile.agent-tone-fallback.agent-done,
.agent-command-tile.agent-skipped {
  border-color: rgba(255, 209, 102, 0.44);
  background:
    radial-gradient(circle at 85% 10%, rgba(255, 209, 102, 0.13), transparent 52%),
    rgba(63, 50, 22, 0.3);
}

.agent-command-tile.agent-tone-deterministic.agent-done {
  border-color: rgba(102, 227, 255, 0.4);
  background:
    radial-gradient(circle at 85% 10%, rgba(102, 227, 255, 0.12), transparent 52%),
    rgba(19, 48, 66, 0.34);
}

.agent-command-tile.agent-tone-failed,
.agent-command-tile.agent-needs_detail {
  border-color: rgba(255, 107, 107, 0.52);
  background:
    radial-gradient(circle at 85% 10%, rgba(255, 107, 107, 0.14), transparent 52%),
    rgba(68, 25, 32, 0.34);
}

.agent-command-tile.agent-tone-skipped,
.agent-command-tile.agent-idle {
  opacity: 0.62;
}

@keyframes agentTileLive {
  0%, 100% {
    box-shadow:
      inset 0 0 0 1px rgba(102, 227, 255, 0.08),
      0 0 16px rgba(102, 227, 255, 0.12);
  }
  50% {
    box-shadow:
      inset 0 0 0 1px rgba(102, 227, 255, 0.17),
      0 0 32px rgba(102, 227, 255, 0.3);
  }
}

@keyframes agentTileScan {
  0% { transform: translateX(-120%); }
  55%, 100% { transform: translateX(120%); }
}

/* More compact, near-square n8n-like workflow nodes. */
.flow-map {
  --connector-gap: 34px;
}

.flow-node {
  flex-basis: 178px;
  width: 178px;
  min-width: 178px;
  max-width: 178px;
}

.flow-node .node-body {
  min-height: 132px;
  padding: 13px;
  grid-template-columns: minmax(0, 1fr) 18px;
  row-gap: 14px;
  border-radius: 14px;
}

.flow-node .node-title {
  align-self: end;
  font-size: 13px;
  line-height: 1.3;
  white-space: normal;
}

@media (max-width: 1320px) {
  .agent-command-grid {
    grid-template-columns: 1fr;
  }

  .agent-command-tile {
    min-height: 94px;
  }
}

@media (max-width: 980px) {
  .agent-command-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .agent-command-grid {
    grid-template-columns: 1fr;
  }

  .flow-node {
    flex-basis: 156px;
    width: 156px;
    min-width: 156px;
    max-width: 156px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-command-tile.agent-active,
  .agent-command-tile.agent-active::before {
    animation: none;
  }
}
</style>

<style scoped>
/* ---------- Blueprint nodes, initial input surface, and agent-thinking state ---------- */

.input-stage-card,
.agent-thinking-panel {
  width: 100%;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82);
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24);
}

.input-stage-card {
  min-height: calc(100vh - 168px);
  padding: 22px;
}

.agent-thinking-panel {
  display: grid;
  gap: 18px;
  min-height: calc(100vh - 168px);
  padding: 24px;
  overflow: hidden;
  position: relative;
}

.agent-thinking-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 80% 0%, rgba(102, 227, 255, 0.12), transparent 34rem);
}

.agent-thinking-header,
.agent-thinking-current,
.agent-thinking-feed,
.agent-thinking-panel > .unified-loading-note {
  position: relative;
  z-index: 1;
}

.agent-thinking-header {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.agent-thinking-mark {
  position: relative;
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 1px solid rgba(102, 227, 255, 0.36);
  border-radius: 16px;
  background: rgba(102, 227, 255, 0.09);
  color: #9decff;
}

.agent-thinking-pulse {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #43e0a6;
  box-shadow: 0 0 0 5px rgba(67, 224, 166, 0.09), 0 0 18px rgba(67, 224, 166, 0.65);
  animation: agentPulse 1.25s ease-in-out infinite;
}

.agent-thinking-heading h1 {
  margin: 0;
  color: #f4f7fb;
  font-size: clamp(1.45rem, 2vw, 2rem);
  letter-spacing: -0.025em;
}

.agent-thinking-heading p {
  max-width: 720px;
  margin: 8px 0 0;
  color: #9ba9d8;
  line-height: 1.65;
}

.agent-thinking-current {
  padding: 16px 18px;
  border: 1px solid rgba(102, 227, 255, 0.24);
  border-radius: 16px;
  background: rgba(102, 227, 255, 0.055);
}

.agent-thinking-current-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.thinking-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #66e3ff;
  box-shadow: 0 0 16px rgba(102, 227, 255, 0.75);
  animation: agentPulse 1.2s ease-in-out infinite;
}

.agent-thinking-current strong {
  display: block;
  margin-top: 7px;
  color: #eef3ff;
  font-size: 1.02rem;
}

.agent-thinking-current p {
  margin: 5px 0 0;
  color: #9ba9d8;
  font-size: 0.88rem;
}

.agent-thinking-feed {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.agent-thinking-event {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 11px;
  min-height: 78px;
  padding: 13px;
  border: 1px solid rgba(145, 166, 255, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.028);
}

.thinking-event-index {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: rgba(125, 140, 255, 0.12);
  color: #aebaff;
  font-family: "Roboto Mono", monospace;
  font-size: 10px;
  font-weight: 900;
}

.agent-thinking-event strong,
.agent-thinking-event span:last-child { display: block; }
.agent-thinking-event strong { color: #eef3ff; font-size: 12px; }
.agent-thinking-event span:last-child { margin-top: 5px; color: #8f9dcc; font-size: 11px; line-height: 1.4; }
.agent-thinking-event.state-running { border-color: rgba(102, 227, 255, 0.38); background: rgba(102, 227, 255, 0.055); }
.agent-thinking-event.state-ai_success { border-color: rgba(67, 224, 166, 0.3); }
.agent-thinking-event.state-fallback_success { border-color: rgba(255, 209, 102, 0.32); }
.agent-thinking-event.state-failed { border-color: rgba(255, 107, 107, 0.36); }

.blueprint-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.blueprint-status-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  min-width: 210px;
  padding: 10px 12px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}

.blueprint-status-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
}

.blueprint-status-badge span:not(.blueprint-status-icon),
.blueprint-status-badge strong { display: block; }
.blueprint-status-badge span:not(.blueprint-status-icon) { color: #8390b9; font-size: 9px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
.blueprint-status-badge strong { margin-top: 3px; color: #edf2ff; font-size: 11px; }
.blueprint-status-badge.tone-success { border-color: rgba(67, 224, 166, 0.28); }
.blueprint-status-badge.tone-success .blueprint-status-icon { background: rgba(67, 224, 166, 0.12); color: #43e0a6; }
.blueprint-status-badge.tone-warning { border-color: rgba(255, 209, 102, 0.3); }
.blueprint-status-badge.tone-warning .blueprint-status-icon { background: rgba(255, 209, 102, 0.11); color: #ffd166; }
.blueprint-status-badge.tone-danger { border-color: rgba(255, 107, 107, 0.3); }
.blueprint-status-badge.tone-danger .blueprint-status-icon { background: rgba(255, 107, 107, 0.11); color: #ff7e7e; }

.flow-map {
  --connector-gap: 30px;
}

.flow-node {
  flex-basis: 168px !important;
  width: 168px !important;
  min-width: 168px !important;
  max-width: 168px !important;
}

.flow-node .node-body {
  display: grid;
  grid-template-columns: 1fr 18px;
  grid-template-rows: 28px minmax(56px, 1fr);
  align-items: stretch;
  min-height: 132px;
}

.flow-node .node-index {
  display: grid !important;
  place-items: center !important;
  align-self: start;
  justify-self: start;
  padding: 0 !important;
  line-height: 1 !important;
  text-align: center !important;
}

.flow-node .node-title {
  align-self: center !important;
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  line-height: 1.35;
  text-align: left;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.flow-node:not(:last-child)::after {
  width: 52px !important;
  opacity: 0.95;
  background: linear-gradient(90deg, transparent, rgba(102, 227, 255, 0.25), #66e3ff, rgba(67, 224, 166, 0.8), transparent) !important;
  background-size: 220% 100% !important;
  animation: connectorEnergy 2.2s linear infinite !important;
  filter: drop-shadow(0 0 5px rgba(102, 227, 255, 0.85));
}

.flow-node:not(:last-child)::before {
  border-color: rgba(102, 227, 255, 0.34) !important;
  box-shadow: 0 0 12px rgba(102, 227, 255, 0.22);
}

@keyframes connectorEnergy {
  from { background-position: 220% 0; }
  to { background-position: -20% 0; }
}

@media (max-width: 900px) {
  .agent-thinking-feed { grid-template-columns: 1fr; }
  .blueprint-heading { flex-direction: column; }
  .blueprint-status-badge { min-width: 0; width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .agent-thinking-pulse,
  .thinking-live-dot,
  .flow-node:not(:last-child)::after { animation: none !important; }
}
</style>

<style scoped>
/* ---------- Focused live compiler activity ---------- */
.live-activity-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(180px, 0.72fr) minmax(0, 1.28fr);
  align-items: center;
  gap: clamp(28px, 5vw, 72px);
  width: 100%;
  min-height: calc(100vh - 168px);
  padding: clamp(32px, 5vw, 72px);
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 22px;
  background:
    radial-gradient(circle at 24% 48%, rgba(102, 227, 255, 0.12), transparent 24rem),
    radial-gradient(circle at 84% 18%, rgba(125, 140, 255, 0.1), transparent 28rem),
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.022)),
    rgba(8, 12, 22, 0.84);
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24);
}

.live-activity-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image:
    linear-gradient(rgba(102, 227, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(102, 227, 255, 0.035) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(circle at 28% 50%, #000 0%, transparent 68%);
}

.live-activity-visual,
.live-activity-copy {
  position: relative;
  z-index: 1;
}

.live-activity-visual {
  display: grid;
  place-items: center;
  width: min(27vw, 280px);
  aspect-ratio: 1;
  justify-self: center;
}

.activity-core {
  position: relative;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  border: 1px solid rgba(102, 227, 255, 0.52);
  border-radius: 28px;
  background: linear-gradient(145deg, rgba(102, 227, 255, 0.15), rgba(125, 140, 255, 0.1));
  color: #b8f3ff;
  box-shadow:
    0 0 0 12px rgba(102, 227, 255, 0.035),
    0 0 48px rgba(102, 227, 255, 0.2),
    inset 0 1px 0 rgba(255,255,255,0.1);
  animation: activityCoreFloat 2.8s ease-in-out infinite;
}

.activity-core-glow {
  position: absolute;
  inset: 16px;
  border-radius: 18px;
  border: 1px solid rgba(102, 227, 255, 0.32);
  animation: activityCorePulse 1.8s ease-in-out infinite;
}

.activity-orbit {
  position: absolute;
  inset: 12%;
  border: 1px solid rgba(102, 227, 255, 0.16);
  border-radius: 50%;
}

.activity-orbit::after {
  content: "";
  position: absolute;
  top: -5px;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #66e3ff;
  box-shadow: 0 0 18px rgba(102, 227, 255, 0.88);
}

.orbit-one { animation: activityOrbit 4.2s linear infinite; }
.orbit-two { inset: 24%; animation: activityOrbitReverse 3.2s linear infinite; border-color: rgba(67, 224, 166, 0.18); }
.orbit-two::after { background: #43e0a6; box-shadow: 0 0 18px rgba(67, 224, 166, 0.82); }
.orbit-three { inset: 5%; animation: activityOrbit 6.5s linear infinite; border-style: dashed; opacity: 0.6; }
.orbit-three::after { width: 6px; height: 6px; top: -3px; background: #9b8cff; box-shadow: 0 0 16px rgba(155, 140, 255, 0.85); }

.activity-scan {
  position: absolute;
  width: 76%;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(102, 227, 255, 0.9), transparent);
  filter: drop-shadow(0 0 8px rgba(102, 227, 255, 0.7));
  animation: activityScan 2.4s ease-in-out infinite;
}

.live-activity-copy {
  max-width: 720px;
}

.live-activity-topline {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #9decff;
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.live-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #43e0a6;
  box-shadow: 0 0 0 5px rgba(67, 224, 166, 0.08), 0 0 16px rgba(67, 224, 166, 0.72);
  animation: agentPulse 1.25s ease-in-out infinite;
}

.live-activity-message {
  min-height: 126px;
  padding-top: 18px;
}

.live-activity-message h1 {
  margin: 0;
  color: #f4f7fb;
  font-size: clamp(1.65rem, 3vw, 2.65rem);
  line-height: 1.12;
  letter-spacing: -0.035em;
}

.live-activity-message p {
  max-width: 650px;
  margin: 14px 0 0;
  color: #9ba9d8;
  font-size: 0.98rem;
  line-height: 1.7;
}

.live-activity-progress {
  display: grid;
  grid-template-columns: minmax(120px, 220px) auto;
  align-items: center;
  gap: 14px;
  color: #7f8db9;
  font-size: 0.78rem;
}

.activity-progress-track {
  position: relative;
  display: block;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(145, 166, 255, 0.13);
}

.activity-progress-runner {
  position: absolute;
  inset: 0 auto 0 -32%;
  width: 32%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, #66e3ff, #43e0a6, transparent);
  box-shadow: 0 0 14px rgba(102, 227, 255, 0.55);
  animation: activityProgress 1.8s ease-in-out infinite;
}

.live-activity-previous {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 22px;
  color: #86e9c2;
  font-size: 0.8rem;
}

.live-activity-previous.is-muted { color: #7f8db9; }

.activity-text-enter-active,
.activity-text-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}
.activity-text-enter-from { opacity: 0; transform: translateY(8px); }
.activity-text-leave-to { opacity: 0; transform: translateY(-6px); }

@keyframes activityCoreFloat {
  0%, 100% { transform: translateY(-3px); }
  50% { transform: translateY(5px); }
}
@keyframes activityCorePulse {
  0%, 100% { opacity: 0.45; transform: scale(0.94); }
  50% { opacity: 1; transform: scale(1.05); }
}
@keyframes activityOrbit { to { transform: rotate(360deg); } }
@keyframes activityOrbitReverse { to { transform: rotate(-360deg); } }
@keyframes activityScan {
  0%, 100% { transform: translateY(-72px); opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(72px); opacity: 0; }
}
@keyframes activityProgress {
  0% { left: -32%; }
  100% { left: 100%; }
}

@media (max-width: 900px) {
  .live-activity-panel {
    grid-template-columns: 1fr;
    align-content: center;
    text-align: center;
  }
  .live-activity-visual { width: min(58vw, 230px); }
  .live-activity-copy { justify-self: center; }
  .live-activity-topline,
  .live-activity-previous { justify-content: center; }
  .live-activity-progress { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .activity-core,
  .activity-core-glow,
  .activity-orbit,
  .activity-scan,
  .activity-progress-runner,
  .live-status-dot {
    animation: none !important;
  }
}
</style>

<style scoped>
/* ---------- Loading alignment and initial-surface color correction ---------- */

/*
  The legacy loader rule constrained the center state to 760px and added 28px
  around it. That padding made the loading card begin lower than both side
  columns and also forced unnecessary scrolling. Every center state now starts
  directly on the grid's shared top line.
*/
.workspace-column > .unified-loading-stage {
  display: block !important;
  align-self: start !important;
  width: 100% !important;
  max-width: none !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}

.workspace-column > .unified-loading-stage > .live-activity-panel {
  width: 100% !important;
  margin: 0 !important;
  align-self: start !important;
}

/* Keep the prompt-entry state on the same grid line with no hidden offset. */
.workspace-column > .input-stage {
  align-self: start !important;
  width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}

/*
  Use exactly the same surface recipe as the left and right application panels
  so the initial prompt card looks native to this page rather than like a
  separate component.
*/
.input-stage-card {
  border-color: rgba(145, 166, 255, 0.16) !important;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82) !important;
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24) !important;
}

/* Remove the slightly brighter nested surface that made the input state feel
   disconnected from the surrounding console panels. */
.input-stage-card .process-input {
  background:
    linear-gradient(180deg, rgba(10, 15, 28, 0.9), rgba(7, 11, 20, 0.94)) !important;
  border-color: rgba(145, 166, 255, 0.18) !important;
}

/* Explicit shared top baseline for all desktop columns and their first visual
   child. This protects alignment from older scoped rules above this block. */
@media (min-width: 981px) {
  .console-grid {
    align-items: start !important;
  }

  .console-grid > .agent-rail,
  .console-grid > .workspace-column,
  .console-grid > .side-panel,
  .workspace-column > :first-child {
    align-self: start !important;
    margin-top: 0 !important;
    top: auto !important;
    transform: none !important;
  }
}
</style>

<style scoped>
/* ---------- Agent identity, shared hover language, and node energy ---------- */
.agent-tile-topline {
  display: grid !important;
  grid-template-columns: 28px minmax(0, 1fr) 17px;
}

.agent-tile-icon {
  position: relative;
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 9px;
  background: rgba(125, 140, 255, 0.08);
  color: #aebaff;
}
.agent-tile-icon.tone-cyan { color: #66e3ff; background: rgba(102,227,255,.1); border-color: rgba(102,227,255,.28); }
.agent-tile-icon.tone-blue { color: #8fa2ff; background: rgba(125,140,255,.12); border-color: rgba(125,140,255,.3); }
.agent-tile-icon.tone-violet { color: #b397ff; background: rgba(179,151,255,.11); border-color: rgba(179,151,255,.28); }
.agent-tile-icon.tone-green { color: #43e0a6; background: rgba(67,224,166,.1); border-color: rgba(67,224,166,.28); }
.agent-tile-icon.tone-amber { color: #ffd166; background: rgba(255,209,102,.1); border-color: rgba(255,209,102,.3); }
.agent-tile-icon.tone-red { color: #ff7e7e; background: rgba(255,107,107,.1); border-color: rgba(255,107,107,.3); }

.agent-command-tile:hover,
.agent-command-tile:focus-visible {
  border-color: rgba(102, 227, 255, 0.82) !important;
  background:
    radial-gradient(circle at 80% 10%, rgba(102, 227, 255, 0.18), transparent 54%),
    linear-gradient(145deg, rgba(102, 227, 255, 0.1), rgba(8, 13, 24, 0.96)) !important;
  box-shadow:
    inset 0 0 0 1px rgba(102, 227, 255, 0.13),
    0 16px 38px rgba(0, 0, 0, 0.32),
    0 0 28px rgba(102, 227, 255, 0.2) !important;
}
.agent-command-tile:hover::before,
.agent-command-tile:focus-visible::before {
  opacity: 1;
  animation: agentTileHoverScan 900ms ease-out both;
}
@keyframes agentTileHoverScan {
  from { transform: translateX(-115%); }
  to { transform: translateX(115%); }
}

.activity-core.tone-cyan { color: #66e3ff; border-color: rgba(102,227,255,.5); }
.activity-core.tone-blue { color: #91a3ff; border-color: rgba(125,140,255,.5); }
.activity-core.tone-violet { color: #b397ff; border-color: rgba(179,151,255,.5); }
.activity-core.tone-green { color: #43e0a6; border-color: rgba(67,224,166,.5); }
.activity-core.tone-amber { color: #ffd166; border-color: rgba(255,209,102,.5); }
.activity-core.tone-red { color: #ff7e7e; border-color: rgba(255,107,107,.5); }
.live-agent-activity {
  display: block;
  margin-top: 10px;
  color: #91a0ca;
  font-size: 12px;
  line-height: 1.55;
}

.flow-node {
  overflow: visible !important;
}
.flow-node .node-body {
  position: relative;
  overflow: hidden;
  transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease, transform 180ms ease;
}
.flow-node .node-body::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: -35% auto -35% -55%;
  width: 42%;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(102,227,255,.2), rgba(255,255,255,.22), transparent);
  transform: skewX(-16deg);
  animation: nodeEnergySweep 6.4s ease-in-out infinite;
  animation-delay: calc(var(--flow-index) * 320ms);
}
.flow-node .node-body > * { position: relative; z-index: 1; }
.flow-node {
  animation: nodeEnergyGlow 6.4s ease-in-out infinite;
  animation-delay: calc(var(--flow-index) * 320ms);
}
@keyframes nodeEnergySweep {
  0%, 54%, 100% { left: -55%; opacity: 0; }
  58% { opacity: .9; }
  74% { left: 118%; opacity: .65; }
  78% { opacity: 0; }
}
@keyframes nodeEnergyGlow {
  0%, 54%, 82%, 100% { filter: none; }
  64% { filter: drop-shadow(0 0 12px rgba(102,227,255,.42)); }
}
.flow-node:hover .node-body,
.flow-node:focus-visible .node-body {
  transform: translateY(-2px);
  border-color: rgba(102,227,255,.88) !important;
  background:
    radial-gradient(circle at 82% 10%, rgba(102,227,255,.2), transparent 52%),
    rgba(13, 25, 39, .98) !important;
  box-shadow:
    inset 0 0 0 1px rgba(102,227,255,.15),
    0 14px 34px rgba(0,0,0,.3),
    0 0 28px rgba(102,227,255,.22) !important;
}
.flow-node:hover .node-body::before,
.flow-node:focus-visible .node-body::before {
  animation: nodeHoverSweep 850ms ease-out both !important;
  opacity: 1;
}
@keyframes nodeHoverSweep {
  from { left: -55%; opacity: 0; }
  25% { opacity: 1; }
  to { left: 118%; opacity: 0; }
}

/* The artifact card already explains and launches generation; remove spacing once the repeated heading is gone. */
.handoff-card { padding-top: 0 !important; }
.handoff-card > .n8n-artifact-launcher:first-child { margin-top: 0 !important; }

@media (prefers-reduced-motion: reduce) {
  .flow-node,
  .flow-node .node-body::before,
  .agent-command-tile::before { animation: none !important; }
}


/* ---------- Synchronized blueprint flow refinement ----------
   Keep the sequential whole-card pulse and connector movement, but remove the
   autonomous internal light ray. The ray is reserved for direct hover/focus. */
.flow-node .node-body::before {
  opacity: 0 !important;
  animation: none !important;
}

.flow-node:hover .node-body::before,
.flow-node:focus-visible .node-body::before {
  opacity: 1 !important;
  animation: nodeHoverSweep 850ms ease-out both !important;
}

/* A single ordered pulse travels across the node cards. */
.flow-node {
  animation: synchronizedNodePulse 6.2s ease-in-out infinite !important;
  animation-delay: calc(var(--flow-index) * 420ms) !important;
}

@keyframes synchronizedNodePulse {
  0%, 50%, 76%, 100% {
    filter: none;
  }
  58% {
    filter:
      drop-shadow(0 0 7px rgba(102, 227, 255, 0.28))
      drop-shadow(0 0 15px rgba(102, 227, 255, 0.16));
  }
  64% {
    filter:
      drop-shadow(0 0 11px rgba(102, 227, 255, 0.5))
      drop-shadow(0 0 24px rgba(67, 224, 166, 0.22));
  }
  70% {
    filter: drop-shadow(0 0 7px rgba(102, 227, 255, 0.24));
  }
}

/* Restore and emphasize the directional energy travelling between nodes. */
.flow-node:not(:last-child)::after {
  opacity: 1 !important;
  background:
    linear-gradient(
      90deg,
      transparent 0%,
      rgba(102, 227, 255, 0.1) 22%,
      rgba(102, 227, 255, 0.96) 46%,
      rgba(67, 224, 166, 0.92) 54%,
      rgba(102, 227, 255, 0.14) 76%,
      transparent 100%
    ) !important;
  background-size: 240% 100% !important;
  animation: synchronizedConnectorFlow 2.35s linear infinite !important;
  filter: drop-shadow(0 0 6px rgba(102, 227, 255, 0.72));
}

@keyframes synchronizedConnectorFlow {
  from { background-position: 220% 0; }
  to { background-position: -20% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .flow-node,
  .flow-node:not(:last-child)::after {
    animation: none !important;
  }
}

</style>

<style scoped>
/* ---------- Final input-surface and n8n cable corrections ---------- */

/* Match the initial center card to the exact application-panel surface. */
.input-stage-card {
  border: 1px solid rgba(145, 166, 255, 0.16) !important;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82) !important;
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24) !important;
}

/* Keep the field darker, but inside the same blue-black palette. */
.input-stage-card .process-input {
  background:
    linear-gradient(180deg, rgba(7, 11, 21, 0.96), rgba(6, 10, 19, 0.98)) !important;
  border-color: rgba(145, 166, 255, 0.18) !important;
}

/* Stable cable underlay between cards. */
.flow-node:not(:last-child)::before {
  content: "" !important;
  position: absolute !important;
  z-index: 0 !important;
  top: 50% !important;
  left: 100% !important;
  width: var(--connector-gap) !important;
  height: 3px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: rgba(102, 227, 255, 0.2) !important;
  box-shadow:
    0 0 0 1px rgba(102, 227, 255, 0.05),
    0 0 10px rgba(102, 227, 255, 0.2) !important;
  transform: translateY(-50%) !important;
}

/* Visible n8n-style packet travelling from one node to the next. */
.flow-node:not(:last-child)::after {
  content: "" !important;
  position: absolute !important;
  z-index: 2 !important;
  top: 50% !important;
  left: 100% !important;
  width: var(--connector-gap) !important;
  height: 4px !important;
  border-radius: 999px !important;
  opacity: 1 !important;
  background:
    linear-gradient(
      90deg,
      transparent 0%,
      transparent 30%,
      rgba(102, 227, 255, 0.35) 38%,
      #b9f6ff 47%,
      #66e3ff 52%,
      #43e0a6 58%,
      rgba(67, 224, 166, 0.2) 68%,
      transparent 78%,
      transparent 100%
    ) !important;
  background-size: 300% 100% !important;
  filter:
    drop-shadow(0 0 4px rgba(185, 246, 255, 0.95))
    drop-shadow(0 0 9px rgba(102, 227, 255, 0.7)) !important;
  transform: translateY(-50%) !important;
  animation: n8nCablePacket 1.65s linear infinite !important;
  pointer-events: none !important;
}

@keyframes n8nCablePacket {
  from { background-position: 150% 0; }
  to { background-position: -150% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .flow-node:not(:last-child)::after {
    animation: none !important;
    background-position: 50% 0 !important;
  }
}
</style>


<style scoped>
/* ---------- Smooth blueprint flow + unified header controls ---------- */

/* Use one continuous, overlapping wave instead of stepped node flashes. */
.flow-node {
  animation: smoothNodeFlow 3.4s cubic-bezier(.45, 0, .55, 1) infinite !important;
  animation-delay: calc(var(--flow-index) * 115ms) !important;
  will-change: filter, transform;
}

@keyframes smoothNodeFlow {
  0%, 100% {
    filter: none;
    transform: translateY(0);
  }
  28% {
    filter: drop-shadow(0 0 4px rgba(102, 227, 255, .12));
  }
  42% {
    filter:
      drop-shadow(0 0 8px rgba(102, 227, 255, .34))
      drop-shadow(0 0 16px rgba(67, 224, 166, .12));
    transform: translateY(-1px);
  }
  58% {
    filter: drop-shadow(0 0 5px rgba(102, 227, 255, .18));
    transform: translateY(0);
  }
}

/* Keep the connector constantly alive with a fast, soft n8n-style packet. */
.flow-node:not(:last-child)::after {
  animation: smoothCableFlow 1.05s linear infinite !important;
  background-size: 360% 100% !important;
  opacity: .92 !important;
  filter:
    drop-shadow(0 0 3px rgba(185, 246, 255, .78))
    drop-shadow(0 0 7px rgba(102, 227, 255, .5)) !important;
}

@keyframes smoothCableFlow {
  from { background-position: 165% 0; }
  to { background-position: -165% 0; }
}

/* Keep the internal ray only for intentional hover/focus. */
.flow-node .node-body::before {
  animation: none !important;
  opacity: 0 !important;
}
.flow-node:hover .node-body::before,
.flow-node:focus-visible .node-body::before {
  animation: nodeHoverSweep 700ms ease-out both !important;
  opacity: 1 !important;
}

/* One visual system for all top-right controls. */
.app-header-right {
  gap: 8px !important;
}

.app-header .studio-link,
.app-header .status-pill,
.app-header .mode-menu-trigger {
  height: 36px !important;
  min-height: 36px !important;
  border: 1px solid #263247 !important;
  border-radius: 8px !important;
  background: #131c2b !important;
  box-shadow: none !important;
  color: #f4f7fb !important;
}

.app-header .studio-link {
  padding: 0 11px !important;
  font-size: .84rem !important;
}

.app-header .status-pill {
  min-width: auto !important;
  padding: 0 11px !important;
  justify-content: center !important;
  font-size: .82rem !important;
}

.app-header .mode-menu-wrap {
  width: auto !important;
  min-width: 116px;
}

.app-header .mode-menu-trigger {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 7px !important;
  width: 100% !important;
  padding: 0 10px !important;
  text-align: left !important;
}

.mode-menu-label {
  color: #7f8ba1;
  font-size: .72rem;
  font-weight: 700;
}

.app-header .mode-menu-trigger strong {
  margin: 0 !important;
  color: #f4f7fb !important;
  font-size: .84rem !important;
  line-height: 1 !important;
}

.app-header .mode-menu-trigger small,
.app-header .mode-menu-kicker {
  display: none !important;
}

.app-header .mode-chevron {
  margin-left: auto;
  color: #7f8ba1 !important;
  font-size: 14px !important;
}

.app-header .studio-link:hover,
.app-header .mode-menu-trigger:hover,
.app-header .mode-menu-trigger.open {
  border-color: #3a4963 !important;
  background: #182235 !important;
}

/* Status keeps its semantic color without becoming a mismatched pill. */
.app-header .status-pill.tone-success { color: #6ce7b2 !important; }
.app-header .status-pill.tone-warning { color: #ffd166 !important; }
.app-header .status-pill.tone-danger { color: #ff8b96 !important; }
.app-header .status-pill.tone-active { color: #77e8ff !important; }

@media (prefers-reduced-motion: reduce) {
  .flow-node,
  .flow-node:not(:last-child)::after {
    animation: none !important;
  }
}

@media (max-width: 760px) {
  .mode-menu-label { display: none; }
  .app-header .mode-menu-wrap { min-width: 82px; }
}
</style>

<style scoped>
/* ---------- Exact shared panel surface + compiler-matched n8n modal ---------- */

/* The initial center state now uses the literal side-panel surface values. */
.input-stage-card {
  border: 1px solid #263247 !important;
  background: #0f1623 !important;
  box-shadow: none !important;
}

.input-stage-card::before,
.input-stage-card::after {
  display: none !important;
}

.input-stage-card .process-input {
  border-color: #263247 !important;
  background: #090d16 !important;
}

.input-stage-card .process-input:focus {
  border-color: rgba(102, 227, 255, 0.72) !important;
  box-shadow: 0 0 0 3px rgba(102, 227, 255, 0.1) !important;
}

/* Make the artifact dialog use the same shell as the compiler dialogs. */
.n8n-modal-backdrop {
  background: rgba(2, 5, 12, 0.82) !important;
  backdrop-filter: blur(14px) !important;
}

.n8n-artifact-modal {
  width: min(820px, 100%) !important;
  border: 1px solid #36445d !important;
  border-radius: 18px !important;
  background: linear-gradient(180deg, #141e2e 0%, #0f1623 100%) !important;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(102, 227, 255, 0.05) !important;
}

.n8n-modal-header,
.n8n-modal-footer {
  border-color: #263247 !important;
  background: rgba(15, 22, 35, 0.92) !important;
}

.n8n-modal-icon {
  border: 1px solid rgba(102, 227, 255, 0.24) !important;
  background: rgba(102, 227, 255, 0.09) !important;
  color: #66e3ff !important;
}

.matched-n8n-loading {
  min-height: 500px;
  padding: 48px 42px !important;
  display: flex !important;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background:
    radial-gradient(circle at 50% 34%, rgba(102, 227, 255, 0.08), transparent 34%),
    transparent !important;
}

.n8n-activity-visual {
  position: relative;
  display: grid;
  place-items: center;
  width: 132px;
  height: 132px;
  margin-bottom: 28px;
}

.n8n-activity-core {
  position: relative;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border: 1px solid rgba(102, 227, 255, 0.52);
  border-radius: 22px;
  background:
    radial-gradient(circle at 35% 25%, rgba(255,255,255,.11), transparent 42%),
    rgba(7, 17, 29, 0.96);
  color: #66e3ff;
  box-shadow:
    inset 0 0 24px rgba(102, 227, 255, 0.08),
    0 0 26px rgba(102, 227, 255, 0.2);
  animation: n8nCoreBreathe 2.2s ease-in-out infinite;
}

.n8n-activity-orbit {
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 50%;
}

.n8n-activity-orbit::after {
  content: "";
  position: absolute;
  top: -4px;
  left: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #43e0a6;
  box-shadow: 0 0 16px rgba(67, 224, 166, 0.9);
}

.n8n-activity-orbit.orbit-one { animation: n8nOrbit 2.1s linear infinite; }
.n8n-activity-orbit.orbit-two {
  inset: 20px;
  border-style: dashed;
  border-color: rgba(102, 227, 255, 0.18);
  animation: n8nOrbitReverse 3.1s linear infinite;
}
.n8n-activity-orbit.orbit-two::after {
  width: 6px;
  height: 6px;
  background: #8fa2ff;
  box-shadow: 0 0 14px rgba(143, 162, 255, 0.8);
}

.n8n-activity-scan {
  position: absolute;
  z-index: 3;
  width: 104px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(102,227,255,.85), transparent);
  box-shadow: 0 0 12px rgba(102,227,255,.55);
  animation: n8nScan 1.65s ease-in-out infinite;
}

.n8n-loading-copy { max-width: 540px; }
.n8n-loading-copy h3 {
  margin: 9px 0 0 !important;
  color: #f4f7fb !important;
  font-size: 1.55rem !important;
  line-height: 1.3;
}
.n8n-live-step {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 24px;
  margin: 16px 0 0 !important;
  color: #a7b1c2 !important;
  font-size: .92rem !important;
}
.n8n-live-step svg { color: #66e3ff; }

.n8n-loading-track {
  position: relative;
  width: min(380px, 82%);
  height: 4px;
  margin-top: 28px;
  overflow: hidden;
  border-radius: 999px;
  background: #263247;
}
.n8n-loading-runner {
  position: absolute;
  inset: 0 auto 0 -35%;
  width: 35%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, #66e3ff, #43e0a6, transparent);
  box-shadow: 0 0 12px rgba(102,227,255,.55);
  animation: n8nTrackRun 1.15s linear infinite;
}

.n8n-loading-checklist {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
  max-width: 620px;
  margin-top: 20px;
}
.n8n-loading-checklist > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #263247;
  border-radius: 8px;
  background: rgba(9, 13, 22, 0.62);
  padding: 6px 9px;
  color: #6f7b8e;
  font-size: .75rem;
}
.n8n-loading-checklist > span.active {
  border-color: rgba(102,227,255,.34);
  color: #c8f6ff;
  background: rgba(102,227,255,.08);
}
.n8n-loading-checklist > span.complete { color: #73eab5; }
.n8n-check-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.matched-safety-note {
  margin-top: 24px !important;
  border: 1px solid rgba(67,224,166,.18) !important;
  border-radius: 10px !important;
  background: rgba(67,224,166,.055) !important;
  color: #91a0b5 !important;
}

@keyframes n8nOrbit { to { transform: rotate(360deg); } }
@keyframes n8nOrbitReverse { to { transform: rotate(-360deg); } }
@keyframes n8nCoreBreathe {
  0%,100% { transform: scale(1); box-shadow: inset 0 0 24px rgba(102,227,255,.08), 0 0 22px rgba(102,227,255,.16); }
  50% { transform: scale(1.035); box-shadow: inset 0 0 30px rgba(102,227,255,.12), 0 0 34px rgba(102,227,255,.27); }
}
@keyframes n8nScan {
  0%,100% { transform: translateY(-42px); opacity: .15; }
  50% { transform: translateY(42px); opacity: 1; }
}
@keyframes n8nTrackRun { to { left: 105%; } }

@media (max-width: 640px) {
  .matched-n8n-loading { min-height: 430px; padding: 36px 20px !important; }
  .n8n-loading-copy h3 { font-size: 1.3rem !important; }
  .n8n-loading-checklist { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .n8n-activity-core,
  .n8n-activity-orbit,
  .n8n-activity-scan,
  .n8n-loading-runner { animation: none !important; }
}
</style>


<style scoped>
/* ---------- Final two-column compiler layout ---------- */

/* The left status rail was redundant with the richer Agents inspector. */
.console-grid {
  grid-template-columns: minmax(0, 1fr) clamp(320px, 23vw, 400px) !important;
  align-items: start !important;
  gap: 16px !important;
}

.console-grid > .workspace-column {
  grid-column: 1 !important;
  min-width: 0;
  width: 100%;
}

.console-grid > .side-panel {
  grid-column: 2 !important;
  min-width: 0;
  width: 100%;
}

/* Remove any space or sizing left behind by historical three-column rules. */
.agent-rail {
  display: none !important;
}

@media (max-width: 980px) {
  .console-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .console-grid > .workspace-column,
  .console-grid > .side-panel {
    grid-column: 1 !important;
  }

  .console-grid > .workspace-column {
    order: 1 !important;
  }

  .console-grid > .side-panel {
    order: 2 !important;
  }
}
</style>