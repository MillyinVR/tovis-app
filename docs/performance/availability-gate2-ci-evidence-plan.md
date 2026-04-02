# Gate 2 — Availability CI and Evidence Plan

Status: DRAFT  
Scope: Availability flow only

This file defines how Gate 2 performance evidence is produced in CI, stored as artifacts, compared against baseline, and summarized for human review.

---

## Goal

Turn the Gate 2 performance system into a repeatable CI gate that:

1. runs availability perf collection
2. aggregates results
3. checks budgets
4. uploads raw and summary artifacts
5. preserves evidence for audit
6. compares against a baseline
7. produces a final human-readable evidence document

---

## File placement

### CI workflow
- `.github/workflows/perf-availability.yml`

### Evidence docs
- `docs/performance/availability-gate2-evidence.md`
- `docs/performance/baselines/availability-gate2-baseline.json`

### Generated artifacts
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

---

## Workflow goal

The workflow should produce one complete Gate 2 result for each CI run:
- PASS
- FAIL
- PASS with warnings

The workflow should fail the job only when the budget checker fails.

---

## Workflow name

Recommended workflow file:
- `.github/workflows/perf-availability.yml`

Recommended workflow name:
- `perf-availability`

---

## Trigger strategy

### Required triggers
- pull_request
- push to main
- workflow_dispatch

### Recommended future trigger
- scheduled nightly run

Why:
- PR runs enforce budgets before merge
- main runs produce current evidence
- nightly runs produce richer trend data with larger sample counts

---

## Job layout

Recommended initial layout: one workflow with one main job.

### Job name
- `availability-performance`

### Job phases
1. checkout
2. setup Node
3. install dependencies
4. install Playwright browsers
5. setup database
6. seed canonical test data
7. run desktop perf collection
8. run mobile perf collection
9. aggregate results
10. check budgets
11. upload artifacts
12. publish final evidence summary

This is enough for v1.
Split into multiple jobs only if runtime becomes painful.

---

## Environment setup

Reuse the same core environment patterns already used by browser E2E wherever possible.

### Required setup
- repository checkout
- Node install
- dependency install
- Playwright browser install
- Prisma db push
- deterministic seed data

### Required env consistency
Perf runs must use the same canonical data shape every time:
- same seeded professional
- same offering shape
- same add-on shape
- same availability window assumptions

---

## Execution plan in CI

### Desktop run
Run perf collection for the desktop project and write:
- `artifacts/perf/availability/raw-desktop.json`

### Mobile run
Run perf collection for the mobile project and write:
- `artifacts/perf/availability/raw-mobile.json`

### Aggregation
Run:
- `scripts/perf/aggregateAvailabilityPerf.mjs`

Outputs:
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

### Budget check
Run:
- `scripts/perf/checkAvailabilityBudgets.mjs`

This is the step that must fail the workflow if Gate 2 fails.

---

## Artifact upload list

CI must always upload these artifacts, even on failure:

### Required uploads
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

### Optional uploads
- Playwright traces for perf failures
- test-results directory for debugging
- checker log output if separated into a file

### Retention
Recommended:
- short retention for PR artifacts
- longer retention for main/nightly artifacts

Example:
- PR artifacts: 14 days
- main/nightly artifacts: 30 to 90 days

---

## Baseline handling

### Baseline file
- `docs/performance/baselines/availability-gate2-baseline.json`

### Initial baseline process
1. first approved clean run on main produces summary
2. that summary is reviewed
3. approved values are copied into baseline file
4. baseline file is committed

### Baseline update rule
Do not update the baseline automatically on every run.

Update it only when:
- the availability architecture meaningfully changes, or
- budgets are intentionally revised, or
- a reviewed performance improvement becomes the new expected level

This avoids the classic “baseline drift until the file is meaningless” problem.

---

## Evidence doc plan

### Evidence file
- `docs/performance/availability-gate2-evidence.md`

### Purpose
This is the human audit artifact.
It should summarize the most recent approved Gate 2 evidence in one place.

### Required sections
1. title and gate name
2. commit SHA
3. run date
4. environments tested
5. sample counts
6. desktop results table
7. mobile results table
8. invalid sample summary
9. budget verdict
10. baseline comparison summary
11. artifact paths

### Example verdict block
- `Result: PASS`
- `Result: FAIL`
- `Result: PASS WITH WARNINGS`

### Important rule
This doc should summarize evidence.
It should not replace the raw or summary JSON artifacts.

---

## CI summary output

The workflow should emit a concise summary to CI logs and, if supported, the platform summary UI.

### Recommended summary sections
- Gate 2 verdict
- failed metrics, if any
- warnings, if any
- artifact names/paths

### Example top line
- `Gate 2 availability performance: PASS`
- `Gate 2 availability performance: FAIL`

### Example warning lines
- `WARN: mobile background_refresh_ms sample_count=24 required=30`
- `WARN: desktop hold_request_latency_ms p95 regressed 18% vs baseline`

---

## Failure policy

### Workflow should FAIL when
- required raw artifact is missing
- aggregation fails
- summary artifact is missing
- required metric is missing
- sample count is below gating minimum
- any required p95 exceeds budget
- any required p99 exceeds budget

### Workflow may PASS WITH WARNINGS when
- p50 exceeds budget but p95/p99 pass
- baseline regression exceeds warning threshold
- invalid sample count is elevated but still within acceptable review range

Recommended v1 behavior:
- hard fail only on budget/missing-data/sample-count conditions
- warnings stay non-blocking

---

## Suggested job skeleton

High-level pseudo-flow:

```yaml
name: perf-availability

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  availability-performance:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup node
      - install deps
      - install playwright
      - prisma db push
      - seed canonical data
      - run desktop perf
      - run mobile perf
      - aggregate perf
      - check budgets
      - upload artifacts
      - publish summary
```

This is enough to define structure without pretending the exact workflow YAML is already written.

---

## What Step 6 completes

Step 6 is complete once we have defined:
- workflow file name
- trigger strategy
- job phases
- artifact upload list
- baseline handling rules
- evidence doc layout
- fail policy
- CI summary expectations

---

## Next exact step

Step 7 is the final Gate 2 implementation checklist.
That checklist should convert all planning docs into a practical build order:
1. docs
2. instrumentation
3. perf tests
4. aggregation
5. CI
6. baseline
7. evidence
