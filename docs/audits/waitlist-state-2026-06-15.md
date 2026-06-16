# Waitlist feature — state audit (2026-06-15)

Audit of the waitlist feature after the dead-weight cleanup (PR #173, commit `ad60a592`).
No code was changed. This is a read-only assessment.

## TL;DR

The cleanup deleted **one** waitlist file — `app/client/components/WaitlistBookings.tsx`
(467 lines, the client's view/edit/cancel UI). It was **already orphaned** (not imported
anywhere) before the cleanup, so the removal was correct and broke nothing (no dangling
imports remain). But it confirms that **client-side waitlist management was already
disconnected** before this session.

Working slice today: **join (client) → match (engine) → notify/manage (pro)**.
Missing slice: **client self-service management** (edit preference / leave waitlist).

## What got deleted

| File | Lines | Wired in before deletion? |
|---|---|---|
| `app/client/components/WaitlistBookings.tsx` | 467 | No — only self-referenced. Already dead. |

It would have provided: list entries, edit preference (`PATCH /api/waitlist`),
cancel/leave (`DELETE /api/waitlist`).

## What's still present and working

- **Data layer (intact):** `WaitlistEntry` model + `WaitlistStatus` /
  `WaitlistPreferenceType` / `WaitlistTimeOfDay` enums + 4 migrations
  (incl. message-thread link). Nothing dropped.
- **Client JOIN (works):** `app/(main)/booking/AvailabilityDrawer/components/WaitlistPanel.tsx`
  → `POST /api/waitlist`. Only client caller of the API; POST-only.
- **Client SEE (read-only):** `app/client/_components/ClientWaitlistStrip.tsx` — display
  only, just links to pro/discover. No edit/cancel. Reads from
  `app/client/_data/getClientHomeData.ts` (not from `/api/client/bookings`).
- **Pro side (intact):** waitlist threads in `app/messages/page.tsx` +
  `app/messages/thread/[id]/page.tsx`; calendar styling/stats in
  `app/pro/calendar/_components/`.
- **Matching engine (intact):** `lib/lastMinute/audience/buildTier1WaitlistAudience.ts`
  matches waitlisted clients to last-minute openings (Tier 1), all 4 preference types
  incl. `TIME_RANGE`.
- **API endpoints (all exist):** `POST` / `PATCH` / `DELETE` in `app/api/waitlist/route.ts`.

## Gaps the cleanup exposed (nothing broken, but loose)

1. **No client management UI.** `PATCH` and `DELETE /api/waitlist` work but are no longer
   called by any client code — that was WaitlistBookings' job. Client can join, can't
   edit/leave from the UI.
2. **Orphaned helpers.** `WaitlistLike` and `waitlistLocationLabel` in
   `app/client/components/_helpers.tsx` are now only self-referenced. Dead remnant.
3. **API serving unconsumed data.** `app/api/client/bookings/route.ts` still computes a
   full `waitlist` bucket (line ~300), but its consumer (WaitlistBookings) is gone.
4. **Pre-existing (not from cleanup):** `TIME_RANGE` supported in DB/API/matching but not
   exposed in `WaitlistPanel` UI; `waitlistToday` in pro calendar stats is a hardcoded
   empty placeholder (`CalendarStatsPanel.tsx`).

## Options when ready (not started)

- **Restore management UI** — recover/rebuild WaitlistBookings, wire to PATCH/DELETE.
- **Add cancel to the strip** — inline "Leave waitlist" (DELETE) on ClientWaitlistStrip; skip full edit.
- **Leave join-only + clean leftovers** — remove orphaned `_helpers` exports + unconsumed
  `/api/client/bookings` waitlist bucket.

Decision: deferred (audit only).
