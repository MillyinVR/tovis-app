# TOVIS Weekly Audit — 2026-06-05

**Audited by:** Automated weekly audit  
**Repo:** ~/Dev/tovis-app  
**Audit commit baseline:** ae30aff (latest on main at time of audit)  
**Overall launch status:** 🔴 NO-GO (private beta and public rollout)

---

## Week's Progress Summary

**54 commits merged in the past 7 days** — an extremely active week. Work fell into three clear areas:

### Launch Operations Proof (Phase 2) — 🟢 Major milestone
The bulk of the week was completing and validating the launch ops proof layer:

- **Chaos suite** implemented and passing locally: 6 test files, 17 tests covering Redis outage, Supabase storage outage, Stripe webhook storm, Postmark degradation, Twilio degradation, and DB degradation.
- **Launch load suite** passing locally: 8/8 steps across signup, availability bootstrap, holds, booking finalize, media metadata, checkout, Stripe webhook replay, and notification processing.
- **Sentry release/environment config** implemented across server, edge, and client configs.
- **Deployed Sentry intake proven**: synthetic event captured in production (event ID `e56044a034cb4fb78d1b09801fb43da5`).
- `pnpm verify:launch-ops` passing locally at commit `27bfa28`.
- Added `pnpm test:load:launch` and `pnpm test:chaos` scripts.

### Privacy Phase 1 — 🟢 Closed
- Completed HMAC v2 contact hash migration, v2-only reads enforced, legacy SHA-256 drop migration committed.
- AEAD address envelope and backfill scripts complete.
- Privacy export/delete routes protected under SUPER_ADMIN gate.
- `pnpm verify:privacy-phase1` passing.
- Phase 1 declared done for pre-launch scope; deferred debt tracked.

