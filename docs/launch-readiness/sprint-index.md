# Launch Readiness Sprint Index

This file tracks launch-readiness progress at the sprint level.

Percentages are estimates against each sprint's acceptance criteria. They are not a substitute for checklist evidence.

## Current status

Phase 2 launch-ops implementation is now substantially built and locally proven.

Current line in the sand:

- Local code/test proof is strong.
- Deployed operational proof is still incomplete.
- Live Sentry/provider dashboards are not fully proven.
- Slack alert routing is blocked until Sentry is upgraded or an alternate alerting path is chosen.
- Public rollout remains blocked until backup ownership, P1 escalation, alert routing, dashboards, deployed proof, and final go/no-go evidence are complete.

## Sprint summary

| Sprint | Area | Estimated completion | Launch impact | Status |
|---|---|---:|---|---|
| Phase 0 | Freeze and baseline | 100% | High | DONE |
| Phase 1 | Lifecycle correctness | 85–95% | Critical | Mostly complete; deployed/browser proof still needed |
| Phase 2 | Token and retry safety | 95–100% | Critical | Complete for targeted Sprint 2 scope; remaining raw-token/NFC hardening tracked as follow-up |
| Phase 3 | Verification and onboarding policy | 20–35% | Critical | Partially complete; Pro readiness gates improved, broader verification policy still open |
| Phase 4 | Boundary hardening | 55–70% | Critical | Stronger than previous baseline; origin/rate-limit/logging/token boundaries improved, deployed proof still needed |
| Phase 5 | Secure media and storage | 60–75% | Critical | Partially complete; private-media policy and chaos/load coverage improved, deployed Supabase proof still needed |
| Phase 6 | Health and operations | 65–80% repo-side / 25–40% operationalized | Critical | Docs, Sentry config, load tests, and chaos tests exist; live dashboard and alert proof still open |
| Phase 7 | Realtime and push | 5–10% | High | Mostly open; polling/realtime strategy still missing |
| Phase 8 | Rate limiting and abuse protection | 65–80% | Critical | Partially complete; route policies and local proof exist, live telemetry/alert proof still needed |
| Phase 9 | NFC and claim trust boundaries | 70–85% targeted scope / 45–60% public rollout hardening | Medium to high | Claim/NFC page behavior covered; entropy, rate limits, duplicate-tap, and deployed proof remain |
| Phase 10 | Testing sweep | 70–85% | Critical | Much stronger; load/chaos/local proof added, full suite/deployed evidence still needed |
| Phase 11 | Database and performance | 40–55% | Critical | Booking overlap/concurrency proof exists; hot-path EXPLAIN/performance review still open |
| Phase 12 | Compliance, privacy, and PII | 85–95% current pre-launch scope | Critical | Phase 1 privacy complete; launch-env reruns and deferred privacy debt remain tracked |
| Phase 13 | Feature flags and rollout | 15–30% | High | Rollout docs exist; runtime flags, support scripts, and rollback drill still open |
| Phase 14 | Final launch checklist | 55–70% repo-side / 25–40% operationalized | Critical | Checklist/docs exist and are being reconciled; final evidence/signoff still open |

## Current verified proof baseline

| Proof area | Current status | Evidence / notes |
|---|---|---|
| Phase 1 privacy proof | PASS locally | pnpm verify:privacy-phase1 passed in prior audit; privacy guards and tests are documented |
| Typecheck | PASS locally in audit | pnpm typecheck passed in prior audit |
| Sprint 2 token/idempotency hardening | COMPLETE for targeted scope | Aftercare/rebook, claim, claim page, NFC tap page, and short-code page tests exist |
| Pro readiness gates | COMPLETE for targeted scope | Booking write boundaries now enforce readiness for holds, finalize, and Pro-created booking |
| Sentry release/environment config | IMPLEMENTED | Server, edge, and client Sentry config now set release/environment metadata |
| Synthetic Sentry event endpoint | DEPLOYED AND CALLABLE | /api/internal/debug/sentry-test returned 200 with event ID e56044a034cb4fb78d1b09801fb43da5 |
| Load suite | PASS locally | pnpm test:load:launch passed with 8/8 steps in latest supplied output |
| Chaos suite | PASS locally per updated Phase 2 baseline | Chaos tests exist for Redis, storage, Stripe webhook storm, Postmark, Twilio, and DB degradation |
| Live dashboard proof | TODO | Need Sentry dashboard/query links with real staging/production signals |
| Alert routing proof | BLOCKED / TODO | Sentry-to-Slack requires paid Sentry plan or alternate alert path |
| Backup owner | BLOCKED | Required before public rollout |
| Public P1 escalation | BLOCKED | Requires backup owner and tested escalation path |
| Deployed/provider proof | TODO | Provider dashboards, live health, storage policy, and capacity/quota proof still needed |

