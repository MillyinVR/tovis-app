# Tenant Model & Asymmetric Visibility Contract

> Canonical reference for TOVIS multi-tenancy (white-label salons).
> Source of truth for field semantics: this document + `prisma/schema.prisma`.
> Visibility helpers: `lib/tenant/`. Guard: `tools/check-tenant-aware-discovery.mjs`.

## The business rule (asymmetric visibility)

- A **tenant** is a white-label salon (or the TOVIS marketplace itself).
- The reserved root tenant is **`tovis-root`** — the TOVIS marketplace.
- **Tovis-root clients see all Pros** across every tenant.
- **White-label clients see only Pros whose home tenant is their own tenant.**
- A Pro belongs to exactly one **home tenant** and never changes it casually.
- NFC cards belong to the issuing tenant; cards claimed through a white-label
  salon attribute to that salon's tenant.
- Bookings record **two** tenant facts, because the Pro's tenant and the
  client's signup tenant can legitimately differ (a tovis-root client can book
  a white-label Pro):
  - `Booking.proTenantId` — revenue attribution (whose Pro earned this).
  - `Booking.clientHomeTenantId` — acquisition/analytics attribution (where
    the client came from).

## Field semantics — not blanket `homeTenantId`

Use the precise field for what the relationship means. "Home tenant" is only
correct where an actor *belongs* somewhere.

| Model | Field | Meaning |
|---|---|---|
| `Tenant` | — | The tenant itself. `slug` is unique; `tovis-root` is reserved. `customDomain` is the (skeleton) hook for white-label domains. |
| `ProfessionalProfile` | `homeTenantId` | The Pro's one home tenant. Drives discovery visibility. |
| `ClientProfile` | `homeTenantId` | The tenant the client signed up under. Drives what the client can discover. |
| `Booking` | `proTenantId` | Snapshot of the Pro's home tenant at booking time. Revenue attribution. |
| `Booking` | `clientHomeTenantId` | Snapshot of the client's home tenant at booking time. Acquisition attribution. |
| `NfcCard` | `tenantId` | Issuing tenant. Replaces the legacy `salonSlug` placeholder (deprecated; see below). |

Booking tenant fields are **snapshots written at creation time** by the
booking write boundary — they are never recomputed from current profile rows,
so historical attribution stays stable even if a Pro is ever migrated between
tenants. This is the same snapshot philosophy the Booking model already uses
for addresses and pricing.

Models deliberately **without** tenant columns (derive via relations):

- `MediaAsset`, `Review`, `Notification`, `AftercareSummary`, messages, etc.
  derive their tenant through `booking` or `professional`. Adding columns
  there is denormalization we only do when a measured query needs it.

### Deprecation: `NfcCard.salonSlug`

`salonSlug` was a placeholder ("or salonId if you already have a Salon
model"). `tenantId` supersedes it. Expand phase keeps `salonSlug` readable;
no new writes. Drop it in the contract-phase migration after `tenantId`
backfill is verified.

## Expand–contract migration plan

| Phase | Step | Status |
|---|---|---|
| Expand | Create `Tenant`; add **nullable** tenant columns + FKs + indexes | this PR (`add_tenant_foundation` migration) |
| Backfill | `prisma/scripts/backfillTenantFoundation.ts` — ensure `tovis-root`, point every existing row at it (idempotent, batched, dry-run default) | this PR (script); run per environment |
| Verify | Backfill reports zero remaining NULL tenant fields; isolation tests green | per environment |
| Contract | `NOT NULL` on the five columns; drop `NfcCard.salonSlug`; booking write boundary starts writing tenant snapshots on create | follow-up PR (Q2, with WS-5 enforcement) |

FKs use `onDelete: Restrict` — a tenant with attached data must never be
deletable; offboarding a tenant is an explicit migration, not a cascade.

## Visibility helpers (`lib/tenant/`)

- `TOVIS_ROOT_TENANT_SLUG` — the reserved slug constant.
- `resolveTenant` — request → tenant context. Skeleton for now: resolves by
  custom domain when one matches, else `tovis-root`. Becomes the white-label
  domain resolver in Q2.
- `proDiscoveryVisibilityFilter(ctx)` — `Prisma.ProfessionalProfileWhereInput`
  fragment every Pro-discovery query must merge in. Root context → no
  restriction; white-label context → `homeTenantId` must equal the tenant.
- `bookingTenantVisibilityFilter(ctx)` — same shape for tenant-scoped booking
  queries (admin/analytics surfaces).

Rules:

- Discovery surfaces (search, discover, looks-by-pro, NFC claim, last-minute
  fan-out) must compose these helpers rather than writing tenant `where`
  clauses inline — single source of truth, enforced by
  `tools/check-tenant-aware-discovery.mjs`.
- The helper functions are pure; route wiring happens in Q2 (WS-5). The guard
  baselines today's discovery routes and fails any **new** discovery surface
  that does not reference the visibility helpers.

## Isolation test matrix (must stay green from the first tenant PR)

| Case | Expectation |
|---|---|
| White-label client discovers Pros | only own-tenant Pros |
| Tovis-root client discovers Pros | all Pros |
| Tenant A context queries tenant B booking scope | excluded |
| Root context queries booking scope | unrestricted |
| Backfill | every legacy row lands on `tovis-root`; reruns are no-ops |

Unit tests live in `lib/tenant/visibility.test.ts`; database-level isolation
tests in `tests/integration/tenant-isolation.test.ts` (runs against the
docker test database like the booking-overlap suite).

## Explicitly out of scope for this foundation PR

- Enforcing filters in routes (Q2 / WS-5).
- Tenant-resolved branding, email/SMS templates, custom-domain middleware
  (Q2 / WS-6).
- Stripe `TENANT_OWNED` mode, tenant billing.
- Tenant admin UI.
