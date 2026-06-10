# Canonical Modules

> Index of single-source-of-truth modules. If you are writing logic that
> belongs to one of these domains, use (or extend) the canonical module —
> do not re-implement it locally. Several of these are enforced by static
> guards that run in CI via `pnpm check:static-guards`
> (`.github/workflows/static-guards.yml`).

## Domain index

| Domain | Canonical module(s) | Enforced by |
|---|---|---|
| Booking lifecycle states/transitions | `lib/booking/lifecycleContract.ts` (see `docs/architecture/booking-lifecycle-contract.md`) | `tools/check-lifecycle-field-writes.mjs` |
| Booking mutations | `lib/booking/writeBoundary.ts` — all writes to lifecycle fields go through here | `tools/check-booking-write-boundary.mjs` |
| Consultation approval | `Booking.consultationApproval` + `consultationApprovalProof` (the `BookingConsultation` relation is legacy and forbidden for new code) | `tools/check-consultation-canonical.mjs` |
| Pro session flow + labels | `lib/proSession/sessionFlow.ts` (terminal checks, effective step, labels), `lib/proSession/closeoutChecklist.ts` | review |
| Pro session polling state | `lib/proSession/sessionState.ts` (snapshot + hash) served by `GET /api/pro/bookings/[id]/session/state`, consumed by `lib/proSession/useSessionState.ts` | review |
| Media URL rendering | `lib/media/renderUrls.ts` — raw stored URL fields never go to clients directly | `tools/check-media-render-boundary.mjs` |
| Contact normalization + lookup hashing | `lib/security/contactNormalization.ts`, `lib/security/crypto/hashLookup.ts` (HMAC v2) | `tools/check-canonical-normalization.mjs` |
| PII plaintext reads | accepted expand-phase baseline only; new reads of plaintext PII columns are forbidden | `tools/check-pii-plaintext-reads.mjs` |
| Address encryption | `lib/security/addressEncryption.ts` (AEAD `aes-256-gcm-v1`; legacy plaintext envelope is read-only burn-in) | `tools/check-pii-plaintext-reads.mjs` |
| Type-system escapes | `lib/typed/` (`globalRegistry`, `toPrismaJson`, `toRecord`) — the only place `as unknown as` / `as any` may exist in production code | `tools/check-no-type-escape.mjs` |
| Runtime narrowing helpers | `lib/guards.ts` (`isRecord`, `requireDefined`, …), `lib/pick.ts`, `lib/http.ts` (`safeJson`) | review |
| Auth gating in routes | `requireUser` / `requirePro` / `requireClient` (`app/api/_utils/auth/*`, backed by `lib/currentUser.ts`) | review |
| Route responses | `jsonOk` / `jsonFail` in `app/api/_utils/responses.ts` (`{ ok: true, ... }` envelope, `Cache-Control: no-store`) | review |
| Route idempotency | `app/api/_utils/idempotency.ts` + `lib/idempotency` (route registry) | review |
| Money parsing/formatting | `lib/money.ts` | review |
| Booking date/time + timezone truth | `lib/booking/dateTime.ts`, `lib/booking/timeZoneTruth.ts`, `lib/timeZone.ts` | review |
| Availability computation | `lib/availability/*` (see `docs/architecture/availability-drawer-enterprise-contract.md`) | perf CI (`perf-availability.yml`) |
| Avatar initials | `lib/initials.ts` | review |
| Client-home booking card display | `app/client/_components/bookingDisplay.ts` | review |
| Brand tokens/copy | `lib/brand/` (`BrandProvider`, `tokens.ts`, `brands/`, `forTenant.ts` for tenant-resolved branding) — no hardcoded brand strings outside it | `tools/check-no-hardcoded-brand-strings.mjs` |
| Safe logging | `lib/security/logging.ts` (`safeError`, `safeLogMeta`) — never log raw errors or PII | `tools/check-pii-plaintext-reads.mjs` (partial) |

"review" means there is no static guard yet; the module is canonical by
convention and code review. When a duplicate-logic bug shows up in one of
these domains, the fix is to add a guard script, not just patch the copy.

## Prisma is the source of truth

The Prisma schema (`prisma/schema.prisma`) is the single source of truth
for data shape. Derived read models (DTOs in `lib/dto`, search index rows,
session state snapshots) must be projections of Prisma rows — never
parallel hand-maintained state.

## TypeScript strictness status (2026-06-10)

Enabled in `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`.

Policy: indexed-access findings are fixed with runtime guards
(`requireDefined`, explicit `undefined` checks, `??` with a semantically
safe default) — not with non-null assertions or casts.

Deferred: `exactOptionalPropertyTypes` — 283 errors at the time of
evaluation. Enable it as a focused follow-up workstream: turn it on,
burn down errors module-by-module (start with `lib/`), and keep it out of
feature branches so the diff stays reviewable.
