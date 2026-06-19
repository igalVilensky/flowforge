<script setup lang="ts">
useHead({
  title: "FlowForge | Safe Automation Blueprint Compiler",
  meta: [
    {
      name: "description",
      content:
        "FlowForge turns messy process descriptions into structured, validated, human-gated automation blueprints.",
    },
  ],
});
</script>

<template>
  <main class="page">
    <section class="hero">
      <p class="eyebrow">Safe AI automation blueprint compiler</p>
      <h1>FlowForge</h1>
      <p class="lede">
        Messy process in. Safe automation blueprint out.
      </p>
      <p class="summary">
        FlowForge does not blindly automate every request. It finds the safest
        useful automation boundary, separates what can be automated from what
        needs review, and keeps real-world execution human-gated.
      </p>
      <div class="actions">
        <NuxtLink to="/compiler" class="primary-action">
          Open compiler preview
        </NuxtLink>
      </div>
    </section>

    <section class="boundary" aria-label="Automation boundary preview">
      <article>
        <span class="status safe">Automate</span>
        <h2>Classification and drafting</h2>
        <p>
          FlowForge can classify process intent, detect obvious risks, and draft
          internal notes or replies.
        </p>
      </article>

      <article>
        <span class="status review">Approve</span>
        <h2>External or sensitive actions</h2>
        <p>
          Customer messages, payment topics, legal issues, medical issues, and
          employment decisions stay behind human approval gates.
        </p>
      </article>

      <article>
        <span class="status blocked">Block</span>
        <h2>Automatic execution</h2>
        <p>
          The MVP does not send, delete, charge, approve, reject, or update real
          systems automatically.
        </p>
      </article>
    </section>

    <section class="milestone">
      <div>
        <p class="eyebrow">Milestone 0</p>
        <h2>Project setup and documentation</h2>
      </div>
      <p>
        This repository currently contains the docs, shared TypeScript
        contracts, a compiler preview page, and a mock compile API. Real AI
        providers, persistence, authentication, n8n export, and background jobs
        are intentionally out of scope.
      </p>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 56px 24px;
  background: #f7f7fb;
  color: #202124;
}

.hero,
.boundary,
.milestone {
  width: min(1080px, 100%);
  margin: 0 auto;
}

.hero {
  padding: 48px 0 36px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #0f766e;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  max-width: 760px;
  margin-bottom: 18px;
  font-size: clamp(3.25rem, 8vw, 6.5rem);
  line-height: 0.94;
}

h2 {
  margin-bottom: 10px;
  font-size: 1.25rem;
}

.lede {
  max-width: 720px;
  margin-bottom: 14px;
  font-size: 1.6rem;
  line-height: 1.35;
}

.summary {
  max-width: 760px;
  color: #4b5563;
  font-size: 1.05rem;
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.primary-action {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid #0f766e;
  border-radius: 8px;
  background: #0f766e;
  color: #ffffff;
  font-weight: 700;
  text-decoration: none;
}

.primary-action:hover {
  background: #115e59;
}

.boundary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.boundary article,
.milestone {
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 16px 42px rgba(32, 33, 36, 0.08);
}

.boundary article {
  padding: 20px;
}

.boundary p,
.milestone p {
  color: #4b5563;
  line-height: 1.65;
}

.status {
  display: inline-flex;
  margin-bottom: 18px;
  padding: 5px 9px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
}

.safe {
  background: #d1fae5;
  color: #065f46;
}

.review {
  background: #fef3c7;
  color: #92400e;
}

.blocked {
  background: #fee2e2;
  color: #991b1b;
}

.milestone {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  gap: 24px;
  margin-top: 16px;
  padding: 24px;
}

@media (max-width: 760px) {
  .page {
    padding: 32px 18px;
  }

  .hero {
    padding-top: 24px;
  }

  .boundary,
  .milestone {
    grid-template-columns: 1fr;
  }
}
</style>
