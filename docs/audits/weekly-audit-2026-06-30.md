# TOVIS Weekly Launch-Readiness Audit — 2026-06-30

_Automated weekly audit. Repo HEAD area: `main` in sync with `origin/main` (clean tree)._
_Window reviewed: commits from 2026-06-23 → 2026-06-30 (~108 merged PRs)._

---

## 1. Week in review

Very high velocity — roughly 108 squash-merged PRs across seven days, concentrated
almost entirely on **native/mobile readiness** (the iOS client). Grouped by area:

**Features (the bulk of the week)**
- **Native API surface (`/api/v1`)** — a large batch of read endpoints purpose-built
  for the native app: `pro/overview`, `pro/bookings`, `pro/clients`,
  `pro/clients/[id]/chart`, `pro/reviews`, `pro/aftercare`, `pro/last-minute/workspace`,
  `pro/services/catalog`, `pro/profile`, plus expanded `pro/bookings/[id]`.
- **Typed DTO / wire contract** — the API was frozen under `/api/v1` and a generated
  JSON-Schema wire contract added (auth, bookings, holds, availability, media, messaging,
  offerings, notifications, addresses, checkout), removing raw Prisma-payload leakage.
- **Push notifications** — `DeviceToken` model + `/devices` registration, PUSH channel
  fan-out into the notification engine, and APNs + FCM delivery providers with token
  invalidation.
- **Auth for native** — Sign in with Apple bridge, passwordless phone-OTP login,
  bearer-token auth path, per-device session revocation, native CSRF/Origin carve-out.
- **Live sync (web ⇄ iOS)** via focus/poll + Supabase Realtime; web client notification center.
- **Booking** — multiple co-equal BASE services per booking; consultation proof surfaced
  in pro session state.

**Fixes** — e2e de-flaking (mobile-chrome), fail-safe failed-login counter, calendar
Add-to-Calendar hrefs pointed at `/api/v1`, Looks feed/viral-requests fetch paths.

**Security** — closed log-redaction leaks (Tier 4.5 finish), email-encryption-at-rest
expand phase.

**Infra / CI** — e2e browser matrix fanned into parallel jobs, chromium-only on PRs /
full matrix on main, CI DB pool headroom.

**Docs** — mobile native-readiness handoff updates, premortem remediation tracking.

The prior two weeks' payments/notifications/privacy hardening (premortem Phases 1–8) has
largely landed; this week the center of gravity moved to shipping the native client.

---

## 2. Launch-readiness scorecard

| Area | Status | Notes |
|---|---|---|
| App-spec feature coverage | 🟢 Green | All 7 `APP_SPEC.md` features have routes + APIs (details below). |
| TypeScript health | 🟢 Green | 0 `@ts-ignore`/`@ts-expect-error`; 0 `as any` in non-test source. |
| Open TODO/FIXME/HACK/XXX | 🟢 Green | Zero in `app/` and `lib/`. |
| Test coverage | 🟢 Green | 521 test files; unit + integration + e2e + chaos suites. |
| Auth / authorization | 🟢 Green | Centralized in `lib/currentUser.ts`; consistent `require*` gates. |
| Error handling | 🟢 Green | 214/238 v1 routes wrap handlers in try/catch. |
| Secrets / config hygiene | 🟢 Green | No hardcoded secrets; `.env.example` (15KB) documents vars. |
| Dependencies | 🟢 Green | Current majors (Next 16, React 19, Prisma 6.19, Stripe 22). |
| Static guardrails | 🟢 Green | 12 `check:static-guards` enforcing house rules in CI. |
| **Deployed-staging load/smoke proof** | 🔴 Red | Only *local-dev* load proof exists; deployed proof is the launch blocker. |
| **Ops: backup owner + P1 escalation** | 🔴 Red | Solo operator, no named backup — explicit public-rollout blocker. |
| Live dashboard evidence | 🟡 Yellow | Sentry intake proven; live dashboard capture still outstanding. |
| Spec documentation freshness | 🟡 Yellow | `APP_SPEC.md` (dated May 4) under-documents the real 265-route surface. |

**Overall: launch decision remains NO-GO** — but the blockers are *operational proof*,
not code. Per `docs/launch-readiness/go-no-go.md` the code baseline is green and every
gate is intentionally held open until deployed evidence is linked.

