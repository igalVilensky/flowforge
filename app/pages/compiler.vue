<script setup lang="ts">
import type { CompileJob, CompileMode } from "../../shared/types/compileJob";

const examples = [
  {
    label: "Refund request",
    value:
      "When a customer asks for a refund, classify the reason, detect angry or legal language, draft a reply, and route high-risk cases to a human.",
  },
  {
    label: "Student inquiry",
    value:
      "When a student asks about a course, classify the inquiry, draft a helpful reply, and create a follow-up task for admissions if needed.",
  },
  {
    label: "Risky auto-send",
    value:
      "When a student asks about visa eligibility or payment problems, draft a reply and send it automatically.",
  },
];

const processInput = ref(examples[0]?.value ?? "");
const mode = ref<CompileMode>("demo");
const job = ref<CompileJob | null>(null);
const isCompiling = ref(false);
const errorMessage = ref("");
const showDetails = ref(false);

const verdictLabel = computed(() => {
  if (!job.value) return "Ready to compile";
  return "Partially automatable";
});

const verdictText = computed(() => {
  if (!job.value) {
    return "Describe a process and FlowForge will identify the safest useful automation boundary.";
  }

  return "Automate low-risk support work. Keep sensitive decisions human-reviewed. Block automatic real-world execution.";
});

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
  <main class="page">
    <section class="shell">
      <header class="topbar">
        <NuxtLink to="/" class="brand">
          FlowForge
        </NuxtLink>

```
    <span class="status-pill">
      Demo preview
    </span>
  </header>

  <section class="hero">
    <p class="eyebrow">
      Safe automation compiler
    </p>

    <h1>Find the safest automation boundary.</h1>

    <p>
      Paste a messy process. FlowForge shows what can be automated, what
      needs human approval, and what should stay blocked.
    </p>
  </section>

  <section class="workspace">
    <form class="card input-card" @submit.prevent="compilePreview">
      <div class="card-heading">
        <p class="eyebrow">
          Step 1
        </p>
        <h2>Describe the workflow</h2>
      </div>

      <textarea
        v-model="processInput"
        :disabled="isCompiling"
        aria-label="Process description"
        placeholder="Example: When a customer asks for a refund, classify the request, draft a reply, and route risky cases to a human."
      />

      <div class="example-row">
        <button
          v-for="example in examples"
          :key="example.label"
          type="button"
          class="ghost-button"
          @click="processInput = example.value"
        >
          {{ example.label }}
        </button>
      </div>

      <div class="controls">
        <label>
          Mode
          <select v-model="mode" :disabled="isCompiling">
            <option value="demo">Demo</option>
            <option value="rule_only">Rule only</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full</option>
          </select>
        </label>

        <button class="primary-button" type="submit" :disabled="isCompiling">
          {{ isCompiling ? "Compiling..." : "Compile safe blueprint" }}
        </button>
      </div>
    </form>

    <aside class="card verdict-card">
      <p class="eyebrow">
        Step 2
      </p>

      <h2>{{ verdictLabel }}</h2>
      <p>{{ verdictText }}</p>

      <div v-if="job" class="verdict-pill">
        Human approval required
      </div>
    </aside>
  </section>

  <p v-if="errorMessage" class="error" role="alert">
    {{ errorMessage }}
  </p>

  <section v-if="job?.result" class="result-focus">
    <article class="boundary-card safe">
      <p class="mini-label">
        Safe to automate
      </p>
      <ul>
        <li v-for="item in job.result.safe_to_automate" :key="item">
          {{ item }}
        </li>
      </ul>
    </article>

    <article class="boundary-card review">
      <p class="mini-label">
        Needs approval
      </p>
      <ul>
        <li v-for="item in job.result.needs_human_approval" :key="item">
          {{ item }}
        </li>
      </ul>
    </article>

    <article class="boundary-card blocked">
      <p class="mini-label">
        Blocked
      </p>
      <ul>
        <li v-for="item in job.result.not_safe_to_automate" :key="item">
          {{ item }}
        </li>
      </ul>
    </article>
  </section>

  <section v-if="job?.result" class="recommendation card">
    <p class="eyebrow">
      Recommendation
    </p>
    <h2>Use FlowForge as a planning and review layer first.</h2>
    <p>
      Start with classification, risk detection, draft generation, and
      approval routing. Do not connect real sending, payment, account, or
      destructive actions until the blueprint is reviewed.
    </p>
  </section>

  <section v-if="job" class="details">
    <button
      type="button"
      class="details-toggle"
      @click="showDetails = !showDetails"
    >
      {{ showDetails ? "Hide technical details" : "Show technical details" }}
    </button>

    <div v-if="showDetails" class="details-grid">
      <article class="card">
        <p class="eyebrow">
          Pipeline
        </p>
        <ol class="timeline">
          <li v-for="step in job.steps" :key="step.id">
            <strong>{{ step.label }}</strong>
            <span>{{ step.outputSummary }}</span>
          </li>
        </ol>
      </article>

      <article v-if="job.result" class="card">
        <p class="eyebrow">
          Approval gates
        </p>
        <div class="gate-list">
          <section
            v-for="gate in job.result.human_approval_gates"
            :key="gate.id"
          >
            <h3>{{ gate.label }}</h3>
            <p>{{ gate.reason }}</p>
          </section>
        </div>
      </article>

      <article class="card">
        <p class="eyebrow">
          Token budget
        </p>
        <dl class="metrics">
          <div>
            <dt>Mode</dt>
            <dd>{{ job.token_usage?.mode ?? mode }}</dd>
          </div>
          <div>
            <dt>LLM calls</dt>
            <dd>
              {{ job.token_usage?.llm_calls_used ?? 0 }} /
              {{ job.token_usage?.llm_calls_limit ?? 0 }}
            </dd>
          </div>
          <div>
            <dt>Rule checks</dt>
            <dd>{{ job.token_usage?.rule_based_checks ?? 0 }}</dd>
          </div>
        </dl>
      </article>

      <article class="card">
        <p class="eyebrow">
          Agent trace
        </p>
        <ul class="trace">
          <li v-for="event in job.agent_trace ?? []" :key="event.id">
            <strong>{{ event.action }}</strong>
            <span>{{ event.status }}</span>
          </li>
        </ul>
      </article>
    </div>
  </section>
</section>
```

  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
}

