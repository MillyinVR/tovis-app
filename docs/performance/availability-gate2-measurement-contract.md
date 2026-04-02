# Gate 2 — Availability Measurement Contract

Status: DRAFT  
Scope: Availability flow only

This file translates the Gate 2 budget metrics into exact implementation seams based on the current availability drawer flow and add-ons page.

---

## Metric 1: drawer_open_to_first_usable_ms

### Start seam
Availability drawer open trigger is activated by the user.

### Current implementation anchor
`AvailabilityDrawer.tsx`
- emits `availability_drawer_opened`

### Stop seam
First usable state is reached when all are true:
- summary exists
- primary pro exists
- not in summary skeleton / blocking loading state
- day scroller has rendered days
- primary day slots are not loading
- primary slot chips are rendered for the selected day

### Current implementation anchors
`AvailabilityDrawer.tsx`
- `summary && primary`
- `summaryDaysLoading === false`
- `dayScrollerDays.length > 0`
- `daySlotsLoading === false`
- `trackAvailabilityEvent('availability_day_slots_loaded', ...)`

### Recommended measured stop
Use a dedicated perf mark when the drawer is usable, not just when the telemetry event fires.

---

## Metric 2: day_switch_to_times_visible_ms

### Start seam
User selects a day in `DayScroller`.

### Current implementation anchor
`AvailabilityDrawer.tsx`
- `onSelect={(ymd) => { ... setSelectedDayYMD(ymd) }}`

### Stop seam
Selected day slot load completes and slot chips are ready for interaction.

### Current implementation anchors
`AvailabilityDrawer.tsx`
- `loadingPrimarySlots === false`
- `selectedDayYMD` set
- `trackAvailabilityEvent('availability_day_slots_loaded', ...)`

### Recommended measured stop
Use a dedicated perf mark keyed by selected day once the new slot list is visible and ready.

---

## Metric 3: hold_request_latency_ms

### Start seam
Client starts POST `/api/holds` from `onPickSlot`.

### Current implementation anchor
`AvailabilityDrawer.tsx`
- `trackAvailabilityEvent('availability_hold_requested', ...)`
- `fetch('/api/holds', { method: 'POST', ... })`

### Stop seam
HTTP response for POST `/api/holds` is received.

### Current implementation anchors
`AvailabilityDrawer.tsx`
- `const res = await fetch('/api/holds', ...)`

### Recommended measured stop
Record both:
- client-observed request duration
- server-side route duration via `Server-Timing` or structured perf meta

---

## Metric 4: continue_to_add_ons_ms

### Start seam
User clicks Continue / Continue to add-ons.

### Current implementation anchor
`AvailabilityDrawer.tsx`
- `trackAvailabilityEvent('availability_continue_clicked', ...)`
- `onContinue()`

### Stop seam
Add-ons page canonical ready signal is visible.

### Current implementation anchors
`AddOnsClient.tsx`
- page heading `Add-ons`
- `data-testid="booking-add-ons-list"`
- `data-testid="booking-add-ons-continue-button"`
- `data-testid="booking-add-ons-skip-button"`

### Recommended measured stop
Use the first canonical ready signal that proves the page is interactive:
1. `booking-add-ons-continue-button` visible, or
2. `booking-add-ons-list` visible, or
3. `Add-ons` heading visible

Preferred primary stop:
- `booking-add-ons-continue-button` visible

Reason:
That proves navigation completed and the page is actionable, not merely painted.

---

## Metric 5: background_refresh_ms

### Start seam
Background refresh starts while visible availability data remains on screen.

### Current implementation anchors
`useAvailability.ts`
- `setRefreshing(true)` in background refresh path

`AvailabilityDrawer.tsx`
- `backgroundRefreshing = refreshing`
- background message:
  `Updating availability in the background…`

### Stop seam
Refreshed data has been applied and `refreshing === false`.

### Current implementation anchor
`useAvailability.ts`
- refresh flow completes and `setRefreshing(false)`

### Recommended measured stop
Use explicit perf marks around the refresh lifecycle instead of inferring from UI text alone.

---

## Existing telemetry already present

The current drawer already emits these events:
- `availability_drawer_opened`
- `availability_summary_loaded`
- `availability_day_slots_loaded`
- `availability_hold_requested`
- `availability_hold_succeeded`
- `availability_continue_clicked`

These are useful seams, but they are not enough by themselves for Gate 2 because they do not currently record:
- elapsed milliseconds
- p50/p95/p99
- run conditions
- regression thresholds

---

## What is now resolved

Resolved:
- drawer open start seam
- first usable candidate seams
- day switch start seam
- day slots loaded candidate stop seam
- hold request start seam
- hold request stop seam
- continue start seam
- continue stop seam
- background refresh visibility seam

---

## File placement

### These files belong in `docs/performance/`
- `availability-gate2-budget.md`
- `availability-gate2-budget.json`
- `availability-gate2-measurement-contract.md`
- later: `availability-gate2-evidence.md`
- later: `baselines/availability-gate2-baseline.json`

### These do NOT belong in `docs/performance/`
They stay next to the code they control:

- instrumentation helpers:
  - `app/(main)/booking/AvailabilityDrawer/perf/...`
- route timing changes:
  - `app/api/holds/...`
- perf Playwright tests:
  - `tests/perf/...`
- aggregation / budget check scripts:
  - `scripts/perf/...`
- CI workflow:
  - `.github/workflows/...`
- run artifacts:
  - `artifacts/perf/...`

Rule of thumb:
- docs and baselines go in `docs/performance`
- executable code does not

---

## Next exact step

Step 3 is the instrumentation plan.
That is where we define the exact helper file(s) and the exact marks/measures to add.
