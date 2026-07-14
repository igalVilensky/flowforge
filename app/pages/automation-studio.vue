<script setup lang="ts">
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clipboard,
  ExternalLink,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Sparkles,
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
  {
    value: "surprise",
    label: "Surprise me",
  },
  {
    value: "customer_support",
    label: "Customer Support",
  },
  {
    value: "sales_crm",
    label: "Sales & CRM",
  },
  {
    value: "marketing_content",
    label: "Marketing & Content",
  },
  {
    value: "hr_recruiting",
    label: "HR & Recruiting",
  },
  {
    value: "finance_admin",
    label: "Finance & Administration",
  },
  {
    value: "operations_projects",
    label: "Operations & Projects",
  },
  {
    value: "ecommerce",
    label: "E-commerce",
  },
  {
    value: "personal_productivity",
    label: "Personal Productivity",
  },
];

const selectedCategory =
  ref<DiscoveryCategory>("surprise");

const suggestion =
  ref<AutomationSuggestion | null>(null);

const editableUseCase =
  ref("");

const useCaseProvider =
  ref<ProviderName | null>(null);

const useCaseFallbackUsed =
  ref(false);

const useCaseOpenAIError =
  ref<string | null>(null);

const state =
  ref<PageState>("idle");

const errorMessage =
  ref("");

const copied =
  ref(false);

const isLoadingIdea =
  computed(
    () =>
      state.value ===
      "loading_idea",
  );

const isLoadingUseCase =
  computed(
    () =>
      state.value ===
      "loading_use_case",
  );

const isBusy =
  computed(
    () =>
      isLoadingIdea.value ||
      isLoadingUseCase.value,
  );

const hasSuggestion =
  computed(
    () =>
      suggestion.value !== null,
  );

const hasUseCase =
  computed(
    () =>
      editableUseCase.value
        .trim()
        .length > 0,
  );

const selectedCategoryLabel =
  computed(() => {
    return (
      categoryOptions.find(
        (option) =>
          option.value ===
          selectedCategory.value,
      )?.label ??
      "Surprise me"
    );
  });

const suggestionCategoryLabel =
  computed(() => {
    if (!suggestion.value) {
      return selectedCategoryLabel.value;
    }

    return (
      categoryOptions.find(
        (option) =>
          option.value ===
          suggestion.value?.category,
      )?.label ??
      selectedCategoryLabel.value
    );
  });

const fitTypeLabel =
  computed(() => {
    if (!suggestion.value) {
      return "";
    }

    const labels:
      Record<FitType, string> = {
      automation_only:
        "Automation",

      agent_only:
        "AI assistant",

      agentic_workflow:
        "Agentic workflow",
    };

    return labels[
      suggestion.value.fitType
    ];
  });

const ideaProviderLabel =
  computed(() => {
    return providerLabel(
      suggestion.value?.provider ??
      null,
    );
  });

const useCaseProviderLabel =
  computed(() => {
    return providerLabel(
      useCaseProvider.value,
    );
  });

function providerLabel(
  provider: ProviderName | null,
) {
  if (provider === "openai") {
    return "OpenAI";
  }

  if (provider === "groq") {
    return "Groq";
  }

  return "";
}

function handleCategoryChange(
  category: DiscoveryCategory,
) {
  selectedCategory.value =
    category;

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

async function generateIdea() {
  state.value =
    "loading_idea";

  errorMessage.value = "";
  suggestion.value = null;

  resetUseCase();

  try {
    const response =
      await $fetch<AutomationSuggestion>(
        "/api/suggest-automation",
        {
          method: "POST",

          body: {
            category:
              selectedCategory.value,
          },
        },
      );

    suggestion.value =
      response;

    state.value =
      "idea_ready";
  } catch (error) {
    state.value =
      "failed";

    errorMessage.value =
      getErrorMessage(
        error,
        "The automation idea could not be generated.",
      );
  }
}

async function generateUseCase() {
  if (!suggestion.value) {
    return;
  }

  state.value =
    "loading_use_case";

  errorMessage.value = "";

  resetUseCase();

  try {
    const response =
      await $fetch<UseCaseResponse>(
        "/api/generate-use-case",
        {
          method: "POST",

          body: {
            suggestion:
              suggestion.value,
          },
        },
      );

    editableUseCase.value =
      response.useCase;

    useCaseProvider.value =
      response.provider;

    useCaseFallbackUsed.value =
      response.fallbackUsed;

    useCaseOpenAIError.value =
      response.openAIError;

    state.value =
      "use_case_ready";
  } catch (error) {
    state.value =
      "idea_ready";

    errorMessage.value =
      getErrorMessage(
        error,
        "The simple use case could not be generated.",
      );
  }
}

async function copyUseCase() {
  const value =
    editableUseCase.value.trim();

  if (!value) {
    return;
  }

  try {
    await navigator.clipboard
      .writeText(value);

    copied.value = true;

    window.setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    errorMessage.value =
      "The browser could not copy the text. Select and copy it manually.";
  }
}

function valueLabel(
  value:
    | "low"
    | "medium"
    | "high",
) {
  const labels = {
    low: "Low",
    medium: "Medium",
    high: "High",
  };

  return labels[value];
}

function getErrorMessage(
  error: unknown,
  fallback: string,
) {
  if (
    error &&
    typeof error === "object" &&
    "data" in error
  ) {
    const data =
      error.data;

    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message ===
        "string"
    ) {
      return data.message;
    }
  }

  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
}
</script>

