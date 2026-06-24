<script setup lang="ts">
import type { Component } from "vue";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
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
  HumanApprovalGate,
  RiskItem,
  RiskLevel,
  StepAutomationPolicy,
  WorkflowPrimitive,
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
    tone: "Approval",
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
    tone: "Blocked",
    value:
      "When a student asks about visa eligibility or payment problems, decide the answer, update their account, send the message automatically, and close the case.",
  },
  {
    label: "Unclear request",
    tone: "Clarify",
    value: "Automate my customer messages.",
  },
];

const modes: Array<{ label: string; value: CompileMode }> = [
  { label: "Demo", value: "demo" },
  { label: "Rule", value: "rule_only" },
  { label: "Balanced", value: "balanced" },
  { label: "Full", value: "full" },
];

const compileStages: CompileStage[] = [
  { id: "prepare", label: "Prepare", durationMs: 650, description: "Creating a local compile job." },
  { id: "signals", label: "Signals", durationMs: 750, description: "Finding trigger, process shape, outputs, and primitives." },
  { id: "risks", label: "Risk", durationMs: 800, description: "Checking sensitive data, external actions, and execution risk." },
  { id: "router", label: "Route", durationMs: 800, description: "Choosing compile, clarify, safer workflow, assistant-only, or reject." },
  {
    id: "provider",
    label: "Provider",
    durationMs: 900,
    description: "Selecting AI agent provider strategy.",
    demoDescription: "AI agents skipped. Deterministic fallbacks are used.",
    aiDescription: "Trying Groq first. Gemini can be used as fallback for agent calls.",
  },
  { id: "blueprint", label: "Blueprint", durationMs: 850, description: "Running Blueprint Architect proposal and deterministic preview builder." },
  { id: "critic", label: "Critic", durationMs: 700, description: "Running AI critique when available, then deterministic Safety Guard." },
  { id: "validate", label: "Validate", durationMs: 650, description: "Validating the compile job schema." },
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
const mode = ref<CompileMode>("demo");
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

let compileRunToken = 0;
const compileReplayTimers = new Set<number>();

const expandedSteps = ref<Record<string, boolean>>({});
const expandedRisks = ref<Record<string, boolean>>({});
const expandedGates = ref<Record<string, boolean>>({});

const activeExample = computed(() => examples.find((example) => example.value === processInput.value) ?? null);
const trimmedProcessInput = computed(() => processInput.value.trim());
const hasProcessInput = computed(() => trimmedProcessInput.value.length > 0);
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
      label: "Clarification Agent",
      provider: clarification?.provider ?? "deterministic",
      usedAi: clarification?.used_ai ?? false,
      status: clarification?.status ?? "skipped",
      confidence: clarification?.confidence ?? "low",
      summary: clarification
        ? clarification.used_ai
          ? `Improved ${clarification.questions.length} clarification question(s).`
          : clarification.reason
        : "No clarification agent output yet.",
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
      label: "Blueprint Architect Agent",
      provider: blueprintArchitect?.provider ?? "deterministic",
      usedAi: blueprintArchitect?.used_ai ?? false,
      status: blueprintArchitect?.status ?? "skipped",
      confidence: blueprintArchitect?.confidence ?? "low",
      summary: blueprintArchitect
        ? blueprintArchitect.used_ai
          ? `Proposed ${blueprintArchitect.proposed_steps.length} step(s) and ${blueprintArchitect.proposed_human_approval_gates.length} gate(s).`
          : blueprintArchitect.reason
        : "No blueprint architect output yet.",
      reason: blueprintArchitect?.reason ?? "No blueprint architect output yet.",
      metrics: [
        { label: "Proposed steps", value: String(blueprintArchitect?.proposed_steps.length ?? 0) },
        { label: "Proposed gates", value: String(blueprintArchitect?.proposed_human_approval_gates.length ?? 0) },
      ],
      acceptedOutput: blueprintArchitect,
      debug: job.value.agent_debug?.blueprint_architect_agent,
      debugAvailable: Boolean(job.value.agent_debug?.blueprint_architect_agent),
    },
    {
      id: "safety_critic_agent",
      label: "Safety Critic Agent",
      provider: criticAgent?.provider ?? "deterministic",
      usedAi: criticAgent?.used_ai ?? false,
      status: criticAgent?.status ?? "skipped",
      confidence: criticAgent?.confidence ?? "low",
      summary: criticAgent
        ? criticAgent.used_ai
          ? `Found ${criticAgent.concerns.length} critique concern(s).`
          : criticAgent.reason
        : "No safety critic agent output yet.",
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
    ?? "No raw provider response is available for this agent. It may have been skipped, deterministic, or failed before returning content.";
});

