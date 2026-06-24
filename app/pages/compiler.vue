<script setup lang="ts">
import type { Component } from "vue";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  FileText,
  GitBranch,
  HelpCircle,
  Inbox,
  LayoutGrid,
  Lock,
  MessageSquare,
  PencilLine,
  Route as RouteIcon,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Workflow as WorkflowIcon,
  X,
  XCircle,
  ChevronUp,
  Info,
} from "lucide-vue-next";

import type {
  AgentDebugInfo,
  AgentProviderDebugAttempt,
} from "../../shared/types/agentOutputs";
import type {
  CompileJob,
  CompileMode,
  RouterDecision,
  SafetyCriticFinding,
  SafetyCriticSeverity,
} from "../../shared/types/compileJob";
import type {
  ClarificationSession,
  ClarificationSessionAnswer,
  ClarificationSessionResponse,
} from "../../shared/types/clarificationSession";
import type {
  HumanApprovalGate,
  RiskItem,
  RiskLevel,
  StepAutomationPolicy,
  WorkflowPrimitive,
  WorkflowStep,
} from "../../shared/types/workflow";

useHead({
  title: "FlowForge — Safe Automation Compiler",
  meta: [
    {
      name: "description",
      content: "Compile a safe, non-executing automation preview with FlowForge.",
    },
  ],
});

type CompileRunState = "idle" | "running" | "finishing" | "complete" | "failed";
type DetailView = "critic" | "workflow" | "router" | "risks" | "tests" | "implementation" | "trace" | null;

type CompileStage = {
  id: string;
  label: string;
  description: string;
  durationMs: number;
  demoDescription?: string;
  aiDescription?: string;
};

type ExampleProcess = {
  label: string;
  tone: string;
  value: string;
};

type DetailTab = {
  id: NonNullable<DetailView>;
  label: string;
  icon: Component;
  badge?: string;
};

type ProviderAttemptDisplay = {
  provider: string;
  status: string;
  detail: string;
};

type TextDisplayItem = {
  label: string;
  value: string;
};

type AiAgentCard = {
  id: "clarification_agent" | "blueprint_architect_agent" | "safety_critic_agent";
  label: string;
  provider: string;
  usedAi: boolean;
  status: string;
  confidence: string;
  summary: string;
  reason: string;
  metrics: TextDisplayItem[];
  acceptedOutput: unknown;
  debug?: AgentDebugInfo;
  debugAvailable: boolean;
};

const examples: ExampleProcess[] = [
  {
    label: "Internal intake",
    tone: "Low risk",
    value:
      "Every morning, collect new job application emails from the admissions inbox, extract the candidate name, role, portfolio link, and application source, classify the application priority, and create an internal review task for the admissions team without sending any external messages.",
  },
  {
    label: "Refund review",
    tone: "Needs approval",
    value:
      "When a customer says they were charged twice, classify the complaint, extract the order ID and payment amount, draft a refund response, and route the case to finance for approval before any refund or message is sent.",
  },
  {
    label: "Visa guidance",
    tone: "Sensitive",
    value:
      "When a student asks if they can legally work in Germany on their visa, draft a cautious internal note, summarize the question, and route it to an advisor for review before anyone replies.",
  },
  {
    label: "Unsafe auto-send",
    tone: "Will be blocked",
    value:
      "When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.",
  },
  {
    label: "Too vague",
    tone: "Needs clarification",
    value: "Automate my customer messages.",
  },
];

const modes: Array<{ label: string; value: CompileMode; description: string }> = [
  { label: "Demo", value: "demo", description: "All deterministic, no AI calls" },
  { label: "Rule", value: "rule_only", description: "Rule-based routing only" },
  { label: "Balanced", value: "balanced", description: "AI router + deterministic safety" },
  { label: "Full", value: "full", description: "Full AI agent pipeline" },
];

const compileStages: CompileStage[] = [
  { id: "prepare", label: "Prepare", durationMs: 650, description: "Creating compile job" },
  { id: "signals", label: "Signals", durationMs: 750, description: "Scanning for triggers and primitives" },
  { id: "risks", label: "Risk", durationMs: 800, description: "Checking sensitive data and execution risk" },
  { id: "router", label: "Route", durationMs: 800, description: "Choosing the right path" },
  {
    id: "provider",
    label: "Provider",
    durationMs: 900,
    description: "Selecting agent strategy",
    demoDescription: "Deterministic fallbacks — no AI calls.",
    aiDescription: "Trying Groq first, Gemini available as fallback.",
  },
  { id: "blueprint", label: "Blueprint", durationMs: 850, description: "Building the safe workflow preview" },
  { id: "critic", label: "Critic", durationMs: 700, description: "Running Safety Critic review" },
  { id: "validate", label: "Validate", durationMs: 650, description: "Validating final schema" },
];

const FINAL_STAGE_HOLD_MS = 500;
const PREVIEW_TEXT_LIMIT = 160;
const routerRoleCopy = "AI agents can route, clarify, propose a blueprint, and critique risks. They do not execute anything.";
const deterministicBoundaryCopy = "Deterministic tools still validate the schema, build the safe preview, and make the final Safety Guard decision.";
const routerPromptContextSummary =
  "The router receives the submitted process, deterministic signal scan, risk summary, readiness score, and selected mode.";
const routerOutputBoundaryCopy =
  "FlowForge validates agent JSON before using it. Agents can propose and critique, but deterministic guardrails decide final safety.";

const processInput = ref("");
const mode = ref<CompileMode>("full");
const showModeInfo = ref(false);
const job = ref<CompileJob | null>(null);
const pendingJob = ref<CompileJob | null>(null);
const isCompiling = ref(false);
const activeCompileStageIndex = ref(0);
const compileRunState = ref<CompileRunState>("idle");
const compileReplayFinished = ref(false);
const errorMessage = ref("");
const inputGuardMessage = ref("");
const activeDetail = ref<DetailView>(null);
const activeAgentDetailsId = ref<AiAgentCard["id"] | null>(null);
const showAgentStrip = ref(false);
const clarificationSession = ref<ClarificationSession | null>(null);
const clarificationOriginalInput = ref("");
const clarificationConversationAnswers = ref<ClarificationSessionAnswer[]>([]);
const clarificationAnswerDraft = ref("");
const isClarifying = ref(false);
const clarificationAnswers = ref<Record<string, string>>({});
const activeClarificationQuestionIndex = ref(0);

let compileRunToken = 0;
const compileReplayTimers = new Set<number>();

const expandedSteps = ref<Record<string, boolean>>({});
const expandedRisks = ref<Record<string, boolean>>({});
const expandedGates = ref<Record<string, boolean>>({});

const activeExample = computed(() => examples.find((example) => example.value === processInput.value) ?? null);
const trimmedProcessInput = computed(() => processInput.value.trim());
const hasProcessInput = computed(() => trimmedProcessInput.value.length > 0);
const guidedClarificationQuestion = computed(() => clarificationSession.value?.next_question ?? null);
const guidedClarificationProgress = computed(() => clarificationConversationAnswers.value.length + 1);
const compiledBlueprint = computed(() => job.value?.result ?? null);
const clarificationPlan = computed(() => job.value?.clarification_plan ?? null);
const safetyCritic = computed(() => job.value?.safety_critic ?? null);
const routerDecision = computed(() => job.value?.router_decision ?? null);
const gateCount = computed(() => compiledBlueprint.value?.human_approval_gates.length ?? 0);
const riskLevel = computed<RiskLevel>(() => job.value?.risks?.risk_level ?? "medium");
const visibleWorkflowSteps = computed(() => compiledBlueprint.value?.steps ?? []);
const visibleRisks = computed(() => compiledBlueprint.value?.risks ?? []);
const visibleGates = computed(() => compiledBlueprint.value?.human_approval_gates ?? []);
const technicalPipelineSteps = computed(() => job.value?.steps ?? []);
const technicalTokenUsage = computed(() => job.value?.token_usage ?? null);
const technicalAgentTrace = computed(() => job.value?.agent_trace ?? []);
const llmCallsUsed = computed(() => job.value?.token_usage.llm_calls_used ?? 0);
const clarificationAgent = computed(() => job.value?.clarification_agent ?? null);
const blueprintArchitectAgent = computed(() => job.value?.blueprint_architect_agent ?? null);
const safetyCriticAgent = computed(() => job.value?.safety_critic_agent ?? null);

