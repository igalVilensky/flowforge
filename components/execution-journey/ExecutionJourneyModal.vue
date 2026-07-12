<script setup lang="ts">
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileOutput,
  GitBranch,
  History,
  MessageSquareText,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from "lucide-vue-next";
import type { Component } from "vue";
import type {
  ExecutionJourneyMethod,
  ExecutionJourneyStatus,
  ExecutionJourneyStep,
} from "~~/shared/executionJourney";
import type { CompileJob } from "~~/shared/types/compileJob";

const props = defineProps<{
  steps: ExecutionJourneyStep[];
  job: CompileJob | null;
}>();

const isOpen = ref(false);

const journeyStats = computed(() => {
  const providers = new Set<string>();
  let failures = 0;
  let fallbacks = 0;
  let repairs = 0;
  let validated = 0;

  for (const step of props.steps) {
    if (["openai", "groq", "gemini"].includes(step.method)) {
      providers.add(step.method);
    }

    if (step.status === "failed") failures += 1;
    if (step.status === "fallback") fallbacks += 1;
    if (step.status === "repaired") repairs += 1;
    if (step.status === "validated") validated += 1;
  }

  return {
    providers: [...providers],
    failures,
    fallbacks,
    repairs,
    validated,
  };
});

const summaryBadges = computed(() => {
  const badges = [
    {
      label: `${props.steps.length} ${props.steps.length === 1 ? "step" : "steps"}`,
      tone: "neutral",
      icon: History,
    },
  ];

  for (const provider of journeyStats.value.providers) {
    badges.push({
      label: `${providerDisplayName(provider)} used`,
      tone: "ai",
      icon: Sparkles,
    });
  }

  if (journeyStats.value.fallbacks > 0) {
    badges.push({
      label: `${journeyStats.value.fallbacks} fallback`,
      tone: "warning",
      icon: RefreshCw,
    });
  }

  if (journeyStats.value.repairs > 0) {
    badges.push({
      label: `${journeyStats.value.repairs} repair`,
      tone: "repair",
      icon: Wrench,
    });
  }

  if (journeyStats.value.failures > 0) {
    badges.push({
      label: `${journeyStats.value.failures} failed step`,
      tone: "danger",
      icon: AlertCircle,
    });
  }

  if (journeyStats.value.validated > 0) {
    badges.push({
      label: "Validation passed",
      tone: "success",
      icon: CheckCircle2,
    });
  }

  return badges;
});

watch(isOpen, (open) => {
  if (!import.meta.client) return;

  document.body.style.overflow = open ? "hidden" : "";
});

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.body.style.overflow = "";
  }
});

function openJourney() {
  if (props.steps.length > 0) {
    isOpen.value = true;
  }
}

function closeJourney() {
  isOpen.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeJourney();
  }
}

function providerDisplayName(provider: string) {
  if (provider === "openai") return "OpenAI";
  if (provider === "groq") return "Groq";
  if (provider === "gemini") return "Gemini";

  return provider;
}

function statusLabel(status: ExecutionJourneyStatus) {
  return {
    completed: "Completed",
    skipped: "Skipped",
    failed: "Failed",
    fallback: "Fallback",
    repaired: "Repaired",
    validated: "Validated",
  }[status];
}

function methodLabel(method: ExecutionJourneyMethod) {
  return {
    deterministic: "Deterministic",
    openai: "OpenAI",
    groq: "Groq",
    gemini: "Gemini",
    validation: "Validation",
    normalization: "Normalization",
    safety: "Safety",
    mixed: "Mixed",
  }[method];
}

function statusIcon(status: ExecutionJourneyStatus): Component {
  return {
    completed: CheckCircle2,
    skipped: CircleDot,
    failed: AlertCircle,
    fallback: RefreshCw,
    repaired: Wrench,
    validated: ShieldCheck,
  }[status];
}

function methodIcon(method: ExecutionJourneyMethod): Component {
  return {
    deterministic: Code2,
    openai: Sparkles,
    groq: Bot,
    gemini: Bot,
    validation: ShieldCheck,
    normalization: GitBranch,
    safety: ShieldCheck,
    mixed: Route,
  }[method];
}

function stageIcon(step: ExecutionJourneyStep): Component {
  if (step.stage === "request") return UserRound;
  if (step.title.toLowerCase().includes("router")) return Route;
  if (step.title.toLowerCase().includes("clarif")) return MessageSquareText;
  if (step.title.toLowerCase().includes("output")) return FileOutput;

  return methodIcon(step.method);
}

function compactText(value: unknown, limit = 320) {
  const text =
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : JSON.stringify(value);

  if (!text) return "No details recorded.";

  return text.length > limit
    ? `${text.slice(0, limit - 1)}…`
    : text;
}

