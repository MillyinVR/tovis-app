# TOVIS Weekly Audit — 2026-06-14

**Audited by:** Automated weekly audit
**Repo:** ~/Dev/tovis-app
**Audit commit baseline:** ae1777b (HEAD on main)
**Previous audit baseline:** e9a93fb (2026-06-08)
**Overall launch status:** 🟡 CONDITIONAL NO-GO (private beta approachable; public rollout still blocked)

This is the most active week audited to date. Multiple previously-🔴-red launch blockers were closed, and the test suite grew from 314 to 710 files.

---

## Week's Progress Summary

**~143 commits since the last audit.** Work split across five clear areas:

### 🟢 Launch ops closures (major)
The biggest week ever for closing actual gates rather than documenting them:

- **App-generated Sentry → Slack alert routing: PASS** — production-safe synthetic alert (event `f7a0d19cb4a040a3a21f4679086f166f`, Slack short ID `TOVIS-APP-K`) routed to `#tovis-ops-alerts` 2026-06-08. This was the single most-cited blocker in the last two audits.
- **Deployed health/readiness proof: PASS** — `/api/health/live`, `/api/health`, `/api/health/ready` all returning HTTP 200 on `https://www.tovis.app`; Redis readiness key collision fixed.
- **Backup owner: formally accepted as private-beta risk** — solo-operator risk recorded as RISK-001 (2026-06-09). Private beta no longer blocks on this; public rollout still does.
- **Admin password hardened** — `scripts/create-super-admin.ts` now requires `ADMIN_PASSWORD` ≥ 12 chars and throws rather than falling back to a default. (This was flagged in the 2026-06-08 audit; fixed same day.)
- **Pro session polling: implemented** — compact session state endpoint (`/api/pro/session`) and UI polling wired. This was a 🔴 Red item in every prior audit.

### 🟢 Massive code consolidation sprint (PRs #125–140)
A systematic de-duplication run landed across ~15 PRs:

- `isRecord` guards consolidated onto `lib/guards`; array exclusion aligned.
- Env-reading helpers → `lib/env`; email-provider env reads behind a typed error helper.
- Money formatting → `lib/money`; query-param coercers → `lib/queryParams`; haversineMiles deduped.
- Handle normalization consolidated; internal-job request auth centralized with timing-safe comparison.
- Booking conflict status consolidated; last-minute opening overlap gap fixed as part of that pass.
- `bookingJsonFail` → shared barrel util (so route-test mocks now apply correctly).
- JSON-body parsing → `readJsonRecord`; app URL helper → `lib/appUrl`.
- Soft-auth → unified `getOptionalUser` + `requireUser/requireClient` on 16 routes.
- SHA256 + token generation → `lib/auth/timingSafe`.
- Upload pipeline consolidated; `UploadSession` binding extended to looks/portfolio and reviews.
- Duplicate-logic handoff doc added (`docs/launch-readiness/handoff.md`) to track remaining consolidation backlog.

### 🟢 Feature completions
- **Looks social (S1.1–S1.3 PR1):** Following tab, real follower counts, new-follower notifications. OG card metadata, infinite scroll, and share deep-link leaks fixed. Follow button wired to the real API. Fabricated booking/future-self signals removed.
- **Tenant/multi-tenant foundation:** Tenant model landed; NOT NULL tenant columns enforced; `NfcCard.salonSlug` dropped; custom-domain middleware resolves tenant + brand from request host; brand copy migrated off hardcoded strings (WS-6); tenant attribution dual-written on `MediaAsset` and `Notification` (T2.2); TOVIS root tenant backfilled; tenant visibility helpers in `lib/tenant`; cross-tenant looks feed scope fixed; NFC claim scoped to issuing tenant.
- **Aftercare improvements:** Calendar popup for date pickers; day/week/month stepping; services/prices summary + inline client profile; auto-upload before/after photos on file select; "Payment due" badge for aftercare-sent-but-unpaid; pro-session footer clears once aftercare is sent.
- **Multi-location support:** Clients can pick which salon location to book; per-location working hours editing; location-level mobile radius enforcement.
- **Pro verification docs:** Real upload surface for verification documents.
- **Signup UX overhaul:** Pro signup restructured into a three-step wizard; inline validation; Turnstile challenge surfaced inline (visible container, valid widget size); stale verification sessions healed instead of redirect-looping.
- **Pro onboarding gate:** 404 fixed; `/pro/onboarding` checklist page added.
- **Media consent gate:** Client must consent before a pro can publish session media to Looks.
- **Storage RLS:** Signed-upload bug (POST→PUT) fixed; storage RLS policy-as-code applied.

