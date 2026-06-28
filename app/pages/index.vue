<script setup lang="ts">
useHead({
  title: "FlowForge | AI Automation Safety Compiler",
  meta: [
    {
      name: "description",
      content:
        "FlowForge is a non-executing safety and observability layer for AI automation prototypes.",
    },
  ],
});

const compilerPasses = [
  {
    label: "Input",
    title: "Describe the automation idea",
    copy: "Start with a rough process, a risky workflow, or a clear internal task.",
  },
  {
    label: "Clarify",
    title: "Resolve missing details",
    copy: "FlowForge asks one contextual question at a time when the request is too vague.",
  },
  {
    label: "Blueprint",
    title: "Compile a safe preview",
    copy: "Agents produce a structured, non-executing workflow with visible boundaries.",
  },
  {
    label: "Safety",
    title: "Review gates and blocked actions",
    copy: "The Safety Critic checks approval needs, risk, and what must stay disabled.",
  },
  {
    label: "Handoff",
    title: "Prepare implementation guidance",
    copy: "Generate an n8n builder prompt or experimental JSON draft with constraints intact.",
  },
];

const agentStack = [
  {
    name: "Guided Clarifier",
    status: "asks",
    copy: "Turns vague automation ideas into answerable, compile-ready context.",
  },
  {
    name: "Router",
    status: "routes",
    copy: "Chooses the compile path and explains whether AI or rules handled the decision.",
  },
  {
    name: "Compile Clarifier",
    status: "checks",
    copy: "Flags missing compile-time details before a blueprint becomes misleading.",
  },
  {
    name: "Blueprint Architect",
    status: "plans",
    copy: "Shapes the workflow preview, step roles, and execution boundaries.",
  },
  {
    name: "Safety Critic",
    status: "guards",
    copy: "Reviews human gates, blocked actions, risk outcome, and the next safe move.",
  },
];

const featureCards = [
  {
    title: "Guided clarification",
    copy: "Messy requests become focused inputs through one-question-at-a-time clarification.",
  },
  {
    title: "Agent blueprinting",
    copy: "Routing, clarification, blueprint, and safety agents expose how the compiler got there.",
  },
  {
    title: "Safety critic",
    copy: "Human gates, blocked actions, risk status, and next safe action are first-class outputs.",
  },
  {
    title: "Run observability",
    copy: "Agent status, fallback visibility, provider attempts, trace/debug, and LLM call tracking stay visible.",
  },
  {
    title: "n8n handoff",
    copy: "FlowForge creates an implementation prompt and optional draft JSON with approval constraints and disabled side effects.",
  },
];

const safetyOutcomes = [
  {
    label: "Safe internal preview",
    tone: "safe",
    copy: "Internal summaries, labels, extraction, and review queues can be previewed safely.",
  },
  {
    label: "Needs human approval",
    tone: "approval",
    copy: "External messages, account updates, sensitive decisions, and production writes require a person.",
  },
  {
    label: "Needs clarification",
    tone: "clarify",
    copy: "FlowForge pauses when the request lacks a trigger, source, owner, output, or boundary.",
  },
  {
    label: "Not safe to automate",
    tone: "blocked",
    copy: "High-stakes advice, destructive actions, auto-sending, payments, and unsafe decisions are blocked.",
  },
];

const observabilityItems = [
  "Agent status explanations",
  "Fallback visibility",
  "Provider attempts",
  "Trace/debug evidence",
  "LLM call tracking",
  "Run summary",
];

const handoffRules = [
  "Use test credentials or mocked data first.",
  "Keep production writes disabled by default.",
  "Require human approval for external or sensitive actions.",
  "Treat n8n JSON as a draft template, not an execution-ready workflow.",
];
</script>

