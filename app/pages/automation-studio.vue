<script setup lang="ts">
import {
  AlertCircle,
  AlertOctagon,
  ArrowRight,
  Check,
  Clipboard,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wand2,
  Workflow,
} from "lucide-vue-next";

type DiscoveryCategory =
  | "surprise"
  | "customer_support"
  | "sales_crm"
  | "marketing_content"
  | "hr_recruiting"
  | "finance_admin"
  | "operations_projects"
  | "ecommerce"
  | "personal_productivity";

type FitType =
  | "automation_only"
  | "agent_only"
  | "agentic_workflow";

type ProviderName =
  | "openai"
  | "groq";

type AutomationSuggestion = {
  id: string;
  title: string;
  category: DiscoveryCategory;
  fitType: FitType;
  painPoint: string;
  targetUser: string;
  whyItMatters: string;
  valueLevel: "low" | "medium" | "high";
  difficulty: "low" | "medium" | "high";
  confidence: number;
  workflowIntent: string;
  suggestedSteps: string[];

  source: {
    title: string;
    url: string;
  } | null;

  provider: ProviderName;
  fallbackUsed: boolean;
  openAIError: string | null;
};

type UseCaseResponse = {
  useCase: string;
  provider: ProviderName;
  fallbackUsed: boolean;
  openAIError: string | null;
};

type PageState =
  | "idle"
  | "loading_idea"
  | "idea_ready"
  | "loading_use_case"
  | "use_case_ready"
  | "failed";

const categoryOptions: Array<{
  value: DiscoveryCategory;
  label: string;
}> = [
  { value: "surprise", label: "Surprise me" },
  { value: "customer_support", label: "Customer Support" },
  { value: "sales_crm", label: "Sales & CRM" },
  { value: "marketing_content", label: "Marketing & Content" },
  { value: "hr_recruiting", label: "HR & Recruiting" },
  { value: "finance_admin", label: "Finance & Admin" },
  { value: "operations_projects", label: "Operations & Projects" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "personal_productivity", label: "Personal Productivity" },
];

// Perceived-progress copy while each request is in flight. These describe
// the real pipeline (web research, then AI drafting) even though the
// backend returns a single response — they just reflect what's likely
// happening at each point in the wait.
const ideaLoadingSteps = [
  { icon: Search, text: "Searching the web for real examples…" },
  { icon: Sparkles, text: "Asking the AI model to shape an idea…" },
  { icon: Wand2, text: "Scoring value, difficulty and confidence…" },
];

const useCaseLoadingSteps = [
  { icon: Workflow, text: "Reviewing the automation idea…" },
  { icon: Sparkles, text: "Drafting trigger, actions and result…" },
  { icon: Wand2, text: "Writing the final workflow sentence…" },
];

const selectedCategory = ref<DiscoveryCategory>("surprise");
const suggestion = ref<AutomationSuggestion | null>(null);
const editableUseCase = ref("");
const useCaseProvider = ref<ProviderName | null>(null);
const useCaseFallbackUsed = ref(false);
const useCaseOpenAIError = ref<string | null>(null);
const state = ref<PageState>("idle");
const errorMessage = ref("");
const copied = ref(false);
const loadingStepIndex = ref(0);

let loadingTimer: ReturnType<typeof setInterval> | null = null;

const isLoadingIdea = computed(() => state.value === "loading_idea");
const isLoadingUseCase = computed(() => state.value === "loading_use_case");
const isBusy = computed(() => isLoadingIdea.value || isLoadingUseCase.value);
const hasSuggestion = computed(() => suggestion.value !== null);
const hasUseCase = computed(() => editableUseCase.value.trim().length > 0);

const activeLoadingSteps = computed(() =>
  isLoadingUseCase.value ? useCaseLoadingSteps : ideaLoadingSteps,
);

const activeLoadingStep = computed(
  () => activeLoadingSteps.value[loadingStepIndex.value],
);

