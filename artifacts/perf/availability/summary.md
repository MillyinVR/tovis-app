# Gate 2 Availability Performance Summary

Generated at: 2026-04-05T06:32:00.138Z
Budget source: docs/performance/availability-gate2-budget.json

## Desktop

Device profile: chromium

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 0 | 1 | — | — | — | — | — | — |
| day switch to times visible | 0 | 1 | — | — | — | — | — | — |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 0 | 1 | — | — | — | — | — | — |

Total raw samples: 5
Invalid samples: 5

Invalid reasons:
- Could not find booking trigger. Set PERF_BOOKING_TRIGGER_SELECTOR for this page.: 5

## Mobile

Device profile: mobile-chrome

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 0 | 1 | — | — | — | — | — | — |
| day switch to times visible | 0 | 1 | — | — | — | — | — | — |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 0 | 1 | — | — | — | — | — | — |
| background refresh | 0 | 1 | — | — | — | — | — | — |

Total raw samples: 5
Invalid samples: 5

Invalid reasons:
- Could not find booking trigger. Set PERF_BOOKING_TRIGGER_SELECTOR for this page.: 5

## Artifact paths

- artifacts/perf/availability/raw-desktop.json
- artifacts/perf/availability/raw-mobile.json
- artifacts/perf/availability/summary.json
- artifacts/perf/availability/summary.md

## Budget check

Result: FAIL

Failures:
- [FAIL] desktop drawer_open_to_first_usable_ms sample_count=0 required=30
- [FAIL] desktop drawer_open_to_first_usable_ms p95 missing
- [FAIL] desktop drawer_open_to_first_usable_ms p99 missing
- [FAIL] desktop day_switch_to_times_visible_ms sample_count=0 required=30
- [FAIL] desktop day_switch_to_times_visible_ms p95 missing
- [FAIL] desktop day_switch_to_times_visible_ms p99 missing
- [FAIL] desktop hold_request_latency_ms sample_count=0 required=30
- [FAIL] desktop hold_request_latency_ms p95 missing
- [FAIL] desktop hold_request_latency_ms p99 missing
- [FAIL] desktop continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] desktop continue_to_add_ons_ms p95 missing
- [FAIL] desktop continue_to_add_ons_ms p99 missing
- [FAIL] desktop background_refresh_ms sample_count=0 required=30
- [FAIL] desktop background_refresh_ms p95 missing
- [FAIL] desktop background_refresh_ms p99 missing
- [FAIL] mobile drawer_open_to_first_usable_ms sample_count=0 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms p95 missing
- [FAIL] mobile drawer_open_to_first_usable_ms p99 missing
- [FAIL] mobile day_switch_to_times_visible_ms sample_count=0 required=30
- [FAIL] mobile day_switch_to_times_visible_ms p95 missing
- [FAIL] mobile day_switch_to_times_visible_ms p99 missing
- [FAIL] mobile hold_request_latency_ms sample_count=0 required=30
- [FAIL] mobile hold_request_latency_ms p95 missing
- [FAIL] mobile hold_request_latency_ms p99 missing
- [FAIL] mobile continue_to_add_ons_ms sample_count=0 required=30
- [FAIL] mobile continue_to_add_ons_ms p95 missing
- [FAIL] mobile continue_to_add_ons_ms p99 missing
- [FAIL] mobile background_refresh_ms sample_count=0 required=30
- [FAIL] mobile background_refresh_ms p95 missing
- [FAIL] mobile background_refresh_ms p99 missing

Warnings:
- [WARN] desktop drawer_open_to_first_usable_ms invalid_count=1
- [WARN] desktop day_switch_to_times_visible_ms invalid_count=1
- [WARN] desktop hold_request_latency_ms invalid_count=1
- [WARN] desktop continue_to_add_ons_ms invalid_count=1
- [WARN] desktop background_refresh_ms invalid_count=1
- [WARN] mobile drawer_open_to_first_usable_ms invalid_count=1
- [WARN] mobile day_switch_to_times_visible_ms invalid_count=1
- [WARN] mobile hold_request_latency_ms invalid_count=1
- [WARN] mobile continue_to_add_ons_ms invalid_count=1
- [WARN] mobile background_refresh_ms invalid_count=1