<template>
  <main class="home-console">
    <header class="topbar">
      <NuxtLink to="/" class="brandline" aria-label="FlowForge home">
        <span class="brand-mark">FF</span>
        <span class="brand-path">FlowForge</span>
      </NuxtLink>

      <div class="topbar-status">
        <span class="status-pill tone-active">
          <span class="pulse-dot" />
          Non-executing compiler
        </span>
        <NuxtLink to="/compiler" class="topbar-link">Open compiler</NuxtLink>
      </div>
    </header>

    <section class="hero-section" aria-labelledby="home-hero-title">
      <div class="hero-copy">
        <p class="eyebrow">AI automation safety compiler</p>
        <h1 id="home-hero-title">Turn automation ideas into safe blueprints.</h1>
        <p class="hero-lede">
          FlowForge is a non-executing safety and observability layer for AI
          automation prototypes. Describe an idea, clarify the risky parts, and
          get a human-gated blueprint with traceable agent work and an n8n
          implementation handoff.
        </p>

        <div class="hero-actions">
          <NuxtLink to="/compiler" class="primary-action">Launch compiler console</NuxtLink>
          <NuxtLink to="/compiler" class="secondary-action">Start safe blueprint</NuxtLink>
        </div>

        <div class="hero-metrics" aria-label="FlowForge safety posture">
          <div>
            <span>Execution</span>
            <strong>0 production side effects</strong>
          </div>
          <div>
            <span>Boundary</span>
            <strong>Human gates visible</strong>
          </div>
          <div>
            <span>Trust</span>
            <strong>Agent trace exposed</strong>
          </div>
        </div>
      </div>

      <aside class="compiler-card" aria-label="Compiler pass preview">
        <div class="card-header">
          <div>
            <p class="eyebrow">Compiler pass</p>
            <h2>Input to handoff</h2>
          </div>
          <span class="mini-pill">safe preview</span>
        </div>

        <ol class="pass-list">
          <li v-for="(item, index) in compilerPasses" :key="item.label" class="pass-item">
            <span class="pass-index">{{ index + 1 }}</span>
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.copy }}</p>
            </div>
          </li>
        </ol>
      </aside>
    </section>

    <section class="content-section pipeline-section" aria-labelledby="pipeline-title">
      <div class="section-heading">
        <p class="eyebrow">How FlowForge works</p>
        <h2 id="pipeline-title">A compiler pipeline, not an auto-run button.</h2>
        <p>
          FlowForge routes an automation idea through clarification, agent
          planning, safety review, observability, and handoff while keeping
          production tools disconnected.
        </p>
      </div>

      <div class="pipeline-map" aria-label="FlowForge pipeline">
        <article v-for="(item, index) in compilerPasses" :key="item.label" class="pipeline-node">
          <span>{{ item.label }}</span>
          <strong>{{ item.title }}</strong>
          <small>{{ index === compilerPasses.length - 1 ? "builder prompt" : "non-executing pass" }}</small>
        </article>
      </div>
    </section>

    <section class="content-section" aria-labelledby="features-title">
      <div class="section-heading compact">
        <p class="eyebrow">Compiler capabilities</p>
        <h2 id="features-title">What the console makes visible</h2>
      </div>

      <div class="feature-grid">
        <article v-for="feature in featureCards" :key="feature.title" class="feature-card">
          <span class="feature-dot" />
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.copy }}</p>
        </article>
      </div>
    </section>

    <section class="content-section split-section" aria-labelledby="agents-title">
      <div class="section-heading sticky-heading">
        <p class="eyebrow">Agent stack</p>
        <h2 id="agents-title">Each agent explains its work.</h2>
        <p>
          The compiler page shows which agent ran, which provider or fallback
          path was used, and why the current status is safe, gated, unclear, or
          blocked.
        </p>
      </div>

      <div class="agent-stack" aria-label="FlowForge agents">
        <article v-for="agent in agentStack" :key="agent.name" class="agent-row">
          <span class="agent-orb" />
          <div>
            <strong>{{ agent.name }}</strong>
            <p>{{ agent.copy }}</p>
          </div>
          <span class="agent-status">{{ agent.status }}</span>
        </article>
      </div>
    </section>

    <section class="content-section" aria-labelledby="safety-title">
      <div class="section-heading compact">
        <p class="eyebrow">Safety boundaries</p>
        <h2 id="safety-title">Four outcomes keep the prototype honest.</h2>
      </div>

      <div class="outcome-grid">
        <article
          v-for="outcome in safetyOutcomes"
          :key="outcome.label"
          class="outcome-card"
          :class="`tone-${outcome.tone}`"
        >
          <span class="outcome-light" />
          <h3>{{ outcome.label }}</h3>
          <p>{{ outcome.copy }}</p>
        </article>
      </div>
    </section>

    <section class="content-section observability-section" aria-labelledby="observability-title">
      <div class="section-heading">
        <p class="eyebrow">Observability and trust</p>
        <h2 id="observability-title">Debuggable by design.</h2>
        <p>
          FlowForge does not hide provider behavior behind a single answer. It
          exposes the run path so a human can inspect the blueprint before
          anyone builds or connects real services.
        </p>
      </div>

      <div class="observability-grid">
        <article v-for="item in observabilityItems" :key="item" class="observability-card">
          <span>{{ item }}</span>
          <strong>visible</strong>
        </article>
      </div>
    </section>

    <section class="handoff-section" aria-labelledby="handoff-title">
      <div>
        <p class="eyebrow">Implementation handoff</p>
        <h2 id="handoff-title">From safe blueprint to n8n handoff.</h2>
        <p>
          The compiler can prepare a concrete implementation prompt for a human
          builder, plus an experimental draft JSON export when configured. It
          carries forward approval constraints and blocked actions, but
          FlowForge still does not execute workflows or connect production
          tools.
        </p>
      </div>

      <ul class="handoff-list">
        <li v-for="rule in handoffRules" :key="rule">{{ rule }}</li>
      </ul>

      <NuxtLink to="/compiler" class="primary-action handoff-action">Open compiler</NuxtLink>
    </section>
  </main>
