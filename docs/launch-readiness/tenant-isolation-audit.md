# Cross-tenant isolation audit & test matrix

Audit of every surface where one tenant's data/actions could reach another, with
the current verdict and where it is tested. Gate for white-label go-live.

Audited 2026-06-12. Source of truth for the isolation test matrix in
`tests/integration/tenant-isolation.test.ts`.

## How isolation is enforced today

Two mechanisms:
1. **Tenant visibility filters** (`lib/tenant/visibility.ts`) — explicit `where`
   fragments merged into discovery/read queries. Root → `{}`, white-label →
   `{ <tenantCol>: tenantId }`. Used by discovery, bookings, NFC listing, looks.
2. **Ownership scoping** — a row is tied to a Pro/booking, and a Pro belongs to
   exactly one tenant, so an ownership check (`professionalId === auth.id`) is
   *transitively* a tenant check. This is why token/media surfaces are safe even
   without a tenant column.

## Matrix

| Surface | Mechanism | Verdict | Tested |
|---|---|---|---|
| Pro discovery / search | visibility filter (`homeTenantId`) | ✅ scoped | `tenant-isolation.test.ts` + unit |
| Looks feed | visibility filter (`proDiscoveryVisibilityFilter`), PR #94 | ✅ scoped + guarded | `lib/looks/feed.test.ts` |
| Bookings (admin/analytics) | visibility filter (`proTenantId`) | ✅ scoped | `tenant-isolation.test.ts` |
| NFC card listing (read) | visibility filter (`tenantId`) | ✅ scoped | `tenant-isolation.test.ts` |
| **NFC card claim (write)** | tenant check on claim (Option A) | ✅ **scoped (fixed)** | `tenant-isolation.test.ts` (outside-rejected / in-tenant-allowed / root-open) |
| Action tokens (consultation / aftercare) | ownership (booking + client/pro) | ✅ safe via ownership | covered by token unit tests |
| Media access (`MediaAsset`) | ownership (`professionalId`/booking) | ✅ safe via ownership; **no tenant column** | route auth tests |
| Reviews (`Review`) | ownership (booking + client) | ✅ safe via ownership; **no tenant column** | — |

## NFC claim — CLOSED (Option A, 2026-06-13)

Previously, `consumeTapIntent` (`lib/tapIntentConsume.ts`) claimed a card by id
with **no tenant check**, so a Pro whose home tenant is A could claim a
`SALON_WHITE_LABEL` card issued by tenant B.

**Fix (Option A):** the claim path now compares the card's issuing tenant against
the claimer's `homeTenantId`:

- A **white-label** card (issuing `tenant.slug !== tovis-root`) is only claimable
  by a user whose `homeTenantId` equals the card's `tenantId`.
- **Root** cards stay open to anyone.
- A mismatch is **ignored gracefully** (returns `ok: true` with the nextUrl, so
  signup is never bricked) and logged as an `NFC_CLAIM_TENANT_MISMATCH`
  attribution event.

Covered by `tenant-isolation.test.ts → "nfc claim tenant isolation"`:
outside-tenant claim rejected (card stays unclaimed + mismatch event), in-tenant
claim succeeds, root card claimable from any tenant.

> Severity was integrity/attribution, not a data leak (exploiting it needed a
> physical tap), but it let cross-tenant ownership of a white-label salon's card
> inventory — now closed.

Options B (scope by tap host) and C (accept as-is) were considered and not taken;
Option A is the clearest rule with no coupling to request context.

## Still-untested surfaces (build into the matrix)

- Media: a Pro in tenant B cannot list/serve media of a booking owned by a Pro in
  tenant A (ownership *should* block this — add a test that proves it).
- Action tokens: a token minted for a tenant-A booking is rejected when replayed
  in a tenant-B context (ownership blocks it — prove it).
- `MediaAsset` / `Review` tenant attribution: only needed if tenant-scoped media
  or review *queries* are ever added; until then ownership is sufficient.
