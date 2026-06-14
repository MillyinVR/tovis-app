# Ticket — Consolidate `nearbyPros` onto the search-index GIST path

**Type:** perf + de-duplication (WS-7 single-source-of-truth) · **Effort:** M · **Risk:** medium (touches a live
discovery surface) · **Source:** `docs/performance/hot-path-index-audit-2026-06-12.md` (T1.1)

## Problem

There are **two geo-discovery implementations**, and the second is the weaker one:

| | Search (`lib/search/pros.ts`) | Nearby (`lib/discovery/nearbyPros.ts`) |
|---|---|---|
| Source table | `ProfessionalSearchIndex` (denormalized, 1:1 w/ location) | `ProfessionalLocation` (live) |
| Geo | **GIST `ST_DWithin`** (`pros.ts:236-244`; index `…add_professional_search_index/migration.sql:96`) | **bounding-box** `lat/lng BETWEEN …` + JS haversine (`nearbyPros.ts:102-116,148`) |
| Index coverage | GIST(geom), GIN(categoryIds), BTREE(status,bookable) | **none lead with `(isPrimary,isBookable,lat,lng)`** — under-indexed |
| Rating/price | denormalized in index (`ratingAvg`, `minAnyPrice`, …) | **live** `review.groupBy` + `offering.findMany` (`nearbyPros.ts:178-211`) |
| Location semantics | **closest** location (+ separate primary lookup) | **primary** location only |
| Cap | SQL `LIMIT` + pagination | `take: 800` then JS sort/slice |
| Tenant scope | `searchIndexVisibilitySql` | `proDiscoveryVisibilityFilter` |

The nearby path's bounding-box query is the index gap from the audit, *and* it re-derives geo/dedup/
rating logic that the search index already solves better. Folding nearby into the search path removes
the duplicate, closes the index gap (GIST replaces the box), and makes both discovery surfaces share
one ranking definition.

## Why this is cleaner than it looks

The search index **already denormalizes everything nearby filters on**:
- `serviceIds String[]` + `categoryIds String[]` with **GIN** indexes (schema: `ProfessionalSearchIndex`)
  → `ANY(psi."serviceIds")` / `ANY(psi."categoryIds")` filters are first-class.
- `offersMobile`, `offersInSalon`, `minMobilePrice`, `minAnyPrice`, `ratingAvg`, `ratingCount` — all present.
- `searchPros` already supports: lat/lng origin, `radiusMiles` (ST_DWithin), `categoryId` (GIN),
  `mobileOnly`, `maxPrice`, `minRating`, `sort=DISTANCE`, pagination, and a closest-vs-primary location split.

`searchPros` is therefore a **near-superset** of `loadNearbyPros`. The only missing inputs:
1. **`serviceId` exact filter** — add one clause mirroring the existing `categoryId` GIN filter
   (`pros.ts:245-249`): `Prisma.sql\`${serviceId}::text = ANY(psi."serviceIds")\``.
2. **`excludeProfessionalId`** — add `Prisma.sql\`psi."professionalId" <> ${excludeId}\``.

## Approach

1. **Extend `SearchProsParams`** (`lib/search/pros.ts:62`) with optional `serviceId` and
   `excludeProfessionalId`; add the two GIN/equality filters above.
2. **Rewrite `loadNearbyPros` as a thin adapter** over `searchPros`: call it with `sort: 'DISTANCE'`,
   the radius, `serviceId`/`categoryId`, `excludeProfessionalId`, and `limit`; **map** each search row →
   `NearbyProCard` (`distanceMiles`, `ratingAvg`/`ratingCount`, `minPrice = minAnyPrice`,
   `supportsMobile = offersMobile`, `closestLocation`, `primaryLocation`, `locationLabel`).
   Delete the bounding-box query, haversine, best-primary dedup, and the separate review/offering
   queries (`nearbyPros.ts:89-301`).
3. **Keep the route contract** (`app/api/pros/nearby/route.ts` → `jsonOk({ ok, pros })`) byte-identical;
   the adapter preserves the `NearbyProCard[]` shape.
4. **Gate behind a runtime flag** (`lib/runtimeFlags.ts`, e.g. `nearbyViaSearchIndexEnabled`) so the old
   path can be restored instantly if parity drifts (ties to rollback drill T1.6).

## Decisions to make

- **Closest vs primary location (semantics change).** Today nearby ranks by the *primary* location's
  distance; the search path ranks by the *closest* location. The closest is arguably better UX (nearest
  branch wins), but it **is** a behavior change. **Recommend: adopt closest** (it's a strict improvement
  and unifies semantics) — confirm with product.
- **Rating/price freshness.** Nearby is currently always-live; the index is **event-refreshed**
  (`lib/search/index/refreshSearchIndex.ts`, wired into `pro/offerings`, `schedule/publish`,
  `working-hours`, `locations` routes). Moving nearby to the index trades real-time rating/price for the
  index cadence. Ratings/prices change slowly, so a few minutes' lag is acceptable — but **verify refresh
  coverage has no gaps** before flipping the flag.

## Acceptance criteria

- `loadNearbyPros` contains **no** `professionalLocation.findMany` / haversine / bounding-box / separate
  review/offering query; it delegates to `searchPros`.
- `app/api/pros/nearby` response shape is unchanged (existing route test passes untouched).
- **Behavior-parity test**: for a seeded fixture, old vs new return the same pro set + order (modulo the
  agreed closest-vs-primary change), same distance rounding, same serviceId/categoryId/exclude filtering.
- **Tenant isolation preserved**: a white-label viewer still sees only own-tenant pros; root sees all
  (extend `tenant-isolation.test.ts` to cover the nearby route).
- `tools/check-tenant-aware-discovery.mjs` stays green (nearby no longer enumerates `ProfessionalLocation`
  directly; ensure the guard still recognizes the new path as tenant-aware).
- **EXPLAIN on staging** shows the nearby query using `ProfessionalSearchIndex_geom_gist_idx`, not a seq scan.
- Old path removable after one flag-on burn-in with no parity alerts.

## Risks & mitigations

- **Parity drift** → runtime-flag gate + behavior-parity test + burn-in before deleting the old code.
- **Index staleness** → audit `refreshSearchIndex` call sites for completeness first; ratings/price lag is non-critical.
- **A pro with a bookable non-primary location nearer than their primary** now surfaces by the nearer
  location — this is the intended improvement, but flag it to product so it's not a surprise.

## Out of scope
- Changing the search route itself (only additive params).
- Index strategy tuning (the migration's own high-row-count GIST note, `…/migration.sql:15`) — separate ticket.
