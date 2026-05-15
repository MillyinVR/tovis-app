# Launch Readiness Sprint Index

This file tracks launch-readiness progress at the sprint level.

Percentages are estimates against each sprint's acceptance criteria. They are not a substitute for checklist evidence.

## Sprint summary

| Sprint | Area | Estimated completion | Launch impact | Status |
|---|---|---:|---|---|
| Phase 0 | Freeze and baseline | 100% | High | DONE when this document set exists and checklist is adopted |
| Phase 1 | Lifecycle correctness | 85–95% | Critical | Mostly complete; needs verification evidence |
| Phase 2 | Token and retry safety | 80–95% | Critical | Mostly complete; depends on aftercare send atomicity scope |
| Phase 3 | Verification and onboarding policy | 10–20% | Critical | Mostly open |
| Phase 4 | Boundary hardening | 15–30% | Critical | Existing boundary strong; planned guardrails still open |
| Phase 5 | Secure media and storage | 50–60% | Critical | Partially complete |
| Phase 6 | Health and operations | 5–10% | Critical | Mostly open |
| Phase 7 | Realtime and push | 5–10% | High | Mostly open |
| Phase 8 | Rate limiting and abuse protection | 30–40% | Critical | Partially complete |
| Phase 9 | NFC and claim trust boundaries | 35–65% | Medium to high | Partially complete |
| Phase 10 | Testing sweep | 30–45% | Critical | Partially complete |
| Phase 11 | Database and performance | 30–40% | Critical | Partially complete |
| Phase 12 | Compliance, privacy, and PII | 5–10% | Critical | Mostly open |
| Phase 13 | Feature flags and rollout | 5–10% | High | Mostly open |
| Phase 14 | Final launch checklist | 35–50% | Critical | In progress |

## Completion definitions

A sprint is `100%` only when:

1. Every P0 item in that sprint is `DONE` or `VERIFIED`.
2. Every intentionally deferred item has a reason, owner, and follow-up.
3. Test evidence is linked for all runtime-affecting work.
4. Rollback notes exist for runtime, database, provider, and infrastructure changes.
5. No acceptance criterion is silently skipped.

## Current recommended next sprint

Recommended next sprint after Phase 0:

```text
Phase 3 — Verification and onboarding policy