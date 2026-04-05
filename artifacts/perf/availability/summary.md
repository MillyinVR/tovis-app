# Gate 2 Availability Performance Summary

Generated at: 2026-04-05T00:19:36.198Z
Budget source: docs/performance/availability-gate2-budget.json

## Desktop

Device profile: chromium

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 7209.9000000059605 | 7209.9 | 7209.9000000059605 | 7209.9000000059605 | 7209.9000000059605 | 7209.9000000059605 |
| day switch to times visible | 1 | 0 | 2.2000000178813934 | 2.2 | 2.2000000178813934 | 2.2000000178813934 | 2.2000000178813934 | 2.2000000178813934 |
| hold request latency | 0 | 1 | — | — | — | — | — | — |
| continue to add ons | 1 | 0 | 5696.4000000059605 | 5696.4 | 5696.4000000059605 | 5696.4000000059605 | 5696.4000000059605 | 5696.4000000059605 |
| background refresh | 1 | 0 | 1.199999988079071 | 1.2 | 1.199999988079071 | 1.199999988079071 | 1.199999988079071 | 1.199999988079071 |

Total raw samples: 5
Invalid samples: 1

Invalid reasons:
- hold_not_created: 1

## Mobile

Device profile: mobile-chrome

| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| drawer open to first usable | 1 | 0 | 7388.5 | 7388.5 | 7388.5 | 7388.5 | 7388.5 | 7388.5 |
| day switch to times visible | 1 | 0 | 2.199999988079071 | 2.2 | 2.199999988079071 | 2.199999988079071 | 2.199999988079071 | 2.199999988079071 |
| hold request latency | 1 | 0 | 11706.799999982119 | 11706.8 | 11706.799999982119 | 11706.799999982119 | 11706.799999982119 | 11706.799999982119 |
| continue to add ons | 1 | 0 | 6141.800000011921 | 6141.8 | 6141.800000011921 | 6141.800000011921 | 6141.800000011921 | 6141.800000011921 |
| background refresh | 1 | 0 | 1.0999999940395355 | 1.1 | 1.0999999940395355 | 1.0999999940395355 | 1.0999999940395355 | 1.0999999940395355 |

Total raw samples: 5
Invalid samples: 0

Invalid reasons: none

## Artifact paths

- artifacts/perf/availability/raw-desktop.json
- artifacts/perf/availability/raw-mobile.json
- artifacts/perf/availability/summary.json
- artifacts/perf/availability/summary.md

## Budget check

Result: FAIL

Failures:
- [FAIL] desktop drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] desktop drawer_open_to_first_usable_ms p95=7209.9000000059605 budget=1500
- [FAIL] desktop drawer_open_to_first_usable_ms p99=7209.9000000059605 budget=2500
- [FAIL] desktop day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] desktop hold_request_latency_ms sample_count=0 required=30
- [FAIL] desktop hold_request_latency_ms p95 missing
- [FAIL] desktop hold_request_latency_ms p99 missing
- [FAIL] desktop continue_to_add_ons_ms sample_count=1 required=30
- [FAIL] desktop continue_to_add_ons_ms p95=5696.4000000059605 budget=1200
- [FAIL] desktop continue_to_add_ons_ms p99=5696.4000000059605 budget=2000
- [FAIL] desktop background_refresh_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms sample_count=1 required=30
- [FAIL] mobile drawer_open_to_first_usable_ms p95=7388.5 budget=1500
- [FAIL] mobile drawer_open_to_first_usable_ms p99=7388.5 budget=2500
- [FAIL] mobile day_switch_to_times_visible_ms sample_count=1 required=30
- [FAIL] mobile hold_request_latency_ms sample_count=1 required=30
- [FAIL] mobile hold_request_latency_ms p95=11706.799999982119 budget=800
- [FAIL] mobile hold_request_latency_ms p99=11706.799999982119 budget=1500
- [FAIL] mobile continue_to_add_ons_ms sample_count=1 required=30
- [FAIL] mobile continue_to_add_ons_ms p95=6141.800000011921 budget=1200
- [FAIL] mobile continue_to_add_ons_ms p99=6141.800000011921 budget=2000
- [FAIL] mobile background_refresh_ms sample_count=1 required=30

Warnings:
- [WARN] desktop drawer_open_to_first_usable_ms p50=7209.9000000059605 budget=700
- [WARN] desktop hold_request_latency_ms invalid_count=1
- [WARN] desktop continue_to_add_ons_ms p50=5696.4000000059605 budget=500
- [WARN] mobile drawer_open_to_first_usable_ms p50=7388.5 budget=700
- [WARN] mobile hold_request_latency_ms p50=11706.799999982119 budget=300
- [WARN] mobile continue_to_add_ons_ms p50=6141.800000011921 budget=500

Passes:
- [PASS] desktop day_switch_to_times_visible_ms p95=2.2000000178813934 budget=900
- [PASS] desktop day_switch_to_times_visible_ms p99=2.2000000178813934 budget=1500
- [PASS] desktop background_refresh_ms p95=1.199999988079071 budget=1800
- [PASS] desktop background_refresh_ms p99=1.199999988079071 budget=3000
- [PASS] mobile day_switch_to_times_visible_ms p95=2.199999988079071 budget=900
- [PASS] mobile day_switch_to_times_visible_ms p99=2.199999988079071 budget=1500
- [PASS] mobile background_refresh_ms p95=1.0999999940395355 budget=1800
- [PASS] mobile background_refresh_ms p99=1.0999999940395355 budget=3000

