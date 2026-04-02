# Gate 2 — Availability Performance Budget

Status: DRAFT  
Gate: 2 — Performance Budgets and Measured Evidence  
Scope: Availability flow only

## Purpose

This document defines the written performance budgets, measurement semantics, and evidence requirements required for Gate 2 to pass for the availability flow.

Gate 2 PASS requires all of the following:

1. Explicit written budgets exist for the required availability metrics.
2. p50, p95, and p99 targets are defined.
3. Measured evidence exists from repeatable runs.
4. Test conditions are documented.
5. Regressions are detectable over time in CI.

---

## Metrics in Scope

The following five metrics are required for Gate 2.

### 1) drawer_open_to_first_usable_ms

**Definition**  
Elapsed time from the user opening the availability drawer to the first usable state.

**Start event**  
User activates the booking CTA / availability drawer open trigger.

**Stop event**  
All of the following are true:
- availability drawer is visible
- first day button is visible
- first time slot is visible
- blocking loading state is gone

**Budget**
- p50 <= 700 ms
- p95 <= 1500 ms
- p99 <= 2500 ms

---

### 2) day_switch_to_times_visible_ms

**Definition**  
Elapsed time from selecting a different day to the updated times becoming visible for that day.

**Start event**  
User clicks a different day button inside the availability drawer.

**Stop event**  
Updated slot list for the selected day is visible and ready for interaction.

**Budget**
- p50 <= 400 ms
- p95 <= 900 ms
- p99 <= 1500 ms

---

### 3) hold_request_latency_ms

**Definition**  
Elapsed time for the hold creation request.

**Start event**  
Client initiates the POST `/api/holds` request after selecting a time.

**Stop event**  
Client receives the HTTP response for POST `/api/holds`.

**Budget**
- p50 <= 300 ms
- p95 <= 800 ms
- p99 <= 1500 ms

---

### 4) continue_to_add_ons_ms

**Definition**  
Elapsed time from clicking Continue to the add-ons page being usable.

**Start event**  
User clicks the Continue / Continue to add-ons button.

**Stop event**  
Add-ons page heading or canonical page test id is visible and ready.

**Budget**
- p50 <= 500 ms
- p95 <= 1200 ms
- p99 <= 2000 ms

---

### 5) background_refresh_ms

**Definition**  
Elapsed time for a non-blocking background refresh of already-visible availability data.

**Start event**  
Background refresh begins while stale availability data remains visible.

**Stop event**  
Refreshed availability data has been applied and the refresh indicator is no longer shown.

**Budget**
- p50 <= 800 ms
- p95 <= 1800 ms
- p99 <= 3000 ms

---

## Gate Rules

### Release gating
- p95 is the release gate for each required metric.
- p99 is the escalation threshold and must still stay within the written budget.
- p50 is tracked and reported, but p95 and p99 determine compliance.

### Pass criteria
Gate 2 passes only when:
- all five required metrics have written budgets
- all five required metrics have measured p50, p95, and p99 evidence
- all test conditions below are documented and used
- CI can fail on regression or budget breach

---

## Test Conditions

All measured evidence must record the following conditions.

### Environments
- CI desktop run
- CI mobile run

### Devices / browser profiles
- Desktop Chrome
- Pixel 7 emulation

### Cache state
- cold run: relevant availability cache cleared before scenario
- warm/background refresh run: stale cached summary present before refresh scenario

### Data shape
- canonical seeded professional
- canonical seeded offering/service
- canonical seeded add-on
- deterministic availability window and slot population

### Network
- default CI network unless otherwise specified
- if throttled runs are added later, they must be labeled separately and may not replace the default CI evidence set

### CPU
- default CI CPU unless otherwise specified
- any throttled CPU evidence must be labeled separately

### Sample size
- minimum 30 samples per metric per environment for PR gating
- preferred 100 samples per metric per environment for nightly trend analysis

---

## Evidence Requirements

Each evidence run must produce:

1. Raw sample artifact
2. Aggregated summary artifact
3. Commit SHA
4. Run date/time
5. Environment label
6. Device/profile label
7. Sample count
8. p50, p95, p99 for all five metrics

### Required evidence artifacts
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

---

## Regression Detection

Regression detection is required for Gate 2.

### CI requirements
CI must:
- compare measured values against these budgets
- fail if any required metric exceeds its budget
- persist summary artifacts
- retain a baseline or historical summary for comparison over time

### Baseline artifact
A baseline file should exist after the first approved run, for example:
- `docs/performance/baselines/availability-gate2-baseline.json`

### Optional warning thresholds
- warn if p95 regresses by more than 15% versus baseline
- warn if sample size is below required minimum

---

## Implementation Notes

This document is the source of truth for Gate 2 budget definitions.  
Instrumentation, Playwright perf harnesses, aggregation scripts, and CI checks must match these metric names and event semantics exactly.

---

## Approval

Owner: Tori Morales  
Status: Draft pending implementation alignment  
Last updated: 2026-04-01