:global(*) {
  box-sizing: border-box;
}

.page {
  min-height: 100vh;
  padding: 16px;
  color: #202124;
}

.shell {
width: min(1080px, 100%);
margin: 0 auto;
}


.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.brand {
  color: #0f766e;
  font-size: 1.05rem;
  font-weight: 900;
  text-decoration: none;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid #d8dee8;
  border-radius: 999px;
  color: #4b5563;
  font-size: 0.82rem;
  font-weight: 700;
}

.hero {
  max-width: 720px;
  margin-bottom: 18px;
}

.eyebrow,
.mini-label {
  margin: 0 0 6px;
  color: #0f766e;
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  max-width: 720px;
  margin-bottom: 8px;
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 1;
  letter-spacing: -0.05em;
}

h2 {
  margin-bottom: 8px;
  font-size: 1.15rem;
}

h3 {
  margin-bottom: 4px;
  font-size: 0.98rem;
}

.hero p,
.card p,
.boundary-card li {
  color: #4b5563;
  line-height: 1.55;
}

.workspace {
display: grid;
grid-template-columns: minmax(0, 1fr) minmax(260px, 0.45fr);
gap: 12px;
}


.card,
.boundary-card {
  border: 1px solid #d8dee8;
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(32, 33, 36, 0.06);
}

.card {
  padding: 16px;
}

.card-heading {
  margin-bottom: 10px;
}

textarea {
  width: 100%;
  min-height: 150px;
  padding: 12px;
  border: 1px solid #cfd7e3;
  border-radius: 10px;
  color: #202124;
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus,
select:focus {
  border-color: #0f766e;
  outline: 3px solid #ccfbf1;
}

.example-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.ghost-button,
.details-toggle {
  border: 1px solid #cfd7e3;
  border-radius: 999px;
  color: #374151;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
}

.ghost-button {
  padding: 7px 10px;
}

.ghost-button:hover,
.details-toggle:hover {
  border-color: #0f766e;
  color: #0f766e;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  justify-content: space-between;
  margin-top: 14px;
}

label {
  display: grid;
  gap: 5px;
  color: #374151;
  font-size: 0.86rem;
  font-weight: 800;
}

select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  font: inherit;
}

.primary-button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid #0f766e;
  border-radius: 10px;
  background: #0f766e;
  color: #ffffff;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.7;
}

.verdict-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.verdict-pill {
  display: inline-flex;
  width: fit-content;
  margin-top: 12px;
  padding: 7px 10px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.86rem;
  font-weight: 900;
}

.error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #991b1b;
}

.result-focus {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.boundary-card {
  padding: 16px;
}

.boundary-card ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
}

.safe {
  border-color: #bbf7d0;
}

.review {
  border-color: #fde68a;
}

.blocked {
  border-color: #fecaca;
}

.safe .mini-label {
  color: #047857;
}

.review .mini-label {
  color: #b45309;
}

.blocked .mini-label {
  color: #b91c1c;
}

.recommendation {
  margin-top: 12px;
}

.details {
  margin-top: 12px;
}

.details-toggle {
  padding: 8px 12px;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.timeline,
.trace,
.gate-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline li,
.trace li,
.gate-list section {
  display: grid;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
}

.timeline span,
.trace span,
.gate-list p {
  color: #4b5563;
  line-height: 1.5;
}

.metrics {
  display: grid;
  gap: 10px;
  margin: 0;
}

.metrics div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e5e7eb;
}

.metrics dt {
  color: #4b5563;
  font-weight: 700;
}

.metrics dd {
  margin: 0;
  font-weight: 900;
}

@media (max-width: 840px) {
  .page {
    padding: 12px;
  }

  .topbar {
    margin-bottom: 18px;
  }

  .workspace,
  .result-focus,
  .details-grid {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: clamp(2rem, 12vw, 3rem);
  }

  .controls {
    align-items: stretch;
  }

  .primary-button,
  select {
    width: 100%;
  }
}
</style>
