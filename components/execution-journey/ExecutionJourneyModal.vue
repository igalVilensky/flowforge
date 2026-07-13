<script setup lang="ts">
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  FileOutput,
  GitBranch,
  History,
  ListChecks,
  Maximize2,
  MessageSquareText,
  Minimize2,
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
const expandedIds = ref<Set<string>>(new Set());
const stepRefs = new Map<string, HTMLElement>();

// Open the first step by default so the modal never lands on an entirely
// empty, unreadable wall of collapsed cards.
watch(
  () => props.steps,
  (steps) => {
    const firstStep = steps.at(0);

    expandedIds.value = firstStep
      ? new Set([firstStep.id])
      : new Set<string>();
  },
  { immediate: true },
);

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

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function formatDebugValue(value: unknown) {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isExpanded(id: string) {
  return expandedIds.value.has(id);
}

function toggleStep(id: string) {
  const next = new Set(expandedIds.value);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  expandedIds.value = next;
}

function expandAll() {
  expandedIds.value = new Set(props.steps.map((step) => step.id));
}

function collapseAll() {
  expandedIds.value = new Set();
}

function registerStepRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) {
    stepRefs.set(id, el);
  } else {
    stepRefs.delete(id);
  }
}

function goToStep(id: string) {
  if (!expandedIds.value.has(id)) {
    toggleStep(id);
  }

  nextTick(() => {
    stepRefs.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
        <small v-else> Available after a scenario is compiled </small>
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

              <div v-if="steps.length" class="journey-summary-actions">
                <button type="button" @click="expandAll">
                  <Maximize2
                    :size="13"
                    :stroke-width="2.4"
                    aria-hidden="true"
                  />
                  Expand all
                </button>
                <button type="button" @click="collapseAll">
                  <Minimize2
                    :size="13"
                    :stroke-width="2.4"
                    aria-hidden="true"
                  />
                  Collapse all
                </button>
              </div>
            </div>

            <div class="journey-modal-body">
              <div v-if="steps.length" class="journey-layout">
                <nav class="journey-nav" aria-label="Jump to step">
                  <button
                    v-for="step in steps"
                    :key="step.id"
                    type="button"
                    class="journey-nav-item"
                    :class="[
                      `status-${step.status}`,
                      { 'is-active': isExpanded(step.id) },
                    ]"
                    @click="goToStep(step.id)"
                  >
                    <span class="journey-nav-dot">{{ step.order }}</span>
                    <span class="journey-nav-copy">
                      <strong>{{ step.title }}</strong>
                      <small
                        >{{ methodLabel(step.method) }} ·
                        {{ statusLabel(step.status) }}</small
                      >
                    </span>
                  </button>
                </nav>

                <div class="journey-timeline">
                  <article
                    v-for="step in steps"
                    :key="step.id"
                    :ref="(el) => registerStepRef(step.id, el)"
                    class="journey-step"
                    :class="[`status-${step.status}`, `method-${step.method}`]"
                  >
                    <div class="journey-track" aria-hidden="true">
                      <span class="journey-step-number">{{ step.order }}</span>
                      <span class="journey-track-line" />
                    </div>

                    <div class="journey-step-card">
                      <div
                        class="journey-step-header"
                        role="button"
                        tabindex="0"
                        :aria-expanded="isExpanded(step.id)"
                        @click="toggleStep(step.id)"
                        @keydown.enter.prevent="toggleStep(step.id)"
                        @keydown.space.prevent="toggleStep(step.id)"
                      >
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
                            <p class="journey-step-preview">
                              {{ step.purpose }}
                            </p>
                          </div>
                        </div>

                        <div class="journey-step-header-end">
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

                          <span
                            class="journey-toggle"
                            :class="{ 'is-open': isExpanded(step.id) }"
                          >
                            <ChevronDown
                              :size="18"
                              :stroke-width="2.4"
                              aria-hidden="true"
                            />
                          </span>
                        </div>
                      </div>

                      <div
                        v-show="isExpanded(step.id)"
                        class="journey-step-body"
                      >
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

                        <div class="journey-flow">
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

                          <span class="journey-flow-arrow" aria-hidden="true">
                            <ArrowRight :size="17" :stroke-width="2.4" />
                          </span>

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
                              <li v-for="action in step.actions" :key="action">
                                {{ action }}
                              </li>
                            </ul>
                          </section>

                          <span class="journey-flow-arrow" aria-hidden="true">
                            <ArrowRight :size="17" :stroke-width="2.4" />
                          </span>

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
                            <h4>
                              <ListChecks
                                :size="14"
                                :stroke-width="2.3"
                                aria-hidden="true"
                              />
                              Requires
                            </h4>
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
                            <h4>
                              <AlertTriangle
                                :size="14"
                                :stroke-width="2.3"
                                aria-hidden="true"
                              />
                              Limitations
                            </h4>
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

                        <section v-if="step.next_step" class="journey-next">
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
                    </div>
                  </article>

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
              </div>

              <div v-else class="journey-empty">
                <Route :size="28" :stroke-width="1.8" aria-hidden="true" />
                <h3>No execution journey yet</h3>
                <p>Compile a scenario to see how the result was created.</p>
              </div>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ---------- Launcher ---------- */

.journey-entry {
  padding: 14px 14px 0;
}

.journey-launcher {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(102, 227, 255, 0.28);
  border-radius: 14px;
  padding: 10px 12px;
  background:
    radial-gradient(
      circle at top right,
      rgba(102, 227, 255, 0.13),
      transparent 9rem
    ),
    rgba(255, 255, 255, 0.045);
  color: #eef3ff;
  text-align: left;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.journey-launcher:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(102, 227, 255, 0.58);
  background:
    radial-gradient(
      circle at top right,
      rgba(102, 227, 255, 0.18),
      transparent 9rem
    ),
    rgba(102, 227, 255, 0.07);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
}

.journey-launcher:focus-visible {
  outline: 2px solid #66e3ff;
  outline-offset: 2px;
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
  background: rgba(102, 227, 255, 0.1);
  color: #66e3ff;
}

.journey-launcher-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.journey-launcher-copy strong {
  color: #eef3ff;
  font-size: 0.86rem;
  line-height: 1.2;
}

.journey-launcher-copy small {
  color: #9ba9d8;
  font-size: 0.74rem;
  line-height: 1.25;
}

/* ---------- Backdrop & modal shell ---------- */

.journey-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 4, 10, 0.82);
  backdrop-filter: blur(10px);
}

