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

const workflowTiles = [
  {
    label: "Scan",
    value: "Signals",
    note: "Trigger, actors, outputs",
  },
  {
    label: "Route",
    value: "Boundary",
    note: "Automate, approve, block",
  },
  {
    label: "Review",
    value: "Gates",
    note: "Human checkpoints",
  },
  {
    label: "Export",
    value: "Plan",
    note: "Non-executing blueprint",
  },
];
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
          <span class="ff-status ff-status-neutral">Milestone 1 UI</span>
          <NuxtLink to="/compiler" class="ff-toplink">Compiler</NuxtLink>
        </nav>
      </header>

      <section class="ff-grid home-grid" aria-label="FlowForge overview">
        <article class="ff-tile ff-tile-primary hero-tile">
          <div class="ff-tile-inner hero-inner">
            <div>
              <p class="ff-kicker">Safe automation compiler</p>
              <h1 class="ff-title">Find the automation boundary.</h1>
              <p class="ff-copy">
                Messy process in. Human-gated blueprint out.
              </p>
            </div>

            <div class="hero-actions">
              <NuxtLink to="/compiler" class="ff-button hero-button">
                Open compiler preview
              </NuxtLink>
              <span class="ff-chip hero-chip">0 provider calls in M0/M1</span>
            </div>
          </div>
        </article>

        <article class="ff-tile ff-tile-safe outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-safe">Safe</span>
            <h2 class="ff-section-title">Automate</h2>
            <ul class="ff-list">
              <li>Classification</li>
              <li>Risk detection</li>
              <li>Draft-only outputs</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile ff-tile-approval outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-approval">Approval</span>
            <h2 class="ff-section-title">Human gate</h2>
            <ul class="ff-list">
              <li>External messages</li>
              <li>Sensitive decisions</li>
              <li>High-stakes routing</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile ff-tile-blocked outcome-tile">
          <div class="ff-tile-inner">
            <span class="ff-status ff-status-blocked">Blocked</span>
            <h2 class="ff-section-title">No auto-run</h2>
            <ul class="ff-list">
              <li>No sending</li>
              <li>No charging</li>
              <li>No destructive actions</li>
            </ul>
          </div>
        </article>

        <article class="ff-tile flow-tile">
          <div class="ff-tile-inner">
            <p class="ff-kicker">How it works</p>
            <h2 class="ff-page-title">A compiler pass, not a chatbot guess.</h2>
            <div class="flow-grid" aria-label="Compiler stages">
              <section v-for="tile in workflowTiles" :key="tile.label" class="flow-step">
                <span>{{ tile.label }}</span>
                <strong>{{ tile.value }}</strong>
                <small>{{ tile.note }}</small>
              </section>
            </div>
          </div>
        </article>

        <article class="ff-tile ff-tile-muted scope-tile">
          <div class="ff-tile-inner">
            <p class="ff-kicker">Current scope</p>
            <p class="ff-metric">M1</p>
            <h2 class="ff-section-title">Tile-based prototype</h2>
            <p class="ff-copy">
              UI only. No backend logic, AI integration, database, auth, n8n
              export, or real-world execution.
            </p>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>

<style scoped>
.home-grid {
  grid-auto-flow: dense;
}

.hero-tile {
  grid-column: span 8;
  min-height: 352px;
}

.hero-inner {
  display: flex;
  min-height: 352px;
  flex-direction: column;
  justify-content: space-between;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.hero-button {
  background: #ffffff;
  color: var(--ff-primary-strong);
}

.hero-button:hover {
  background: var(--ff-primary-soft);
}

.hero-chip {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.outcome-tile {
  grid-column: span 4;
  min-height: 164px;
}

.outcome-tile .ff-status {
  margin-bottom: 18px;
}

.flow-tile {
  grid-column: span 8;
}

.scope-tile {
  grid-column: span 4;
}

.flow-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.flow-step {
  display: grid;
  min-height: 112px;
  align-content: space-between;
  padding: 12px;
  border: 1px solid var(--ff-border);
  border-radius: 12px;
  background: var(--ff-surface-muted);
}

.flow-step span {
  color: var(--ff-primary);
  font-size: 0.74rem;
  font-weight: 950;
  text-transform: uppercase;
}

.flow-step strong {
  font-size: 1.12rem;
}

.flow-step small {
  color: var(--ff-muted);
  font-size: 0.8rem;
}

@media (max-width: 920px) {
  .hero-tile,
  .flow-tile {
    grid-column: span 12;
  }

  .outcome-tile,
  .scope-tile {
    grid-column: span 6;
  }

  .flow-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .hero-tile,
  .outcome-tile,
  .flow-tile,
  .scope-tile {
    grid-column: span 1;
  }

  .hero-tile,
  .hero-inner {
    min-height: 320px;
  }

  .flow-grid {
    grid-template-columns: 1fr;
  }
}
</style>
