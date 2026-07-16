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
  X,
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
const showIdeaSuccess = ref(false);
const showUseCaseSuccess = ref(false);
const isUseCaseModalOpen = ref(false);

const confettiPieces = [
  { x: -54, y: 28, r: -32, delay: 30, type: "dot", tone: "accent" },
  { x: -34, y: 46, r: 48, delay: 75, type: "bar", tone: "success" },
  { x: -12, y: 58, r: -42, delay: 110, type: "triangle", tone: "amber" },
  { x: 14, y: 54, r: 34, delay: 45, type: "dot", tone: "success" },
  { x: 36, y: 42, r: -54, delay: 90, type: "bar", tone: "accent" },
  { x: 56, y: 24, r: 58, delay: 125, type: "triangle", tone: "success" },
  { x: -64, y: 2, r: -28, delay: 145, type: "dot", tone: "amber" },
  { x: 64, y: -2, r: 42, delay: 160, type: "dot", tone: "accent" },
];

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

function triggerSuccess(kind: "idea" | "use_case") {
  const target = kind === "idea" ? showIdeaSuccess : showUseCaseSuccess;
  target.value = false;
  window.setTimeout(() => {
    target.value = true;
    window.setTimeout(() => {
      target.value = false;
    }, 1700);
  }, 80);
}

function openUseCaseModal() {
  isUseCaseModalOpen.value = true;
}

function closeUseCaseModal() {
  isUseCaseModalOpen.value = false;
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === "Escape" && isUseCaseModalOpen.value) {
    closeUseCaseModal();
  }
}

watch(isUseCaseModalOpen, (isOpen) => {
  if (!import.meta.client) return;
  document.body.style.overflow = isOpen ? "hidden" : "";
});

onMounted(() => {
  window.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  stopLoadingCycle();
  window.removeEventListener("keydown", handleEscape);
  if (import.meta.client) document.body.style.overflow = "";
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
    triggerSuccess("idea");
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

  openUseCaseModal();
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
    triggerSuccess("use_case");
  } catch (error) {
    state.value = "idea_ready";
    isUseCaseModalOpen.value = false;
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

        <!-- Idea card with improved success effect -->
        <Transition name="idea-appear" mode="out-in">
          <article v-if="suggestion" class="card idea-card" :key="suggestion.id">
            <div v-if="showIdeaSuccess" class="success-overlay" aria-hidden="true">
              <span
                v-for="(piece, index) in confettiPieces"
                :key="`idea-${index}`"
                class="confetti-piece"
                :class="[`is-${piece.type}`, `tone-${piece.tone}`]"
                :style="{
                  '--x': `${piece.x}px`,
                  '--y': `${piece.y}px`,
                  '--r': `${piece.r}deg`,
                  '--delay': `${piece.delay}ms`,
                }"
              />
              <span class="success-chip">
                <Check :size="14" />
                Idea ready
              </span>
            </div>

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
                @click="hasUseCase ? openUseCaseModal() : generateUseCase()"
              >
                <Loader2 v-if="isLoadingUseCase" class="spin" :size="17" />
                <Sparkles v-else :size="17" />
                {{
                  isLoadingUseCase
                    ? "Generating use case…"
                    : hasUseCase
                      ? "View use case"
                      : "Generate use case"
                }}
              </button>
            </div>
          </article>
        </Transition>

      </section>
    </div>


    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="isUseCaseModalOpen"
          class="modal-backdrop"
          role="presentation"
          @mousedown.self="closeUseCaseModal"
        >
          <section
            class="use-case-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="use-case-modal-title"
          >
            <button
              type="button"
              class="modal-close"
              aria-label="Close use case"
              @click="closeUseCaseModal"
            >
              <X :size="19" />
            </button>

            <div v-if="isLoadingUseCase" class="modal-loading-state">
              <div class="modal-orbit" aria-hidden="true">
                <span class="modal-orbit-ring" />
                <span class="modal-orbit-dot" />
                <Workflow :size="28" />
              </div>

              <div class="modal-copy-centered">
                <span class="modal-eyebrow">Creating your workflow</span>
                <h2 id="use-case-modal-title">Turning the idea into a clear use case</h2>
                <p class="loading-step modal-loading-step">
                  <component :is="activeLoadingStep?.icon" :size="16" />
                  {{ activeLoadingStep?.text }}
                </p>
              </div>

              <div class="modal-progress" aria-hidden="true">
                <span
                  v-for="(step, index) in useCaseLoadingSteps"
                  :key="index"
                  :class="{ active: index <= loadingStepIndex }"
                />
              </div>
            </div>

            <div v-else-if="hasUseCase" class="modal-success-state">
              <div v-if="showUseCaseSuccess" class="success-overlay modal-success-overlay" aria-hidden="true">
                  <span
                  v-for="(piece, index) in confettiPieces"
                  :key="`use-case-${index}`"
                  class="confetti-piece"
                  :class="[`is-${piece.type}`, `tone-${piece.tone}`]"
                  :style="{
                    '--x': `${piece.x}px`,
                    '--y': `${piece.y}px`,
                    '--r': `${piece.r}deg`,
                    '--delay': `${piece.delay}ms`,
                  }"
                />
                <span class="success-chip">
                  <Check :size="14" />
                  Use case ready
                </span>
              </div>

              <header class="modal-header">
                <span class="modal-success-icon"><Check :size="22" /></span>
                <div>
                  <span class="modal-eyebrow success-text">Ready to use</span>
                  <h2 id="use-case-modal-title">Your workflow use case</h2>
                  <div class="structure-row modal-structure-row">
                    <span>Trigger</span>
                    <ArrowRight :size="13" />
                    <span>Main actions</span>
                    <ArrowRight :size="13" />
                    <span>Result</span>
                  </div>
                </div>
              </header>

              <textarea
                v-model="editableUseCase"
                class="use-case-textarea modal-textarea"
                rows="7"
                @input="copied = false"
              />

              <div class="modal-provider-row">
                <span>Generated with <strong>{{ useCaseProviderLabel }}</strong></span>
                <span v-if="useCaseFallbackUsed" class="fallback-badge">Fallback used</span>
              </div>
              <p v-if="useCaseFallbackUsed && useCaseOpenAIError" class="fallback-detail">
                {{ useCaseOpenAIError }}
              </p>

              <footer class="modal-footer">
                <button
                  type="button"
                  class="secondary-button"
                  :disabled="isBusy"
                  @click="generateUseCase"
                >
                  <RefreshCw :size="16" />
                  Regenerate
                </button>
                <button type="button" class="primary-button copy-primary" @click="copyUseCase">
                  <Check v-if="copied" :size="17" />
                  <Clipboard v-else :size="17" />
                  {{ copied ? "Copied to clipboard" : "Copy use case" }}
                </button>
              </footer>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
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

