# Scheduling-conflict audit — findings & fix plan

**Audit date:** 2026-07-21 · **Scope:** `tovis-app` + `tovis-ios`
**Question asked:** every way an appointment is booked or requested, and whether
each one checks the pro's real schedule (existing appointments, blocked time,
working hours).

Evidence for every claim below is a source read; the policy layer was also
exercised (`vitest run lib/booking/policies lib/booking/overlapPolicy.test.ts
lib/booking/conflictEngineParity.test.ts lib/booking/conflictQueries.test.ts
lib/booking/schedulingConflicts.test.ts` → 127 passing). iOS findings are code
reads only — **no simulator driving was done**.

---

## 0. How enforcement is structured today

Every appointment write funnels through `lib/booking/writeBoundary.ts`, enforced
by `tools/check-booking-write-boundary.mjs`. Four row-creating statements exist
in the whole repo (hold `:7400`, finalize `:8867`, pro-create `:9459`, rebook
`:10162`) and exactly two places move an existing appointment (`:7715`,
`:10900`).

Three layers guard them:

| Layer | Mechanism |
| --- | --- |
| Policy | `lib/booking/policies/{holdPolicy,finalizePolicy,reschedulePolicy,proSchedulingPolicy}.ts` |
| Lock | `pg_advisory_xact_lock` per professional (`lib/booking/scheduleLock.ts`) |
| DB backstop | GIST `EXCLUDE` on `Booking` + `BookingHold`, skipping `allowsOverlap` rows (migration `20260624020000`) |

`getTimeRangeConflict` (`lib/booking/conflictQueries.ts:555`) is the real schedule
check — **calendar blocks + bookings + holds** in one pass. Working hours come
from `ensureWithinWorkingHours` / `checkSlotReadiness`.

**iOS performs no enforcement of its own.** It is a pure client of these
endpoints; every finding is a server finding.

---

## 1. Entry-point matrix

✅ checked & fatal · ⚠️ allowed by design · ❌ not checked

| # | Path | Actor | Booked appts | Blocked time | Working hours |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /holds` → `POST /bookings/finalize` | client | ✅ ×2 | ✅ ×2 | ✅ ×2 |
| 2 | `POST /holds` → `POST /bookings/[id]/reschedule` | client | ✅ | ✅ | ✅ |
| 3 | Last-minute claim (`finalize` + `openingId`) | client | ✅ | ✅ | ✅ |
| 4 | `POST /api/v1/pro/bookings` | pro | ⚠️ pro may overlap | ✅ | ✅ unless override |
| 5 | `PATCH /api/v1/pro/bookings/[id]` (reschedule / drag / resize) | pro | ⚠️ | ✅ | ✅ unless override |
| 6 | `POST /pro/bookings/[id]/rebook` (BOOK) | pro | ⚠️ | ✅ | ✅ |
| 7 | `POST /pro/bookings/[id]/aftercare` (BOOKED mode) | pro | ⚠️ | ✅ | ✅ |
| 8 | `POST /client/bookings/[id]/aftercare-rebook` (CONFIRM) | client | ✅ | ✅ | ✅ |
| 9 | `POST /client/rebook/[token]` | token, no session | ✅ | ✅ | ✅ (step grid ❌) |
| 10 | `POST /pro/waitlist/[entryId]/offer` | pro | ✅ | ✅ | ❌ |
| 11 | `POST /client/waitlist-offers/[id]` (CONFIRM) | client | ✅ | ✅ | ✅ |
| 12 | Consultation approve ×3 routes (extends duration) | client / token / pro | ⚠️ | ❌ | ❌ |
| 13 | `POST /pro/migrate/calendar/commit` (ICS import) | pro | ⚠️ silent double-book | ✅ | bypassed by design |
| 14 | Hourly cron `migration/calendar-resync` | cron, unattended | ⚠️ silent double-book | ✅ | bypassed by design |
| 15 | `POST /pro/openings` (last-minute opening) | pro | ✅ no lock | ✅ no lock | ✅ |
| 16 | `POST/PATCH /pro/calendar/blocked` | pro | ✅ | ✅ | n/a (correct) |