const aiAgentCards = computed<AiAgentCard[]>(() => {
  if (!job.value) return [];

  const clarification = clarificationAgent.value;
  const blueprintArchitect = blueprintArchitectAgent.value;
  const criticAgent = safetyCriticAgent.value;

  return [
    {
      id: "clarification_agent",
      label: "Clarification",
      provider: clarification?.provider ?? "deterministic",
      usedAi: clarification?.used_ai ?? false,
      status: clarification?.status ?? "skipped",
      confidence: clarification?.confidence ?? "low",
      summary: clarification
        ? clarification.used_ai
          ? `Improved ${clarification.questions.length} clarification question(s).`
          : clarification.reason
        : "No output.",
      reason: clarification?.reason ?? "No clarification agent output yet.",
      metrics: [
        { label: "Questions", value: String(clarification?.questions.length ?? 0) },
        { label: "Mode", value: job.value.mode },
      ],
      acceptedOutput: clarification,
      debug: job.value.agent_debug?.clarification_agent,
      debugAvailable: Boolean(job.value.agent_debug?.clarification_agent),
    },
    {
      id: "blueprint_architect_agent",
      label: "Blueprint Architect",
      provider: blueprintArchitect?.provider ?? "deterministic",
      usedAi: blueprintArchitect?.used_ai ?? false,
      status: blueprintArchitect?.status ?? "skipped",
      confidence: blueprintArchitect?.confidence ?? "low",
      summary: blueprintArchitect
        ? blueprintArchitect.used_ai
          ? `Proposed ${blueprintArchitect.proposed_steps.length} step(s) and ${blueprintArchitect.proposed_human_approval_gates.length} gate(s).`
          : blueprintArchitect.reason
        : "No output.",
      reason: blueprintArchitect?.reason ?? "No blueprint architect output yet.",
      metrics: [
        { label: "Steps", value: String(blueprintArchitect?.proposed_steps.length ?? 0) },
        { label: "Gates", value: String(blueprintArchitect?.proposed_human_approval_gates.length ?? 0) },
      ],
      acceptedOutput: blueprintArchitect,
      debug: job.value.agent_debug?.blueprint_architect_agent,
      debugAvailable: Boolean(job.value.agent_debug?.blueprint_architect_agent),
    },
    {
      id: "safety_critic_agent",
      label: "Safety Critic",
      provider: criticAgent?.provider ?? "deterministic",
      usedAi: criticAgent?.used_ai ?? false,
      status: criticAgent?.status ?? "skipped",
      confidence: criticAgent?.confidence ?? "low",
      summary: criticAgent
        ? criticAgent.used_ai
          ? `Found ${criticAgent.concerns.length} critique concern(s).`
          : criticAgent.reason
        : "No output.",
      reason: criticAgent?.reason ?? "No safety critic agent output yet.",
      metrics: [
        { label: "Concerns", value: String(criticAgent?.concerns.length ?? 0) },
        { label: "Final authority", value: "Safety Guard" },
      ],
      acceptedOutput: criticAgent,
      debug: job.value.agent_debug?.safety_critic_agent,
      debugAvailable: Boolean(job.value.agent_debug?.safety_critic_agent),
    },
  ];
});

const activeAgentDetails = computed(() => {
  if (!activeAgentDetailsId.value) return null;
  return aiAgentCards.value.find((agent) => agent.id === activeAgentDetailsId.value) ?? null;
});

const activeAgentDetailsJson = computed(() => {
  if (!activeAgentDetails.value?.acceptedOutput) return "{}";
  return stringifyDebugValue(activeAgentDetails.value.acceptedOutput);
});

const activeAgentDebug = computed(() => activeAgentDetails.value?.debug ?? null);

const activeAgentDebugFinalOutputJson = computed(() => {
  if (!activeAgentDebug.value?.final_output) return activeAgentDetailsJson.value;
  return stringifyDebugValue(activeAgentDebug.value.final_output);
});

const activeAgentProviderAttempts = computed<AgentProviderDebugAttempt[]>(() => {
  return activeAgentDebug.value?.provider_attempts ?? [];
});

const successfulProviderAttempt = computed(() => {
  return activeAgentProviderAttempts.value.find((attempt) => attempt.success && attempt.raw_response)
    ?? activeAgentProviderAttempts.value.find((attempt) => attempt.raw_response)
    ?? null;
});

const activeAgentRawResponse = computed(() => {
  return successfulProviderAttempt.value?.raw_response
    ?? "No raw provider response available. The agent may have been skipped, used a deterministic path, or failed before returning content.";
});

const activeAgentParsedResponse = computed(() => {
  if (successfulProviderAttempt.value?.parsed_response === undefined) {
    return "No parsed response available for this agent.";
  }
  return stringifyDebugValue(successfulProviderAttempt.value.parsed_response);
});

const compileRunComplete = computed(() => compileRunState.value === "complete" && Boolean(job.value));
const activeCompileMode = computed<CompileMode>(() => (isCompiling.value ? mode.value : job.value?.mode ?? mode.value));
const currentCompileStage = computed<CompileStage>(() => compileStages[activeCompileStageIndex.value] ?? compileStages[0] as CompileStage);
const currentCompileStageDescription = computed(() => getStageDescription(currentCompileStage.value, activeCompileMode.value));
const compileProgressPercent = computed(() => {
  if (compileRunComplete.value) return "100%";
  const finalIndex = compileStages.length - 1;
  return `${Math.round((activeCompileStageIndex.value / finalIndex) * 100)}%`;
});

const selectedInputLabel = computed(() => activeExample.value?.label ?? "Custom process");
const inputHelperCopy = computed(() => {
  if (inputGuardMessage.value) return inputGuardMessage.value;
  if (activeExample.value) return `"${activeExample.value.label}" loaded. Edit or compile directly.`;
  return "Choose an example or describe your process in plain language.";
});

const isClarificationNeeded = computed(() => {
  return safetyCritic.value?.overall_status === "needs_clarification"
    || clarificationPlan.value?.needed === true;
});

const resultMode = computed<"clarify" | "flow" | "blocked">(() => {
  const criticStatus = safetyCritic.value?.overall_status;
  if (criticStatus === "not_safe_to_automate" || routerDecision.value?.route === "reject") return "blocked";
  if (criticStatus === "needs_clarification" || clarificationPlan.value?.needed === true) return "clarify";
  return "flow";
});

const activeClarificationQuestion = computed(() => {
  return clarificationPlan.value?.questions[activeClarificationQuestionIndex.value] ?? null;
});

const activeClarificationAnswer = computed(() => {
  const question = activeClarificationQuestion.value;
  if (!question) return "";
  return clarificationAnswers.value[question.field] ?? "";
});

const answeredClarificationCount = computed(() => {
  const questions = clarificationPlan.value?.questions ?? [];
  return questions.filter((question) => textValue(clarificationAnswers.value[question.field]).length > 0).length;
});

const clarificationQuestionCount = computed(() => clarificationPlan.value?.questions.length ?? 0);

const clarificationAllAnswered = computed(() => {
  return clarificationQuestionCount.value > 0 && answeredClarificationCount.value >= clarificationQuestionCount.value;
});

const compileRunStateLabel = computed(() => {
  if (compileRunState.value === "running" && compileReplayFinished.value && !pendingJob.value) return "Waiting";
  return sentenceLabel(compileRunState.value);
});

const compileRunTitle = computed(() => {
  if (compileRunState.value === "running") return "Building safe preview…";
  if (compileRunState.value === "finishing") return "Finalizing";
  if (compileRunState.value === "failed") return "Compile failed";
  if (compileRunState.value === "complete") return "Preview ready";
  return "Compile run";
});

const outcomeTitle = computed(() => {
  if (!compiledBlueprint.value) return "";
  if (resultMode.value === "clarify") return "Needs more detail";
  if (resultMode.value === "blocked") return "Not safe to automate";
  if (safetyCritic.value?.overall_status === "needs_human_approval") return "Needs human approval";
  if (safetyCritic.value?.overall_status === "safe_internal_preview") return "Safe internal preview";
  if (gateCount.value > 0) return "Safe with approval gates";
  return "Safe preview ready";
});

const outcomeIcon = computed<Component>(() => {
  if (resultMode.value === "clarify") return HelpCircle;
  if (resultMode.value === "blocked") return XCircle;
  if (safetyCritic.value?.overall_status === "safe_internal_preview") return ShieldCheck;
  if (gateCount.value > 0 || riskLevel.value === "high") return UserCheck;
  return ShieldCheck;
});

const outcomeColorClass = computed(() => {
  if (resultMode.value === "blocked") return "verdict-blocked";
  if (resultMode.value === "clarify") return "verdict-clarify";
  if (safetyCritic.value?.overall_status === "needs_human_approval" || gateCount.value > 0) return "verdict-approval";
  return "verdict-safe";
});

const primaryDecision = computed(() => {
  if (safetyCritic.value?.overall_status) return sentenceLabel(safetyCritic.value.overall_status);
  if (resultMode.value === "clarify") return "Needs clarification";
  if (resultMode.value === "blocked") return "Blocked";
  if (gateCount.value > 0) return "Human approval";
  return "Internal preview";
});

const plainEnglishResult = computed(() => {
  if (!compiledBlueprint.value) return "";
  if (safetyCritic.value?.summary) return safetyCritic.value.summary;
  if (resultMode.value === "clarify") return "FlowForge needs a clearer trigger, input source, output, owner, or approval boundary before creating an implementation-ready flow.";
  if (resultMode.value === "blocked") return "This process includes automatic actions that cannot be safely automated. Keep it as human-reviewed guidance only.";
  return `FlowForge built a safe, non-executing preview that can ${capabilityText.value}.`;
});

const nextSafeAction = computed(() => {
  if (safetyCritic.value?.next_safe_action) return safetyCritic.value.next_safe_action;
  if (resultMode.value === "clarify") return "Answer the missing details, then compile again.";
  if (resultMode.value === "blocked") return "Remove automatic send, update, payment, or destructive actions — or route them through a human.";
  if (gateCount.value > 0) return "Review the approval gates before connecting to real systems.";
  return "Review the flow below, then inspect details only if needed.";
});

const criticTitle = computed(() => {
  const status = safetyCritic.value?.overall_status;
  if (status === "safe_internal_preview") return "Safe as preview";
  if (status === "needs_human_approval") return "Human gate required";
  if (status === "needs_clarification") return "Needs clarification first";
  if (status === "not_safe_to_automate") return "Not safe to automate";
  return "Safety review";
});

const criticExplanation =
  "The Safety Critic checks the final blueprint deterministically. It decides what can be automated, what stays draft-only, what needs a human gate, and what is blocked entirely. No AI is involved in this decision.";

const criticTopFinding = computed<SafetyCriticFinding | null>(() => {
  const findings = safetyCritic.value?.findings ?? [];
  return findings.find((finding) => finding.severity === "blocker")
    ?? findings.find((finding) => finding.severity === "warning")
    ?? findings[0]
    ?? null;
});