.journey-modal {
  width: min(1400px, calc(100vw - 36px));
  height: min(92vh, calc(100vh - 36px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.22);
  border-radius: 22px;
  background:
    radial-gradient(
      circle at top right,
      rgba(125, 140, 255, 0.08),
      transparent 28rem
    ),
    #080c16;
  color: #eef3ff;
  box-shadow: 0 34px 100px rgba(0, 0, 0, 0.58);
}

.journey-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.16);
  background:
    radial-gradient(
      circle at top right,
      rgba(102, 227, 255, 0.1),
      transparent 18rem
    ),
    rgba(8, 12, 22, 0.97);
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
  background: linear-gradient(135deg, #66e3ff, #7d8cff);
  color: #07101a;
  box-shadow: 0 12px 28px rgba(102, 227, 255, 0.2);
}

.journey-kicker {
  margin: 0 0 3px;
  color: #66e3ff;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.journey-modal-header h2 {
  margin: 0;
  color: #f4f7ff;
  font-size: clamp(1.3rem, 2.2vw, 1.85rem);
  line-height: 1.15;
}

.journey-subtitle {
  max-width: 780px;
  margin: 6px 0 0;
  color: #aab7df;
  font-size: 0.86rem;
  line-height: 1.55;
}

.journey-close {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.045);
  color: #cbd6f7;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    color 140ms ease,
    background 140ms ease;
}

.journey-close:hover {
  border-color: rgba(102, 227, 255, 0.5);
  background: rgba(102, 227, 255, 0.08);
  color: #ffffff;
}

.journey-close:focus-visible {
  outline: 2px solid #66e3ff;
  outline-offset: 2px;
}

/* ---------- Summary bar ---------- */

.journey-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.14);
  background: rgba(7, 10, 18, 0.92);
}

.journey-summary-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.045);
  color: #b9c7ed;
  font-size: 0.72rem;
  font-weight: 700;
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

.journey-summary-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.journey-summary-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(145, 166, 255, 0.2);
  border-radius: 999px;
  padding: 6px 11px;
  background: rgba(255, 255, 255, 0.03);
  color: #cbd6f7;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease;
}

.journey-summary-actions button:hover {
  border-color: rgba(102, 227, 255, 0.5);
  background: rgba(102, 227, 255, 0.08);
  color: #ffffff;
}

.journey-summary-actions button:focus-visible {
  outline: 2px solid #66e3ff;
  outline-offset: 2px;
}

/* ---------- Body layout: nav + timeline ---------- */

.journey-modal-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px clamp(14px, 3vw, 28px) 36px;
}

