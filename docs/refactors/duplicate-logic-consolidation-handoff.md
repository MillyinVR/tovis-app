# Duplicate-logic consolidation — handoff

_Last updated: 2026-06-14. Started from a codebase-wide duplicate-logic audit; this
doc lets the next person (or session) continue without re-deriving context._

## Goal & standards

Remove duplicate logic by routing every duplicated helper through a single source
of truth. Hard standards for all changes here:

- **No type casts** (`as`) — narrow with type guards (`isRecord` from `lib/guards`) instead.
- **No `as any`** — ever.
- **No duplicate logic** — consolidate onto one canonical module.
- **Prisma is the single source of truth** — derive types from Prisma
  (`Prisma.XGetPayload<…>`, generated enums) rather than hand-redeclaring DB shapes.

Verify every change with `npm run typecheck` **and** the relevant `vitest` suites
(for broad sweeps, the full suite: `npx vitest run`). Typecheck alone is not enough
for route-handler refactors — see the #131 lesson below.

## Done (merged to `main`, PRs #125–#138)

Canonical modules now established (prefer these; don't re-duplicate):

| Concern | Single source of truth | PR |
|---|---|---|
| Booking blocking statuses | `lib/booking/constants.ts` → `BOOKING_BLOCKING_STATUSES` | #125 |
| Booking conflict math | `lib/booking/conflicts.ts` (`bookingToBusyInterval`, `holdToBusyInterval`, `overlaps`, `addMinutes`) | #125 |
| Internal-job auth | `app/api/_utils/auth/internalJob.ts` (`getInternalJobSecret`, `isAuthorizedJobRequest` — timing-safe) | #126 |
| Booking error responses | `app/api/_utils/bookingResponses.ts` → `bookingJsonFail` | #127, fix #131 |
| Handle normalization | `lib/handles.ts` (`normalizeHandle`, `isValidHandle`, `sanitizeHandleInput`, `HANDLE_MIN/MAX`) | #128 |
| `isRecord` guard | `lib/guards.ts` → `isRecord` (81 local copies removed) | #129, #130 |
| Money display | `lib/money.ts` → `formatMoneyFromUnknown` | #132 |
| Env reading | `lib/env.ts` → `readOptionalEnv`, `requireEnv` | #133 |
| sha256 / token gen | `lib/auth/timingSafe.ts` → `sha256Hex`, `generateTokenHex`, `timingSafeEqualUtf8` | #126, #133 |
| Query-param coercers | `lib/queryParams.ts` (`clampFloat`, `parseFloatParam`, `parseIntParam`, `parseCommaIds`, `toIntParam`) | #134 |
| Distance | `lib/discovery/nearby.ts` → `haversineMiles` (dedup'd) | #134 |
| App base URL | `lib/appUrl.ts` → `getAppUrlFromRequest` | #135 |
| JSON body parsing | `app/api/_utils/readJsonRecord.ts` → `readJsonRecord` (37 routes) | #137 |
| Soft/optional auth | `app/api/_utils/auth/getOptionalUser.ts`; action routes on `requireUser`/`requireClient` | #138 |

Correctness bugs fixed along the way: last-minute double-booking gap (#125),
handle charset accept/reject mismatch (#128), `isRecord` array-permitting variants
(#130), timing-safe job-secret comparison (#126), verification gating on
authenticated action routes (#138). #131 was a hotfix for a regression introduced
in #127 (see lesson below).

## Remaining backlog

Ordered roughly by value-to-risk. **None are clean mechanical sweeps anymore** —
each needs judgment or a decision.

### Bounded but needs a decision
1. **`professionalName`** (~6 files: 5 client components + `app/api/calendar/route.ts`).
   Three different fallback policies: client components use
   `businessName ?? handle ?? 'Professional'`; calendar uses `?? email`; the existing
   `lib/privacy/professionalDisplayName.ts` uses `?? "first last"`. Unifying changes
   display/privacy behavior → **product decision required** before consolidating.
2. **Inline initials → `lib/initials.ts` `initialsForName`** (e.g. `app/messages/page.tsx`,
   `ManagementModal`, `ProProfileCard`). Small; verify each inline version matches before swapping.
3. **`envOrThrow` → `requireEnv`** (`lib/auth/passwordReset.ts`, `lib/auth/emailVerification.ts`).
   Two copies, identical to `requireEnv` except the thrown message string ("Missing env var: X"
   vs "Missing required environment variable: X"). Trivial, but a test may pin the message.

### Larger / lower-value
4. **`RouteContext` type** — `type Ctx = { params: {id} | Promise<{id}> }` is redeclared ~45×,
   with three params-await styles (`await ctx.params`, `await context.params`,
   `await Promise.resolve(params)`). Pure ergonomic churn across many files; low value.

### High-risk — write parity/behavior tests FIRST, one PR each
5. **Idempotency `withRouteIdempotency` wrapper** (~46 routes). Each mutating route
   hand-wires `beginRouteIdempotency` / `isRouteIdempotencyHandled` / `completeRouteIdempotency`
   / `failStartedRouteIdempotency`. Forgetting the catch-side `failStarted` leaves records
   "in progress" → spurious 409s. A higher-order wrapper that owns the lifecycle prevents
   that, but it changes control flow on payment/booking paths. Add tests before refactoring.
6. **Conflict-engine merge.** `findSchedulingConflicts` (`lib/booking/schedulingConflicts.ts`,
   `calculateWindowEnd` — no clamping) vs `getTimeRangeConflict`
   (`lib/booking/conflictQueries.ts`, `bookingToBusyInterval` — clamps duration to [15, 720]
   and buffer to [0, 180]). They still differ in end-time clamping. Unifying touches the core
   booking write path (`writeBoundary.ts`); needs parity tests proving identical results first.

### Rate-limit (only if explicitly scoped)
7. **Two rate-limit stacks.** `app/api/_utils/rateLimit.ts` (`enforceRateLimit`, returns a
   `Response`) is built **on top of** `lib/rateLimit/enforce` + `lib/rateLimit/response.ts`
   (`rateLimitExceededResponse`) + `lib/rateLimit/identity.ts` (`clientRateLimitKey`). ~20
   routes call the lower-level stack directly. Unifying is an **API redesign on a
   correctness-sensitive path**, not a swap — only do it if deliberately scoped with tests.

### Notifications (Wave 5)
8. Legacy `app/api/webhooks/{postmark,twilio}/route.ts` reimplement signature verification +
   event parsing that already live in `lib/notifications/webhooks/*` — **first verify whether
   they're still wired up**; they may be deletable.
9. `lib/notifications/proNotifications.ts` and `clientNotifications.ts` are near-identical
   (shared dedupe-upsert + dispatch could be one generic).
10. Quiet-hours math duplicated across `channelPolicy.ts` and
    `delivery/runtimeChannelPolicy.ts` (`normalizeMinuteOfDay`, `isWithinQuietHours`).

## Working style that worked

- **One consolidation = one branch off `origin/main` = one PR.** Keep them independent and reviewable.
- **Delegate bulk mechanical edits to subagents** with an *exact per-file spec* (which helper,
  which import path, what to delete, what to skip-and-report). Then **independently verify**:
  grep for leftovers + `typecheck` + full suite + read the diff.
- **For auth/correctness-critical changes, do a hunk-by-hunk diff review yourself** (e.g. #138
  had no route tests, so the review was the safety net).
- Parallel subagents on the same branch race on their own `typecheck` runs (they see each
  other's partial edits) — **run typecheck centrally afterward**; that result is authoritative.

## Landmines (learned the hard way)

- **Barrel-mock pitfall (#131, #137).** Route tests do `vi.mock('@/app/api/_utils', () => ({ jsonFail, ... }))`
  — a *partial* mock of the barrel. A shared helper imported **from the barrel** becomes
  `undefined` in those tests. Two safe options: (a) import shared route helpers from their
  **specific path** (e.g. `@/app/api/_utils/readJsonRecord`), or (b) if the helper itself calls
  `jsonFail`, have it import `jsonFail` from the **barrel** so the test mock applies
  (that's what fixed `bookingResponses` in #131). Pick deliberately per case.
- **Typecheck ≠ tested.** #127 shipped green typecheck but broke 30 booking-route tests
  (assertions on the mocked `jsonFail`). For route-handler refactors, **run the route tests.**
- **Stacked-PR conflicts.** A PR branched before another merges can conflict on a shared file
  (e.g. #129 vs #128 both edited `app/api/pro/profile/route.ts` imports). Resolve by
  `git merge origin/main` into the branch and re-running checks. Mind merge order when two open
  PRs touch the same module.
- **Verification/session model (relevant to #138 and any auth work).** An `ACTIVE` session is
  only ever issued after full email+phone verification (`login`, `phone/verify`, `email/verify`,
  `verification/status` all gate `createActiveToken` on `isFullyVerified`; `register` issues no
  `ACTIVE` token). Not-yet-verified users hold a `VERIFICATION` session and are redirected to the
  verify screen by the app shells. So `requireUser()`/`requireClient()` gating (403 for
  non-`ACTIVE`/not-fully-verified) is defensive at the API layer, not a UI regression.

## Quick status check commands

```bash
gh pr list --state open --base main          # any open consolidation PRs
npm run typecheck && npx vitest run          # full green check
git log origin/main --oneline -15            # recent merges
```
