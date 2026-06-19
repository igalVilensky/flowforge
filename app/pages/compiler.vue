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

const modes: Array<{ label: string; value: CompileMode }> = [
  { label: "Demo", value: "demo" },
  { label: "Rule only", value: "rule_only" },
  { label: "Balanced", value: "balanced" },
  { label: "Full", value: "full" },
];

const processInput = ref(
  "When a customer asks for a refund, classify the reason, detect angry or legal language, draft a reply, and route high-risk cases to a human.",
);
const mode = ref<CompileMode>("demo");
const job = ref<CompileJob | null>(null);
const isCompiling = ref(false);
const errorMessage = ref("");

async function compilePreview() {
  errorMessage.value = "";
  isCompiling.value = true;

  try {
    job.value = await $fetch<CompileJob>("/api/compile", {
      method: "POST",
      body: {
        input: processInput.value,
        mode: mode.value,
      },
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Compile preview failed.";
  } finally {
    isCompiling.value = false;
  }
}

onMounted(() => {
  void compilePreview();
});
</script>

<template>
  <main class="page">
    <header class="topbar">
      <NuxtLink to="/" class="home-link">FlowForge</NuxtLink>
      <span>Compiler preview</span>
    </header>

    <section class="workspace">
      <form class="panel input-panel" @submit.prevent="compilePreview">
        <div>
          <p class="eyebrow">Process input</p>
          <h1>Compile a safe blueprint preview</h1>
        </div>

        <label for="process-input">Process description</label>
        <textarea
          id="process-input"
          v-model="processInput"
          rows="8"
          :disabled="isCompiling"
        />

        <fieldset>
          <legend>Mode</legend>
          <div class="segmented">
            <label v-for="item in modes" :key="item.value">
              <input v-model="mode" type="radio" name="mode" :value="item.value" />
              <span>{{ item.label }}</span>
            </label>
          </div>
        </fieldset>

        <button type="submit" :disabled="isCompiling">
          {{ isCompiling ? "Compiling preview" : "Compile preview" }}
        </button>

        <p class="note">
          Milestone 0 returns a typed mock result only. No provider, database,
          n8n, auth, or external execution is connected.
        </p>
      </form>

      <aside class="panel summary-panel" aria-label="Safety summary">
        <p class="eyebrow">Safety boundary</p>
        <dl>
          <div>
            <dt>Provider calls</dt>
            <dd>{{ job?.token_usage.llm_calls_used ?? 0 }}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>Blocked in MVP</dd>
          </div>
          <div>
            <dt>Human review</dt>
            <dd>Required</dd>
          </div>
        </dl>
      </aside>
    </section>

    <p v-if="errorMessage" class="error" role="alert">
      {{ errorMessage }}
    </p>

    <section v-if="job" class="results">
      <article class="panel">
        <p class="eyebrow">Pipeline</p>
        <ol class="timeline">
          <li v-for="step in job.steps" :key="step.id">
            <span class="dot" />
            <div>
              <strong>{{ step.label }}</strong>
              <p>{{ step.output_summary }}</p>
            </div>
          </li>
        </ol>
      </article>

      <article class="panel">
        <p class="eyebrow">Automation boundary</p>
        <div class="boundary-grid">
          <section>
            <h2>Safe to automate</h2>
            <ul>
              <li v-for="item in job.result.safe_to_automate" :key="item">
                {{ item }}
              </li>
            </ul>
          </section>

          <section>
            <h2>Needs approval</h2>
            <ul>
              <li v-for="item in job.result.needs_human_approval" :key="item">
                {{ item }}
              </li>
            </ul>
          </section>

          <section>
            <h2>Not safe in MVP</h2>
            <ul>
              <li v-for="item in job.result.not_safe_to_automate" :key="item">
                {{ item }}
              </li>
            </ul>
          </section>
        </div>
      </article>

      <article class="panel">
        <p class="eyebrow">Blueprint steps</p>
        <div class="step-list">
          <section v-for="step in job.result.steps" :key="step.id" class="step-card">
            <div>
              <h2>{{ step.label }}</h2>
              <p>{{ step.description }}</p>
            </div>
            <span :class="['risk', step.risk_level]">{{ step.risk_level }}</span>
          </section>
        </div>
      </article>

      <article class="panel">
        <p class="eyebrow">Approval gates</p>
        <div class="gate-list">
          <section v-for="gate in job.result.human_approval_gates" :key="gate.id" class="gate">
            <h2>{{ gate.label }}</h2>
            <p>{{ gate.reason }}</p>
            <ul>
              <li v-for="item in gate.review_checklist" :key="item">
                {{ item }}
              </li>
            </ul>
          </section>
        </div>
      </article>

      <article class="panel">
        <p class="eyebrow">Agent trace</p>
        <ul class="trace">
          <li v-for="event in job.agent_trace" :key="event.id">
            <strong>{{ event.action }}</strong>
            <span>{{ event.status }}</span>
          </li>
        </ul>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24px;
  background: #f7f7fb;
  color: #202124;
}

.topbar,
.workspace,
.results {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  color: #4b5563;
  font-size: 0.95rem;
}

.home-link {
  color: #0f766e;
  font-weight: 800;
  text-decoration: none;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.55fr);
  gap: 16px;
}