const criticCounts = computed(() => {
  const critic = safetyCritic.value;
  return [
    { label: "Safe", value: String(critic?.safe_to_automate.length ?? 0), colorClass: "count-safe" },
    { label: "Draft only", value: String(critic?.must_remain_draft_only.length ?? 0), colorClass: "count-draft" },
    { label: "Needs approval", value: String(critic?.requires_human_approval.length ?? 0), colorClass: "count-approval" },
    { label: "Blocked", value: String(critic?.blocked_or_not_recommended.length ?? 0), colorClass: "count-blocked" },
  ];
});

const detailTabs = computed<DetailTab[]>(() => [
  { id: "critic", label: "Safety review", icon: ShieldCheck, badge: safetyCritic.value?.overall_status ? sentenceLabel(safetyCritic.value.overall_status) : undefined },
  { id: "workflow", label: "Workflow steps", icon: WorkflowIcon, badge: `${visibleWorkflowSteps.value.length}` },
  { id: "risks", label: "Risks & gates", icon: ShieldAlert, badge: `${visibleGates.value.length} gates` },
  { id: "tests", label: "Dry runs", icon: ClipboardCheck, badge: `${compiledBlueprint.value?.test_cases.length ?? 0}` },
  { id: "router", label: "Router & providers", icon: Bot, badge: routerDecision.value?.provider ? providerLabel(routerDecision.value.provider) : undefined },
  { id: "implementation", label: "Before building", icon: FileText, badge: `${compiledBlueprint.value?.open_questions.length ?? 0} questions` },
  { id: "trace", label: "Pipeline trace", icon: LayoutGrid, badge: `${technicalPipelineSteps.value.length} steps` },
]);

const capabilityText = computed(() => {
  const capabilities = new Set<string>();
  for (const step of visibleWorkflowSteps.value) {
    if (step.id === "intake_process" || step.id === "build_non_executing_preview") continue;
    if (step.primitive === "classification") capabilities.add("classify");
    if (step.primitive === "risk_detection") capabilities.add("check risk");
    if (step.primitive === "routing" || step.primitive === "escalation") capabilities.add("route");
    if (step.primitive === "drafting") capabilities.add("draft");
    if (step.primitive === "notification") capabilities.add("prepare notifications");
    if (step.primitive === "record_creation") capabilities.add("prepare internal tasks");
    if (step.primitive === "extraction") capabilities.add("extract fields");
    if (step.primitive === "summarization") capabilities.add("summarize");
    if (step.primitive === "reporting") capabilities.add("report");
  }
  const list = [...capabilities];
  if (list.length === 0) return "inspect the process and create a safe preview";
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(list);
});

const routerInputItems = computed<TextDisplayItem[]>(() => {
  if (!job.value) return [];
  return [
    { label: "Submitted process", value: job.value.input.trimmed },
    { label: "Detected primitives", value: formatList(job.value.signals.workflow_primitives) },
    { label: "Risk summary", value: buildRiskSummaryInput(job.value) },
    { label: "Readiness score", value: buildReadinessInput(job.value) },
    { label: "Mode", value: job.value.mode },
  ];
});

const routerOutputItems = computed<TextDisplayItem[]>(() => {
  const decision = routerDecision.value;
  if (!decision) return [];
  return [
    { label: "Route", value: routeLabel(decision.route) },
    { label: "Confidence", value: confidenceLabel(decision.confidence) },
    { label: "Reason", value: decision.reason },
    { label: "Safety note", value: decision.safety_note },
    { label: "Suggested next step", value: decision.suggested_next_step },
    { label: "Provider", value: providerLabel(decision.provider) },
    { label: "AI used", value: yesNo(decision.used_ai) },
    { label: "Fallback used", value: yesNo(decision.fallback_used) },
    { label: "LLM calls", value: `${llmCallsUsed.value} / ${job.value?.token_usage.llm_calls_limit ?? 0}` },
  ];
});

const providerAttemptItems = computed<ProviderAttemptDisplay[]>(() => {
  const currentJob = job.value;
  const decision = routerDecision.value;
  if (!currentJob || !decision) return [];
  return [
    providerAttemptStatus(currentJob, "groq"),
    providerAttemptStatus(currentJob, "gemini"),
    deterministicAttemptStatus(currentJob, decision),
  ];
});

// ── Helpers ────────────────────────────────────────────────────────────────

function riskToneClass(level: RiskLevel): string {
  if (level === "high") return "tone-blocked";
  if (level === "medium") return "tone-approval";
  return "tone-safe";
}

function severityToneClass(severity: SafetyCriticSeverity): string {
  if (severity === "blocker") return "tone-blocked";
  if (severity === "warning") return "tone-approval";
  return "tone-safe";
}

function policyToneClass(policy: StepAutomationPolicy): string {
  if (policy === "automate") return "tone-safe";
  if (policy === "human_approval") return "tone-approval";
  if (policy === "blocked_in_mvp" || policy === "not_recommended") return "tone-blocked";
  return "tone-draft";
}

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
  if (provider === "groq") return "Groq";
  if (provider === "gemini") return "Gemini";
  if (provider === "deterministic") return "Deterministic";
  return "Pending";
}

function routeLabel(route?: RouterDecision["route"]): string {
  return route ? sentenceLabel(route) : "Pending";
}

function confidenceLabel(confidence?: RouterDecision["confidence"]): string {
  return confidence ? sentenceLabel(confidence) : "Pending";
}

function policyLabel(policy: StepAutomationPolicy): string {
  const labels: Record<StepAutomationPolicy, string> = {
    automate: "Automatable",
    draft_only: "Draft only",
    assist_only: "Assist only",
    human_approval: "Human approval",
    not_recommended: "Not recommended",
    blocked_in_mvp: "Blocked",
  };
  return labels[policy] ?? formatEnum(policy);
}

function stepIcon(step: WorkflowStep): Component {
  if (step.automation_policy === "blocked_in_mvp" || step.automation_policy === "not_recommended") return XCircle;
  if (step.approval_required || step.automation_policy === "human_approval") return UserCheck;
  if (step.primitive === "risk_detection" && step.risk_level === "high") return ShieldAlert;
  const primitiveIcons: Record<WorkflowPrimitive, Component> = {
    intake: Inbox,
    classification: GitBranch,
    extraction: ScanSearch,
    risk_detection: ShieldCheck,
    routing: RouteIcon,
    drafting: PencilLine,
    approval: UserCheck,
    validation: CheckCircle2,
    notification: MessageSquare,
    record_creation: ClipboardCheck,
    monitoring: ScanSearch,
    escalation: UserCheck,
    summarization: FileText,
    reporting: FileText,
    export: FileText,
  };
  return primitiveIcons[step.primitive] ?? WorkflowIcon;
}

function workflowStepColorClass(step: WorkflowStep): string {
  if (step.automation_policy === "blocked_in_mvp" || step.automation_policy === "not_recommended") return "step-blocked";
  if (step.approval_required || step.automation_policy === "human_approval") return "step-approval";
  if (step.risk_level === "high") return "step-risky";
  return "step-safe";
}

