# Availability Drawer Enterprise Contract

Status: PROPOSED  
Owner: Tori Morales  
Scope: Booking availability drawer, availability APIs, and related client contract

## Purpose

This document defines the enterprise contract for the availability drawer.

The goal is simple:

- the drawer must feel immediate
- exact visible time slots must be authoritative
- no client path may present stale or guessed slot data as current
- the system must scale operationally, not just technically

This contract separates advisory availability data from authoritative slot data, defines the API boundaries, and sets the non-negotiable rules for loading, caching, invalidation, and UI behavior.

---

## Core principles

### 1. Exact visible slots are authoritative
A time chip shown as bookable must come from a current server response for the active request context.

Visible slot chips must not be rendered from:
- blind client TTL cache
- previous drawer session memory
- stale summary seed data reused without version validation
- data for a different day, location mode, address, add-on selection, or duration

### 2. Summary data is advisory
Summary data helps the user navigate. It is not the final booking truth.

Examples of advisory data:
- available days
- slot counts by day
- primary pro card
- alternate-pro cards
- location-mode availability hints
- waitlist support
- summary window pagination

### 3. Bootstrap data may paint the initial selected day
The initial selected day returned by the bootstrap response is authoritative for first paint only because it belongs to the current request.

That is different from replaying old client memory.

### 4. Version beats TTL
Server-side TTL may be used for eviction and performance.
Freshness must be determined by a version token, not by time alone.

### 5. The hold endpoint remains the final arbiter
Even with perfect freshness, concurrent users can still claim the same slot between render and hold creation.

The enterprise guarantee is:
- never knowingly render stale slots as current
- make current requests authoritative
- let hold creation resolve true concurrency

---

## Contract vocabulary

### Advisory data
Availability information that helps navigation but does not itself reserve or guarantee a slot.

### Authoritative data
Exact slot data that is safe to render as currently selectable for the active request context.

### Request context
The full set of inputs that can affect slot truth, including:
- professional
- service
- offering
- location type
- location id
- client address id
- selected date
- add-ons
- effective duration
- schedule version inputs

### Availability version
A server-generated freshness token representing the slot-relevant state for a given request context.

---

## Target API surface

The drawer should use three routes with separated concerns.

### 1. `GET /api/availability/bootstrap`
Purpose:
- first drawer paint
- summary window
- authoritative selected-day slots for the server-chosen initial day

Returns:
- request context summary
- summary window metadata
- available days with counts
- selected day
- authoritative slots for selected day
- primary pro metadata
- alternate-pro metadata only
- offering metadata
- waitlist support
- `availabilityVersion`
- `generatedAt`

### 2. `GET /api/availability/day`
Purpose:
- authoritative exact slots for one selected day

Returns:
- selected day context
- exact slots for that day
- slot boundaries / timing metadata
- `availabilityVersion`
- `generatedAt`

### 3. `GET /api/availability/alternates`
Purpose:
- batched alternate-pro slots for the currently selected day

Returns:
- selected day context
- batched alternate-pro slot payloads
- `availabilityVersion`
- `generatedAt`

---

## Response contracts

## Bootstrap response

```ts
type AvailabilityBootstrapResponse =
  | {
      ok: true
      mode: 'BOOTSTRAP'
      request: {
        professionalId: string
        serviceId: string
        offeringId: string | null
        locationType: 'SALON' | 'MOBILE'
        locationId: string
        clientAddressId: string | null
        addOnIds: string[]
        durationMinutes: number
      }
      availabilityVersion: string
      generatedAt: string
      timeZone: string

      windowStartDate: string
      windowEndDate: string
      nextStartDate: string | null
      hasMoreDays: boolean

      availableDays: Array<{
        date: string
        slotCount: number
      }>

      selectedDay: {
        date: string
        slots: string[]
      } | null

      primaryPro: {
        id: string
        businessName: string | null
        avatarUrl: string | null
        location: string | null
        offeringId: string
        locationId: string
        timeZone: string
        isCreator: true
      }

      otherPros: Array<{
        id: string
        businessName: string | null
        avatarUrl: string | null
        location: string | null
        offeringId: string
        locationId: string
        timeZone: string
        distanceMiles: number | null
      }>

      offering: {
        id: string
        offersInSalon: boolean
        offersMobile: boolean
        salonDurationMinutes: number | null
        mobileDurationMinutes: number | null
        salonPriceStartingAt: string | null
        mobilePriceStartingAt: string | null
      }

      waitlistSupported: boolean
    }
  | {
      ok: false
      error: string
      timeZone?: string
      locationId?: string
    }
```