const activeAgentParsedResponse = computed(() => {
  if (successfulProviderAttempt.value?.parsed_response === undefined) {
    return "No parsed provider response is available for this agent.";
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
  if (activeExample.value) return `${activeExample.value.label} selected. New compile clears the previous result.`;
  return "Choose a use case or paste a process. New compile clears the previous result.";
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

const compileRunStateLabel = computed(() => {
  if (compileRunState.value === "running" && compileReplayFinished.value && !pendingJob.value) return "Waiting";
  return sentenceLabel(compileRunState.value);
});

const compileRunTitle = computed(() => {
  if (compileRunState.value === "running") return "Building safe preview";
  if (compileRunState.value === "finishing") return "Finalizing";
  if (compileRunState.value === "failed") return "Compile failed";
  if (compileRunState.value === "complete") return "Compile complete";
  return "Compile run";
});

const compileRunStateClass = computed(() => {
  if (compileRunState.value === "complete") return "status-safe";
  if (compileRunState.value === "failed") return "status-blocked";
  return "status-working";
});

const currentCompileStatus = computed(() => {
  if (compileRunState.value === "running") {
    if (compileReplayFinished.value && !pendingJob.value) return "Waiting for compile response...";
    return currentCompileStageDescription.value;
  }
  if (compileRunState.value === "finishing") return "Schema passed. Preparing the main result.";
  if (compileRunState.value === "failed") return "Compile failed before FlowForge could show a valid preview.";
  if (job.value && routerDecision.value) return compileCompleteSummary(job.value, routerDecision.value);
  return "Ready to compile.";
});

const compactCompileCompleteSummary = computed(() => {
  const currentJob = job.value;
  const decision = routerDecision.value;
  if (!currentJob || !decision) return "Blueprint · Safety critic · No execution";
  if (currentJob.mode === "demo" || currentJob.mode === "rule_only") return "Deterministic route · Blueprint · Safety critic";
  if (decision.provider === "groq" && decision.used_ai) return "Groq router · Deterministic blueprint · Safety critic";
  if (decision.provider === "gemini" && decision.used_ai) return "Gemini fallback · Deterministic blueprint · Safety critic";
  return "Deterministic fallback · Blueprint · Safety critic";
});

const outcomeTitle = computed(() => {
  if (!compiledBlueprint.value) return "";
  if (resultMode.value === "clarify") return "Need details before flow";
  if (resultMode.value === "blocked") return "Do not automate";
  if (safetyCritic.value?.overall_status === "needs_human_approval") return "Flow needs human gates";
  if (safetyCritic.value?.overall_status === "safe_internal_preview") return "Safe internal flow";
  if (gateCount.value > 0) return "Flow with approval gates";
  return "Workflow preview ready";
});

const outcomeIcon = computed<Component>(() => {
  if (resultMode.value === "clarify") return HelpCircle;
  if (resultMode.value === "blocked") return XCircle;
  if (safetyCritic.value?.overall_status === "safe_internal_preview") return ShieldCheck;
  if (gateCount.value > 0 || riskLevel.value === "high") return UserCheck;
  return WorkflowIcon;
});

const primaryDecision = computed(() => {
  if (safetyCritic.value?.overall_status) return sentenceLabel(safetyCritic.value.overall_status);
  if (resultMode.value === "clarify") return "Needs clarification";
  if (resultMode.value === "blocked") return "Blocked";
  if (gateCount.value > 0) return "Human approval";
  return "Internal preview";
});

const primaryDecisionClass = computed(() => {
  if (resultMode.value === "blocked") return "tone-blocked";
  if (resultMode.value === "clarify") return "tone-draft";
  if (safetyCritic.value?.overall_status === "safe_internal_preview") return "tone-safe";
  if (safetyCritic.value?.overall_status === "needs_human_approval" || gateCount.value > 0) return "tone-approval";
  return "tone-safe";
});

const plainEnglishResult = computed(() => {
  if (!compiledBlueprint.value) return "";
  if (safetyCritic.value?.summary) return safetyCritic.value.summary;
  if (resultMode.value === "clarify") return "FlowForge needs a clearer trigger, input source, output, owner, or approval boundary before this becomes implementation-ready.";
  if (resultMode.value === "blocked") return "FlowForge blocked automatic execution. Keep this as human-reviewed guidance, not an automation.";
  return `FlowForge found a safe non-executing preview path that can ${capabilityText.value}.`;
});

const workflowMapTitle = computed(() => {
  if (resultMode.value === "clarify") return "Clarify first";
  if (resultMode.value === "blocked") return "Safe alternative path";
  return "Main flow";
});

const workflowMapCopy = computed(() => {
  if (resultMode.value === "clarify") return "The flow is hidden until the missing details are answered.";
  if (resultMode.value === "blocked") return "This is a non-executing review path. Do not connect it to real-world actions.";
  return "The main thing: what the automation blueprint would do without executing anything.";
});

const nextSafeAction = computed(() => {
  if (safetyCritic.value?.next_safe_action) return safetyCritic.value.next_safe_action;
  if (resultMode.value === "clarify") return "Answer the missing details, then compile again.";
  if (resultMode.value === "blocked") return "Remove automatic send/update/payment/destructive actions or route them to a human.";
  if (gateCount.value > 0) return "Review the approval gates before implementation.";
  return "Review the flow, then inspect details only if needed.";
});

const criticTitle = computed(() => {
  const status = safetyCritic.value?.overall_status;
  if (status === "safe_internal_preview") return "Critic: safe as preview";
  if (status === "needs_human_approval") return "Critic: human gate needed";
  if (status === "needs_clarification") return "Critic: clarify first";
  if (status === "not_safe_to_automate") return "Critic: do not automate";
  return "Safety Critic";
});

const criticExplanation =
  "The Safety Critic reviews the final blueprint after it is generated. It does not call AI. It decides what can be automated, what must stay draft-only, what needs a human gate, and what is blocked.";

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
    { label: "Safe", value: String(critic?.safe_to_automate.length ?? 0), className: "tone-safe" },
    { label: "Draft", value: String(critic?.must_remain_draft_only.length ?? 0), className: "tone-draft" },
    { label: "Approval", value: String(critic?.requires_human_approval.length ?? 0), className: "tone-approval" },
    { label: "Blocked", value: String(critic?.blocked_or_not_recommended.length ?? 0), className: "tone-blocked" },
  ];
});

const mainStats = computed(() => [
  { label: "Steps", value: String(compiledBlueprint.value?.steps.length ?? 0), detail: "Flow nodes", className: "tone-neutral" },
  { label: "Risk", value: riskLevel.value, detail: "Scanner result", className: riskToneClass(riskLevel.value) },
  { label: "Gates", value: String(gateCount.value), detail: "Human approvals", className: gateCount.value > 0 ? "tone-approval" : "tone-safe" },
  { label: "Execution", value: "Off", detail: "Preview only", className: "tone-safe" },
]);