function formatDebugValue(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
</script>

<template>
  <div class="journey-entry">
    <button
      type="button"
      class="journey-launcher"
      :disabled="!steps.length"
      @click="openJourney"
    >
      <span class="journey-launcher-icon">
        <Route :size="17" :stroke-width="2.3" aria-hidden="true" />
      </span>

      <span class="journey-launcher-copy">
        <strong>How this result was created</strong>
        <small v-if="steps.length">
          Follow {{ steps.length }} real execution steps
        </small>
        <small v-else>
          Available after a scenario is compiled
        </small>
      </span>

      <ChevronRight :size="17" :stroke-width="2.3" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="journey-modal">
        <div
          v-if="isOpen"
          class="journey-backdrop"
          role="presentation"
          @click.self="closeJourney"
          @keydown="handleKeydown"
        >
          <section
            class="journey-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="execution-journey-title"
            tabindex="-1"
          >
            <header class="journey-modal-header">
              <div class="journey-title-wrap">
                <span class="journey-title-icon">
                  <Route :size="23" :stroke-width="2.2" aria-hidden="true" />
                </span>

                <div>
                  <p class="journey-kicker">Execution journey</p>
                  <h2 id="execution-journey-title">
                    How this result was created
                  </h2>
                  <p class="journey-subtitle">
                    Follow the scenario from the original request through
                    routing, agent decisions, repairs, validation, and final
                    output.
                  </p>
                </div>
              </div>

              <button
                type="button"
                class="journey-close"
                aria-label="Close execution journey"
                @click="closeJourney"
              >
                <X :size="20" :stroke-width="2.3" aria-hidden="true" />
              </button>
            </header>

            <div class="journey-summary">
              <span
                v-for="badge in summaryBadges"
                :key="badge.label"
                class="journey-summary-badge"
                :class="`tone-${badge.tone}`"
              >
                <component
                  :is="badge.icon"
                  :size="14"
                  :stroke-width="2.3"
                  aria-hidden="true"
                />
                {{ badge.label }}
              </span>
            </div>

            <div class="journey-modal-body">
              <div v-if="steps.length" class="journey-timeline">
                <article
                  v-for="step in steps"
                  :key="step.id"
                  class="journey-step"
                  :class="[
                    `status-${step.status}`,
                    `method-${step.method}`,
                  ]"
                >
                  <div class="journey-track" aria-hidden="true">
                    <span class="journey-step-number">{{ step.order }}</span>
                    <span class="journey-track-line" />
                  </div>

                  <div class="journey-step-card">
                    <header class="journey-step-header">
                      <div class="journey-step-heading">
                        <span class="journey-stage-icon">
                          <component
                            :is="stageIcon(step)"
                            :size="19"
                            :stroke-width="2.2"
                            aria-hidden="true"
                          />
                        </span>

                        <div>
                          <span class="journey-stage-label">
                            {{ step.stage }}
                          </span>
                          <h3>{{ step.title }}</h3>
                        </div>
                      </div>

                      <div class="journey-step-badges">
                        <span
                          class="journey-step-badge"
                          :class="`status-${step.status}`"
                        >
                          <component
                            :is="statusIcon(step.status)"
                            :size="13"
                            :stroke-width="2.4"
                            aria-hidden="true"
                          />
                          {{ statusLabel(step.status) }}
                        </span>

                        <span
                          class="journey-step-badge method-badge"
                          :class="`method-${step.method}`"
                        >
                          <component
                            :is="methodIcon(step.method)"
                            :size="13"
                            :stroke-width="2.3"
                            aria-hidden="true"
                          />
                          {{ methodLabel(step.method) }}
                        </span>
                      </div>
                    </header>

                    <p class="journey-purpose">{{ step.purpose }}</p>

                    <div
                      v-if="step.function_names?.length"
                      class="journey-functions"
                    >
                      <span>Functions</span>
                      <code
                        v-for="functionName in step.function_names"
                        :key="functionName"
                      >
                        {{ functionName }}
                      </code>
                    </div>

                    <div class="journey-main-grid">
                      <section class="journey-section input-section">
                        <h4>
                          <MessageSquareText
                            :size="15"
                            :stroke-width="2.2"
                            aria-hidden="true"
                          />
                          Input received
                        </h4>

                        <dl class="journey-values">
                          <div
                            v-for="item in step.input_summary"
                            :key="item.label"
                          >
                            <dt>{{ item.label }}</dt>
                            <dd>{{ item.value }}</dd>
                          </div>
                        </dl>
                      </section>

                      <section class="journey-section action-section">
                        <h4>
                          <Sparkles
                            :size="15"
                            :stroke-width="2.2"
                            aria-hidden="true"
                          />
                          What happened
                        </h4>

                        <ul>
                          <li
                            v-for="action in step.actions"
                            :key="action"
                          >
                            {{ action }}
                          </li>
                        </ul>
                      </section>

                      <section class="journey-section output-section">
                        <h4>
                          <FileOutput
                            :size="15"
                            :stroke-width="2.2"
                            aria-hidden="true"
                          />
                          Output produced
                        </h4>

                        <dl class="journey-values">
                          <div
                            v-for="item in step.output_summary"
                            :key="item.label"
                          >
                            <dt>{{ item.label }}</dt>
                            <dd>{{ item.value }}</dd>
                          </div>
                        </dl>
                      </section>
                    </div>

                    <section
                      v-if="step.field_explanations?.length"
                      class="journey-reason-section"
                    >
                      <h4>Why these outputs are needed</h4>

                      <div class="journey-field-grid">
                        <article
                          v-for="item in step.field_explanations"
                          :key="`${item.field}-${item.used_by}`"
                          class="journey-field-card"
                        >
                          <code>{{ item.field }}</code>
                          <p>{{ item.reason }}</p>
                          <span v-if="item.used_by">
                            Used by {{ item.used_by }}
                          </span>
                        </article>
                      </div>
                    </section>

                    <div class="journey-secondary-grid">
                      <section
                        v-if="step.requirements?.length"
                        class="journey-quiet-section"
                      >
                        <h4>Requires</h4>
                        <ul>
                          <li
                            v-for="requirement in step.requirements"
                            :key="requirement"
                          >
                            {{ requirement }}
                          </li>
                        </ul>
                      </section>

                      <section
                        v-if="step.limitations?.length"
                        class="journey-quiet-section limitation-section"
                      >
                        <h4>Limitations</h4>
                        <ul>
                          <li
                            v-for="limitation in step.limitations"
                            :key="limitation"
                          >
                            {{ limitation }}
                          </li>
                        </ul>
                      </section>
                    </div>

                    <section
                      v-if="step.next_step"
                      class="journey-next"
                    >
                      <span class="journey-next-icon">
                        <ChevronRight
                          :size="16"
                          :stroke-width="2.5"
                          aria-hidden="true"
                        />
                      </span>

                      <div>
                        <span>Next step</span>
                        <strong>{{ step.next_step.title }}</strong>
                        <p>{{ step.next_step.reason }}</p>
                      </div>
                    </section>

                    <details
                      v-if="
                        step.raw_input !== undefined ||
                        step.raw_output !== undefined
                      "
                      class="journey-raw"
                    >
                      <summary>
                        <ChevronDown
                          :size="15"
                          :stroke-width="2.3"
                          aria-hidden="true"
                        />
                        View technical data
                      </summary>

                      <div class="journey-raw-grid">
                        <section v-if="step.raw_input !== undefined">
                          <strong>Raw input</strong>
                          <pre>{{ formatDebugValue(step.raw_input) }}</pre>
                        </section>

                        <section v-if="step.raw_output !== undefined">
                          <strong>Raw output</strong>
                          <pre>{{ formatDebugValue(step.raw_output) }}</pre>
                        </section>
                      </div>
                    </details>
                  </div>
                </article>
              </div>

              <div v-else class="journey-empty">
                <Route :size="28" :stroke-width="1.8" aria-hidden="true" />
                <h3>No execution journey yet</h3>
                <p>
                  Compile a scenario to see how the result was created.
                </p>
              </div>

              <details
                v-if="job?.agent_trace?.length"
                class="journey-technical-trace"
              >
                <summary>
                  <History
                    :size="16"
                    :stroke-width="2.2"
                    aria-hidden="true"
                  />
                  Technical event trace
                  <span>{{ job.agent_trace.length }}</span>
                </summary>

                <div class="trace-list">
                  <article
                    v-for="(event, index) in job.agent_trace"
                    :key="event.id || index"
                    class="trace-item"
                  >
                    <div class="trace-head">
                      <strong>
                        {{
                          event.action ||
                          event.tool_name ||
                          `Trace ${index + 1}`
                        }}
                      </strong>

                      <span>
                        {{ event.status || "completed" }}
                      </span>
                    </div>

                    <p>
                      {{
                        compactText(
                          event.output_summary ||
                            event.input_summary ||
                            event.reason ||
                            "Completed",
                        )
                      }}
                    </p>

                    <details v-if="event.reason || event.metadata">
                      <summary>Why / metadata</summary>
                      <pre>{{
                        formatDebugValue({
                          reason: event.reason,
                          metadata: event.metadata,
                        })
                      }}</pre>
                    </details>
                  </article>
                </div>
              </details>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.journey-entry {
  padding: 14px 14px 0;
}

