# TOVIS Weekly Audit — 2026-06-15

**Audited by:** Automated weekly audit
**Repo:** ~/Dev/tovis-app
**Audit commit baseline:** `8b3aa4a3` (HEAD on main)
**Previous audit baseline:** `ae1777b` (2026-06-14)
**Overall launch status:** 🟡 CONDITIONAL NO-GO — private beta within reach; public rollout still blocked

> Note: the 7-day window for this run (since 2026-06-08) overlaps the 2026-06-14 audit. To avoid double-counting, the "Week's Progress" section covers the full 7-day window, and a dedicated "New since the 2026-06-14 audit" subsection isolates the 54 commits that landed in the last day.

---

## Week's Progress Summary

**303 commits in the last 7 days** (~+37,300 / −12,600 lines). The week splits into five areas:

**Features.** Looks social (Following tab, real follower counts, new-follower notifications, OG cards, infinite-scroll/share-deep-link fixes); multi-location booking (location picker, per-location hours, location-level mobile radius); aftercare rebook flow (calendar popup, day/week/month stepping, services/prices summary, "Payment due" badge); pro verification-docs upload surface; signup overhaul (three-step pro wizard, inline validation, Turnstile fixes); pro onboarding checklist page; media consent gate before publishing session media.

**Fixes.** Cross-tenant Looks feed leak; NFC claim scoped to issuing tenant; frozen ELAPSED session timer; signed-upload POST→PUT bug; client-facing display names no longer leak pro login emails; Message CTA dead-ending at inbox; several e2e flakes (quarter-hour / near-midnight boundaries).

**Infra / launch ops.** Sentry→Slack synthetic alert routing proven in production; deployed health/readiness endpoints returning 200; Prisma `migrate deploy` wired into production Vercel builds + CI; Next.js 16.2 proxy-convention migration; unit-test + security-scan CI added with all dependency vulns cleared; `validate prod env at startup`; rate-limit IP derivation hardened against `x-forwarded-for` spoofing.

**Security / privacy.** Phone-at-rest encryption (foundation → dual-write expand → backfill script); Tier-3 health-notes encryption (consultation, allergy, pro-client notes) with fail-soft dual-write; safe next-URL validation centralized; admin password hardened to require a strong `ADMIN_PASSWORD`; legacy Supabase key fallback dropped.