function formatList(items: readonly string[], emptyLabel = "None detected"): string {
  if (items.length === 0) return emptyLabel;
  return items.join(", ");
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function buildRiskSummaryInput(currentJob: CompileJob): string {
  const categories = currentJob.risks.categories.map(formatEnum);
  const categorySummary = categories.length > 0 ? `Categories: ${formatList(categories)}` : "No detected risk categories";
  return `${sentenceLabel(currentJob.risks.risk_level)} risk. ${categorySummary}.`;
}

function buildReadinessInput(currentJob: CompileJob): string {
  const reasons = [
    ...currentJob.readiness.strengths.slice(0, 2),
    ...currentJob.readiness.weaknesses.slice(0, 2),
  ];
  if (reasons.length === 0) return `${currentJob.readiness.score}/100`;
  return `${currentJob.readiness.score}/100. ${formatList(reasons)}`;
}

function textValue(value?: string | null): string {
  return value?.trim() ?? "";
}

function previewText(value?: string | null, limit = PREVIEW_TEXT_LIMIT): string {
  const text = textValue(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function stringifyDebugValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function usesAiRouter(selectedMode: CompileMode): boolean {
  return selectedMode === "balanced" || selectedMode === "full";
}

function getStageDescription(stage: CompileStage, selectedMode: CompileMode): string {
  if (stage.id === "provider") {
    return usesAiRouter(selectedMode) ? stage.aiDescription ?? stage.description : stage.demoDescription ?? stage.description;
  }
  return stage.description;
}

function providerAttemptClass(status: string): string {
  if (status === "Completed" || status === "Used") return "tone-safe";
  if (status === "Failed") return "tone-blocked";
  return "tone-draft";
}

function providerAttemptStatus(currentJob: CompileJob, provider: "groq" | "gemini"): ProviderAttemptDisplay {
  const traceEvent = currentJob.agent_trace.find((event) => event.action === `Router attempt: ${provider}`);
  const providerName = providerLabel(provider);

  if (!traceEvent) {
    return {
      provider: providerName,
      status: "Not used",
      detail: provider === "groq" ? "Primary router provider was not reached." : "A validated Groq decision was available.",
    };
  }

  if (traceEvent.status === "completed") {
    return {
      provider: providerName,
      status: "Completed",
      detail: provider === "groq" ? "Primary router provider returned a valid decision." : "Fallback router provider returned a valid decision.",
    };
  }

  if (traceEvent.status === "failed") {
    return {
      provider: providerName,
      status: "Failed",
      detail: traceEvent.reason ?? "Provider attempt failed or returned invalid output.",
    };
  }

  return {
    provider: providerName,
    status: "Skipped",
    detail: traceEvent.reason ?? "Provider key missing or provider not needed.",
  };
}

function deterministicAttemptStatus(currentJob: CompileJob, decision: RouterDecision): ProviderAttemptDisplay {
  const traceEvent = currentJob.agent_trace.find((event) => event.action === "Router attempt: deterministic");
  if (decision.provider === "deterministic" || traceEvent?.status === "completed") {
    return {
      provider: "Deterministic",
      status: "Used",
      detail: decision.fallback_used ? "Fallback rules selected the route." : "Deterministic routing was selected by mode.",
    };
  }
  return {
    provider: "Deterministic",
    status: "Not used",
    detail: "A validated AI router decision was available.",
  };
}

function compileStageState(index: number): "pending" | "active" | "complete" {
  if (compileRunComplete.value) return "complete";
  if (index < activeCompileStageIndex.value) return "complete";
  if (index === activeCompileStageIndex.value && compileRunState.value !== "idle") return "active";
  return "pending";
}

function clearCompileReplayTimers(): void {
  for (const timer of compileReplayTimers) window.clearTimeout(timer);
  compileReplayTimers.clear();
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

async function runCompileReplay(runToken: number): Promise<void> {
  compileReplayFinished.value = false;
  for (let index = 0; index < compileStages.length; index += 1) {
    if (runToken !== compileRunToken || compileRunState.value === "failed") return;
    activeCompileStageIndex.value = index;
    await sleep(compileStages[index]?.durationMs ?? 750);
  }
  if (runToken === compileRunToken && compileRunState.value !== "failed") {
    compileReplayFinished.value = true;
  }
}

function chooseExample(value: string): void {
  processInput.value = value;
  inputGuardMessage.value = "";
}

function isSelectedExample(value: string): boolean {
  return processInput.value === value;
}

function applyStarter(): void {
  const starter = clarificationPlan.value?.improved_prompt_starter || clarificationPlan.value?.suggested_template;
  if (!starter) return;
  processInput.value = starter;
  inputGuardMessage.value = "Starter applied. Edit if needed, then compile again.";
}

function copyStarter(): void {
  const starter = clarificationPlan.value?.improved_prompt_starter || clarificationPlan.value?.suggested_template;
  if (!starter) return;
  window.navigator.clipboard.writeText(starter).catch(() => {});
}

function clearInputGuardMessage(): void {
  inputGuardMessage.value = "";
}

function resetDetails(): void {
  activeDetail.value = null;
  showAgentStrip.value = false;
  expandedSteps.value = {};
  expandedRisks.value = {};
  expandedGates.value = {};
}

function openDetail(view: DetailView): void {
  activeDetail.value = view && activeDetail.value === view ? null : view;
}

function openAgentDetails(agentId: AiAgentCard["id"]): void {
  activeAgentDetailsId.value = agentId;
}

function closeAgentDetails(): void {
  activeAgentDetailsId.value = null;
}

function toggleStep(stepId: string): void {
  expandedSteps.value = { ...expandedSteps.value, [stepId]: !expandedSteps.value[stepId] };
}

function toggleRisk(riskId: string): void {
  expandedRisks.value = { ...expandedRisks.value, [riskId]: !expandedRisks.value[riskId] };
}

function toggleGate(gateId: string): void {
  expandedGates.value = { ...expandedGates.value, [gateId]: !expandedGates.value[gateId] };
}

function isStepExpanded(step: WorkflowStep): boolean {
  return expandedSteps.value[step.id] === true;
}

function isRiskExpanded(risk: RiskItem): boolean {
  return expandedRisks.value[risk.id] === true;
}

async function requestClarificationTurn(): Promise<void> {
  errorMessage.value = "";
  inputGuardMessage.value = "";
  isClarifying.value = true;

  try {
    const response = await $fetch<ClarificationSessionResponse>("/api/clarify", {
      method: "POST",
      body: {
        original_input: clarificationOriginalInput.value,
        answers: clarificationConversationAnswers.value,
      },
    });

    clarificationSession.value = response.session;

    if (response.session.ready_to_compile) {
      const compilePrompt = response.session.rewritten_compile_prompt || response.session.original_input;
      clarificationSession.value = null;
      clarificationAnswerDraft.value = "";
      processInput.value = compilePrompt;
      await compilePreview();
      return;
    }

    clarificationAnswerDraft.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : "Clarification failed. Please try again.";
  } finally {
    isClarifying.value = false;
  }
}

async function startGuidedCompile(): Promise<void> {
  inputGuardMessage.value = "";
  errorMessage.value = "";

  if (!hasProcessInput.value) {
    inputGuardMessage.value = "Add a process description or choose an example first.";
    return;
  }

  job.value = null;
  pendingJob.value = null;
  activeDetail.value = null;
  showAgentStrip.value = false;
  clarificationOriginalInput.value = trimmedProcessInput.value;
  clarificationConversationAnswers.value = [];
  clarificationSession.value = null;
  clarificationAnswerDraft.value = "";

  await requestClarificationTurn();
}

async function submitGuidedClarificationAnswer(): Promise<void> {
  const question = guidedClarificationQuestion.value;
  const answer = clarificationAnswerDraft.value.trim();

  if (!question) return;

  if (!answer) {
    inputGuardMessage.value = "Answer the question first.";
    return;
  }

  clarificationConversationAnswers.value = [
    ...clarificationConversationAnswers.value,
    {
      question_id: question.id,
      question: question.question,
      answer,
    },
  ];

  await requestClarificationTurn();
}

function cancelGuidedClarification(): void {
  clarificationSession.value = null;
  clarificationConversationAnswers.value = [];
  clarificationAnswerDraft.value = "";
  inputGuardMessage.value = "";
}

function updateClarificationAnswer(event: Event): void {
  const question = activeClarificationQuestion.value;
  const target = event.target as HTMLTextAreaElement | null;
  if (!question || !target) return;
  clarificationAnswers.value = {
    ...clarificationAnswers.value,
    [question.field]: target.value,
  };
}

function goToPreviousClarificationQuestion(): void {
  activeClarificationQuestionIndex.value = Math.max(0, activeClarificationQuestionIndex.value - 1);
}

function goToNextClarificationQuestion(): void {
  const question = activeClarificationQuestion.value;
  if (question && textValue(clarificationAnswers.value[question.field]).length === 0) {
    inputGuardMessage.value = "Answer this question first.";
    return;
  }

  inputGuardMessage.value = "";
  activeClarificationQuestionIndex.value = Math.min(
    Math.max(0, clarificationQuestionCount.value - 1),
    activeClarificationQuestionIndex.value + 1,
  );
}

async function compileWithClarifications(): Promise<void> {
  const plan = clarificationPlan.value;
  if (!plan) return;

  if (!clarificationAllAnswered.value) {
    inputGuardMessage.value = "Answer the missing details before compiling again.";
    return;
  }

  const answers = plan.questions
    .map((question, index) => `${index + 1}. ${question.question}\nAnswer: ${textValue(clarificationAnswers.value[question.field])}`)
    .join("\n\n");

  processInput.value = `${trimmedProcessInput.value}\n\nAdditional clarification details:\n${answers}`;
  inputGuardMessage.value = "";
  activeClarificationQuestionIndex.value = 0;
  await compilePreview();
}

function restartCompile(): void {
  job.value = null;
  pendingJob.value = null;
  activeAgentDetailsId.value = null;
  compileRunState.value = "idle";
  isCompiling.value = false;
  clarificationSession.value = null;
  clarificationConversationAnswers.value = [];
  clarificationAnswerDraft.value = "";
  clarificationOriginalInput.value = "";
  clarificationAnswers.value = {};
  activeClarificationQuestionIndex.value = 0;
  resetDetails();
}

async function compilePreview(): Promise<void> {
  inputGuardMessage.value = "";
  errorMessage.value = "";

  if (!hasProcessInput.value) {
    inputGuardMessage.value = "Add a process description or choose an example first.";
    return;
  }

  const runToken = compileRunToken + 1;
  compileRunToken = runToken;
  clearCompileReplayTimers();

  job.value = null;
  pendingJob.value = null;
  resetDetails();

  isCompiling.value = true;
  compileRunState.value = "running";
  activeCompileStageIndex.value = 0;
  compileReplayFinished.value = false;

  const requestPromise = $fetch<CompileJob>("/api/compile", {
    method: "POST",
    body: {
      input: trimmedProcessInput.value,
      mode: mode.value,
    },
  }).then((result) => {
    if (runToken === compileRunToken) pendingJob.value = result;
    return result;
  });

  try {
    const [result] = await Promise.all([requestPromise, runCompileReplay(runToken)]);
    if (runToken !== compileRunToken) return;

    pendingJob.value = result;
    compileRunState.value = "finishing";
    activeCompileStageIndex.value = compileStages.length - 1;

    await sleep(FINAL_STAGE_HOLD_MS);
    if (runToken !== compileRunToken) return;

    job.value = result;
    pendingJob.value = null;
    compileRunState.value = "complete";
  } catch (error) {
    if (runToken === compileRunToken) {
      clearCompileReplayTimers();
      pendingJob.value = null;
      compileRunState.value = "failed";
      errorMessage.value = error instanceof Error ? error.message : "Compile preview failed.";
    }
  } finally {
    if (runToken === compileRunToken) isCompiling.value = false;
  }
}

onBeforeUnmount(() => {
  compileRunToken += 1;
  clearCompileReplayTimers();
});
</script>

<template>
  <main class="ff-page">
    <div class="ff-shell">
      <header class="ff-topbar">
        <div class="ff-brand">
          <span class="ff-brand-mark" aria-hidden="true">
            <WorkflowIcon class="ff-icon-md" />
          </span>
          <div>
            <p class="ff-kicker">FlowForge</p>
            <h1>AI-guided automation blueprint</h1>
          </div>
        </div>

        <span class="ff-safe-pill">
          <Lock class="ff-icon-xs" />
          Preview only
        </span>
      </header>

      <!-- 1. Guided input -->
      <section v-if="!job && !isCompiling && !clarificationSession" class="ff-start-screen">
        <div class="ff-hero-panel">
          <p class="ff-kicker">Step 1</p>
          <h2>Describe the workflow. FlowForge will guide the rest.</h2>
          <p>
            You are not chatting with an assistant. You are sending a process through a safety compiler.
            If the process is clear, you get a blueprint. If something is missing, FlowForge asks one question at a time.
          </p>
        </div>

        <section class="ff-input-panel">
          <div class="ff-input-header">
            <div>
              <p class="ff-kicker">Workflow input</p>
              <h3>{{ selectedInputLabel }}</h3>
            </div>
            <span :class="['ff-chip', hasProcessInput ? 'chip-ready' : 'chip-empty']">
              {{ hasProcessInput ? "Ready to scan" : "Waiting" }}
            </span>
          </div>

          <textarea
            v-model="processInput"
            class="ff-process-input"
            placeholder="Example: When a new internal support ticket arrives, classify it, extract important fields, prepare a response draft, and route risky cases to a human before anything is sent."
            rows="8"
            @input="clearInputGuardMessage"
          />

          <p :class="['ff-helper', { 'is-warning': inputGuardMessage }]">{{ inputHelperCopy }}</p>

          <div class="ff-preset-row">
            <button
              v-for="example in examples"
              :key="example.label"
              type="button"
              :class="['ff-preset-chip', { 'is-active': isSelectedExample(example.value) }]"
              @click="chooseExample(example.value)"
            >
              <span>{{ example.label }}</span>
              <small>{{ example.tone }}</small>
            </button>
          </div>

          <details class="ff-advanced">
            <summary>Advanced compile mode</summary>
            <div class="ff-mode-grid">
              <label
                v-for="item in modes"
                :key="item.value"
                :class="['ff-mode', { 'is-active': mode === item.value }]"
              >
                <input v-model="mode" type="radio" name="mode" :value="item.value" class="ff-sr-only" />
                <span>{{ item.label }}</span>
                <small>{{ item.description }}</small>
              </label>
            </div>
          </details>

          <button class="ff-primary-btn" type="button" :disabled="!hasProcessInput" @click="startGuidedCompile">
            {{ isClarifying ? "Clarifying…" : "Start guided compile" }}
            <ArrowRight class="ff-icon-sm" />
          </button>
        </section>
      </section>


      <!-- 1b. AI-guided clarification conversation -->
      <section v-if="clarificationSession && !job && !isCompiling" class="ff-guided-question">
        <div class="ff-question-shell">
          <p class="ff-kicker">Guided clarification · Question {{ guidedClarificationProgress }}</p>
          <h2>{{ clarificationSession.current_summary }}</h2>
          <p class="ff-muted">
            FlowForge is collecting only the next detail needed to build a useful blueprint.
          </p>

          <article v-if="guidedClarificationQuestion" class="ff-question-card">
            <span class="ff-question-field">{{ formatEnum(guidedClarificationQuestion.kind) }}</span>
            <h3>{{ guidedClarificationQuestion.question }}</h3>
            <p>{{ guidedClarificationQuestion.why_it_matters }}</p>
            <small v-if="guidedClarificationQuestion.example_answer">
              Example: {{ guidedClarificationQuestion.example_answer }}
            </small>

            <textarea
              v-model="clarificationAnswerDraft"
              class="ff-answer-input"
              rows="4"
              placeholder="Answer in your own words…"
              @input="clearInputGuardMessage"
            />
          </article>

          <p :class="['ff-helper', { 'is-warning': inputGuardMessage }]">{{ inputGuardMessage || "The agent will use your answer to decide the next question or compile the workflow." }}</p>

          <div v-if="clarificationConversationAnswers.length > 0" class="ff-answer-history">
            <p class="ff-kicker">Already collected</p>
            <article v-for="answer in clarificationConversationAnswers" :key="answer.question_id">
              <strong>{{ answer.question }}</strong>
              <p>{{ answer.answer }}</p>
            </article>
          </div>

          <div class="ff-question-actions">
            <button class="ff-secondary-btn" type="button" :disabled="isClarifying" @click="cancelGuidedClarification">
              Edit original input
            </button>

            <button class="ff-primary-btn" type="button" :disabled="isClarifying" @click="submitGuidedClarificationAnswer">
              {{ isClarifying ? "Thinking…" : "Continue" }}
              <ChevronRight class="ff-icon-sm" />
            </button>
          </div>
        </div>
      </section>

      <!-- 2. Focused compile sequence -->
      <section v-if="isCompiling" class="ff-scan-screen">
        <div class="ff-scan-panel">
          <p class="ff-kicker">Step 2 · Compile running</p>
          <h2>{{ currentCompileStage.label }}</h2>
          <p>{{ currentCompileStageDescription }}</p>

          <div class="ff-scan-rail">
            <div
              v-for="(stage, index) in compileStages"
              :key="stage.id"
              :class="['ff-scan-node', `state-${compileStageState(index)}`]"
            >
              <span />
              <strong>{{ stage.label }}</strong>
            </div>
          </div>

          <div class="ff-progress-track">
            <div class="ff-progress-fill" :style="{ width: compileProgressPercent }" />
          </div>
        </div>
      </section>

      <section v-if="errorMessage" class="ff-error-panel">
        <XCircle class="ff-icon-md" />
        <div>
          <p class="ff-kicker">Compile error</p>
          <p>{{ errorMessage }}</p>
        </div>
      </section>

      <!-- 3. Result: either one question, one workflow, or one blocked verdict -->
      <section v-if="job && compiledBlueprint && !isCompiling" class="ff-result-screen">
        <!-- Clarification: one question at a time -->
        <section v-if="resultMode === 'clarify' && clarificationPlan" class="ff-guided-question">
          <div class="ff-question-shell">
            <p class="ff-kicker">Step 3 · Missing information</p>
            <h2>FlowForge needs one detail before building the blueprint.</h2>
            <p class="ff-muted">
              Question {{ activeClarificationQuestionIndex + 1 }} of {{ clarificationQuestionCount }}.
              Answer it, then continue.
            </p>

            <article v-if="activeClarificationQuestion" class="ff-question-card">
              <span class="ff-question-field">{{ formatEnum(activeClarificationQuestion.field) }}</span>
              <h3>{{ activeClarificationQuestion.question }}</h3>
              <p>{{ activeClarificationQuestion.why_it_matters }}</p>
              <small v-if="activeClarificationQuestion.example_answer">
                Example: {{ activeClarificationQuestion.example_answer }}
              </small>

              <textarea
                class="ff-answer-input"
                rows="4"
                :value="activeClarificationAnswer"
                placeholder="Type the missing detail here…"
                @input="updateClarificationAnswer"
              />
            </article>

            <div class="ff-question-actions">
              <button
                class="ff-secondary-btn"
                type="button"
                :disabled="activeClarificationQuestionIndex === 0"
                @click="goToPreviousClarificationQuestion"
              >
                Back
              </button>

              <button
                v-if="!clarificationAllAnswered"
                class="ff-primary-btn"
                type="button"
                @click="goToNextClarificationQuestion"
              >
                Next question
                <ChevronRight class="ff-icon-sm" />
              </button>

              <button
                v-else
                class="ff-primary-btn"
                type="button"
                @click="compileWithClarifications"
              >
                Compile with answers
                <Sparkles class="ff-icon-sm" />
              </button>
            </div>

            <button class="ff-text-btn" type="button" @click="openDetail('trace')">
              Show technical details
            </button>
          </div>
        </section>

        <!-- Blocked: clear outcome only -->
        <section v-else-if="resultMode === 'blocked'" class="ff-blocked-screen">
          <div class="ff-blocked-card">
            <span class="ff-verdict-icon danger">
              <XCircle class="ff-icon-lg" />
            </span>
            <p class="ff-kicker">Step 3 · Safety verdict</p>
            <h2>Not safe to automate as described</h2>
            <p>{{ plainEnglishResult }}</p>

            <div class="ff-next-move">
              <p class="ff-kicker">Next safe move</p>
              <strong>{{ nextSafeAction }}</strong>
            </div>

            <div class="ff-result-actions">
              <button class="ff-secondary-btn" type="button" @click="openDetail('risks')">
                See why
              </button>
              <button class="ff-primary-btn" type="button" @click="restartCompile">
                Revise workflow
              </button>
            </div>
          </div>
        </section>

        <!-- Workflow: show the workflow first, not the report -->
        <section v-else class="ff-workflow-screen">
          <div class="ff-workflow-header">
            <div>
              <p class="ff-kicker">Step 3 · Blueprint ready</p>
              <h2>{{ compiledBlueprint.workflow_name }}</h2>
              <p>Preview-only workflow. Nothing is sent, changed, refunded, deleted, or executed.</p>
            </div>

            <div class="ff-compact-verdict">
              <span :class="['ff-chip', riskToneClass(riskLevel)]">{{ riskLevel }} risk</span>
              <span v-if="gateCount > 0" class="ff-chip chip-approval">{{ gateCount }} gates</span>
              <span class="ff-chip chip-safe">Execution off</span>
            </div>
          </div>

          <ol class="ff-node-canvas">
            <li
              v-for="(step, index) in visibleWorkflowSteps"
              :key="step.id"
              :class="['ff-node', workflowStepColorClass(step)]"
            >
              <div class="ff-node-port">
                <span>{{ index + 1 }}</span>
              </div>

              <div class="ff-node-card">
                <div class="ff-node-head">
                  <component :is="stepIcon(step)" class="ff-icon-sm" />
                  <strong>{{ step.label }}</strong>
                </div>
                <p>{{ step.description }}</p>
                <div class="ff-node-tags">
                  <span :class="['ff-tag', policyToneClass(step.automation_policy)]">
                    {{ policyLabel(step.automation_policy) }}
                  </span>
                  <span v-if="step.approval_required" class="ff-tag tone-approval">Human gate</span>
                </div>
              </div>
            </li>
          </ol>

          <div class="ff-workflow-actions">
            <button class="ff-secondary-btn" type="button" @click="showAgentStrip = !showAgentStrip">
              {{ showAgentStrip ? "Hide" : "Show" }} agent workbench
            </button>
            <button v-if="!activeDetail" class="ff-secondary-btn" type="button" @click="openDetail('critic')">
              Open details
            </button>
            <button v-else class="ff-secondary-btn" type="button" @click="openDetail(null)">
              Hide details
            </button>
            <button class="ff-primary-btn" type="button" @click="restartCompile">
              New compile
            </button>
          </div>
        </section>

        <!-- Agent workbench, hidden by default -->
        <section v-if="showAgentStrip" class="ff-agent-workbench">
          <div class="ff-section-head">
            <div>
              <p class="ff-kicker">Agent workbench</p>
              <h3>How the blueprint was produced</h3>
            </div>
            <span class="ff-chip chip-neutral">{{ llmCallsUsed }} AI calls</span>
          </div>

          <div class="ff-agent-grid">
            <article v-for="agent in aiAgentCards" :key="agent.id" class="ff-agent-card">
              <div class="ff-agent-top">
                <span>{{ sentenceLabel(agent.provider) }}</span>
                <span :class="['ff-agent-state', agent.usedAi ? 'is-ai' : agent.status === 'skipped' ? 'is-skipped' : 'is-fallback']">
                  {{ agent.usedAi ? 'AI active' : agent.status === 'skipped' ? 'Skipped' : 'Fallback' }}
                </span>
              </div>
              <h4>{{ agent.label }}</h4>
              <p>{{ agent.summary }}</p>
              <button class="ff-mini-btn" type="button" @click="openAgentDetails(agent.id)">
                {{ agent.debugAvailable ? "Open debug" : "View output" }}
              </button>
            </article>
          </div>
        </section>

        <!-- Details, hidden by default -->
        <section v-if="activeDetail" class="ff-details-panel">
          <div class="ff-details-nav">
            <button
              v-for="tab in detailTabs"
              :key="tab.id"
              type="button"
              :class="['ff-detail-tab', { 'is-active': activeDetail === tab.id }]"
              @click="openDetail(tab.id)"
            >
              <component :is="tab.icon" class="ff-icon-xs" />
              {{ tab.label }}
            </button>
            <button class="ff-detail-tab close" type="button" @click="activeDetail = null">
              Close
            </button>
          </div>

          <div class="ff-detail-content">
            <div v-if="activeDetail === 'critic' && safetyCritic" class="ff-detail-stack">
              <article v-for="finding in safetyCritic.findings" :key="finding.id" class="ff-detail-card">
                <span :class="['ff-tag', severityToneClass(finding.severity)]">{{ finding.severity }}</span>
                <h4>{{ finding.title }}</h4>
                <p>{{ finding.explanation }}</p>
                <p><b>Recommendation:</b> {{ finding.recommendation }}</p>
              </article>
            </div>

            <div v-else-if="activeDetail === 'workflow'" class="ff-detail-stack">
              <article v-for="step in visibleWorkflowSteps" :key="step.id" class="ff-detail-card">
                <button class="ff-expand-btn" type="button" @click="toggleStep(step.id)">
                  <span>
                    <strong>{{ step.label }}</strong>
                    <small>{{ policyLabel(step.automation_policy) }} · {{ step.risk_level }} risk</small>
                  </span>
                  <component :is="isStepExpanded(step) ? ChevronUp : ChevronDown" class="ff-icon-xs" />
                </button>

                <dl v-if="isStepExpanded(step)" class="ff-meta-grid">
                  <div><dt>Primitive</dt><dd>{{ formatEnum(step.primitive) }}</dd></div>
                  <div><dt>Actor</dt><dd>{{ formatEnum(step.actor) }}</dd></div>
                  <div><dt>Execution</dt><dd>{{ formatEnum(step.real_world_execution) }}</dd></div>
                  <div><dt>Input</dt><dd>{{ step.input }}</dd></div>
                  <div><dt>Output</dt><dd>{{ step.output }}</dd></div>
                  <div><dt>Approval</dt><dd>{{ yesNo(step.approval_required) }}</dd></div>
                </dl>
              </article>
            </div>

            <div v-else-if="activeDetail === 'risks'" class="ff-detail-grid">
              <article class="ff-detail-card">
                <h4>Human approval gates</h4>
                <p v-if="visibleGates.length === 0">No gate-worthy risk detected.</p>
                <div v-for="gate in visibleGates" :key="gate.id" class="ff-mini-section">
                  <strong>{{ gate.label }}</strong>
                  <p>{{ gate.reason }}</p>
                </div>
              </article>

              <article class="ff-detail-card">
                <h4>Risk reasons</h4>
                <p v-if="visibleRisks.length === 0">No obvious risk flags detected.</p>
                <div v-for="risk in visibleRisks" :key="risk.id" class="ff-mini-section">
                  <strong>{{ risk.label }}</strong>
                  <span :class="['ff-tag', riskToneClass(risk.risk_level)]">{{ risk.risk_level }}</span>
                  <p>{{ risk.reason }}</p>
                </div>
              </article>
            </div>

            <div v-else-if="activeDetail === 'router'" class="ff-detail-grid">
              <article class="ff-detail-card">
                <h4>AI role</h4>
                <p>{{ routerRoleCopy }}</p>
                <p>{{ deterministicBoundaryCopy }}</p>
              </article>

              <article class="ff-detail-card">
                <h4>Provider path</h4>
                <div v-for="item in providerAttemptItems" :key="item.provider" class="ff-mini-section">
                  <strong>{{ item.provider }}</strong>
                  <span :class="['ff-tag', providerAttemptClass(item.status)]">{{ item.status }}</span>
                  <p>{{ item.detail }}</p>
                </div>
              </article>
            </div>

            <div v-else-if="activeDetail === 'tests'" class="ff-detail-grid">
              <article v-for="testCase in compiledBlueprint.test_cases" :key="testCase.id" class="ff-detail-card">
                <span :class="['ff-tag', testCase.expected_human_gate ? 'tone-approval' : 'tone-safe']">
                  {{ testCase.expected_human_gate ? 'Human gate' : 'No gate' }}
                </span>
                <h4>{{ testCase.name }}</h4>
                <p><b>Input:</b> {{ testCase.input_event }}</p>
                <p><b>Expected:</b> {{ formatEnum(testCase.expected_route) }}</p>
                <p>{{ testCase.reason }}</p>
              </article>
            </div>

            <div v-else-if="activeDetail === 'implementation'" class="ff-detail-grid">
              <article class="ff-detail-card">
                <h4>Assumptions</h4>
                <ul>
                  <li v-for="assumption in compiledBlueprint.assumptions" :key="assumption">{{ assumption }}</li>
                </ul>
              </article>
              <article class="ff-detail-card">
                <h4>Open questions</h4>
                <ul>
                  <li v-for="question in compiledBlueprint.open_questions" :key="question">{{ question }}</li>
                </ul>
              </article>
            </div>

            <div v-else-if="activeDetail === 'trace'" class="ff-detail-grid">
              <article class="ff-detail-card">
                <h4>Pipeline steps</h4>
                <div v-for="step in technicalPipelineSteps" :key="step.id" class="ff-mini-section">
                  <strong>{{ step.label }}</strong>
                  <p>{{ previewText(step.output_summary) }}</p>
                </div>
              </article>

              <article class="ff-detail-card">
                <h4>Token usage</h4>
                <p v-if="technicalTokenUsage">
                  Mode: {{ technicalTokenUsage.mode }} · LLM calls:
                  {{ technicalTokenUsage.llm_calls_used }} / {{ technicalTokenUsage.llm_calls_limit }}
                </p>
              </article>
            </div>
          </div>
        </section>

        <!-- Agent debug modal -->
        <Teleport to="body">
          <div v-if="activeAgentDetails" class="ff-modal-backdrop" @click.self="closeAgentDetails">
            <section class="ff-modal" role="dialog" aria-modal="true" :aria-label="`${activeAgentDetails.label} agent details`">
              <header class="ff-modal-header">
                <div>
                  <p class="ff-kicker">Agent inspector</p>
                  <h2>{{ activeAgentDetails.label }}</h2>
                </div>
                <button class="ff-modal-close" type="button" aria-label="Close" @click="closeAgentDetails">
                  <X class="ff-icon-sm" />
                </button>
              </header>

              <div class="ff-modal-body">
                <div class="ff-modal-stats">
                  <div><span>Provider</span><strong>{{ sentenceLabel(activeAgentDetails.provider) }}</strong></div>
                  <div><span>AI used</span><strong>{{ yesNo(activeAgentDetails.usedAi) }}</strong></div>
                  <div><span>Status</span><strong>{{ sentenceLabel(activeAgentDetails.status) }}</strong></div>
                  <div><span>Confidence</span><strong>{{ sentenceLabel(activeAgentDetails.confidence) }}</strong></div>
                  <div><span>LLM calls</span><strong>{{ activeAgentDebug?.llm_calls_made ?? 0 }}</strong></div>
                  <div v-for="metric in activeAgentDetails.metrics" :key="`modal-${metric.label}`">
                    <span>{{ metric.label }}</span>
                    <strong>{{ metric.value }}</strong>
                  </div>
                </div>

                <section class="ff-modal-section">
                  <h3>Outcome</h3>
                  <p>{{ activeAgentDetails.summary }}</p>
                  <p v-if="activeAgentDetails.reason">{{ activeAgentDetails.reason }}</p>
                </section>

                <section class="ff-modal-section">
                  <h3>Provider attempts</h3>
                  <article
                    v-for="attempt in activeAgentProviderAttempts"
                    :key="`${activeAgentDetails.id}-${attempt.provider}-${attempt.attempted}`"
                    class="ff-attempt"
                  >
                    <div>
                      <strong>{{ sentenceLabel(attempt.provider) }}</strong>
                      <span :class="['ff-tag', attempt.success ? 'tone-safe' : attempt.attempted ? 'tone-blocked' : 'tone-neutral']">
                        {{ attempt.success ? 'Success' : attempt.attempted ? 'Failed' : 'Not attempted' }}
                      </span>
                    </div>
                    <p v-if="attempt.error_summary">{{ attempt.error_summary }}</p>
                    <p v-else-if="attempt.raw_response">Raw response captured.</p>
                    <p v-else>No raw provider response captured.</p>
                  </article>
                </section>

                <section class="ff-modal-section">
                  <h3>System prompt</h3>
                  <pre class="ff-code">{{ activeAgentDebug?.system_prompt || "No system prompt available. The agent was likely skipped before prompting." }}</pre>
                </section>

                <section class="ff-modal-section">
                  <h3>User prompt sent to agent</h3>
                  <pre class="ff-code">{{ activeAgentDebug?.user_prompt || "No user prompt available. The agent was likely skipped before prompting." }}</pre>
                </section>

                <section class="ff-modal-section">
                  <h3>Raw provider response</h3>
                  <pre class="ff-code">{{ activeAgentRawResponse }}</pre>
                </section>

                <section class="ff-modal-section">
                  <h3>Parsed provider response</h3>
                  <pre class="ff-code">{{ activeAgentParsedResponse }}</pre>
                </section>

                <section class="ff-modal-section">
                  <h3>Final accepted output</h3>
                  <pre class="ff-code">{{ activeAgentDebugFinalOutputJson }}</pre>
                </section>
              </div>
            </section>
          </div>
        </Teleport>
      </section>
    </div>
  </main>
</template>

<style scoped>
.ff-page {
  --bg: #0f1720;
  --panel: #f4efe3;
  --panel-2: #e9dfcc;
  --paper: #fffaf0;
  --ink: #101114;
  --muted: #5f6673;
  --line: #161719;
  --soft-line: rgba(22, 23, 25, 0.15);
  --blue: #2868a8;
  --blue-soft: #dbe9f6;
  --green: #2f8c57;
  --green-soft: #dcefe2;
  --amber: #c9851d;
  --amber-soft: #fff0c9;
  --red: #c84635;
  --red-soft: #f9d8d2;
  --violet: #6250a4;
  --violet-soft: #e8e2f7;
  min-height: 100vh;
  padding: 28px 16px 88px;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at 8% 0%, rgba(40, 104, 168, 0.22), transparent 28%),
    radial-gradient(circle at 100% 12%, rgba(201, 133, 29, 0.16), transparent 24%),
    linear-gradient(135deg, #17202b, #0f1720);
}

.ff-page::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.28;
  background-image:
    linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px);
  background-size: 32px 32px;
}

*,
*::before,
*::after { box-sizing: border-box; }

.ff-shell {
  position: relative;
  z-index: 1;
  width: min(100%, 1120px);
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.ff-topbar,
.ff-brand,
.ff-input-header,
.ff-section-head,
.ff-workflow-header,
.ff-question-actions,
.ff-workflow-actions,
.ff-result-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ff-topbar,
.ff-input-header,
.ff-section-head,
.ff-workflow-header {
  justify-content: space-between;
  align-items: flex-start;
}

.ff-brand-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 2px solid rgba(255,255,255,0.2);
  border-radius: 14px;
  background: #243142;
  color: #f8fafc;
  box-shadow: 0 12px 30px rgba(0,0,0,0.24);
}

.ff-kicker {
  margin: 0 0 4px;
  color: #aeb8c6;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.ff-topbar h1,
.ff-hero-panel h2,
.ff-scan-panel h2,
.ff-workflow-header h2,
.ff-question-shell h2,
.ff-blocked-card h2 {
  margin: 0;
  color: #f8fafc;
  font-size: clamp(1.35rem, 4vw, 2.45rem);
  line-height: 1.04;
  letter-spacing: -0.055em;
}

.ff-brand h1 {
  font-size: 1.25rem;
}

.ff-safe-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  color: #dfe7ef;
  font-size: 0.82rem;
  font-weight: 800;
}

.ff-start-screen {
  display: grid;
  gap: 18px;
}

.ff-hero-panel,
.ff-input-panel,
.ff-scan-panel,
.ff-question-shell,
.ff-blocked-card,
.ff-workflow-screen,
.ff-agent-workbench,
.ff-details-panel,
.ff-error-panel {
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 28px;
  background: rgba(244, 239, 227, 0.96);
  box-shadow: 0 24px 70px rgba(0,0,0,0.22);
  padding: 26px;
}

.ff-hero-panel {
  background:
    linear-gradient(135deg, rgba(40,104,168,0.20), transparent 46%),
    rgba(244, 239, 227, 0.96);
}

.ff-hero-panel h2,
.ff-input-header h3,
.ff-section-head h2,
.ff-blocked-card h2 {
  color: var(--ink);
}

.ff-hero-panel p,
.ff-helper,
.ff-muted,
.ff-workflow-header p,
.ff-question-card p,
.ff-blocked-card p,
.ff-detail-card p,
.ff-mini-section p,
.ff-agent-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.55;
}

.ff-input-panel {
  display: grid;
  gap: 16px;
}

.ff-chip,
.ff-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  font-weight: 850;
  white-space: nowrap;
}