.journey-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
  max-width: 1320px;
  margin: 0 auto;
}

.journey-nav {
  position: sticky;
  top: 0;
  display: grid;
  gap: 6px;
  max-height: calc(92vh - 210px);
  overflow-y: auto;
  padding-right: 4px;
}

.journey-nav-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(145, 166, 255, 0.14);
  border-radius: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.025);
  color: #b6c2e5;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease;
}

.journey-nav-item:hover {
  border-color: rgba(102, 227, 255, 0.4);
  background: rgba(102, 227, 255, 0.055);
}

.journey-nav-item:focus-visible {
  outline: 2px solid #66e3ff;
  outline-offset: 2px;
}

.journey-nav-item.is-active {
  border-color: rgba(102, 227, 255, 0.5);
  background: rgba(102, 227, 255, 0.08);
}

.journey-nav-dot {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #171d2c;
  color: #aebbe1;
  box-shadow: 0 0 0 1px rgba(145, 166, 255, 0.25);
  font-size: 0.66rem;
  font-weight: 800;
}

.journey-nav-item.status-failed .journey-nav-dot {
  background: rgba(255, 107, 107, 0.14);
  color: #ff9a9a;
  box-shadow: 0 0 0 1px rgba(255, 107, 107, 0.42);
}

.journey-nav-item.status-fallback .journey-nav-dot,
.journey-nav-item.status-repaired .journey-nav-dot {
  background: rgba(255, 209, 102, 0.13);
  color: #ffd166;
  box-shadow: 0 0 0 1px rgba(255, 209, 102, 0.38);
}

.journey-nav-item.status-validated .journey-nav-dot,
.journey-nav-item.status-completed .journey-nav-dot {
  background: rgba(67, 224, 166, 0.13);
  color: #43e0a6;
  box-shadow: 0 0 0 1px rgba(67, 224, 166, 0.36);
}

.journey-nav-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.journey-nav-copy strong {
  overflow: hidden;
  color: #dfe7ff;
  font-size: 0.74rem;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journey-nav-copy small {
  overflow: hidden;
  color: #8f9cc4;
  font-size: 0.63rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- Timeline ---------- */

.journey-timeline {
  min-width: 0;
}

.journey-step {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 12px;
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
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 3px solid #080c16;
  border-radius: 50%;
  background: #171d2c;
  color: #aebbe1;
  box-shadow: 0 0 0 1px rgba(145, 166, 255, 0.25);
  font-size: 0.74rem;
  font-weight: 800;
}

.journey-track-line {
  width: 2px;
  flex: 1;
  min-height: 20px;
  background: linear-gradient(
    rgba(102, 227, 255, 0.34),
    rgba(145, 166, 255, 0.1)
  );
}

.journey-step:last-child .journey-track-line {
  display: none;
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
  min-width: 0;
  margin-bottom: 16px;
  overflow: hidden;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-left: 4px solid #94a3b8;
  border-radius: 16px;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.045),
      rgba(255, 255, 255, 0.025)
    ),
    rgba(8, 12, 22, 0.9);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.journey-step.method-openai .journey-step-card,
.journey-step.method-groq .journey-step-card,
.journey-step.method-gemini .journey-step-card {
  border-left-color: #7d8cff;
}

.journey-step.method-deterministic .journey-step-card,
.journey-step.method-normalization .journey-step-card {
  border-left-color: #66e3ff;
}

.journey-step.method-safety .journey-step-card {
  border-left-color: #ffd166;
}

.journey-step.status-failed .journey-step-card {
  border-left-color: #ff6b6b;
}

.journey-step.status-repaired .journey-step-card,
.journey-step.status-fallback .journey-step-card {
  border-left-color: #ffb454;
}

.journey-step.status-validated .journey-step-card {
  border-left-color: #43e0a6;
}

/* ---------- Step header (always visible, click to expand) ---------- */

.journey-step-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  cursor: pointer;
}

.journey-step-header:focus-visible {
  outline: 2px solid #66e3ff;
  outline-offset: -2px;
}

.journey-step-heading {
  min-width: 0;
  display: flex;
  gap: 12px;
}

.journey-stage-icon {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(102, 227, 255, 0.18);
  border-radius: 10px;
  background: rgba(102, 227, 255, 0.07);
  color: #66e3ff;
}

.journey-stage-label {
  display: block;
  margin-bottom: 2px;
  color: #7d8cff;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.journey-step-header h3 {
  margin: 0;
  color: #f1f5ff;
  font-size: 1.05rem;
  line-height: 1.3;
}

