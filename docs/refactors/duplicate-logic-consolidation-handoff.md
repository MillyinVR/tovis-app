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

Refreshed by a full re-audit on 2026-06-14 (5 parallel sweeps over `main` after
#125–#138 merged). All canonical modules above are holding — nothing regressed.
The re-audit found materially MORE than the first pass; the clean zero-risk sweeps
in Tier A were missed originally. Counts are approximate.

### Tier A — clean zero-risk sweeps (canonical already exists; isRecord-style)
Best effort/reward. Each is "delete N local copies, import the existing helper."
1. **`normalizeOptionalString` → `lib/guards.ts` `asTrimmedString`** — ~18 identical copies
   (`(v) => typeof v === 'string' ? (v.trim() || null) : null`). e.g.
   `lib/clientActions/policies.ts:29`, `lib/notifications/delivery/sendEmail.ts:59`
   (+ sendSms/sendInApp/completeDeliveryAttempt), `lib/booking/createProBookingWithClient.ts:129`,
   `lib/admin/auditLog.ts:77`.
2. **`errorMessageFromUnknown` / `getErrorMessage` → `lib/http.ts` `errorMessageFromUnknown`** —
   ~17 copies (7 are health checks: `lib/health/{stripe,postgres,storage,postmark,twilio,redis,checks}.ts`;
   plus `app/pro/profile/ReviewsPanel.tsx:48`, `OfferingManager.tsx:156`, `app/api/admin/permissions/route.ts:39`).
   Pass the per-site fallback as the 2nd arg.
3. **`trimToNull` / `trimOrNull` → `asTrimmedString`** — 5 copies
   (`lib/privacy/professionalDisplayName.ts:17`, `lib/profiles/publicProfileFormatting.ts:44`,
   `app/api/pro/offerings/route.ts:32` + `[id]/route.ts:39`, `app/api/admin/permissions/route.ts:34`).
   The `undefined`-passthrough variant needs one shared helper, not two private copies.
4. **`envOrThrow` → `lib/env.ts` `requireEnv`** — `lib/auth/passwordReset.ts`, `lib/auth/emailVerification.ts`
   (both already import `readOptionalEnv as envOrNull` from `lib/env`; just swap the throw helper). NB the
   thrown message changes ("Missing env var: X" → "Missing required environment variable: X") — check tests.
5. **Inline initials → `lib/initials.ts` `initialsForName`** — `app/messages/page.tsx:180`,
   `app/pro/calendar/_components/ManagementModal.tsx:284` (other surfaces already import it).
6. **`kmToMiles` → `lib/discovery/nearby.ts`** — `app/pro/locations/LocationsClient.tsx:52`,
   `app/api/pro/onboarding/location/route.ts:80` (`Math.round(km * 0.621371)`).

### Tier B — cleanup / correctness (small, high-value)
7. **DELETE dead webhook routes.** `app/api/webhooks/{postmark,twilio}/route.ts` reimplement
   signature verification + event parsing already in `lib/notifications/webhooks/*` — and the
   re-audit confirmed they're **unwired** (zero references; the live handlers are
   `app/api/internal/webhooks/...`; `sendSms.ts` points the Twilio callback at the internal route).
   Delete both routes + their `route.test.ts`, and fix the ~5 runbooks that cite the old paths.
8. **Upload-signing URL builder (latent bug).** `pro/uploads`, `client/uploads`,
   `viral-service-requests/upload`, `pro/media`, `admin/uploads` build the `media-public` URL inline
   **without** `encodeURIComponent` — unlike canonical `lib/media/renderUrls.ts` (which encodes each
   segment). Breaks on paths with spaces/unicode. Also `guessExtFromType` is duplicated and the
   `image/`+`video/`+30MB validation is copy-pasted. Extract `lib/media/signUpload.ts`
   (`guessExtFromType`, `MAX_UPLOAD_BYTES`, `assertUploadContentType`, `buildPublicObjectUrl`
   reusing the renderUrls encoder, `extractSignedUpload`).

### Tier C — mechanical, mid-size
9. **Booking policy scaffolding.** `WORKING_HOURS_ERROR_PREFIX` (×6), `getReadableWorkingHoursMessage`
   (×4), `mapSlotReadinessCodeToBookingCode` (×3), the `computedRequestedEnd` line, and the
   conflict-code→fail mapping are copy-pasted across `lib/booking/policies/{holdPolicy,finalizePolicy,
   reschedulePolicy,proSchedulingPolicy}.ts` (+ `slotReadiness.ts`, `writeBoundary.ts`). Extract
   `lib/booking/policies/_shared.ts`. Mechanical, no behavior change.
10. **Timezone helpers.** `localMinutesSinceMidnight`/`localDaySerial`/`offsetFromWindowStartDay`
    triplicated (`lib/booking/workingHoursGuard.ts`, `lib/scheduling/workingHours.ts` — byte-identical —
    and a re-impl in `lib/booking/slotReadiness.ts`); promote to `lib/timeZone.ts` (already exports
    `minutesSinceMidnightInTimeZone`/`getZonedParts`). Related: `lib/booking/dateTime.ts` has its own
    `Intl` part-extraction stack duplicating `lib/timeZone.ts` — re-base it. And a "first valid IANA TZ
    else UTC" resolver is hand-rolled ~6× in `writeBoundary.ts`/`timeZoneTruth.ts`/`locationContext.ts`
    instead of `pickTimeZoneOrNull`/`sanitizeTimeZone`.
11. **`professionalName`** (~6 files) — needs a **product decision**: client components use
    `businessName ?? handle ?? 'Professional'`; `app/api/calendar/route.ts` uses `?? email`; the existing
    `lib/privacy/professionalDisplayName.ts` uses `?? "first last"`. Pick one policy first. (Also a related
    `firstName + lastName` client-name helper is duplicated ~3×.)
