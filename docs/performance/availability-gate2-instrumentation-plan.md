# Gate 2 — Availability Instrumentation Plan

Status: DRAFT  
Scope: Availability flow only

This file defines the exact instrumentation shape needed to produce measured evidence for Gate 2.

---

## Goal

Add durable timing instrumentation for the five required Gate 2 metrics:

1. `drawer_open_to_first_usable_ms`
2. `day_switch_to_times_visible_ms`
3. `hold_request_latency_ms`
4. `continue_to_add_ons_ms`
5. `background_refresh_ms`

This instrumentation must support:
- repeatable Playwright perf collection
- percentile aggregation
- CI budget checks
- future regression comparison

---

## File placement

### New client instrumentation helper files
- `app/(main)/booking/AvailabilityDrawer/perf/availabilityPerf.ts`
- `app/(main)/booking/AvailabilityDrawer/perf/availabilityPerfTypes.ts`

### Existing files that will call the helper
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`
- `app/(main)/booking/AvailabilityDrawer/hooks/useAvailability.ts`
- `app/api/holds/route.ts`
- `app/(main)/booking/add-ons/ui/AddOnsClient.tsx`

### Later consumers
- `tests/perf/...`
- `scripts/perf/...`

---

## Measurement model

### Naming rule
Every metric name must exactly match the Gate 2 budget file.

### Required metric names
- `drawer_open_to_first_usable_ms`
- `day_switch_to_times_visible_ms`
- `hold_request_latency_ms`
- `continue_to_add_ons_ms`
- `background_refresh_ms`

### Event model
Use a small helper that supports:
- `startMetric(name, meta?)`
- `endMetric(name, meta?)`
- `cancelMetric(name, reason?)`
- `recordDuration(name, durationMs, meta?)`

### Browser storage model
Store captured measurements on:
- `window.__tovisAvailabilityPerf`

Recommended structure:
```ts
type AvailabilityPerfEntry = {
  metric: string
  durationMs: number
  startedAt: number
  endedAt: number
  meta?: Record<string, unknown>
}