.ff-chip {
  min-height: 30px;
  padding: 4px 11px;
  border: 1px solid var(--soft-line);
  font-size: 0.76rem;
}

.ff-tag {
  min-height: 24px;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 0.72rem;
  border: 1px solid var(--soft-line);
}

.chip-ready,
.chip-safe,
.tone-safe {
  background: var(--green-soft);
  color: var(--green);
  border-color: rgba(47,140,87,0.28);
}

.chip-empty,
.chip-neutral,
.tone-neutral {
  background: rgba(16,17,20,0.06);
  color: var(--muted);
}

.chip-approval,
.tone-approval {
  background: var(--amber-soft);
  color: #8b5d00;
  border-color: rgba(201,133,29,0.34);
}

.chip-working,
.tone-draft {
  background: var(--blue-soft);
  color: var(--blue);
  border-color: rgba(40,104,168,0.30);
}

.tone-blocked {
  background: var(--red-soft);
  color: var(--red);
  border-color: rgba(200,70,53,0.30);
}

.tone-clarify {
  background: var(--violet-soft);
  color: var(--violet);
}

.ff-process-input,
.ff-answer-input {
  width: 100%;
  resize: vertical;
  border: 1px solid rgba(16,17,20,0.18);
  border-radius: 18px;
  background:
    linear-gradient(rgba(255,250,240,0.88), rgba(255,250,240,0.88)),
    linear-gradient(rgba(40,104,168,0.13) 1px, transparent 1px),
    linear-gradient(90deg, rgba(40,104,168,0.13) 1px, transparent 1px);
  background-size: auto, 22px 22px, 22px 22px;
  color: var(--ink);
  padding: 16px;
  font: inherit;
  line-height: 1.6;
  outline: none;
}