const selectedCategoryLabel = computed(() => {
  return (
    categoryOptions.find((option) => option.value === selectedCategory.value)
      ?.label ?? "Surprise me"
  );
});

const suggestionCategoryLabel = computed(() => {
  if (!suggestion.value) {
    return selectedCategoryLabel.value;
  }
  return (
    categoryOptions.find((option) => option.value === suggestion.value?.category)
      ?.label ?? selectedCategoryLabel.value
  );
});

const fitTypeLabel = computed(() => {
  if (!suggestion.value) {
    return "";
  }
  const labels: Record<FitType, string> = {
    automation_only: "Automation",
    agent_only: "AI assistant",
    agentic_workflow: "Agentic workflow",
  };
  return labels[suggestion.value.fitType];
});

const ideaProviderLabel = computed(() => providerLabel(suggestion.value?.provider ?? null));
const useCaseProviderLabel = computed(() => providerLabel(useCaseProvider.value));

const statusLabel = computed(() => {
  if (isBusy.value) return "Working";
  if (state.value === "failed") return "Error";
  return "Ready";
});

const statusTone = computed<"ready" | "busy" | "error">(() => {
  if (isBusy.value) return "busy";
  if (state.value === "failed") return "error";
  return "ready";
});

const contextLabel = computed(() => {
  if (isLoadingIdea.value) return "Finding an idea for you…";
  if (isLoadingUseCase.value) return "Drafting the workflow…";
  if (hasUseCase.value) return "Use case ready to copy";
  if (hasSuggestion.value) return "Idea ready — build the use case";
  return "Ready for a workflow?";
});

function providerLabel(provider: ProviderName | null) {
  if (provider === "openai") return "OpenAI";
  if (provider === "groq") return "Groq";
  return "";
}

function handleCategoryChange(category: DiscoveryCategory) {
  selectedCategory.value = category;
  resetAll();
}

function resetUseCase() {
  editableUseCase.value = "";
  useCaseProvider.value = null;
  useCaseFallbackUsed.value = false;
  useCaseOpenAIError.value = null;
  copied.value = false;
}

function resetAll() {
  suggestion.value = null;
  errorMessage.value = "";
  state.value = "idle";
  resetUseCase();
}

function startLoadingCycle(stepCount: number) {
  stopLoadingCycle();
  loadingStepIndex.value = 0;
  loadingTimer = setInterval(() => {
    loadingStepIndex.value = (loadingStepIndex.value + 1) % stepCount;
  }, 1500);
}

function stopLoadingCycle() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

onUnmounted(() => {
  stopLoadingCycle();
});

async function generateIdea() {
  state.value = "loading_idea";
  errorMessage.value = "";
  suggestion.value = null;
  resetUseCase();
  startLoadingCycle(ideaLoadingSteps.length);

  try {
    const response = await $fetch<AutomationSuggestion>(
      "/api/suggest-automation",
      {
        method: "POST",
        body: { category: selectedCategory.value },
      },
    );

    suggestion.value = response;
    state.value = "idea_ready";
  } catch (error) {
    state.value = "failed";
    errorMessage.value = getErrorMessage(
      error,
      "The automation idea could not be generated.",
    );
  } finally {
    stopLoadingCycle();
  }
}

async function generateUseCase() {
  if (!suggestion.value) return;

  state.value = "loading_use_case";
  errorMessage.value = "";
  resetUseCase();
  startLoadingCycle(useCaseLoadingSteps.length);

  try {
    const response = await $fetch<UseCaseResponse>(
      "/api/generate-use-case",
      {
        method: "POST",
        body: { suggestion: suggestion.value },
      },
    );

    editableUseCase.value = response.useCase;
    useCaseProvider.value = response.provider;
    useCaseFallbackUsed.value = response.fallbackUsed;
    useCaseOpenAIError.value = response.openAIError;
    state.value = "use_case_ready";
  } catch (error) {
    state.value = "idea_ready";
    errorMessage.value = getErrorMessage(
      error,
      "The simple use case could not be generated.",
    );
  } finally {
    stopLoadingCycle();
  }
}