.journey-step-preview {
  margin: 4px 0 0;
  max-width: 60ch;
  overflow: hidden;
  color: #8f9cc4;
  font-size: 0.78rem;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journey-step-header-end {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.journey-step-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 220px;
}

.journey-step-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(145, 166, 255, 0.16);
  border-radius: 999px;
  padding: 5px 9px;
  background: rgba(255, 255, 255, 0.045);
  color: #b6c2e5;
  font-size: 0.68rem;
  font-weight: 800;
  white-space: nowrap;
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

.journey-toggle {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  margin-top: 2px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 8px;
  color: #9ba9d8;
  transition:
    transform 160ms ease,
    border-color 140ms ease,
    color 140ms ease;
}

.journey-toggle.is-open {
  border-color: rgba(102, 227, 255, 0.4);
  color: #66e3ff;
  transform: rotate(180deg);
}

/* ---------- Step body (collapsible detail) ---------- */

.journey-step-body {
  border-top: 1px solid rgba(145, 166, 255, 0.12);
  padding: 18px 20px 20px;
}

.journey-functions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
}

.journey-functions > span {
  margin-right: 2px;
  color: #7d8cff;
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
}

.journey-functions code,
.journey-field-card code {
  border-radius: 6px;
  padding: 3px 7px;
  background: rgba(125, 140, 255, 0.1);
  color: #bdc6ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
}

/* Input -> action -> output flow */

.journey-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr) 28px minmax(0, 1fr);
  align-items: stretch;
  margin-bottom: 16px;
}

.journey-flow-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #566089;
}

.journey-section {
  min-width: 0;
  border: 1px solid rgba(145, 166, 255, 0.15);
  border-radius: 12px;
  padding: 14px;
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
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  color: #dbe4ff;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.journey-section ul,
.journey-quiet-section ul {
  display: grid;
  gap: 7px;
  margin: 0;
  padding-left: 17px;
  color: #b5c1e3;
  font-size: 0.78rem;
  line-height: 1.5;
}

.journey-values {
  display: grid;
  gap: 10px;
  margin: 0;
}

.journey-values div {
  min-width: 0;
}

.journey-values dt {
  margin-bottom: 2px;
  color: #7d8cff;
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.journey-values dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #d7e0fa;
  font-size: 0.78rem;
  line-height: 1.5;
}

.journey-reason-section {
  margin-bottom: 16px;
  border: 1px solid rgba(125, 140, 255, 0.22);
  border-radius: 13px;
  padding: 15px;
  background: rgba(125, 140, 255, 0.06);
}

.journey-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.journey-field-card {
  min-width: 0;
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 10px;
  padding: 11px;
  background: rgba(255, 255, 255, 0.035);
}

.journey-field-card p {
  margin: 8px 0 0;
  color: #b6c2e5;
  font-size: 0.75rem;
  line-height: 1.5;
}

.journey-field-card span {
  display: block;
  margin-top: 6px;
  color: #66e3ff;
  font-size: 0.65rem;
  font-weight: 700;
}

.journey-secondary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.journey-quiet-section {
  border: 1px solid rgba(145, 166, 255, 0.12);
  border-radius: 11px;
  padding: 12px 13px;
  background: rgba(255, 255, 255, 0.028);
}

.limitation-section {
  border-color: rgba(255, 209, 102, 0.18);
  background: rgba(255, 209, 102, 0.045);
}

.journey-next {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  border: 1px solid rgba(102, 227, 255, 0.24);
  border-radius: 12px;
  padding: 12px 13px;
  background: rgba(102, 227, 255, 0.055);
}

.journey-next-icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(102, 227, 255, 0.1);
  color: #66e3ff;
}

.journey-next div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.journey-next div > span {
  color: #7d8cff;
  font-size: 0.6rem;
  font-weight: 800;
  text-transform: uppercase;
}

.journey-next strong {
  color: #eef3ff;
  font-size: 0.8rem;
}

.journey-next p {
  margin: 0;
  color: #aebbe1;
  font-size: 0.75rem;
  line-height: 1.45;
}

.journey-raw {
  border-top: 1px solid rgba(145, 166, 255, 0.15);
  padding-top: 12px;
}

.journey-raw summary,
.journey-technical-trace > summary {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #9ba9d8;
  font-size: 0.74rem;
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
  color: #aebbe1;
  font-size: 0.65rem;
}