.journey-launcher {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(99, 102, 241, 0.22);
  border-radius: 14px;
  padding: 10px 12px;
  background:
    linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.04)),
    var(--panel, #ffffff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.journey-launcher:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(99, 102, 241, 0.4);
  box-shadow: 0 10px 25px rgba(79, 70, 229, 0.11);
}

.journey-launcher:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.journey-launcher-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
}

.journey-launcher-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.journey-launcher-copy strong {
  font-size: 0.8rem;
  line-height: 1.2;
}

.journey-launcher-copy small {
  color: #64748b;
  font-size: 0.68rem;
  line-height: 1.25;
}

.journey-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(8px);
}

.journey-modal {
  width: min(1400px, calc(100vw - 36px));
  height: min(92vh, calc(100vh - 36px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 22px;
  background: #f8fafc;
  color: #0f172a;
  box-shadow: 0 34px 90px rgba(15, 23, 42, 0.3);
}

.journey-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.95);
}

.journey-title-wrap {
  min-width: 0;
  display: flex;
  gap: 14px;
}

.journey-title-icon {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #ffffff;
  box-shadow: 0 10px 24px rgba(99, 102, 241, 0.25);
}

.journey-kicker {
  margin: 0 0 3px;
  color: #6366f1;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.journey-modal-header h2 {
  margin: 0;
  font-size: clamp(1.25rem, 2vw, 1.7rem);
  line-height: 1.15;
}