const detailTabs = computed<DetailTab[]>(() => [
  { id: "critic", label: "Critic", icon: ShieldCheck, badge: safetyCritic.value?.overall_status ? sentenceLabel(safetyCritic.value.overall_status) : undefined },
  { id: "workflow", label: "Workflow", icon: WorkflowIcon, badge: `${visibleWorkflowSteps.value.length} steps` },
  { id: "risks", label: "Risks", icon: ShieldAlert, badge: `${visibleGates.value.length} gates` },
  { id: "tests", label: "Dry runs", icon: ClipboardCheck, badge: `${compiledBlueprint.value?.test_cases.length ?? 0}` },
  { id: "router", label: "Router", icon: Bot, badge: routerDecision.value?.provider ? providerLabel(routerDecision.value.provider) : undefined },
  { id: "implementation", label: "Before build", icon: FileText, badge: `${compiledBlueprint.value?.open_questions.length ?? 0} questions` },
  { id: "trace", label: "Trace", icon: LayoutGrid, badge: `${technicalPipelineSteps.value.length} steps` },
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

function compileCompleteSummary(currentJob: CompileJob, decision: RouterDecision): string {
  if (currentJob.mode === "demo" || currentJob.mode === "rule_only") {
    return "Compile complete. Routing, blueprint generation, clarification, and Safety Critic review are deterministic.";
  }

  if (decision.provider === "groq" && decision.used_ai) {
    return "Compile complete. Groq chose only the route; the blueprint and Safety Critic stayed deterministic.";
  }

  if (decision.provider === "gemini" && decision.used_ai) {
    return "Compile complete. Gemini handled fallback routing; the blueprint and Safety Critic stayed deterministic.";
  }

  return "Compile complete. Deterministic fallback handled routing; the blueprint and Safety Critic stayed deterministic.";
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
    blocked_in_mvp: "Blocked in MVP",
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

function workflowMapStepClass(step: WorkflowStep): string {
  if (step.automation_policy === "blocked_in_mvp" || step.automation_policy === "not_recommended") return "is-blocked";
  if (step.approval_required || step.automation_policy === "human_approval") return "is-approval";
  if (step.risk_level === "high") return "is-risky";
  return "is-safe";
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
  expandedSteps.value = {};
  expandedRisks.value = {};
  expandedGates.value = {};
}

function openDetail(view: NonNullable<DetailView>): void {
  activeDetail.value = activeDetail.value === view ? null : view;
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

function isGateExpanded(gate: HumanApprovalGate): boolean {
  return expandedGates.value[gate.id] === true;
}

async function compilePreview(): Promise<void> {
  inputGuardMessage.value = "";
  errorMessage.value = "";

  if (!hasProcessInput.value) {
    inputGuardMessage.value = "Paste a process or choose an example first.";
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
  <main class="compiler-page">
    <section class="compiler-shell">
      <header class="hero-panel">
        <div>
          <p class="eyebrow">FlowForge Compiler</p>
          <h1>One safe flow.</h1>
          <p>Pick a process, compile a non-executing blueprint, then inspect details only when needed.</p>
        </div>
        <span class="hero-mark" aria-hidden="true">
          <WorkflowIcon class="icon-lg" />
        </span>
      </header>

      <section v-if="!job && !isCompiling" class="input-screen">
        <article class="panel input-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Use case</p>
              <h2>Start with a process</h2>
            </div>
            <span class="status-pill tone-neutral">{{ selectedInputLabel }}</span>
          </div>

          <div class="usecase-list" aria-label="Suggested use cases">
            <button
              v-for="example in examples"
              :key="example.label"
              type="button"
              :class="['usecase-card', { 'is-selected': isSelectedExample(example.value) }]"
              @click="chooseExample(example.value)"
            >
              <span>
                <strong>{{ example.label }}</strong>
                <small>{{ example.tone }}</small>
              </span>
              <CheckCircle2 v-if="isSelectedExample(example.value)" class="icon-sm" aria-hidden="true" />
            </button>
          </div>
        </article>

        <article class="panel editor-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Process</p>
              <h2>What should FlowForge understand?</h2>
            </div>
            <span :class="['status-pill', hasProcessInput ? 'tone-safe' : 'tone-neutral']">
              {{ hasProcessInput ? "Ready" : "Empty" }}
            </span>
          </div>

          <textarea
            v-model="processInput"
            class="process-textarea"
            placeholder="When a customer asks for a refund, classify the request, draft a reply, and route risky cases to a human."
            rows="8"
            @input="clearInputGuardMessage"
          />

          <small :class="['input-helper', { 'is-warning': inputGuardMessage }]">
            {{ inputHelperCopy }}
          </small>

          <div class="bottom-controls">
            <fieldset class="mode-switcher">
              <legend>Mode</legend>
              <label v-for="item in modes" :key="item.value">
                <input v-model="mode" type="radio" name="mode" :value="item.value" />
                <span>{{ item.label }}</span>
              </label>
            </fieldset>

            <button class="primary-button" type="button" :disabled="!hasProcessInput" @click="compilePreview">
              <Sparkles class="icon-sm" />
              Compile preview
            </button>
          </div>
        </article>
      </section>

      <article v-if="errorMessage" class="panel error-panel">
        <p class="eyebrow">Error</p>
        <h2>Compile failed</h2>
        <p>{{ errorMessage }}</p>
      </article>

      <section v-if="isCompiling" class="focus-screen">
        <article class="panel compile-panel" :aria-busy="true">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Compile run</p>
              <h2>{{ compileRunTitle }}</h2>
              <p>{{ currentCompileStatus }}</p>
            </div>
            <span :class="['status-pill', compileRunStateClass]">{{ compileRunStateLabel }}</span>
          </div>

          <div class="progress-track" :style="{ '--compile-progress': compileProgressPercent }" aria-hidden="true">
            <span
              v-for="(stage, index) in compileStages"
              :key="`${stage.id}-segment`"
              :class="['progress-segment', `is-${compileStageState(index)}`]"
            />
          </div>

          <ol class="stage-grid">
            <li
              v-for="(stage, index) in compileStages"
              :key="stage.id"
              :class="['stage-card', `is-${compileStageState(index)}`]"
            >
              <span>{{ index + 1 }}</span>
              <strong>{{ stage.label }}</strong>
              <small>{{ getStageDescription(stage, activeCompileMode) }}</small>
            </li>
          </ol>
        </article>
      </section>

      <section v-if="job && compiledBlueprint && !isCompiling" class="result-screen">
        <article class="panel result-panel">
          <div class="result-layout">
            <span :class="['result-icon', primaryDecisionClass]">
              <component :is="outcomeIcon" class="icon-lg" aria-hidden="true" />
            </span>

            <div class="result-copy">
              <p class="eyebrow">Main result</p>
              <h2>{{ outcomeTitle }}</h2>
              <h3>{{ compiledBlueprint.workflow_name }}</h3>
              <p>{{ plainEnglishResult }}</p>
            </div>
          </div>

          <div class="result-pills">
            <span :class="['status-pill', primaryDecisionClass]">{{ primaryDecision }}</span>
            <span :class="['status-pill', riskToneClass(riskLevel)]">{{ riskLevel }} risk</span>
            <span :class="['status-pill', gateCount > 0 ? 'tone-approval' : 'tone-safe']">{{ gateCount }} gates</span>
            <span class="status-pill tone-safe">No execution</span>
          </div>
        </article>

        <article v-if="aiAgentCards.length > 0" class="panel ai-agent-layer-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">M12 multi-agent layer</p>
              <h2>AI Agents</h2>
              <p>Agents can clarify, propose, and critique. Deterministic guardrails still make the final safety decision.</p>
            </div>
            <span :class="['status-pill', llmCallsUsed > 0 ? 'tone-ai' : 'tone-neutral']">
              {{ llmCallsUsed > 0 ? `${llmCallsUsed} AI call${llmCallsUsed === 1 ? '' : 's'}` : 'Fallback mode' }}
            </span>
          </div>

          <div class="agent-card-grid">
            <article v-for="agent in aiAgentCards" :key="agent.label" class="agent-card">
              <div class="agent-card-top">
                <div>
                  <p class="agent-provider-pill">{{ sentenceLabel(agent.provider) }}</p>
                  <h3>{{ agent.label }}</h3>
                </div>
                <span :class="['agent-status-pill', agent.usedAi ? 'is-ai' : agent.status === 'skipped' ? 'is-skipped' : 'is-fallback']">
                  {{ agent.usedAi ? 'AI used' : agent.status === 'skipped' ? 'Skipped' : 'Fallback' }}
                </span>
              </div>

              <p class="agent-summary">{{ agent.summary }}</p>

              <p v-if="agent.reason && agent.reason !== agent.summary" class="agent-reason">
                {{ agent.reason }}
              </p>

              <dl class="agent-meta-grid">
                <div>
                  <dt>Status</dt>
                  <dd>{{ sentenceLabel(agent.status) }}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{{ sentenceLabel(agent.confidence) }}</dd>
                </div>
                <div v-for="metric in agent.metrics" :key="`${agent.label}-${metric.label}`">
                  <dt>{{ metric.label }}</dt>
                  <dd>{{ metric.value }}</dd>
                </div>
              </dl>

              <button class="agent-details-button" type="button" @click="openAgentDetails(agent.id)">
                {{ agent.debugAvailable ? "View AI details" : "View output" }}
              </button>
            </article>
          </div>
        </article>

        <Teleport to="body">
          <div v-if="activeAgentDetails" class="agent-modal-backdrop" @click.self="closeAgentDetails">
            <section class="agent-modal" role="dialog" aria-modal="true" :aria-label="`${activeAgentDetails.label} details`">
              <header class="agent-modal-header">
                <div>
                  <p class="eyebrow">AI usage details</p>
                  <h2>{{ activeAgentDetails.label }}</h2>
                  <p>
                    Current UI data is shown now. Prompt/raw response fields will populate after the backend debug payload is added.
                  </p>
                </div>
                <button class="agent-modal-close" type="button" aria-label="Close AI details" @click="closeAgentDetails">
                  <X class="icon" aria-hidden="true" />
                </button>
              </header>

              <div class="agent-modal-grid">
                <article class="agent-modal-card">
                  <h3>Usage summary</h3>
                  <dl class="mini-dl">
                    <div><dt>Provider</dt><dd>{{ sentenceLabel(activeAgentDetails.provider) }}</dd></div>
                    <div><dt>AI used</dt><dd>{{ yesNo(activeAgentDetails.usedAi) }}</dd></div>
                    <div><dt>Status</dt><dd>{{ sentenceLabel(activeAgentDetails.status) }}</dd></div>
                    <div><dt>Confidence</dt><dd>{{ sentenceLabel(activeAgentDetails.confidence) }}</dd></div>
                    <div><dt>LLM calls</dt><dd>{{ activeAgentDebug?.llm_calls_made ?? 0 }}</dd></div>
                    <div v-for="metric in activeAgentDetails.metrics" :key="`modal-${metric.label}`">
                      <dt>{{ metric.label }}</dt>
                      <dd>{{ metric.value }}</dd>
                    </div>
                  </dl>
                </article>

                <article class="agent-modal-card">
                  <h3>Outcome</h3>
                  <p>{{ activeAgentDetails.summary }}</p>
                  <p v-if="activeAgentDetails.reason" class="agent-modal-note">{{ activeAgentDetails.reason }}</p>
                  <p class="agent-modal-note">
                    Token detail currently shows call count only. Exact provider token totals need usage metadata from Groq/Gemini providers.
                  </p>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>Provider attempts</h3>
                  <ul class="agent-attempt-list">
                    <li v-for="attempt in activeAgentProviderAttempts" :key="`${activeAgentDetails.id}-${attempt.provider}-${attempt.attempted}-${attempt.success}`">
                      <div>
                        <strong>{{ sentenceLabel(attempt.provider) }}</strong>
                        <span :class="['status-pill', attempt.success ? 'tone-safe' : attempt.attempted ? 'tone-blocked' : 'tone-neutral']">
                          {{ attempt.success ? "Success" : attempt.attempted ? "Failed" : "Not attempted" }}
                        </span>
                      </div>
                      <small v-if="attempt.error_summary">{{ attempt.error_summary }}</small>
                      <small v-else-if="attempt.raw_response">Raw response captured.</small>
                      <small v-else>No raw provider response captured.</small>
                    </li>
                  </ul>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>System prompt</h3>
                  <pre class="agent-code-block">{{ activeAgentDebug?.system_prompt || "No system prompt available. The agent was likely skipped before prompting." }}</pre>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>User prompt sent to agent</h3>
                  <pre class="agent-code-block">{{ activeAgentDebug?.user_prompt || "No user prompt available. The agent was likely skipped before prompting." }}</pre>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>Raw provider response</h3>
                  <pre class="agent-code-block">{{ activeAgentRawResponse }}</pre>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>Parsed provider response</h3>
                  <pre class="agent-code-block">{{ activeAgentParsedResponse }}</pre>
                </article>

                <article class="agent-modal-card is-wide">
                  <h3>Final accepted output</h3>
                  <pre class="agent-code-block">{{ activeAgentDebugFinalOutputJson }}</pre>
                </article>
              </div>
            </section>
          </div>
        </Teleport>

        <article v-if="resultMode === 'clarify' && clarificationPlan" class="panel clarify-focus-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Missing details</p>
              <h2>Answer these before the flow matters</h2>
              <p>{{ clarificationPlan.reason || "FlowForge needs a clearer process before implementation." }}</p>
            </div>
            <HelpCircle class="icon-lg" aria-hidden="true" />
          </div>

          <div class="missing-chip-row">
            <span v-for="field in clarificationPlan.missing_fields" :key="field" class="missing-chip">
              {{ formatEnum(field) }}
            </span>
          </div>

          <div class="question-stack">
            <article v-for="question in clarificationPlan.questions" :key="question.field" class="question-card">
              <strong>{{ question.question }}</strong>
              <span>{{ question.why_it_matters }}</span>
              <small v-if="question.example_answer">Example: {{ question.example_answer }}</small>
            </article>
          </div>

          <div class="starter-box">
            <p class="eyebrow">Suggested starter</p>
            <blockquote>{{ clarificationPlan.improved_prompt_starter || clarificationPlan.suggested_template }}</blockquote>
            <div class="starter-actions">
              <button class="primary-button small" type="button" @click="applyStarter">
                <PencilLine class="icon-sm" />
                Replace input
              </button>
              <button class="secondary-button small" type="button" @click="copyStarter">
                <Copy class="icon-sm" />
                Copy text
              </button>
            </div>
            <small>Replace input only updates the text box. You still choose when to compile again.</small>
          </div>
        </article>

        <template v-else>
          <section class="stats-grid" aria-label="Result summary">
            <article v-for="stat in mainStats" :key="stat.label" class="stat-card">
              <span :class="['stat-dot', stat.className]" />
              <p class="eyebrow">{{ stat.label }}</p>
              <h3>{{ stat.value }}</h3>
              <small>{{ stat.detail }}</small>
            </article>
          </section>

          <section class="flow-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">{{ resultMode === 'blocked' ? 'Safe alternative' : 'Flow' }}</p>
                <h2>{{ workflowMapTitle }}</h2>
                <p>{{ workflowMapCopy }}</p>
              </div>
              <span class="status-pill tone-neutral">{{ visibleWorkflowSteps.length }} steps</span>
            </div>

            <ol class="flow-list">
              <li
                v-for="(step, index) in visibleWorkflowSteps"
                :key="step.id"
                :class="['flow-item', workflowMapStepClass(step)]"
              >
                <article class="flow-card">
                  <div class="flow-card-top">
                    <span class="flow-index">{{ index + 1 }}</span>
                    <component :is="stepIcon(step)" class="icon" aria-hidden="true" />
                  </div>
                  <strong>{{ step.label }}</strong>
                  <p>{{ step.description }}</p>
                  <div class="flow-badges">
                    <span :class="['status-pill', policyToneClass(step.automation_policy)]">
                      {{ policyLabel(step.automation_policy) }}
                    </span>
                    <span v-if="step.approval_required" class="status-pill tone-approval">Approval</span>
                  </div>
                </article>
              </li>
            </ol>
          </section>
        </template>

        <article v-if="safetyCritic" class="panel critic-summary-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Safety Critic</p>
              <h2>{{ criticTitle }}</h2>
              <p>{{ criticExplanation }}</p>
            </div>
            <span :class="['status-pill', primaryDecisionClass]">
              {{ sentenceLabel(safetyCritic.overall_status) }}
            </span>
          </div>

          <div class="critic-count-grid">
            <article v-for="item in criticCounts" :key="item.label" class="critic-count-card">
              <span :class="['stat-dot', item.className]" />
              <strong>{{ item.value }}</strong>
              <small>{{ item.label }}</small>
            </article>
          </div>

          <article v-if="criticTopFinding" class="top-finding-card">
            <span :class="['status-pill', severityToneClass(criticTopFinding.severity)]">
              {{ criticTopFinding.severity }}
            </span>
            <h3>{{ criticTopFinding.title }}</h3>
            <p>{{ criticTopFinding.recommendation }}</p>
          </article>
        </article>

        <article class="panel next-action-panel">
          <span class="next-icon">
            <ArrowRight class="icon" aria-hidden="true" />
          </span>
          <div>
            <p class="eyebrow">Next safe action</p>
            <h2>{{ nextSafeAction }}</h2>
          </div>
        </article>

        <section class="details-launcher">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Details on demand</p>
              <h2>Open only what you need</h2>
            </div>
            <span class="status-pill tone-neutral">Hidden by default</span>
          </div>

          <div class="detail-tab-grid">
            <button
              v-for="tab in detailTabs"
              :key="tab.id"
              type="button"
              :class="['detail-tab', { 'is-active': activeDetail === tab.id }]"
              @click="openDetail(tab.id)"
            >
              <component :is="tab.icon" class="icon" aria-hidden="true" />
              <span>
                <strong>{{ tab.label }}</strong>
                <small v-if="tab.badge">{{ tab.badge }}</small>
              </span>
              <ChevronRight class="icon-sm" aria-hidden="true" />
            </button>
          </div>
        </section>

        <section v-if="activeDetail" class="detail-view-panel">
          <div class="detail-view-head">
            <div>
              <p class="eyebrow">Details</p>
              <h2>{{ detailTabs.find((tab) => tab.id === activeDetail)?.label }}</h2>
            </div>
            <button class="secondary-button small" type="button" @click="activeDetail = null">Close details</button>
          </div>

          <div v-if="activeDetail === 'critic' && safetyCritic" class="detail-stack">
            <article
              v-for="finding in safetyCritic.findings"
              :key="finding.id"
              :class="['detail-card', severityToneClass(finding.severity)]"
            >
              <span class="eyebrow">{{ formatEnum(finding.type) }}</span>
              <h3>{{ finding.title }}</h3>
              <p>{{ finding.explanation }}</p>
              <strong>Recommendation</strong>
              <p>{{ finding.recommendation }}</p>
            </article>
          </div>

          <div v-else-if="activeDetail === 'workflow'" class="detail-stack">
            <article v-for="step in visibleWorkflowSteps" :key="step.id" class="detail-card">
              <button class="detail-card-toggle" type="button" @click="toggleStep(step.id)">
                <span>
                  <strong>{{ step.label }}</strong>
                  <small>{{ policyLabel(step.automation_policy) }} · {{ step.risk_level }} risk</small>
                </span>
                <span>{{ isStepExpanded(step) ? "Hide" : "Show" }}</span>
              </button>

              <dl v-if="isStepExpanded(step)" class="meta-grid">
                <div><dt>Primitive</dt><dd>{{ formatEnum(step.primitive) }}</dd></div>
                <div><dt>Actor</dt><dd>{{ formatEnum(step.actor) }}</dd></div>
                <div><dt>Execution</dt><dd>{{ formatEnum(step.real_world_execution) }}</dd></div>
                <div><dt>Input</dt><dd>{{ step.input }}</dd></div>
                <div><dt>Output</dt><dd>{{ step.output }}</dd></div>
                <div><dt>Approval</dt><dd>{{ yesNo(step.approval_required) }}</dd></div>
              </dl>
            </article>
          </div>

          <div v-else-if="activeDetail === 'router'" class="two-column-details">
            <article class="detail-card">
              <h3>Router role</h3>
              <p>{{ routerRoleCopy }}</p>
              <p>{{ deterministicBoundaryCopy }}</p>
            </article>

            <article class="detail-card">
              <h3>Provider path</h3>
              <ul class="plain-list">
                <li v-for="item in providerAttemptItems" :key="item.provider">
                  <strong>{{ item.provider }}</strong>
                  <span :class="['status-pill', providerAttemptClass(item.status)]">{{ item.status }}</span>
                  <small>{{ item.detail }}</small>
                </li>
              </ul>
            </article>

            <article class="detail-card">
              <h3>Router inputs</h3>
              <p>{{ routerPromptContextSummary }}</p>
              <dl class="mini-dl">
                <div v-for="item in routerInputItems" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ previewText(item.value) }}</dd>
                </div>
              </dl>
            </article>

            <article class="detail-card">
              <h3>Router output</h3>
              <p>{{ routerOutputBoundaryCopy }}</p>
              <dl class="mini-dl">
                <div v-for="item in routerOutputItems" :key="item.label">
                  <dt>{{ item.label }}</dt>
                  <dd>{{ previewText(item.value) }}</dd>
                </div>
              </dl>
            </article>
          </div>

          <div v-else-if="activeDetail === 'risks'" class="two-column-details">
            <article class="detail-card">
              <h3>Human gates</h3>
              <p v-if="visibleGates.length === 0">No gate-worthy risk detected. Preview still does not execute external actions.</p>
              <div v-for="gate in visibleGates" :key="gate.id" class="stacked-detail">
                <button class="detail-card-toggle" type="button" @click="toggleGate(gate.id)">
                  <strong>{{ gate.label }}</strong>
                  <span>{{ isGateExpanded(gate) ? "Hide" : "Show" }}</span>
                </button>
                <p>{{ gate.reason }}</p>
                <ul v-if="isGateExpanded(gate)" class="checklist">
                  <li v-for="item in gate.review_checklist" :key="item">{{ item }}</li>
                </ul>
              </div>
            </article>

            <article class="detail-card">
              <h3>Risk reasons</h3>
              <p v-if="visibleRisks.length === 0">No obvious risk flags detected. Preview stays non-executing.</p>
              <div v-for="risk in visibleRisks" :key="risk.id" class="stacked-detail">
                <button class="detail-card-toggle" type="button" @click="toggleRisk(risk.id)">
                  <strong>{{ risk.label }}</strong>
                  <span :class="['status-pill', riskToneClass(risk.risk_level)]">{{ risk.risk_level }}</span>
                </button>
                <div v-if="isRiskExpanded(risk)">
                  <p><strong>Reason:</strong> {{ risk.reason }}</p>
                  <p><strong>Recommendation:</strong> {{ risk.recommendation }}</p>
                </div>
              </div>
            </article>
          </div>

          <div v-else-if="activeDetail === 'tests'" class="two-column-details">
            <article v-for="testCase in compiledBlueprint.test_cases" :key="testCase.id" class="detail-card">
              <div class="inline-head">
                <h3>{{ testCase.name }}</h3>
                <span :class="['status-pill', testCase.expected_human_gate ? 'tone-approval' : 'tone-safe']">
                  {{ testCase.expected_human_gate ? "Human gate" : "No gate" }}
                </span>
              </div>
              <p><strong>Input:</strong> {{ testCase.input_event }}</p>
              <p><strong>Expected:</strong> {{ formatEnum(testCase.expected_route) }}</p>
              <p>{{ testCase.reason }}</p>
            </article>
          </div>

          <div v-else-if="activeDetail === 'implementation'" class="two-column-details">
            <article class="detail-card">
              <h3>Assumptions</h3>
              <ul class="checklist">
                <li v-for="assumption in compiledBlueprint.assumptions" :key="assumption">{{ assumption }}</li>
              </ul>
            </article>

            <article class="detail-card">
              <h3>Open questions</h3>
              <ul class="checklist">
                <li v-for="question in compiledBlueprint.open_questions" :key="question">{{ question }}</li>
              </ul>
            </article>
          </div>

          <div v-else-if="activeDetail === 'trace'" class="two-column-details">
            <article class="detail-card">
              <h3>Pipeline</h3>
              <ol class="plain-list">
                <li v-for="step in technicalPipelineSteps" :key="step.id">
                  <strong>{{ step.label }}</strong>
                  <span>{{ previewText(step.output_summary) }}</span>
                </li>
              </ol>
            </article>

            <article v-if="technicalTokenUsage" class="detail-card">
              <h3>Token usage</h3>
              <dl class="mini-dl">
                <div><dt>Mode</dt><dd>{{ technicalTokenUsage.mode }}</dd></div>
                <div><dt>LLM calls</dt><dd>{{ technicalTokenUsage.llm_calls_used }} / {{ technicalTokenUsage.llm_calls_limit }}</dd></div>
                <div><dt>Rule checks</dt><dd>{{ technicalTokenUsage.rule_based_checks }}</dd></div>
              </dl>
            </article>

            <article class="detail-card">
              <h3>Agent trace</h3>
              <ul class="plain-list">
                <li v-for="event in technicalAgentTrace" :key="event.id">
                  <strong>{{ event.action }}</strong>
                  <span>{{ event.status }}</span>
                  <small v-if="event.output_summary">{{ previewText(event.output_summary) }}</small>
                </li>
              </ul>
            </article>
          </div>
        </section>

        <button class="new-compile-button" type="button" @click="job = null; activeAgentDetailsId = null; compileRunState = 'idle'; resetDetails()">
          Compile another process
        </button>
      </section>
    </section>
  </main>
</template>

<style scoped>
.compiler-page {
  min-height: 100vh;
  padding: 28px 14px 72px;
  background:
    radial-gradient(circle at 0% 0%, rgba(0, 124, 120, 0.12), transparent 34%),
    linear-gradient(180deg, #f8faf7 0%, #eef2ee 100%);
}

.compiler-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.hero-panel,
.panel,
.flow-panel,
.details-launcher,
.detail-view-panel {
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow:
    0 20px 56px rgba(15, 32, 29, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(18px);
}

.hero-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: clamp(24px, 4vw, 42px);
}

.hero-panel h1 {
  margin: 0;
  color: var(--ff-ink);
  font-size: clamp(2.4rem, 7vw, 5.6rem);
  letter-spacing: -0.075em;
  line-height: 0.92;
}

.hero-panel p {
  max-width: 650px;
  margin: 12px 0 0;
  color: var(--ff-muted);
  font-size: 1rem;
  line-height: 1.55;
}

.hero-mark {
  display: grid;
  width: 76px;
  height: 76px;
  place-items: center;
  border-radius: 26px;
  background: #101d1a;
  color: #ffffff;
  box-shadow: 0 18px 42px rgba(16, 29, 26, 0.23);
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--ff-primary-strong);
  font-size: 0.72rem;
  font-weight: 950;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.input-screen {
  display: grid;
  grid-template-columns: 0.84fr 1.16fr;
  gap: 14px;
}

.panel,
.flow-panel,
.details-launcher,
.detail-view-panel {
  padding: clamp(16px, 2.5vw, 24px);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-head h2,
.flow-panel h2,
.details-launcher h2,
.detail-view-panel h2 {
  margin: 0;
  color: var(--ff-ink);
  font-size: clamp(1.15rem, 2.2vw, 1.55rem);
  letter-spacing: -0.035em;
  line-height: 1.08;
}

.panel-head p,
.panel p,
.flow-panel p,
.details-launcher p,
.detail-view-panel p {
  margin: 6px 0 0;
  color: var(--ff-muted);
  line-height: 1.45;
}

.usecase-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.usecase-card {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 22px;
  background: #fbfcfb;
  color: var(--ff-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.usecase-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ff-primary) 35%, var(--ff-border));
}

.usecase-card.is-selected {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
  color: var(--ff-primary-strong);
  box-shadow: 0 0 0 4px rgba(0, 124, 120, 0.12);
}

.usecase-card span {
  display: grid;
  gap: 5px;
}

.usecase-card strong {
  font-size: 0.95rem;
}

.usecase-card small {
  color: currentColor;
  opacity: 0.7;
  font-size: 0.76rem;
  font-weight: 850;
}

.process-textarea {
  width: 100%;
  min-height: 210px;
  margin-top: 16px;
  padding: 16px;
  border: 1px solid rgba(24, 43, 38, 0.12);
  border-radius: 24px;
  background: #fbfcfb;
  color: var(--ff-ink);
  font: inherit;
  line-height: 1.55;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.process-textarea:focus {
  border-color: var(--ff-primary);
  box-shadow: 0 0 0 4px rgba(0, 124, 120, 0.12);
}

.input-helper {
  display: block;
  margin-top: 9px;
  color: var(--ff-muted);
  font-size: 0.84rem;
  font-weight: 800;
  line-height: 1.35;
}

.input-helper.is-warning {
  color: var(--ff-blocked);
}

.bottom-controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-top: 16px;
}

.mode-switcher {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.mode-switcher legend {
  width: 100%;
  color: var(--ff-muted);
  font-size: 0.72rem;
  font-weight: 950;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mode-switcher label {
  position: relative;
}

.mode-switcher input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mode-switcher span {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  padding: 0 12px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 999px;
  background: #fbfcfb;
  color: var(--ff-muted);
  font-size: 0.82rem;
  font-weight: 900;
  cursor: pointer;
}

.mode-switcher input:checked + span {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
  color: var(--ff-primary-strong);
}

.primary-button,
.secondary-button,
.new-compile-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font: inherit;
  font-weight: 950;
  cursor: pointer;
}

.primary-button {
  background: #101d1a;
  color: #ffffff;
  box-shadow: 0 16px 34px rgba(16, 29, 26, 0.18);
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.secondary-button,
.new-compile-button {
  border: 1px solid rgba(24, 43, 38, 0.12);
  background: #ffffff;
  color: var(--ff-ink);
}

.primary-button.small,
.secondary-button.small {
  min-height: 38px;
  padding: 0 13px;
  font-size: 0.84rem;
}

.status-pill {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 999px;
  background: #f6f8f5;
  color: var(--ff-muted);
  font-size: 0.76rem;
  font-weight: 950;
  text-transform: capitalize;
  white-space: nowrap;
}

.focus-screen {
  display: grid;
}

.compile-panel {
  border-color: color-mix(in srgb, var(--ff-primary) 35%, rgba(24, 43, 38, 0.1));
}

.progress-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 5px;
  margin-top: 16px;
}

.progress-track::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--compile-progress);
  border-radius: 999px;
  background: color-mix(in srgb, var(--ff-primary) 16%, transparent);
  content: "";
}

.progress-segment {
  position: relative;
  z-index: 1;
  height: 8px;
  border-radius: 999px;
  background: #e7ece8;
}

.progress-segment.is-active {
  background: var(--ff-primary);
}

.progress-segment.is-complete {
  background: var(--ff-safe);
}

.stage-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.stage-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(24, 43, 38, 0.08);
  border-radius: 18px;
  background: #fbfcfb;
  color: var(--ff-muted);
}

.stage-card span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 999px;
  background: #ffffff;
  font-size: 0.78rem;
  font-weight: 950;
}

.stage-card strong {
  color: var(--ff-ink);
  font-size: 0.88rem;
}

.stage-card small {
  font-size: 0.76rem;
  line-height: 1.3;
}

.stage-card.is-active {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
  color: var(--ff-primary-strong);
}

.stage-card.is-complete {
  border-color: #b7ebcb;
  background: var(--ff-safe-soft);
}

.result-screen {
  display: grid;
  gap: 14px;
}

.result-layout {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.result-icon,
.next-icon {
  display: grid;
  width: 62px;
  height: 62px;
  place-items: center;
  border-radius: 22px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  background: #f6f8f5;
}

.result-copy h2 {
  margin: 0;
  color: var(--ff-ink);
  font-size: clamp(2rem, 5vw, 4.1rem);
  letter-spacing: -0.07em;
  line-height: 0.96;
}

.result-copy h3 {
  margin: 7px 0 0;
  color: var(--ff-muted);
  font-size: 1.08rem;
}

.result-copy p {
  max-width: 800px;
  margin: 12px 0 0;
  color: var(--ff-muted);
  line-height: 1.5;
}

.result-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}

.stats-grid,
.critic-count-grid {
  display: grid;
  gap: 12px;
}

.stats-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.stat-card,
.critic-count-card {
  padding: 15px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 36px rgba(15, 32, 29, 0.06);
}

.stat-card h3,
.critic-count-card strong {
  display: block;
  margin: 4px 0;
  color: var(--ff-ink);
  font-size: 1.7rem;
  line-height: 1;
  letter-spacing: -0.04em;
  text-transform: capitalize;
}

.stat-card small,
.critic-count-card small {
  color: var(--ff-muted);
  font-size: 0.82rem;
  font-weight: 850;
}

.stat-dot {
  display: block;
  width: 9px;
  height: 9px;
  margin-bottom: 10px;
  border-radius: 999px;
}

.flow-panel {
  padding: clamp(16px, 2.5vw, 24px);
}

.flow-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.flow-card {
  display: grid;
  min-height: 100%;
  gap: 10px;
  padding: 15px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 24px;
  background: #ffffff;
}

.flow-item.is-safe .flow-card {
  border-color: #b7ebcb;
}

.flow-item.is-approval .flow-card,
.flow-item.is-risky .flow-card,
.flow-item.is-blocked .flow-card {
  border-color: #f2b8b5;
  background: #fff8f7;
}

.flow-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.flow-index {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 999px;
  background: #101d1a;
  color: white;
  font-weight: 950;
}

.flow-card strong {
  color: var(--ff-ink);
  line-height: 1.2;
}

.flow-card p {
  margin: 0;
  color: var(--ff-muted);
  font-size: 0.9rem;
  line-height: 1.35;
}

.flow-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
}

.critic-summary-panel {
  display: grid;
  gap: 14px;
}

.critic-count-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.top-finding-card,
.question-card,
.starter-box,
.detail-card {
  padding: 14px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 22px;
  background: #ffffff;
}

.top-finding-card h3,
.detail-card h3 {
  margin: 8px 0 0;
  color: var(--ff-ink);
}

.top-finding-card p,
.detail-card p {
  color: var(--ff-muted);
  line-height: 1.42;
}

.next-action-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  border-color: color-mix(in srgb, var(--ff-primary) 32%, rgba(24, 43, 38, 0.1));
}