12. **Per-route booking-id extraction** — `pickString(params.id)` / `asTrimmedString` / local
    `normalizeBookingId` / `getBookingIdFromContext` across ~15 booking routes, each with its own
    `BOOKING_ID_REQUIRED` fail. Fold into a `requireBookingId(ctx)` helper (pairs with #13).
13. **`RouteContext` type** — `type Ctx = { params: {id} | Promise<{id}> }` redeclared ~60×, three
    params-await styles, a `readParams` helper copied 5×. Export `RouteCtx<T>` + `resolveParams(ctx)`.
    Broad but low-value churn.
14. **Debug step/lead-time block** — identical `stepMinutes`/`leadTimeMinutes` debug-override resolution
    copied across `app/api/availability/{day,bootstrap,alternates}/route.ts`. Small.

### Tier D — high-risk (write parity/behavior tests FIRST, one PR each)
15. **Idempotency `withRouteIdempotency` wrapper** (~21 mutating routes) — they hand-wire
    `beginRouteIdempotency` / `isRouteIdempotencyHandled` / `completeRouteIdempotency` /
    `failStartedRouteIdempotency`. Forgetting the catch-side `failStarted` leaves records "in progress"
    → spurious 409s. A higher-order wrapper that owns the lifecycle prevents that, but it changes control
    flow on payment/booking paths. Tests first.
16. **Conflict-engine merge** — `findSchedulingConflicts` (`lib/booking/schedulingConflicts.ts`,
    `calculateWindowEnd` — no clamping, 0 fallback, no minute-normalize) vs `getTimeRangeConflict`
    (`lib/booking/conflictQueries.ts` → `bookingToBusyInterval`/`holdToBusyInterval` — clamps duration
    [15, 720] + buffer [0, 180], normalizes start to the minute). **Latent correctness bug:** the two
    paths can decide a slot oppositely (e.g. duration < 15 or sub-minute `scheduledFor`).
    `findSchedulingConflicts` has ONE caller (`writeBoundary.ts:4659`). Make it build intervals from the
    `conflicts.ts` helpers and delete `calculateWindowEnd`. Core write path — parity tests first.

### Tier E — rate-limit (only if explicitly scoped)
17. **Two rate-limit stacks.** `app/api/_utils/rateLimit.ts` (`enforceRateLimit`, returns a `Response`)
    is built **on top of** `lib/rateLimit/enforce` + `lib/rateLimit/response.ts` (`rateLimitExceededResponse`)
    + `lib/rateLimit/identity.ts` (`clientRateLimitKey`). ~9 routes call the lower-level stack directly,
    ~13 use `enforceRateLimit`. The core algorithm is already shared; the dup is the call-site idiom + the
    second response builder. An API-redesign on a correctness path — only with tests.

### Tier F — notifications
18. `lib/notifications/proNotifications.ts` ≈ `clientNotifications.ts` — the entire idempotent
    dedupe-upsert + dispatch state machine is mirrored, plus `norm*` helpers, `isUniqueConstraintError`,
    `normInternalHref`, `resolvePreferred*Phone`, `MAX_*` constants. Extract a generic
    `dedupeUpsertNotification(...)` + a shared field-norm module.
19. **Quiet-hours math** duplicated across `lib/notifications/channelPolicy.ts` and
    `delivery/runtimeChannelPolicy.ts` (`normalizeMinuteOfDay`, `channelUsesQuietHours`,
    `isWithinQuietHours`). Move to `lib/notifications/quietHours.ts`.
20. **Provider send-failure boilerplate** in `delivery/send{Email,Sms,InApp}.ts`
    (`buildConfigurationFailure`/`buildRequestFailure`/`buildThrownFailure` + norm helpers). Lowest impact.

### Tier G — frontend (Tier 3; largely untouched)
21. **Auth-redirect + form-submit state machine** (HIGHEST frontend impact). `currentPathWithQuery` /
    `sanitizeFrom` / `redirectToLogin` redefined in ~9 files; `errorFromResponse` in ~15; local
    `isAbortError` in 7; the abort+loading+error+`401→redirect`+"Please log in to continue." scaffold in
    ~12. A shared extraction already exists at `app/(main)/booking/AvailabilityDrawer/utils/authRedirect.ts`
    (drawer-only). Promote it to `lib/`, add a `useApiFormSubmit` hook, add `errorFromResponse` to
    `lib/http.ts` (built on `readErrorMessage`).
22. **Modal scaffolding** — no shared primitive; `keydown === 'Escape'` handler in ~20 files,
    `document.body.style.overflow` scroll-lock in ~28. Extract `useCloseOnEscape()` + `useBodyScrollLock()`
    (or a `<ModalShell>`).
23. **UI primitives** — `StatusPill` (×5), `SectionCard` (×6), `Pill` (×8, three byte-identical) redefined
    per page; local `statusTone` (×2) duplicates `app/pro/calendar/_utils/statusStyles.ts`. Add shared
    `components/ui` versions driven by `statusStyles.ts`.
24. **Inline `Intl.DateTimeFormat`** in ~28 components (many with the exact `formatAppointmentWhen` option
    set) instead of `lib/formatInTimeZone.ts`; `prettyWhen`/`formatWhen` are two re-impls of
    `formatAppointmentWhen`.
25. **Ad-hoc money formatters** (~8) and **local `safeJson` variants** (~4) instead of `lib/money.ts` /
    `lib/http.ts` — fold the AvailabilityDrawer's content-type-aware `safeJson` superset into `lib/http.ts`.

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