type AvailabilityPerfStore = {
  entries: AvailabilityPerfEntry[]
  active: Record<string, { startedAt: number; meta?: Record<string, unknown> }>
}
```

This is intentionally simple so Playwright can read it without ceremony.

---

## Exact instrumentation plan by metric

## 1) drawer_open_to_first_usable_ms

### Start
Start when the drawer-open flow begins.

### Best call site
`AvailabilityDrawer.tsx`

### Proposed trigger
When the drawer opens and the one-time “opened” tracking path runs.

### Meta to capture
- professionalId
- serviceId
- offeringId
- bookingSource
- locationType

### Stop
End when the drawer is truly usable.

### Best stop call site
`AvailabilityDrawer.tsx`

### Stop conditions
All true:
- summary exists
- primary exists
- summary skeleton is gone
- day scroller has data
- primary day slots are not loading
- slot chips are ready for interaction

### Important rule
Do not stop on “drawer visible” alone.  
Visible is not usable.

---

## 2) day_switch_to_times_visible_ms

### Start
Start when a different day is selected in the day scroller.

### Best call site
`AvailabilityDrawer.tsx`

### Proposed trigger
Inside the `DayScroller` `onSelect` handler before `setSelectedDayYMD(...)`.

### Meta to capture
- previousDayYMD
- nextDayYMD
- locationType
- serviceId
- bookingSource

### Stop
End when selected-day slots are ready.

### Best stop call site
`AvailabilityDrawer.tsx`

### Stop conditions
- `selectedDayYMD` is set to the requested day
- `loadingPrimarySlots === false`
- slot chips for that day are rendered and interactive

### Important rule
Key this metric by day so back-to-back day switches do not overwrite each other.

Recommended active key shape:
- `day_switch_to_times_visible_ms:${selectedDayYMD}`

---

## 3) hold_request_latency_ms

### Start
Start immediately before `fetch('/api/holds', ...)`.

### Best call site
`AvailabilityDrawer.tsx`

### Meta to capture
- professionalId
- offeringId
- selectedDayYMD
- slotISO
- locationType
- bookingSource

### Stop
End immediately after the fetch promise resolves with the HTTP response.

### Best call site
`AvailabilityDrawer.tsx`

### Important rule
Record the raw client-observed duration even if the request fails.

### Server-side companion
Also add server timing in:
- `app/api/holds/route.ts`

Recommended:
- total route duration
- optional subspans if cheap to add

Preferred output:
- `Server-Timing` response header, or
- perf-only response meta, or
- structured log for CI capture

### Why both sides matter
- client timing = user experience
- server timing = backend bottleneck visibility

---

## 4) continue_to_add_ons_ms

### Start
Start immediately before closing drawer / navigating to add-ons.

### Best call site
`AvailabilityDrawer.tsx`

### Meta to capture
- holdId
- offeringId
- selectedDayYMD
- slotISO
- locationType
- bookingSource

### Stop
End when the add-ons page is interactive.

### Best stop call site
`AddOnsClient.tsx`

### Preferred stop condition
Primary:
- `booking-add-ons-continue-button` visible

Fallbacks:
- `booking-add-ons-list` visible
- `Add-ons` heading visible

### Important rule
Use the primary stop if possible because it proves the page is not just painted, but actionable.

---

## 5) background_refresh_ms

### Start
Start when a non-blocking refresh begins while visible data remains on screen.

### Best call site
`useAvailability.ts`

### Proposed trigger
Background refresh path where:
- visible cached or stale data already exists
- `setRefreshing(true)` is called

### Meta to capture
- locationType
- serviceId
- includeOtherPros
- cacheState (`stale` or `cached-primary` or `cached-full`)

### Stop
End when refreshed data has been applied and refreshing is cleared.

### Best stop call site
`useAvailability.ts`

### Stop conditions
- refreshed data merge completed
- `setRefreshing(false)` about to run or has run
- no blocking reset occurred

### Important rule
Only measure true background refreshes.  
Do not mix blocking initial loads into this metric.

---

## Guardrails

### 1. Fail-open behavior
Perf instrumentation must never break the booking flow.

### 2. Low overhead
No heavy logging, no network calls from instrumentation.

### 3. Safe in production
Instrumentation can exist in production code if it is:
- small
- side-effect light
- passive unless read by tests

### 4. Handle cancellation
If a metric starts but the UI path is abandoned, cancel it instead of writing nonsense data.

Examples:
- drawer closed before usable
- day switched again before prior day completed
- hold request superseded by a different slot pick

---

## Minimal helper API

Recommended helper surface:
```ts
export function startAvailabilityMetric(
  metric: string,
  meta?: Record<string, unknown>,
  key?: string,
): void

export function endAvailabilityMetric(
  metric: string,
  meta?: Record<string, unknown>,
  key?: string,
): void

export function cancelAvailabilityMetric(
  metric: string,
  reason?: string,
  key?: string,
): void

export function getAvailabilityPerfStore(): AvailabilityPerfStore
```

### Key rule
Support optional `key` so concurrent or repeated actions are safe.

Examples:
- `day_switch_to_times_visible_ms:2026-04-01`
- `hold_request_latency_ms:2026-04-01T10:30:00Z`

---

## Playwright-readiness requirement

At minimum, Playwright must be able to run:
```ts
await page.evaluate(() => window.__tovisAvailabilityPerf)
```

and receive:
- all completed metric entries
- enough metadata to identify scenario type

That is the whole point of this layer.

---

## What Step 3 completes

Once this plan is accepted, Step 3 is complete because we will have:
- exact helper file names
- exact metrics
- exact call sites
- exact start/stop semantics
- exact storage contract for Playwright

---

## Next exact step

Step 4 is the perf collection plan:
- perf Playwright file names
- scenario count
- raw artifact format
- percentile aggregation inputs