async function copyUseCase() {
  const value = editableUseCase.value.trim();
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    errorMessage.value =
      "The browser could not copy the text. Select and copy it manually.";
  }
}

function valueLabel(value: "low" | "medium" | "high") {
  const labels = { low: "Low", medium: "Medium", high: "High" };
  return labels[value];
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
</script>

<template>
  <main class="studio-page">
    <!-- Compact application header -->
    <header class="app-header">
      <div class="app-header-left">
        <NuxtLink to="/compiler" class="brand-mark" aria-label="FlowForge home">
          FF
        </NuxtLink>

        <div class="crumb">
          <span class="crumb-root">FlowForge</span>
          <span class="crumb-sep">/</span>
          <span class="crumb-leaf">
            <Sparkles :size="14" />
            Automation Studio
          </span>
        </div>
      </div>

      <div class="app-header-right">
        <span class="context-label">{{ contextLabel }}</span>

        <NuxtLink to="/compiler" class="compiler-link">
          Open Compiler
          <ArrowRight :size="14" />
        </NuxtLink>

        <span class="status-pill" :class="`is-${statusTone}`">
          <span class="status-dot" />
          {{ statusLabel }}
        </span>
      </div>
    </header>

    <!-- Application body: control rail + results -->
    <div class="app-body">
      <aside class="control-rail">
        <div class="rail-block">
          <div class="rail-label-row">
            <span class="rail-label">Category</span>
            <span class="rail-hint">{{ selectedCategoryLabel }}</span>
          </div>

          <div class="category-list">
            <button
              v-for="option in categoryOptions"
              :key="option.value"
              type="button"
              class="category-item"
              :class="{ selected: selectedCategory === option.value }"
              :disabled="isBusy"
              @click="handleCategoryChange(option.value)"
            >
              <Sparkles v-if="option.value === 'surprise'" :size="15" />
              <span v-else class="category-dot" />
              {{ option.label }}
            </button>
          </div>
        </div>

        <button
          type="button"
          class="generate-button"
          :disabled="isBusy"
          @click="generateIdea"
        >
          <Loader2 v-if="isLoadingIdea" class="spin" :size="18" />
          <Wand2 v-else :size="18" />
          {{
            isLoadingIdea
              ? "Generating…"
              : hasSuggestion
                ? "Generate another idea"
                : "Generate idea"
          }}
        </button>

        <p class="rail-footnote">
          Ideas are researched on the web, then drafted by AI, one at a time,
          so you can review each before building it out.
        </p>
      </aside>

      <section class="results-area">
        <div v-if="errorMessage" class="error-panel">
          <AlertCircle :size="19" />
          <div>
            <strong>Something went wrong</strong>
            <p>{{ errorMessage }}</p>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!suggestion && !isLoadingIdea" class="empty-state">
          <span class="empty-icon">
            <Sparkles :size="22" />
          </span>
          <strong>No idea generated yet</strong>
          <p>Pick a category on the left and generate one to get started.</p>
        </div>

        <!-- Idea loading state -->
        <div v-if="isLoadingIdea" class="loading-panel">
          <div class="loading-icon idea-tone">
            <Loader2 class="spin" :size="22" />
          </div>
          <div class="loading-copy">
            <strong>Generating your idea</strong>
            <p class="loading-step">
              <component :is="activeLoadingStep?.icon" :size="15" />
              {{ activeLoadingStep?.text }}
            </p>
          </div>
          <div class="loading-dots">
            <span
              v-for="(step, index) in ideaLoadingSteps"
              :key="index"
              class="loading-dot"
              :class="{ active: index === loadingStepIndex }"
            />
          </div>
        </div>

        <!-- Idea card -->
        <article v-if="suggestion" class="card idea-card">
          <div class="card-top-row">
            <div class="tag-list">
              <span class="tag tag-accent">{{ fitTypeLabel }}</span>
              <span class="tag">{{ suggestionCategoryLabel }}</span>
              <span class="tag">Value: {{ valueLabel(suggestion.valueLevel) }}</span>
              <span class="tag">
                Difficulty: {{ valueLabel(suggestion.difficulty) }}
              </span>
            </div>
            <span class="confidence">{{ suggestion.confidence }}% confidence</span>
          </div>

          <h2 class="idea-title">{{ suggestion.title }}</h2>

          <div class="detail-grid">
            <div class="detail-item tone-error">
              <div class="detail-heading">
                <span class="detail-icon"><AlertOctagon :size="15" /></span>
                <span class="detail-label">Pain point</span>
              </div>
              <p>{{ suggestion.painPoint }}</p>
            </div>

            <div class="detail-item tone-accent">
              <div class="detail-heading">
                <span class="detail-icon"><Users :size="15" /></span>
                <span class="detail-label">Target user</span>
              </div>
              <p>{{ suggestion.targetUser }}</p>
            </div>

            <div class="detail-item tone-success">
              <div class="detail-heading">
                <span class="detail-icon"><TrendingUp :size="15" /></span>
                <span class="detail-label">Why it matters</span>
              </div>
              <p>{{ suggestion.whyItMatters }}</p>
            </div>
          </div>

          <div class="workflow-block">
            <div class="detail-heading">
              <span class="detail-icon tone-accent-solid"><Workflow :size="15" /></span>
              <span class="detail-label">Workflow idea</span>
            </div>
            <p>{{ suggestion.workflowIntent }}</p>
          </div>

          <div v-if="suggestion.suggestedSteps.length" class="steps-block">
            <div class="detail-heading">
              <span class="detail-icon tone-accent-solid"><ListChecks :size="15" /></span>
              <span class="detail-label">Suggested flow</span>
            </div>
            <ol class="step-list">
              <li v-for="(step, index) in suggestion.suggestedSteps" :key="`${index}-${step}`">
                <span class="step-index">{{ index + 1 }}</span>
                <span>{{ step }}</span>
              </li>
            </ol>
          </div>

          <a
            v-if="suggestion.source"
            :href="suggestion.source.url"
            target="_blank"
            rel="noopener noreferrer"
            class="source-link"
          >
            <ExternalLink :size="14" />
            Source: {{ suggestion.source.title }}
          </a>

          <div class="provider-row">
            <span>Generated with <strong>{{ ideaProviderLabel }}</strong></span>
            <span v-if="suggestion.fallbackUsed" class="fallback-badge">Fallback used</span>
          </div>
          <p v-if="suggestion.fallbackUsed && suggestion.openAIError" class="fallback-detail">
            {{ suggestion.openAIError }}
          </p>

          <div class="card-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="isBusy"
              @click="generateIdea"
            >
              <RefreshCw :size="16" />
              Try another
            </button>

            <button
              type="button"
              class="primary-button"
              :disabled="isBusy"
              @click="generateUseCase"
            >
              <Loader2 v-if="isLoadingUseCase" class="spin" :size="17" />
              <Sparkles v-else :size="17" />
              {{
                isLoadingUseCase
                  ? "Generating use case…"
                  : hasUseCase
                    ? "Regenerate use case"
                    : "Generate use case"
              }}
            </button>
          </div>
        </article>

        <!-- Use case loading state -->
        <div v-if="isLoadingUseCase" class="loading-panel">
          <div class="loading-icon success-tone">
            <Loader2 class="spin" :size="22" />
          </div>
          <div class="loading-copy">
            <strong>Building the use case</strong>
            <p class="loading-step">
              <component :is="activeLoadingStep?.icon" :size="15" />
              {{ activeLoadingStep?.text }}
            </p>
          </div>
          <div class="loading-dots">
            <span
              v-for="(step, index) in useCaseLoadingSteps"
              :key="index"
              class="loading-dot success"
              :class="{ active: index === loadingStepIndex }"
            />
          </div>
        </div>

        <!-- Use case card -->
        <article v-if="hasUseCase" class="card use-case-card">
          <div class="card-top-row">
            <div>
              <div class="detail-heading">
                <span class="detail-icon tone-success-solid"><Workflow :size="15" /></span>
                <span class="detail-label">Workflow use case</span>
              </div>
              <div class="structure-row">
                <span>Trigger</span>
                <ArrowRight :size="13" />
                <span>Main actions</span>
                <ArrowRight :size="13" />
                <span>Result</span>
              </div>
            </div>

            <button type="button" class="copy-button" @click="copyUseCase">
              <Check v-if="copied" :size="16" />
              <Clipboard v-else :size="16" />
              {{ copied ? "Copied" : "Copy" }}
            </button>
          </div>

          <textarea
            v-model="editableUseCase"
            class="use-case-textarea"
            rows="6"
            @input="copied = false"
          />

          <div class="provider-row">
            <span>Generated with <strong>{{ useCaseProviderLabel }}</strong></span>
            <span v-if="useCaseFallbackUsed" class="fallback-badge">Fallback used</span>
          </div>
          <p v-if="useCaseFallbackUsed && useCaseOpenAIError" class="fallback-detail">
            {{ useCaseOpenAIError }}
          </p>
        </article>
      </section>
    </div>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html) {
  color-scheme: dark;
}

