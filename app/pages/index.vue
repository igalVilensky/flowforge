<script setup lang="ts">
import {
  ArrowRight,
  Blocks,
  Bot,
  Braces,
  Check,
  Compass,
  FileJson2,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-vue-next";

const compilerStages = [
  { label: "Route", icon: Route, tone: "cyan" },
  { label: "Clarify", icon: Search, tone: "violet" },
  { label: "Design", icon: Blocks, tone: "blue" },
  { label: "Review", icon: ShieldCheck, tone: "green" },
];
</script>

<template>
  <main class="index-page">
    <div class="ambient-grid" aria-hidden="true" />
    <div class="ambient-glow glow-one" aria-hidden="true" />
    <div class="ambient-glow glow-two" aria-hidden="true" />

    <header class="topbar">
      <div class="brand-group">
        <div class="brand-mark">FF</div>
        <div class="brand-copy">
          <strong>FlowForge</strong>
          <span>AI Agents & Automations · Final Project</span>
        </div>
      </div>

      <div class="topbar-meta">
        <span class="meta-chip">
          <span class="meta-dot" />
          Prototype · non-executing by design
        </span>
      </div>
    </header>

    <section class="hero-shell">
      <div class="hero-copy">
        <div class="eyebrow">
          <Sparkles :size="14" />
          Discover, design, and export automation workflows
        </div>

        <h1>
          From idea to
          <span>importable n8n workflow draft.</span>
        </h1>

        <p class="hero-summary">
          Compile your own automation request through a transparent, safety-reviewed
          multi-agent pipeline—or let Automation Studio research the web and suggest
          a practical use case first.
        </p>

        <div class="value-line" aria-label="FlowForge process">
          <span>Use case</span>
          <ArrowRight :size="14" />
          <span>Clarify and review</span>
          <ArrowRight :size="14" />
          <span>Workflow blueprint</span>
          <ArrowRight :size="14" />
          <span>n8n JSON skeleton</span>
        </div>

        <div class="hero-actions">
          <NuxtLink to="/compiler" class="primary-action">
            <Workflow :size="18" />
            Open Compiler
            <ArrowRight :size="16" />
          </NuxtLink>

          <NuxtLink to="/automation-studio" class="secondary-action">
            <Compass :size="18" />
            Explore Automation Studio
          </NuxtLink>
        </div>

        <div class="capability-row">
          <span><Check :size="14" /> Compiler: request → reviewed n8n draft</span>
          <span><Check :size="14" /> Studio: web research → suggested use case</span>
        </div>
      </div>

      <div class="hero-visual" aria-label="FlowForge system overview">
        <div class="visual-header">
          <div>
            <span class="visual-kicker">Live system preview</span>
            <strong>Multi-agent workflow compiler</strong>
          </div>
          <span class="system-state">
            <span />
            Observable
          </span>
        </div>

        <div class="compiler-map">
          <div class="input-node mini-node">
            <span class="node-icon"><Braces :size="18" /></span>
            <div>
              <small>Input</small>
              <strong>Automation request</strong>
            </div>
          </div>

          <div class="agent-track">
            <div class="track-line" aria-hidden="true">
              <span class="track-pulse" />
            </div>

            <div
              v-for="(stage, index) in compilerStages"
              :key="stage.label"
              class="agent-stage"
              :class="`tone-${stage.tone}`"
              :style="{ '--delay': `${index * 0.5}s` }"
            >
              <span class="stage-icon">
                <component :is="stage.icon" :size="19" />
              </span>
              <small>Agent {{ index + 1 }}</small>
              <strong>{{ stage.label }}</strong>
            </div>
          </div>

          <div class="output-stack">
            <div class="output-node blueprint-node">
              <span class="node-icon"><Workflow :size="19" /></span>
              <div>
                <small>Structured output</small>
                <strong>Safety-reviewed blueprint</strong>
              </div>
              <ShieldCheck :size="18" class="output-check" />
            </div>

            <div class="output-node json-node">
              <span class="node-icon"><FileJson2 :size="19" /></span>
              <div>
                <small>Implementation artifact</small>
                <strong>Inactive n8n JSON draft</strong>
              </div>
              <span class="manual-badge">manual review</span>
            </div>
          </div>
        </div>

        <div class="visual-footer">
          <span><Bot :size="15" /> AI agents</span>
          <span><ShieldCheck :size="15" /> Safety critic</span>
          <span><FileJson2 :size="15" /> Schema validation</span>
          <span><Blocks :size="15" /> Inspectable nodes</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html),