.journey-raw pre,
.trace-item pre {
  max-height: 330px;
  margin: 0;
  overflow: auto;
  border-radius: 10px;
  padding: 11px;
  background: #04070d;
  color: #dbe4ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ---------- Technical trace ---------- */

.journey-technical-trace {
  margin-top: 10px;
  border: 1px solid rgba(145, 166, 255, 0.18);
  border-radius: 14px;
  padding: 13px 15px;
  background: rgba(8, 12, 22, 0.88);
}

.journey-technical-trace > summary span {
  margin-left: auto;
  border-radius: 999px;
  padding: 3px 8px;
  background: rgba(255, 255, 255, 0.045);
  color: #b7c3e7;
  font-size: 0.62rem;
}

.trace-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.trace-item {
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 11px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.028);
}

.trace-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.trace-head strong {
  color: #dfe7ff;
  font-size: 0.76rem;
}

.trace-head span {
  color: #8f9cc4;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: capitalize;
}

.trace-item > p {
  margin: 6px 0 0;
  color: #aebbe1;
  font-size: 0.75rem;
  line-height: 1.5;
}

.trace-item details {
  margin-top: 8px;
}

.trace-item details summary {
  color: #66e3ff;
  font-size: 0.7rem;
  cursor: pointer;
}

.trace-item pre {
  margin-top: 7px;
}

/* ---------- Empty state ---------- */

.journey-empty {
  width: min(560px, 100%);
  margin: 80px auto;
  display: grid;
  justify-items: center;
  gap: 8px;
  color: #9ba9d8;
  text-align: center;
}

.journey-empty h3,
.journey-empty p {
  margin: 0;
}

.journey-empty h3 {
  color: #eef3ff;
}

.journey-empty p {
  font-size: 0.8rem;
}

/* ---------- Modal transition ---------- */

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

@media (prefers-reduced-motion: reduce) {
  .journey-modal-enter-active,
  .journey-modal-leave-active,
  .journey-modal-enter-active .journey-modal,
  .journey-modal-leave-active .journey-modal,
  .journey-toggle {
    transition: none;
  }
}

/* ---------- Responsive ---------- */

@media (max-width: 980px) {
  .journey-layout {
    grid-template-columns: 1fr;
  }

  .journey-nav {
    position: static;
    grid-auto-flow: column;
    grid-auto-columns: minmax(200px, 1fr);
    max-height: none;
    overflow-x: auto;
    overflow-y: visible;
    padding-bottom: 4px;
  }

  .journey-flow {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .journey-flow-arrow {
    transform: rotate(90deg);
  }
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

  .journey-summary-actions {
    margin-left: 0;
  }

  .journey-modal-body {
    padding: 16px 10px 28px;
  }

  .journey-step {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 8px;
  }

  .journey-step-number {
    width: 28px;
    height: 28px;
    font-size: 0.65rem;
  }

  .journey-step-header {
    flex-direction: column;
    padding: 14px;
  }

  .journey-step-header-end {
    align-self: stretch;
    justify-content: space-between;
  }

  .journey-step-badges {
    max-width: none;
    justify-content: flex-start;
  }

  .journey-step-preview {
    white-space: normal;
  }

  .journey-step-body {
    padding: 14px;
  }
}

/* ---------- Scrollbars ---------- */

.journey-modal-body,
.journey-nav,
.journey-raw pre,
.trace-item pre {
  scrollbar-width: thin;
  scrollbar-color: rgba(102, 227, 255, 0.5) rgba(255, 255, 255, 0.035);
}

.journey-modal-body::-webkit-scrollbar,
.journey-nav::-webkit-scrollbar,
.journey-raw pre::-webkit-scrollbar,
.trace-item pre::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}

.journey-modal-body::-webkit-scrollbar-track,
.journey-nav::-webkit-scrollbar-track,
.journey-raw pre::-webkit-scrollbar-track,
.trace-item pre::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.025);
  border-radius: 999px;
}

.journey-modal-body::-webkit-scrollbar-thumb,
.journey-nav::-webkit-scrollbar-thumb,
.journey-raw pre::-webkit-scrollbar-thumb,
.trace-item pre::-webkit-scrollbar-thumb {
  border: 2px solid rgba(8, 12, 22, 0.96);
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    rgba(102, 227, 255, 0.72),
    rgba(125, 140, 255, 0.72)
  );
}

.journey-modal-body::-webkit-scrollbar-thumb:hover,
.journey-nav::-webkit-scrollbar-thumb:hover,
.journey-raw pre::-webkit-scrollbar-thumb:hover,
.trace-item pre::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(
    180deg,
    rgba(102, 227, 255, 0.95),
    rgba(125, 140, 255, 0.95)
  );
}
</style>