.journey-subtitle {
  max-width: 760px;
  margin: 6px 0 0;
  color: #64748b;
  font-size: 0.82rem;
  line-height: 1.5;
}

.journey-close {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
}

.journey-close:hover {
  border-color: #cbd5e1;
  color: #0f172a;
}

.journey-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
  background: #ffffff;
}

.journey-summary-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 9px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.68rem;
  font-weight: 700;
}

.journey-summary-badge.tone-ai {
  background: #f3e8ff;
  color: #7e22ce;
}

.journey-summary-badge.tone-warning,
.journey-summary-badge.tone-repair {
  background: #ffedd5;
  color: #c2410c;
}

.journey-summary-badge.tone-danger {
  background: #fee2e2;
  color: #b91c1c;
}

.journey-summary-badge.tone-success {
  background: #dcfce7;
  color: #15803d;
}

.journey-modal-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 26px clamp(16px, 3vw, 38px) 40px;
}

.journey-timeline {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.journey-step {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 14px;
}

.journey-track {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.journey-step-number {
  position: relative;
  z-index: 1;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 3px solid #f8fafc;
  border-radius: 50%;
  background: #e2e8f0;
  color: #475569;
  font-size: 0.72rem;
  font-weight: 800;
  box-shadow: 0 0 0 1px #cbd5e1;
}

.journey-track-line {
  width: 2px;
  flex: 1;
  min-height: 24px;
  background: linear-gradient(#cbd5e1, #e2e8f0);
}

.journey-step:last-child .journey-track-line {
  display: none;
}

.journey-step.status-failed .journey-step-number {
  background: #fee2e2;
  color: #b91c1c;
  box-shadow: 0 0 0 1px #fca5a5;
}

.journey-step.status-fallback .journey-step-number,
.journey-step.status-repaired .journey-step-number {
  background: #ffedd5;
  color: #c2410c;
  box-shadow: 0 0 0 1px #fdba74;
}

.journey-step.status-validated .journey-step-number,
.journey-step.status-completed .journey-step-number {
  background: #dcfce7;
  color: #15803d;
  box-shadow: 0 0 0 1px #86efac;
}

.journey-step-card {
  min-width: 0;
  margin-bottom: 22px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #94a3b8;
  border-radius: 17px;
  background: #ffffff;
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.05);
}

.journey-step.method-openai .journey-step-card,
.journey-step.method-groq .journey-step-card,
.journey-step.method-gemini .journey-step-card {
  border-left-color: #8b5cf6;
}

.journey-step.method-deterministic .journey-step-card,
.journey-step.method-normalization .journey-step-card {
  border-left-color: #3b82f6;
}

.journey-step.method-safety .journey-step-card {
  border-left-color: #f59e0b;
}

.journey-step.status-failed .journey-step-card {
  border-left-color: #ef4444;
}

.journey-step.status-repaired .journey-step-card,
.journey-step.status-fallback .journey-step-card {
  border-left-color: #f97316;
}

.journey-step.status-validated .journey-step-card {
  border-left-color: #22c55e;
}

.journey-step-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #f1f5f9;
}

.journey-step-heading {
  min-width: 0;
  display: flex;
  gap: 11px;
}

.journey-stage-icon {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #f1f5f9;
  color: #475569;
}

.journey-stage-label {
  display: block;
  margin-bottom: 2px;
  color: #94a3b8;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.journey-step-header h3 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.3;
}

.journey-step-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.journey-step-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  padding: 5px 8px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.64rem;
  font-weight: 800;
}

