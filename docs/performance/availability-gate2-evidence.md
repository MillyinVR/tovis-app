# Gate 2 — Availability Evidence

Status: DRAFT TEMPLATE  
Gate: 2 — Performance Budgets and Measured Evidence  
Scope: Availability flow only

---

## Result

Result: PENDING

This document is the human-readable evidence artifact for Gate 2.  
Complete it after an approved perf run and keep it aligned with:

- `docs/performance/availability-gate2-budget.json`
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`
- `docs/performance/baselines/availability-gate2-baseline.json`

---

## Run metadata

- Commit SHA: `REPLACE_WITH_COMMIT_SHA`
- Run date: `REPLACE_WITH_ISO_TIMESTAMP`
- Workflow: `perf-availability`
- Trigger: `pull_request | push | workflow_dispatch`
- Budget source: `docs/performance/availability-gate2-budget.json`
- Summary artifact: `artifacts/perf/availability/summary.json`
- Raw desktop artifact: `artifacts/perf/availability/raw-desktop.json`
- Raw mobile artifact: `artifacts/perf/availability/raw-mobile.json`

---

## Test conditions

### Environments tested
- Desktop Chrome
- Pixel 7 emulation

### Cache rules
- cold scenarios clear relevant availability cache before each sample
- background refresh scenarios use intentionally stale visible data

### Network / CPU
- default CI network unless explicitly labeled otherwise
- default CI CPU unless explicitly labeled otherwise

### Data determinism
- canonical seeded professional
- canonical seeded offering
- canonical seeded add-on
- deterministic availability window and slot population

### Sample count target
- PR gating minimum: 30 per metric per environment
- Nightly preferred: 100 per metric per environment

---

## Desktop results

Device profile: `Desktop Chrome`

| Metric | Count | p50 | p95 | p99 | Budget status |
| --- | ---: | ---: | ---: | ---: | --- |
| drawer open to first usable | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| day switch to times visible | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| hold request latency | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| continue to add-ons | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| background refresh | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |

---

## Mobile results

Device profile: `Pixel 7 emulation`

| Metric | Count | p50 | p95 | p99 | Budget status |
| --- | ---: | ---: | ---: | ---: | --- |
| drawer open to first usable | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| day switch to times visible | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| hold request latency | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| continue to add-ons | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |
| background refresh | REPLACE | REPLACE | REPLACE | REPLACE | REPLACE |

---

## Invalid sample summary

### Desktop
- invalid sample count: `REPLACE`
- invalid reasons:
  - `REPLACE_REASON`: `REPLACE_COUNT`

### Mobile
- invalid sample count: `REPLACE`
- invalid reasons:
  - `REPLACE_REASON`: `REPLACE_COUNT`

---

## Budget verdict

### Required pass conditions
- all five required metrics have written budgets
- desktop and mobile each have p50 / p95 / p99
- required sample counts are met
- p95 budgets pass
- p99 budgets pass
- CI can detect regressions over time

### Final budget verdict
Result: `REPLACE_WITH_PASS_FAIL_OR_PASS_WITH_WARNINGS`

Blocking failures:
- `REPLACE_IF_ANY`

Warnings:
- `REPLACE_IF_ANY`

---

## Baseline comparison summary

Baseline file:
- `docs/performance/baselines/availability-gate2-baseline.json`

Summary:
- desktop p95 delta vs baseline: `REPLACE`
- mobile p95 delta vs baseline: `REPLACE`

Notes:
- `REPLACE`
- `REPLACE`

---

## Artifact paths

- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`
- `docs/performance/baselines/availability-gate2-baseline.json`

---

## Auditor notes

- This document summarizes evidence and does not replace raw artifacts.
- Do not mark Gate 2 PASS until measured evidence exists for all required metrics.
- If background refresh is still pending stale-cache setup, Gate 2 remains incomplete.
