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
| 9 | `POST /client/rebook/[token]` | token, no session | ✅ | ✅ | ✅ (step grid ✅ F4) |
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

> ✅ **Shipped.** The premise held — only the second card in seven to survive
> contact. The direction question resolved in the repo, not with Tori; the
> reserve-the-slot question is still open and is genuinely Tori's. See
> "F5 — what shipped" in §4.

### F14 — A pro-CHOSEN time must reserve the slot 🔴

> **Tori's ruling, 2026-07-21, answering the question F5 left open:** *"if a pro
> chooses a time it should reserve the spot. if a pro gives a time window it
> shouldn't reserve a specific spot."*

The rule cuts cleanly along a distinction the schema already draws:

| proposal | reserves? | today |
| --- | --- | --- |
| Aftercare `BOOKED_NEXT_APPOINTMENT` (pro picks a slot) | **yes** | ✅ already books a real Booking at save (Tori, 2026-07-20) |
| Aftercare `RECOMMENDED_WINDOW` (pro gives a window) | **no** | ✅ nothing reserved — correct as-is |
| **Waitlist offer** (pro picks a slot) | **yes** | ❌ **nothing is reserved** |

So the only gap is the waitlist offer. It is a pro-chosen concrete time, and
between offer and confirm anyone can take it.

**Fix.** Place a `BookingHold` over the offered window inside
`createWaitlistOffer`'s existing locked transaction, and release it wherever the
offer stops being live (decline, supersede, expiry, confirm-consumes-it). A hold
— not a Booking — is the right primitive precisely because the waitlist client
*does* have something to confirm; the aftercare case books outright only because
there the client has nothing to accept.

**Carries a sub-decision Tori's ruling does not settle: how long.** Ordinary
holds are `HOLD_MINUTES = 10`, far too short for an offer a client may see hours
later. The `WaitlistOffer.expiresAt` column already exists, is honoured by
`assertConfirmableWaitlistOffer`, and **is never set by the pro route** — so
offers currently never expire at all, while the client-facing copy says *"before
it's gone"*. Pick one TTL and give it to both the offer and its hold. Propose a
default (24h is the obvious candidate), state it, and let Tori correct it —
don't open with the question.

⚠️ Reserving a slot takes it off the pro's own calendar too. Check what the pro
sees where a held-but-unconfirmed offer sits, and that a superseded offer
releases its hold before the replacement takes one (the partial unique index
supersedes inside the same transaction).

> ✅ **Shipped.** The premise was Tori's ruling, so it held — but the ⚠️ above
> found something worse than expected: the pro could see **nothing, anywhere**.
> See "F14 — what shipped" in §4.

### F15 — A stored client-visible time is never re-checked against the pro's schedule 🔴

> **Tori's rule, 2026-07-21:** *"if a time is outside a pro's working hours,
> blocked off by the pro, or already booked it shouldn't be visible to the client
> at all."*

**Where this already holds.** Every slot a client *picks* comes from
`computeDaySlotsFast`, which filters candidates through `checkSlotReadiness`
(working hours, advance notice, max-days, step) **and** the busy set from
`loadBusyIntervalsForWindow` — bookings, holds **and** calendar blocks. Checked,
not assumed. Nothing to do there.

**Where it does not.** Two surfaces show the client a time that was stored
earlier and is never re-validated at read time:

1. **The last-minute openings feed** (`/api/v1/client/openings`). It filters on
   the *opening row's own* state — `status: ACTIVE`, `bookedAt: null`,
   `cancelledAt: null`, `startAt >= now` — and never consults the pro's live
   schedule. And an opening only leaves `ACTIVE` when **that opening itself** is
   claimed (`writeBoundary.ts:8846`) or the pro cancels it by hand
   (`pro/openings/route.ts:418`, `:673`). Verified: there is **no** sweep that
   retires an opening when the slot is taken through the normal booking flow,
   blocked, or dropped out of newly-narrowed working hours. So a client can be
   shown — and can tap — a slot that is already gone. The claim still refuses
   (holds → finalize enforce everything), so it is not a double-book; it is
   exactly the visibility Tori's rule forbids.
2. **The waitlist offer card** (`/api/v1/client/waitlist-offers`) — filters on
   `status: PENDING` only. F14's hold closes the "someone else took it" half,
   but a pro who blocks that time or shortens their day afterwards still leaves
   a visible, unconfirmable card.

**Fix.** Filter these reads against the same live schedule availability uses,
rather than teaching every writer to sweep. `getTimeRangeConflict` /
`loadBusyIntervalsForWindow` already answer the question in one pass; the feed
knows the professional and window, so this is a read-side join, not a new engine.
Decide whether a dead row is *hidden* or *shown as expired* — hiding is what the
rule says, but a client who was notified about a slot may deserve to know it
went rather than have it vanish.

**This is distinct from F6 and both are needed.** F6 stops an opening being
*created* over a taken slot (write time); F15 stops one being *shown* after the
slot dies (read time). Neither subsumes the other.

> ✅ **Shipped.** The premise was Tori's own rule, so it held — but the card named
> **two** surfaces and there are **five**, and the fix had to answer a question the
> card did not ask (which gate commits each row). See "F15 — what shipped" in §4.

### F16 — a pro cannot tell that their own opening has gone dark 🟡 ✅

Fell out of F15, and **pre-dates it**: before F15 a dead opening was advertised to
clients and every claim failed; after F15 it is hidden. Either way the pro's own
list (`GET /api/v1/pro/openings`) shows it as plain `ACTIVE`, with no hint that it
is unadvertisable — and the pro is the only person who can fix it (re-open the
day, delete the block, cancel the opening).

Deliberately out of F15's scope because F15 makes the pro's information state no
**worse**: the same slot produced no bookings and no signal before. But the same
"ask who can fix this, and check they can SEE it" rule that F14 turned on
reservations applies here to disappearances.

**Fix.** Have the pro's opening list run the same `checkStoredSlotsAreOpen`
(`lib/booking/storedSlotLiveness.ts`) it already has all the fields for, and
return the verdict as a per-row status. Needs a badge on web **and** iOS —
"not visible to clients: that time is booked / blocked / outside your hours" —
so it is a two-platform card like F12.

> ✅ **Shipped.** The premise held. But the honest answer needed a state the card
> never named — a hold on the slot is a client mid-claim on THIS opening, i.e. the
> feature working — and wiring the check into the route introduced a 500-after-write
> of its own. See "F16 — what shipped" in §4.

### F6 — Last-minute opening creation has no advisory lock 🟠

`lib/lastMinute/commands/createLastMinuteOpening.ts` wraps its checks in
`$transaction` but never calls `lockProfessionalSchedule`, unlike every other
path. Under READ COMMITTED a concurrent booking is invisible → an opening
advertised over a just-booked slot. Not a double-book (the claim still goes
through holds→finalize), but a phantom deal.

**Fix.** Wrap in `withLockedProfessionalTransaction` **and** replace the inline
block/booking/hold queries (`:1073–1160`) with `getTimeRangeConflict`. Two birds.

> ✅ **Shipped.** The premise held on both halves — and the second half was not
> the refactor the card called it: the inline hold math and the shared reader
> **disagree**, so the swap fixed a second, unrelated bug. See "F6 — what
> shipped" in §4.

### F7 — iOS: client MOBILE booking was dead on arrival 🔴 (was 🟠)

**The card's premise was wrong, and the truth is worse.** It read as a precision
bug — "mobile slots are computed against the pro's base rather than the client's
travel radius, so an offered slot can be rejected at hold". There is no such
fallback. `validateAvailabilityPlacement` (`lib/availability/core/placement.ts:502-510`)
refuses a MOBILE placement outright when `clientAddressId` is absent:

```
CLIENT_SERVICE_ADDRESS_REQUIRED → HTTP 400
```

Both `/availability/bootstrap` and `/availability/day` route through it, so the
whole flow died at the FIRST call. Driven against `pnpm dev` on 2026-07-22:

| request | result |
| --- | --- |
| `bootstrap?…&locationType=MOBILE` (what iOS sent) | **400** `CLIENT_SERVICE_ADDRESS_REQUIRED` |
| `bootstrap?…&locationType=MOBILE&clientAddressId=…` | 200 |
| `day?…&locationType=MOBILE` (what iOS sent) | **400** |
| `day?…&locationType=MOBILE&clientAddressId=…` | 200, 14 slots |

The card also aimed at the wrong call. `booking.day()` already accepted the
param; **`booking.bootstrap()` had no `clientAddressId` parameter at all**, and
bootstrap runs first. Worse, iOS only loaded the client's addresses *after* a
successful bootstrap, so a client who HAD a saved address could never reach the
picker: tapping "Mobile (they come to you)" replaced the entire sheet with
"Add or select a mobile service address before booking this in-home appointment"
and a "Try again" that re-fired the same doomed request. **Confirmed on the
simulator** — screenshot + a `400` in the dev log. Client-side MOBILE booking on
iOS was 100% impossible, and so was a MOBILE reschedule.

Web never hit this because `useAvailability`'s `canFetch` withholds the request
until an address is chosen (`useAvailability.ts:242-248`); the address is an
INPUT to availability there, not a later step.