</template>

<style scoped>
:global(html),
:global(body) {
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(89, 111, 255, 0.18), transparent 32rem),
    radial-gradient(circle at bottom right, rgba(22, 190, 180, 0.12), transparent 28rem),
    #070a12;
  color: #eef3ff;
}

.home-console {
  position: relative;
  min-height: 100vh;
  padding: 76px 16px 88px;
  overflow: hidden;
  box-sizing: border-box;
  color: #eef3ff;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.home-console::before {
  content: "";
  position: fixed;
  inset: 44px 0 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(145, 166, 255, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(145, 166, 255, 0.045) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.68), transparent 74%);
}

.topbar {
  position: fixed;
  z-index: 40;
  inset: 0 0 auto 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(145, 166, 255, 0.18);
  background: rgba(7, 10, 18, 0.86);
  backdrop-filter: blur(18px);
}

.brandline,
.topbar-status,
.hero-actions,
.hero-metrics,
.card-header {
  display: flex;
  align-items: center;
}

.brandline {
  gap: 10px;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(129, 150, 255, 0.4);
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(82, 104, 255, 0.24), rgba(18, 210, 191, 0.16));
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.brand-path {
  font-size: 13px;
  color: #c7d2ff;
}

.topbar-status {
  gap: 10px;
}

.status-pill,
.topbar-link,
.mini-pill,
.secondary-action,
.primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(145, 166, 255, 0.22);
  color: #dfe6ff;
  background: rgba(255, 255, 255, 0.045);
  text-decoration: none;
  white-space: nowrap;
}

.status-pill {
  gap: 7px;
  min-width: 166px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #66e3ff;
  box-shadow: 0 0 16px rgba(102, 227, 255, 0.8);
}

.topbar-link {
  min-height: 30px;
  padding: 0 12px;
  border-color: rgba(102, 227, 255, 0.32);
  border-radius: 11px;
  color: #66e3ff;
  font-size: 12px;
  font-weight: 900;
}

.topbar-link:hover,
.primary-action:hover,
.secondary-action:hover {
  border-color: rgba(102, 227, 255, 0.62);
  background: rgba(102, 227, 255, 0.13);
}

.hero-section,
.content-section,
.handoff-section {
  position: relative;
  z-index: 1;
  width: min(1180px, 100%);
  margin: 0 auto;
}

.hero-section {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.72fr);
  gap: 18px;
  align-items: stretch;
}

.hero-copy {
  display: flex;
  min-height: 600px;
  flex-direction: column;
  justify-content: center;
  padding: 52px 0;
}

.eyebrow {
  margin: 0 0 10px;
  color: #7d8cff;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 800;
  font-size: 11px;
}

.hero-copy h1,
.section-heading h2,
.handoff-section h2 {
  margin: 0;
  color: #f4f7ff;
  letter-spacing: 0;
  line-height: 0.98;
}

.hero-copy h1 {
  max-width: 780px;
  font-size: clamp(48px, 8vw, 86px);
}

.hero-lede {
  max-width: 760px;
  margin: 20px 0 0;
  color: #aab7e8;
  font-size: clamp(17px, 2vw, 20px);
  line-height: 1.55;
}

.hero-actions {
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
}

.primary-action,
.secondary-action {
  min-height: 46px;
  padding: 0 16px;
  border-radius: 14px;
  font-weight: 950;
}

