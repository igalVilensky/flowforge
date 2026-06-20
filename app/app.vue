<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </div>
</template>

<style>
:root {
  --ff-bg: #f3f6f7;
  --ff-surface: #ffffff;
  --ff-surface-muted: #eef3f4;
  --ff-ink: #172026;
  --ff-muted: #65737e;
  --ff-border: #d7e0e4;
  --ff-primary: #007c78;
  --ff-primary-strong: #005f5c;
  --ff-primary-soft: #d7f4f1;
  --ff-safe: #168a55;
  --ff-safe-soft: #dcfce7;
  --ff-approval: #b7791f;
  --ff-approval-soft: #fef3c7;
  --ff-blocked: #c33a32;
  --ff-blocked-soft: #fee2e2;
  --ff-neutral-soft: #edf1f4;
  --ff-shadow: 0 18px 46px rgba(23, 32, 38, 0.08);
  --ff-radius: 14px;
  --ff-gap: 14px;
  --ff-shell: 1120px;
}

* {
  box-sizing: border-box;
}

html {
  min-height: 100%;
  background: var(--ff-bg);
}

body {
  min-height: 100%;
  margin: 0;
  background: var(--ff-bg);
  color: var(--ff-ink);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  line-height: 1.5;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  border: 0;
}

a {
  color: inherit;
}

.ff-page {
  min-height: 100vh;
  padding: 20px;
}

.ff-shell {
  width: min(var(--ff-shell), 100%);
  margin: 0 auto;
}

.ff-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ff-gap);
  min-height: 48px;
  margin-bottom: var(--ff-gap);
}

.ff-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ff-ink);
  font-size: 1rem;
  font-weight: 900;
  text-decoration: none;
}

.ff-brand-mark {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: var(--ff-primary);
  color: #ffffff;
  font-weight: 950;
}

.ff-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ff-toplink,
.ff-chip,
.ff-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid var(--ff-border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: var(--ff-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}

.ff-toplink:hover {
  border-color: var(--ff-primary);
  color: var(--ff-primary);
}

.ff-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--ff-gap);
}

.ff-tile {
  min-width: 0;
  border: 1px solid var(--ff-border);
  border-radius: var(--ff-radius);
  background: var(--ff-surface);
  box-shadow: var(--ff-shadow);
}

.ff-tile-inner {
  padding: 18px;
}

.ff-tile-primary {
  background:
    linear-gradient(135deg, rgba(0, 124, 120, 0.96), rgba(0, 95, 92, 0.94)),
    var(--ff-primary);
  border-color: rgba(0, 95, 92, 0.25);
  color: #ffffff;
}

.ff-tile-muted {
  background: var(--ff-surface-muted);
}

.ff-tile-safe {
  border-color: #b7ebcb;
  background: #f2fff7;
}

.ff-tile-approval {
  border-color: #f2d78c;
  background: #fffbeb;
}

.ff-tile-blocked {
  border-color: #f2b8b5;
  background: #fff5f5;
}

.ff-kicker {
  margin: 0 0 8px;
  color: var(--ff-primary);
  font-size: 0.74rem;
  font-weight: 950;
  letter-spacing: 0;
  text-transform: uppercase;
}

.ff-tile-primary .ff-kicker {
  color: #a8fff8;
}

.ff-title {
  margin: 0;
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 0.98;
  letter-spacing: 0;
}

.ff-page-title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.65rem);
  line-height: 1.02;
  letter-spacing: 0;
}

.ff-section-title {
  margin: 0;
  font-size: 1.12rem;
  line-height: 1.2;
}

.ff-copy {
  margin: 10px 0 0;
  color: var(--ff-muted);
}

.ff-tile-primary .ff-copy {
  color: rgba(255, 255, 255, 0.84);
}

.ff-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.ff-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 15px;
  border-radius: 10px;
  background: var(--ff-primary);
  color: #ffffff;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.ff-button:hover {
  background: var(--ff-primary-strong);
}