.next-icon {
  width: 48px;
  height: 48px;
  border-radius: 18px;
  background: #101d1a;
  color: white;
}

.next-action-panel h2 {
  margin: 0;
  color: var(--ff-ink);
  font-size: 1.18rem;
  line-height: 1.22;
}

.details-launcher {
  padding: clamp(16px, 2.5vw, 24px);
}

.detail-tab-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.detail-tab {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 62px;
  padding: 12px;
  border: 1px solid rgba(24, 43, 38, 0.1);
  border-radius: 20px;
  background: #ffffff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.detail-tab.is-active {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
}

.detail-tab strong {
  display: block;
  color: var(--ff-ink);
  font-size: 0.9rem;
}

.detail-tab small {
  color: var(--ff-muted);
  font-size: 0.76rem;
  font-weight: 850;
}

.detail-view-panel {
  padding: clamp(16px, 2.5vw, 24px);
}

.detail-view-head,
.inline-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.detail-stack,
.plain-list,
.checklist {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.detail-stack {
  margin-top: 16px;
}

.two-column-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.detail-card strong {
  color: var(--ff-ink);
}

.detail-card-toggle {
  display: flex;
  width: 100%;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.detail-card-toggle strong {
  display: block;
}

.detail-card-toggle small {
  display: block;
  margin-top: 3px;
  color: var(--ff-muted);
}

.meta-grid,
.mini-dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0 0;
}

.meta-grid div,
.mini-dl div {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(24, 43, 38, 0.08);
  border-radius: 16px;
  background: #f8faf7;
}

.meta-grid dt,
.mini-dl dt {
  color: var(--ff-muted);
  font-size: 0.7rem;
  font-weight: 950;
  text-transform: uppercase;
}

.meta-grid dd,
.mini-dl dd {
  margin: 3px 0 0;
  color: var(--ff-ink);
  font-size: 0.9rem;
  font-weight: 850;
  overflow-wrap: anywhere;
}

.plain-list li {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 16px;
  background: #f8faf7;
}

.plain-list strong {
  color: var(--ff-ink);
}

.plain-list span,
.plain-list small {
  color: var(--ff-muted);
  line-height: 1.35;
}

.stacked-detail {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(24, 43, 38, 0.08);
}

.checklist li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--ff-muted);
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

