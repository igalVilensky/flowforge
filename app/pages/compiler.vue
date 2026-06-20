<script setup lang="ts">
import type { CompileJob, CompileMode } from "../../shared/types/compileJob";

useHead({
  title: "FlowForge Compiler Preview",
  meta: [
    {
      name: "description",
      content: "Preview a mock safe automation blueprint compile in FlowForge.",
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
const showDetails = ref(false);

const activeExample = computed(() => {
  return examples.find((example) => example.value === processInput.value)?.label ?? "";
});

const verdict = computed(() => {
  if (!job.value) {
    return {
      label: "Ready",
      title: "Waiting for process input",
      note: "Paste a process to preview the automation boundary.",
    };
  }

  return {
    label: "Verdict",
    title: "Human-gated automation",
    note: "Automate classification and drafts. Keep external actions and high-stakes decisions under review.",
  };
});

const safeItems = computed(
  () =>
    job.value?.result?.safe_to_automate.slice(0, 4) ?? [
      "Classification",
      "Risk detection",
      "Draft-only outputs",
    ],
);
const approvalItems = computed(
  () =>
    job.value?.result?.needs_human_approval.slice(0, 3) ?? [
      "External messages",
      "Sensitive decisions",
      "High-stakes routing",
    ],
);
const blockedItems = computed(
  () =>
    job.value?.result?.not_safe_to_automate.slice(0, 3) ?? [
      "Automatic sending",
      "Payment or account changes",
      "Destructive actions",
    ],
);
const gateCount = computed(() => job.value?.result?.human_approval_gates.length ?? 0);
const riskLevel = computed(() => job.value?.risks?.risk_level ?? "medium");

function chooseExample(value: string) {
  processInput.value = value;
}

async function compilePreview() {
  errorMessage.value = "";
  isCompiling.value = true;
  showDetails.value = false;

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
                {{ isCompiling ? "Compiling" : "Compile preview" }}
              </button>
            </div>
          </div>
        </form>

        <article class="ff-tile ff-tile-primary verdict-tile">
          <div class="ff-tile-inner verdict-inner">
            <div>
              <p class="ff-kicker">{{ verdict.label }}</p>
              <h2 class="verdict-title">{{ verdict.title }}</h2>
              <p class="ff-copy">{{ verdict.note }}</p>
            </div>

            <dl class="verdict-metrics" aria-label="Compile summary">
              <div>
                <dt>Gates</dt>
                <dd>{{ gateCount }}</dd>
              </div>
              <div>
                <dt>Risk</dt>
                <dd>{{ riskLevel }}</dd>
              </div>
              <div>
                <dt>LLM</dt>
                <dd>{{ job?.token_usage.llm_calls_used ?? 0 }}</dd>
              </div>
            </dl>
          </div>
        </article>

        <p v-if="errorMessage" class="ff-error error-tile" role="alert">
          {{ errorMessage }}
        </p>

        <article class="ff-tile ff-tile-safe outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-safe">Safe</span>
            <h2 class="ff-section-title">Automate</h2>
            <ul class="ff-list">
              <li v-for="item in safeItems" :key="item">{{ item }}</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile ff-tile-approval outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-approval">Approval</span>
            <h2 class="ff-section-title">Human review</h2>
            <ul class="ff-list">
              <li v-for="item in approvalItems" :key="item">{{ item }}</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile ff-tile-blocked outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-blocked">Blocked</span>
            <h2 class="ff-section-title">No auto-run</h2>
            <ul class="ff-list">
              <li v-for="item in blockedItems" :key="item">{{ item }}</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile recommendation-tile">
          <div class="ff-tile-inner recommendation-inner">
            <div>
              <p class="ff-kicker">Recommendation</p>
              <h2 class="ff-page-title">Plan first. Execute later.</h2>
            </div>
            <p class="ff-copy">
              Start with classification, risk detection, draft generation, and
              approval routing. Keep sending, payments, account changes, and
              destructive actions disconnected in the MVP.
            </p>
          </div>
        </article>

        <section v-if="job" class="details-control" aria-label="Technical details">
          <button
            type="button"
            class="ff-details-toggle"
            :aria-expanded="showDetails"
            @click="showDetails = !showDetails"
          >
            {{ showDetails ? "Hide technical details" : "Show technical details" }}
          </button>
        </section>

        <template v-if="job && showDetails">
          <article class="ff-tile detail-tile">
            <div class="ff-tile-inner">
              <p class="ff-kicker">Pipeline</p>
              <ol class="ff-detail-list">
                <li v-for="step in job.steps" :key="step.id">
                  <strong>{{ step.label }}</strong>
                  <span>{{ step.output_summary }}</span>
                </li>
              </ol>
            </div>
          </article>

          <article class="ff-tile detail-tile">
            <div class="ff-tile-inner">
              <p class="ff-kicker">Approval gates</p>
              <ul class="ff-detail-list">
                <li v-for="gate in job.result?.human_approval_gates" :key="gate.id">
                  <strong>{{ gate.label }}</strong>
                  <span>{{ gate.reason }}</span>
                </li>
              </ul>
            </div>
          </article>

          <article class="ff-tile detail-tile">
            <div class="ff-tile-inner">
              <p class="ff-kicker">Token usage</p>
              <dl class="ff-metrics">
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
            </div>
          </article>

          <article class="ff-tile detail-tile">
            <div class="ff-tile-inner">
              <p class="ff-kicker">Agent trace</p>
              <ul class="ff-detail-list">
                <li v-for="event in job.agent_trace" :key="event.id">
                  <strong>{{ event.action }}</strong>
                  <span>{{ event.status }}</span>
                </li>
              </ul>
            </div>
          </article>
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

.verdict-tile {
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
  align-items: end;
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

.verdict-inner {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
}

.verdict-title {
  margin: 0;
  font-size: clamp(1.7rem, 4vw, 2.7rem);
  line-height: 1.02;
}

.verdict-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.verdict-metrics div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
}

.verdict-metrics dt {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.74rem;
  font-weight: 900;
  text-transform: uppercase;
}

.verdict-metrics dd {
  margin: 0;
  color: #ffffff;
  font-size: 1rem;
  font-weight: 950;
  text-transform: capitalize;
}

.error-tile {
  grid-column: span 12;
}

.outcome-tile {
  grid-column: span 4;
  min-height: 210px;
}

.outcome-tile .ff-status {
  margin-bottom: 18px;
}

.recommendation-tile {
  grid-column: span 12;
}

.recommendation-inner {
  display: grid;
  grid-template-columns: minmax(220px, 0.75fr) minmax(0, 1fr);
  gap: 18px;
  align-items: end;
}

.details-control {
  grid-column: span 12;
}

.detail-tile {
  grid-column: span 6;
}

@media (max-width: 940px) {
  .input-tile,
  .verdict-tile,
  .outcome-tile,
  .detail-tile {
    grid-column: span 12;
  }

  .recommendation-inner {
    grid-template-columns: 1fr;
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

  .verdict-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