<template>
  <main class="studio-page">
    <div
      class="background-orb orb-one"
    />

    <div
      class="background-orb orb-two"
    />

    <div class="studio-shell">
      <header class="topbar">
        <NuxtLink
          to="/"
          class="brand"
        >
          <span class="brand-icon">
            <Sparkles :size="22" />
          </span>

          <span class="brand-text">
            <strong>FlowForge</strong>

            <small>
              Automation Idea Generator
            </small>
          </span>
        </NuxtLink>

        <NuxtLink
          to="/"
          class="back-link"
        >
          Back to FlowForge
        </NuxtLink>
      </header>

      <section class="hero">
        <div class="hero-label">
          <Sparkles :size="18" />

          One-click automation inspiration
        </div>

        <h1>
          Discover a useful

          <span>
            automation idea
          </span>
        </h1>

        <p>
          Pick a category or let
          FlowForge surprise you.
          Generate one practical idea,
          then turn it into a simple
          workflow sentence you can edit
          and copy.
        </p>
      </section>

      <section class="process-row">
        <article class="process-card">
          <span class="process-number">
            1
          </span>

          <div>
            <strong>
              Choose a category
            </strong>

            <p>
              Select an area or keep the
              random option.
            </p>
          </div>
        </article>

        <ArrowRight
          class="process-arrow"
          :size="22"
        />

        <article class="process-card">
          <span class="process-number">
            2
          </span>

          <div>
            <strong>
              Get an idea
            </strong>

            <p>
              FlowForge generates one
              practical opportunity.
            </p>
          </div>
        </article>

        <ArrowRight
          class="process-arrow"
          :size="22"
        />

        <article class="process-card">
          <span class="process-number">
            3
          </span>

          <div>
            <strong>
              Create the use case
            </strong>

            <p>
              Edit or copy the final
              workflow sentence.
            </p>
          </div>
        </article>
      </section>

      <section class="panel category-panel">
        <div class="panel-heading">
          <span class="step-label">
            Step 1
          </span>

          <h2>
            What area should we explore?
          </h2>

          <p>
            Choose a category or let
            FlowForge select one randomly.
          </p>
        </div>

        <div class="category-grid">
          <button
            v-for="option in categoryOptions"
            :key="option.value"
            type="button"
            class="category-button"
            :class="{
              selected:
                selectedCategory ===
                option.value,
            }"
            :disabled="isBusy"
            @click="
              handleCategoryChange(
                option.value,
              )
            "
          >
            <Sparkles
              v-if="
                option.value ===
                'surprise'
              "
              :size="17"
            />

            {{ option.label }}
          </button>
        </div>

        <button
          type="button"
          class="primary-button"
          :disabled="isBusy"
          @click="generateIdea"
        >
          <LoaderCircle
            v-if="isLoadingIdea"
            class="spin"
            :size="21"
          />

          <Sparkles
            v-else
            :size="21"
          />

          {{
            isLoadingIdea
              ? "Generating idea..."
              : hasSuggestion
                ? "Generate another idea"
                : selectedCategory ===
                    "surprise"
                  ? "Surprise me"
                  : "Generate idea"
          }}
        </button>
      </section>

      <section
        v-if="errorMessage"
        class="error-panel"
      >
        <AlertCircle :size="23" />

        <div>
          <strong>
            Something went wrong
          </strong>

          <p>
            {{ errorMessage }}
          </p>
        </div>
      </section>

      <section
        v-if="suggestion"
        class="panel idea-panel"
      >
        <div class="idea-meta">
          <div class="tag-list">
            <span class="tag accent">
              {{ fitTypeLabel }}
            </span>

            <span class="tag">
              {{
                suggestionCategoryLabel
              }}
            </span>

            <span class="tag">
              Value:
              {{
                valueLabel(
                  suggestion.valueLevel,
                )
              }}
            </span>

            <span class="tag">
              Difficulty:
              {{
                valueLabel(
                  suggestion.difficulty,
                )
              }}
            </span>
          </div>

          <span class="confidence">
            {{ suggestion.confidence }}%
            confidence
          </span>
        </div>

        <div class="idea-heading">
          <span class="idea-icon">
            <Lightbulb :size="27" />
          </span>

          <div>
            <span class="step-label">
              Step 2
            </span>

            <h2>
              {{ suggestion.title }}
            </h2>
          </div>
        </div>

        <div class="detail-grid">
          <article class="detail-card">
            <span class="card-title">
              Pain point
            </span>

            <p>
              {{ suggestion.painPoint }}
            </p>
          </article>

          <article class="detail-card">
            <span class="card-title">
              Target user
            </span>

            <p>
              {{ suggestion.targetUser }}
            </p>
          </article>

          <article class="detail-card">
            <span class="card-title">
              Why it matters
            </span>

            <p>
              {{ suggestion.whyItMatters }}
            </p>
          </article>
        </div>

        <article class="workflow-card">
          <span class="card-title">
            Workflow idea
          </span>

          <p>
            {{ suggestion.workflowIntent }}
          </p>
        </article>

        <article
          v-if="
            suggestion.suggestedSteps.length
          "
          class="steps-card"
        >
          <span class="card-title">
            Suggested flow
          </span>

          <div class="step-list">
            <div
              v-for="(
                step,
                index
              ) in suggestion.suggestedSteps"
              :key="`${index}-${step}`"
              class="step-row"
            >
              <span class="step-index">
                {{ index + 1 }}
              </span>

              <p>
                {{ step }}
              </p>
            </div>
          </div>
        </article>

        <a
          v-if="suggestion.source"
          :href="suggestion.source.url"
          target="_blank"
          rel="noopener noreferrer"
          class="source-link"
        >
          <ExternalLink :size="18" />

          <span>
            Source:
            {{ suggestion.source.title }}
          </span>
        </a>

        <div class="provider-panel">
          <div class="provider-summary">
            <span>
              Idea generated with
            </span>

            <strong>
              {{ ideaProviderLabel }}
            </strong>

            <span
              v-if="
                suggestion.fallbackUsed
              "
              class="fallback-badge"
            >
              Fallback used
            </span>
          </div>

          <div
            v-if="
              suggestion.fallbackUsed &&
              suggestion.openAIError
            "
            class="fallback-details"
          >
            <strong>
              Why OpenAI was not used
            </strong>

            <p>
              {{
                suggestion.openAIError
              }}
            </p>
          </div>
        </div>

        <div class="idea-actions">
          <button
            type="button"
            class="secondary-button"
            :disabled="isBusy"
            @click="generateIdea"
          >
            <RefreshCw :size="20" />

            Try another
          </button>

          <button
            type="button"
            class="primary-button inline"
            :disabled="isBusy"
            @click="generateUseCase"
          >
            <LoaderCircle
              v-if="isLoadingUseCase"
              class="spin"
              :size="21"
            />

            <Sparkles
              v-else
              :size="21"
            />

            {{
              isLoadingUseCase
                ? "Generating use case..."
                : hasUseCase
                  ? "Regenerate use case"
                  : "Generate simple use case"
            }}
          </button>
        </div>
      </section>

      <section
        v-if="hasUseCase"
        class="panel use-case-panel"
      >
        <div class="use-case-heading">
          <div>
            <span class="step-label">
              Step 3
            </span>

            <h2>
              Your simple workflow use case
            </h2>

            <p>
              Edit the sentence directly or
              copy it as it is.
            </p>
          </div>

          <button
            type="button"
            class="copy-button"
            @click="copyUseCase"
          >
            <Check
              v-if="copied"
              :size="20"
            />

            <Clipboard
              v-else
              :size="20"
            />

            {{
              copied
                ? "Copied"
                : "Copy"
            }}
          </button>
        </div>

        <textarea
          v-model="editableUseCase"
          class="use-case-textarea"
          rows="7"
          @input="copied = false"
        />

        <div class="use-case-footer">
          <div class="structure-row">
            <span>
              Trigger
            </span>

            <ArrowRight :size="18" />

            <span>
              Main actions
            </span>

            <ArrowRight :size="18" />

            <span>
              Final result
            </span>
          </div>
        </div>

        <div class="provider-panel">
          <div class="provider-summary">
            <span>
              Use case generated with
            </span>

            <strong>
              {{ useCaseProviderLabel }}
            </strong>

            <span
              v-if="
                useCaseFallbackUsed
              "
              class="fallback-badge"
            >
              Fallback used
            </span>
          </div>

          <div
            v-if="
              useCaseFallbackUsed &&
              useCaseOpenAIError
            "
            class="fallback-details"
          >
            <strong>
              Why OpenAI was not used
            </strong>

            <p>
              {{ useCaseOpenAIError }}
            </p>
          </div>
        </div>
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
  background: #080c14;
  color: #f8fafc;
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
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.studio-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  padding: 32px 24px 88px;
  background:
    linear-gradient(
      180deg,
      rgba(29, 40, 64, 0.72),
      rgba(8, 12, 20, 0) 460px
    ),
    #080c14;
}