## Day response

```ts
type AvailabilityDayResponse =
  | {
      ok: true
      mode: 'DAY'
      request: {
        professionalId: string
        serviceId: string
        offeringId: string | null
        locationType: 'SALON' | 'MOBILE'
        locationId: string
        clientAddressId: string | null
        addOnIds: string[]
        durationMinutes: number
        date: string
      }
      availabilityVersion: string
      generatedAt: string
      timeZone: string
      stepMinutes: number
      leadTimeMinutes: number
      locationBufferMinutes: number
      adjacencyBufferMinutes: number
      maxDaysAhead: number
      dayStartUtc: string
      dayEndExclusiveUtc: string
      slots: string[]
    }
  | {
      ok: false
      error: string
      timeZone?: string
      locationId?: string
    }
```

## Alternates response

```ts
type AvailabilityAlternatesResponse =
  | {
      ok: true
      mode: 'ALTERNATES'
      request: {
        serviceId: string
        offeringId: string | null
        locationType: 'SALON' | 'MOBILE'
        locationId: string
        clientAddressId: string | null
        addOnIds: string[]
        durationMinutes: number
        date: string
      }
      availabilityVersion: string
      generatedAt: string
      selectedDay: string
      alternates: Array<{
        pro: {
          id: string
          businessName: string | null
          avatarUrl: string | null
          location: string | null
          offeringId: string
          locationId: string
          timeZone: string
          distanceMiles: number | null
        }
        slots: string[]
      }>
    }
  | {
      ok: false
      error: string
    }
```

---

## Availability version rules

`availabilityVersion` must change whenever slot truth can change for the request context.

At minimum it must reflect:
- schedule version
- schedule config version
- booking and hold conflicts affecting the request context
- blocks affecting the request context
- professional id
- service id
- offering id
- location type
- location id
- client address id when mobile availability depends on it
- add-on selection when it changes duration or eligibility
- effective duration
- selected date for day and alternates responses

### Rule
The client may reuse exact slot data only when the request context matches and the `availabilityVersion` matches.

Otherwise it must fetch again.

---

## Client loading contract

## Drawer open
1. Open shell immediately.
2. Render skeleton immediately.
3. Use the current bootstrap response for first real paint.
4. Render selected-day slot chips only from that current bootstrap response.

## Day switch
1. Abort any in-flight day request for the previous day.
2. Clear visible slot chips for the slot section.
3. Show local loading state for the slot section.
4. Fetch authoritative day data for the new day.
5. Render only the returned day slots.

## Alternates
1. Do not fan out one request per alternate pro.
2. Fetch alternates in one batched request.
3. Keep alternates lazy unless product explicitly requires eager load.

---

## UI trust rules

The drawer must never:
- keep showing previous-day slots after a day switch has started
- show slots from stale client cache as current
- imply that advisory summary data is exact booking truth
- reuse slots from a previous drawer session without version validation

The drawer may:
- keep shell and surrounding summary stable during refresh
- prewarm requests on user intent
- use optimistic skeleton states
- show “Updating times…” while a selected day is being revalidated

---

## Caching rules

## Server caching
Allowed and encouraged.

Requirements:
- version-aware keys
- bounded TTL
- explicit separation of bootstrap/day/alternates cache responsibilities
- easy invalidation tied to schedule and booking mutation paths

## Client caching
Allowed only as a transport optimization.

