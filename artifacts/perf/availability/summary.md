# Gate 2 Availability Performance Summary

Generated at: 2026-04-02T19:57:10.172Z
Budget source: docs/performance/availability-gate2-budget.json

## Desktop

Device profile: chromium

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 2 | 0 | 6763.899999991059 | 7380.95 | 6763.899999991059 | 7998 | 7998 | 7998 |
| day switch to times visible | 2 | 0 | 12.299999997019768 | 12.5 | 12.299999997019768 | 12.700000002980232 | 12.700000002980232 | 12.700000002980232 |
| hold request latency | 2 | 0 | 8326.09999999404 | 8368.35 | 8326.09999999404 | 8410.59999999404 | 8410.59999999404 | 8410.59999999404 |
| continue to add ons | 0 | 2 | — | — | — | — | — | — |
| background refresh | 0 | 2 | — | — | — | — | — | — |

Total raw samples: 10
Invalid samples: 4

Invalid reasons:
- background_refresh_setup_missing: 2
- Could not find enabled drawer continue button. Set PERF_DRAWER_CONTINUE_SELECTOR if needed.: 2

## Mobile

Device profile: mobile-chrome

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 2 | 0 | 7521.70000000298 | 7563.3 | 7521.70000000298 | 7604.9000000059605 | 7604.9000000059605 | 7604.9000000059605 |
| day switch to times visible | 2 | 0 | 15 | 15.55 | 15 | 16.099999994039536 | 16.099999994039536 | 16.099999994039536 |
| hold request latency | 2 | 0 | 5895.899999991059 | 9330.25 | 5895.899999991059 | 12764.60000000894 | 12764.60000000894 | 12764.60000000894 |
| continue to add ons | 0 | 2 | — | — | — | — | — | — |
| background refresh | 0 | 2 | — | — | — | — | — | — |

Total raw samples: 10
Invalid samples: 4

Invalid reasons:
- background_refresh_setup_missing: 2
- Could not find enabled drawer continue button. Set PERF_DRAWER_CONTINUE_SELECTOR if needed.: 2

## Artifact paths

- artifacts/perf/availability/raw-desktop.json
- artifacts/perf/availability/raw-mobile.json
- artifacts/perf/availability/summary.json
- artifacts/perf/availability/summary.md

## Budget check

Result: FAIL

Failures:
- [FAIL] desktop drawer_open_to_first_usable_ms sample_count=2 required=30
- [FAIL] desktop drawer_open_to_first_usable_ms p95=7998 budget=1500
- [FAIL] desktop drawer_open_to_first_usable_ms p99=7998 budget=2500
- [FAIL] desktop day_switch_to_times_visible_ms sample_count=2 required=30
- [FAIL] desktop hold_request_latency_ms sample_count=2 required=30
- [FAIL] desktop hold_request_latency_ms p95=8410.59999999404 budget=800
- [FAIL] desktop hold_request_latency_ms p99=8410.59999999404 budget=1500
- [FAIL] desktop continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] desktop continue_to_add_ons_ms p95 missing
- [FAIL] desktop continue_to_add_ons_ms p99 missing
- [FAIL] desktop background_refresh_ms sample_count=0 required=30
- [FAIL] desktop background_refresh_ms p95 missing
- [FAIL] desktop background_refresh_ms p99 missing
- [FAIL] mobile drawer_open_to_first_usable_ms sample_count=2 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms p95=7604.9000000059605 budget=1500
- [FAIL] mobile drawer_open_to_first_usable_ms p99=7604.9000000059605 budget=2500
- [FAIL] mobile day_switch_to_times_visible_ms sample_count=2 required=30
- [FAIL] mobile hold_request_latency_ms sample_count=2 required=30
- [FAIL] mobile hold_request_latency_ms p95=12764.60000000894 budget=800
- [FAIL] mobile hold_request_latency_ms p99=12764.60000000894 budget=1500
- [FAIL] mobile continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] mobile continue_to_add_ons_ms p95 missing
- [FAIL] mobile continue_to_add_ons_ms p99 missing
- [FAIL] mobile background_refresh_ms sample_count=0 required=30
- [FAIL] mobile background_refresh_ms p95 missing
- [FAIL] mobile background_refresh_ms p99 missing

Warnings:
- [WARN] desktop drawer_open_to_first_usable_ms p50=6763.899999991059 budget=700
- [WARN] desktop hold_request_latency_ms p50=8326.09999999404 budget=300
- [WARN] desktop continue_to_add_ons_ms invalid_count=2
- [WARN] desktop background_refresh_ms invalid_count=2
- [WARN] mobile drawer_open_to_first_usable_ms p50=7521.70000000298 budget=700
- [WARN] mobile hold_request_latency_ms p50=5895.899999991059 budget=300
- [WARN] mobile continue_to_add_ons_ms invalid_count=2
- [WARN] mobile background_refresh_ms invalid_count=2

Passes:
- [PASS] desktop day_switch_to_times_visible_ms p95=12.700000002980232 budget=900
- [PASS] desktop day_switch_to_times_visible_ms p99=12.700000002980232 budget=1500
- [PASS] mobile day_switch_to_times_visible_ms p95=16.099999994039536 budget=900
- [PASS] mobile day_switch_to_times_visible_ms p99=16.099999994039536 budget=1500