.background-orb {
  position: fixed;
  z-index: 0;
  border-radius: 999px;
  pointer-events: none;
  filter: blur(115px);
  opacity: 0.2;
}

.orb-one {
  top: -230px;
  left: -170px;
  width: 640px;
  height: 640px;
  background: #4f46e5;
}

.orb-two {
  right: -240px;
  bottom: -260px;
  width: 720px;
  height: 720px;
  background: #7c3aed;
}

.studio-shell {
  position: relative;
  z-index: 1;
  width: min(1160px, 100%);
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 72px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 15px;
  color: #ffffff;
  text-decoration: none;
}

.brand-icon {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  border: 1px solid rgba(165, 180, 252, 0.55);
  border-radius: 15px;
  background:
    linear-gradient(
      145deg,
      rgba(99, 102, 241, 0.4),
      rgba(124, 58, 237, 0.24)
    );
  color: #e0e7ff;
}

.brand-text {
  display: grid;
  gap: 4px;
}

.brand strong {
  color: #ffffff;
  font-size: 1.14rem;
}

.brand small {
  color: #c2cada;
  font-size: 0.88rem;
}

.back-link {
  border: 1px solid #49566f;
  border-radius: 11px;
  background: rgba(20, 27, 40, 0.94);
  padding: 12px 17px;
  color: #e2e8f0;
  font-size: 0.94rem;
  font-weight: 750;
  text-decoration: none;
}

