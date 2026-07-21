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
| 12 | Consultation approve ×3 routes (extends duration) | client / token / pro | ⚠️ | ✅ extension only (F2) | ❌ by decision → F12 |
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

**Fix.** Probe the block-aware engine for the extended window; treat `BLOCKED`
as fatal (`TIME_BLOCKED`) and keep booking/hold conflicts as the existing
pro-authorized `allowsOverlap` path. Working hours are a separate decision —
see F12.

> ✅ **Shipped.** Two of this card's premises were wrong and one extra hazard
> surfaced during implementation — see "F2 — what shipped" in §4 before reusing
> anything above.

### F12 — Consultation proposal is authored with zero schedule validation 🟠

Fell out of F2. `POST /api/v1/pro/bookings/[id]/consultation-proposal` performs
**no** scheduling check of any kind — it validates offerings, prices and session
step, then stores the proposal. The pro picks services without ever being told
what the resulting end time is or what it runs into.

That is also the only place the working-hours question can be answered. F2
deliberately does **not** enforce working hours at approval time (see its
decision note): the actor there is the client, mid-appointment, and
`OUTSIDE_WORKING_HOURS` is override-gated for the **pro** everywhere else in the
repo (`lib/booking/overridePrompts.ts`) — nobody on that path can grant the
override, so enforcing it would dead-end a live in-person approval.

**Fix.** At proposal time, compute the materialized end from the proposed items
and run the extension through the same two checks a pro create/reschedule gets:

- calendar block → fatal `TIME_BLOCKED` (blocks are never override-gated);
- past closing → 409 `OUTSIDE_WORKING_HOURS` carrying the existing
  `allowOutsideWorkingHours` override flag, so the pro confirms explicitly and
  the override lands in `BookingOverrideAuditLog` like every other one.

Needs the confirm-dialog wiring on **web + iOS** before the server side can ship
with the flag defaulting to false — otherwise pros hit a refusal with no UI to
clear it. Ship the two halves together.

### F3 — Retire the second conflict engine 🟠

`lib/booking/schedulingConflicts.ts` (`findSchedulingConflicts`, bookings+holds,
block-blind) vs `lib/booking/conflictQueries.ts` (`getTimeRangeConflict`,
blocks+bookings+holds). `conflictEngineParity.test.ts` reconciled their *interval
math* but not their *scope* — and that unreconciled scope gap is exactly F2.

**Fix.** ~~Have `enforceBookingOverlapPolicy` call `getTimeRangeConflict`,
ignoring the `BLOCKED` verdict where the caller already gated it, then delete
`findSchedulingConflicts`.~~ Do this **after** F2 so F2 ships without waiting on
a refactor.

> ⚠️ **That shape does not work — established by reading, 2026-07-21, before any
> code was written. Read this before starting.**
>
> **1. `getTimeRangeConflict` is not a drop-in.** It returns a single
> highest-priority code (`'BLOCKED' | 'BOOKING' | 'HOLD' | null`).
> `enforceBookingOverlapPolicy` (`writeBoundary.ts:5029`) needs the conflict
> **list**: `decideBookingOverlapPermission` takes
> `conflicts: readonly SchedulingConflict[]`, and the result drives both
> `allowsOverlap = decision.conflicts.length > 0` and the
> `conflictKinds` on `logOverlapDecisionBlocked`. A code loses both.
>
> **2. The overlap policy excludes blocks BY DESIGN, not by omission.**
> `SchedulingConflictKind` is `'BOOKING' | 'HOLD'` only. Blocks are gated
> earlier and separately, in `evaluateProSchedulingDecision`, which treats
> `BLOCKED` as fatal and then defers booking/hold to the overlap policy via
> `deferBusyConflictsToOverlapPolicy`. That separation is deliberate — see the
> comment on that flag. "Ignoring the BLOCKED verdict" would be re-deriving a
> gate that already exists one layer up.
>
> ⇒ The real consolidation is at the **query** layer, not the policy layer: give
> `conflictQueries.ts` a list-returning booking/hold conflict finder built on
> the same primitives `getTimeRangeConflict` uses, point
> `enforceBookingOverlapPolicy` at it, then delete `schedulingConflicts.ts`.
>
> **3. 🔴 A SECOND divergence this card never mentioned — possibly a live bug.**
> `conflictEngineParity.test.ts` reconciled only the **booking** path (Engine A's
> `toBookingSchedulingConflict` now delegates to `bookingToBusyInterval`). The
> **hold** path was never reconciled:
>
> | | hold with `endsAtSnapshot` = null AND `durationMinutesSnapshot` = null |
> | --- | --- |
> | Engine A (`calculateWindowEnd` → `sqlBusyWindowMinutes`) | `max(1, 0 + buffer)` — as little as **1 minute** |
> | Engine B (`holdRecordToBusyInterval`) | falls back to the offering's salon/mobile duration + location buffer — a real window |
>
> Engine A is the **write-boundary gate**. If such rows exist, the write
> boundary can book straight over a hold that availability correctly shows as
> busy. All three snapshot columns are nullable (`BookingHold.durationMinutesSnapshot`,
> `bufferMinutesSnapshot`, `endsAtSnapshot` are `Int?`/`DateTime?`).
>
> **NOT CHECKED — do this first:** whether any hold-create path can actually
> leave both null (several `durationMinutesSnapshot:` writes exist in
> `writeBoundary.ts`; they were not all traced), and whether any such rows exist
> in prod. If unreachable this is a latent trap to close during the refactor; if
> reachable it is a bug that outranks the refactor and should ship on its own.
> Extend the parity test to cover holds either way — that is the guard the
> booking path already has and the hold path never did.