Paths **1–3, 8, 11, 16 are clean**. Paths **4–7 are correct by design** —
`decideBookingOverlapPermission` grants pros `PRO_AUTHORIZED_OVERLAP` and stamps
`allowsOverlap: true` so the row leaves the GIST index; blocks stay fatal even
for pros. Both platforms show a soft, non-blocking "overlaps {client}" note
(`app/pro/bookings/new/NewBookingForm.tsx:1148`,
`ProCalendarGrid.overlappingClientNames`).

---

## 2. Fix queue

Ordered by risk. One PR per item unless noted.

### F1 — ICS calendar import silently double-books 🔴

`lib/migration/calendarImportServer.ts:333` calls `createProBooking` with no
`overlapActor`, so the actor defaults to `PRO` → any collision with an existing
Tovis appointment is *authorized*, not refused. The catch block at `:355` claims
collisions "hold the time as a block" — **that branch never fires for booking
collisions**. `app/api/internal/jobs/migration/calendar-resync/route.ts` runs
this hourly from a pro-supplied remote ICS URL with no human review.

**Fix.** A machine-driven import has no human authorizing a double-book, so make
the *source* refuse rather than the actor:

- `lib/booking/overlapPolicy.ts` — add `{ kind: 'CALENDAR_IMPORT' }` to
  `BookingOverlapSource` and `'IMPORT_OVERLAP_NOT_ALLOWED'` to
  `BookingOverlapBlockedCode`; refuse on conflict **before** the PRO/ADMIN
  branches (it is a property of the source, not the actor).
- `lib/booking/writeBoundary.ts` — `performLockedCreateProBooking` already
  receives `importMode`, so it selects the source itself; no new plumbing. Map
  the new code to `TIME_BOOKED` and widen the two local code unions.
- `lib/migration/calendarImportServer.ts` — the existing comment becomes true;
  correct its wording.

**Idempotency is safe:** the replay short-circuit
(`tryHydrateProBookingByIdempotency`, `writeBoundary.ts:9120`) runs *before* any
scheduling check, so an hourly resync of an already-imported UID never
re-evaluates overlap. A refused event becomes a UID-deduped `CalendarBlock`
(`createBlockIfAbsent`); the next resync hits `TIME_BLOCKED` and skips.

**Tests.** `lib/booking/overlapPolicy.test.ts`: CALENDAR_IMPORT refuses on
conflict for a PRO actor; passes clean with no conflict. Plus a write-boundary
test that an import collision throws instead of creating.

### F2 — Consultation approval extends past blocks and working hours 🔴

`writeBoundary.ts:8064` uses `findSchedulingConflicts`, which is **block-blind**,
and never re-checks working hours. A pro proposing extra services can push a 2pm
appointment through a 4pm calendar block or past closing. Reachable
unauthenticated via `POST /api/v1/public/consultation/[token]/decision`.

**Fix.** Swap to `getTimeRangeConflict` for the extended window; treat `BLOCKED`
as fatal (`TIME_BLOCKED`) and keep booking/hold conflicts as the existing
pro-authorized `allowsOverlap` path. Re-run `ensureWithinWorkingHours` on the
extended end; if extending past close is intended, make it an explicit override
rather than an absence.

### F3 — Retire the second conflict engine 🟠

`lib/booking/schedulingConflicts.ts` (`findSchedulingConflicts`, bookings+holds,
block-blind) vs `lib/booking/conflictQueries.ts` (`getTimeRangeConflict`,
blocks+bookings+holds). `conflictEngineParity.test.ts` reconciled their *interval
math* but not their *scope* — and that unreconciled scope gap is exactly F2.

**Fix.** Have `enforceBookingOverlapPolicy` call `getTimeRangeConflict`, ignoring
the `BLOCKED` verdict where the caller already gated it, then delete
`findSchedulingConflicts`. Do this **after** F2 so F2 ships without waiting on a
refactor.

### F4 — Public rebook token accepts off-grid times 🟠