.ff-process-input:focus,
.ff-answer-input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 4px rgba(40,104,168,0.14);
}

.ff-helper.is-warning {
  color: var(--red);
  font-weight: 800;
}

.ff-preset-row,
.ff-mode-grid,
.ff-node-tags,
.ff-token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ff-preset-chip,
.ff-mode,
.ff-primary-btn,
.ff-secondary-btn,
.ff-ghost-btn,
.ff-text-btn,
.ff-mini-btn,
.ff-detail-tab {
  border: 1px solid rgba(16,17,20,0.18);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-weight: 850;
  cursor: pointer;
}

.ff-preset-chip {
  display: grid;
  gap: 2px;
  padding: 9px 12px;
  text-align: left;
}

.ff-preset-chip small,
.ff-mode small {
  color: var(--muted);
  font-size: 0.72rem;
}

.ff-preset-chip.is-active,
.ff-mode.is-active {
  background: var(--blue-soft);
  border-color: var(--blue);
  color: var(--blue);
}

.ff-advanced {
  border-top: 1px dashed rgba(16,17,20,0.18);
  padding-top: 12px;
}

.ff-advanced summary {
  color: var(--muted);
  font-weight: 850;
  cursor: pointer;
}

.ff-mode-grid {
  margin-top: 10px;
}

