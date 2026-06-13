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
| **NFC card claim (write)** | none | ❌ **UNSCOPED — open gap** | `tenant-isolation.test.ts` (pins current gap + `it.todo` for fix) |
| Action tokens (consultation / aftercare) | ownership (booking + client/pro) | ✅ safe via ownership | covered by token unit tests |
| Media access (`MediaAsset`) | ownership (`professionalId`/booking) | ✅ safe via ownership; **no tenant column** | route auth tests |
| Reviews (`Review`) | ownership (booking + client) | ✅ safe via ownership; **no tenant column** | — |

## The open gap: NFC claim

`consumeTapIntent` (`lib/tapIntentConsume.ts`) loads a card by id and claims it
with **no tenant check** — `nfcCardTenantVisibilityFilter` is never applied on the
claim path. A Pro whose home tenant is A can claim a `SALON_WHITE_LABEL` card
issued by tenant B, becoming its owner (`claimedByUserId`, `professionalId`,
`type → PRO_BOOKING`).

- **Severity:** integrity / attribution, not a data leak. Exploiting it needs a
  valid non-expired `TapIntent`, which requires physically tapping the card (or
  the tap endpoint). So it is bounded, but it lets cross-tenant ownership of a
  white-label salon's physical card inventory.
- **Pinned by:** `tenant-isolation.test.ts → "KNOWN GAP: a white-label card is
  currently claimable by a Pro outside its tenant"`. When the gap is closed this
  test must flip to assert rejection; the adjacent `it.todo` is the target.

### Decision needed (product/security)

The fix is not mechanical because the rule is a product call:

- **Option A — scope white-label cards, keep root open.** A non-root card
  (`tenantId !== tovis-root`) is only claimable by a user whose `homeTenantId`
  matches the card's `tenantId`; root cards stay open to anyone. Mismatched claim
  → ignore gracefully (don't brick signup), log an attribution event.
- **Option B — scope by tap host.** Resolve tenant from the tap request host and
  require it to match the card's tenant. Closer to how discovery resolves tenant,
  but couples claim to request context.
- **Option C — accept as-is for launch.** Document the risk in the risk register;
  acceptable only if the first white-label tenants are trusted and card inventory
  is operationally controlled.

Recommended: **Option A** — clearest rule, fail-graceful, no coupling to request
host. Implementation: thread the user's `homeTenantId` (already loaded for the
PRO branch via `professionalProfile`) and the card's `tenantId` into the claim
decision; reject/ignore on mismatch for non-root cards.

## Still-untested surfaces (build into the matrix)

- Media: a Pro in tenant B cannot list/serve media of a booking owned by a Pro in
  tenant A (ownership *should* block this — add a test that proves it).
- Action tokens: a token minted for a tenant-A booking is rejected when replayed
  in a tenant-B context (ownership blocks it — prove it).
- `MediaAsset` / `Review` tenant attribution: only needed if tenant-scoped media
  or review *queries* are ever added; until then ownership is sufficient.