/* ---------- Success micro-interaction ---------- */

.idea-appear-enter-active {
  animation: ideaPop 0.62s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes ideaPop {
  from { opacity: 0; transform: scale(0.96) translateY(18px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.idea-card {
  position: relative;
  overflow: hidden;
}

.success-overlay {
  position: absolute;
  inset: 0;
  z-index: 8;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}

/* A restrained light sweep makes the whole surface feel completed
   without covering the content or drawing a large shape over it. */
.success-overlay::before {
  content: "";
  position: absolute;
  inset: -40% -60%;
  background: linear-gradient(
    112deg,
    transparent 38%,
    rgba(145, 133, 255, 0.04) 45%,
    rgba(61, 220, 151, 0.16) 50%,
    rgba(145, 133, 255, 0.05) 55%,
    transparent 62%
  );
  transform: translateX(-58%);
  animation: successSweep 0.95s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.success-overlay::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid rgba(61, 220, 151, 0.5);
  border-radius: inherit;
  box-shadow:
    inset 0 0 0 1px rgba(61, 220, 151, 0.08),
    0 0 26px rgba(61, 220, 151, 0.1);
  opacity: 0;
  animation: successBorder 1.25s ease-out forwards;
}

@keyframes successSweep {
  0% { opacity: 0; transform: translateX(-58%); }
  18% { opacity: 1; }
  100% { opacity: 0; transform: translateX(58%); }
}

@keyframes successBorder {
  0% { opacity: 0; }
  18%, 58% { opacity: 1; }
  100% { opacity: 0; }
}

.confetti-piece {
  position: absolute;
  top: 31px;
  right: 72px;
  width: 6px;
  height: 6px;
  opacity: 0;
  animation: confettiBurst 0.72s cubic-bezier(0.2, 0.75, 0.25, 1) var(--delay) forwards;
}

.confetti-piece.is-dot { border-radius: 999px; }
.confetti-piece.is-bar { width: 4px; height: 10px; border-radius: 3px; }
.confetti-piece.is-triangle {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 7px solid currentColor;
  background: transparent;
}
.confetti-piece.tone-accent { color: #9185ff; background: #9185ff; }
.confetti-piece.tone-success { color: #3ddc97; background: #3ddc97; }
.confetti-piece.tone-amber { color: #f4b860; background: #f4b860; }
.confetti-piece.is-triangle { background: transparent; }

@keyframes confettiBurst {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.35) rotate(0);
  }
  18% { opacity: 1; }
  100% {
    opacity: 0;
    transform: translate(var(--x), var(--y)) scale(0.82) rotate(var(--r));
  }
}

.success-chip {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(61, 220, 151, 0.28);
  border-radius: 999px;
  background: rgba(13, 28, 29, 0.96);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  padding: 7px 11px;
  color: #73eab5;
  font-size: 0.8rem;
  font-weight: 800;
  animation: chipPop 1.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes chipPop {
  0% { opacity: 0; transform: translateY(-6px) scale(0.94); }
  14% { opacity: 1; transform: translateY(0) scale(1); }
  72% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-3px) scale(0.98); }
}

/* ---------- Use case modal ---------- */

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(3, 6, 12, 0.76);
  backdrop-filter: blur(9px);
}

.use-case-modal {
  position: relative;
  width: min(720px, 100%);
  max-height: min(780px, calc(100vh - 48px));
  overflow-y: auto;
  border: 1px solid #36445d;
  border-radius: 18px;
  background: linear-gradient(180deg, #141e2e 0%, #0f1623 100%);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(145, 133, 255, 0.06);
}

.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 12;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid #2d3a50;
  border-radius: 9px;
  background: rgba(9, 13, 22, 0.72);
  color: #a7b1c2;
}

.modal-close:hover:not(:disabled) { color: #f4f7fb; border-color: #4a5972; }

.modal-loading-state,
.modal-success-state { position: relative; padding: 42px; }
.modal-loading-state { min-height: 430px; display: flex; flex-direction: column; align-items: center; justify-content: center; }

.modal-orbit {
  position: relative;
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  margin-bottom: 26px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(124, 111, 242, 0.22), rgba(124, 111, 242, 0.03) 66%);
  color: #b2a9ff;
}
.modal-orbit-ring { position: absolute; inset: 6px; border: 1px solid rgba(145, 133, 255, 0.3); border-radius: inherit; }
.modal-orbit-dot { position: absolute; inset: 0; animation: orbit 1.6s linear infinite; }
.modal-orbit-dot::after { content: ""; position: absolute; top: 3px; left: 50%; width: 8px; height: 8px; border-radius: 999px; background: #3ddc97; box-shadow: 0 0 18px rgba(61, 220, 151, 0.8); }
@keyframes orbit { to { transform: rotate(360deg); } }

.modal-copy-centered { max-width: 520px; text-align: center; }
.modal-eyebrow { display: inline-block; color: #9185ff; font-size: 0.76rem; font-weight: 850; letter-spacing: 0.09em; text-transform: uppercase; }
.modal-eyebrow.success-text { color: #3ddc97; }
.modal-copy-centered h2,
.modal-header h2 { margin: 8px 0 0; color: #f4f7fb; font-size: 1.55rem; line-height: 1.3; }
.modal-loading-step { justify-content: center; margin-top: 18px; }
.modal-progress { display: flex; width: min(340px, 80%); gap: 7px; margin-top: 30px; }
.modal-progress span { flex: 1; height: 4px; border-radius: 999px; background: #263247; transition: background-color 0.35s ease, box-shadow 0.35s ease; }
.modal-progress span.active { background: #9185ff; box-shadow: 0 0 12px rgba(145, 133, 255, 0.45); }

.modal-success-overlay { border-radius: 18px; }
.modal-header { display: flex; align-items: flex-start; gap: 14px; padding-right: 40px; }
.modal-success-icon { display: grid; place-items: center; width: 46px; height: 46px; flex: 0 0 auto; border-radius: 13px; background: rgba(61, 220, 151, 0.14); color: #3ddc97; box-shadow: inset 0 0 0 1px rgba(61, 220, 151, 0.18); }
.modal-structure-row { margin-top: 11px; }
.modal-textarea { min-height: 190px; margin: 24px 0 13px; background: rgba(5, 9, 16, 0.76); }
.modal-provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #6f7b8e; font-size: 0.86rem; }
.modal-provider-row strong { color: #f4f7fb; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 18px; border-top: 1px solid #263247; }
.copy-primary { justify-content: center; min-width: 174px; }

.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-active .use-case-modal,
.modal-fade-leave-active .use-case-modal { transition: transform 0.24s ease, opacity 0.2s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .use-case-modal,
.modal-fade-leave-to .use-case-modal { opacity: 0; transform: translateY(14px) scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .confetti-piece,
  .success-chip,
  .modal-orbit-dot,
  .idea-appear-enter-active { animation: none !important; }
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
<style scoped>
@media (max-width: 640px) {
  .modal-backdrop { padding: 10px; align-items: end; }
  .use-case-modal { max-height: calc(100vh - 20px); border-radius: 16px 16px 10px 10px; }
  .modal-loading-state, .modal-success-state { padding: 34px 20px 22px; }
  .modal-footer { flex-direction: column-reverse; }
  .modal-footer .secondary-button, .modal-footer .primary-button { width: 100%; justify-content: center; }
  .modal-header { padding-right: 34px; }
  .modal-copy-centered h2, .modal-header h2 { font-size: 1.3rem; }
}
</style>