`app/api/v1/client/rebook/[token]/route.ts:395` →
`performLockedCreateRebookedBooking` → `enforceProCreateScheduling`, and
`proSchedulingPolicy` deliberately makes `STEP_MISMATCH` non-fatal ("a pro may
pick ANY start minute"). But this is a **client** path;
`normalizeToMinute` is the only snapping, so a 10:07 booking fragments the pro's
grid for the rest of the day.

**Fix.** Add `deferStepToPro: boolean` to `evaluateProSchedulingDecision`. Pro
paths (#4–#7) keep the freedom; client-facing rebook (#9) gets grid alignment
back. Note the recommended-window constraint is also skipped unless
`rebookMode === RECOMMENDED_WINDOW` (`route.ts:198`) — confirm that is intended.

### F5 — Waitlist offer / confirm disagree on working hours 🟠

`createWaitlistOffer` (`writeBoundary.ts:14490`) checks blocks/bookings/holds but
not working hours; the client's confirm runs `performLockedCreateProBooking`
with `allowOutsideWorkingHours: false`. A pro can send an off-hours offer the
client physically cannot accept.

**Fix.** Pick one: check working hours at offer time, or pass
`allowOutsideWorkingHours: true` on confirm. Recommend the former — the offer is
the promise. Separately: no hold is placed between offer and confirm, so the slot
can evaporate (fails cleanly with `TIME_BOOKED`, but the offer was a promise) —
decide whether an offer should reserve.

### F6 — Last-minute opening creation has no advisory lock 🟠

`lib/lastMinute/commands/createLastMinuteOpening.ts` wraps its checks in
`$transaction` but never calls `lockProfessionalSchedule`, unlike every other
path. Under READ COMMITTED a concurrent booking is invisible → an opening
advertised over a just-booked slot. Not a double-book (the claim still goes
through holds→finalize), but a phantom deal.

**Fix.** Wrap in `withLockedProfessionalTransaction` **and** replace the inline
block/booking/hold queries (`:1073–1160`) with `getTimeRangeConflict`. Two birds.

### F7 — iOS: client MOBILE slots ignore the client's address 🟠

`Tovis/BookingFlowView.swift:453` omits `clientAddressId` from
`/availability/day` but sends it on `createHold` at `:486`. `booking.day()`
accepts the param, `ProOpenSlotPicker.swift:108` passes it, and web passes it
(`useDaySlots.ts:104`). Mobile slots are computed against the pro's base rather
than the client's travel radius, so an offered slot can be rejected at hold.

**Fix.** One-line iOS change; pairs with a parity note. Real web↔iOS gap.

### F8 — Pin the three "occupied statuses" definitions 🟡

| Source | Statuses |
| --- | --- |
| `BOOKING_BLOCKING_STATUSES` (`lib/booking/constants.ts:36`) | PENDING, ACCEPTED, IN_PROGRESS, **COMPLETED** |
| DB `EXCLUDE` predicate (migration `20260624020000`) | PENDING, ACCEPTED, IN_PROGRESS |
| `BUSY_STATUSES` (`app/api/v1/pro/availability/busy-days/route.ts:26`) | PENDING, ACCEPTED, IN_PROGRESS |

The app is *stricter* than the DB, so nothing unsafe slips through — but the
durable backstop covers only 3 of the 4 statuses the app claims to enforce, and a
session **completed early** still blocks its full original duration + buffer in
availability. Nothing pins these together.

**Fix.** Add a parity test asserting the three sets agree, then decide whether
COMPLETED should occupy future time at all. (`lib/looks/availabilityStats.ts:67`
holds a fourth copy used for ranking aggregates.)

### F9 — Duplicate-logic cleanup 🟡

| Helper | Copies |
| --- | --- |
| `makeWorkingHoursGuardMessage` + `parseWorkingHoursGuardMessage` | ×3 — `writeBoundary.ts:3904/3908`, `slotReadiness.ts:125/129`, `proSchedulingPolicy.ts:26/30` |
| `getReadableWorkingHoursMessage` | ×3 — `writeBoundary.ts:3927`, `reschedulePolicy.ts:69`, `finalizePolicy.ts:87` |
| `localMinutesSinceMidnight` / `localDaySerial` / `offsetFromWindowStartDay` | ×3 — `scheduling/workingHours.ts:127-161`, `workingHoursGuard.ts:31-43`, `slotReadiness.ts:180-196` |
| `decisionOk` / `decisionFail` | ×3 across policy files, while `policies/types.ts` already exports `policyOk`/`policyFail` (used only by `proSchedulingPolicy`) |
| `mapSlotReadinessFailure`, `mapSlotReadinessCodeToBookingCode` | ×2 each |
| `resolveRequestedDurationMinutes` | ×3 — availability `day:126`, `bootstrap:411`, `alternates:119` |
| `validateAvailabilityPlacement` + `resolveAvailabilityPlacement` | ×2 — `other-pros/route.ts:195/258` forks `availability/core/placement.ts:459/612` |
| `normalizeLocationBufferMinutes` | ×2 — the two `calendar/blocked` routes |
| `addDaysUtc` | ×3 — `clientBookingBuckets.ts:32`, `pro/calendar/route.ts:297`, `busy-days/route.ts:61` |

Plus the whole block/booking/hold overlap query re-implemented inline in
`createLastMinuteOpening.ts:1073` (folded into F6).

The `other-pros` fork matters more than it looks — that route is the unwired
server half of a wanted feature, so its copy of the placement logic keeps
drifting from the real one until it is wired up. **Do not delete the route.**

### F11 — the booking-overlap integration suite is dead 🟠

Found while trying to verify F1. `tests/integration/booking-overlap-concurrency.test.ts`
is 16 tests and the **only** end-to-end proof that the GIST `EXCLUDE`
constraints actually stop a concurrent double-book. Two problems:

1. **It runs in no CI workflow.** `test:integration` appears in `package.json:53`
   but in none of `.github/workflows/*.yml`. Nothing has exercised it in CI.
2. **`cleanupAll` has drifted behind the schema.** It deletes `Service` and
   `ClientProfile` without first clearing tables that FK them without a cascade.
   Confirmed blockers, in order hit: `ServicePermission_serviceId_fkey`, then
   `ClientAllergy_clientId_fkey` (there may be more behind those). The suite only
   passes against a DB that has *never* been seeded with `pnpm db:test:seed` —
   on a seeded DB all 16 tests fail in `beforeEach`.

**Fix.** Add the missing `deleteMany` calls (or switch `cleanupAll` to a
`TRUNCATE … CASCADE` over the fixture tables), then wire `test:integration` into
CI. The EXCLUDE constraints *are* present in the local test DB
(`Booking_no_active_professional_overlap`, `BookingHold_no_active_professional_overlap`
verified via psql), so the suite is meaningful once it runs.

**Once it ran, two more rot findings fell out** — both invisible for as long as
the suite has been dead:

- `tests/integration/register-signup.test.ts` `makeProBody()` never sent
  `licenseState`, which `app/api/v1/auth/register/route.ts:964` has since made
  mandatory for **every** pro (it drives the per-state service gate, not just
  license checks). All three pro-signup tests 400'd on `STATE_REQUIRED`. The
  route is right; the test was stale.
- The same file's duplicate-handle test built `dup_${tag.slice(-8)}`, but
  `isValidHandle()` allows only `[a-z0-9-]`. The underscore made the *first*
  signup fail, so the duplicate-handle path it exists to cover was never
  actually exercised.

**Useful side-evidence for F8:** the suite contains a test named *"database
allows active booking to overlap completed and cancelled bookings"* — so the DB
predicate excluding `COMPLETED` is deliberate and pinned. That makes
`BOOKING_BLOCKING_STATUSES` (which includes `COMPLETED`) the odd one out, and
F8 should probably resolve by dropping `COMPLETED` from the app constant rather
than adding it to the constraint.

### F10 — iOS follow-ups 🟢

- `Tovis/ProNewBookingView.swift:175` — calendar tap-to-create forces
  `manualMode = true`, so the pro's most-used create path never consults
  `/availability/day`. Server checks still apply.
- The two custom `DatePicker`s (`ProNewBookingView.swift:437`,
  `ProRescheduleView.swift:142`) are the only pickers in the app **not**
  `.environment(\.timeZone,…)`-pinned — a travelling pro enters device-local
  wall time.
- `Tovis/ProCalendarManagementSheet.swift:124` — waitlist "Offer a time" routes
  to `ProNewBookingView` and books directly instead of
  `POST /pro/waitlist/{id}/offer` used by `ProWaitlistView.swift:74`.
- `TovisKit/.../ProBookingService.swift:352` — `POST /pro/bookings/{id}/rebook`
  is fully implemented but unreachable from any view.

---

## 3. Not checked

Named honestly rather than assumed safe:

- **No runtime verification of the F1 double-book.** Traced through three call
  sites; not driven with a real ICS import.
- **No simulator driving on iOS.** All iOS findings are code reads.
- **Lock contention / transaction cost.** The advisory lock serialises all writes
  per professional inside a 20s transaction timeout; a busy pro's calendar-import
  commit loops `createProBooking` per event. Whether that can starve a live
  client booking is unmeasured.
- **`allowsOverlap` blast radius.** Once true the row leaves the GIST index
  permanently ("only ever raised here, never reset"). Whether a later reschedule
  of such a row can re-enter the constraint cleanly is untraced.

---

## 4. Status

| Item | State |
| --- | --- |
| F1 ICS import double-book | ✅ done — branch `fix/scheduling-conflict-audit` |
| F2 consultation extension | not started |
| F3 retire second engine | not started |
| F4 rebook token step grid | not started |
| F5 waitlist offer working hours | not started |
| F6 last-minute opening lock | not started |
| F7 iOS mobile slot address | not started |
| F8 occupied-status parity test | not started |
| F9 duplicate-logic cleanup | not started |
| F10 iOS follow-ups | not started |
| F11 integration suite dead | ✅ done — branch `fix/integration-suite-ci` |

### F11 — what shipped

- `tests/integration/booking-overlap-concurrency.test.ts` — `cleanupAll` replaced
  with a generated `TRUNCATE … RESTART IDENTITY CASCADE` over `pg_tables`, so it
  cannot drift behind the schema again.
- `tests/integration/register-signup.test.ts` — `licenseState: 'CA'` added to
  `makeProBody()`; duplicate-handle fixture made charset-valid.
- `vitest.integration.config.mts` — `server-only` alias, mirroring
  `vitest.config.mts` (without it the signup suite cannot even resolve).
- `package.json` — `test:integration:ci` (no `.env.test.local`, which is
  gitignored and absent in CI).
- `.github/workflows/integration.yml` — new job: Postgres 16 + PostGIS/pgvector,
  `prisma migrate deploy` (**never** `db push` — the EXCLUDE constraints live
  only in raw migration SQL), a guard step asserting both constraints exist,
  then the suite. No seed step: every suite builds its own fixtures and
  booking-overlap truncates between tests.
  The job holds **no credentials at all**:
  - PII keyrings + `JWT_SECRET` are generated per-run with `openssl rand` into
    `$GITHUB_ENV` (the first revision hardcoded throwaway keys, copying
    `perf-availability.yml`).
  - Postgres uses `POSTGRES_HOST_AUTH_METHOD: trust` with a passwordless
    connection URL. **This was the actual GitGuardian finding** — "Generic
    Password" on `POSTGRES_PASSWORD: postgres`, not the keyrings. A service
    container cannot take a value generated in a later step, so removing the
    credential entirely is the only fix that doesn't need a repo secret. The
    container is reachable only from the job's network and dies with the runner.

  Note for whoever picks up the grandfathered files: `e2e.yml` and
  `perf-availability.yml` both still hardcode the same throwaway keys **and**
  `POSTGRES_PASSWORD`. They pass only because GitGuardian scans diffs. The two
  techniques above apply to them verbatim.

**Verified:** 29/29 files, **134/134 tests** green — three ways: via the local
`.env.test.local` harness, against a freshly `migrate reset` + seeded DB, and
against an **empty migrated DB using the exact env and script the workflow runs**
(`test:integration:ci`). Constraint-guard SQL returns `2` as the step expects.
Workflow YAML parses. `typecheck` clean, `lint` 0 errors, guards pass.

**Not verified:** the workflow has not executed on a runner yet. The `psql`
invocation copies the proven pattern in `e2e.yml:157` (same `${DIRECT_URL%%\?*}`
strip), but `psql` is not on the local PATH so that one step is unrun locally.
Suite runtime locally is ~20s; CI wall time including install/migrate is
unmeasured.

### F1 — what shipped

- `lib/booking/overlapPolicy.ts` — `CALENDAR_IMPORT` source +
  `IMPORT_OVERLAP_NOT_ALLOWED` code; refuses before the PRO/ADMIN branches.
- `lib/booking/writeBoundary.ts` — source derived from `importMode` (no new
  parameter); both local code unions replaced with the exported
  `BookingOverlapBlockedCode`; stale `CreateProBookingArgs` comment corrected.
- `lib/migration/calendarImportServer.ts` — comments corrected; the catch block's
  claim about collisions is now true.
- Tests: 4 new in `overlapPolicy.test.ts` (real policy: refuses on booking
  conflict, on hold conflict, and for an ADMIN actor; allows when clean), 2 new
  in `writeBoundary.overlapPolicy.test.ts` pinning the derivation in both
  directions.

**Verified:** `typecheck` clean, `lint` 0 errors, `check:static-guards` all pass,
`vitest run lib/booking lib/migration` → 828 passing / 86 files.

**Not verified:** no real ICS import was driven end to end; the collision →
`CalendarBlock` fallback is a read, not a test (see F11 for why the integration
route was unavailable). Pre-existing overlapping rows created by earlier imports
keep `allowsOverlap = true` — this change is not retroactive. Whether the
migration feature flag (`isProMigrationEnabled`) is on in production is
unchecked.

---

## 5. Next-session prompt

Copy-paste this to continue the queue. (Session-chaining protocol: one queue
step per session; end with a completion report + the next prompt + a status
update to the table in §4.)

> Continue the scheduling-conflict audit queue in `tovis-app`. The full findings
> and fix plan are in `docs/design/scheduling-conflict-audit-fix-plan.md` — read
> it first, especially §4's status table and the "Not checked" list in §3.
>
> **F1 and F11 are done and merged** (#693, #694). **NEXT = F2.**
>
> F2: consultation approval extends an appointment's `totalDurationMinutes`
> using `findSchedulingConflicts` (`lib/booking/writeBoundary.ts:8064`), which is
> **block-blind**, and never re-checks working hours. So a pro proposing extra
> services can push a 2pm appointment straight through a 4pm calendar block or
> past closing time. It is reachable **unauthenticated** via
> `POST /api/v1/public/consultation/[token]/decision`, and also from the in-app
> client route and the pro's in-person decision route — three entry points, one
> shared code path.
>
> Suggested shape (verify before trusting it — the plan's own premises have not
> all survived contact): swap to `getTimeRangeConflict` for the extended window,
> treat `BLOCKED` as fatal (`TIME_BLOCKED`), keep booking/hold conflicts on the
> existing pro-authorized `allowsOverlap` path, and re-run
> `ensureWithinWorkingHours` on the extended end. If extending past close is
> intended, make it an explicit override rather than an absence — decide, don't
> inherit.
>
> Then consider **F3** (retire `findSchedulingConflicts` entirely, so the
> block-blind engine that caused F2 cannot cause it again). F2 first so it ships
> without waiting on the refactor.
>
> House rules that bit hard this session and are now in `CLAUDE.md`:
> **don't guess — read the tool's own output, or ask.** And when you add a guard,
> **prove it fails before trusting that it passes.**
>
> The integration suite is alive again and runs in CI, so you can now verify
> booking-overlap behaviour end to end: `pnpm test:integration` locally (needs
> the test-postgres container on :5433), or let `.github/workflows/integration.yml`
> run it on the PR.
>
> 🚫 Do not deploy. Runtime payload #686–#693 is merged and NOT live; that stays
> Tori's call.