---

## 3. App-spec → implementation map

Every feature in `APP_SPEC.md` is implemented:

| Spec feature | Page(s) | API |
|---|---|---|
| Looks feed | `app/(main)/looks` | `/api/v1/looks`, `/api/v1/search/looks`, `looks/[id]/{like,save,report,comments}` |
| Booking (incl. from Looks) | `app/booking/[id]` | `/api/v1/bookings`, `bookings/[id]/{cancel,reschedule,refund,status}`, `availability/*` |
| Waitlist | `app/pro/waitlist` | `/api/v1/waitlist`, `pro/waitlist`, `client/openings`, `priority-offer/*` |
| Portfolio | `app/p/[handle]`, `app/pro/media` | `pro/media/[id]/portfolio` |
| Reviews (with media) | `app/pro/reviews` | `client/reviews/[id]`, `reviews/[id]/media`, `reviews/[id]/helpful`, `pro/reviews` |
| Calendar | `app/pro/calendar` | `/api/v1/calendar`, `pro/calendar`, `pro/calendar/blocked` |
| Media (service-tagged) | `app/media/[id]` | `media/url`, `client/bookings/[id]/media`, media-consent |

The live surface has also grown well beyond the spec (admin console, NFC/claim, messaging,
referrals, memberships, calendar migration, push). That's a documentation gap, not a code
gap — see priorities.

---

## 4. Specific items still needed before launch

1. **Deployed-staging signup load proof** — the recorded run (`deployment-checklist.md`)
   is explicitly a *local `next dev`* proof. It surfaced a real finding: bcryptjs hashing
   serializes the event loop and saturates a single instance at ~20–25 rps. Rerun against a
   deployed staging build with a linked runtime dashboard, and confirm prod serverless
   function concurrency/sizing (or move hashing to a worker/native path).
2. **Exercise the actual `429` throttle path against prod** — the load run used a per-IP
   spread that intentionally never trips the limiter; the real throttle is still unverified
   in a deployed environment (deployment-checklist "Auth / trusted IP" section).
3. **Named backup owner + tested P1 escalation** — currently `NONE`; accepted for private
   beta but a hard public-rollout blocker in `go-no-go.md`.
4. **Live dashboard evidence** — Sentry intake is proven; capture the live Sentry/Upstash
   dashboard link required for deployed sign-off.
5. **Deployed smoke proof for remaining core flows** — booking lifecycle, checkout, and
   notifications beyond the health/readiness endpoints already passed.

## 5. Minor / housekeeping (non-blocking)

- **Stale worktree** `.claude/worktrees/client-bookings-dead-page/` duplicates ~300 source
  and test files (inflates greps/counts). Remove when its branch is done.
- **Large artifact in tree** `tovis updated-handoff-2.zip` (~5.6 MB) sits in the repo root —
  confirm it's gitignored, not tracked.
- **No `middleware.ts`** — auth runs at the route-handler layer via `lib/currentUser`
  (`requireUser/requireClient/requirePro/requireAdmin`), which the AuthVersion sweep verified
  is consistent. This is a deliberate pattern, not a gap — worth a one-line note in docs so
  future audits don't flag it.
- **Refresh `APP_SPEC.md`** to reflect admin, messaging, NFC/claim, referrals, memberships,
  and push, so the spec stays usable as the source-of-truth it's meant to be.

---

## 6. Recommended priorities for the coming week

1. **Close the deployed-staging proof loop** (items 4.1, 4.2, 4.4, 4.5) — this is the single
   thing standing between the green code baseline and a private-beta GO.
2. **Resolve the solo-operator ops risk** (4.3) — name a backup owner and run one tested P1
   escalation drill; this unblocks public rollout planning.
3. **Confirm prod signup concurrency sizing** given the bcrypt finding, before opening
   high-concurrency public traffic.
4. **Housekeeping**: prune the dead worktree, verify the zip is ignored, and refresh
   `APP_SPEC.md` — small, cheap, keeps the next audit clean.

_Nothing in the codebase itself is blocking. The remaining launch gates are operational
evidence, exactly as the go/no-go doc intends._
