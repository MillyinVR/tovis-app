# Gate 2 Availability Performance Summary

Generated at: 2026-04-05T02:15:23.466Z
Budget source: docs/performance/availability-gate2-budget.json

## Desktop

Device profile: chromium

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 6593.799999982119 | 6593.8 | 6593.799999982119 | 6593.799999982119 | 6593.799999982119 | 6593.799999982119 |
| day switch to times visible | 1 | 0 | 2.2000000178813934 | 2.2 | 2.2000000178813934 | 2.2000000178813934 | 2.2000000178813934 | 2.2000000178813934 |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 1 | 0 | 1.4000000059604645 | 1.4 | 1.4000000059604645 | 1.4000000059604645 | 1.4000000059604645 | 1.4000000059604645 |

Total raw samples: 5
Invalid samples: 2

Invalid reasons:
- hold_request_status_409: 2

## Mobile

Device profile: mobile-chrome

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 7138.799999982119 | 7138.8 | 7138.799999982119 | 7138.799999982119 | 7138.799999982119 | 7138.799999982119 |
| day switch to times visible | 1 | 0 | 2.5999999940395355 | 2.6 | 2.5999999940395355 | 2.5999999940395355 | 2.5999999940395355 | 2.5999999940395355 |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 1 | 0 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 |

Total raw samples: 5
Invalid samples: 2

Invalid reasons:
- hold_not_created: 1
- hold_request_status_409: 1

## Artifact paths

- artifacts/perf/availability/raw-desktop.json
- artifacts/perf/availability/raw-mobile.json
- artifacts/perf/availability/summary.json
- artifacts/perf/availability/summary.md

## Budget check

Result: FAIL

Failures:
- [FAIL] desktop drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] desktop drawer_open_to_first_usable_ms p95=6593.799999982119 budget=1500
- [FAIL] desktop drawer_open_to_first_usable_ms p99=6593.799999982119 budget=2500
- [FAIL] desktop day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] desktop hold_request_latency_ms sample_count=0 required=30
- [FAIL] desktop hold_request_latency_ms p95 missing
- [FAIL] desktop hold_request_latency_ms p99 missing
- [FAIL] desktop continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] desktop continue_to_add_ons_ms p95 missing
- [FAIL] desktop continue_to_add_ons_ms p99 missing
- [FAIL] desktop background_refresh_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms p95=7138.799999982119 budget=1500
- [FAIL] mobile drawer_open_to_first_usable_ms p99=7138.799999982119 budget=2500
- [FAIL] mobile day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] mobile hold_request_latency_ms sample_count=0 required=30
- [FAIL] mobile hold_request_latency_ms p95 missing
- [FAIL] mobile hold_request_latency_ms p99 missing
- [FAIL] mobile continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] mobile continue_to_add_ons_ms p95 missing
- [FAIL] mobile continue_to_add_ons_ms p99 missing
- [FAIL] mobile background_refresh_ms sample_count=1 required=30

Warnings:
- [WARN] desktop drawer_open_to_first_usable_ms p50=6593.799999982119 budget=700
- [WARN] desktop hold_request_latency_ms invalid_count=1
- [WARN] desktop continue_to_add_ons_ms invalid_count=1
- [WARN] mobile drawer_open_to_first_usable_ms p50=7138.799999982119 budget=700
- [WARN] mobile hold_request_latency_ms invalid_count=1
- [WARN] mobile continue_to_add_ons_ms invalid_count=1

Passes:
- [PASS] desktop day_switch_to_times_visible_ms p95=2.2000000178813934 budget=900
- [PASS] desktop day_switch_to_times_visible_ms p99=2.2000000178813934 budget=1500
- [PASS] desktop background_refresh_ms p95=1.4000000059604645 budget=1800
- [PASS] desktop background_refresh_ms p99=1.4000000059604645 budget=3000
- [PASS] mobile day_switch_to_times_visible_ms p95=2.5999999940395355 budget=900
- [PASS] mobile day_switch_to_times_visible_ms p99=2.5999999940395355 budget=1500
- [PASS] mobile background_refresh_ms p95=1.5 budget=1800
- [PASS] mobile background_refresh_ms p99=1.5 budget=3000