.back-link:hover {
  border-color: #7d8ba7;
  background: #202938;
  color: #ffffff;
}

.hero {
  max-width: 880px;
  margin-bottom: 50px;
}

.hero-label {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 21px;
  border: 1px solid rgba(165, 180, 252, 0.5);
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.18);
  padding: 10px 15px;
  color: #e0e7ff;
  font-size: 0.94rem;
  font-weight: 800;
}

.hero h1 {
  margin: 0;
  color: #ffffff;
  font-size: clamp(3rem, 6vw, 5.2rem);
  line-height: 1.01;
  letter-spacing: -0.055em;
}

.hero h1 span {
  display: block;
  background:
    linear-gradient(
      90deg,
      #c7d2fe,
      #e9d5ff,
      #bfdbfe
    );
  background-clip: text;
  color: transparent;
}

.hero p {
  max-width: 790px;
  margin: 26px 0 0;
  color: #d1d8e5;
  font-size: 1.18rem;
  line-height: 1.75;
}

.process-row {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    auto
    minmax(0, 1fr)
    auto
    minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  margin-bottom: 26px;
}

.process-card {
  display: flex;
  min-height: 122px;
  align-items: flex-start;
  gap: 16px;
  border: 1px solid #3c485e;
  border-radius: 16px;
  background: rgba(18, 25, 38, 0.96);
  padding: 21px;
}