.ff-mode {
  display: grid;
  gap: 3px;
  max-width: 220px;
  padding: 10px 12px;
}

.ff-primary-btn,
.ff-secondary-btn,
.ff-ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
}

.ff-primary-btn {
  background: var(--blue);
  color: white;
  border-color: rgba(255,255,255,0.15);
}

.ff-primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ff-secondary-btn {
  background: var(--paper);
}

.ff-ghost-btn {
  background: transparent;
}

.ff-text-btn {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--blue);
}

.ff-mini-btn {
  justify-self: start;
  min-height: 30px;
  padding: 0 10px;
  font-size: 0.78rem;
}

.ff-icon-xs { width: 14px; height: 14px; flex: 0 0 auto; }
.ff-icon-sm { width: 18px; height: 18px; flex: 0 0 auto; }
.ff-icon-md { width: 24px; height: 24px; flex: 0 0 auto; }
.ff-icon-lg { width: 38px; height: 38px; flex: 0 0 auto; }

.ff-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
}

/* Scan */
.ff-scan-screen {
  min-height: 64vh;
  display: grid;
  place-items: center;
}

.ff-scan-panel {
  width: min(100%, 900px);
  background: rgba(244,239,227,0.97);
}

.ff-scan-panel h2 {
  color: var(--ink);
}

