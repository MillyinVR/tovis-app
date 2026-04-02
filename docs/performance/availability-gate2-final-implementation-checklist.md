# Gate 2 — Availability Final Implementation Checklist

Status: DRAFT  
Scope: Availability flow only

This checklist converts the Gate 2 planning docs into the practical implementation order required to make Gate 2 pass.

---

## Goal

Complete Gate 2 in the safest order:

1. establish source-of-truth docs
2. add instrumentation
3. collect repeatable perf data
4. aggregate results
5. enforce budgets in CI
6. preserve baseline and evidence
7. re-audit Gate 2 against the pass criteria

---

## Gate 2 pass criteria recap

Gate 2 passes only when all of the following are true:

- written budgets exist for all five required metrics
- p50, p95, and p99 targets are defined
- measured evidence exists, not just intent
- test conditions are documented
- regressions are detectable over time in CI

---

## Implementation order

## Phase 1 — Source-of-truth docs

### 1. Add the budget document
Target path:
- `docs/performance/availability-gate2-budget.md`

Status:
- drafted

### 2. Add the machine-readable budget file
Target path:
- `docs/performance/availability-gate2-budget.json`

Status:
- drafted

### 3. Add the measurement contract
Target path:
- `docs/performance/availability-gate2-measurement-contract.md`

Status:
- drafted

### 4. Add the instrumentation plan
Target path:
- `docs/performance/availability-gate2-instrumentation-plan.md`

Status:
- drafted

### 5. Add the perf collection plan
Target path:
- `docs/performance/availability-gate2-perf-collection-plan.md`

Status:
- drafted

### 6. Add the aggregation and budget-check plan
Target path:
- `docs/performance/availability-gate2-aggregation-budget-check-plan.md`

Status:
- drafted

### 7. Add the CI and evidence plan
Target path:
- `docs/performance/availability-gate2-ci-evidence-plan.md`

Status:
- drafted

### Phase 1 exit condition
All Gate 2 docs exist in `docs/performance/` and agree on:
- metric names
- start/stop semantics
- environments
- sample counts
- fail rules

---

## Phase 2 — Client and server instrumentation

### 8. Create client perf types
Target path:
- `app/(main)/booking/AvailabilityDrawer/perf/availabilityPerfTypes.ts`

Required outcome:
- typed perf entry shape
- typed perf store shape
- typed metric name union for Gate 2 metrics

### 9. Create client perf helper
Target path:
- `app/(main)/booking/AvailabilityDrawer/perf/availabilityPerf.ts`

Required outcome:
- start metric
- end metric
- cancel metric
- read perf store
- safe window-backed storage for Playwright reads

### 10. Instrument drawer open to usable
Target file:
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`

Required outcome:
- start mark for drawer open
- stop mark for first usable state

### 11. Instrument day switch to visible times
Target file:
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`

Required outcome:
- start mark on day selection
- stop mark when selected-day slot chips are interactive

### 12. Instrument hold request latency
Target file:
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`

Required outcome:
- start mark immediately before POST `/api/holds`
- stop mark immediately after fetch resolves
- capture success/failure outcome in metadata

### 13. Instrument continue to add-ons
Target files:
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`
- `app/(main)/booking/add-ons/ui/AddOnsClient.tsx`

Required outcome:
- start mark at Continue click
- stop mark when add-ons page is actionable
- primary stop = `booking-add-ons-continue-button` visible

### 14. Instrument background refresh
Target file:
- `app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts`

Required outcome:
- start mark only for true background refresh paths
- stop mark when refreshed data is applied and refreshing clears

### 15. Add server timing for hold creation
Target file:
- `app/api/holds/route.ts`

Required outcome:
- route duration emitted in a machine-readable way
- preferably `Server-Timing`
- client-observed and server-observed timing can be compared later

### Phase 2 exit condition
All five Gate 2 metrics can be recorded from real app behavior without breaking the flow.

---

## Phase 3 — Perf collection tests

### 16. Create perf test spec
Target path:
- `tests/perf/availability.perf.spec.ts`

Required outcome:
- desktop and mobile perf runs
- repeated collection loops
- scenario labeling

### 17. Create perf reader helper
Target path:
- `tests/perf/utils/readAvailabilityPerf.ts`

Required outcome:
- read `window.__tovisAvailabilityPerf`
- normalize metric entries for artifact writing