### 🟢 CI / security hardening
- Unit-test CI + security-scan CI added (PR #74); all dep vulns fixed; legacy Supabase key fallback dropped.
- esbuild advisory `GHSA-gv7w-rqvm-qjhr` cleared.
- Prisma migration CI pipeline: migrations deploy automatically on merge to main (PR #115).
- Next.js 16.2 proxy convention migration (middleware.ts).
- `noUncheckedIndexedAccess` and stricter compiler flags enabled.
- `lib/typed` boundary helpers added; all production type escapes (`as unknown as`, unguarded `any`) removed from `app/` and `lib/`.
- Safe next-URL validation centralized in `lib/security/safeNextUrl`.
- E2E quarter-hour boundary flake fixed (×2); env layering fixed for `test:e2e:local`.
- GitHub Actions bumped to Node 24 majors.

### 📚 Launch documentation
- New docs: `sprint-index.md`, `sprint-1.md`, `sprint-2-*.md`, `sprint-3-*.md`, `social-platform-plan`, `tenant-foundation-audit`, `storage-policy-proof`, `rate-limit-coverage`, `idempotency-map`, `finish-plan-2026-06-12`, `roadmap-corrected-2026-06-12`, `load-traffic-model`, `local-load-proof-2026-06-12`.
- Phase 12 production rerun proof recorded (HMAC v2 + AEAD backfills on production data).

---

## Launch Readiness Scorecard

| Area | Status | Notes |
|---|---|---|
| App spec completeness | 🟢 Green | All 7 core features (Looks, Booking, Waitlist, Portfolio, Reviews, Calendar, Media) have routes and API coverage; Looks social features significantly advanced this week |
| Tests | 🟢 Green | **710 test files** (up from 314 last audit) — unit, integration, chaos, load, and E2E; consolidation PRs added new tests for every shared helper |
| TypeScript health | 🟢 Green | Zero `@ts-ignore`, zero unguarded `as any` in `app/`/`lib/`; `noUncheckedIndexedAccess` now enabled; typed boundary helpers in `lib/typed` |
| Deployment checklist | 🟡 Yellow | `docs/deployment-checklist.md` load-test evidence fields still blank (environment, date, commit, p50/p95/p99) — no staging load test has been recorded yet |
| Security / auth | 🟢 Green | Auth centralized; storage RLS policy-as-code; media consent gate; safe next-URL; NFC cross-tenant fix; dep vulns cleared; admin password script hardened |
| Error handling | 🟢 Green | Consistent `jsonOk`/`jsonFail`, idempotency, rate limiting, observability; `bookingJsonFail` barrel export fixed so route-test mocks now apply |
| Environment / config | 🟢 Green | No live secrets in source; admin password script now requires ≥12-char env var; env reads consolidated behind typed helpers in `lib/env` |
| Dependencies | 🟢 Green | Dep vulns cleared; esbuild advisory closed; Node 24 in CI; Next 16.2, React 19.2, Prisma 6.19, Stripe 22 |
| Open TODOs in code | 🟢 Green | Only 6 `TODO` string literals in source, all UI status chip labels in Pro session/aftercare pages — not engineering debt |
| Live observability | 🟡 Yellow | **Upgraded from 🔴 Red** — deployed health proof PASS; app-generated Sentry → Slack alert PASS; remaining follow-ups: runbook-link-in-message, formal ACK timing, live dashboard section links, route-specific P1/P2 thresholds |
| Deployed / staging proof | 🟡 Yellow | **Upgraded from 🔴 Red** — health/readiness deployed PASS; Sentry alert deployed PASS; deployed smoke proof for core booking/auth/media flows still TODO |
| Pro session realtime | 🟢 Green | **Upgraded from 🔴 Red** — compact session state endpoint + UI polling implemented |
| Launch ops ownership | 🟡 Yellow | **Upgraded from 🔴 Red** — solo-operator risk formally accepted as RISK-001 for private beta (2026-06-09); public rollout still requires named backup owner |
| Private beta sign-off | 🔴 Red | Sign-off tables in `go-no-go.md` still all TODO; deployed smoke proof not yet executed; support/rollback decisions not yet made; private beta cohort not yet defined |

---

## Specific Items Still Needed Before Private Beta

1. **Fill the private beta sign-off tables in `go-no-go.md`.** Product/owner, engineering, privacy/security, and support/comms rows are still all TODO — this is the final gate document.
2. **Execute and record deployed smoke proof** (`docs/launch-readiness/deployed-smoke-proof.md`). Templates exist; execution against the live environment is still TODO. Cover at minimum: auth (register/login), booking flow, media upload, waitlist.
3. **Make support/rollback decisions** in `docs/launch-readiness/private-beta-support-rollback.md` — templates are ready, Tori's decisions aren't filled in yet.
4. **Define the private beta cohort.** Who gets access, how they request it, and who approves — not tracked in any doc yet.
5. **Live Sentry dashboard sections.** The dashboard-checklist still has no linked live panels for booking funnel, auth/rate limits, payments/webhooks, or SLO/error budget. At minimum, record what is visible in Sentry today and mark as accepted coverage or note what's missing.
6. **Fill deployment checklist load-test fields.** Record the results of the signup load test against staging/production before approving launch.

## Additional Items Needed Before Public Rollout (beyond private beta)

7. **Named backup on-call owner.** Accepted as private beta risk; still required before public rollout (RISK-001).
8. **Tested P1 escalation path.** No backup means no tested escalation — public rollout blocker.
9. **Route-specific P1/P2 alert thresholds** in `docs/runbooks/booking-funnel.md` (all still TODO).
10. **Runbook-link-in-message** for Sentry Slack alerts and formal acknowledgement timing.

---

## Recommended Priorities for the Coming Week

1. **Private beta sign-off decision.** The app is in the best shape it's ever been. The gap between current state and private beta is almost entirely paperwork + a smoke-proof execution. Block an hour, run through `deployed-smoke-proof.md`, fill in `go-no-go.md`, and make the call.
2. **Run the deployed smoke proof** — the checklist is written, the environment is live, health endpoints are already proven. This should take ~30–60 minutes.
3. **Fill private beta support/rollback decisions.** What's the support path for beta users? What's the rollback trigger? These are quick decisions, not engineering work.
4. **Link Sentry panels that already exist.** Even if the dashboard isn't perfectly built, link whatever panels are currently visible in Sentry to the dashboard-checklist. "Here's what we can see right now" is better than all-TODO.
5. **Continue the social platform plan (S1.3 remaining PRs)** — the S1.3 new-follower notification spec is build-ready; the next PRs are likely email/SMS delivery wiring.

---

## Notable Metrics Delta vs. Last Audit

| Metric | 2026-06-08 | 2026-06-14 | Change |
|---|---|---|---|
| Test files | 314 | 710 | +396 (+126%) |
| `@ts-ignore` in app/lib | 0 | 0 | — |
| Unguarded `as any` in app/lib | 0 | 0 | — |
| 🔴 Red scorecard items | 4 | 1 | −3 |
| Launch docs in `launch-readiness/` | ~15 | 40+ | +25 |
| Open PRs merged this week | — | ~30 | — |