.process-number {
  display: grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 11px;
  background: rgba(99, 102, 241, 0.22);
  color: #e0e7ff;
  font-size: 0.94rem;
  font-weight: 850;
}

.process-card strong {
  display: block;
  color: #ffffff;
  font-size: 1.06rem;
}

.process-card p {
  margin: 8px 0 0;
  color: #c2cada;
  font-size: 0.94rem;
  line-height: 1.6;
}

.process-arrow {
  color: #8792a8;
}

.panel {
  margin-top: 24px;
  border: 1px solid #3b465a;
  border-radius: 19px;
  background:
    linear-gradient(
      180deg,
      rgba(21, 29, 43, 0.99),
      rgba(13, 19, 30, 0.99)
    );
  padding: 32px;
  box-shadow:
    0 26px 70px rgba(0, 0, 0, 0.32),
    inset 0 1px rgba(255, 255, 255, 0.045);
}

.panel-heading {
  margin-bottom: 25px;
}

.step-label,
.card-title {
  display: block;
  color: #b1bdd0;
  font-size: 0.82rem;
  font-weight: 850;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.panel-heading h2,
.idea-heading h2,
.use-case-heading h2 {
  margin: 8px 0 0;
  color: #ffffff;
  font-size: 1.65rem;
  line-height: 1.25;
}

.panel-heading p,
.use-case-heading p {
  margin: 11px 0 0;
  color: #c5cedc;
  font-size: 1rem;
  line-height: 1.65;
}

.category-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 11px;
  margin-bottom: 25px;
}

.category-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #4b586e;
  border-radius: 999px;
  background: #182130;
  padding: 12px 17px;
  color: #e1e7f0;
  font-size: 0.96rem;
  font-weight: 750;
}

.category-button:hover:not(:disabled) {
  border-color: #7d8aa4;
  background: #222d3e;
  color: #ffffff;
}

.category-button.selected {
  border-color: #9aa4ff;
  background: rgba(99, 102, 241, 0.28);
  color: #ffffff;
  box-shadow:
    0 0 0 1px rgba(129, 140, 248, 0.18);
}

.primary-button,
.secondary-button,
.copy-button {
  display: inline-flex;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 12px;
  padding: 13px 20px;
  font-size: 1rem;
  font-weight: 850;
}

.primary-button {
  border: 1px solid #8588ff;
  background:
    linear-gradient(
      135deg,
      #6366f1,
      #7c3aed
    );
  color: #ffffff;
  box-shadow:
    0 15px 34px rgba(99, 102, 241, 0.28);
}

.primary-button:hover:not(:disabled) {
  background:
    linear-gradient(
      135deg,
      #777af8,
      #8b4cf0
    );
  transform: translateY(-1px);
}

.primary-button.inline {
  width: auto;
}

.secondary-button,
.copy-button {
  border: 1px solid #526077;
  background: #1a2331;
  color: #edf2f7;
}

.secondary-button:hover:not(:disabled),
.copy-button:hover:not(:disabled) {
  border-color: #7b8aa5;
  background: #243043;
  color: #ffffff;
}

.error-panel {
  display: flex;
  gap: 14px;
  margin-top: 24px;
  border: 1px solid rgba(248, 113, 113, 0.55);
  border-radius: 16px;
  background: rgba(127, 29, 29, 0.24);
  padding: 20px 22px;
  color: #fca5a5;
}

.error-panel strong {
  color: #fee2e2;
  font-size: 1.05rem;
}

.error-panel p {
  margin: 7px 0 0;
  color: #f4c2c5;
  font-size: 0.96rem;
  line-height: 1.65;
}

.idea-panel {
  position: relative;
  overflow: hidden;
}

.idea-panel::before {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 4px;
  background:
    linear-gradient(
      90deg,
      #6366f1,
      #8b5cf6,
      #3b82f6
    );
  content: "";
}

.idea-meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.tag {
  border: 1px solid #4a566d;
  border-radius: 999px;
  background: #182130;
  padding: 9px 12px;
  color: #d6deea;
  font-size: 0.84rem;
  font-weight: 800;
}

.tag.accent {
  border-color: rgba(154, 164, 255, 0.65);
  background: rgba(99, 102, 241, 0.24);
  color: #eef2ff;
}

.confidence {
  flex: 0 0 auto;
  color: #c3ccda;
  font-size: 0.9rem;
  font-weight: 750;
}