.clarify-focus-panel {
  border-color: #f2d78c;
  background: #fffdf8;
}

.missing-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}

.missing-chip {
  padding: 6px 10px;
  border-radius: 999px;
  background: #f5e7a0;
  color: #6b4a00;
  font-size: 0.78rem;
  font-weight: 900;
}

.question-stack {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.question-card {
  display: grid;
  gap: 5px;
}

.question-card strong {
  color: var(--ff-ink);
}

.question-card span,
.question-card small {
  color: var(--ff-muted);
}

.starter-box {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.starter-box blockquote {
  margin: 0;
  padding: 12px 14px;
  border-left: 3px solid var(--ff-primary);
  border-radius: 0 14px 14px 0;
  background: var(--ff-primary-soft);
  color: var(--ff-ink);
  line-height: 1.55;
}

.starter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.starter-box small {
  color: var(--ff-muted);
  font-weight: 800;
}

.new-compile-button {
  justify-self: center;
  margin-top: 4px;
}

.icon,
.icon-sm,
.icon-lg {
  display: block;
  flex: 0 0 auto;
  stroke-width: 2.2;
}

.icon {
  width: 20px;
  height: 20px;
}

.icon-sm {
  width: 15px;
  height: 15px;
}

.icon-lg {
  width: 30px;
  height: 30px;
}

.tone-neutral {
  border-color: rgba(24, 43, 38, 0.1);
  background: #f6f8f5;
  color: var(--ff-muted);
}

.tone-safe,
.status-safe {
  border-color: #b7ebcb;
  background: var(--ff-safe-soft);
  color: var(--ff-safe);
}

.tone-draft,
.status-working {
  border-color: #f2d78c;
  background: var(--ff-approval-soft);
  color: var(--ff-approval);
}

.tone-approval {
  border-color: #f2d78c;
  background: var(--ff-approval-soft);
  color: var(--ff-approval);
}

.tone-blocked,
.status-blocked {
  border-color: #f2b8b5;
  background: var(--ff-blocked-soft);
  color: var(--ff-blocked);
}


.ai-agent-layer-panel {
  display: grid;
  gap: 18px;
}

.agent-card-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.agent-card {
  display: grid;
  min-width: 0;
  gap: 14px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.94);
  padding: 16px;
  color: var(--ff-ink);
  box-shadow: 0 14px 36px rgba(15, 32, 29, 0.06);
}

.agent-card * {
  min-width: 0;
}

.agent-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.agent-provider-pill {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  margin: 0;
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  font-size: 0.72rem;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
}

.agent-card h3 {
  margin: 8px 0 0;
  color: var(--ff-ink);
  font-size: 1rem;
  line-height: 1.22;
}

.agent-summary {
  margin: 0;
  color: #475569;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.agent-reason {
  max-height: 8rem;
  margin: -4px 0 0;
  overflow: auto;
  border-radius: 16px;
  background: #f8fafc;
  padding: 10px;
  color: #475569;
  font-size: 0.84rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}

.agent-status-pill {
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 0.76rem;
  font-weight: 950;
  white-space: nowrap;
}

.agent-status-pill.is-ai {
  background: rgba(34, 197, 94, 0.14);
  color: #166534;
}

.agent-status-pill.is-fallback {
  background: rgba(245, 158, 11, 0.15);
  color: #92400e;
}

.agent-status-pill.is-skipped {
  background: rgba(100, 116, 139, 0.14);
  color: #475569;
}

.agent-meta-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}

