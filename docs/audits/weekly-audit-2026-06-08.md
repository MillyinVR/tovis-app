# TOVIS Weekly Audit — 2026-06-08

**Audited by:** Automated weekly audit
**Repo:** ~/Dev/tovis-app
**Audit commit baseline:** e9a93fb (HEAD on main)
**Previous audit baseline:** ae30aff (2026-06-05)
**Overall launch status:** 🔴 NO-GO (private beta and public rollout) — unchanged from last week

---

## Week's Progress Summary

**50 commits in the past 7 days; 28 new commits since the last audit (ae30aff → HEAD).** This was a documentation- and operations-heavy week with almost no new application code. The work concentrated on closing the "live observability" gap flagged red last audit.

### Incident runbooks (new)
Four new runbooks were added to `docs/runbooks/`: auth-session, booking-funnel, pro session lifecycle, and SLO/error budget. Each defines alert thresholds, escalation steps, and an evidence template — but every one still lists `Backup owner: TODO — public rollout blocker` and most evidence fields remain `TODO`.

### Launch readiness docs (reconciliation pass)
Nearly all of `docs/launch-readiness/*` was rewritten to reflect "current Phase 2 status": checklist, go-no-go, risk register, public/private rollout checklists, dashboard checklist, on-call plan, Slack alert map, Sentry dashboard proof, and test-proof. This was a large reconciliation effort, but it is mostly re-statement of known gaps rather than new evidence — most proof fields are still `TODO`, `BLOCKED`, or `PARTIAL`.

### Sentry → Slack alert routing (partial progress)
`e9a93fb` documents a **partial** proof that a saved Sentry issue-alert rule delivered a test notification to `#tovis-ops-alerts`. A production-safe, app-generated synthetic alert through the full Sentry-to-Slack pipeline is still outstanding — this remains the headline blocker called out in last week's audit.