:global(body),
:global(#__nuxt) {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

:global(body) {
  overflow: hidden;
  background: #070b12;
  color: #f4f7fb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.index-page {
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  height: 100dvh;
  overflow: hidden;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr);
  background:
    radial-gradient(circle at 76% 35%, rgba(72, 177, 255, 0.08), transparent 28%),
    radial-gradient(circle at 18% 78%, rgba(124, 111, 242, 0.08), transparent 30%),
    #070b12;
}

.ambient-grid {
  position: absolute;
  inset: 0;
  z-index: -3;
  opacity: 0.2;
  background-image:
    linear-gradient(rgba(96, 125, 160, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96, 125, 160, 0.12) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: linear-gradient(to bottom, transparent, black 18%, black 78%, transparent);
}

.ambient-glow {
  position: absolute;
  z-index: -2;
  width: 440px;
  height: 440px;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.12;
  pointer-events: none;
}

.glow-one {
  top: -180px;
  right: 9%;
  background: #48b1ff;
}

.glow-two {
  bottom: -220px;
  left: 5%;
  background: #7c6ff2;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 28px;
  border-bottom: 1px solid #263247;
  background: rgba(12, 18, 29, 0.9);
  backdrop-filter: blur(16px);
}

.brand-group,
.brand-copy,
.topbar-meta,
.meta-chip,
.eyebrow,
.hero-actions,
.capability-row,
.value-line,
.visual-header,
.system-state,
.mini-node,
.output-node,
.visual-footer span {
  display: flex;
  align-items: center;
}

.brand-group {
  gap: 12px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid #3b4b66;
  border-radius: 9px;
  background: linear-gradient(145deg, rgba(124, 111, 242, 0.22), rgba(72, 177, 255, 0.08));
  box-shadow: inset 0 0 18px rgba(145, 133, 255, 0.08);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.03em;
}

.brand-copy {
  align-items: flex-start;
  flex-direction: column;
  gap: 1px;
}

.brand-copy strong {
  font-size: 0.92rem;
}

.brand-copy span {
  color: #6f7b8e;
  font-size: 0.72rem;
  font-weight: 650;
}

.meta-chip {
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid #2a3850;
  border-radius: 8px;
  background: #111a29;
  color: #a7b1c2;
  font-size: 0.76rem;
  font-weight: 700;
}

.meta-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3ddc97;
  box-shadow: 0 0 12px rgba(61, 220, 151, 0.65);
}

.hero-shell {
  width: min(1480px, 100%);
  min-height: 0;
  margin: 0 auto;
  padding: clamp(18px, 2.6vh, 30px) clamp(28px, 5vw, 70px) clamp(16px, 2.4vh, 26px);
  display: grid;
  grid-template-columns: minmax(420px, 0.86fr) minmax(570px, 1.14fr);
  align-items: center;
  gap: clamp(28px, 4vw, 60px);
}

.hero-copy {
  min-width: 0;
}

