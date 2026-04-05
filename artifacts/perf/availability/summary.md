# Gate 2 Availability Performance Summary

Generated at: 2026-04-05T08:04:50.770Z
Budget source: docs/performance/availability-gate2-budget.json

## Desktop

Device profile: chromium

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 8189.299999982119 | 8189.3 | 8189.299999982119 | 8189.299999982119 | 8189.299999982119 | 8189.299999982119 |
| day switch to times visible | 1 | 0 | 6985.9000000059605 | 6985.9 | 6985.9000000059605 | 6985.9000000059605 | 6985.9000000059605 | 6985.9000000059605 |
| hold request latency | 1 | 0 | 3014.2000000178814 | 3014.2 | 3014.2000000178814 | 3014.2000000178814 | 3014.2000000178814 | 3014.2000000178814 |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 1 | 0 | 5.4000000059604645 | 5.4 | 5.4000000059604645 | 5.4000000059604645 | 5.4000000059604645 | 5.4000000059604645 |

Total raw samples: 5
Invalid samples: 1

Invalid reasons:
- [2mexpect([22m[31mreceived[39m[2m).[22mtoBeGreaterThan[2m([22m[32mexpected[39m[2m)[22m

Expected: > [32m0[39m
Received:   [31m0[39m

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate: 1

## Mobile

Device profile: mobile-chrome

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 8654.40000000596 | 8654.4 | 8654.40000000596 | 8654.40000000596 | 8654.40000000596 | 8654.40000000596 |
| day switch to times visible | 1 | 0 | 9480.800000011921 | 9480.8 | 9480.800000011921 | 9480.800000011921 | 9480.800000011921 | 9480.800000011921 |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 1 | 0 | 3 | 3 | 3 | 3 | 3 | 3 |

Total raw samples: 5
Invalid samples: 2

Invalid reasons:
- hold_request_status_409: 1
- no_enabled_slots_on_candidate_day: 1

## Artifact paths

- artifacts/perf/availability/raw-desktop.json
- artifacts/perf/availability/raw-mobile.json
- artifacts/perf/availability/summary.json
- artifacts/perf/availability/summary.md

## Budget check

Result: FAIL

Failures:
- [FAIL] desktop drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] desktop drawer_open_to_first_usable_ms p95=8189.299999982119 budget=1500
- [FAIL] desktop drawer_open_to_first_usable_ms p99=8189.299999982119 budget=2500
- [FAIL] desktop day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] desktop day_switch_to_times_visible_ms p95=6985.9000000059605 budget=900
- [FAIL] desktop day_switch_to_times_visible_ms p99=6985.9000000059605 budget=1500
- [FAIL] desktop hold_request_latency_ms sample_count=1 required=30
- [FAIL] desktop hold_request_latency_ms p95=3014.2000000178814 budget=800
- [FAIL] desktop hold_request_latency_ms p99=3014.2000000178814 budget=1500
- [FAIL] desktop continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] desktop continue_to_add_ons_ms p95 missing
- [FAIL] desktop continue_to_add_ons_ms p99 missing
- [FAIL] desktop background_refresh_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms p95=8654.40000000596 budget=1500
- [FAIL] mobile drawer_open_to_first_usable_ms p99=8654.40000000596 budget=2500
- [FAIL] mobile day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] mobile day_switch_to_times_visible_ms p95=9480.800000011921 budget=900
- [FAIL] mobile day_switch_to_times_visible_ms p99=9480.800000011921 budget=1500
- [FAIL] mobile hold_request_latency_ms sample_count=0 required=30
- [FAIL] mobile hold_request_latency_ms p95 missing
- [FAIL] mobile hold_request_latency_ms p99 missing
- [FAIL] mobile continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] mobile continue_to_add_ons_ms p95 missing
- [FAIL] mobile continue_to_add_ons_ms p99 missing
- [FAIL] mobile background_refresh_ms sample_count=1 required=30

Warnings:
- [WARN] desktop drawer_open_to_first_usable_ms p50=8189.299999982119 budget=700
- [WARN] desktop day_switch_to_times_visible_ms p50=6985.9000000059605 budget=400
- [WARN] desktop hold_request_latency_ms p50=3014.2000000178814 budget=300
- [WARN] desktop continue_to_add_ons_ms invalid_count=1
- [WARN] mobile drawer_open_to_first_usable_ms p50=8654.40000000596 budget=700
- [WARN] mobile day_switch_to_times_visible_ms p50=9480.800000011921 budget=400
- [WARN] mobile hold_request_latency_ms invalid_count=1
- [WARN] mobile continue_to_add_ons_ms invalid_count=1

Passes:
- [PASS] desktop background_refresh_ms p95=5.4000000059604645 budget=1800
- [PASS] desktop background_refresh_ms p99=5.4000000059604645 budget=3000
- [PASS] mobile background_refresh_ms p95=3 budget=1800
- [PASS] mobile background_refresh_ms p99=3 budget=3000