**Fix (iOS #206).** Mirror web's gate: `bootstrap` gains `clientAddressId`;
`BookingFlowView` loads addresses *before* asking for availability, withholds the
request when MOBILE has none, and passes the address to bootstrap AND day — the
same one `createHold` already sent, so the offer and the hold now agree.

**Second live bug, found only by driving it.** With MOBILE reachable, switching
modes kept the previous mode's times on screen: `form`'s `.task { if slots.isEmpty }`
saw a full list and skipped the reload, so salon's 15-minute grid rendered under
Mobile — bookable, and refusable at hold. Unreachable before (MOBILE always
failed), live the moment this card's fix landed. `loadBootstrap` now clears
`slots`/`selectedSlot`, since every reload means the placement changed. Unit
tests were green across both defects; only the screenshot showed them.

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

> ✅ **Shipped.** Every premise held (only the line numbers had drifted). The
> decision went the way the doc did **not** predict: Tori ruled COMPLETED **does**
> occupy its time, so the database moved to the app rather than the reverse. See
> "F8 — what shipped" in §4.

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

~~Plus the whole block/booking/hold overlap query re-implemented inline in
`createLastMinuteOpening.ts:1073`~~ — ✅ **done with F6 (#716)**, and it was not a
tidy-up: that copy had drifted from the shared reader and mis-sized holds. Treat
the rest of this table the same way — a "duplicate" that has drifted is a bug
report, so diff the copies before assuming either one is correct.

The `other-pros` fork matters more than it looks — that route is the unwired
server half of a wanted feature, so its copy of the placement logic keeps
drifting from the real one until it is wired up. **Do not delete the route.**

> ✅ **Shipped.** Eleven of the table's rows were diffed; **two premises did not
> survive**, one row was a **real bug** and the `other-pros` warning above proved
> exactly right. See "F9 — what shipped" in §4.

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

**Side-evidence for F8 — and it pointed the wrong way.** The suite contained a
test named *"database allows active booking to overlap completed and cancelled
bookings"*, which read as proof that excluding `COMPLETED` from the predicate was
deliberate, and suggested F8 resolve by dropping `COMPLETED` from the app
constant. ~~That is what this section originally recommended.~~ It did not
survive contact: a pinned test records what someone *once wrote*, not what the
product *wants*, and nothing in it weighed the pro's post-service buffer against
a 15-minute default advance notice. Tori ruled the other way and the constraint
was widened instead (#717); that test now covers CANCELLED and NO_SHOW only. Read
"F8 — what shipped" in §4 before citing this paragraph for anything.

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
- ~~**No simulator driving on iOS.**~~ Superseded: F5, F14, F15 and F7 each drove
  the simulator, and both F14's and F7's passes caught defects no test could see.
  The remaining iOS card (F10) is still a code read.
- **Read-time liveness cost under real concurrency (F15).** The five client feeds
  now run ~3 indexed conflict queries per row shown, 8 in flight at a time.
  Measured locally: ~0.9ms per row, ~18ms at 20 rows, projecting to ~45ms at a
  feed's `take: 50` ceiling. **Not** measured against a pooled prod connection
  with concurrent traffic, which is where a per-request query fan-out actually
  bites. Needs a deploy (Tori's call) or a staging run; `tests/load/` is the
  harness. Sizing note from the last staging proof: throughput there ceilinged
  around **40rps** on the free-tier pooler (connection exhaustion), so the thing
  to watch is pool saturation from the added fan-out, not per-request latency.
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
| F1 ICS import double-book | ✅ done — #693 |
| F2 consultation extension | ✅ done — #699, + #700 (page) + #701 (uiAction), iOS #203 |
| F3 retire second engine | ✅ done — #703 |
| F4 rebook token step grid | ✅ done — #705 |
| F5 waitlist offer working hours | ✅ done — #710 (+ iOS #204) |
| F6 last-minute opening lock | ✅ done — #716 (also fixed a hold-window gap the card thought was a refactor) |
| F14 pro-chosen time must reserve | ✅ done — #713 (+ iOS #205) |
| F15 stored client-visible time not re-checked | ✅ done — #714 (**Tori rule 2026-07-21**) |
| F16 pro can't see their opening went dark | ✅ done — #721 (+ iOS #208) (**premise held**; the fix opened a 500-after-write of its own, caught in review) |
| F7 iOS mobile slot address | ✅ done — iOS #206 (**premise was wrong**: not imprecise slots, a 400 that killed the whole MOBILE flow; fix caught a second, stale-slot bug on the simulator) |
| F8 occupied-status parity test | ✅ done — #717 (**Tori ruling 2026-07-21**; carries migration `20260806000000`) |
| F9 duplicate-logic cleanup | ✅ done — #719 (**found a live DST bug**; 2 premises died; `other-pros` deferred with evidence) |
| F10 iOS follow-ups | not started |
| F11 integration suite dead | ✅ done — #694 |
| F12 proposal-time validation | not started (opened by F2) |
| F13 backstop refused silently | ✅ done — #704 (opened by F3) |

### F9 — what shipped

**A 🟡 tidy-up card contained a live bug.** F6 taught this exact lesson and F9's
own header repeats it, so every row was diffed before anything moved. The result:
seven rows were genuinely identical and collapsed mechanically, **two premises
were wrong**, one row was **not a duplicate at all but a DST defect**, and the
`other-pros` row is real drift that is deliberately *not* fixed here.

**🔴 The real find: the pro's "blocked hours today" was wrong on DST days.**
`app/api/v1/pro/calendar/route.ts` built the today-window as
`startOfDayUtcInTimeZone(now, tz)` then `+ 86_400_000ms`. A local day is **23
hours** on the spring transition and **25** on the autumn one, so that boundary
landed at 01:00 the next day or 23:00 the same day. Measured with the real
helpers, `America/Los_Angeles`:

| date | naive `+24h` boundary | true next local midnight | effect |
| --- | --- | --- | --- |
| 2026-03-08 (spring) | 2026-03-09 **01:00** local | 2026-03-09 00:00 | counted **tomorrow's** first hour as today |
| 2026-11-01 (autumn) | 2026-11-01 **23:00** local | 2026-11-02 00:00 | **dropped** today's last hour |
| 2026-06-10 (ordinary) | 00:00 | 00:00 | correct |

Twice a year, for every pro in a DST zone, `stats.blockedHours` and the
Management panel's `blockedToday` list counted the wrong blocks. Not a
double-book — a wrong number on a screen the pro plans their day from.

**The fix is a shared primitive, not a patch.** `startOfDayUtcInTimeZone` gains
an optional `dayOffset` that steps whole LOCAL days through the calendar parts
(via the `addDaysToYMD` that already lived in `lib/timeZone.ts`). Existing
two-argument callers are byte-identical — `dayOffset` defaults to `0` and takes
the original branch. The route's remaining `addDaysUtc` is renamed
**`addRangeSpanUtc`** and documented: it is the 42-day *range guard*, where
`from` is an arbitrary caller-supplied instant (checked — `useCalendarFetch`,
`NewBookingForm` and iOS `ProCalendarService` all send explicit ISO instants,
never a local midnight), so a fixed span is the correct meaning there. Naming the
two apart is what stops the next reader repeating the category error.

**Verified, every guard proven red first:**

| mutation | what goes red |
| --- | --- |
| `startOfDayUtcInTimeZone` reverted to `base + dayOffset * 86_400_000` | 3 unit tests — `expected '2026-03-09T05:00:00.000Z' to be '2026-03-09T04:00:00.000Z'`, the autumn twin, and `expected 86400000 to be 82800000` |
| route boundary reverted to `addRangeSpanUtc(viewportTodayStart, 1)` | both route tests — `expected 30 to be +0` (spring counts tomorrow) and `expected +0 to be 30` (autumn drops today) |

The **ordinary-day case stays green under both mutations**, which is the point: a
test that only asserted "the two differ" would pass against a boundary that is
merely differently wrong. Both route tests are paired with an ALLOW case (a
midday block on a non-transition day still counts 60 minutes).

**What collapsed, and where it went.**

- **The working-hours sentinel protocol — the biggest item, and it was bigger
  than the card said.** The card counted `make`/`parse` ×3 and
  `getReadableWorkingHoursMessage` ×3. The *prefix string itself* was declared in
  **six** files, the code union in three, and `slotReadiness.ts` had a fourth
  reader under a different name (`readWorkingHoursMessage`) while `holdPolicy.ts`
  hand-built the sentinel from a template literal instead of calling the encoder
  at all. That is an encode/decode wire protocol with 4 independent producers and
  7 independent consumers. All of it now lives in `lib/booking/workingHoursGuard.ts`
  — the module that already owned `ensureWithinWorkingHours`, which every
  consumer already imported, so no cycle and no new file. A new
  `isWorkingHoursGuardCode` type-predicate replaces `holdPolicy`'s private
  `Set<SlotReadinessCode>` — the old `.has()` narrowed nothing, which is *why*
  that call site had to hand-roll the string.
- **`localMinutesSinceMidnight` / `localDaySerial` / `offsetFromWindowStartDay`**
  — identical in all copies, and `minutesSinceMidnightInTimeZone` in
  `lib/timeZone.ts` already *was* the first one. `daySerialInTimeZone` is new and
  exported through the `@/lib/time` barrel (house rule); `offsetFromWindowStartDay`
  is exported from `lib/scheduling/workingHours.ts`, next to the
  `getWorkingWindowForDay` whose scale it exists to match.
- **`resolveRequestedDurationMinutes` ×3** — byte-identical, and all three were
  thin wrappers whose empty-`addOnIds` guard `resolveDurationWithAddOns` already
  performs internally. Deleted outright; the three routes call the shared helper.
- **`normalizeLocationBufferMinutes`** — the card said ×2; there is a third under
  a different name, `safeBufferMinutes` in `pro/calendar/route.ts`. All three now
  call the already-exported `bufferOrZero` (`lib/booking/conflicts.ts`). Checked
  rather than assumed equivalent: `bufferOrZero` coerces through
  `Number(x ?? 0) || 0` first, which differs from bare `clampInt` **only** for a
  boolean input — and every call site passes a Prisma `Int?` column.
- **`openingSelect`** — F15 deferred this here. `pro/openings/route.ts` and
  `createLastMinuteOpening.ts` were the same 95 lines twice, differing by a
  two-space indent typo on `tierPlans`. Now one exported `proOpeningSelect` in
  `lib/lastMinute/openingSelect.ts`. It is deliberately **separate** from that
  file's client-facing `openingSelect`: the pro-side select omits
  `services.where.offering.isActive` and `tierPlans.where.cancelledAt: null`
  because the pro is *managing* the row and needs to see a deactivated offering
  link and a cancelled tier that the client-facing reader must hide. That
  difference is now written at the code site so it cannot be "unified" by
  accident.

**Two of the card's premises did not survive.**

1. **`decisionOk` / `decisionFail` ×3 are not three copies of one helper.** The
   card says `policies/types.ts` "already exports `policyOk`/`policyFail`". It
   does — but `PolicyFailure` is `{ok, code, logHint?}` and carries **no**
   `message`/`userMessage`, which all three `decisionFail`s return and their
   callers read. They also each return a different named result type. Collapsing
   them would mean widening `PolicyFailure` for every consumer to serve three
   callers. Left alone, deliberately.
2. **`mapSlotReadinessCodeToBookingCode` ×2 / `mapSlotReadinessFailure` ×2 are
   caller-specific by design, not drifted.** They *do* disagree — finalize maps
   `INVALID_START`/`INVALID_RANGE` to `INVALID_SCHEDULED_FOR`, reschedule maps
   them to `HOLD_TIME_INVALID` — but that is each policy agreeing with **its own
   entry guard**: `evaluateFinalizeDecision` opens with
   `decisionFail('INVALID_SCHEDULED_FOR')` and `evaluateRescheduleDecision` with
   `decisionFail('HOLD_TIME_INVALID')`. Unifying them would flip the reschedule
   path's `uiAction` from `PICK_NEW_SLOT` to `NONE` and `retryable` from true to
   false — removing the client's "pick a new slot" affordance. Same shape ≠ same
   intent.

**🟡 Left open, with evidence — the `other-pros` fork.** The card's warning was
right and the drift is worse than "a copy": the two `AvailabilityPlacementResult`
types share a name and are **different types**.
`app/api/v1/availability/other-pros/route.ts` never passes `professionalTimeZone`
and hardcodes `fallbackTimeZone: 'UTC'`, so a location carrying no timezone
resolves to **UTC** where `lib/availability/core/placement.ts` resolves to the
**pro's** zone; its result omits `timeZoneSource`, `workingHours`, `stepMinutes`,
`leadTimeMinutes` and `locationBufferMinutes`; and where the canonical checks a
requested location exists before validating, the fork does not. It is **latent,
not live** — re-verified this session that nothing fetches the route (only its
own `route.test.ts`), which is exactly what `docs/BACKLOG.md`'s wiring item says.
Consolidating it changes the route's response shape and error mapping with no
caller to validate against, so it belongs **with the wiring task**, not in a
cleanup PR. Pointer added to the BACKLOG item.

**Not checked / not changed.** `lib/booking/errors.ts` carries its own
`"That time is outside working hours."` as the `OUTSIDE_WORKING_HOURS`
catalogue copy. It is the same sentence as the guard's fallback but a different
surface — the catalogue is the wire contract for the error code, the guard's is
the fallback when a sentinel leaks — so they were left independent rather than
coupled backwards.

**Coverage.** `typecheck` clean, `lint` **0 errors**, **all 13 static guards
pass**, **708 files / 6898 unit tests** green, integration **31 of 34 files**.
The 3 integration files that fail do so **identically on clean `main` at
`7c533df3`** — diffed the failure sets, byte-identical — and fail on
`Missing required env PII_AEAD_KEYS_JSON`, the known local keyring gap; CI
supplies it. `opening-create-lock` and `opening-liveness`, which cover the
`createLastMinuteOpening` and `pro/openings` edits, are in the passing set.

One test needed a real change: `proSchedulingPolicy.test.ts` stubbed the whole
`workingHoursGuard` module, which now also owns the codec that policy encodes and
decodes with. It uses `importOriginal` so only `ensureWithinWorkingHours` is
stubbed — otherwise the round-trip those tests assert would have been vacuous.

### F7 — what shipped

**A 🟠 "one-line iOS change" was a 🔴 dead feature.** See the card above for the
premise autopsy. What matters for the next reader: the audit's iOS findings were
code reads, and this one described a *degraded* experience the code could not
produce — the server has no pro's-base fallback to degrade to. Reading the
refusal in `placement.ts` was enough to kill the premise; driving it was what
showed the user-facing shape (a full-screen dead end with a "Try again" that
re-fires the same 400).

**What changed (iOS #206, no web change).**

- `BookingService.bootstrap` gains `clientAddressId` — it had none, and bootstrap
  runs before the `day` call the card named.
- `BookingFlowView.loadBootstrap` loads the client's addresses **before** asking
  for availability and withholds the request entirely when MOBILE has no address,
  mirroring web's `canFetch`. A new `.needsAddress` phase renders the offering
  summary + Where switch + address picker so the client can add one and continue —
  and can still switch back to salon. Verified both directions on the simulator.
- Both `bootstrap` and `day` now send the same address `createHold` already sent.
- `loadBootstrap` clears `slots`/`selectedSlot` (the stale-slot bug in the card).
- A failed address fetch is no longer silently indistinguishable from "you have
  none" — it gets an error + retry, like `slotError` already did for days.

**Verified end to end on the simulator**, not just in tests: switching to Mobile
now issues `bootstrap…&clientAddressId=…` → 200 and `day…&clientAddressId=…` →
200 against the MOBILE_BASE location, the slot grid changes from salon's 15-minute
to mobile's 30-minute steps, and a real booking completed — `POST /holds` 201 →
`POST /bookings/finalize` 201, landing a `MOBILE` row with the right
`clientAddressId` at the picked time. Four wire tests pin the query
(`AvailabilityMobileAddressTests`); 858 TovisKit tests pass.

**Two things this pass did NOT settle.** (1) `ClaimOpeningView` and the aftercare
rebook path also send `clientAddressId` on the hold; they were read, not driven —
they take a fixed slot rather than browsing availability, so the gate doesn't
apply, but neither was exercised. (2) A **separate, pre-existing** iOS bug is
visible in every screenshot here: the booking sheet opened from the pro profile's
Services tab shows "with" and "Request sent · Haircut & Style with" — an empty pro
name. Not a scheduling bug and out of F7's scope, but diagnosed while here:
`displayName` is correct on the wire (`/professionals/{id}` returns
"TOVIS Test Pro"), so the fault is client-side in `ProProfileView`'s `onBook`,
which sets `bookingProName` and `bookingOffering` as two separate `@State` writes
and presents `.sheet(item:)` off the second. Worth its own card.

### F8 — what shipped

**The card was right about the facts and wrong about the remedy.** All four
definitions were exactly as described (only the line numbers had rotted:
`constants.ts:36` → `:69`). But the doc's own side-note from F11 — "F8 should
probably resolve by dropping COMPLETED from the app constant" — pointed the wrong
way, and one lookup killed it: **`advanceNoticeMinutes` defaults to 15**
(`prisma/schema.prisma:2358`). Dropping COMPLETED would have freed the pro's
post-service buffer the instant they closed out, so a client could book into
their cleanup/travel time ~15 minutes later. Put to Tori with that number
attached; the ruling was **a COMPLETED booking DOES occupy its time**, so the
database moved to the app.

**What changed.**

- Migration `20260806000000` widens the `Booking` EXCLUDE predicate to
  PENDING/ACCEPTED/IN_PROGRESS/**COMPLETED**. `BookingHold` is untouched (holds
  carry no status).
- `busy-days/route.ts` and `looks/availabilityStats.ts` no longer keep private
  copies — both import `BOOKING_BLOCKING_STATUSES`. Per F6's lesson these were
  diffed first, and both had **drifted**: each omitted COMPLETED on a comment
  that said "completed is past". That is false for an early-finished or same-day
  session, so the pro's busy-day popup and the ranking fullness signal were both
  under-reporting occupancy. Consolidating is a behaviour change, and both now
  have a test that says so.
- `ESTABLISHED_BOOKING_STATUSES` (`resolveDiscoveryFinalize.ts:42`) is the same
  P/A/IP/COMPLETED **shape** and was deliberately left alone — it answers "has
  this client booked here before?", not "is the pro busy?". Same-shape ≠
  same-intent.

**The migration was checked against real data before it was written**, not after:
production held 22 bookings, 8 COMPLETED (all unflagged), and **zero** pairs that
the widened predicate would reject, so `ADD CONSTRAINT` applies cleanly. The
local test DB was checked the same way (0), then actually migrated and the live
predicate read back out of `pg_constraint`.

Re-run this before deploying if prod has moved on much — a non-empty result means
`prisma migrate deploy` will **fail the release**, which is the intended
behaviour, not something to work around:

```sql
SELECT a.id, a.status, b.id, b.status
FROM "Booking" a
JOIN "Booking" b ON a."professionalId" = b."professionalId" AND a.id < b.id
WHERE NOT a."allowsOverlap" AND NOT b."allowsOverlap"
  AND a.status IN ('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED')
  AND b.status IN ('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED')
  AND tovis_booking_overlap_range(a."scheduledFor", a."totalDurationMinutes", a."bufferMinutes")
   && tovis_booking_overlap_range(b."scheduledFor", b."totalDurationMinutes", b."bufferMinutes");
```

**No new 23P01 is reachable**, verified by reading every write rather than
reasoning about it: all five `allowsOverlap` write sites derive the flag from
`findBookingAndHoldConflicts`, which has always counted COMPLETED — so a
pro-authorized overlap onto a completed slot was already being stamped exempt.
And COMPLETED is reachable **only from IN_PROGRESS**
(`lib/booking/lifecycleContract.ts:81`), which already sits in the index over the
identical range, so completing a booking can never newly violate the constraint.
A test pins that an authorized double-book stays exempt when it completes.

**One of those five sites deserved more than an argument.** Consultation approval
(`writeBoundary.ts:8322`) is the only write that **grows a booking's occupied
range in place**, so it is the single place a genuinely new 23P01 could appear —
an extension can now collide with a finished appointment that used to sit outside
the index entirely. Its existing `allowsOverlap` stamp covers it, but that stamp
only became **load-bearing** with this migration and nothing pinned it. It does
now (`consultation-extension-blocked.test.ts`): an approval extending over a
COMPLETED booking commits and leaves the row flagged. **Proven red by deleting
the stamp** — the approval then dies exactly as predicted, `23P01` on
`Booking_no_active_professional_overlap`, extension `[12:00, 15:15)` against the
completed `[14:00, 14:30)`. Worth noting the refusal also tripped F13's backstop
log (`db_overlap_backstop_fired`), the first time that alert has fired on demand
rather than by configuration.

**The parity test walks the enum, not a hand-written list.**
`booking-overlap-concurrency.test.ts` now probes **every** `BookingStatus` value
against real Postgres — insert a row with that status, try to overlap it with an
ACCEPTED one, and record whether the database refused — then compares the whole
map against `BOOKING_BLOCKING_STATUSES`. A status added to the schema later is
covered the day it lands, and membership is read from what Postgres *does* rather
than by parsing `pg_get_constraintdef`. **Proven red**: dropping COMPLETED from
the constant fails it with `- "COMPLETED": false / + "COMPLETED": true`, naming
the offending status. The two consolidated readers were proven red the same way.

**Two integration fixtures were double-booking a pro and nobody knew.**
`rebook-cadence` and `re-engagement-dispatch` both build a client's visit history
by stamping bookings `bookingSeq * 60 * 1000` apart — a **one-minute** stagger for
rows that occupy 60 + 15 minutes, several of them on the same pro and the same
day. That was invisible while COMPLETED sat outside the index; the moment it went
in, both seeds died on a real 23P01. The fixtures were wrong, not the constraint,
so the stagger is now 90 minutes (> the occupied window) in both. This is the F11
pattern again: a suite that has never been pointed at the invariant it depends on.

⚠️ **The trap that follows that one, if you break a seed here.** Both suites'
`cleanup()` opens with `if (!ids) return` — so when `beforeAll` throws, **nothing
is cleaned up** and the pros, bookings and `ProfessionalAvailabilityStat` rows
stay in your local test DB. The next run then fails somewhere else entirely:
`rebook-cadence` asserts `openPros === 1` and reads **3**, because
`loadOpenProAvailability` scans that table globally. It looks like a
just-introduced leak and it is not — it is debris from the previous failed run,
and it clears itself as soon as `booking-overlap-concurrency`'s
`TRUNCATE … CASCADE` runs again. A "controlled experiment" that reverts a source
change and re-runs will happily exonerate the wrong line if the truncate happened
in between; verify against a **freshly truncated** database. CI never sees any of
this — it starts from an empty Postgres every run. Three consecutive clean local
runs: 34 files / 196 tests green.

**Not checked.** The widened predicate is a larger GIST index (COMPLETED rows no
longer leave it), so index size now grows with booking history instead of with
open bookings. At 22 prod rows this is nothing; at scale the constraint is still
`professionalId`-partitioned, so it is a bounded scan per pro either way. Not
measured on a large table — there isn't one yet.

### F6 — what shipped

**Both halves of the card held, but they were not the same KIND of work.** The
lock was the bug the card described. The query swap was filed as a tidy-up
("two birds"), and it was not: the inline math and the shared reader disagree,
so replacing one with the other **changed behaviour and closed a second hole**.

**Half 1 — the lock.** `createLastMinuteOpening` now runs inside
`withLockedProfessionalTransaction` instead of a bare `prisma.$transaction`.
Measured, not argued: with another session holding that pro's advisory lock,
a real `POST /api/v1/pro/openings` took **4.1s** and then returned 201 — it
waited. With the lock removed, the same race publishes an opening over a
booking that committed microseconds earlier (the integration test goes red in
**54ms**, i.e. it never waited at all).

**Half 2 — the two engines disagreed.** The card flagged this as unchecked, and
it was the thing worth checking. The replaced code sized a hold's busy window
from **the offering's current duration**; `getTimeRangeConflict` sizes it from
**the hold's own snapshot columns**, floored to the database EXCLUDE range. So a
hold reserving more time than its base offering — add-ons, or an offering
shortened after the hold was taken — was **invisible past its first hour**.
Proven by restoring the old math verbatim and re-running: the opening over a
10:00–12:00 hold is published (`NO_REFUSAL`) under the old engine and refused
(`HOLD_CONFLICT`) under the new one. Driven over HTTP too — 409 at 03:00Z,
201 at 04:00Z where the hold actually ends.

Everything else in the trio is byte-equivalent, checked line by line rather than
assumed: the calendar-block `WHERE` matches `buildCalendarBlockConflictWhere`,
the booking query matches `hasBookingConflict` (same window, same statuses, same
`take`, same fallback), and `bufferOrZero` clamps to `MAX_BUFFER_MINUTES` exactly
as the inline `clampInt` did. `BookingHold.locationId` is non-nullable, so the
new `defaultBufferMinutes` argument only ever applies to a legacy row that has no
location — which cannot exist.

**Two checks stayed hand-written** because no shared reader knows about them: the
rival-opening query and `LastMinuteBlock` are last-minute-specific, not pro-wide
occupancy.

**The refusal a pro reads is unchanged.** `getTimeRangeConflict` returns ONE code
by its own priority (BLOCKED > BOOKING > HOLD), but the old code checked
block → last-minute block → booking → hold. The three asserts are therefore split
*around* the last-minute block rather than collapsed into one place. Collapsing
them turns a `CALENDAR_BLOCK_CONFLICT` into a `LAST_MINUTE_BLOCK_CONFLICT` —
proven by mutation, which is why there is a test for it.

**The `tx` escape hatch is gone.** It had zero production callers (verified),
and it was the one way to reach these checks without the lock. `DbClient` in
that file is now `Prisma.TransactionClient` alone — not `| typeof prisma` — so
"this only runs inside the locked transaction" is a type, not a convention.

**Coverage:** `tests/integration/opening-create-lock.test.ts`, 5 cases against
real Postgres, **two of them ALLOW cases**. Every one was proven red first, by
four separate mutations: remove the lock (2 red), ignore the hold verdict
(1 red), restore the old hold math verbatim (1 red), collapse the assert
precedence (1 red), and refuse everything (4 red — this is what the ALLOW cases
are for). No migration; revert is a straight code revert.

**Net for F9:** the biggest single entry in the duplicate-logic table
(`createLastMinuteOpening.ts:1073`, ~150 lines over five tables) is now gone —
63 insertions against 147 deletions in that file.

### F16 — what shipped

**The card's premise held** — `GET /api/v1/pro/openings` really did return a dead
opening as a plain `ACTIVE` row with no signal, confirmed on the wire before
anything was changed. What the card did **not** anticipate is that the honest
answer needs a state it never named, and that adding the check to the route
introduces a failure mode on a **write** path.

**🔴 A hold is not a failure — and reporting it as one would have been the bug.**
`checkStoredSlotsAreOpen` answers `TIME_HELD` when anything holds the slot. On a
client feed that means "someone beat you to it, hide the card". On the PRO's card
the commonest cause is **a client mid-checkout on this very opening** — the
feature working. A badge reading *"not visible to clients"* at that moment tells
the pro their opening is broken exactly when it is succeeding, and invites them to
cancel it. `TIME_HELD` therefore gets its own non-alarming state,
`BEING_CLAIMED` — different copy, different colour, `isFault: false` on both
platforms. Driven on device: teal + clock, not amber + eye-slash.

**🔴 The pro's select does not filter deactivated offerings, so the badge had to.**
F9 made `proOpeningSelect` deliberately omit `services.where.offering.isActive`
so the pro can SEE a deactivated link. The badge answers a **client** question, so
judging it over the pro's unfiltered rows disagrees with the feed it is reporting
on, in both directions: a deactivated service could set the (longer) window the
row is judged against, and an opening whose every offering is dead would read as
`VISIBLE` while the client feeds drop it entirely. The filter is re-applied in
code, and the all-dead case became its own reason, `NO_ACTIVE_SERVICE`. **Proven
against real Postgres**: with the filter removed the row reads `VISIBLE` —
`expected 'VISIBLE' to be 'NO_ACTIVE_SERVICE'`.

**🔴 The fix's own defect, caught re-reading the diff, not by a test.** The check
runs inside `mapOpeningDto`, which three handlers use — and **two of them have
already written** by the time they map: POST has created the opening, PATCH has
cancelled it or saved the note. Before this change `mapOpeningDto` was pure and
could not throw; after it, a schedule query failing would have returned **500 for
an opening that exists**, and the pro would have made another. Now
`resolveVisibilitySafely` logs and falls back to `NOT_CHECKED`. Proven red:
without it, `expected 500 to be 201`.

**The `LOCATION_UNAVAILABLE` question F15 left here: split, and here is why.**
F15 collapsed `LOCATION_NOT_FOUND` and `TIMEZONE_REQUIRED` into one reason because
all five call sites read only `verdict.open`. A hide/show caller can treat them
alike; a badge cannot — *"that location is no longer bookable"* and *"that
location has no time zone set"* are two different jobs for the pro. The verdict
now carries the gate's own error through verbatim, and the one file that asserted
the old reason moved with it.

**Shipped:**

- **`lib/lastMinute/proOpeningVisibility.ts`** — `ProOpeningClientVisibility` (13
  states) and `resolveProOpeningVisibility`. It adds **no** schedule logic: it
  calls the same `checkStoredSlotsAreOpen` the four client feeds call, which is
  itself the commit gate run with nothing written. `viewerClientId: null` — the
  pro is not a client, so there is no viewer hold to discount.
- **Total by contract, silent by default.** Every row gets an entry; terminal
  rows (booked / cancelled / expired) and rows whose time has passed are
  `NOT_CHECKED` rather than asked about — a past opening would otherwise answer
  `ADVANCE_NOTICE_REQUIRED`, true but not what "too soon" means to a reader. An
  unanswered row is never `VISIBLE`, on the server, on web, or on iOS.
- **A SIGNAL, not a filter.** F15 left this list unfiltered on purpose so a dead
  opening can still be cancelled. Nothing here removes a row — pinned by a test
  on each platform, and driven: `rows=1` in all six states.
- `proOpeningSelect` gains `offering.isActive` and `professional.timeZone`, both
  documented at the code site as F16's, both proven load-bearing.
- Web badge (`.lm-opening-visibility-notice`, tone tokens only) and iOS badge
  (`ProOpeningClientVisibility` in **TovisKit**, so CI compiles and tests it —
  nothing in iOS CI compiles `Tovis/`). Both platforms carry the same sentences
  and an exhaustive switch with no `default`, so a new server state fails the
  build rather than rendering blank.

**Verified. Every guard proven red first — seventeen mutations:**

| mutation | what goes red |
| --- | --- |
| `TIME_HELD` → treated as a fault | only `reports a hold as a claim in progress` (unit **and** real-DB twins) |
| active-offering filter dropped | `NO_ACTIVE_SERVICE` + the window-pricing test; real DB: `expected 'VISIBLE' to be 'NO_ACTIVE_SERVICE'` |
| `isWorthChecking` → always true | all 4 "leaves an X opening unchecked" |
| unanswered row defaulted to `VISIBLE` | `never reports an unanswered row as visible` |
| `viewerClientId` set to a client | `asks as nobody in particular` |
| location errors re-collapsed | `tells a missing location apart from one with no time zone` |
| badge removed from the web card | 4 badge tests; **both ALLOW cases stay green** |
| web parser drops the field | the same 4 — this is the "nobody re-read it" failure |
| web badges everything | **only** the 2 ALLOW cases — which is the point of having them |
| `professional.timeZone` out of the select | 4 real-DB tests, `Cannot read properties of undefined` |
| `offering.isActive` out of the select | 3 real-DB tests, every row reads `NO_ACTIVE_SERVICE` |
| write-path safety removed | `expected 500 to be 201` (POST) and `expected 500 to be 200` (GET) |
| iOS: `beingClaimed` marked a fault | 2 TovisKit tests |
| iOS: unknown verdict → `.visible` | `saysNothingWhenThereIsNothingToSay` |
| iOS: a state left with no copy | `everyStateIsEitherSilentOrExplained` |

- **Real HTTP, all six reachable states**, against `pnpm dev:test-db` with its own
  fixture: `VISIBLE` → book → `TIME_BOOKED` → block → `TIME_BLOCKED` → hold →
  `BEING_CLAIMED` → narrow hours → `OUTSIDE_WORKING_HOURS` → deactivate →
  `NO_ACTIVE_SERVICE` → revive → `VISIBLE`. **The row's own `status` stayed
  `ACTIVE` in every one**, which is precisely the blindness F16 fixes.
- **The real page**, driven in a browser as the signed-in pro: silent when live,
  the right sentence in each dark state, the card and its Cancel button present
  throughout. Light **and** dark checked — `rgb(183,131,31)` / `rgb(242,180,62)`,
  the two `--tone-warn` values, so the badge follows `[data-mode]` (raw colours
  are not caught by the static guards).
- **iOS on device (iPhone 17 Pro)** — the live card with no badge, the amber
  eye-slash for a booked slot, the teal clock for a claim in flight, and the
  **longest** copy (`OFF_BOOKING_GRID`, 77 chars) **wrapping onto two lines
  rather than truncating** — the F14 failure mode, checked rather than assumed.
- **Cost A/B'd, not asserted.** Same fixture, 14 openings, check on vs
  short-circuited: p50 **15.7 → 28.4ms**, p95 20.5 → 32.9ms — ~0.9ms per row,
  matching F15's measurement. See "Not verified" below for the ceiling.
- `typecheck` clean, `lint` **0 errors**, **all 13 static guards pass**, `next
  build` succeeds (the type-only import into a `'use client'` file is erased),
  **710 files / 6927 unit tests**, **34 files / 204 integration tests**, iOS app
  target **BUILD SUCCEEDED** + 9 TovisKit tests.

**Checked, so it is not a caveat:**

- **The 3 integration files that fail locally are the known keyring gap, proven
  not assumed.** All 10 failures throw from `getAeadKey` →
  `Missing required env PII_AEAD_KEYS_JSON`. Re-run with a throwaway keyring
  built exactly as `.github/workflows/integration.yml` builds it: **34/34 files,
  204/204 tests pass.**
- **`NO_ACTIVE_SERVICE` is reachable on the web page, but only for the right
  reason.** Deactivating the pro's *only* offering redirects `/pro/last-minute`
  to `/pro/services` behind the pre-existing "you are not bookable yet" gate, so
  the badge never renders — nothing to do with F16. With a second active offering
  the pro stays bookable and the badge shows. Found by driving the page, not by
  reading it.
- **The DTO is not in `lib/dto/index.ts`**, so no `gen:api-schema` regeneration —
  `check:api-schema` passes, and the iOS contract job does not cover pro-side
  routes.
- **iOS decodes an older server.** `clientVisibility` is optional; the pre-existing
  fixture, which has no such key, still decodes and reads `.notChecked`.

**Not verified / not checked:**

- **The cost ceiling is projected, not measured.** ~0.9ms per row was measured at
  14 rows; the route's own limits are `take: 200` and `hours: 14d`, which project
  to ~180ms added in a case no real pro reaches (both web and iOS ask for
  `hours=48&take=100`). Deliberately **not** capped: a silent cap would badge some
  rows and not others, which is worse than a slow page. Not measured against a
  pooled prod connection — same open item F15 registered in §3.
- **Three states were never driven end-to-end**, only unit-tested through the
  mapping: `WORKING_HOURS_MISSING`, `TOO_FAR_AHEAD` and
  `LOCATION_TIME_ZONE_MISSING`. Each is one `switch` arm over a verdict the
  shared gate already produces and the other eight arms are driven, so the risk
  is confined to the copy string.

### F15 — what shipped

**The premise was Tori's own rule, so it held. What the card got wrong was the
SIZE: it named two client-facing surfaces and there are five.** All five show the
same two kinds of stored row, and all five are fixed:

| surface | shows | consumed by |
| --- | --- | --- |
| `GET /api/v1/client/openings` | last-minute opening | web feed + iOS `OpeningsFeedView` (and the iOS priority-claim resolution) |
| `GET /api/v1/client/priority-offer` | the SAME opening, reached first | web `/client/offers` + iOS `PriorityOffersView` |
| `getClientHomeData` invites | the same opening, on home | web `/client` **and** `GET /api/v1/client/home`, which iOS reads |
| `GET /api/v1/client/waitlist-offers` | pro-proposed waitlist time | web cards + iOS |
| `loadOfferingDetail` | the claim page itself | `/offerings/[id]` page **and** `GET /api/v1/offerings/[id]` (iOS `ClaimOpeningView`) |

A sixth reader, `GET /client/saved-services/providers`, is **deliberately not
filtered**: nothing on web or iOS calls it (verified by grep, and `docs/BACKLOG.md`
says so), so it displays nothing to anybody today. It carries a pointer comment and
a BACKLOG note instead, because the cost of checking across MANY professionals — it
is the one opening feed not scoped to a single pro — should be measured against a
real caller rather than guessed at now.

**Hidden, not shown-as-expired — and the notified client is answered at the
destination.** The rule says a dead time must not be visible, and a card reading
*"2:00 PM — no longer available"* still shows the time. But a client who was pushed
a notification deserves better than a card that silently vanishes, so the answer
lives where that notification actually lands: the claim page, which already renders
**"This opening is no longer available / It may have just been booked or expired"**
— naming no time and offering a way onward. `loadOfferingDetail` now returns
`claimable: false` for a dead *schedule*, not just a dead row, so both the web page
and the native 404 reach it.

The other two feeds have no such destination — a push for a priority or waitlist
offer lands on `/client/offers`, which is a list. Checked rather than assumed:
the priority section renders *"No active offers right now…"* and the waitlist
section (`WaitlistOfferCards`) renders **nothing** when empty. Neither shows a
time, so both comply; neither explains, which is the cost of the rule and is
accepted. The one place the repo already shows a lapsed row — the priority
list's `expired: true` — is about the OFFER's own clock, not about the slot, and
is untouched.

**Shipped:**

- **`lib/booking/storedSlotLiveness.ts`** — `checkStoredSlotsAreOpen` /
  `filterStillOpenRows`. It adds **no second schedule engine**: it calls
  `evaluateProSchedulingDecision`, the gate the commits themselves run, with
  nothing written. F3 was spent deleting the last parallel engine; a hand-rolled
  second check is what opened F5 in the first place.
- **`commitGate: 'CLIENT_HOLD' | 'PRO_CREATE'`** on each candidate, required and
  not defaulted (F4's rule). It names the domain fact — *which gate will commit
  this row* — rather than its two consequences, because they do not travel
  together and both are invisible from the refusal side:
  - an opening is claimed via `POST /holds`, where an off-grid start is fatal and
    `deleteActiveHoldsForClient` runs FIRST;
  - a waitlist offer is confirmed via `performLockedCreateProBooking`, which
    defers the step grid (the PRO picked the minute) and runs **no** client-hold
    sweep at all.
- **`releasedHoldId`** — the hold a row's own commit releases before it checks.
  For a waitlist offer that is F14's reservation, and without it **every offer
  would hide itself the moment it was made**.
- `lib/lastMinute/openingLiveness.ts` and `lib/waitlist/offerLiveness.ts` — one
  adapter per row kind, so four surfaces cannot ask four different questions.
- `lib/lastMinute/openingDuration.ts` — the "longest of the opening's services"
  rule, extracted from `createLastMinuteOpening` and now shared, so the window
  validated at publish is the window re-checked at read.
- `onUncheckable: 'keep' | 'drop'`, required, for a row with no window to ask
  about. The priority list renders a serviceless opening **on purpose** (its claim
  falls back to the pro's profile), so hiding it would have been a different fix
  wearing F15's clothes.

**Two defects were caught in the review pass, not by a test:**

1. **The viewer's own hold.** A client mid-checkout holds the very slot they are
   claiming. A naive "is this free?" read hides the card from the one person it
   belongs to — and tells them their own reservation is somebody else's. The
   claim's own `deleteActiveHoldsForClient` is the answer, mirrored exactly
   (`waitlistOfferId: null` included, so an offer-bound hold stays counted).
2. **That mirror was then wrong for the OTHER gate.** `deleteActiveHoldsForClient`
   has exactly ONE call site — `performLockedCreateHold` — so a `PRO_CREATE`
   commit never runs it, and discounting the viewer's hold there would show an
   offer the confirm refuses. Found by reading the call sites, fixed by
   `commitGate`, and pinned in both places.

**Verified. Every guard proven red first — nine mutations:**

| mutation | what goes red |
| --- | --- |
| gate bypassed (always "open") | 8 of the opening tests + 3 waitlist tests; the **ALLOW** cases stay green, which is the point |
| viewer's own-hold exclusion dropped | only `still shows an opening the VIEWING client is holding` — `expected { open: false, reason: 'TIME_HELD' } to deeply equal { open: true }` |
| own-hold exclusion applied to PRO_CREATE too (the pre-fix shape) | `hides an unreserved offer the client's own ordinary hold now covers` + the unit twin |
| `enforceStepGrid` forced true | only the pro-chosen half of `splits an off-grid start by which gate will commit it` |
| `enforceStepGrid` forced false | only the opening half of the same test |
| `LOCATION_UNAVAILABLE` branch reports open | `hides an opening whose location stopped being bookable` |
| `releasedHoldId` dropped (waitlist) | `shows a live offer, discounting the reservation the offer itself placed` |
| the claim page's check removed | 2 claim-page tests, incl. the client's own-hold ALLOW case |
| each of the 4 routes' filter removed | that route's own wiring test (all 4 confirmed) |

- **Real Postgres** — `tests/integration/opening-liveness.test.ts` (new, 13
  tests) and the F15 block in `waitlist-offer.test.ts` (20 → 26). The openings
  fixture is built by `createLastMinuteOpening` itself, so every row is proven
  publishable before it is killed. **Six of the tests are ALLOW cases** — a clean
  slot, the viewer's own hold, the rival's view of that same hold, a cancelled
  booking, a pro-chosen off-grid start, a live offer over its own reservation —
  because a suite made only of "it disappeared" assertions passes against a
  filter that hides everything.
- **Real HTTP** (`pnpm dev:test-db`, own fixture, the actual routes), driven twice
  — once before the `commitGate` refactor and again after it, because a
  remembered result is not a checked one. Live: openings **1**, home **1**,
  waitlist **1**, priority **1**, claim **200**. Then a booking through the
  ordinary flow over the opening and a block over the offer — with the opening row
  still reading `ACTIVE / bookedAt: null`, which is exactly why the feeds' own
  filters miss it — and: openings **0**, home **0**, waitlist **0**, priority
  **0**, claim **404** `This opening is no longer available.`, and the real page
  HTML containing that same sentence. Undo the two rows and all five come back.
  The viewer's own hold was driven too: the owner still sees the opening, a rival
  client does not.
- **iOS on device (iPhone 17 Pro), and no app change was needed** — the three
  feeds are server-filtered and the native claim read already maps
  `claimable: false` to a 404. Seen: the home LAST-MINUTE OPENINGS card with the
  live opening → after the slot dies, its existing empty state (*"No last-minute
  openings right now"*); the Openings screen likewise (*"No openings right
  now"*); the slot revived → the card returns in full. And the waitlist offer
  renders **with its own F14 reservation in place** — the case that would have
  looked catastrophic if `releasedHoldId` were wrong.
- **Cost measured, not asserted.** A/B'd in one process by short-circuiting the
  filter: at **1** row the delta is inside dev-server noise (±2ms either way); at
  **20** rows the openings feed goes p50 **16.0 → 34.0ms**, p95 16.8 → 40.0ms.
  That is ~0.9ms per candidate — three indexed conflict queries each, eight in
  flight at a time — so the route's `take: 50` ceiling projects to ~45ms added in
  the worst case a feed can reach. Context resolution is batched per distinct
  (pro, location, mode, tz), which is where a feed of one pro's openings pays.
- **Retroactivity: nothing, and the number says why.** Prod holds **0**
  `LastMinuteOpening`, **0** `LastMinuteRecipient`, **0** `WaitlistOffer`, **0**
  `WaitlistEntry` and **0** `BookingHold` rows, so no live client's feed changes
  on deploy. No migration.
- `typecheck` clean, `lint` 0 errors, **all 13 static guards pass**, **708 files /
  6885 unit tests**, **33 files / 187 integration tests**, full e2e green on
  **chromium and mobile-chrome** (29 passed / 2 skipped each), iOS builds.

**Checked, so it is not a caveat:**

- **The pro's own view is untouched, deliberately.** `GET /api/v1/pro/openings`
  still lists a dead opening as `ACTIVE` so the pro can cancel it. That the pro
  gets no *signal* is real, pre-dates F15, and is now filed as **F16**.
- **Nothing else reads these rows.** Enumerated every `lastMinuteOpening.` /
  `lastMinuteRecipient.` / `waitlistOffer.` reader in the repo; the client-facing
  ones are the five above, the rest are pro-side or the notification engine.
- **`lib/lastMinute/openingSelect.ts` has exactly one consumer** (the claim page
  and its native twin). Its header claimed a second, `app/api/openings`, which
  **does not exist**; corrected. The other three opening readers each declare
  their own local `openingSelect` — a real duplicate, left for F9.
- **The e2e run that aborted once was not this change.** `booking-lifecycle.spec.ts`
  navigates only to `/login` and otherwise drives APIs — it never renders home,
  the feeds or the claim page — and its own header comment documents a real-time
  wait for a quarter-hour window. It passed on the two full re-runs and two
  isolated runs that followed.

**Not verified / not checked:**

- **The `LOCATION_UNAVAILABLE` verdict is coarser than the gate it mirrors** —
  deliberately, and now written at the code site rather than only here.
  `resolveBookingLocationContext` returns exactly **two** errors
  (`LOCATION_NOT_FOUND`, `TIMEZONE_REQUIRED`) and both collapse to one reason;
  working-hours failures do NOT collapse (they keep their own codes from the
  scheduling policy). Nothing reads the difference today — all five call sites
  use `verdict.open` — so the fix is scoped to whoever first needs to *explain*
  the verdict, most likely F16's pro-facing badge.
- **Read-time cost is measured locally only** — see §3, where it is registered so
  a later session can pick it up rather than rediscover it.

### F14 — what shipped

**The premise was Tori's own ruling, so it held. What was NOT established was the
blast radius — and the card's ⚠️ found something worse than it warned about.**

**The pro could see nothing, anywhere.** Sending an offer moves the entry to
`NOTIFIED`, and **both** pro-facing waitlist reads filtered on `ACTIVE` only
(`pro/calendar/route.ts`, `pro/waitlist/route.ts`). So the client vanished from
the pro's waitlist the moment they were offered a time, and the calendar grid
renders bookings and blocks — never holds. The "Offered · <time>" badge in
`ManagementModal.tsx:823` was already written and was **unreachable**: no
`NOTIFIED` entry ever reached it. Before F14 that was a wart; with F14 it means a
slot silently leaves the pro's own availability with no surface explaining why.
Fixed on both platforms, and the iOS view's comment claiming "the entry stays
ACTIVE … nothing in the list visibly changes" was simply false.

**Shipped:**

- **Schema + migration `20260805000000`** — `BookingHold.waitlistOfferId`,
  `@unique`, FK `onDelete: Cascade`. Nullable, no backfill: every existing hold
  is client-picked. The column is the discriminator two paths need, not
  decoration (below).
- `lib/booking/writeBoundary.ts` — `createWaitlistOffer` places the hold inside
  its existing locked transaction, over the window **the gate validated**
  (`schedulingDecision.requestedEnd`, i.e. duration **plus** buffer), so the
  reservation covers exactly what the confirm books.
- **The supersede moved BEFORE the gate.** A still-pending offer now holds its
  own slot and the gate treats a hold as fatal, so re-offering an overlapping
  time would refuse against the pro's *own* outstanding promise. Same
  transaction, so a later refusal rolls the supersede back.
- **Expired holds are swept first.** The hold `EXCLUDE` constraint carries no
  expiry predicate, so a dead row occupies the index until the 5-minute cron
  clears it — while the app gate, which filters `expiresAt`, calls the slot free.
  Without the sweep the insert 23P01s on a hold the gate already waved through.
- Released at every exit: **confirm** (before `performLockedCreateProBooking`,
  which runs the overlap policy as a CLIENT and would otherwise refuse the very
  booking the hold protects — `deleteMany`, because an idempotent replay arrives
  with it already consumed), **decline**, **supersede**, and **expiry** (the
  hold's own TTL plus the existing cron).
- `declineClientWaitlistOffer` now runs under the professional's schedule lock.
  Declining removes occupancy, and every booking/hold transition serializes the
  same way (`releaseHold` says so in its own comment).
- `deleteActiveHoldsForClient` gains `waitlistOfferId: null`, and `releaseHold`
  refuses an offer-bound hold. **This is the part that would have silently
  defeated the whole card:** the one-hold-per-client rule drops a client's live
  holds whenever they start another, so the offered client browsing for an
  unrelated appointment would have handed their reservation back without knowing.

**The TTL — decided, not asked.** `WAITLIST_OFFER_TTL_MINUTES = 24h`, and the
value actually written is **`min(now + 24h, startsAt − advanceNoticeMinutes)`**.
The second term is not decoration: `startsAt − advanceNotice` is the exact
instant `checkAdvanceNotice` starts refusing the confirm, so an offer that
outlived it would be a live card nobody can accept — the same failure F5 closed,
arriving by a different road. Offer and hold get the same instant. The pro route
no longer accepts an `expiresAt` at all (it was an unused optional): a caller
able to pass a longer one could re-open that asymmetry.

**Setting an expiry forced two read-side fixes, or F14 would have created the
bug it exists to prevent.** `assertConfirmableWaitlistOffer` has always refused a
lapsed offer, but nothing filtered on it, so a newly-expiring offer would have
sat on the client's `/client/offers` feed as a live Confirm button whose only
outcome is "This offer has expired." Both `/api/v1/client/waitlist-offers` and
the two pro reads now filter `OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]`
— matching the confirm exactly. On the pro side that also returns the "Offer a
time" action once an offer lapses, instead of stranding them behind a badge.
(iOS consumes the same client feed, so no app change was needed there.)

**Verified. Every guard proven red first — twelve mutations, one at a time:**

| mutation | what goes red |
| --- | --- |
| hold creation disabled | 7 tests, incl. the one that matters: **`promise resolved "{ hold: … }" instead of rejecting`** — a rival client takes the offered slot |
| confirm-time release removed | 3 tests, `That time is no longer available.` — the offer's own hold refuses its own confirm |
| supersede moved back after the gate | only the **overlapping** re-offer test: `Requested time is currently held.` (the day-apart supersede test stays green — that is why the new one exists) |
| expired-hold sweep removed | `offers a slot whose only occupant is an expired hold` → `Requested time is currently held.` (also proves the P2002/23P01 catch maps cleanly instead of 500ing) |
| `waitlistOfferId: null` dropped from `deleteActiveHoldsForClient` | `survives the same client starting an unrelated hold` |
| decline release removed | `expected { …(32) } to be null` |
| `releaseHold` offer branch disabled | `promise resolved "{ …(2) }" instead of rejecting` |
| TTL ceiling ignored (plain 24h) | `expected 1784773662333 to be 1784750400000` |
| client feed expiry filter removed | route test: `expected undefined to deeply equal [ { expiresAt: null }, … ]` |
| `/pro/waitlist` NOTIFIED + expiry filters removed | 2 route tests |
| calendar `NOTIFIED` filter removed | route test **and** the e2e (`element(s) not found`) |
| iOS `pendingOffer` not decoded | `waitlistOutreachDecodesTheLiveOfferOnARow` |

- **Real Postgres** — `tests/integration/waitlist-offer.test.ts`, 11 → 20 tests.
  Two are the discriminating half, because a refusal proves nothing about a gate
  that is too strict: the expired-hold ALLOW case, and the overlapping re-offer.
  `availabilityOffers()` asserts through `computeDaySlotsFast` + the real busy
  set — the slot is proven *on offer* before it is taken, so "it disappeared"
  cannot pass against a slot that was never bookable.
- **Real HTTP** (`pnpm dev:test-db`, own fixture pro + client, the actual
  routes): offer → **201** and a hold at the offered minute expiring in exactly
  24h; `/pro/waitlist` keeps the client and returns `pendingOffer`;
  `/availability/day` drops 20:00Z **and** every start whose window would collide
  (19:15–19:45, 20:15–20:45); backdating `expiresAt` empties the client feed and
  returns the pro's offer action; decline → hold gone, entry `ACTIVE`, slot back;
  re-offer → confirm → **201**, booking `ACCEPTED`, **0 holds left**, entry
  `BOOKED`.
- **Real browser** — the F5 spec gains a step 6 that asserts the reservation row
  and then reloads the calendar to find the row still listed as "Offered · …"
  with the offer action gone. Green on **chromium and mobile-chrome**; full
  chromium suite **29 passed / 2 skipped** (the 2 are a pre-existing conditional
  skip needing `E2E_LIFECYCLE_BOOKING_ID`).
- **iOS on device (iPhone 17 Pro)** — and it caught a defect no test could:
  as a trailing pill the badge squeezed the row to **"Hett…" / "Any ti…"**, and
  moving it under the name still truncated the *time* itself ("1:00…"). It now
  renders `Offered · Mon, Aug 3 · 1:00 PM · slot held` over two lines with the
  full name intact; after a decline the "Offer a time" button returns. Both
  states screenshotted, driven against the real server.
- **Cost measured, not asserted.** The advisory-lock section of
  `createWaitlistOffer` goes from p50 **10.4ms** / p95 11.5ms to p50 **11.2ms** /
  p95 12.3ms (n=50 after warmup, local Postgres) — three added queries inside the
  lock (pending-offer lookup, expired sweep, hold insert). A/B'd against
  `origin/main`'s writeBoundary in the same process, not remembered.
- **Retroactivity: nothing to migrate, re-checked this session** — prod holds
  **0** `WaitlistOffer`, **0** `WaitlistEntry` and **0** `BookingHold` rows, so
  the nullable column backfills nothing and no live offer changes behaviour.
- `typecheck` clean, `lint` 0 errors, **all 13 static guards pass** — and one
  earned its keep: `check:no-type-escape` caught an `as unknown as` I had used to
  quiet a test cast, which is now the file's existing `const raw: unknown` form.
- **705 files / 6863 unit tests**, **32 files / 168 integration tests**,
  iOS **854 tests / 111 suites**, and the iOS app itself builds (nothing in CI
  compiles `Tovis/`).

**Checked, so it is not a caveat:**

- **The merge path stays consistent.** `mergeUnclaimedClientProfile` reassigns
  holds (via `reassignClientBookings`), `WaitlistEntry` and `WaitlistOffer` by
  `clientId` in one transaction, so a reservation, its offer and its entry move
  to the surviving identity together.
- **Nothing else assumes a hold is short-lived.** `HOLD_MINUTES` has exactly one
  consumer (`performLockedCreateHold`); a 24h hold is new only in duration.
- **The cache bump cannot roll the offer back.** `bumpVersion` swallows every
  Redis failure and returns 0, so calling it inside the transaction is the same
  bet the existing hold-create and booking-create paths already make.
- **The `$transaction` return-vs-throw trap does not apply.** Every refusal after
  the first write (the supersede) throws — the gate, the expiry assert and the
  hold insert all `throw bookingError(...)`; none returns a refusal.

**Not verified / not checked:**

- **`resolveWaitlistOfferExpiry`'s throw is unreachable**, and deliberately so:
  the gate above has already required `startsAt >= now + advanceNoticeMinutes`,
  which is exactly the condition that makes the computed expiry ≥ `now`. It is an
  assertion, not a branch — proving it red would mean disabling the gate. Stated
  rather than tested, because the alternative (clamping) would ship an
  already-expired offer with a notification attached.
- **An expired offer stays `PENDING` forever, and its entry stays `NOTIFIED`.**
  Both read surfaces now treat it as gone and the pro's offer action returns, so
  nothing is user-visible — but no sweep flips the rows to `CANCELLED`/`ACTIVE`.
  Deliberate for now (reads are the truth); a cron would be tidier.
- **The pro's calendar GRID still does not draw the reservation.** The pro learns
  about it from the Waitlist tab / workspace row, not from a block on the day
  view. Adding a synthetic event would touch the calendar contract on both
  platforms, so it is out of this card's scope — noted, not hidden.

### F5 — what shipped

**The premise held, and driving it is what proved it.** Against a pro open
09:00–18:00, a 21:00 offer was created happily, the client was notified *"HTTP
Studio has Tue, Aug 11 at 9:00 PM open … Tap to confirm before it's gone"*
(the real `ClientNotification` row, read back from the DB), and
Confirm returned **400** `OUTSIDE_WORKING_HOURS` with `uiAction: PICK_NEW_SLOT`
— a picker the client does not have on the offers surface. The offer stayed
`PENDING` with `bookingId: null`, and because the pro route never sets
`expiresAt`, an unconfirmable card sits there indefinitely.

**The direction was decided from the repo, not raised with Tori.** Three pieces
of evidence, all pointing the same way:

1. `lib/booking/slotReadiness.ts` (the `mapSlotReadinessToBookingError` doc
   comment) already states the rule for the identical shape — last-minute
   opening *create* vs client *claim*: *"an opening a pro is allowed to create
   has to be one a client is allowed to hold, or the opening lands in the feed
   and every claim fails."* A waitlist offer is that shape exactly.
2. The nearest sibling agrees. Aftercare `BOOKED_NEXT_APPOINTMENT` (pro
   proposes → client confirms) validates working hours on **both** sides:
   `performLockedCreateRebookedBooking` runs `allowOutsideWorkingHours: false`
   at author time *and* at the client's confirm.
3. "Who can fix this?" — only the pro. Relaxing the confirm instead would let a
   client book outside the pro's current hours with **no**
   `BookingOverrideAuditLog` row, while `OUTSIDE_WORKING_HOURS` is
   override-gated for the pro everywhere else (`lib/booking/overridePrompts.ts`).

**So the fix is not "add a working-hours check" — it is "run the confirm's own
gate."** A second, hand-rolled check is what created this gap in the first
place. Shipped:

- `lib/booking/writeBoundary.ts` — `createWaitlistOffer` resolves its context
  through `resolveValidatedBookingContext` (the same call the confirm makes) and
  runs `enforceProCreateScheduling` with the confirm's flags:
  `allowOutsideWorkingHours` / `allowShortNotice` / `allowFarFuture` all false;
  `enforceStepGrid: false` because the **pro** picked the minute (F4's rule);
  `deferBusyConflictsToOverlapPolicy: false` because nothing runs after it to
  pick a booking/hold verdict up. `assertProfessionalIsBookingReady` was added
  for the same reason — the confirm opens with it.
- `resolveProBookingDurations`, extracted from `performLockedCreateProBooking`
  and shared, so the stored window is the **offering's** length. An offer could
  previously promise 45 minutes and book 60; `endsAt` is now derived from the
  validated duration rather than echoed from the request.
- **Two flags on `enforceProCreateScheduling` are required, not defaulted** —
  `deferBusyConflictsToOverlapPolicy` (true is only correct when the overlap
  policy runs next) and `action`. The latter adds `WAITLIST_OFFER_CREATE` to
  `BookingConflictAction`: this gate now serves a caller that writes no Booking,
  and an ops reader must be able to tell an offer refusal from a create that was
  turned away. Without it, offer refusals would have silently inflated the
  `booking_conflict action=BOOKING_CREATE` stream.

Two side effects of running the real gate, both closing smaller versions of the
same bug: the conflict window now includes the location **buffer** (the old
standalone check used the raw start/end pair), and a **non-bookable** location is
refused at offer time (`pickBookableLocation` filters `isBookable`; the old
check only looked at `type`).

**Verified. Every guard proven red first — seven mutations, one literal at a
time:**

| mutation | what goes red |
| --- | --- |
| `enforceStepGrid` false → true | integration "…not STEP_MISMATCH" (`Start time must be on a 15-minute boundary.`) + the flags test |
| `allowOutsideWorkingHours` false → true | both working-hours integration tests + the e2e (`element(s) not found` for the inline refusal) |
| `deferBusyConflictsToOverlapPolicy` false → true | "still refuses an offer over an existing booking" — the **block** test stays green, which is exactly why the booking one had to exist |
| `action` → `BOOKING_CREATE` | `expected 'BOOKING_CREATE' to be 'WAITLIST_OFFER_CREATE'` |
| duration / `endsAt` derivation reverted | "stores the offering-derived window, not a shorter requested one" |
| checked window widened by 15 min | the boundary **ALLOW** test — over-enforcement is invisible from the refusal side |
| readiness gate removed | "refuses when the pro is not booking-ready" |

- **Real Postgres** (`tests/integration/waitlist-offer.test.ts`, 6 → 11 tests):
  past-closing; before-opening asserting `OUTSIDE_WORKING_HOURS` and **not**
  `STEP_MISMATCH` (that assertion is what pins `enforceStepGrid: false`); a
  window ending *exactly* at closing that must still offer **and** confirm; and
  block/booking conflicts surviving the gate swap.
- **Real HTTP** (`pnpm dev:test-db`, a seeded pro session, the actual route):
  21:00 → **400**, 17:30 (ends 18:30) → **400**, 14:00 → **201** with the entry
  flipped to `NOTIFIED` and `endsAt` derived as start + 60.
- **Real browser** — `tests/e2e/waitlist-offer-working-hours.spec.ts`, green on
  **chromium and mobile-chrome**. The refusal is unreachable through normal UI
  (both pickers only offer `/availability/day` slots), so the spec drives the one
  path that reaches it, a **stale modal**: pick a real slot → the pro's closing
  time moves behind it → **inline refusal, modal still open, picker still live,
  nothing written** → hours restored → the same slot sends and a PENDING offer
  exists. The recovery half is the point; a refusal the pro cannot escape would
  be worse than the looseness this card closed.
- **iOS #204** — no app change was needed (`ProWaitlistOfferSheet` already
  renders `APIError.userMessage` inline with the picker live), but the sheet's
  error path had **zero** coverage: every case in `ProWaitlistTests` served 200.
  A verbatim capture of the refusal body now pins that the copy survives the
  wire — `APIClient` lifts it off `error`, so an envelope change would otherwise
  silently degrade the sheet to "Something went wrong."
  **Scope note, checked:** iOS has *two* "Offer a time" entry points and only
  one reaches this code. `ProWaitlistView.swift` opens `ProWaitlistOfferSheet`
  → the offer route (covered here); `ProCalendarManagementSheet.swift:124`
  navigates to `ProNewBookingView` and books **directly**, so it never creates
  a WaitlistOffer at all. That second path is F10's card and is unaffected —
  it already ran the pro-create working-hours gate, with the pro's own override
  available.
- **Cost measured, not asserted.** The advisory-lock section goes from
  p50 **8.7ms** / p95 9.6ms to p50 **9.8ms** / p95 11.6ms (n=50 after warmup,
  local Postgres) — two extra round trips (readiness + `pickBookableLocation`).
- **Retroactivity: nothing to migrate**, and the number says why. Prod holds
  **0** `WaitlistOffer` rows and **0** `WaitlistEntry` rows — the feature has
  never been used there.
- `typecheck` clean, `lint` 0 errors, all static guards pass, **704 files /
  6856 unit tests**, **32 files / 159 integration tests**, full chromium e2e
  **28 passed**, iOS **852 tests / 111 suites**.

**🟡 Open, and genuinely Tori's: should an offer RESERVE the slot?** The code
has no answer; here is what happens today.

- No hold is placed between offer and confirm, so the slot can be taken. That
  fails *cleanly* — pinned, and pinned to the **app gate** rather than the DB
  backstop (the offer stays `PENDING` and claimable, nothing half-written) — but
  the client was told "a spot opened up."
- The closest decided precedent went the other way. On 2026-07-20 Tori ruled
  that an aftercare `BOOKED_NEXT_APPOINTMENT` slot books a **real appointment at
  save**, reasoning recorded in the code: *"the slot is a pro-confirmed
  appointment, not a proposal, and the client has nothing to confirm."* A
  waitlist offer is different in exactly that respect — the client explicitly
  does have something to confirm, and may decline — so a **hold** is the
  analogue, not a booking.
- Cheap and related either way: the pro route never passes `expiresAt`, so
  offers never expire, even though the client-facing copy says *"before it's
  gone"* and `assertConfirmableWaitlistOffer` already honours the column. A hold
  would need a TTL; an expiry alone would bound the stale-offer problem without
  reserving anything.
- Sizing: with **0** offers in prod this is a pre-launch design call, not a
  live-data cleanup.

**Not verified / not checked:**

- ~~No iOS simulator driving.~~ **Driven, 2026-07-21.** Signed in as a seeded
  pro on iPhone 17 Pro, Profile → Waitlist → "Offer a time", picked the real
  5:00 PM slot, narrowed the pro's hours to 09:00–10:00 behind the open sheet,
  then tapped Send offer: **"That time is outside working hours." renders inline
  in ember, the sheet stays open, the picker stays live with the slot still
  selected, and the DB shows `offers: []` with the entry still `ACTIVE`.**
  Restoring the hours and tapping Send again sends the *same* slot — `PENDING`
  offer at `2026-07-22T17:00Z`, entry → `NOTIFIED`. Both halves of the web e2e,
  reproduced on device.
- **The decay window is unchanged and unclosed by design.** Offer-time
  validation cannot cover a pro who edits their hours *after* offering; that
  still refuses at confirm, with the offer left PENDING so the pro can re-offer.
  Deliberate — the pro's current configuration is the truth — but it is a
  behaviour, not a fix.
- The gate's `logAndThrowStepMismatch` branch stays unreachable from this path
  (`enforceStepGrid: false`), same as the other two callers.

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

**Driven in a real browser** — `tests/e2e/rebook-token-stale-slot.spec.ts`
(new). The refusal is unreachable through normal web UI use (the RebookCard only
offers `/availability/day` slots) and iOS has no rebook-token flow at all
(`grep -rn "client/rebook" ~/Dev/tovis-ios` returns nothing). The one path that
*can* reach it is a **stale page**, and that is what the spec drives: card
renders real slots → the pro shifts their window start 09:00 → 09:07 → the
client taps a slot that was valid when it rendered → **inline refusal, slot list
still rendered and enabled, no row written** → reload → the re-anchored grid is
offered and a slot books at :07 past the quarter hour. The last step is the
point: a refusal the client cannot escape would be worse than the looseness this
card closed. Proven red first — with the policy branch disabled the stale slot
books silently. The server log confirms the app gate fired and not some other
guard: `conflictType: STEP_BOUNDARY`, `windowStartMinutes: 547`,
`stepRemainder: 8`. Full chromium suite 28 passed.

**Retroactivity: measured, and there is nothing to migrate.** Every future
booking in prod was run through the real `isStartAlignedToWorkingWindowStep`
(9 rows). Exactly one is off-grid by `STEP_MISMATCH` — a **CANCELLED**
`AFTERCARE` rebook at 10:30 against an 11:00 window opening
(`before-window-start`), i.e. a pro-chosen time on a dead row. **Zero live rows
originate from the client rebook-token path.** Four `ACCEPTED` rows sit on a
Saturday the pro has disabled, which looked alarming and is not: each carries a
`BookingOverrideAuditLog` row with `rule: WORKING_HOURS`,
`route: writeBoundary.ts:createProBooking` — the pro overrode their own closed
day deliberately and the audit trail recorded it. (The tempting explanation —
"the hours were edited after the fact" — is **false**: the location was last
updated 2026-07-13, all four bookings were created 2026-07-18…20.)

**Not verified / not checked:**

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

---## 5. Next-session prompt

Copy-paste this to continue the queue. (Session-chaining protocol: one queue
step per session; end with a completion report + the next prompt + a status
update to the table in §4.)

> Continue the scheduling-conflict audit queue in `tovis-app`. The full findings
> and fix plan are in `docs/design/scheduling-conflict-audit-fix-plan.md` — read
> it first, especially §4's status table, **"F15 — what shipped"**,
> **"F14 — what shipped"**, **"F5 — what shipped"** and **"F3 — what shipped"**
> (each contains a trap that cost real time), and the "Not checked" list in §3.
>
> 🔴 **FIRST, THE STANDING RULE THAT OVERRIDES YOUR INSTINCT TO WRAP UP** (Tori,
> 2026-07-21; now in `CLAUDE.md` under Final self-review): **if anything is not
> clean, not perfect, or not double-checked, it is NOT finished.** Do not report
> it, caveat it, and move on — **go back, check it, and fix it.** If you catch
> yourself writing "I didn't verify X", that sentence is a work item, not a
> disclosure. Re-run the check rather than remembering its result; re-open the
> artifact rather than trusting the diff. The only acceptable open item is one you
> genuinely cannot reach from here (a credential you don't hold, a device you
> don't have, a decision that is Tori's) — and then say why it's unreachable and
> what would settle it. A caveat you could have closed in five minutes is a defect
> in the work, not a note about it.
>
> **F1 ✅ #693, F11 ✅ #694, F2 ✅ #699 (+#700, #701, iOS #203), F3 ✅ #703,
> F13 ✅ #704, F4 ✅ #705, F5 ✅ #710 (+ iOS #204), F14 ✅ #713 (+ iOS #205),
> F15 ✅ #714, F6 ✅ #716, F8 ✅ #717. NEXT = F7** (iOS: the client's mobile slot
> query drops the client's address — the first iOS-only card in the queue).
>
> ⚠️ **A prod deploy is PENDING Tori's go-ahead.** Everything through **#704** is
> live (`tovis-npx5cy47p`, 2026-07-21). **#705 (F4), #706, #707, #710 (F5),
> #713 (F14), #714 (F15), #715, #716 (F6) and #717 (F8) are merged and NOT
> deployed** — so prod still accepts a crafted off-grid start on the public rebook
> link, a waitlist offer still reserves nothing, a dead last-minute opening is
> still shown to clients, an opening can still be published over a slot booked
> microseconds earlier (or over a hold longer than its own offering), and the
> durable overlap backstop still ignores COMPLETED, until it ships. **#713 carries
> migration `20260805000000`** (`BookingHold.waitlistOfferId`) and **#717 carries
> `20260806000000`** (the widened overlap predicate), both applied by
> `prisma migrate deploy` on deploy; **#714, #715 and #716 carry none**.
> `20260806000000` was verified against prod data before merge — 0 rows would
> reject it — but it is an `ADD CONSTRAINT`, so **re-run that check if the deploy
> is much later than 2026-07-21**; the query is in "F8 — what shipped". **Deploy
> is Tori's call every time**; never infer standing permission from the last one.
>
> **If `booking.event = overlap_backstop_fired` ever appears in Slack
> `#tovis-ops-alerts`, drop everything** — that is the F3 refactor breaking in
> production. It has never fired; the path is proven by configuration, not by
> observation.
>
> ## Your card: F7 — iOS client mobile slots ignore the client's address
>
> `Tovis/BookingFlowView.swift:453` omits `clientAddressId` when it asks
> `/availability/day` for slots, but **sends it** on `createHold` at `:486`. So
> mobile slots are computed against the pro's base rather than the client's travel
> radius, and a slot the app happily offers can be refused at hold time. Read card
> **F7** in §2. The web client passes it (`useDaySlots.ts:104`) and so does the
> pro-side picker (`ProOpenSlotPicker.swift:108`) — this is a genuine web↔iOS gap,
> not a spec question.
>
> **This is the first iOS-only card in the queue, and iOS claims in this document
> are CODE READS.** F14 is the precedent worth remembering: its premise held, but
> only driving the simulator revealed a layout defect no test could see. The
> repo's own rule (`green-tests-wrong-artifact`) is to drive the real thing —
> `scripts/sim-login.sh`, and taps go through `group 1 of window 1` via cliclick.
> Confirm on-device that the offered slots actually change once the address is
> passed; a one-line diff that compiles is not evidence.
>
> **Check the parameter is plumbed, not just added.** Before assuming it is a
> one-liner: verify `booking.day()` in `TovisKit` forwards it, that the client's
> selected address is in scope at `:453` (it may be chosen *after* the day query
> in the flow's order), and what the endpoint does with a **nil** address for a
> MOBILE offering — offering every slot and refusing at hold is the bug; offering
> none would be a different one.
>
> **What F8 just proved, and applies directly here.** The doc's own recommendation
> for F8 (drop COMPLETED) was **wrong**, and what killed it was one lookup —
> `advanceNoticeMinutes` defaults to 15, so the "safe" cleanup would have exposed
> the pro's travel buffer. A recommendation written by an earlier session is not
> evidence; go and read the number it rests on.
>
> **Order from here: F7 (iOS) → F9 → F10 (iOS) → F12 → F16.**
> Tori wants the ENTIRE queue closed. F12 needs UI on web **and** iOS before its
> server half can ship; F16 (new, opened by F15) is the same shape.
>
> ## ✅ Both Tori rulings from 2026-07-21 are ANSWERED — do not re-ask
>
> *"if a pro chooses a time it should reserve the spot. if a pro gives a time
> window it shouldn't reserve a specific spot"* → **F14, shipped (#713)**.
> *"if a time is outside a pro's working hours, blocked off by the pro, or already
> booked it shouldn't be visible to the client at all"* → **F15, shipped (#714)**:
> five client-facing surfaces now run the commit gate at read time, and the
> answer to "hidden or shown as expired" was **hidden**, with the notified client
> answered at the claim page ("This opening is no longer available"), which names
> no time.
>
> ## House rules that have bitten across ten sessions (all in `CLAUDE.md`)
>
> - **Don't guess — read the tool's own output, or ask.** A red check is not yours
>   until you prove it can reach your code. F15's live example: one e2e run aborted
>   mid-suite; the implicated spec turned out to `goto` only `/login` and to
>   document its own real-time wait, and it passed four times after.
> - **Prove a guard fails before trusting that it passes.** Every guard in #703,
>   #704, #705, #710, #713 and #714 was proven red first — #713 took twelve
>   mutations, #714 took nine.
> - **Ask which LAYER made a test pass; to isolate a permissive layer, test what it
>   should ALLOW.** F15's live example: six of its thirteen new integration tests
>   are ALLOW cases, because a suite of "it disappeared" assertions passes against
>   a filter that hides everything.
> - **Branch on the domain FACT, not on its consequences.** F15 started with an
>   `enforceStepGrid` boolean and got it wrong: the real fact is WHICH GATE commits
>   the row, and it decides two unrelated things. Make such a field **required**;
>   TypeScript then finds every call site.
> - **Ask "who can fix this?" of every new refusal, reservation — and now
>   disappearance.** F15 hides a dead opening from clients; the pro who caused it
>   still sees `ACTIVE` with no explanation. That became F16 rather than a caveat.
> - **Setting a field the reads don't filter on creates the bug you were closing** —
>   and its mirror: **a read that doesn't discount the row's OWN reservation hides
>   everything.** F14's hold would have made every waitlist offer hide itself from
>   F15's filter.
> - **`toMatchObject` does not typecheck.** Renaming a candidate field compiled
>   clean and broke four route tests at runtime. Run the suites after a rename.
>
> ## Verification tools, proven and worth reusing
>
> - `pnpm test:integration` (needs the test-postgres container on :5433).
>   ⚠️ needs a keyring **in CI's exact shape** or two suites fail:
>   `PII_AEAD_KEYS_JSON` keyed by `address-aead-v1` / `email-aead-v1` /
>   `phone-aead-v1` / `notes-aead-v1`, plus `PII_LOOKUP_HMAC_KEYS_JSON` and
>   `JWT_SECRET`. Copy `.github/workflows/integration.yml:88`. Generate the keys
>   ONCE into a file and source it — regenerating per run breaks decryption of
>   rows an earlier run left behind.
> - **Proving a write really takes the advisory lock — from OUTSIDE the app**
>   (F6, and the only proof that survives a mocked client). Hold the lock in a
>   psql session and time the real HTTP request against it:
>   `docker exec -e PGPASSWORD=postgres tovis-test-postgres psql -U postgres -d
>   tovis_test -c "BEGIN; SELECT pg_advisory_xact_lock(41021::int4,
>   hashtext('<professionalId>')::int4); SELECT pg_sleep(5); COMMIT;" &` then
>   `curl -w '%{time_total}'`. **4.1s = the lock is taken; ~0.1s = it is not.**
>   `41021` is `BOOKING_SCHEDULE_LOCK_NAMESPACE` (`lib/booking/scheduleLock.ts:4`).
> - **In-suite version of the same race** (`tests/integration/opening-create-lock.test.ts`,
>   F6): a rival `$transaction` takes the lock, writes, then parks on a JS promise
>   the test resolves, so there is no sleep-and-hope. ⚠️ Release it in a
>   `finally` — an assertion failing first strands the transaction on its
>   connection for Prisma's full 20s timeout and turns a 50ms red into a 20s one.
> - ⚠️ **A hand-built fixture user 403s `VERIFICATION_REQUIRED` on every authed
>   route** until `emailVerifiedAt` AND `phoneVerifiedAt` are both set
>   (`lib/currentUser.ts:135`). Costs a cycle if you read it as an auth-token
>   problem.
> - ⚠️ **A scratch script outside the repo cannot resolve `@prisma/client`** —
>   run it with `NODE_PATH=/Users/torimorales/Dev/tovis-app/node_modules npx tsx`
>   rather than copying it into the tree (where it can be committed by accident).
> - `tests/integration/opening-liveness.test.ts` (F15) is the newest compact
>   real-Postgres pattern and the one closest to F6: it builds its openings with
>   **`createLastMinuteOpening` itself**, so every fixture is proven publishable
>   before the test kills its slot. Gotchas it encodes: `tierPlans` must carry
>   **all three** tiers; `lastMinuteSettings` must exist and be `enabled`;
>   `Booking` needs `subtotalSnapshot` + `proTenantId` + `clientHomeTenantId` and
>   the timezone column is **`locationTimeZone`**, not `timeZone`; `CalendarBlock`'s
>   note column is `note`; a suite creating holds must `bookingHold.deleteMany`
>   before the location (`ProfessionalLocation` RESTRICTs a referencing hold).
> - `computeDaySlotsFast` (`lib/availability/core/dayComputation.ts`) is callable
>   straight from a test — book a slot the availability engine **actually emitted**.
>   ⚠️ `dateYMD` is a **`YMD` object**, not a string.
> - **Browser:** 🔴 **NEVER bare `npx playwright test`** — it skips the
>   `dotenv -e .env.e2e.local -e .env.local` layering, so `DATABASE_URL` falls back
>   to `.env.local`, which is **PROD**.
>   - ⚠️ **`pnpm test:e2e:local -- <args>` swallows the args.** One spec:
>     `pnpm exec dotenv -e .env.e2e.local -e .env.local -- playwright test <spec>
>     --project=chromium --no-deps`.
>   - Full run: seed first with the e2e's own env
>     (`pnpm exec dotenv -e .env.e2e.local -e .env.local -- pnpm db:test:seed`),
>     then run **both** `--project=chromium` and `--project=mobile-chrome`.
>     Baseline is **29 passed / 2 skipped** each; the 2 are a pre-existing
>     conditional skip needing `E2E_LIFECYCLE_BOOKING_ID`.
>   - ⚠️ `booking-lifecycle.spec.ts` sleeps in REAL TIME for a quarter-hour window
>     (its own comment says so, `test.setTimeout(240_000)`). Locally `retries: 0`,
>     so one slow cycle aborts the whole run with "N did not run". Re-run before
>     owning it.
> - `pnpm dev:test-db` runs a real server against the test DB. Auth is a **bearer
>   token**, not a cookie: `DATABASE_URL=…5433… npx tsx scripts/dev/mint-dev-jwt.ts
>   --email <x>` then `curl -H "Authorization: Bearer $TOKEN"`. ⚠️ A stale `.next`
>   404s every `/api/v1/*` route while `/api/health` answers 200; `rm -rf .next`.
>   State-changing requests need an `origin` header (proxy.ts CSRF gate).
> - **iOS simulator against the TEST db** (proven again in F15):
>   `xcodebuild build -project tovis-ios.xcodeproj -scheme Tovis -configuration
>   Debug -destination "id=<udid>"`, `xcrun simctl install`, then
>   `SIMCTL_CHILD_TOVIS_DEBUG_TOKEN="$TOKEN" xcrun simctl launch <udid>
>   app.tovis.Tovis`. ⚠️ `scripts/sim-login.sh --email` mints against the **dev**
>   DB (:5434) and fails for a test-DB fixture — mint the token yourself.
>   Taps need `cliclick` mapped through **`group 1 of window 1`**
>   (`osascript -e 'tell application "System Events" to tell process "Simulator" to
>   get {position, size} of group 1 of window 1'`); the screenshot is 1206×2622 and
>   scales linearly into that rect. A first launch shows the notifications prompt —
>   dismiss it before anything else.
> - **Prod reads via the Supabase MCP** (project `rqhhvuaoksuvbvlypztn`, "tovis-dev"
>   IS prod). Answers "is this retroactive?" with a number — F15 re-checked **0**
>   rows in `LastMinuteOpening` / `LastMinuteRecipient` / `WaitlistOffer` /
>   `WaitlistEntry` / `BookingHold`.
> - **A/B a perf claim in one process** rather than trusting a remembered number:
>   short-circuit the new code with a `python3` patch, measure, restore from a
>   `$TMPDIR` copy, `diff` to prove the restore. ⚠️ At small N the dev server's
>   noise exceeds the signal — scale the fixture until the difference is real
>   (F15 needed 20 rows to see +18ms).
> - 🔴 **The Bash tool's working directory persists between calls.** Prefix
>   commands with an absolute `cd`, and never `git stash` to make a temporary edit —
>   the app repo carries sibling sessions' stashes.
> - Deploy verification (reusable): `npx vercel --prod --yes`, then check the REAL
>   thing rather than the exit code — `vercel inspect`, the live domain
>   (`www.tovis.me`), the `_prisma_migrations` row via the Supabase MCP, and
>   unauthenticated POST probes expecting 401/400 and **never** 500.
> - Observability: booking-domain alerts go through
>   `lib/observability/bookingEvents.ts`. An active catch-all Sentry rule routes
>   every NEW issue in `tovis-app` to Slack `#tovis-ops-alerts`.
> - CI: `security-scan` / "Dependency audit" is **green** on main (#706 pinned
>   `sharp` and `@babel/core` forward with `pnpm.overrides`). Those entries are a
>   ceiling, not a cure — prune them when `next` ships its own patched range.

---

## 5. Next session — paste this in

This chain keeps its prompt here, not in the `NEXT-SESSION-PROMPT.md` memory
(that file belongs to the personalization/ranking chain). Overwrite this section
each session.

```
Do ONE step of the scheduling-conflict audit fix queue: F12.

Read `docs/design/scheduling-conflict-audit-fix-plan.md` FIRST — it is both the
queue AND the write-ups, including which card premises did NOT survive contact.
Do not re-derive what is already written there. F1–F9, F11 and F13–F16 are done;
only F10 and F12 remain.

F12 — "consultation proposal is authored with zero schedule validation" 🟠. Read
the card in §2 and F2's two write-ups in §4 ("F2 — the follow-ups that only
turned up by LOOKING" and "F2 — what shipped"): F12 was opened BY F2, which
fixed the APPROVE side (the extension is now checked against blocks and hours)
and deliberately left the PROPOSE side alone. So the pro can still author a
consultation time nothing validated, and the client only finds out at approve.
It is a two-platform card — check what iOS sends and shows before deciding the
server shape.

Things earlier cards left that bear on F12 specifically:
- F16 shipped `lib/lastMinute/proOpeningVisibility.ts`, the first consumer that
  EXPLAINS a `checkStoredSlotsAreOpen` verdict rather than acting on it. If F12
  wants to warn a pro at proposal time rather than refuse, that file is the
  precedent for the shape (13 states, exhaustive switch, silent by default).
- F16 also found that adding a schedule check to a route that has ALREADY
  WRITTEN turns a query failure into a 500 for work that succeeded. If F12 adds
  validation to a write path, decide deliberately whether it refuses (before the
  write) or informs (after it) — and never let a display concern fail a commit.
- `StoredSlotDeadReason` now carries `LOCATION_NOT_FOUND` / `TIMEZONE_REQUIRED`
  separately (F16 split what F15 collapsed). Nothing else needs changing there.

House rules apply — read CLAUDE.md. In particular: diff/verify before assuming a
card's premise holds, prove every new guard RED before calling it green, include
at least one ALLOW case, and drive the real artifact — the page and the
simulator — not just the tests.

Ship cadence: branch off origin/main, one PR per repo touched, watch CI, merge
when green, fast-forward local main. 🚫 Do NOT deploy to Vercel — that stays
Tori's call. Note in the report that #705–#721 are merged and still awaiting a
prod deploy (two migrations pending, one an ADD CONSTRAINT worth re-checking).

Do not start other workstreams. If F12 finishes early, wrap up and hand off
rather than pulling F10 in.
```
