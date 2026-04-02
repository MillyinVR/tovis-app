# Gate 2 — Availability Perf Collection Plan

Status: DRAFT  
Scope: Availability flow only

This file defines how Gate 2 performance evidence will be collected once instrumentation exists.

---

## Goal

Produce repeatable, machine-readable evidence for the five required Gate 2 metrics:

1. `drawer_open_to_first_usable_ms`
2. `day_switch_to_times_visible_ms`
3. `hold_request_latency_ms`
4. `continue_to_add_ons_ms`
5. `background_refresh_ms`

This evidence must be usable for:
- PR gating
- percentile aggregation
- CI artifact retention
- regression comparison against a baseline

---

## File placement

### Perf test files
- `tests/perf/availability.perf.spec.ts`
- `tests/perf/utils/readAvailabilityPerf.ts`
- `tests/perf/utils/perfRunner.ts`

### Optional shared helpers
- `tests/perf/fixtures/perfSeedBookingFlow.ts`

### Raw output artifacts
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`

### Aggregated outputs consumed later
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

---

## Test environments

### Required environments
- desktop CI run
- mobile CI run

### Required browser/device profiles
- Desktop Chrome
- Pixel 7 emulation

These match the current Playwright project setup already used for browser tests.

---

## Scenario matrix

## Scenario 1: drawer open to first usable state

### Purpose
Collect `drawer_open_to_first_usable_ms`

### Flow
1. seed canonical professional + offering + availability
2. navigate to the professional services page
3. click the booking CTA
4. wait for the drawer usable stop condition
5. read the perf store
6. collect the completed metric entry

### Notes
- run as a cold scenario
- clear relevant client availability cache before each sample

---

## Scenario 2: day switch to times visible

### Purpose
Collect `day_switch_to_times_visible_ms`

### Flow
1. open the drawer
2. wait until drawer is usable
3. select a different day in the day scroller
4. wait until selected-day slots are interactive
5. read the perf store
6. collect the completed metric entry

### Notes
- use a day that is guaranteed to differ from the initial selected day
- avoid sampling on an empty day unless empty-day behavior becomes its own explicit metric

---

## Scenario 3: hold request latency

### Purpose
Collect `hold_request_latency_ms`

### Flow
1. open drawer
2. wait until usable
3. pick a valid slot
4. wait for POST `/api/holds` response
5. read the perf store
6. capture response status and, if available, `Server-Timing`

### Notes
- record successful and failed durations separately if desired
- Gate 2 evidence should at minimum include the successful path

---

## Scenario 4: continue to add-ons

### Purpose
Collect `continue_to_add_ons_ms`

### Flow
1. open drawer
2. wait until usable
3. create a successful hold
4. click Continue / Continue to add-ons
5. wait for add-ons page primary ready seam
6. read the perf store

### Preferred page-ready stop
- `booking-add-ons-continue-button` visible

### Fallback page-ready stops
- `booking-add-ons-list` visible
- `Add-ons` heading visible

---

## Scenario 5: background refresh

### Purpose
Collect `background_refresh_ms`

### Flow
1. preload stale but visible cached availability data
2. open drawer with stale visible data
3. trigger the background refresh path
4. wait for refresh completion
5. read the perf store

### Notes
- this is not a blocking initial load sample
- stale-data setup must be deterministic
- keep the stale cache setup explicit and documented

---

## Sample counts

### PR gating minimum
- 30 samples per metric per environment

### Preferred nightly count
- 100 samples per metric per environment

### Why
- p50 and p95 become useful at 30 samples
- p99 becomes more meaningful with larger sample counts

---

## Execution structure

## Option A: one spec file with labeled test groups
Recommended initial shape:

- `tests/perf/availability.perf.spec.ts`

Inside it, define:
- desktop metric runs
- mobile metric runs
- repeated scenario loops
- artifact flush at the end of each environment run

## Option B: split by metric
Only do this if the single spec becomes too noisy.

Example:
- `tests/perf/availability.drawer.perf.spec.ts`
- `tests/perf/availability.hold.perf.spec.ts`

Recommended starting point:
- one spec file

---

## Raw artifact format

Each raw artifact should be valid JSON.

### Recommended top-level shape
```json
{
  "gate": 2,
  "suite": "availability",
  "environment": "desktop",
  "deviceProfile": "Desktop Chrome",
  "commitSha": "UNKNOWN_IN_LOCAL_RUN",
  "collectedAt": "2026-04-01T00:00:00.000Z",
  "samples": [
    {
      "scenario": "drawer-open",
      "metric": "drawer_open_to_first_usable_ms",
      "durationMs": 612,
      "meta": {
        "locationType": "SALON",
        "bookingSource": "REQUESTED"
      }
    }
  ]
}
```

### Required per-sample fields
- `scenario`
- `metric`
- `durationMs`
- `meta`

### Optional per-sample fields
- `statusCode`
- `serverTiming`
- `selectedDayYMD`
- `slotISO`
- `locationType`
- `bookingSource`

---

## Scenario naming rules

Recommended scenario labels:
- `drawer-open`
- `day-switch`
- `hold-request`
- `continue-to-add-ons`
- `background-refresh`

Keep them stable so summary scripts stay simple.

---

## Perf store read contract

Playwright should read:
```ts
await page.evaluate(() => window.__tovisAvailabilityPerf)
```

The reader helper should:
1. pull all completed entries
2. filter by metric name
3. optionally filter by scenario/meta
4. return normalized samples for artifact writing

---

## Cache handling rules

### Cold runs
Before each cold sample:
- clear relevant in-memory availability cache
- clear relevant day-slot cache
- make sure the run is not reusing prior perf entries

### Warm/background runs
Before each warm sample:
- intentionally seed stale cache state
- verify visible data exists before refresh begins

### Important rule
Do not mix cold and warm samples in the same scenario bucket.

---

## Data determinism rules

Every perf run should use:
- the same canonical seeded service shape
- the same canonical offering shape
- the same canonical add-on availability
- predictable days and slot counts

If the data shape changes, record a new baseline after approval.

---

## Failure handling rules

### If a sample fails to produce the metric
- mark the sample as invalid
- record the reason
- do not silently drop it

### Invalid sample examples
- drawer closed before usable
- hold request superseded
- selected day changed again before stop
- add-ons navigation failed
- perf store missing expected metric

### Important rule
Invalid samples should be visible in raw output, not hidden.

---

## What Step 4 completes

Once this plan is accepted, Step 4 is complete because we will have:
- exact perf test file names
- exact scenario list
- exact sample counts
- exact raw artifact shape
- exact environment split
- exact rules for cold vs warm collection

---

## Next exact step

Step 5 is the aggregation and budget-check plan:
- summary JSON shape
- percentile calculation rules
- budget comparison rules
- CI pass/fail output format