### Fixes & Infra
- Fixed Twilio transient error retry classification (PR #49).
- Launch readiness docs reconciled with current proof state.
- Local test DB scripts added.

---

## Launch Readiness Scorecard

| Area | Status | Notes |
|---|---|---|
| App spec completeness | 🟡 Yellow | All 7 core features have routes; browser E2E and staging proof still incomplete |
| Test coverage | 🟢 Green | 314 test files; unit, integration, chaos, load, and E2E all present |
| TypeScript health | 🟢 Green | Zero `// @ts-ignore` or unguarded `as any` in app/lib code; `check:no-type-escape` script exists |
| Deployment checklist | 🟡 Yellow | Load test result fields (date, commit, p50/p95/p99) are still blank |
| Security / auth | 🟢 Green | Auth boundary is centralized; `requireUser/requireClient/requirePro` consistent; middleware handles origin/CSRF; Phase 1 sweep complete |
| Error handling | 🟢 Green | Extensive route test coverage; rate-limit fail-closed behavior proven locally |
| Environment / config | 🟢 Green | No hardcoded production secrets found; env vars are well-enumerated |
| Dependencies | 🟢 Green | Next 16.1.1, React 19.2.0, Prisma 6.19.0, Stripe 22.1.0 — all current |
| Open TODOs in code | 🟢 Green | 6 instances, all UI display labels (`label={... 'TODO'}`) in Pro session page — not code TODOs |
| Live observability | 🔴 Red | Sentry intake proven; dashboard sections, alert routing, and Slack destination all still TODO/BLOCKED |
| Deployed / staging proof | 🔴 Red | All local proof; no staged/production proof beyond Sentry intake |
| Realtime / polling | 🔴 Red | Pro session state endpoint and polling strategy unimplemented (Phase 7, ~5–10%) |
| Launch ops (backup owner / escalation) | 🔴 Red | No named backup owner; P1 escalation path untested — both public rollout blockers |

---

## App Spec Feature Coverage

| Feature | Pages/routes exist | API routes exist | Deployed proof |
|---|---|---|---|
| Looks feed | ✅ `app/(main)/looks/` | ✅ `/api/looks/`, `/api/discover/` | ❌ Staging |
| Booking | ✅ `app/(main)/booking/` | ✅ `/api/bookings/`, `/api/holds/`, `/api/availability/` | ❌ Staging |
| Waitlist | ✅ (via booking flow) | ✅ `/api/waitlist/` | ❌ Staging |
| Portfolio | ✅ `app/pro/` | ✅ `/api/media/`, `/api/pro/` | ❌ Staging |
| Reviews | ❌ No dedicated page found | ✅ `/api/reviews/` | ❌ Staging |
| Calendar | ✅ `app/pro/calendar/` | ✅ `/api/calendar/`, `/api/openings/` | ❌ Staging |
| Media | ✅ `app/media/`, `app/pro/media/` | ✅ `/api/media/` | ❌ Staging |

**Note:** Reviews has API routes but no dedicated client-facing page found under `app/(main)/`. Worth confirming if reviews render inline on Pro profiles or need a standalone page.

---

## Items Still Needed Before Launch

### Private Beta Blockers

1. **Live Sentry dashboard proof** — All 10 required sections (health, booking funnel, pro session, media, payments, notifications, background jobs, auth/rate limits, infra dependencies, SLO) need live links and thresholds. Sentry dashboard sections are documented in `docs/launch-readiness/sentry-dashboard.md` but unlinked.

2. **Alert routing** — Sentry-to-Slack is **BLOCKED** on a Sentry plan upgrade. Either upgrade Sentry or document and test an alternate private-beta alerting path. Until this is resolved, there is no operational alert path.

3. **Deployed health/readiness proof** — Health endpoints exist and are tested locally. They need to be verified against the staging/production environment (`HEALTH_CHECK_PROVIDERS_LIVE=true`).

4. **Booking lifecycle browser E2E** — API-assisted proof exists. Full browser/staging path (client books → pro runs session → checkout closes) is still `IN PROGRESS`.

5. **Storage policy deployed verification** — Supabase bucket policies are in code. Need to verify them in the deployed environment to confirm private media cannot leak.

6. **Signup load test result fields** — `docs/deployment-checklist.md` has blank fields for environment, date, commit, p50/p95/p99, error rate. Fill these in from the local load test results.

7. **Private beta checklist evidence** — `docs/launch-readiness/private-beta-checklist.md` exists but evidence fields are still TODO.

### Public Rollout Blockers (additional)

8. **Named backup owner** — Required before public rollout. Currently blocked/missing.

9. **P1 escalation path tested** — No tested escalation path beyond primary owner.

10. **DB hot-path performance review** — EXPLAIN ANALYZE notes for availability, booking, and notification inbox queries are missing. Hot paths include `/api/availability/bootstrap`, `/api/holds`, and `/api/bookings/finalize`.

11. **Realtime/polling strategy** — Pro session state endpoint is not implemented. Active session polling is missing. Phase 7 is ~5–10% complete.

12. **Idempotency map document** — `docs/launch-readiness/idempotency-map.md` is `TODO`. Idempotency ledger cleanup/reaper and PII redaction of persisted response JSON are also unimplemented.

13. **Supabase SQL policy tests** — No automated tests for storage bucket policies.

14. **Media moderation decision** — No decision or implementation for media scan/moderation.

15. **Launch-env privacy backfill reruns** — HMAC v2 and AEAD address backfills need to be rerun and recorded if the target launch environment has relevant rows.

---

## Recommended Priorities for the Coming Week

**Priority 1 — Unblock private beta observability (1–2 days)**
- Decide the alert path: upgrade Sentry or pick an alternate private-beta alerting destination.
- Create the minimum Sentry dashboard queries for health and booking funnel.
- Route one synthetic alert end-to-end and record the proof.
- Update `sentry-dashboard.md`, `slack-alerts.md`, and `go-no-go.md`.

**Priority 2 — Deployed staging proof (1–2 days)**
- Verify `/api/health/ready` in the staging environment with `HEALTH_CHECK_PROVIDERS_LIVE=true`.
- Record the output in `docs/launch-readiness/test-proof.md`.
- Verify Supabase storage bucket policies in the deployed environment.

**Priority 3 — Fill in deployment checklist gaps (half day)**
- Record signup load test results (p50/p95/p99, error rate, date, commit) in `docs/deployment-checklist.md`.
- Complete the private beta checklist evidence fields.

**Priority 4 — Reviews page (if needed for beta, half day)**
- Confirm whether client-facing reviews render inline on Pro profiles or need a standalone page. If a standalone page is needed, stub it before beta.

**Priority 5 — Booking lifecycle browser E2E (2–3 days)**
- Complete the full browser path from client booking through pro session closeout.
- Record proof in `go-no-go.md`.

**For the week after:** DB hot-path EXPLAIN review, idempotency map document, and name a backup owner.

---

## Audit Notes

- **No hardcoded production secrets** were found in the codebase.
- **No `// @ts-ignore` or unsafe `as any` casts** were found in app or lib code. The `check:no-type-escape` script exists as a guard.
- The 6 "TODO" strings in code are all UI display labels in `app/pro/bookings/[id]/session/page.tsx` and `aftercare/page.tsx` — not engineering debt.
- **Dependencies look healthy.** No deprecated or alarming packages. Both `bcrypt` and `bcryptjs` are present — worth confirming which is canonical and removing the other.
- The test surface (314 files) is impressive and well-organized across unit, integration, load, chaos, and E2E layers.