**Refactors / tests.** A large duplication-consolidation sprint (PRs ~#125–165): record guards, env readers, money/units formatting, ID/string normalizers, idempotency lifecycle (`withRouteIdempotency`), conflict-engine unification with parity tests, route-context unification. Test suite is now ~381 source test files (excluding worktrees), with 137 of 195 API routes carrying colocated tests.

### New since the 2026-06-14 audit (54 commits)

- **Booking refund foundation** — new `BookingRefund` model + refund service (HEAD `8b3aa4a3`). First step toward refunds; not yet wired to Stripe or a client-facing flow.
- **Phone-at-rest encryption** — foundation helpers, dual-write expand phase, and a `backfill:phone-encryption` script.
- **Tier-3 notes encryption** — consultation, allergy, and pro-client notes now encrypted (expand phase); dual-write made fail-soft to fix a red main.
- **Launch-ops hardening** — SMS gated on config; production env validated at startup.
- **Rate-limit hardening** — IP derivation no longer trusts spoofable `x-forwarded-for`.
- **Prisma migrate deploy** on production Vercel builds; idempotency route wrapper (`withRouteIdempotency`) introduced and applied to the cancel route as a template.

---

## Launch Readiness Scorecard

| Area | Status | Notes |
|---|---|---|
| App spec coverage | 🟢 Green | All seven spec features have routes/pages (see matrix below). |
| Tests | 🟢 Green | ~381 test files; 137/195 API routes covered; e2e suite for signup + booking lifecycle; chaos + load suites present. |
| TypeScript health | 🟢 Green | `strict` + `noUncheckedIndexedAccess` + stricter flags on. **Zero** `@ts-ignore`/`@ts-expect-error`/`as any` in `app/`+`lib/` source. |
| Open TODOs | 🟢 Green | Zero real `TODO`/`FIXME`/`HACK`/`XXX` comments in source (the only "TODO" matches are UI status labels). |
| Security / auth | 🟢 Green | Auth centralized in `lib/currentUser` via `requireUser/requireClient/requirePro/getOptionalUser` (359 refs); proxy enforces verification gating + origin checks; admin routes delegate to a guarded moderation service. |
| Error handling | 🟢 Green | 175/195 API routes use `try/catch`; standardized `jsonFail` responses; retired endpoints return `410` with migration hints. |
| Secrets / config | 🟡 Yellow | No hardcoded secrets in source (only test fixtures); gitleaks configured; prod env validated at startup. **Gap: no committed `.env.example`** documenting required vars. |
| Dependencies | 🟢 Green | Current majors (Next 16.2, React 19.2, Prisma 6.19, Stripe 22, Supabase JS 2.90); security-scan CI in place; all known vulns cleared this cycle. |
| Deployment checklist | 🟡 Yellow | `docs/deployment-checklist.md` signup load-test section is **entirely blank** (env, date, commit, p50/p95/p99, error rate all unfilled). |
| Launch decision (go/no-go) | 🔴 Red (public) / 🟡 (private beta) | Public rollout blocked on named backup owner + tested P1 escalation + live dashboard/provider/rollback proof + signed decision. Private beta needs live dashboard evidence, deployed smoke proof for remaining flows, and support/rollback sign-off. |

### App-spec → implementation matrix

| Spec feature | Pages | API | Status |
|---|---|---|---|
| Looks feed | `(main)/looks`, `looks/[id]` | feed, like, save, comments, report, categories, pro CRUD, search, social-jobs | 🟢 |
| Booking (incl. from Looks) | client + pro booking pages, add-ons, session flow | bookings CRUD, cancel/reschedule/status, finalize, checkout, consultation | 🟢 |
| Waitlist | (no dedicated page) | `api/waitlist` | 🟡 join API exists; no standalone waitlist UI surface found |
| Portfolio | (filtered media view) | `pro/media/[id]/portfolio` | 🟡 toggle API exists; spec'd as a filtered MediaAssets view rather than its own route |
| Reviews | `pro/reviews` | client review CRUD + media, helpful, final-review | 🟢 |
| Calendar | `pro/calendar` | calendar, blocked-times CRUD, availability | 🟢 |
| Media | media pages (client/pro/new) | media url, upload, portfolio toggle, review media | 🟢 |

---

## Specific items still needed before launch

1. **Fill the deployment checklist load-test section** — `docs/deployment-checklist.md` has every signup load-test field blank. A passing local 30/30 signup proof exists in launch-readiness docs, but the staging/prod prelaunch run (peak target, p50/p95/p99, error rate, dashboard link) is not recorded. This is the only blank checklist gate.
2. **Add a committed `.env.example`** — env vars are validated at startup (`lib/env.ts`) but there is no single discoverable manifest of required variables. This is a real onboarding/deploy risk for a solo operator.
3. **Public-rollout blockers (per `go-no-go.md`)** — named backup owner (currently RISK-001, solo operator), tested P1 escalation path, live Sentry dashboard proof, provider proof, and a signed launch decision.
4. **Private-beta remaining proof** — live dashboard evidence, deployed smoke proof for remaining core flows, and support/rollback decisions.
5. **Close the new partial work** — booking refunds are a model + service only; decide whether refunds are in-scope for beta or explicitly deferred. Phone and Tier-3 notes encryption are in dual-write/expand phase — schedule the backfill + read-cutover (contract phase) before launch.
6. **Waitlist/Portfolio surfaces** — confirm whether the spec'd client-facing waitlist UI and portfolio grid are intentionally backend-only for beta; if not, they're the only spec features without a dedicated page.

## Recommended priorities for the coming week

1. **Run and record the staging signup load test** and fill the deployment checklist — smallest effort, clears a named gate.
2. **Commit `.env.example`** generated from `lib/env.ts` required reads — quick, de-risks deploy.
3. **Finish the phone + Tier-3 notes encryption rollout** (run backfills, then flip reads, then contract) so launch ships on a single source of truth, not dual-write.
4. **Decide refund scope for beta** and either wire `BookingRefund` to Stripe or mark it explicitly out-of-scope in the roadmap.
5. **Drive the private-beta go/no-go items to green** — live dashboard link, deployed smoke proof, support/rollback decision — since the engineering gates are largely closed.

---

*Methodology: `git log` over the trailing 7 days; static scans of `app/` and `lib/` (excluding `node_modules`, `.next`, and `.claude/worktrees`, which duplicate source and inflate raw counts); review of `docs/APP_SPEC.md`, `docs/deployment-checklist.md`, and `docs/launch-readiness/go-no-go.md`. No tests were executed in this run; the most recent recorded full-suite result (private-beta proof) was passing.*