.agent-meta-grid div {
  min-width: 0;
  border-radius: 16px;
  background: #f8fafc;
  padding: 10px;
}

.agent-meta-grid dt {
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-meta-grid dd {
  margin: 4px 0 0;
  color: #0f172a;
  font-weight: 800;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.agent-details-button {
  justify-self: end;
  min-height: 36px;
  border: 1px solid rgba(0, 124, 120, 0.22);
  border-radius: 999px;
  background: rgba(0, 124, 120, 0.08);
  color: var(--ff-primary-strong);
  padding: 0 12px;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 950;
  cursor: pointer;
}

.agent-details-button:hover {
  background: rgba(0, 124, 120, 0.14);
}

.agent-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.58);
  backdrop-filter: blur(10px);
}

.agent-modal {
  width: min(980px, 100%);
  max-height: min(86vh, 860px);
  overflow: auto;
  border: 1px solid rgba(226, 232, 240, 0.82);
  border-radius: 28px;
  background: #ffffff;
  box-shadow: 0 30px 90px rgba(15, 23, 42, 0.32);
}

.agent-modal-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.96);
  padding: 22px;
  backdrop-filter: blur(12px);
}

.agent-modal-header h2 {
  margin: 0;
  color: var(--ff-ink);
  font-size: clamp(1.35rem, 3vw, 2rem);
  letter-spacing: -0.04em;
}