.journey-step-badge.status-completed,
.journey-step-badge.status-validated {
  background: #dcfce7;
  color: #15803d;
}

.journey-step-badge.status-failed {
  background: #fee2e2;
  color: #b91c1c;
}

.journey-step-badge.status-fallback,
.journey-step-badge.status-repaired {
  background: #ffedd5;
  color: #c2410c;
}

.journey-step-badge.status-skipped {
  background: #f1f5f9;
  color: #64748b;
}

.journey-step-badge.method-openai,
.journey-step-badge.method-groq,
.journey-step-badge.method-gemini {
  background: #f3e8ff;
  color: #7e22ce;
}

.journey-step-badge.method-deterministic,
.journey-step-badge.method-normalization {
  background: #dbeafe;
  color: #1d4ed8;
}

.journey-step-badge.method-safety,
.journey-step-badge.method-validation {
  background: #fef3c7;
  color: #b45309;
}

.journey-purpose {
  margin: 0;
  padding: 14px 20px 0;
  color: #475569;
  font-size: 0.78rem;
  line-height: 1.55;
}

.journey-functions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 12px 20px 0;
}

.journey-functions > span {
  margin-right: 2px;
  color: #94a3b8;
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
}

.journey-functions code,
.journey-field-card code {
  border-radius: 6px;
  padding: 3px 6px;
  background: #eef2ff;
  color: #4338ca;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.68rem;
}

.journey-main-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 20px;
}

.journey-section {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px;
  background: #f8fafc;
}

.input-section {
  background: #f8fafc;
}

.action-section {
  border-color: #ddd6fe;
  background: #faf5ff;
}

.output-section {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.journey-section h4,
.journey-reason-section h4,
.journey-quiet-section h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 9px;
  color: #334155;
  font-size: 0.69rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.journey-section ul,
.journey-quiet-section ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 17px;
  color: #475569;
  font-size: 0.72rem;
  line-height: 1.45;
}

.journey-values {
  display: grid;
  gap: 8px;
  margin: 0;
}

.journey-values div {
  min-width: 0;
}

.journey-values dt {
  margin-bottom: 2px;
  color: #94a3b8;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.journey-values dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #334155;
  font-size: 0.72rem;
  line-height: 1.45;
}

.journey-reason-section {
  margin: 0 20px 16px;
  border: 1px solid #c7d2fe;
  border-radius: 13px;
  padding: 13px;
  background: #eef2ff;
}

.journey-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.journey-field-card {
  min-width: 0;
  border-radius: 10px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.72);
}

.journey-field-card p {
  margin: 7px 0 0;
  color: #475569;
  font-size: 0.7rem;
  line-height: 1.45;
}

.journey-field-card span {
  display: block;
  margin-top: 6px;
  color: #6366f1;
  font-size: 0.62rem;
  font-weight: 700;
}

.journey-secondary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 0 20px 16px;
}

.journey-quiet-section {
  border-radius: 11px;
  padding: 11px 12px;
  background: #f8fafc;
}

.limitation-section {
  background: #fff7ed;
}

.journey-next {
  display: flex;
  gap: 10px;
  margin: 0 20px 16px;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  padding: 11px 12px;
  background: #eff6ff;
}

.journey-next-icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #dbeafe;
  color: #2563eb;
}

.journey-next div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.journey-next div > span {
  color: #94a3b8;
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
}

.journey-next strong {
  color: #1e3a8a;
  font-size: 0.75rem;
}

.journey-next p {
  margin: 0;
  color: #475569;
  font-size: 0.7rem;
  line-height: 1.4;
}

.journey-raw {
  margin: 0 20px 18px;
  border-top: 1px solid #e2e8f0;
  padding-top: 12px;
}

.journey-raw summary,
.journey-technical-trace > summary {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #64748b;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  list-style: none;
}

.journey-raw summary::-webkit-details-marker,
.journey-technical-trace > summary::-webkit-details-marker {
  display: none;
}

.journey-raw[open] summary svg {
  transform: rotate(180deg);
}

