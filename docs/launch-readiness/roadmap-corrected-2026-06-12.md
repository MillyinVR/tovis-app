# Corrected launch roadmap — repo-accurate as of 2026-06-12

This supersedes the "12-month 100k + white-label SaaS plan" and the earlier
"platform-hardening" plan. Both were written against a **stale view of the
codebase**: they frame as upcoming Q1 work a set of foundations that are
already merged on `main` and enforced in CI.

This document records what an actual audit of the repo found, so planning stops
re-litigating finished work.

---

## What the old plans assumed was TODO but is already DONE

| Old-plan item | Actual state | Evidence |
|---|---|---|
| PII: "plaintext envelope still needs AEAD" | Real **AES-256-GCM** AEAD with AD binding, random nonces, auth tags | `lib/security/crypto/aead.ts`, `lib/security/addressEncryption.ts` (+ tests asserting no plaintext) |
| HMAC contact-hash v2 | Implemented, versioned keys, unique constraints | `lib/security/crypto/hashLookup.ts`, `User.emailHashV2` etc. |
| Encrypted booking address snapshot + backfill | Ciphertext written via writeBoundary; coarse lat/lng only in plaintext | `Booking.encryptedClientAddressSnapshotJson` |
| "Add a Tenant model + nullable cols + backfill" | **Tenant model exists; tenant columns are NOT NULL (contract phase complete)** | `prisma/schema.prisma:884`; `homeTenantId`/`proTenantId`/`clientHomeTenantId`/NfcCard.`tenantId` |
| Tenant visibility enforcement (was scheduled Q2) | Asymmetric filters implemented + tested: root sees all, white-label confined, fail-closed on NULL | `lib/tenant/visibility.ts`, `lib/tenant/resolveTenant.ts`, applied in search/calendar/pro-bookings/NFC |
| Pro session real-time refresh (polling) | Endpoint + hook + poller all shipped (5–10s, pauses hidden tab, stops on terminal state) | `app/api/pro/bookings/[id]/session/state/route.ts`, `lib/proSession/useSessionState.ts` |
| Type-escape CI guard + `lib/typed` | Exists; **0 `as any`, 0 `@ts-ignore`**, 32 `as unknown as` (3 sanctioned, 29 baselined tests) | `lib/typed/`, `tools/check-no-type-escape.mjs` |
| Brand-string scanner / PII-plaintext scanner / 9 architecture guards | All present and wired into `static-guards.yml` on every PR | `tools/check-*.mjs` (9 guards) |
| Stripe "PLATFORM_OWNED first, TENANT_OWNED later" | Already **Connect / tenant-owned** (pro accounts, destination charges) | `app/api/pro/payments/stripe/`, `ProfessionalPaymentSettings.stripeAccountId` |

Net: the white-label/PII/type/session/tenant foundation the old plans put in Q1
is **already in production-shaped form and CI-guarded.** Revised completeness
estimate: foundation ~complete; remaining work is scale-proof + a few isolated
hardening items, not greenfield architecture.

---

## What is GENUINELY still open (the real roadmap)

Ordered by what blocks a private beta.

### 1. Deployed staging load gate — THE launch blocker
Current proof (`docs/launch-readiness/local-load-proof-2026-06-12.md`) is
**local only**: clean availability p99 <100ms @ 50rps and rate-limiter shedding,
but booking-finalize/checkout/media were skipped (seed had 0 bookings) and it
never exercised production DB pooling.

The load harness (`tests/load/run-launch-load-suite.ts`, `pnpm test:load:launch`)
is **already built to target deployed staging** via `STAGING_BASE_URL`. It needs:
- a deployed staging env with pooled Postgres (Supabase pooler, read replica if planned)
- a seeded dataset containing real bookings (not the 12-slot dev seed)
- fixture env: `LOAD_TEST_PROFESSIONAL_ID`, `LOAD_TEST_SERVICE_ID`,
  `LOAD_TEST_CLIENT_COOKIE`, `LOAD_TEST_PRO_COOKIE`,
  `LOAD_TEST_CHECKOUT_BOOKING_ID`, `LOAD_TEST_MEDIA_BOOKING_ID`
- secrets: `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `TURNSTILE_TEST_TOKEN`
- **Define the traffic model + per-route p99 targets first** (the old plan's one
  correct criticism — "10k concurrent" is meaningless without a shape).

Done when: per-route p99 recorded for availability / day-slots / hold / finalize
/ checkout / session-state / media-metadata / webhook-ingest, each meets target
or has a ticketed bottleneck.

### 2. Cross-tenant isolation — there is a KNOWN LEAK, plus an untested matrix
Tenant columns exist on only **4 models** (Client/Pro/Booking/NfcCard). **MediaAsset,
LookPost, and Review are unattributed**, and the **looks feed has zero tenant
scoping**: `lib/looks/feed.ts` filters on publication-state only — the tenant guard
does not cover `lookPost.findMany`, so a white-label client can see other tenants'
look posts. **This is an active cross-tenant data leak and must be closed before any
white-label tenant goes live.**

Separately, visibility *filters* are unit-tested (`lib/tenant/visibility.test.ts`),
but there is no end-to-end matrix proving tenant A **cannot use** tenant B's action
token, media URL, or NFC claim path. Build that matrix. Treat both as a privacy
gate, not a feature.

### 3. Write-boundary expansion (architecture, non-blocking)
`lib/booking/writeBoundary.ts` is a 13,563-line single source of truth with a real
`lifecycleContract.ts`. **Media, auth, notifications, payments have no equivalent**
— payments live *inside* the booking boundary. Extract gradually
(`writeBoundary` + `contract` + `queries` per domain). Do **not** clone the 13k-line
god-file shape. Start with payments (highest blast radius).

### 4. Inngest / job-queue migration (infra, non-blocking)
7 Vercel cron routes in `vercel.json`; no queue installed. No longer blocks
anything (session refresh + encryption already shipped), so this is pure
reliability cleanup: retries, dead-letter, backpressure.

### 5. Small hardening
- Flip `exactOptionalPropertyTypes` (the one strict TS flag still off) and burn down fallout.
- Burn down the 4 remaining allowlisted hardcoded brand strings.
- Observability is Sentry-only — add per-tenant dashboards/metrics when WS-7 starts.
- Legacy plaintext address envelopes are read-path only (expand phase); schedule the
  contract-phase drop of legacy columns once backfill is confirmed.

---

## Sequencing

1. **Staging load gate** (item 1) — start now; it's the only thing between you and beta.
2. **Tenant isolation matrix** (item 2) — in parallel; small and self-contained.
3. Then, non-blocking: payments boundary extraction → Inngest → `exactOptionalPropertyTypes` → per-tenant dashboards.

White-label partner beta is gated on items 1 + 2 only.
