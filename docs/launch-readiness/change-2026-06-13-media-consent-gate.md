# Change Record — Client consent gate for publishing session media

Date: 2026-06-13
Owner: Tori (launch-readiness)
Area: **Media storage / access** (safety-critical, per handoff.md)
Status: Code + tests landed in repo (PR pending review). No data migration; no prod change required.

## Summary

Before/after session photos are private (`PRO_CLIENT`, `media-private`) and visible
only to the booking's pro + client. The intended rule is: **a client's session
photo never becomes public unless the client authorizes it** — and the
authorization act is the client adding the photo to a review (which sets
`reviewId` and flips it to `PUBLIC`).

That client flow already exists and is correct (aftercare review section →
"Add to review" → `app/api/client/bookings/[id]/review/route.ts:529-579`). The
gap was on the **pro** side: two routes let a pro flip ANY media they own to
public with only an ownership check, with no consent gate:

- `app/api/pro/media/[id]/portfolio/route.ts` (feature in portfolio)
- `app/api/pro/media/[id]/route.ts` PATCH (set `isEligibleForLooks` / `isFeaturedInPortfolio`)

So a pro could publish a client's before/after photo to their public profile or a
Look without the client ever consenting. (Production check 2026-06-13:
`total_featured = 0` — no row had actually been published this way yet, so this
is preventive, not a remediation.)

## The rule (single source of truth)

`lib/media/publicShareGuard.ts`: a pro may make media public only if it is
**public-bucket media** (their own portfolio/Looks uploads, forced public at
create time) **or** **review-promoted** (`reviewId` set). Equivalently: block
when `storageBucket = media-private` AND `reviewId = null`.

## Implementation reference

| Change | File |
|---|---|
| Shared consent guard | `lib/media/publicShareGuard.ts` (new) |
| Gate the portfolio toggle (POST) | `app/api/pro/media/[id]/portfolio/route.ts` |
| Gate the media PATCH (flip-to-public) | `app/api/pro/media/[id]/route.ts` |
| Defense-in-depth at Look publication | `lib/looks/publication/service.ts` (`assertMediaAssetCanBackLooks`) |

The pro media *create* route (`app/api/pro/media/route.ts:174`) was already safe
(rejects PUBLIC visibility unless the bucket is public).

## Test evidence

- `lib/media/publicShareGuard.test.ts` — 4 passed
- `app/api/pro/media/[id]/portfolio/route.test.ts` — 17 passed (incl. reject-unpromoted, allow-review-promoted)
- `app/api/pro/media/[id]/route.test.ts` — 18 passed (incl. reject-unpromoted, allow-review-promoted)
- `lib/looks/publication/service.test.ts` — 8 passed (no regression)
- `pnpm typecheck` clean; eslint clean

## Known risks / limitations

- This stops the **system** from exposing the stored private object without
  consent. It cannot stop a pro who can already view a photo from manually
  re-uploading their own copy as public portfolio content — that's a policy/ToS
  matter, not an access-control bug.
- Review-promoted session media stays physically in `media-private` and renders
  publicly via signed URL (consistent with how review media already renders).

## Rollback

Revert the commit. The guard is additive (new file + early-return checks); no
schema or data change, so rollback is clean and only restores the prior
(ungated) behavior.

## Checklist update

`docs/launch-readiness/checklist.md`: added "Client consent gate for publishing
session media" → PASS LOCALLY.