:global(body) {
  margin: 0;
  background: #090d16;
  color: #f4f7fb;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

button,
textarea {
  font: inherit;
  color: inherit;
}

button {
  cursor: pointer;
  border: none;
  background: none;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.studio-page {
  min-height: 100vh;
  background: #090d16;
  display: flex;
  flex-direction: column;
  font-size: 16px;
}

/* ---------- Header ---------- */

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 60px;
  flex: 0 0 auto;
  padding: 0 22px;
  border-bottom: 1px solid #263247;
  background: #0f1623;
}

.app-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 8px;
  border: 1px solid #36445d;
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

.app-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 0 1 auto;
  min-width: 0;
}

.context-label {
  color: #a7b1c2;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compiler-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #263247;
  border-radius: 7px;
  padding: 7px 11px;
  color: #f4f7fb;
  font-size: 0.88rem;
  font-weight: 650;
  text-decoration: none;
  white-space: nowrap;
}

.compiler-link:hover {
  border-color: #36445d;
  background: #131c2b;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 11px;
  font-size: 0.84rem;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill.is-ready {
  color: #3ddc97;
  background: rgba(61, 220, 151, 0.1);
}

.status-pill.is-busy {
  color: #f4b860;
  background: rgba(244, 184, 96, 0.1);
}

.status-pill.is-error {
  color: #f06a7a;
  background: rgba(240, 106, 122, 0.1);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.status-pill.is-busy .status-dot {
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* ---------- Body layout ---------- */

.app-body {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}

.control-rail {
  border-right: 1px solid #263247;
  background: #0f1623;
  padding: 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 60px;
  align-self: start;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.rail-block {
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.rail-label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.rail-label {
  color: #a7b1c2;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rail-hint {
  color: #6f7b8e;
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 10px 11px;
  color: #a7b1c2;
  font-size: 0.92rem;
  font-weight: 600;
  text-align: left;
}

.category-item svg {
  flex: 0 0 auto;
  color: #6f7b8e;
}

.category-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #36445d;
}

.category-item:hover:not(:disabled) {
  background: #131c2b;
  color: #f4f7fb;
}

.category-item.selected {
  border-color: #36445d;
  background: rgba(124, 111, 242, 0.12);
  color: #f4f7fb;
}

.category-item.selected svg,
.category-item.selected .category-dot {
  color: #9185ff;
  background: #9185ff;
}

.generate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 44px;
  border-radius: 8px;
  background: #7c6ff2;
  color: #f4f7fb;
  font-size: 0.96rem;
  font-weight: 700;
}

.generate-button:hover:not(:disabled) {
  background: #9185ff;
}

.rail-footnote {
  margin: 0;
  color: #6f7b8e;
  font-size: 0.84rem;
  line-height: 1.6;
}

.results-area {
  padding: 22px 26px 60px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  overflow-y: auto;
}

/* ---------- States ---------- */

.error-panel {
  display: flex;
  gap: 11px;
  border: 1px solid rgba(240, 106, 122, 0.4);
  border-radius: 10px;
  background: rgba(240, 106, 122, 0.08);
  padding: 14px 16px;
  color: #f06a7a;
}

.error-panel strong {
  color: #f4f7fb;
  font-size: 0.96rem;
}

.error-panel p {
  margin: 5px 0 0;
  color: #a7b1c2;
  font-size: 0.9rem;
  line-height: 1.55;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  border: 1px dashed #263247;
  border-radius: 12px;
  padding: 36px 26px;
  color: #6f7b8e;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: rgba(124, 111, 242, 0.12);
  color: #9185ff;
  margin-bottom: 6px;
}

.empty-state strong {
  color: #f4f7fb;
  font-size: 1.02rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.92rem;
}

/* Loading panel: icon + rotating step text + progress dots */

.loading-panel {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #263247;
  border-radius: 12px;
  background: #131c2b;
  padding: 20px 22px;
}

.loading-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: rgba(124, 111, 242, 0.14);
  color: #9185ff;
}

.loading-icon.success-tone {
  background: rgba(61, 220, 151, 0.14);
  color: #3ddc97;
}

.loading-copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
}

.loading-copy strong {
  color: #f4f7fb;
  font-size: 1rem;
}

.loading-step {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #a7b1c2;
  font-size: 0.9rem;
}

.loading-step svg {
  flex: 0 0 auto;
  color: #9185ff;
}

.loading-dots {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.loading-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #263247;
  transition: background-color 0.3s ease;
}

.loading-dot.active {
  background: #9185ff;
}

.loading-dot.success.active {
  background: #3ddc97;
}

/* ---------- Cards ---------- */

.card {
  border: 1px solid #263247;
  border-radius: 12px;
  background: #131c2b;
  padding: 22px;
}

.card-top-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.tag {
  border: 1px solid #263247;
  border-radius: 999px;
  background: #182235;
  padding: 5px 11px;
  color: #a7b1c2;
  font-size: 0.82rem;
  font-weight: 700;
}

.tag-accent {
  border-color: #36445d;
  background: rgba(124, 111, 242, 0.12);
  color: #9185ff;
}

.confidence {
  flex: 0 0 auto;
  color: #6f7b8e;
  font-size: 0.86rem;
  font-weight: 650;
}

.idea-title {
  margin: 16px 0 18px;
  color: #f4f7fb;
  font-size: 1.55rem;
  line-height: 1.35;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
  margin-bottom: 15px;
}

.detail-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 6px;
}