.ff-scan-panel > p {
  color: var(--muted);
}

.ff-scan-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 24px 0;
}

.ff-scan-node {
  display: grid;
  gap: 7px;
  min-height: 82px;
  padding: 13px;
  border-radius: 18px;
  background: rgba(16,17,20,0.06);
  color: var(--muted);
}

.ff-scan-node span {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #aeb6bd;
}

.ff-scan-node strong {
  color: inherit;
}

.ff-scan-node.state-active {
  background: var(--blue-soft);
  color: var(--blue);
}

.ff-scan-node.state-active span {
  background: var(--blue);
}

.ff-scan-node.state-complete {
  background: var(--green-soft);
  color: var(--green);
}

.ff-scan-node.state-complete span {
  background: var(--green);
}

.ff-progress-track {
  height: 12px;
  border-radius: 999px;
  background: rgba(16,17,20,0.10);
  overflow: hidden;
}

.ff-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--blue), var(--green));
  transition: width 450ms ease;
}


.ff-answer-history {
  display: grid;
  gap: 8px;
  margin: 16px 0;
  padding: 12px;
  border-radius: 18px;
  background: rgba(16, 17, 20, 0.05);
}

.ff-answer-history article {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 14px;
  background: var(--paper);
}

.ff-answer-history strong {
  font-size: 0.86rem;
}

.ff-answer-history p {
  margin: 0;
  color: var(--muted);
  line-height: 1.45;
}

/* Result states */
.ff-result-screen {
  display: grid;
  gap: 18px;
}

.ff-guided-question,
.ff-blocked-screen {
  display: grid;
  place-items: center;
  min-height: 62vh;
}

.ff-question-shell,
.ff-blocked-card {
  width: min(100%, 760px);
}

.ff-question-shell h2,
.ff-question-card h3,
.ff-blocked-card h2 {
  color: var(--ink);
}

.ff-question-card,
.ff-next-move {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgba(16,17,20,0.14);
  border-radius: 22px;
  background: var(--paper);
  margin: 22px 0;
}

.ff-question-field {
  justify-self: start;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--violet-soft);
  color: var(--violet);
  font-size: 0.75rem;
  font-weight: 900;
}

.ff-question-card small {
  color: var(--violet);
  font-weight: 750;
}

.ff-blocked-card {
  text-align: center;
}

.ff-verdict-icon {
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  margin: 0 auto 18px;
  border-radius: 22px;
}

.ff-verdict-icon.danger {
  background: var(--red-soft);
  color: var(--red);
}

.ff-next-move {
  text-align: left;
  background: var(--red-soft);
}

.ff-result-actions,
.ff-question-actions,
.ff-workflow-actions {
  justify-content: center;
  flex-wrap: wrap;
}

/* Workflow result */
.ff-workflow-screen,
.ff-agent-workbench,
.ff-details-panel {
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 28px;
  background: rgba(244,239,227,0.97);
  box-shadow: 0 24px 70px rgba(0,0,0,0.22);
  padding: 26px;
}

.ff-workflow-header h2 {
  color: var(--ink);
}

.ff-workflow-header p {
  color: var(--muted);
}

.ff-compact-verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.ff-node-canvas {
  display: grid;
  gap: 18px;
  margin: 24px 0;
  padding: 0;
  list-style: none;
}

.ff-node {
  position: relative;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.ff-node:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 21px;
  top: 48px;
  bottom: -18px;
  width: 2px;
  background: rgba(16,17,20,0.18);
}

.ff-node-port {
  position: relative;
  z-index: 1;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--bg);
  color: white;
  font-weight: 900;
}

.ff-node-card {
  display: grid;
  gap: 9px;
  padding: 16px;
  border: 1px solid rgba(16,17,20,0.14);
  border-radius: 20px;
  background: var(--paper);
}

.ff-node.step-safe .ff-node-card { background: var(--green-soft); }
.ff-node.step-approval .ff-node-card,
.ff-node.step-risky .ff-node-card { background: var(--amber-soft); }
.ff-node.step-blocked .ff-node-card { background: var(--red-soft); }

.ff-node-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ff-node-head strong {
  font-size: 1rem;
}

.ff-node-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.45;
}

.ff-workflow-actions {
  justify-content: flex-start;
}

/* Agents + details */
.ff-agent-workbench,
.ff-details-panel {
  display: grid;
  gap: 18px;
}

.ff-agent-workbench h3,
.ff-details-panel h2,
.ff-detail-card h4 {
  margin: 0;
  color: var(--ink);
}

.ff-agent-grid,
.ff-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.ff-agent-card,
.ff-detail-card,
.ff-mini-section {
  display: grid;
  gap: 9px;
  padding: 14px;
  border: 1px solid rgba(16,17,20,0.14);
  border-radius: 18px;
  background: var(--paper);
}

.ff-agent-top,
.ff-detail-tabs,
.ff-details-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ff-agent-top > span:first-child {
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ff-agent-state {
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 900;
}

.ff-agent-state.is-ai { background: var(--green-soft); color: var(--green); }
.ff-agent-state.is-skipped { background: rgba(16,17,20,0.08); color: var(--muted); }
.ff-agent-state.is-fallback { background: var(--amber-soft); color: #8b5d00; }

.ff-drawer-tabs,
.ff-details-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ff-detail-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 10px;
}

.ff-detail-tab.is-active {
  background: var(--blue-soft);
  color: var(--blue);
}

.ff-detail-tab.close {
  margin-left: auto;
}

.ff-detail-stack {
  display: grid;
  gap: 12px;
}

.ff-detail-grid {
  grid-template-columns: repeat(2, 1fr);
}

.ff-expand-btn {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ff-expand-btn small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
}

.ff-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 8px;
}

.ff-meta-grid div {
  padding: 9px;
  border-radius: 12px;
  background: rgba(16,17,20,0.05);
}

.ff-meta-grid dt {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.ff-meta-grid dd {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
}

.ff-detail-card ul {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
}

/* Modal */
.ff-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15,23,32,0.62);
  backdrop-filter: blur(6px);
}

.ff-modal {
  width: min(960px, 100%);
  max-height: min(90vh, 920px);
  overflow: auto;
  border-radius: 28px;
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 32px 100px rgba(0,0,0,0.36);
}

.ff-modal-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(16,17,20,0.14);
  background: rgba(244,239,227,0.96);
  backdrop-filter: blur(8px);
}

.ff-modal-header h2 {
  margin: 0;
}

.ff-modal-close {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 12px;
  background: var(--red-soft);
  color: var(--red);
  cursor: pointer;
}

.ff-modal-body {
  display: grid;
  gap: 20px;
  padding: 24px;
}

.ff-modal-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
}

.ff-modal-stats > div,
.ff-attempt {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 16px;
  background: var(--paper);
}

.ff-modal-stats span,
.ff-modal-section h3 {
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ff-modal-section {
  display: grid;
  gap: 8px;
}

.ff-modal-section h3 {
  margin: 0;
}

.ff-modal-section p,
.ff-attempt p {
  margin: 0;
  color: var(--muted);
}

.ff-attempt-list {
  display: grid;
  gap: 8px;
}

.ff-attempt div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.ff-code {
  max-height: 320px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-radius: 16px;
  background: #101114;
  color: #f8fafc;
  font-family: "SF Mono", "Fira Code", "Roboto Mono", monospace;
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Error */
.ff-error-panel {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: var(--red-soft);
}

.ff-error-panel p:last-child {
  margin: 0;
  color: var(--red);
}

@media (max-width: 860px) {
  .ff-agent-grid,
  .ff-detail-grid,
  .ff-scan-rail {
    grid-template-columns: 1fr;
  }

  .ff-meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .ff-page {
    padding: 18px 10px 60px;
  }

  .ff-hero-panel,
  .ff-input-panel,
  .ff-scan-panel,
  .ff-question-shell,
  .ff-blocked-card,
  .ff-workflow-screen,
  .ff-agent-workbench,
  .ff-details-panel {
    padding: 18px;
    border-radius: 22px;
  }

  .ff-topbar,
  .ff-input-header,
  .ff-section-head,
  .ff-workflow-header,
  .ff-question-actions,
  .ff-workflow-actions,
  .ff-result-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .ff-primary-btn,
  .ff-secondary-btn,
  .ff-ghost-btn {
    width: 100%;
  }

  .ff-modal-backdrop {
    padding: 10px;
  }

  .ff-modal-body {
    padding: 16px;
  }
}
</style>