> ✅ **Shipped.** The hold divergence was settled first and is **latent, not
> live** — it did not outrank the refactor. See "F3 — what shipped" in §4.

### F13 — the DB backstop refused silently, hiding gate regressions 🟠

Fell out of F3, where it cost a test. Overlap is enforced twice: the app gate
(`enforceBookingOverlapPolicy`) and the durable GIST `EXCLUDE`. **Both refuse
with `TIME_BOOKED`** — the catch maps 23P01 onto the same code — so from outside
they are indistinguishable.

The hold-create path has always logged its own backstop firing
(`prismaCode: '23P01'`, `conflictKind: 'overlap_range'`). The five **booking**
side catches did not log at all: consultation materialization, client finalize,
pro create, rebook, and pro update each just threw.

Consequence: if the gate ever stopped finding conflicts, **every client path
would keep refusing correctly — by Postgres — and nothing would say so.** The
`booking_conflict` trail would go quiet rather than wrong, and the only visible
symptom would be *pro double-books starting to fail*, a path nobody watches.
This is not hypothetical: an F3 integration test asserting a client-path
`TIME_BOOKED` refusal **passed with the conflict finder deliberately blinded**.

The advisory schedule lock serialises these writes, so a 23P01 on `Booking`
should be effectively unreachable. A nonzero rate is a bug, not background noise.

**Fix.** `logOverlapBackstopFired` next to `logOverlapDecisionBlocked`; all five
catches call it. Discriminator is `meta.layer = 'db_backstop'` plus
`note: 'db_overlap_backstop_fired'`. No behaviour change — same refusal, same
code, same client experience.

> ✅ **Shipped** — see "F13 — what shipped" in §4.

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

> ✅ **Shipped.** The premise held — this one was real, and driving it proved the
> off-grid booking actually commits without the fix. The card's *question*
> resolved in the code, so it never became Tori's: see "F4 — what shipped" in §4.

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
| F2 consultation extension | ✅ done — #699, + #700 (page) + #701 (uiAction), iOS #203 |
| F3 retire second engine | ✅ done — branch `fix/f3-retire-second-conflict-engine` |
| F4 rebook token step grid | ✅ done — branch `fix/f4-rebook-token-step-grid` |
| F5 waitlist offer working hours | not started |
| F6 last-minute opening lock | not started |
| F7 iOS mobile slot address | not started |
| F8 occupied-status parity test | not started |
| F9 duplicate-logic cleanup | not started |
| F10 iOS follow-ups | not started |
| F11 integration suite dead | ✅ done — branch `fix/integration-suite-ci` |
| F12 proposal-time validation | not started (opened by F2) |
| F13 backstop refused silently | ✅ done — branch `fix/f13-log-overlap-backstop` (opened by F3) |

### F4 — what shipped

**The premise survived — the first card in five that did.** Confirmed by reading
before writing, then by driving: with the fix reverted, an off-grid client
rebook does not merely pass the gate, it **commits a booking**
(`promise resolved "{ id: 'cmrv…' }" instead of rejecting`).

**But the card's question was not Tori's to answer — the code already answers
it.** `validateRecommendedWindow` (`route.ts:201`) returning early unless
`rebookMode === RECOMMENDED_WINDOW` is not a skipped check: the pro-side writer
(`app/api/v1/pro/bookings/[id]/aftercare/route.ts:519-610`) *refuses* to store
`rebookWindowStart`/`End` in any other mode — `NONE` rejects rebook dates
outright and `BOOKED_NEXT_APPOINTMENT` rejects the window pair by name. The
columns are non-null **iff** the mode is `RECOMMENDED_WINDOW`, so the guard is
exactly scoped and there is no window to enforce in the other modes. Nothing to
decide; no question raised.