.detail-item {
  border: 1px solid #263247;
  border-left-width: 3px;
  border-radius: 9px;
  background: #182235;
  padding: 13px 14px;
}

.detail-item.tone-error {
  border-left-color: #f06a7a;
}

.detail-item.tone-error .detail-icon {
  background: rgba(240, 106, 122, 0.14);
  color: #f06a7a;
}

.detail-item.tone-accent {
  border-left-color: #7c6ff2;
}

.detail-item.tone-accent .detail-icon {
  background: rgba(124, 111, 242, 0.14);
  color: #9185ff;
}

.detail-item.tone-success {
  border-left-color: #3ddc97;
}

.detail-item.tone-success .detail-icon {
  background: rgba(61, 220, 151, 0.14);
  color: #3ddc97;
}

.detail-icon.tone-accent-solid {
  background: rgba(124, 111, 242, 0.14);
  color: #9185ff;
}

.detail-icon.tone-success-solid {
  background: rgba(61, 220, 151, 0.14);
  color: #3ddc97;
}

.detail-label {
  color: #a7b1c2;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.detail-item p {
  margin: 9px 0 0;
  color: #f4f7fb;
  font-size: 0.98rem;
  line-height: 1.6;
}

.workflow-block {
  border: 1px solid #263247;
  border-left: 3px solid #7c6ff2;
  border-radius: 9px;
  background: #182235;
  padding: 14px;
  margin-bottom: 11px;
}