.journey-raw-grid {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.journey-raw-grid section {
  min-width: 0;
}

.journey-raw-grid strong {
  display: block;
  margin-bottom: 5px;
  color: #475569;
  font-size: 0.65rem;
}

.journey-raw pre,
.trace-item pre {
  max-height: 330px;
  margin: 0;
  overflow: auto;
  border-radius: 10px;
  padding: 11px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.65rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.journey-technical-trace {
  width: min(1180px, 100%);
  margin: 8px auto 0;
  border: 1px solid #cbd5e1;
  border-radius: 14px;
  padding: 13px 15px;
  background: #ffffff;
}

.journey-technical-trace > summary span {
  margin-left: auto;
  border-radius: 999px;
  padding: 3px 7px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.62rem;
}

.trace-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.trace-item {
  border: 1px solid #e2e8f0;
  border-radius: 11px;
  padding: 10px 12px;
  background: #f8fafc;
}

.trace-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.trace-head strong {
  color: #334155;
  font-size: 0.72rem;
}

.trace-head span {
  color: #64748b;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: capitalize;
}

.trace-item > p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 0.69rem;
  line-height: 1.45;
}

.trace-item details {
  margin-top: 8px;
}

.trace-item details summary {
  color: #6366f1;
  font-size: 0.66rem;
  cursor: pointer;
}

.trace-item pre {
  margin-top: 7px;
}

.journey-empty {
  width: min(560px, 100%);
  margin: 80px auto;
  display: grid;
  justify-items: center;
  gap: 8px;
  color: #64748b;
  text-align: center;
}

.journey-empty h3,
.journey-empty p {
  margin: 0;
}

.journey-empty h3 {
  color: #334155;
}

.journey-empty p {
  font-size: 0.78rem;
}

.journey-modal-enter-active,
.journey-modal-leave-active {
  transition: opacity 180ms ease;
}

.journey-modal-enter-active .journey-modal,
.journey-modal-leave-active .journey-modal {
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.journey-modal-enter-from,
.journey-modal-leave-to {
  opacity: 0;
}

.journey-modal-enter-from .journey-modal,
.journey-modal-leave-to .journey-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.985);
}

@media (max-width: 900px) {
  .journey-backdrop {
    padding: 8px;
  }

  .journey-modal {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    border-radius: 16px;
  }

  .journey-main-grid {
    grid-template-columns: 1fr;
  }

  .journey-field-grid,
  .journey-secondary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .journey-modal-header {
    padding: 16px;
  }

  .journey-title-icon {
    display: none;
  }

  .journey-summary {
    padding: 10px 16px;
  }

  .journey-modal-body {
    padding: 18px 10px 28px;
  }

  .journey-step {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 7px;
  }

  .journey-step-number {
    width: 28px;
    height: 28px;
    font-size: 0.65rem;
  }

  .journey-step-header {
    display: grid;
    padding: 14px;
  }

  .journey-step-badges {
    justify-content: flex-start;
  }

  .journey-purpose,
  .journey-functions {
    padding-left: 14px;
    padding-right: 14px;
  }

  .journey-main-grid {
    padding: 14px;
  }

  .journey-reason-section,
  .journey-next,
  .journey-raw {
    margin-left: 14px;
    margin-right: 14px;
  }

  .journey-secondary-grid {
    padding-left: 14px;
    padding-right: 14px;
  }
}


/* FlowForge dark-theme and readability overrides */
.journey-launcher {
  border-color: rgba(102, 227, 255, 0.28);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.13), transparent 9rem),
    rgba(255, 255, 255, 0.045);
  color: #eef3ff;
  box-shadow: none;
}

.journey-launcher:hover:not(:disabled) {
  border-color: rgba(102, 227, 255, 0.58);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.18), transparent 9rem),
    rgba(102, 227, 255, 0.07);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
}

.journey-launcher-icon {
  background: rgba(102, 227, 255, 0.1);
  color: #66e3ff;
}

.journey-launcher-copy strong {
  color: #eef3ff;
  font-size: 0.86rem;
}

.journey-launcher-copy small {
  color: #9ba9d8;
  font-size: 0.74rem;
}

.journey-backdrop {
  background: rgba(2, 4, 10, 0.82);
  backdrop-filter: blur(10px);
}

.journey-modal {
  border-color: rgba(145, 166, 255, 0.22);
  background:
    radial-gradient(circle at top right, rgba(125, 140, 255, 0.08), transparent 28rem),
    #080c16;
  color: #eef3ff;
  box-shadow: 0 34px 100px rgba(0, 0, 0, 0.58);
}

.journey-modal-header {
  border-bottom-color: rgba(145, 166, 255, 0.16);
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.1), transparent 18rem),
    rgba(8, 12, 22, 0.97);
}