.ff-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.ff-button-secondary {
  border: 1px solid var(--ff-border);
  background: #ffffff;
  color: var(--ff-ink);
}

.ff-button-secondary:hover {
  border-color: var(--ff-primary);
  background: #ffffff;
  color: var(--ff-primary);
}

.ff-list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.ff-list li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--ff-muted);
  font-size: 0.93rem;
}

.ff-list li::before {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--ff-primary);
  content: "";
}

.ff-tile-safe .ff-list li::before {
  background: var(--ff-safe);
}

.ff-tile-approval .ff-list li::before {
  background: var(--ff-approval);
}

.ff-tile-blocked .ff-list li::before {
  background: var(--ff-blocked);
}

.ff-status-safe {
  border-color: #b7ebcb;
  background: var(--ff-safe-soft);
  color: var(--ff-safe);
}

.ff-status-approval {
  border-color: #f2d78c;
  background: var(--ff-approval-soft);
  color: var(--ff-approval);
}

.ff-status-blocked {
  border-color: #f2b8b5;
  background: var(--ff-blocked-soft);
  color: var(--ff-blocked);
}

.ff-status-neutral {
  background: var(--ff-neutral-soft);
  color: var(--ff-muted);
}

.ff-metric {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.4rem);
  font-weight: 950;
  line-height: 1;
}

.ff-field-label {
  display: grid;
  gap: 7px;
  color: var(--ff-ink);
  font-size: 0.86rem;
  font-weight: 850;
}

.ff-textarea,
.ff-select {
  width: 100%;
  border: 1px solid var(--ff-border);
  border-radius: 10px;
  background: #ffffff;
  color: var(--ff-ink);
}

.ff-textarea {
  min-height: 154px;
  padding: 12px;
  line-height: 1.48;
  resize: vertical;
}

.ff-select {
  min-height: 42px;
  padding: 0 12px;
}

.ff-textarea:focus,
.ff-select:focus {
  border-color: var(--ff-primary);
  outline: 3px solid var(--ff-primary-soft);
}

.ff-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ff-chip-button {
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

.ff-chip-button:hover,
.ff-chip-button.is-active {
  border-color: var(--ff-primary);
  background: var(--ff-primary-soft);
  color: var(--ff-primary-strong);
}

.ff-error {
  margin: var(--ff-gap) 0 0;
  padding: 12px 14px;
  border: 1px solid #f2b8b5;
  border-radius: 10px;
  background: #fff5f5;
  color: var(--ff-blocked);
  font-weight: 800;
}

.ff-details-toggle {
  width: 100%;
  min-height: 46px;
  border: 1px solid var(--ff-border);
  border-radius: 12px;
  background: #ffffff;
  color: var(--ff-ink);
  font-weight: 900;
  cursor: pointer;
}

.ff-details-toggle:hover {
  border-color: var(--ff-primary);
  color: var(--ff-primary);
}

.ff-detail-list,
.ff-metrics {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ff-detail-list li,
.ff-metrics div {
  display: grid;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ff-border);
}

.ff-detail-list li:last-child,
.ff-metrics div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.ff-detail-list strong,
.ff-metrics dt {
  color: var(--ff-ink);
  font-size: 0.88rem;
}

.ff-detail-list span,
.ff-detail-list p,
.ff-metrics dd {
  margin: 0;
  color: var(--ff-muted);
  font-size: 0.9rem;
}

.ff-metrics div {
  grid-template-columns: 1fr auto;
  align-items: center;
}

.ff-metrics dd {
  color: var(--ff-ink);
  font-weight: 950;
}

@media (max-width: 760px) {
  .ff-page {
    padding: 12px;
  }

  .ff-topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .ff-nav {
    width: 100%;
    justify-content: space-between;
  }

  .ff-grid {
    grid-template-columns: 1fr;
  }

  .ff-tile-inner {
    padding: 15px;
  }

  .ff-button {
    width: 100%;
  }
}
</style>