Allowed:
- in-flight request dedupe
- bootstrap prewarm promise reuse
- version-matched response reuse inside the same active context

Not allowed:
- TTL-only truth cache for visible exact slot chips
- showing old slot arrays because they are “recent enough”

---

## Invalidation rules

The active selected day must revalidate on:
- drawer open
- selected day change
- location mode change
- client address change
- add-on change
- reconnect after offline
- browser focus regain if the drawer has remained open
- manual refresh
- successful hold creation
- hold expiration
- booking completion
- explicit server-indicated version mismatch

Bootstrap data must revalidate when:
- the summary request context changes
- location mode changes
- client address changes
- add-ons change duration or availability eligibility
- the active summary version is known to be obsolete

---

## Performance rules

Performance work must not weaken truth guarantees.

### Required behavior
- shell appears immediately
- first authoritative slots come from bootstrap
- day switch is cancellable and race-safe
- alternates are batched
- telemetry measures authoritative readiness, not fake readiness

### Anti-patterns
- “fast” drawer open because stale slots were painted from client memory
- “fast” day switch because previous-day chips stayed visible
- one network request per alternate pro
- parser fallback logic that quietly revives deprecated fields forever

---

## Observability requirements

The implementation must emit enough signal to prove the contract is working.

Minimum telemetry:
- drawer open to first authoritative usable state
- day switch to authoritative slots visible
- hold request latency
- continue to add-ons
- background refresh duration
- version mismatch count
- day-request abort count
- alternates batch latency
- stale-response discard count

Where possible:
- server routes should emit `Server-Timing`
- client perf metrics should include request context metadata that is safe for logs

---

## Testing requirements

The system must be provable by test, not defended by vibes and caffeine.

Required test coverage:
- bootstrap renders selected-day slots from current response only
- day switch discards previous in-flight response
- stale response does not overwrite newer response
- alternates load via one batched request
- hold success invalidates selected-day truth
- address change invalidates selected-day truth
- location mode change invalidates selected-day truth
- deprecated `firstDaySlots` is no longer required by active consumers
- perf collection still reports the five Gate 2 metrics

---

## Migration plan

## Phase 1
- add this architecture contract
- add `availabilityVersion` and `generatedAt` to current responses
- stop extending deprecated fallback behavior

## Phase 2
- extract shared server application functions for bootstrap/day/alternates
- introduce separate routes
- keep old route temporarily as compatibility layer if needed

## Phase 3
- split client data loading into:
  - bootstrap hook
  - day hook
  - alternates hook
- remove blind exact-slot client cache behavior
- add reducer/state-machine driven drawer state

## Phase 4
- remove deprecated response fields after all consumers migrate
- lock perf and correctness behavior with CI and E2E coverage

---

## File ownership

### Server
- `app/api/availability/bootstrap/route.ts`
- `app/api/availability/day/route.ts`
- `app/api/availability/alternates/route.ts`
- `lib/availability/application/*`
- `lib/availability/contracts.ts`

### Client
- `app/(main)/booking/AvailabilityDrawer/AvailabilityDrawer.tsx`
- `app/(main)/booking/AvailabilityDrawer/types.ts`
- `app/(main)/booking/AvailabilityDrawer/contract.ts`
- `app/(main)/booking/AvailabilityDrawer/hooks/useAvailabilityBootstrap.ts`
- `app/(main)/booking/AvailabilityDrawer/hooks/useAvailabilityDay.ts`
- `app/(main)/booking/AvailabilityDrawer/hooks/useAvailabilityAlternates.ts`
- `app/(main)/booking/AvailabilityDrawer/state/availabilityDrawerReducer.ts`

---

## Non-goals

This contract does not:
- redefine booking conflict rules
- remove the hold race entirely
- prescribe exact UI styling
- replace perf budget documents
- replace API implementation details where the contract is silent

---

## Final rule

If a future change makes the drawer feel a little slower but keeps visible availability truthful, correctness wins.

Users forgive a spinner.
They do not forgive a fake 2:30 PM.