.primary-action {
  border-color: rgba(102, 227, 255, 0.42);
  background:
    radial-gradient(circle at top right, rgba(255, 255, 255, 0.24), transparent 7rem),
    linear-gradient(135deg, #66e3ff, #8c7dff);
  color: #07101c;
  box-shadow: 0 14px 42px rgba(102, 227, 255, 0.18);
}

.primary-action:hover {
  color: #07101c;
}

.hero-metrics {
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 26px;
}

.hero-metrics div {
  min-width: 176px;
  padding: 12px 14px;
  border: 1px solid rgba(145, 166, 255, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.035);
}

.hero-metrics span,
.pass-item span,
.pipeline-node span,
.observability-card span {
  display: block;
  color: #7d8cff;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.hero-metrics strong {
  display: block;
  margin-top: 4px;
  color: #e9efff;
  font-size: 13px;
}

.compiler-card,
.feature-card,
.outcome-card,
.observability-card,
.handoff-section {
  border: 1px solid rgba(145, 166, 255, 0.16);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82);
  box-shadow: 0 18px 80px rgba(0, 0, 0, 0.24);
}

.compiler-card {
  align-self: center;
  border-radius: 24px;
  padding: 18px;
  overflow: hidden;
}

.card-header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.card-header h2 {
  margin: 0;
  font-size: 20px;
}

.mini-pill {
  min-height: 28px;
  padding: 0 10px;
  border-color: rgba(67, 224, 166, 0.26);
  border-radius: 999px;
  color: #43e0a6;
  font-size: 11px;
  font-weight: 900;
}

.pass-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pass-item {
  position: relative;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  padding: 13px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 17px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.07), transparent 9rem),
    rgba(6, 10, 20, 0.68);
}

.pass-item:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 31px;
  bottom: -11px;
  width: 2px;
  height: 11px;
  background: linear-gradient(to bottom, rgba(102, 227, 255, 0.78), transparent);
}

.pass-index {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 13px;
  background: linear-gradient(135deg, #66e3ff, #8c7dff);
  color: #07101c;
  font-weight: 950;
}

.pass-item strong {
  display: block;
  margin-top: 3px;
  color: #eef3ff;
  font-size: 14px;
}

.pass-item p {
  margin: 5px 0 0;
  color: #9ba9d8;
  font-size: 12px;
  line-height: 1.45;
}

.content-section {
  padding: 64px 0 0;
}

.section-heading {
  max-width: 740px;
}

.section-heading.compact {
  max-width: none;
}

.section-heading h2,
.handoff-section h2 {
  font-size: clamp(30px, 5vw, 54px);
}

.section-heading p,
.handoff-section p {
  margin: 14px 0 0;
  color: #9ba9d8;
  font-size: 16px;
  line-height: 1.55;
}

.pipeline-map {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 28px 34px;
  margin-top: 24px;
  padding: 8px 0;
}

.pipeline-node {
  position: relative;
  flex: 1 1 190px;
  min-width: 180px;
  padding: 15px;
  border: 1px solid rgba(145, 166, 255, 0.15);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.07), transparent 10rem),
    rgba(6, 10, 20, 0.78);
}

.pipeline-node:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 100%;
  width: 34px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(102, 227, 255, 0.7), rgba(140, 125, 255, 0.2));
}

.pipeline-node strong {
  display: block;
  min-height: 42px;
  margin: 9px 0 12px;
  color: #eef3ff;
  font-size: 17px;
  line-height: 1.2;
}

.pipeline-node small {
  color: #66e3ff;
  font-size: 12px;
}

.feature-grid,
.outcome-grid,
.observability-grid {
  display: grid;
  gap: 12px;
  margin-top: 22px;
}

.feature-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.feature-card,
.outcome-card,
.observability-card {
  min-width: 0;
  border-radius: 20px;
  padding: 16px;
}

.feature-card {
  min-height: 194px;
}

.feature-dot {
  display: block;
  width: 11px;
  height: 11px;
  margin-bottom: 18px;
  border-radius: 999px;
  background: #66e3ff;
  box-shadow: 0 0 18px rgba(102, 227, 255, 0.75);
}

.feature-card h3,
.outcome-card h3 {
  margin: 0;
  color: #eef3ff;
  font-size: 17px;
  line-height: 1.22;
}

.feature-card p,
.outcome-card p {
  margin: 10px 0 0;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.45;
}

.split-section {
  display: grid;
  grid-template-columns: 0.75fr 1fr;
  gap: 24px;
  align-items: start;
}

.sticky-heading {
  position: sticky;
  top: 72px;
}

