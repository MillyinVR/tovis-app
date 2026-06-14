# Hot-path index audit (T1.1) — 2026-06-12, HEAD `bce4e7`

> **Method:** *static* audit — schema indexes cross-checked against the actual hot-query shapes.
> A true `EXPLAIN ANALYZE` is **deferred to staging (T0.1)**: the local seed DB has 1 pro, so the
> planner picks seq-scans regardless of indexing and would mislead. This doc finds the structural
> gaps now; staging confirms them under representative volume.

## Verdict

The schema is **well-indexed** — most of the plan's wishlist already exists. One real gap (nearby),
one dedup opportunity (two geo implementations), and the standing tenant-column gap (T2.2). No
emergency.

## Findings

### ✅ Search pros — well-architected, verified
`lib/search/pros.ts` is raw SQL over the denormalized `ProfessionalSearchIndex` (1:1 with
`ProfessionalLocation`, carries `geom geography(Point,4326)`, `lat`/`lng`, `locationType`, `minSalonPrice`).
- **GIST geo index confirmed present** (not just claimed): `ProfessionalSearchIndex_geom_gist_idx`
  at `prisma/migrations/20260509000000_add_professional_search_index/migration.sql:96-97`
  (`USING GIST ("geom")`), driving the `ST_DWithin(...)` radius prefilter (`lib/search/pros.ts:236-244`).
- BTREE `(verificationStatus, isBookable)` narrows status before geo (`pros.ts:225-228`).
- Tenant scoping in the same WHERE via `searchIndexVisibilitySql(tenantContext)` (`pros.ts:231`).
- ORDER BY `distanceMiles ASC NULLS LAST, LOWER(businessName), professionalId` (`pros.ts:206`).
- The migration even leaves a **post-launch follow-up note** (`migration.sql:15`) to revisit the GIST
  strategy at high row counts — already on the team's radar.
- **No action.** This is the reference geo read path.

### ⚠️ Nearby pros — bounding-box filter is under-indexed *and* duplicates the search geo path
`lib/discovery/nearbyPros.ts:91-119` filters `professionalLocation.findMany` by
`isPrimary = TRUE AND isBookable = TRUE AND lat BETWEEN … AND lng BETWEEN …`, `take: 800`, then sorts
distance in JS. Available `ProfessionalLocation` indexes:
`[professionalId,isPrimary]`, `[professionalId,isBookable]`, `[lat,lng]`, `[isBookable,type,lat,lng]`,
`[latApprox,lngApprox]`.
- **Gap:** none lead with the query's equality+range shape. `[lat,lng]` serves the range but ignores
  the `isPrimary`/`isBookable` equalities (Postgres range-scans the box, then filters). `[isBookable,
  type,lat,lng]` injects `type` (not an equality here) between the leading column and lat/lng, breaking
  range use. There is **no `[isPrimary, isBookable, lat, lng]`**.
- `take: 800` caps blast radius today, so it's not on fire — but at 100k-pro density the box can hold
  far more than 800 rows and the JS sort sees a truncated set.
- **Two fixes, preferred order:**
  1. **(Best — also WS-7 dedup) Consolidate nearby onto the search path's GIST/`ST_DWithin`** approach.
     There are currently *two* geo implementations; the bounding-box one is strictly weaker. Folding
     nearby into the `ProfessionalSearchIndex` + GIST query removes a duplicate and the index gap at once.
  2. **(Cheap interim) Add `@@index([isPrimary, isBookable, lat, lng])`** to `ProfessionalLocation` and
     keep the bounding box.
- **Confirm with EXPLAIN on staging** before committing to (1) vs (2).
- **Scoped:** see `docs/performance/ticket-consolidate-nearby-onto-search-index.md` — option (1) is
  cleaner than expected because the search index already carries `serviceIds[]`/`categoryIds[]` (GIN)
  + rating/price, so `searchPros` is a near-superset; nearby becomes a thin adapter.

### ✅ Availability slots — covered
`lib/availability/core/placement.ts` reads bookings/holds by `professionalId` (`:411,:437,:463,:549,:569`)
over a `scheduledFor` window. Covered by `Booking @@index([professionalId, scheduledFor])` and
`BookingHold @@index([professionalId, scheduledFor, expiresAt])`. Booking overlap is enforced by the
`EXCLUDE USING gist` constraint (`20260522000000_add_booking_overlap_exclusion/migration.sql:42`).
- **No structural gap.** Still worth an EXPLAIN on staging for the multi-day bootstrap window.

### ✅ Plan-wishlist indexes already present
`NotificationDelivery @@index([status, nextAttemptAt])`; `ClientActionToken @@index([kind, expiresAt])`;
`Booking @@index([proTenantId, scheduledFor])` + `[clientHomeTenantId]`;
`MediaAsset @@index([bookingId, phase, createdAt])`; `ProfessionalServiceOffering @@index([professionalId, isActive])`.
All match the plan's recommended set.

### ⚠️ Tenant-attribution index gap (ties to T2.2)
`MediaAsset` and `Notification*` carry no tenant column, so no tenant index is possible. Fine for
isolation (enforced at discovery surfaces), but blocks per-tenant analytics/billing/GDPR queries.
Addressed by finish-plan T2.2.

## Still owed (after staging — T0.1)
Run `EXPLAIN (ANALYZE, BUFFERS)` at representative volume on:
1. availability bootstrap (multi-day window for one pro),
2. nearby bounding-box (dense metro lat/lng box) — decide consolidate vs add-index,
3. search `ST_DWithin` (confirm GIST is chosen, not a seq scan),
4. hold-create conflict check.
Record results here and in `load-test-plan.md`.