.idea-heading {
  display: flex;
  align-items: flex-start;
  gap: 17px;
  margin: 30px 0 26px;
}

.idea-icon {
  display: grid;
  flex: 0 0 auto;
  width: 54px;
  height: 54px;
  place-items: center;
  border: 1px solid rgba(250, 204, 21, 0.42);
  border-radius: 15px;
  background: rgba(250, 204, 21, 0.14);
  color: #fde047;
}

.idea-heading h2 {
  max-width: 860px;
  font-size: clamp(1.65rem, 3vw, 2.35rem);
}

.detail-grid {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 15px;
}

.detail-card,
.workflow-card,
.steps-card {
  border: 1px solid #3b475c;
  border-radius: 15px;
  background: rgba(7, 11, 18, 0.62);
  padding: 20px;
}

.detail-card p,
.workflow-card p {
  margin: 11px 0 0;
  color: #d3dae6;
  font-size: 1rem;
  line-height: 1.7;
}

.workflow-card,
.steps-card {
  margin-top: 15px;
}

.workflow-card p {
  color: #e3e8f0;
  font-size: 1.05rem;
}

.step-list {
  display: grid;
  gap: 13px;
  margin-top: 17px;
}

.step-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.step-index {
  display: grid;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #58667e;
  border-radius: 10px;
  background: #1b2534;
  color: #f1f5f9;
  font-size: 0.84rem;
  font-weight: 850;
}

.step-row p {
  margin: 3px 0 0;
  color: #d5dce7;
  font-size: 1rem;
  line-height: 1.65;
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 19px;
  color: #c3d3ff;
  font-size: 0.92rem;
  font-weight: 650;
  text-decoration: none;
}

.source-link:hover {
  color: #ffffff;
}

.provider-panel {
  margin-top: 20px;
  border: 1px solid #465269;
  border-radius: 14px;
  background: rgba(15, 22, 34, 0.9);
  padding: 16px 18px;
}

.provider-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: #c5cedc;
  font-size: 0.94rem;
}

.provider-summary strong {
  color: #ffffff;
}

.fallback-badge {
  border: 1px solid rgba(251, 191, 36, 0.45);
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.12);
  padding: 5px 9px;
  color: #fde68a;
  font-size: 0.78rem;
  font-weight: 800;
}

.fallback-details {
  margin-top: 13px;
  border-top: 1px solid #3f4a5f;
  padding-top: 13px;
}

.fallback-details strong {
  color: #fde68a;
  font-size: 0.9rem;
}

.fallback-details p {
  margin: 7px 0 0;
  color: #cbd5e1;
  font-family:
    "Roboto Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 0.84rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.idea-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 28px;
}

.use-case-panel {
  border-color: rgba(52, 211, 153, 0.48);
}

.use-case-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  margin-bottom: 21px;
}

.use-case-textarea {
  width: 100%;
  min-height: 195px;
  resize: vertical;
  border: 1px solid #58667d;
  border-radius: 15px;
  outline: none;
  background: #080d16;
  padding: 20px;
  color: #ffffff;
  font-size: 1.08rem;
  line-height: 1.78;
}

.use-case-textarea:focus {
  border-color: rgba(52, 211, 153, 0.85);
  box-shadow:
    0 0 0 4px rgba(52, 211, 153, 0.12);
}

.use-case-footer {
  margin-top: 17px;
}

.structure-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: #bcc7d7;
  font-size: 0.9rem;
  font-weight: 750;
}

.structure-row span {
  border: 1px solid #46536a;
  border-radius: 999px;
  background: #182130;
  padding: 9px 12px;
}

.spin {
  animation:
    spin 0.85s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .process-row {
    grid-template-columns: 1fr;
  }

  .process-arrow {
    display: none;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 650px) {
  .studio-page {
    padding:
      20px 14px 56px;
  }

  .topbar,
  .idea-meta,
  .use-case-heading,
  .idea-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .topbar {
    margin-bottom: 52px;
  }

  .back-link,
  .primary-button,
  .secondary-button,
  .copy-button {
    width: 100%;
  }

  .hero h1 {
    font-size: 2.75rem;
  }

  .hero p {
    font-size: 1.04rem;
  }

  .panel {
    padding: 22px;
  }

  .confidence {
    align-self: flex-start;
  }
}
</style>