.results {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-top: 16px;
}

.panel {
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 16px 42px rgba(32, 33, 36, 0.08);
}

.input-panel,
.summary-panel,
.results > .panel {
  padding: 22px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #0f766e;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 18px;
  font-size: clamp(2rem, 4vw, 3.6rem);
  line-height: 1;
}

h2 {
  margin-bottom: 8px;
  font-size: 1rem;
}

label,
legend,
dt {
  color: #374151;
  font-size: 0.9rem;
  font-weight: 700;
}

textarea {
  width: 100%;
  min-height: 180px;
  box-sizing: border-box;
  margin: 8px 0 18px;
  padding: 14px;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  color: #202124;
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus {
  border-color: #0f766e;
  outline: 3px solid #ccfbf1;
}

fieldset {
  margin: 0 0 18px;
  padding: 0;
  border: 0;
}

.segmented {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.segmented label {
  position: relative;
}

.segmented input {
  position: absolute;
  opacity: 0;
}

.segmented span {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
}

.segmented input:checked + span {
  border-color: #0f766e;
  background: #ccfbf1;
  color: #134e4a;
}

button {
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid #0f766e;
  border-radius: 8px;
  background: #0f766e;
  color: #ffffff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.note,
.timeline p,
.step-card p,
.gate p {
  color: #4b5563;
  line-height: 1.6;
}

.note {
  margin: 16px 0 0;
  max-width: 680px;
  font-size: 0.95rem;
}

.summary-panel dl {
  display: grid;
  gap: 12px;
  margin: 0;
}

.summary-panel div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}

.summary-panel dd {
  margin: 0;
  color: #111827;
  font-weight: 800;
}

.error {
  width: min(1180px, 100%);
  box-sizing: border-box;
  margin: 16px auto 0;
  padding: 12px 14px;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fef2f2;
  color: #991b1b;
}

.timeline {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline li {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 999px;
  background: #0f766e;
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

ul {
  margin: 0;
  padding-left: 18px;
  color: #4b5563;
  line-height: 1.6;
}

.step-list,
.gate-list {
  display: grid;
  gap: 10px;
}

.step-card,
.gate {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
}

.step-card {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.risk {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 800;
  text-transform: uppercase;
}

.risk.low {
  background: #d1fae5;
  color: #065f46;
}

.risk.medium {
  background: #fef3c7;
  color: #92400e;
}

.risk.high {
  background: #fee2e2;
  color: #991b1b;
}

.trace {
  display: grid;
  gap: 10px;
  padding: 0;
  list-style: none;
}

.trace li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
}

.trace span {
  color: #0f766e;
  font-weight: 800;
}

@media (max-width: 860px) {
  .page {
    padding: 18px;
  }

  .workspace,
  .boundary-grid {
    grid-template-columns: 1fr;
  }

  .step-card,
  .trace li {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
