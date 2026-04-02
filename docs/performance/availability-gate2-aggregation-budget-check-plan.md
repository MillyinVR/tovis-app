# Gate 2 — Availability Aggregation and Budget-Check Plan

Status: DRAFT  
Scope: Availability flow only

This file defines how raw Gate 2 performance samples are aggregated, compared against budgets, and turned into CI pass/fail results.

---

## Goal

Convert raw perf artifacts into:

1. percentile summaries
2. machine-readable budget results
3. human-readable evidence
4. CI pass/fail status
5. regression comparison against baseline

This step is what turns “we measured some numbers” into “Gate 2 can actually block regressions.”

---

## File placement

### Scripts
- `scripts/perf/aggregateAvailabilityPerf.mjs`
- `scripts/perf/checkAvailabilityBudgets.mjs`

### Inputs
- `artifacts/perf/availability/raw-desktop.json`
- `artifacts/perf/availability/raw-mobile.json`
- `docs/performance/availability-gate2-budget.json`

### Outputs
- `artifacts/perf/availability/summary.json`
- `artifacts/perf/availability/summary.md`

### Optional baseline input
- `docs/performance/baselines/availability-gate2-baseline.json`

---

## Input contract

### Raw input sources
The aggregator reads:
- desktop raw artifact
- mobile raw artifact

### Required raw sample fields
Each sample must include:
- `scenario`
- `metric`
- `durationMs`
- `meta`

### Optional raw sample fields
- `statusCode`
- `serverTiming`
- `invalid`
- `invalidReason`

### Rule
Only valid samples count toward percentile calculations.

Invalid samples must still be reported separately.

---

## Metrics covered

The aggregator must only summarize these Gate 2 metrics:

- `drawer_open_to_first_usable_ms`
- `day_switch_to_times_visible_ms`
- `hold_request_latency_ms`
- `continue_to_add_ons_ms`
- `background_refresh_ms`

Any other metric found in raw artifacts should be ignored unless explicitly added to the budget file later.

---

## Aggregation rules

## 1. Split by environment
Summaries must be produced separately for:
- desktop
- mobile

Do not merge environments into one percentile bucket.

## 2. Split by metric
Each required metric gets its own summary row.

## 3. Percentiles to compute
For each metric/environment pair compute:
- count
- min
- max
- mean
- p50
- p95
- p99

## 4. Sample sorting rule
Sort durations ascending before percentile selection.

## 5. Percentile selection rule
Use nearest-rank percentile unless you later standardize on another method.

Recommended:
- p50 = nearest-rank 50th percentile
- p95 = nearest-rank 95th percentile
- p99 = nearest-rank 99th percentile

### Why nearest-rank
It is simple, predictable, and easy to explain in CI output.

---

## Invalid sample reporting

Invalid samples must be counted and surfaced.

### Per environment include:
- total raw samples
- valid sample count
- invalid sample count
- invalid reasons breakdown

### Example invalid reasons
- `drawer_closed_before_usable`
- `day_switch_superseded`
- `hold_request_superseded`
- `add_ons_navigation_failed`
- `missing_perf_metric`
- `stale_cache_setup_failed`

### Rule
Invalid samples do not enter percentile math, but too many invalid samples should trigger warnings.

---

## Summary JSON shape

Recommended output shape:

```json
{
  "gate": 2,
  "suite": "availability",
  "generatedAt": "2026-04-01T00:00:00.000Z",
  "budgetSource": "docs/performance/availability-gate2-budget.json",
  "environments": {
    "desktop": {
      "deviceProfile": "Desktop Chrome",
      "metrics": {
        "drawer_open_to_first_usable_ms": {
          "count": 30,
          "invalidCount": 0,
          "min": 540,
          "max": 910,
          "mean": 661.4,
          "p50": 640,
          "p95": 840,
          "p99": 910
        }
      }
    },
    "mobile": {
      "deviceProfile": "Pixel 7 emulation",
      "metrics": {}
    }
  },
  "budgetCheck": {
    "passed": true
  }
}
```

### Required per-metric summary fields
- `count`
- `invalidCount`
- `min`
- `max`
- `mean`
- `p50`
- `p95`
- `p99`

---

## Summary Markdown shape

The markdown summary should be human-readable.

Recommended sections:
1. header
2. commit/date/environment context
3. desktop metric table
4. mobile metric table
5. invalid sample summary
6. budget result summary
7. baseline comparison summary if baseline exists

### Example verdict language
- `PASS: all required metrics met budget`
- `FAIL: one or more required metrics exceeded budget`
- `WARN: sample count below required minimum`
- `WARN: regression vs baseline exceeds warning threshold`

---

## Budget comparison rules

The checker reads:
- `summary.json`
- `availability-gate2-budget.json`

### For each required metric and environment:
compare:
- measured p50 vs budget p50
- measured p95 vs budget p95
- measured p99 vs budget p99

### Hard fail rule
Fail if any required metric in any required environment exceeds:
- p95 budget, or
- p99 budget

### Soft warning rule
Warn if:
- p50 exceeds budget while p95/p99 still pass
- valid sample count is below required minimum
- invalid sample rate is unusually high

### Required minimum sample count
Use the budget file sample count requirement:
- PR gating minimum = 30 valid samples per metric per environment

If below minimum:
- budget check should fail for gating runs
or at minimum produce a loud warning if you intentionally want a transitional rollout

Recommended Gate 2 rule:
- below minimum sample count = FAIL

---

## Baseline comparison rules

If baseline file exists, compare current summary against baseline.

### Baseline compare target
Compare p95 primarily.
Optionally compare p50 and p99 too.

### Warning threshold
Warn when:
- p95 regresses by more than 15% vs baseline

### Hard fail?
Not required for first implementation.

Recommended initial behavior:
- absolute budgets = hard fail
- baseline regression = warning only

This keeps Gate 2 understandable and avoids CI drama on day one.

---

## Missing-data rules

### If a required artifact is missing
- hard fail

### If a required metric is missing from an environment
- hard fail

### If the summary has zero valid samples for a required metric
- hard fail

### If raw artifact JSON is malformed
- hard fail

---

## CI output format

The checker should print concise, stable lines that are easy to scan in CI logs.

Recommended format:

```txt
[PASS] desktop drawer_open_to_first_usable_ms p95=840 budget=1500
[PASS] desktop drawer_open_to_first_usable_ms p99=910 budget=2500
[FAIL] mobile hold_request_latency_ms p95=920 budget=800
[WARN] desktop continue_to_add_ons_ms sample_count=24 required=30
```

At the end print a single summary line:

```txt
Gate 2 availability performance: FAIL
```

or

```txt
Gate 2 availability performance: PASS
```

---

## Exit code rules

### Aggregator
- exit nonzero only for fatal read/parse problems

### Budget checker
- exit code 0 when Gate 2 budget check passes
- exit code 1 when Gate 2 budget check fails

This keeps the pipeline clean:
- aggregate first
- check second
- CI blocks on checker

---

## Step 5 completion criteria

Step 5 is complete once we have defined:
- script file names
- required inputs
- required outputs
- percentile math
- budget comparison logic
- missing-data fail rules
- CI log format
- exit code behavior

---

## Next exact step

Step 6 is the CI and evidence plan:
- workflow file name
- job structure
- artifact upload list
- baseline handling
- final evidence doc layout