.journey-title-icon {
  background: linear-gradient(135deg, #66e3ff, #7d8cff);
  color: #07101a;
  box-shadow: 0 12px 28px rgba(102, 227, 255, 0.2);
}

.journey-kicker {
  color: #66e3ff;
  font-size: 0.74rem;
}

.journey-modal-header h2 {
  color: #f4f7ff;
  font-size: clamp(1.45rem, 2.3vw, 2rem);
}

.journey-subtitle {
  max-width: 850px;
  color: #aab7df;
  font-size: 0.92rem;
  line-height: 1.6;
}

.journey-close {
  border-color: rgba(145, 166, 255, 0.2);
  background: rgba(255, 255, 255, 0.045);
  color: #cbd6f7;
}

.journey-close:hover {
  border-color: rgba(102, 227, 255, 0.5);
  background: rgba(102, 227, 255, 0.08);
  color: #ffffff;
}

.journey-summary {
  border-bottom-color: rgba(145, 166, 255, 0.14);
  background: rgba(7, 10, 18, 0.92);
}

.journey-summary-badge {
  border: 1px solid rgba(145, 166, 255, 0.16);
  background: rgba(255, 255, 255, 0.045);
  color: #b9c7ed;
  font-size: 0.74rem;
}

.journey-summary-badge.tone-ai {
  border-color: rgba(125, 140, 255, 0.3);
  background: rgba(125, 140, 255, 0.11);
  color: #b9c3ff;
}

.journey-summary-badge.tone-warning,
.journey-summary-badge.tone-repair {
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.09);
  color: #ffd166;
}

.journey-summary-badge.tone-danger {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.09);
  color: #ff9a9a;
}

.journey-summary-badge.tone-success {
  border-color: rgba(67, 224, 166, 0.28);
  background: rgba(67, 224, 166, 0.09);
  color: #43e0a6;
}

.journey-modal-body {
  background: transparent;
  padding-top: 30px;
}

.journey-step-number {
  border-color: #080c16;
  background: #171d2c;
  color: #aebbe1;
  box-shadow: 0 0 0 1px rgba(145, 166, 255, 0.25);
  font-size: 0.78rem;
}

.journey-track-line {
  background: linear-gradient(rgba(102, 227, 255, 0.34), rgba(145, 166, 255, 0.1));
}

.journey-step.status-failed .journey-step-number {
  background: rgba(255, 107, 107, 0.14);
  color: #ff9a9a;
  box-shadow: 0 0 0 1px rgba(255, 107, 107, 0.42);
}

.journey-step.status-fallback .journey-step-number,
.journey-step.status-repaired .journey-step-number {
  background: rgba(255, 209, 102, 0.13);
  color: #ffd166;
  box-shadow: 0 0 0 1px rgba(255, 209, 102, 0.38);
}

.journey-step.status-validated .journey-step-number,
.journey-step.status-completed .journey-step-number {
  background: rgba(67, 224, 166, 0.13);
  color: #43e0a6;
  box-shadow: 0 0 0 1px rgba(67, 224, 166, 0.36);
}

.journey-step-card {
  border-color: rgba(145, 166, 255, 0.16);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.9);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.journey-step-header {
  padding: 22px 24px 18px;
  border-bottom-color: rgba(145, 166, 255, 0.12);
}

.journey-stage-icon {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(102, 227, 255, 0.18);
  background: rgba(102, 227, 255, 0.07);
  color: #66e3ff;
}

.journey-stage-label {
  color: #7d8cff;
  font-size: 0.7rem;
}

.journey-step-header h3 {
  color: #f1f5ff;
  font-size: 1.16rem;
}

.journey-step-badge {
  border: 1px solid rgba(145, 166, 255, 0.16);
  background: rgba(255, 255, 255, 0.045);
  color: #b6c2e5;
  font-size: 0.72rem;
}

.journey-step-badge.status-completed,
.journey-step-badge.status-validated {
  border-color: rgba(67, 224, 166, 0.28);
  background: rgba(67, 224, 166, 0.09);
  color: #43e0a6;
}

.journey-step-badge.status-failed {
  border-color: rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.09);
  color: #ff9a9a;
}

.journey-step-badge.status-fallback,
.journey-step-badge.status-repaired {
  border-color: rgba(255, 209, 102, 0.3);
  background: rgba(255, 209, 102, 0.09);
  color: #ffd166;
}

.journey-step-badge.status-skipped {
  color: #8e9bc2;
}

.journey-step-badge.method-openai,
.journey-step-badge.method-groq,
.journey-step-badge.method-gemini {
  border-color: rgba(125, 140, 255, 0.3);
  background: rgba(125, 140, 255, 0.1);
  color: #b9c3ff;
}

.journey-step-badge.method-deterministic,
.journey-step-badge.method-normalization {
  border-color: rgba(102, 227, 255, 0.26);
  background: rgba(102, 227, 255, 0.08);
  color: #9decff;
}

.journey-step-badge.method-safety,
.journey-step-badge.method-validation {
  border-color: rgba(255, 209, 102, 0.28);
  background: rgba(255, 209, 102, 0.08);
  color: #ffd166;
}