## Important distinction

This sprint index separates four kinds of progress:

| Type | Meaning |
|---|---|
| Implemented | Code/doc exists in repo |
| Tested locally | Focused local proof exists |
| Verified deployed | Behavior is proven in staging or production |
| Operationalized | Monitoring, alerting, owners, runbooks, rollback, and support workflow are usable |

A sprint can be mostly complete in repo but still incomplete for launch if deployed and operational proof are missing.

## Completion definitions

A sprint is 100% only when:

1. Every P0 item in that sprint is DONE, PASS, or VERIFIED.
2. Every intentionally deferred item has a reason, owner, and follow-up.
3. Test evidence is linked for all runtime-affecting work.
4. Deployed/staging proof exists when the sprint affects launch behavior.
5. Rollback notes exist for runtime, database, provider, and infrastructure changes.
6. Related alerts and dashboards are live if the sprint affects operational readiness.
7. No acceptance criterion is silently skipped.

## Current launch-readiness interpretation

| Launch stage | Current decision | Why |
|---|---|---|
| Internal/local proof | Mostly GO | Typecheck, privacy proof, token hardening, load suite, chaos suite, and Sentry config are locally/repo proven |
| Private beta | NO-GO until observability/alert evidence is linked | Needs live dashboard proof, Slack or alternate alert path, health/readiness proof, staging proof, rollback path, and go/no-go evidence |
| Public rollout | NO-GO | Requires all private-beta gates plus backup owner, tested P1 escalation, provider capacity/quota, deployed proof, and final signoff |

## Sprint details

### Phase 0 — Freeze and baseline

Status: DONE  
Estimated completion: 100%  
Launch impact: High

Completed:

- Launch-readiness document set exists.
- Checklist structure exists.
- Phase/sprint tracking exists.
- Evidence-based launch gate approach is established.

Remaining:

- Keep baseline references current as new proof lands.

### Phase 1 — Lifecycle correctness

Status: Mostly complete; deployed/browser proof still needed  
Estimated completion: 85–95%  
Launch impact: Critical

Completed or mostly complete:

- Backend closeout rules own completion.
- Direct unsafe SessionStep.DONE transition is blocked.
- Pro sees backend closeout blockers.
- Booking closeout smoke coverage exists.
- Write-boundary lifecycle protections are in place.

Remaining:

- Full browser/staging proof.
- Full lifecycle action matrix proof if not already recorded.
- Pro session polling/realtime strategy remains open.

### Phase 2 — Token and retry safety

Status: Complete for targeted Sprint 2 scope  
Estimated completion: 95–100% targeted scope  
Launch impact: Critical

Completed:

- Active aftercare/rebook paths use ClientActionToken.
- Active aftercare/rebook paths do not use AftercareSummary.publicToken.
- Rebook GET/POST token behavior is tested.
- Rebook idempotency behavior is tested.
- Claim-link creation/update/public state/accepted audit behavior is tested.
- Claim mutation handles revoked, already-claimed, missing, mismatch, conflict, and race states.
- Claim page state rendering is tested.
- NFC tap page behavior is tested.
- Short-code redirect behavior is tested.

Remaining follow-ups:

- Drop legacy AftercareSummary.publicToken later.
- Migrate ProClientInvite.token to hashed storage or equivalent.
- Confirm claim-token expiry/rotation policy.
- Confirm NFC card IDs are non-enumerable.
- Confirm short codes are high entropy or rate-limited.
- Add/verify rate limiting around /c/[code] and /t/[cardId].
- Verify duplicate-tap behavior.
- Verify unready Pros cannot be booked through tap-code flow if tap-code booking is launch scope.
- Add deployed proof if these flows are public during beta/rollout.

### Phase 3 — Verification and onboarding policy

Status: Partially complete  
Estimated completion: 20–35%  
Launch impact: Critical

Completed or improved:

- Pro readiness gates were hardened.
- PRO_NOT_READY booking error exists.
- Pro readiness evaluator is authoritative.
- Transaction-compatible readiness checking exists.
- Entry-point-aware readiness checking exists.
- Holds, finalization, and Pro-created bookings enforce readiness.
- Pro-created booking preflight blocks before client/invite side effects.
- Public search/discovery remains constrained to approved public Pro surfaces.

Remaining:

- Broader verification/onboarding policy documentation.
- Deployed proof.
- State matrix for readiness/onboarding/verification edge cases.
- Final launch decision on which Pro states are beta/public-bookable.

### Phase 4 — Boundary hardening