.agent-modal-header p {
  margin: 8px 0 0;
  color: var(--ff-muted);
  line-height: 1.45;
}

.agent-modal-close {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  background: #f8fafc;
  color: #0f172a;
  cursor: pointer;
}

.agent-modal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 22px;
}

.agent-modal-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 22px;
  background: #ffffff;
  padding: 16px;
}

.agent-modal-card.is-wide {
  grid-column: 1 / -1;
}

.agent-modal-card h3 {
  margin: 0 0 10px;
  color: var(--ff-ink);
  font-size: 1rem;
}

.agent-modal-card p {
  margin: 0;
  color: var(--ff-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.agent-modal-note {
  margin-top: 10px !important;
  border-radius: 16px;
  background: #f8fafc;
  padding: 10px;
  font-size: 0.86rem;
}

.agent-attempt-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-attempt-list li {
  display: grid;
  gap: 6px;
  border-radius: 16px;
  background: #f8fafc;
  padding: 10px;
}

.agent-attempt-list li > div {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-attempt-list strong {
  color: var(--ff-ink);
}

.agent-attempt-list small {
  color: var(--ff-muted);
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.agent-code-block {
  max-height: 280px;
  overflow: auto;
  margin: 0;
  border-radius: 16px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
  font-size: 0.82rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.tone-ai {
  border-color: rgba(34, 197, 94, 0.26);
  background: rgba(34, 197, 94, 0.12);
  color: #166534;
}

@media (max-width: 980px) {
  .input-screen,
  .stats-grid,
  .critic-count-grid,
  .two-column-details,
  .meta-grid,
  .mini-dl {
    grid-template-columns: 1fr;
  }

  .usecase-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stage-grid,
  .agent-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hero-panel,
  .result-layout,
  .next-action-panel {
    grid-template-columns: 1fr;
  }

  .hero-mark {
    width: 58px;
    height: 58px;
    border-radius: 20px;
  }
}

@media (max-width: 640px) {
  .compiler-page {
    padding: 12px 10px 48px;
  }

  .compiler-shell {
    gap: 12px;
  }

  .hero-panel,
  .panel,
  .flow-panel,
  .details-launcher,
  .detail-view-panel {
    border-radius: 22px;
    padding: 14px;
  }

  .usecase-list,
  .flow-list,
  .detail-tab-grid,
  .agent-card-grid,
  .agent-modal-grid {
    grid-template-columns: 1fr;
  }

  .bottom-controls,
  .panel-head,
  .detail-view-head,
  .inline-head,
  .detail-card-toggle {
    align-items: stretch;
    flex-direction: column;
  }

  .mode-switcher {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mode-switcher label,
  .mode-switcher span,
  .primary-button,
  .secondary-button,
  .new-compile-button {
    width: 100%;
  }

  .flow-list {
    margin-top: 12px;
  }

  .starter-actions {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>