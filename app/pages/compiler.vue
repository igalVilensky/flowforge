<script setup lang="ts">
import type { CompileJob, CompileMode } from "../../shared/types/compileJob";
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

const processInput = ref(examples[0]?.value ?? "");
const mode = ref<CompileMode>("demo");
const job = ref<CompileJob | null>(null);
const isCompiling = ref(false);
const errorMessage = ref("");

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
      capabilities.add("detect safety risks");
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
      capabilities.add("prepare internal record fields");
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

  const hasGates = compiledBlueprint.value.human_approval_gates.length > 0;
  const hasBlockedItems = compiledBlueprint.value.not_safe_to_automate.length > 0;

  if (hasGates || hasBlockedItems) {
    return `FlowForge can ${capabilityText.value}. It keeps risky actions behind human approval and does not execute anything.`;
  }

  return `FlowForge can ${capabilityText.value}. This remains a preview and does not execute external actions.`;
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

  if (compiledBlueprint.value.automation_boundary === "assistant_only") {
    return "Assistant-only preview";
  }

  return "Partially automatable";
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
  errorMessage.value = "";
  isCompiling.value = true;
  resetExpandedState();

  try {
    job.value = await $fetch<CompileJob>("/api/compile", {
      method: "POST",
      body: {
        input: processInput.value,
        mode: mode.value,
      },
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Compile preview failed.";
  } finally {
    isCompiling.value = false;
  }
}

onMounted(() => {
  void compilePreview();
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

```
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

    <article v-if="isCompiling && !job" class="ff-tile result-state-tile">
      <div class="ff-tile-inner result-state-inner">
        <p class="ff-kicker">Working</p>
        <h2 class="ff-page-title">Building safe blueprint preview...</h2>
      </div>
    </article>

    <article v-else-if="!job" class="ff-tile result-state-tile">
      <div class="ff-tile-inner result-state-inner">
        <p class="ff-kicker">Ready</p>
        <h2 class="ff-page-title">
          Describe a process and FlowForge will generate a safe automation blueprint preview.
        </h2>
      </div>
    </article>

    <template v-else-if="compiledBlueprint">
      <article class="ff-tile result-hero-tile">
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
              <dd>{{ job.token_usage.llm_calls_used }}</dd>
            </div>
          </dl>
        </div>
      </article>

      <article class="ff-tile decision-tile">
        <div class="ff-tile-inner decision-inner">
          <div>
            <p class="ff-kicker">Main decision</p>
            <h2 class="ff-section-title">Plan first. Execute later.</h2>
            <p class="ff-copy">
              FlowForge produced a non-executing workflow plan. It can help with safe internal steps,
              but risky actions stay draft-only or human-approved.
            </p>
          </div>

          <div v-if="primaryGate" class="primary-gate">
            <span class="policy-badge policy-approval">Main approval</span>
            <strong>{{ primaryGate.label }}</strong>
            <span>{{ primaryGate.reason }}</span>
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
            <p class="ff-copy">{{ compiledBlueprint.summary }}</p>

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
                <dd>{{ compiledBlueprint.trigger.description }}</dd>
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

            <p>{{ testCase.input_event }}</p>

            <dl class="meta-grid mini-grid">
              <div>
                <dt>Expected route</dt>
                <dd>{{ formatEnum(testCase.expected_route) }}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{{ testCase.reason }}</dd>
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
              <li v-for="step in job.steps" :key="step.id">
                <strong>{{ step.label }}</strong>
                <span>{{ step.output_summary }}</span>
              </li>
            </ol>
          </article>

          <article class="output-card">
            <h3>Token usage</h3>
            <dl class="meta-grid mini-grid">
              <div>
                <dt>Mode</dt>
                <dd>{{ job.token_usage.mode }}</dd>
              </div>
              <div>
                <dt>LLM calls</dt>
                <dd>{{ job.token_usage.llm_calls_used }} / {{ job.token_usage.llm_calls_limit }}</dd>
              </div>
              <div>
                <dt>Rule checks</dt>
                <dd>{{ job.token_usage.rule_based_checks }}</dd>
              </div>
            </dl>
          </article>

          <article class="output-card">
            <h3>Agent trace</h3>
            <ul class="detail-list">
              <li v-for="event in job.agent_trace" :key="event.id">
                <strong>{{ event.action }}</strong>
                <span>{{ event.status }}</span>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </template>
  </section>
</section>
```

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
.result-state-tile,
.decision-tile,
.blueprint-section {
  grid-column: span 12;
}

.result-state-inner {
  display: grid;
  min-height: 170px;
  align-content: center;
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
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
}

.result-metrics dt {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.74rem;
  font-weight: 900;
  text-transform: uppercase;
}

.result-metrics dd {
  margin: 0;
  color: #ffffff;
  font-size: 1.05rem;
  font-weight: 950;
}

.decision-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 360px);
  gap: 18px;
  align-items: stretch;
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
  .blueprint-section {
    grid-column: span 12;
  }

  .decision-inner {
    grid-template-columns: 1fr;
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
  .meta-grid {
    grid-template-columns: 1fr;
  }

  .workflow-details {
    padding-left: 14px;
  }
}

@media (max-width: 760px) {
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
.result-hero-tile .result-metrics div {
border: 1px solid var(--ff-border);
background: var(--ff-surface-muted);
}

.result-hero-tile .result-metrics dt {
color: var(--ff-muted);
}

.result-hero-tile .result-metrics dd {
color: var(--ff-ink);
}

.result-hero-tile .result-metrics dt,
.result-hero-tile .result-metrics dd {
opacity: 1;
}

</style>