.workflow-block p {
  margin: 9px 0 0;
  color: #f4f7fb;
  font-size: 1.02rem;
  line-height: 1.65;
}

.steps-block {
  border: 1px solid #263247;
  border-left: 3px solid #7c6ff2;
  border-radius: 9px;
  background: #182235;
  padding: 14px;
  margin-bottom: 15px;
}

.step-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.step-list li {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  color: #e2e7ee;
  font-size: 0.98rem;
  line-height: 1.6;
}

.step-index {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: rgba(124, 111, 242, 0.16);
  color: #9185ff;
  font-size: 0.76rem;
  font-weight: 800;
  margin-top: 1px;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 15px;
  color: #a7b1c2;
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
}

.source-link:hover {
  color: #9185ff;
}

.provider-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: #6f7b8e;
  font-size: 0.86rem;
  padding-top: 13px;
  border-top: 1px solid #263247;
}

.provider-row strong {
  color: #f4f7fb;
}

.fallback-badge {
  border: 1px solid rgba(244, 184, 96, 0.4);
  border-radius: 999px;
  background: rgba(244, 184, 96, 0.1);
  padding: 3px 9px;
  color: #f4b860;
  font-size: 0.76rem;
  font-weight: 800;
}

.fallback-detail {
  margin: 8px 0 0;
  color: #6f7b8e;
  font-family: "Roboto Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.secondary-button,
.copy-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  border: 1px solid #263247;
  border-radius: 8px;
  padding: 0 15px;
  background: #182235;
  color: #f4f7fb;
  font-size: 0.9rem;
  font-weight: 650;
}