Status: Partially complete  
Estimated completion: 55–70%  
Launch impact: Critical

Completed or improved:

- Origin/Referer protections exist.
- High-risk route rate limits exist.
- Booking route safe logging hardening exists.
- Sentry event scrubbing exists.
- Token/idempotency boundaries improved.
- Claim/NFC unsafe redirect behavior is covered.

Remaining:

- No-bare-error logging CI guard.
- Full deployed proof.
- Alerting on boundary failures.
- More complete route-by-route trust-boundary map.

### Phase 5 — Secure media and storage

Status: Partially complete  
Estimated completion: 60–75%  
Launch impact: Critical

Completed or improved:

- Supabase storage bucket/policy migration exists.
- Media-private restrictive policy baseline exists.
- Media-public policy baseline exists.
- Media route rate limits exist.
- Media metadata load proof exists locally.
- Storage outage chaos proof exists locally.

Remaining:

- Live Supabase bucket policy verification.
- Private media deployed proof.
- UploadSession binding.
- Orphan media cleanup.
- Media scan/moderation decision.
- Provider dashboard proof.

### Phase 6 — Health and operations

Status: Repo-side mostly built; operational proof incomplete  
Estimated completion: 65–80% repo-side / 25–40% operationalized  
Launch impact: Critical

Completed or improved:

- On-call, go/no-go, beta, public rollout, risk, Sentry, Slack, load, and chaos docs exist.
- Health endpoints exist.
- Sentry release/environment config exists.
- Synthetic Sentry test endpoint exists and returned a deployed event ID.
- Launch load suite exists.
- Chaos suite exists.
- verify:launch-ops exists.

Remaining:

- Live Sentry dashboard sections.
- Provider dashboard links.
- Slack alert routing.
- Synthetic alert routed to Slack or approved alternate path.
- Backup owner.
- Tested P1 escalation path.
- Deployed health/readiness proof.
- Provider quota/capacity proof.
- Rollback drill/evidence.

### Phase 7 — Realtime and push

Status: Mostly open  
Estimated completion: 5–10%  
Launch impact: High

Remaining:

- Pro session state endpoint.
- Active session polling or realtime strategy.
- Push/notification live behavior proof.
- Reconnect/stale-state behavior.

### Phase 8 — Rate limiting and abuse protection

Status: Partially complete  
Estimated completion: 65–80%  
Launch impact: Critical

Completed or improved:

- Central rate-limit policy definitions exist.
- High-risk route/wrapper enforcement exists.
- Auth route rate limits exist.
- SMS route rate limits exist.
- Token route rate limits exist.
- Media route rate limits exist.
- Signup load proof demonstrates expected 201/429 behavior.
- Redis/rate-limit chaos proof exists locally.

Remaining:

- Live telemetry/dashboard proof.
- Alert thresholds for rate-limit anomalies.
- Rate limits for NFC/tap-code surfaces if public.
- Deployed proof of fail-closed behavior where required.

### Phase 9 — NFC and claim trust boundaries

Status: Targeted scope mostly complete; broader public hardening still open  
Estimated completion: 70–85% targeted scope / 45–60% public rollout hardening  
Launch impact: Medium to high

Completed:

- Claim-link behavior covered.
- Claim page behavior covered.
- NFC tap page rejects missing/inactive cards.
- NFC tap intents expire after 30 minutes.
- NFC tap page stores user ID when present.
- NFC tap page derives claim, Pro booking, and salon white-label intents.
- NFC tap page rejects unsafe external/protocol-relative next overrides.
- Short-code page normalizes codes and redirects active cards.

Remaining:

- Confirm card IDs are non-enumerable.
- Confirm short-code entropy or rate limiting.
- Verify revoked/deactivated card behavior in deployed environment.
- Verify unready Pros cannot be booked through tap-code flow.
- Verify duplicate-tap/idempotency behavior.
- Add audit event proof for tap intent creation if required.
- Clarify tenant behavior before white-label launch.

### Phase 10 — Testing sweep

Status: Much stronger; still needs final full proof  
Estimated completion: 70–85%  
Launch impact: Critical

Completed or improved:

- Targeted privacy tests exist.
- Token/idempotency tests exist.
- Pro readiness tests exist.
- Load suite exists.
- Chaos suite exists.
- Phase 2 local launch-ops proof exists.

Remaining:

- Full pnpm test final pass on launch commit.
- CI proof if CI is required.
- Staging/browser E2E proof.
- Final evidence recording in go-no-go.md and test-proof.md.

### Phase 11 — Database and performance

Status: Partially complete  
Estimated completion: 40–55%  
Launch impact: Critical

Completed or improved:

- DB no-overlap strategy is decided and locally tested.
- Booking overlap/concurrency tests exist.
- DB degradation chaos proof exists locally.

Remaining:

- Hot-query index review.
- Notification inbox index review.
- Booking dashboard query plan review.
- Availability query plan review.
- EXPLAIN ANALYZE notes for hot paths.
- Read-replica production config verification.
- Replica lag readiness check.

### Phase 12 — Compliance, privacy, and PII

Status: Complete for current pre-launch scope; deferred debt tracked  
Estimated completion: 85–95%  
Launch impact: Critical

Completed:

- Canonical contact normalization.
- Audit payload redaction.
- AEAD address envelope.
- HMAC contact hash v2.
- Legacy SHA-256 contact hash drop migration.
- Export/delete foundations.
- SUPER_ADMIN-gated privacy routes.
- Privacy request runbook.
- Privacy verification command passes in audit.

Remaining:

- Launch-env HMAC v2 rerun decision/proof if relevant.
- Launch-env AEAD address rerun decision/proof if relevant.
- Storage object byte deletion workflow.
- Message deletion/retention implementation.
- Booking-level anonymization beyond current boundary.
- Continued PII plaintext-read baseline burn-down.

### Phase 13 — Feature flags and rollout

Status: Mostly open  
Estimated completion: 15–30%  
Launch impact: High

Completed or improved:

- Private beta and public rollout checklist docs exist.
- Rollout stages are documented.
- Rollback criteria are drafted.

Remaining:

- Runtime flags document.
- Percentage rollout strategy.
- Segment/geography rollout strategy.
- Support launch script.
- Rollback drill/proof.
- Kill switch strategy by feature.

### Phase 14 — Final launch checklist

Status: In progress  
Estimated completion: 55–70% repo-side / 25–40% operationalized  
Launch impact: Critical

Completed or improved:

- Launch checklist exists.
- Go/no-go gate exists.
- Private beta checklist exists.
- Public rollout checklist exists.
- Risk register exists.
- Sentry dashboard proof doc exists.
- Slack alert map exists.
- Load/chaos docs exist.
- Local launch-ops proof exists.

Remaining:

- Live dashboard proof.
- Alert-routing proof.
- Backup owner.
- P1 escalation proof.
- Provider dashboard/capacity proof.
- Deployed staging proof.
- Final signed go/no-go decision.

## Current recommended next sprint

Recommended next sprint:

text Phase 6 — Health and operations: live observability and alert proof 

Reason:

Phase 2 code proof is now strong enough that the next bottleneck is not “write more scaffolding.” The next bottleneck is proving the deployed system can be observed, alerted on, and operated.

## Recommended next work order

1. Confirm the synthetic Sentry event appears in Sentry with:
   - environment
   - release
   - route
   - request ID if available
   - safe redaction
2. Add the Sentry event proof to sentry-dashboard.md.
3. Create or link the minimum Sentry dashboard/query views.
4. Decide alert path:
   - upgrade Sentry for Slack alerts, or
   - choose an alternate private-beta alert path.
5. Test one synthetic alert end-to-end.
6. Update slack-alerts.md, oncall.md, and go-no-go.md.
7. Record deployed health/readiness proof.
8. Record provider dashboard links.
9. Name backup owner before public rollout.
10. Run final proof commands on the intended launch commit.

## Current hard blockers

| Blocker | Blocks private beta? | Blocks public rollout? | Notes |
|---|---:|---:|---|
| Live dashboard proof missing | Yes | Yes | Sentry/provider dashboard sections need real links/evidence |
| Synthetic alert routing missing | Yes | Yes | Slack or approved alternate path required |
| Sentry-to-Slack unavailable on current plan | Yes, unless alternate path chosen | Yes, unless alternate path chosen | Pick upgrade or alternate alert path |
| Backup owner missing | No, if accepted for private beta | Yes | Must be named before public rollout |
| P1 escalation path untested | No, if accepted for private beta | Yes | Public launch needs stronger escalation |
| Deployed/provider proof incomplete | Yes | Yes | Health, storage, Stripe, Postmark, Twilio, Redis, DB proof needed |
| Formal SLO thresholds incomplete | Basic thresholds needed | Yes | Public rollout requires thresholds/error budget |
| Rollback drill/proof incomplete | Recommended | Yes | Public rollout needs rollback confidence |

## Maintenance rule

Do not raise sprint completion percentages because a file exists.

Raise completion only when the matching proof exists:

- code exists
- tests pass
- deployed behavior is verified where relevant
- dashboard evidence is linked
- alert routing is tested
- owner and backup are named where required
- rollback or mitigation is documented
- remaining risk is tracked with owner and launch treatment