### 18. Create perf runner helper
Target path:
- `tests/perf/utils/perfRunner.ts`

Required outcome:
- common collection loop
- scenario execution helpers
- invalid-sample handling

### 19. Add canonical scenario collection
Required scenarios:
- drawer-open
- day-switch
- hold-request
- continue-to-add-ons
- background-refresh

### 20. Write raw artifacts
Required output paths:
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`

### Phase 3 exit condition
Perf tests can produce raw JSON evidence for all five metrics in both required environments.

---

## Phase 4 — Aggregation and budget enforcement

### 21. Create aggregation script
Target path:
- `scripts/perf/aggregateAvailabilityPerf.mjs`

Required outcome:
- read raw desktop/mobile artifacts
- compute count/min/max/mean/p50/p95/p99
- exclude invalid samples from percentile math
- report invalid sample counts

### 22. Create budget-check script
Target path:
- `scripts/perf/checkAvailabilityBudgets.mjs`

Required outcome:
- compare summary against budget JSON
- fail on missing artifacts
- fail on missing metrics
- fail on low sample count
- fail on p95/p99 breaches
- emit stable CI-readable lines

### 23. Write summary outputs
Required output paths:
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

### Phase 4 exit condition
A perf run can be summarized and compared against Gate 2 budgets automatically.

---

## Phase 5 — CI workflow

### 24. Add perf workflow
Target path:
- `.github/workflows/perf-availability.yml`

Required outcome:
- checkout
- install
- browser setup
- db setup
- deterministic seed
- desktop perf run
- mobile perf run
- aggregation
- budget check
- artifact upload

### 25. Always upload artifacts
Required uploads:
- raw desktop
- raw mobile
- summary json
- summary markdown

### 26. Make the checker the blocking step
Required outcome:
- workflow fails only when the budget checker fails or required data is missing

### Phase 5 exit condition
Gate 2 becomes a real CI gate rather than a one-off manual exercise.

---

## Phase 6 — Baseline and evidence

### 27. Capture first approved baseline
Target path:
- `docs/performance/baselines/availability-gate2-baseline.json`

Required outcome:
- baseline derived from a reviewed clean main-branch run
- baseline committed intentionally, not auto-updated every run

### 28. Create evidence doc
Target path:
- `docs/performance/availability-gate2-evidence.md`

Required outcome:
- commit SHA
- run date
- environments
- sample counts
- result tables
- verdict
- baseline comparison summary
- artifact paths

### Phase 6 exit condition
A human reviewer can verify Gate 2 from a stable evidence artifact without reverse-engineering CI logs.

---

## Phase 7 — Re-audit readiness

### 29. Verify the five required metrics exist in evidence
Must be present:
- `drawer_open_to_first_usable_ms`
- `day_switch_to_times_visible_ms`
- `hold_request_latency_ms`
- `continue_to_add_ons_ms`
- `background_refresh_ms`

### 30. Verify p50/p95/p99 exist for both environments
Must exist for:
- desktop
- mobile

### 31. Verify test conditions are documented in the final evidence chain
Must include:
- environment
- device profile
- cache state
- sample count
- data determinism assumptions

### 32. Verify regression detection exists
Must exist via:
- CI budget enforcement
- baseline comparison or equivalent tracked history

### 33. Re-run Gate 2 audit
Expected verdict:
- PASS only if both written budgets and measured evidence exist

### Phase 7 exit condition
Gate 2 is ready for formal re-audit.

---

## Build order summary

Use this order exactly:

1. commit docs in `docs/performance`
2. add client perf helper/types
3. instrument availability drawer
4. instrument `useAvailability`
5. instrument hold route timing
6. instrument add-ons ready stop
7. add perf Playwright tests
8. add raw artifact writing
9. add aggregation script
10. add budget-check script
11. add CI workflow
12. capture first reviewed baseline
13. write evidence doc
14. re-audit Gate 2

Reason:
This keeps the work maintainable and prevents building CI around undefined metrics.

---

## Done definition

Gate 2 is truly done only when:
- docs are committed
- instrumentation is committed
- perf tests run in CI
- summary artifacts are generated
- budgets are enforced automatically
- baseline exists
- evidence doc exists
- re-audit result is PASS

---

## Final note

This checklist is the execution bridge between planning and implementation.
It should be used as the working order for the actual code changes needed to make Gate 2 pass.