.journey-purpose {
  padding: 18px 24px 0;
  color: #b6c2e5;
  font-size: 0.92rem;
  line-height: 1.65;
}

.journey-functions {
  padding: 14px 24px 0;
}

.journey-functions > span {
  color: #7d8cff;
  font-size: 0.68rem;
}

.journey-functions code,
.journey-field-card code {
  background: rgba(125, 140, 255, 0.1);
  color: #bdc6ff;
  font-size: 0.75rem;
}

.journey-main-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 20px 24px;
}

.action-section {
  grid-column: 1 / -1;
}

.journey-section {
  border-color: rgba(145, 166, 255, 0.15);
  padding: 16px;
  background: rgba(255, 255, 255, 0.032);
}

.input-section {
  background: rgba(102, 227, 255, 0.045);
}

.action-section {
  border-color: rgba(125, 140, 255, 0.22);
  background: rgba(125, 140, 255, 0.055);
}

.output-section {
  border-color: rgba(67, 224, 166, 0.2);
  background: rgba(67, 224, 166, 0.045);
}

.journey-section h4,
.journey-reason-section h4,
.journey-quiet-section h4 {
  color: #dbe4ff;
  font-size: 0.8rem;
}

.journey-section ul,
.journey-quiet-section ul {
  gap: 8px;
  color: #b5c1e3;
  font-size: 0.84rem;
  line-height: 1.58;
}

.journey-values {
  gap: 11px;
}

.journey-values dt {
  color: #7d8cff;
  font-size: 0.67rem;
}

.journey-values dd {
  color: #d7e0fa;
  font-size: 0.84rem;
  line-height: 1.58;
}

.journey-reason-section {
  margin: 0 24px 20px;
  border-color: rgba(125, 140, 255, 0.22);
  padding: 16px;
  background: rgba(125, 140, 255, 0.06);
}

.journey-field-grid {
  gap: 11px;
}

.journey-field-card {
  border: 1px solid rgba(145, 166, 255, 0.12);
  background: rgba(255, 255, 255, 0.035);
}

.journey-field-card p {
  color: #b6c2e5;
  font-size: 0.82rem;
  line-height: 1.58;
}

.journey-field-card span {
  color: #66e3ff;
  font-size: 0.7rem;
}

.journey-secondary-grid {
  gap: 12px;
  padding: 0 24px 20px;
}

.journey-quiet-section {
  border: 1px solid rgba(145, 166, 255, 0.12);
  background: rgba(255, 255, 255, 0.028);
}

.limitation-section {
  border-color: rgba(255, 209, 102, 0.18);
  background: rgba(255, 209, 102, 0.045);
}

.journey-next {
  margin: 0 24px 20px;
  border-color: rgba(102, 227, 255, 0.24);
  padding: 14px 15px;
  background: rgba(102, 227, 255, 0.055);
}

.journey-next-icon {
  background: rgba(102, 227, 255, 0.1);
  color: #66e3ff;
}

.journey-next div > span {
  color: #7d8cff;
  font-size: 0.66rem;
}

.journey-next strong {
  color: #eef3ff;
  font-size: 0.87rem;
}

.journey-next p {
  color: #aebbe1;
  font-size: 0.8rem;
  line-height: 1.5;
}

.journey-raw {
  margin: 0 24px 22px;
  border-top-color: rgba(145, 166, 255, 0.15);
}

.journey-raw summary,
.journey-technical-trace > summary {
  color: #9ba9d8;
  font-size: 0.78rem;
}

.journey-raw pre,
.trace-item pre {
  background: #04070d;
  color: #dbe4ff;
  font-size: 0.74rem;
  line-height: 1.6;
}

.journey-technical-trace {
  border-color: rgba(145, 166, 255, 0.18);
  background: rgba(8, 12, 22, 0.88);
}

.journey-technical-trace > summary span {
  background: rgba(255, 255, 255, 0.045);
  color: #b7c3e7;
}

.trace-item {
  border-color: rgba(145, 166, 255, 0.13);
  background: rgba(255, 255, 255, 0.028);
}

.trace-head strong {
  color: #dfe7ff;
  font-size: 0.8rem;
}

.trace-head span {
  color: #8f9cc4;
  font-size: 0.7rem;
}

.trace-item > p {
  color: #aebbe1;
  font-size: 0.8rem;
  line-height: 1.55;
}

.trace-item details summary {
  color: #66e3ff;
  font-size: 0.73rem;
}

.journey-empty {
  color: #9ba9d8;
}

.journey-empty h3 {
  color: #eef3ff;
}

@media (max-width: 900px) {
  .journey-main-grid {
    grid-template-columns: 1fr;
  }

  .action-section {
    grid-column: auto;
  }
}

</style>