.eyebrow {
  width: fit-content;
  gap: 8px;
  margin-bottom: 12px;
  color: #8ecfff;
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.eyebrow svg {
  color: #9185ff;
}

h1 {
  max-width: 720px;
  margin: 0;
  color: #f7f9fc;
  font-size: clamp(2.3rem, 3.9vw, 4.35rem);
  line-height: 1.01;
  letter-spacing: -0.055em;
}

h1 span {
  display: block;
  margin-top: 6px;
  background: linear-gradient(92deg, #a79fff 0%, #73c7ff 54%, #62e4b0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero-summary {
  max-width: 650px;
  margin: 16px 0 0;
  color: #a7b1c2;
  font-size: clamp(0.94rem, 1.05vw, 1.06rem);
  line-height: 1.55;
}

.value-line {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  color: #6f7b8e;
  font-size: 0.78rem;
  font-weight: 750;
}

.value-line span {
  padding: 5px 8px;
  border: 1px solid #263247;
  border-radius: 6px;
  background: rgba(18, 27, 42, 0.8);
  color: #a7b1c2;
}

.value-line svg {
  color: #465773;
}

.hero-actions {
  flex-wrap: wrap;
  gap: 11px;
  margin-top: 20px;
}

.primary-action,
.secondary-action {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 46px;
  border-radius: 9px;
  padding: 0 18px;
  color: #f4f7fb;
  font-size: 0.9rem;
  font-weight: 760;
  text-decoration: none;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.primary-action {
  border: 1px solid rgba(145, 133, 255, 0.72);
  background: linear-gradient(135deg, #7567e8, #5e75dd);
  box-shadow: 0 12px 34px rgba(82, 72, 192, 0.24);
}

.secondary-action {
  border: 1px solid #31415a;
  background: #111a29;
}

.primary-action::before,
.secondary-action::before {
  content: "";
  position: absolute;
  inset: -80% -35%;
  background: linear-gradient(110deg, transparent 43%, rgba(255, 255, 255, 0.16) 50%, transparent 57%);
  transform: translateX(-65%);
  transition: transform 0.65s ease;
}

.primary-action:hover,
.secondary-action:hover {
  transform: translateY(-2px);
  border-color: #6684ad;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.25), 0 0 24px rgba(72, 177, 255, 0.09);
}

.primary-action:hover::before,
.secondary-action:hover::before {
  transform: translateX(65%);
}

.capability-row {
  flex-wrap: wrap;
  gap: 14px 18px;
  margin-top: 16px;
  color: #7f8ba0;
  font-size: 0.78rem;
  font-weight: 650;
}

.capability-row span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.capability-row svg {
  color: #3ddc97;
}

.hero-visual {
  position: relative;
  min-width: 0;
  border: 1px solid #2b3a51;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(21, 31, 48, 0.96), rgba(12, 18, 29, 0.98)),
    #0f1623;
  box-shadow:
    0 34px 100px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.025),
    0 0 0 1px rgba(72, 177, 255, 0.025);
  overflow: hidden;
}

.hero-visual::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(105, 134, 170, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(105, 134, 170, 0.045) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: linear-gradient(to bottom, black, transparent 88%);
}

.visual-header {
  position: relative;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 18px;
  border-bottom: 1px solid #263247;
  background: rgba(12, 18, 29, 0.72);
}

.visual-header > div {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
}

.visual-kicker {
  color: #6f7b8e;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.visual-header strong {
  font-size: 0.91rem;
}

.system-state {
  gap: 7px;
  color: #7edcb2;
  font-size: 0.73rem;
  font-weight: 800;
}

.system-state span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3ddc97;
  box-shadow: 0 0 13px rgba(61, 220, 151, 0.74);
  animation: statePulse 1.8s ease-in-out infinite;
}

.compiler-map {
  position: relative;
  padding: clamp(20px, 3vh, 34px) 22px 24px;
}

.mini-node,
.output-node {
  position: relative;
  gap: 11px;
  border: 1px solid #30415b;
  border-radius: 10px;
  background: rgba(17, 26, 41, 0.94);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
}

.mini-node {
  width: min(250px, 54%);
  min-height: 58px;
  padding: 10px 12px;
}

.node-icon,
.stage-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
}

.node-icon {
  width: 36px;
  height: 36px;
  background: rgba(124, 111, 242, 0.13);
  color: #a79fff;
}

.mini-node div,
.output-node div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mini-node small,
.output-node small,
.agent-stage small {
  color: #6f7b8e;
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mini-node strong,
.output-node strong {
  font-size: 0.78rem;
}

.agent-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 25px 0;
}

.track-line {
  position: absolute;
  z-index: 0;
  top: 35px;
  left: 8%;
  right: 8%;
  height: 2px;
  border-radius: 99px;
  overflow: hidden;
  background: #28374d;
  box-shadow: 0 0 12px rgba(72, 177, 255, 0.08);
}

.track-pulse {
  position: absolute;
  top: -1px;
  left: -28%;
  width: 28%;
  height: 4px;
  border-radius: 99px;
  background: linear-gradient(90deg, transparent, #73c7ff 42%, #6ce1b0 70%, transparent);
  filter: drop-shadow(0 0 7px rgba(72, 177, 255, 0.8));
  animation: trackFlow 2.5s linear infinite;
}

.agent-stage {
  --stage-color: #73c7ff;
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 102px;
  padding: 12px 8px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  border: 1px solid #2e3e56;
  border-radius: 11px;
  background: rgba(15, 23, 36, 0.97);
  text-align: center;
  animation: stageGlow 2.5s ease-in-out infinite;
  animation-delay: var(--delay);
}

.agent-stage.tone-violet { --stage-color: #9d93ff; }
.agent-stage.tone-blue { --stage-color: #73c7ff; }
.agent-stage.tone-green { --stage-color: #56dda4; }

.stage-icon {
  width: 38px;
  height: 38px;
  margin-bottom: 2px;
  border: 1px solid color-mix(in srgb, var(--stage-color) 34%, transparent);
  background: color-mix(in srgb, var(--stage-color) 12%, transparent);
  color: var(--stage-color);
  box-shadow: 0 0 16px color-mix(in srgb, var(--stage-color) 10%, transparent);
}

.agent-stage strong {
  color: #eaf0f8;
  font-size: 0.76rem;
}

.output-stack {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.output-node {
  min-width: 0;
  min-height: 66px;
  padding: 11px 12px;
}

.output-node.blueprint-node {
  border-color: rgba(61, 220, 151, 0.34);
  background: linear-gradient(145deg, rgba(61, 220, 151, 0.08), rgba(17, 26, 41, 0.96) 48%);
}

.output-node.blueprint-node .node-icon {
  background: rgba(61, 220, 151, 0.12);
  color: #62e4b0;
}

.output-check {
  margin-left: auto;
  color: #56dda4;
}

.json-node .node-icon {
  background: rgba(72, 177, 255, 0.11);
  color: #73c7ff;
}

.manual-badge {
  margin-left: auto;
  padding: 4px 7px;
  border: 1px solid rgba(244, 184, 96, 0.28);
  border-radius: 6px;
  background: rgba(244, 184, 96, 0.08);
  color: #e8ae5d;
  font-size: 0.58rem;
  font-weight: 850;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.visual-footer {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid #263247;
  background: rgba(10, 15, 25, 0.72);
}

.visual-footer span {
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  color: #7f8ba0;
  font-size: 0.65rem;
  font-weight: 720;
  white-space: nowrap;
}

.visual-footer span + span {
  border-left: 1px solid #263247;
}

.visual-footer svg {
  color: #7291b5;
}

@keyframes trackFlow {
  from { transform: translateX(0); }
  to { transform: translateX(460%); }
}

@keyframes stageGlow {
  0%, 58%, 100% {
    border-color: #2e3e56;
    box-shadow: none;
    transform: translateY(0);
  }
  12%, 26% {
    border-color: color-mix(in srgb, var(--stage-color) 68%, #2e3e56);
    box-shadow: 0 0 22px color-mix(in srgb, var(--stage-color) 16%, transparent), inset 0 0 18px color-mix(in srgb, var(--stage-color) 5%, transparent);
    transform: translateY(-2px);
  }
}

@keyframes statePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.38; }
}

@media (max-width: 1050px) {
  .hero-shell {
    grid-template-columns: 0.82fr 1.18fr;
    gap: 28px;
    padding-inline: 28px;
  }

  h1 {
    font-size: clamp(2.3rem, 5vw, 4.2rem);
  }

  .hero-summary {
    font-size: 0.96rem;
  }

  .capability-row {
    gap: 8px 12px;
  }
}

@media (max-width: 820px) {
  :global(body) {
    overflow: auto;
  }

  .index-page {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }

  .hero-shell {
    grid-template-columns: 1fr;
    align-content: center;
    gap: 30px;
    padding-top: 30px;
  }

  .hero-copy {
    text-align: center;
  }

  .eyebrow,
  .hero-actions,
  .capability-row,
  .value-line {
    justify-content: center;
    margin-inline: auto;
  }

  .hero-summary {
    margin-inline: auto;
  }

  .hero-visual {
    width: min(680px, 100%);
    margin-inline: auto;
  }
}

@media (max-width: 600px) {
  .topbar {
    padding: 0 14px;
  }

  .brand-copy span,
  .topbar-meta {
    display: none;
  }

  .hero-shell {
    padding: 24px 14px 30px;
  }

  h1 {
    font-size: 2.55rem;
  }

  .value-line {
    display: none;
  }

  .hero-actions {
    flex-direction: column;
  }

  .primary-action,
  .secondary-action {
    width: 100%;
  }

  .agent-track {
    grid-template-columns: repeat(2, 1fr);
  }

  .track-line {
    display: none;
  }

  .output-stack,
  .visual-footer {
    grid-template-columns: 1fr;
  }

  .visual-footer span + span {
    border-left: 0;
    border-top: 1px solid #263247;
  }

  .manual-badge {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .track-pulse,
  .agent-stage,
  .system-state span {
    animation: none !important;
  }

  .primary-action,
  .secondary-action {
    transition: none;
  }
}
</style>