### Carried-over infra (already merged before last audit, still listed in this week's range)
Chaos suite (Redis, Supabase storage, Stripe webhook storm, Postmark, Twilio, DB degradation), launch load suite runner, booking/payment/notification/availability load tests, and the Twilio transient-error retry classification fix (PR #49) — all from the prior audit window, re-surfaced here because they fall inside the 7-day git window.

**Net effect:** the team spent the week documenting and partially proving the same gaps identified on 2026-06-05, rather than closing them. Progress is real (runbooks exist now, alert routing is partially proven) but the launch-blocking items are largely the same ones as last week.

---

## Launch Readiness Scorecard

| Area | Status | Notes |
|---|---|---|
| App spec completeness | 🟡 Yellow | All 7 core features (Looks, Booking, Waitlist, Portfolio, Reviews, Calendar, Media) have corresponding pages under `app/` and API routes under `app/api/`; unchanged from last week — staging/E2E proof still incomplete |
| Tests | 🟢 Green | 314 test files spanning unit, integration, chaos, and load suites across booking, looks, notifications, privacy, security, and auth — strong coverage, unchanged from last week |
| TypeScript health | 🟢 Green | No `@ts-ignore`/`@ts-expect-error`/unguarded `as any` found in `app/` or `lib/` (only generated `.next/types` validators matched); `check:no-type-escape` script exists |
| Deployment checklist | 🟡 Yellow | `docs/deployment-checklist.md` still has every signup load-test evidence field blank (environment, date, commit, p50/p95/p99, error rate, dashboard link) |
| Security / auth | 🟢 Green | `requireUser`/`requireClient`/`requirePro` centralize auth in `lib/currentUser.ts` (77 references); `middleware.ts` enforces origin checks, CSRF-style state-change guards, and verification-path allowlists consistently |
| Error handling | 🟢 Green | Spot-checked routes (e.g. `bookings/finalize`) use structured `jsonOk`/`jsonFail`, idempotency guards, rate limiting, and `captureBookingException` for observability — consistent pattern |
| Environment / config | 🟡 Yellow | No live secrets found in source. One concern: `scripts/create-super-admin.ts` ships a hardcoded `DEFAULT_ADMIN_PASSWORD = 'password123'` fallback used when `ADMIN_PASSWORD` env var is unset — should require the env var explicitly rather than default to a guessable password |
| Dependencies | 🟢 Green | Next 16.1.1, React 19.2.0, Prisma 6.19.0, Stripe 22.1.0, Sentry 10.48 — current major versions, no obviously stale packages |
| Open TODOs in code | 🟢 Green | Only 6 string literals matching `TODO` in `app/`, all UI status-chip labels (`label={... ? 'DONE' : 'TODO'}`) in the Pro session/aftercare pages — not engineering debt |
| Live observability | 🔴 Red | Sentry intake proven in production; full alert routing is only **partially** proven (one test notification to Slack); dashboard sections still marked TODO LIVE PROOF |
| Deployed / staging proof | 🔴 Red | All Phase 2 verification (`verify:launch-ops`, chaos, load suites) is LOCAL-only; no staging/production proof beyond the one synthetic Sentry event |
| Launch ops ownership | 🔴 Red | Every new runbook explicitly lists `Backup owner: TODO — public rollout blocker`; go-no-go sign-off tables are entirely `TODO` for both private beta and public rollout |

---

## Specific Items Still Needed Before Launch

1. **Name a backup on-call owner.** All four new runbooks (auth-session, booking-funnel, pro-session-lifecycle, SLO/error-budget) and the deployment docs block on this. It is the single most repeated blocker in the codebase right now.
2. **Complete Sentry → Slack alert routing proof.** Move from "saved rule delivered one test notification" to a production-safe, app-generated synthetic alert with threshold, runbook link, and acknowledgement evidence recorded in `docs/launch-readiness/slack-alerts.md`.
3. **Fill in the deployment checklist load-test evidence fields** (`docs/deployment-checklist.md`): environment, date, commit, p50/p95/p99, error rate, 429 rate, dashboard link.
4. **Produce deployed/staging proof**, not just local proof, for `verify:launch-ops`, chaos suite, and load suite — go-no-go currently cites only commit `ae30aff` and `TODO` for environment/date/decision.
5. **Build live Sentry dashboard sections** for the launch-critical flows (booking funnel, health/readiness, auth/rate limits, payments/webhooks, infra dependencies, SLO/error budget) — `docs/runbooks/booking-funnel.md` lists every one of these as `TODO`.
6. **Replace the hardcoded admin password fallback** in `scripts/create-super-admin.ts` (`DEFAULT_ADMIN_PASSWORD = 'password123'`) with a hard requirement for `ADMIN_PASSWORD` to be set, especially since this script can run against any environment.
7. **Complete the go-no-go sign-off tables.** Both the private-beta and public-rollout decision blocks in `docs/launch-readiness/go-no-go.md` are still all-`TODO` for role, decision, date, and notes — including the still-unfilled "backup owner" row for public rollout.
8. **Define alert thresholds** referenced as TODO in `docs/runbooks/booking-funnel.md` (availability bootstrap error/latency spikes, hold-create 5xx/conflict spikes, booking finalize 5xx, conversion drop, rate-limit anomaly, dashboard no-data gap).

---

## Recommended Priorities for the Coming Week

1. **Stop reconciling docs against themselves and close one real gap.** This week's 28 commits were almost entirely documentation updates restating the same blockers from last week. Pick the single highest-leverage item — most likely the backup owner or the Sentry-Slack alert proof — and drive it to a recorded PASS with real evidence.
2. **Name the backup owner.** This single decision unblocks four runbooks and the public-rollout sign-off table simultaneously; it requires no engineering work, only a decision.
3. **Run one staging/production proof cycle** for `verify:launch-ops` and record the actual environment, commit, date, and output in `go-no-go.md` and `test-proof.md` — converting "local PASS" into "deployed PASS" is the biggest credibility gap in the current readiness story.
4. **Fix the `create-super-admin.ts` default password** — small change, real security hygiene win, and easy to land alongside the docs work.
5. **Fill the deployment-checklist load-test fields** the next time a staging load test is run, so the document stops shipping with blank evidence rows.

---

# Maintenance note

Per the standing rule in `docs/launch-readiness/checklist.md`: do not mark an item DONE because the file exists, and do not mark operational proof complete because a local test passed. This week added several well-written runbooks and reconciled docs, but did not move any 🔴 red item to 🟢 green. The launch-blocking surface is essentially unchanged from 2026-06-05 — the team should be cautious about doc-churn substituting for closing the actual gates.