.secondary-button:hover:not(:disabled),
.copy-button:hover:not(:disabled) {
  border-color: #36445d;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  border-radius: 8px;
  padding: 0 16px;
  background: #7c6ff2;
  color: #f4f7fb;
  font-size: 0.9rem;
  font-weight: 700;
}

.primary-button:hover:not(:disabled) {
  background: #9185ff;
}

.use-case-card {
  border-color: rgba(61, 220, 151, 0.3);
}

.structure-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #6f7b8e;
  font-size: 0.82rem;
}

.structure-row span {
  border: 1px solid #263247;
  border-radius: 999px;
  background: #182235;
  padding: 3px 9px;
}

.use-case-textarea {
  width: 100%;
  min-height: 155px;
  resize: vertical;
  border: 1px solid #263247;
  border-radius: 9px;
  outline: none;
  background: #090d16;
  padding: 15px;
  color: #f4f7fb;
  font-size: 1.02rem;
  line-height: 1.7;
  margin: 15px 0;
}

.use-case-textarea:focus {
  border-color: #7c6ff2;
  box-shadow: 0 0 0 3px rgba(124, 111, 242, 0.15);
}

.spin {
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- Responsive ---------- */

@media (max-width: 960px) {
  .app-body {
    grid-template-columns: 1fr;
  }

  .control-rail {
    position: static;
    height: auto;
    border-right: none;
    border-bottom: 1px solid #263247;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .rail-block {
    flex: 1 1 100%;
  }

  .category-list {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .category-item {
    width: auto;
  }

  .generate-button {
    width: auto;
    flex: 1 1 auto;
  }

  .rail-footnote {
    flex-basis: 100%;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .app-header {
    height: auto;
    padding: 10px 14px;
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .app-header-right {
    width: 100%;
    justify-content: space-between;
  }

  .context-label {
    display: none;
  }

  .results-area {
    padding: 16px 14px 40px;
  }

  .loading-panel {
    flex-wrap: wrap;
  }

  .loading-dots {
    flex-basis: 100%;
    justify-content: flex-start;
  }

  .card-actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .primary-button,
  .secondary-button {
    width: 100%;
    justify-content: center;
  }
}
</style>