**The real design question was elsewhere: WHO picked the minute.** Four call
sites reach the same gate through `performLockedCreateRebookedBooking`, and one
of them is a trap — `confirmClientAftercareNextAppointment` (#8) has
`clientId` set but books the **pro's** `rebookedFor`. Keying the new rule on
"is there a client" would refuse a minute only the pro can change, dead-ending
the client with a `PICK_NEW_SLOT` they cannot act on.

Shipped:

- `lib/booking/policies/proSchedulingPolicy.ts` — `enforceStepGrid: boolean`,
  **required, not defaulted**. It is wrong in both directions silently, so every
  call site has to state its intent; TypeScript found all of them.
  `STEP_MISMATCH` becomes fatal only when set, and fatally **early** — before
  the conflict query is spent.
- `lib/booking/writeBoundary.ts` — `startChosenBy: 'PRO' | 'CLIENT'` on
  `PerformLockedCreateRebookedBookingArgs` (the domain fact) mapping to
  `enforceStepGrid` (the policy consequence). `CLIENT` at exactly one call site:
  `createClientRebookedBookingFromAftercare`. The two previously-**dead**
  `case 'STEP_MISMATCH'` handlers in `enforceProCreateScheduling` /
  `enforceUpdateBookingScheduling` are now reachable — the create one is live.

**Safe against the UI by construction, not by luck.** Availability and the write
boundary both resolve `stepMinutes` / `workingHours` / `timeZone` through the
**same** `resolveValidatedBookingContext` (`lib/availability/core/placement.ts:476`
→ `lib/booking/locationContext.ts:293`), and `computeDaySlotsFast` steps its
candidates from `window.startMinutes` and then filters each through
`checkSlotReadiness` — the same `validateWorkingWindowStep` the new gate calls.
The client's own hold path has enforced this identical rule all along
(`holdPolicy.ts:187`), so the parity was already load-bearing in production.

**Verified. Every guard proven red first, five different ways:**

- `proSchedulingPolicy.test.ts` +2 — the refusal test reports
  `expected "spy" to not be called at all, but actually been called 1 times`
  when the branch is disabled; a second test pins that `enforceStepGrid` does
  not swallow `WORKING_HOURS_REQUIRED`.
- **`tests/integration/rebook-token-step-grid.test.ts` (new, 6 tests) drives the
  real write boundary against real Postgres.** Four of the six are the
  discriminating half — one per `enforceStepGrid: false` in the tree — because a
  refusal test proves nothing here and **over**-enforcement only ever shows up as
  a path that should succeed and doesn't. Each was proven red by flipping its
  own literal to `true`: pro rebook, pro create (#4), pro reschedule (#5), and
  the client's confirm of a pro-proposed off-grid time (#8) all fail with
  `Start time must be on a 15-minute boundary.`
- The "still books" case does **not** hand-pick a valid minute: it calls
  `computeDaySlotsFast` and books a slot the availability engine actually
  emitted, letting the write boundary re-resolve its own context from the
  database. That is the assertion that would catch a context divergence.

**Driven over real HTTP** (`pnpm dev:test-db`, seeded `AFTERCARE_ACCESS` token,
the actual route — not the function it calls):

- off-grid `14:07Z` → **400** `{"code":"STEP_MISMATCH","retryable":true,
  "uiAction":"PICK_NEW_SLOT","error":"Start time must be on a 15-minute
  boundary."}` — the #701 serializer carries it correctly;
- on-grid `14:00Z` → **201**, booking created, `rebookMode` flips to
  `BOOKED_NEXT_APPOINTMENT`;
- a second off-grid POST → **403**, the booked-at-save guard firing *before* the
  scheduling gate, as designed.

`typecheck` clean, `lint` 0 errors, all static guards pass, **704 files / 6853
unit tests**, **32 files / 154 integration tests** against real Postgres.

**Not verified / not checked:**

- **No browser and no simulator.** The refusal is unreachable through the web UI
  (the RebookCard only offers `/availability/day` slots) and iOS has no rebook-
  token flow at all — `grep -rn "client/rebook" ~/Dev/tovis-ios` returns nothing.
  The one UI path that *can* now hit it is a **stale page**: if the pro changes
  `stepMinutes` or their window start while the client's card is open, a slot
  that was valid at render becomes off-grid. That fails safe — 400 `retryable`,
  rendered inline by the card's existing error branch with the slot list still
  live — but it was reasoned about, not watched.
- **Not retroactive.** Bookings already sitting off-grid from this path stay
  where they are; nothing sweeps or snaps them.
- **The `enforceUpdateBookingScheduling` STEP_MISMATCH handler stays dead** —
  reachable only if someone flips that literal. Its test proves the literal, not
  the handler.
- **No measurement of the refusal rate in production.** Expected to be zero
  (only a crafted request or a stale page reaches it) but there is no counter,
  and the `booking_conflict` line with `conflictType: 'STEP_BOUNDARY'` is the
  only trace. Unlike F13's backstop this raises no Sentry alert — deliberately:
  a client-facing 400 that the client can retry is not a gate regression.

### F13 — what shipped

- `lib/booking/writeBoundary.ts` — `logOverlapBackstopFired`, called from all
  five booking-side 23P01 catches. Marks the refusal `layer: 'db_backstop'` so
  it is separable from an app-gate refusal, which logs an
  `overlapDecisionCode`. On the rebook path the source booking id goes to
  `meta.sourceBookingId`, not `bookingId` — that create has no row yet, and a
  reader would take `bookingId` for the conflicting row.
- **The client-path integration test is now discriminating.** `waitlist-offer`'s
  conflict test asserts the app gate refused (an `overlapDecisionCode` was
  logged) **and** that the backstop did not fire. That is the assertion that was
  missing: the previous version passed with the gate blinded.

**Verified, both directions:**

- The unit guard (`writeBoundary.overlapPolicy.test.ts`) fails before the fix
  with `expected "spy" to be called with arguments: [ ObjectContaining{…} ]` —
  note the `TIME_BOOKED` half of that test passes either way, which is precisely
  the point.
- The integration guard fails when the conflict finder is blinded
  (`expected false to be true`), where before it passed.
- `typecheck` clean, `lint` 0 errors, guards pass, 703 files / **6849** unit
  tests, 31 files / **148** integration tests.

**Alerting is wired.** `captureOverlapBackstopFired`
(`lib/observability/bookingEvents.ts`) raises an **error**-level Sentry event
tagged `booking.event = overlap_backstop_fired`, following the same shape as
`captureLifecycleDrift` / `captureStripeAmountMismatch`. Error, not warning,
even though no bad data is written — Postgres refused, the appointment is safe —
because the severity is about **detectability**: a gate that silently stopped
working is invisible on every client-facing surface, and nothing else pages
anyone. `captureMessage` is not affected by `tracesSampleRate`, and Sentry is
`enabled: Boolean(dsn)` (`sentry.server.config.ts`), so this is live wherever a
DSN is configured.

The structured log line stays where it was, emitted once by `logBookingConflict`
at the call site — the alert is added on top, not duplicated.

**Checked, not assumed:** `SENTRY_DSN` **and** `NEXT_PUBLIC_SENTRY_DSN` are both
present in the production Vercel environment (`vercel env ls production`), so
`enabled: Boolean(dsn)` resolves true and these events do reach Sentry in prod.
The project also drains Vercel logs to Sentry (`SENTRY_VERCEL_LOG_DRAIN_URL`),
so the structured `console.warn` line lands there as a second path.

**Routing: already covered — checked, and my own "no rule configured" note above
was wrong.** Sentry issue rule `10003547001` ("Notify #tovis-ops-alerts via
Slack") is **active**, scoped to project `tovis-app`, with `environment: null`
(all), **zero filters**, `actionMatch: any`, and
`FirstSeenEventCondition` among its conditions. Any *new issue* in this project
posts to Slack `#tovis-ops-alerts`. An error-level `captureMessage` opens a new
issue, so the first backstop firing routes to Slack with no new rule at all.

Grouping nuance: the message embeds `action` and `professionalId`, so Sentry
fingerprints one issue per distinct pair — each affected professional alerts
separately on first occurrence. With an expected rate of zero that is a feature,
not noise. Set an explicit fingerprint if that ever changes.

**A dedicated rule is scriptable if one is ever wanted** (verified, not assumed):
`POST https://sentry.io/api/0/projects/tovis/tovis-app/rules/` still accepts
writes — an empty-body probe returns `400 {"actionMatch":…,"frequency":…,
"name":["This field is required."]}`, while the **GET** on the same path is now
`410 This API no longer exists` (listing moved to
`/organizations/{org}/combined-rules/`). `SENTRY_AUTH_TOKEN` in
`.env.production.local` carries `alerts:write` + `project:admin`. The building
blocks are `sentry.rules.conditions.first_seen_event.FirstSeenEventCondition`
and `sentry.rules.filters.tagged_event.TaggedEventFilter` on key
`booking.event`, value `overlap_backstop_fired`.

### F3 — what shipped

**The hold divergence was settled first, and it is LATENT, not live.** It does
not outrank the refactor. Three independent reasons, each checked rather than
reasoned about:

1. **One production hold-create site exists** (`writeBoundary.ts:7405`, the only
   `bookingHold.create` outside tests/backfills), and it always writes
   `endsAtSnapshot: requestedEnd` and `durationMinutesSnapshot: durationMinutes`.
   Both are non-nullable upstream: `holdPolicy` types `requestedEnd` as `Date`,
   and `locationContext.ts:429` refuses when the mode duration is null.
2. **No update path can null them out.** The only `bookingHold.updateMany` moves
   `clientId` on a claim-merge; the address-encryption backfill touches address
   columns only.
3. **A both-null row could only predate migration `20260405070348`**, which added
   the three columns with **no backfill**. `HOLD_MINUTES = 10`, and both engines
   filter `expiresAt > now`, so every such row expired months ago. Confirmed
   against prod (`tovis-dev`): `BookingHold` holds **0 rows**, null or otherwise.

**A wider version of the same bug was found while pinning it, and IS fixed.** The
DB `EXCLUDE` for holds keys off `tovis_booking_overlap_range(scheduledFor,
durationMinutesSnapshot, bufferMinutesSnapshot)` — **not** `endsAtSnapshot`.
Engine B had no floor at all, so a hold with `durationMinutesSnapshot = 0` and
`bufferMinutesSnapshot = 0` produced a **zero-length** busy window where Postgres
reserves one minute — availability clearing a slot the database rejects with
23P01. Engine A's `max(1, …)` covered that and Engine B is the engine that
survived. `holdRecordToBusyInterval` now floors **every** branch to the SQL range.

Shipped:

- `lib/booking/conflictQueries.ts` — new `findBookingAndHoldConflicts`: the
  list-returning booking/hold finder the overlap policy needs, built on the same
  `bookingToBusyInterval` / `holdRecordToBusyInterval` primitives as every other
  conflict read. Blocks stay out of it by design (gated a layer up). No `take`
  default — a silently truncated conflict list at a write gate is a double-book.
  `holdRecordToBusyInterval` exported and floored to the DB range.
- `lib/booking/writeBoundary.ts` — `enforceBookingOverlapPolicy` and the
  consultation extension probe both moved onto it; the import of the retired
  engine is gone.
- `lib/booking/schedulingConflicts.ts` + its test — **deleted** (211 + 483 lines).
  `tools/baselines/no-type-escape.txt` shrinks by one entry with them.
- The consultation block probe now runs **before** `replaceBookingServiceItems`
  (the cheap follow-up F2 left open).

**Verified. Every new guard was proven to fail first:**

- `conflictEngineParity.test.ts` — rewritten around the invariant that outlives
  the deletion (runtime window >= DB floor, bookings **and** holds). Two cases go
  red without the floor: `expected 0 to be >= 1` (zero duration+buffer) and
  `expected 5 to be >= 75` (a short `endsAtSnapshot`).
- `busy-window-sql-parity.test.ts` now drives `holdRecordToBusyInterval` — the
  builder that actually ships — against the real SQL function, instead of the
  deleted `calculateWindowEnd`.
- The probe reorder is pinned by a new assertion in
  `writeBoundary.consultationMaterialization.test.ts`; swapping the two blocks
  back reports `expected "spy" to not be called at all, but actually been called
  1 times`.
- **3 new real-Postgres tests** in `booking-overlap-concurrency.test.ts` drive the
  finder itself. The null-snapshot one goes red when the builder is reverted to
  Engine A's math: `expected [] to deeply equal [ 'cmrv…' ]` — the 1-minute
  window misses the hold entirely.

⚠️ **A test that looked like proof and was not.** A waitlist-confirm test
asserting `TIME_BOOKED` on a taken slot passes *even with the conflict finder
blinded to return nothing* — the DB `EXCLUDE` catches the insert and the catch
maps 23P01 to the same code. On client paths the app gate and the durable
backstop are indistinguishable from outside. The test that **can** tell them
apart is the **pro double-book**: it must SUCCEED, and only succeeds if the gate
finds the conflict and stamps `allowsOverlap`. Blinded, it fails with "Requested
time already has a booking". That is the one in the suite now; the waitlist test
was kept with its limitation written into the comment.

`typecheck` clean, `lint` 0 errors, all static guards pass, **703 files / 6848
unit tests**, **31 files / 148 integration tests** against real Postgres.

**Not verified / not checked:**

- **No browser or simulator driving.** This change has no UI surface — it is a
  gate swap behind identical error codes — so nothing client-facing was expected
  to move. That is an argument, not an observation.
- **Lock-hold cost unmeasured.** The finder issues the same two queries the
  retired engine did (`Promise.all` rather than sequential, so if anything
  slightly shorter), but the hold query now joins `offering` and `location`.
  Inside the advisory lock, unmeasured — same gap as §3's lock-contention entry.
- **Removing the `take` cap is unbounded by construction.** The window is narrow
  (`[start − MAX_OTHER_OVERLAP, end)`) so the row count is small in practice, but
  no limit is enforced.
- The floor can extend a hold window by **up to 59 seconds** when `scheduledFor`
  carries seconds (`endsAtSnapshot` is built from a minute-floored start). The
  live route normalizes first (`app/api/v1/holds/route.ts:188`), so this is
  unreachable there; where it did fire it moves toward the DB, never away.
- **Local-harness correction:** `waitlist-offer.test.ts` needs `PII_AEAD_KEYS_JSON`
  keyed by **`address-aead-v1` / `email-aead-v1` / `phone-aead-v1` /
  `notes-aead-v1`** (plus `PII_LOOKUP_HMAC_KEYS_JSON` and `JWT_SECRET`) — not a
  single generic key. A wrongly-keyed ring fails with `Missing AEAD key for key
  version: address-aead-v1`, and takes `offering-revive-price-ramp.test.ts` down
  with it. Copy `.github/workflows/integration.yml:88`.

### F2 — the follow-ups that only turned up by LOOKING

The server fix (#699) was green on every test and still wrong in two places that
no test was watching. Both were found by driving the real thing.

- **#700 — the page called the refusal terminal.** #699 made the single-use link
  survive a refusal; `app/client/consultation/[token]/page.tsx` still replaced
  the whole view with *"Consultation link unavailable / ask your professional to
  resend the consultation link"* on ANY failed decision, and threw away both
  buttons. Recoverable server-side, presented as a dead end. Now branches on the
  envelope's `retryable` flag: retryable refusals render inline with the actions
  still live. Pinned by `tests/e2e/consultation-token-retryable-refusal.spec.ts`,
  which drives refuse → pro clears the block → retry-in-place → APPROVED.
- **#701 — `uiAction` never reached the wire.** TIME_BLOCKED advertises
  `PICK_NEW_SLOT`, which is right in the booking flow and meaningless on an
  approval. Two bugs: `getBookingErrorDescriptor` ignored the override entirely
  (widening the type compiled clean and did nothing), and all **37** route catch
  blocks hand-forwarded only `{ message, userMessage }`, re-deriving the rest
  from the catalog. New `bookingErrorJsonFail(error)` serializes the error
  itself; the 37 hand-forwards collapse into it.
- **iOS #203** — no app change was needed (both call sites already render
  `APIError.userMessage` inline), but the error path had **zero** test coverage:
  every existing case served 200. That gap had been hiding the fact that the
  in-app route returned a bare 500, so clients saw "Internal server error".

**Verified by driving, not by reading:** the public token route over real HTTP
(409 → link unused → clear block → same link → 200), the page in a real browser,
and **the iOS simulator** — the copy renders in ember inline with both buttons
live, and after the pro clears the block the retry lands and NEXT BOOKING shows
the materialized 3h / $180 appointment.

⚠️ Two traps worth carrying forward: `isFullyVerified` needs **both**
`emailVerifiedAt` and `phoneVerifiedAt` or every authed screen 403s
`VERIFICATION_REQUIRED`; and `scripts/sim-login.sh` picks the newest-runtime
simulator, which is not necessarily the one you booted — check
`xcrun simctl list devices booted` before screenshotting.

### F2 — what shipped

**Two of the card's premises did not survive.** Both are corrected in place
above; noting them here because each changed the fix.

1. *"a write path that skipped the schedule lock"* (the comment at
   `writeBoundary.ts:8102`) — **false**. All three decision routes hold the
   per-professional advisory lock: the two client paths via
   `withLockedClientOwnedBookingTransaction`, the pro path via
   `withLockedProfessionalTransaction`. Comment corrected.
2. *"treat BLOCKED as fatal"* over the **whole** materialized window would have
   been wrong. `createBlockIfAbsent` (`lib/migration/calendarImportServer.ts:237`)
   writes calendar blocks with **no** booking-conflict check — and after F1 an
   import collision *guarantees* a block laid over an existing booking. Probing
   the full window would refuse approvals for migrated pros over a pre-existing
   condition the client cannot act on. Only the **extension window**
   `[previousEnd, materializedEnd)` is probed; a proposal that doesn't grow the
   window is not probed at all.

**A third finding was discovered while implementing, and had to be fixed for
the refusal to be shippable:** consultation action tokens are `singleUse` and
were consumed *before* the transaction (`writeBoundary.ts:13395`). Any refusal
inside the write therefore burned the client's magic link permanently while
leaving the booking untouched — and `app/client/consultation/[token]/page.tsx`
swaps the whole view for an error, so the client dead-ends with no retry. This
already applied to the pre-existing `TIME_BOOKED` and `INVALID_SERVICE_ITEMS`
refusals; F2 would have added a third.

Shipped:

- `lib/booking/writeBoundary.ts` — `hasCalendarBlockConflict` probe over the
  extension window, fatal `TIME_BLOCKED` with consultation-specific copy;
  booking/hold conflicts left on the existing pro-authorized `allowsOverlap`
  path untouched (`findSchedulingConflicts` stays until F3 retires it);
  `locationId` added to `APPROVE_CONSULTATION_BOOKING_SELECT` because blocks are
  location-aware; stale lock comment corrected.
- `lib/consultation/clientActionTokens.ts` — new
  `resolveConsultationActionTokenTarget`, a read-only resolve that does not burn
  the link.
- `lib/booking/writeBoundary.ts` — both token wrappers (approve **and** reject)
  resolve first, then consume **inside** the locked transaction, so a refusal
  rolls the consumption back and the link survives.
- `app/api/v1/client/bookings/[id]/consultation/_decision.ts` — added the
  missing `isBookingError` branch. This route funnelled **every** booking error
  into an opaque 500, unlike its public-token and pro in-person siblings, so the
  new `TIME_BLOCKED` (and the pre-existing `TIME_BOOKED`) would have been
  unreadable to the client.

**Working hours: decided, not inherited.** Deliberately *not* enforced at
approval — reasoning in the code comment and in F12, which owns the real fix.

**Verified.** Every new test was proven to fail before it was trusted:

- `writeBoundary.consultationMaterialization.test.ts` +3 — the two
  behaviour tests go red with the probe removed; the narrowing test goes red
  when the window is widened to the full booking.
- `writeBoundary.approveConsultation.test.ts` +1 — the ordering test reports
  `expected [ 'token:consume' ] to deeply equal [ 'transaction:open', … ]`
  against the old code.
- `_decision.test.ts` +1 — reports `status: 500` vs the expected `409` without
  the mapping branch.
- **`tests/integration/consultation-extension-blocked.test.ts` (new, 3 tests)
  drives the real approval write against real Postgres** — no mocked conflict
  engine. With the fix removed the refusal test fails outright: the approval
  commits straight through the block. This is the runtime proof F1 could not
  claim. It also asserts the refusal leaves *nothing* half-written (duration,
  `allowsOverlap`, approval status and service items all roll back), which
  covers the `$transaction` return-vs-throw trap.
- Full local integration suite **31/31 files, 143/143 tests**; `vitest lib/booking
  lib/consultation app/api/v1/client/bookings app/api/v1/public` → 883 passing /
  87 files. `typecheck` clean, `lint` 0 errors, `check:static-guards` all pass.

**Not verified / not checked:**

- No browser or simulator driving — the client-facing copy for the new
  `TIME_BLOCKED` was not seen rendered on either platform.
- iOS was not touched and not read this session. Whether the iOS consultation
  screens render a 409 `TIME_BLOCKED` usefully (vs a generic failure) is
  unchecked.
- Moving the token consume inside the locked transaction adds ~3 queries to the
  advisory-lock hold. Consultation decisions are low-frequency so this was
  judged fine, but lock-hold time was not measured (same gap as §3's
  lock-contention entry).
- The block probe runs *after* `replaceBookingServiceItems`, so a refusal wastes
  those writes before rolling them back. Correct, but not free; moving it
  earlier is a cheap follow-up.
- **Local-harness gap, pre-existing, not from this change:**
  `tests/integration/waitlist-offer.test.ts` fails locally with
  `Missing required env PII_AEAD_KEYS_JSON`. Confirmed pre-existing by stashing
  all changes, and confirmed environmental by re-running with the key supplied
  (5/5 pass). `.github/workflows/integration.yml:88` generates the keyring per
  run, so CI is unaffected; only `scripts/with-test-db.mjs` (which reads just
  `.env.test.local`) lacks it.

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
> it first, especially §4's status table, **"F3 — what shipped"** and
> **"F13 — what shipped"** (both contain traps that cost real time), and the
> "Not checked" list in §3.
>
> **F1 ✅ #693, F11 ✅ #694, F2 ✅ #699 (+#700, #701, iOS #203), F3 ✅ #703,
> F13 ✅ #704. NEXT = F4.**
>
> ✅ **Everything through #704 is DEPLOYED** (2026-07-21, `tovis-npx5cy47p`, on
> Tori's explicit go-ahead). Migration `20260804000000` applied. Prod now runs the
> retired-engine refactor and the backstop logging, so from here a regression is a
> LIVE regression, not a staged one. **Deploy is still Tori's call every time** —
> do not infer standing permission from the last one.
>
> F3 retired the second conflict engine (`lib/booking/schedulingConflicts.ts` is
> gone; `enforceBookingOverlapPolicy` now shares `findBookingAndHoldConflicts`
> with every other conflict read). F13 fell out of it: the DB overlap backstop was
> refusing silently, so a gate regression would have been invisible. **If
> `booking.event = overlap_backstop_fired` ever appears in Slack
> `#tovis-ops-alerts`, drop everything — that is the F3 refactor breaking in
> production.** It has never fired; the path is proven by configuration, not by
> observation.
>
> ⚠️ **F4's card carries a premise AND a question.** It proposes adding
> `deferStepToPro` so the public rebook token stops accepting off-grid starts
> (`STEP_MISMATCH` is deliberately non-fatal for pros, and that route is a CLIENT
> path). **Confirm the premise before writing anything** — read
> `app/api/v1/client/rebook/[token]/route.ts:395` and `proSchedulingPolicy`, and
> check the refusal is genuinely reachable and genuinely skipped. **Five card
> premises have now died on contact** (F2 had three; F3's central one; and in F13
> I was wrong twice about my own work — see below). The card also asks something
> that is **Tori's call, not yours**: the recommended-window constraint is skipped
> unless `rebookMode === RECOMMENDED_WINDOW` (`route.ts:198`) — is that intended?
> Surface it with evidence when you reach it.
>
> **Tori wants the ENTIRE queue closed.** After F4 the remaining cards are F5, F6,
> F7 (iOS), F8, F9, F10 (iOS), F12. Two more carry decisions that are hers — F5
> (working hours at offer time vs allow at confirm; should an offer *reserve*?)
> and F8 (should COMPLETED occupy future time? — F11 found DB-side evidence the
> constraint excluding it is deliberate, so F8 probably resolves by dropping
> COMPLETED from `BOOKING_BLOCKING_STATUSES`) — and F12 needs UI on web **and**
> iOS before its server half can ship. Do not batch-ask them up front.
>
> **House rules that have bitten across six sessions**, all in `CLAUDE.md`:
>
> - **Don't guess — read the tool's own output, or ask.** In F13 the Sentry
>   endpoint I "remembered" was half-retired: `GET .../rules/` is now `410`, the
>   `POST` still works. A probe took one minute; the assumption would have been
>   wrong in both directions.
> - **Prove a guard fails before trusting that it passes.** Every guard in #703
>   and #704 was proven red first, four different ways (reverting the builder,
>   swapping the probe order, blinding the finder, removing the alert call).
> - **Verify the thing you are SHIPPING**, and **ask which LAYER made a test
>   pass.** This is the big one from F3. A real-Postgres test asserting a client
>   path refuses with `TIME_BOOKED` passed *with the conflict finder blinded* —
>   the database was doing the refusing. Overlap is enforced twice and both layers
>   surface the same code, so a green refusal test proves nothing about the gate.
>   The discriminating test is the **pro double-book**, which must SUCCEED and only
>   can if the gate finds the conflict. To isolate a permissive layer, test what it
>   should ALLOW — refusals are over-determined.
> - **Check your own "not verified" list before publishing it.** Twice in F13 I
>   wrote something off as unverifiable and it took one command: `SENTRY_DSN` is
>   set in prod (`vercel env ls production`), and the alert *already* routes to
>   Slack via an active catch-all issue rule. Both claims in my first draft were
>   wrong.
>
> Verification tools now proven and worth reusing:
> - `pnpm test:integration` (needs the test-postgres container on :5433).
>   ⚠️ it needs a keyring **in CI's exact shape** or two suites fail:
>   `PII_AEAD_KEYS_JSON` keyed by `address-aead-v1` / `email-aead-v1` /
>   `phone-aead-v1` / `notes-aead-v1`, plus `PII_LOOKUP_HMAC_KEYS_JSON` and
>   `JWT_SECRET`. A single generic key fails with `Missing AEAD key for key
>   version: address-aead-v1`. Copy `.github/workflows/integration.yml:88`.
> - `tests/integration/booking-overlap-concurrency.test.ts` is the pattern for
>   driving a real write-boundary path (incl. `createProBooking`) against real
>   Postgres. Gotcha: the pro-readiness gate needs `mobileBasePostalCode` +
>   `mobileRadiusMiles` on the profile whenever a bookable MOBILE_BASE exists,
>   which the shared fixture does not set.
> - `pnpm dev:test-db` runs a real server against the test DB — drive routes over
>   HTTP without touching dev data.
> - `tests/e2e/consultation-token-retryable-refusal.spec.ts` is the pattern for
>   driving a real page (seed → act → assert DB state → act again).
> - `~/Dev/tovis-ios/scripts/sim-login.sh --email <seeded user>` for the
>   simulator. Two traps: a seeded user needs BOTH `emailVerifiedAt` and
>   `phoneVerifiedAt` or every authed screen 403s `VERIFICATION_REQUIRED`, and the
>   script picks the newest-runtime device — check
>   `xcrun simctl list devices booted` before screenshotting. Taps need
>   `cliclick`, mapped through `group 1 of window 1` of Simulator.
> - Deploy verification (used 2026-07-21, reusable): `npx vercel --prod --yes`,
>   then check the REAL thing rather than the exit code — `vercel inspect`, the
>   live domain (`www.tovis.me`, note bare `tovis.me` 307s to it), the
>   `_prisma_migrations` row via the Supabase MCP, and unauthenticated POST probes
>   on the booking routes expecting 401/400 and **never** 500.
> - Observability: booking-domain alerts go through
>   `lib/observability/bookingEvents.ts` (Sentry + a structured log line). Sentry
>   is live in prod and an active catch-all rule routes every NEW issue in
>   `tovis-app` to Slack `#tovis-ops-alerts`. A dedicated rule is scriptable:
>   `POST /api/0/projects/tovis/tovis-app/rules/` (the GET is `410`; listing moved
>   to `/organizations/{org}/combined-rules/`), token in `.env.production.local`
>   has `alerts:write`.