.agent-stack {
  display: grid;
  gap: 10px;
}

.agent-row {
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 15px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.035);
}

.agent-orb {
  width: 11px;
  height: 11px;
  margin-top: 5px;
  border-radius: 999px;
  background: #43e0a6;
  box-shadow: 0 0 15px rgba(67, 224, 166, 0.62);
}

.agent-row strong {
  color: #eef3ff;
}

.agent-row p {
  margin: 5px 0 0;
  color: #9ba9d8;
  font-size: 13px;
  line-height: 1.45;
}

.agent-status {
  padding: 5px 8px;
  border: 1px solid rgba(102, 227, 255, 0.22);
  border-radius: 999px;
  color: #9decff;
  font-size: 11px;
  font-weight: 900;
}

.outcome-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.outcome-card {
  min-height: 176px;
}

.outcome-light {
  display: block;
  width: 34px;
  height: 34px;
  margin-bottom: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #66e3ff, #8c7dff);
}

.outcome-card.tone-safe {
  border-color: rgba(67, 224, 166, 0.24);
  background: rgba(67, 224, 166, 0.055);
}

.outcome-card.tone-safe .outcome-light {
  background: linear-gradient(135deg, #43e0a6, #66e3ff);
}

.outcome-card.tone-approval {
  border-color: rgba(255, 209, 102, 0.26);
  background: rgba(255, 209, 102, 0.055);
}

.outcome-card.tone-approval .outcome-light {
  background: linear-gradient(135deg, #ffd166, #8c7dff);
}

.outcome-card.tone-clarify {
  border-color: rgba(140, 125, 255, 0.28);
  background: rgba(140, 125, 255, 0.06);
}

.outcome-card.tone-blocked {
  border-color: rgba(255, 107, 107, 0.26);
  background: rgba(255, 107, 107, 0.055);
}

.outcome-card.tone-blocked .outcome-light {
  background: linear-gradient(135deg, #ff6b6b, #ffd166);
}

.observability-section {
  display: grid;
  grid-template-columns: 0.8fr 1fr;
  gap: 24px;
  align-items: start;
}

.observability-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0;
}

.observability-card {
  min-height: 112px;
}

.observability-card strong {
  display: block;
  margin-top: 10px;
  color: #e9efff;
  font-size: 20px;
  font-weight: 950;
}

.handoff-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.64fr) auto;
  gap: 20px;
  align-items: center;
  margin-top: 70px;
  padding: 22px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(102, 227, 255, 0.08), transparent 18rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
    rgba(8, 12, 22, 0.82);
}

.handoff-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.handoff-list li {
  padding: 10px 12px;
  border: 1px solid rgba(145, 166, 255, 0.13);
  border-radius: 14px;
  color: #cbd6ff;
  background: rgba(255, 255, 255, 0.035);
  font-size: 13px;
}

.handoff-action {
  justify-self: end;
}

@media (max-width: 1100px) {
  .hero-section,
  .split-section,
  .observability-section,
  .handoff-section {
    grid-template-columns: 1fr;
  }

  .hero-copy {
    min-height: auto;
    padding: 38px 0 8px;
  }

  .compiler-card {
    align-self: stretch;
  }

  .feature-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .outcome-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sticky-heading {
    position: static;
  }

  .handoff-action {
    justify-self: start;
  }
}

@media (max-width: 760px) {
  .home-console {
    padding: 64px 10px 72px;
  }

  .topbar {
    padding: 0 10px;
  }

  .brand-path {
    display: none;
  }

  .status-pill {
    min-width: 0;
  }

  .topbar-link {
    display: none;
  }

  .hero-copy h1 {
    font-size: clamp(40px, 14vw, 62px);
  }

  .hero-lede {
    font-size: 16px;
  }

  .hero-metrics {
    display: grid;
    grid-template-columns: 1fr;
  }

  .hero-metrics div,
  .primary-action,
  .secondary-action {
    width: 100%;
  }

  .card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .pipeline-map,
  .feature-grid,
  .outcome-grid,
  .observability-grid {
    grid-template-columns: 1fr;
  }

  .pipeline-map {
    display: grid;
    gap: 10px;
  }

  .pipeline-node:not(:last-child)::after {
    display: none;
  }

  .feature-card,
  .outcome-card {
    min-height: auto;
  }

  .agent-row {
    grid-template-columns: 15px minmax(0, 1fr);
  }

  .agent-status {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
