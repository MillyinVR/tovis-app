// lib/media/visibilityFromFlags.ts
//
// The one implementation of "which visibility do these two flags ask for".
//
// 🔴 Why this file is separate from `lib/media/mediaVisibility.ts`. That module
// is the SERVER boundary and imports `@prisma/client`, which is a value import
// that drags Prisma's browser build into any client bundle that touches it (see
// `lib/prismaEnums.ts`). The upload form renders this same rule in the browser,
// so the shared copy has to live somewhere client-safe. The enum here is the
// client-safe mirror, which is mutually assignable with Prisma's own.
//
// ⚠️ This is the CREATE-side / preview rule, and it is deliberately ignorant of
// where the bytes live. That is safe in the two places it is used — the create
// route cross-checks the result against the upload session's bucket and refuses
// a mismatch, and the form is only painting a label — and it is exactly the
// wrong rule everywhere else.
//
// On any UPDATE path use `resolveMediaVisibility` from
// `@/lib/media/mediaVisibility` instead. A bucket-blind rule applied to an
// update is the defect that put 3 production rows in the world-readable bucket
// wearing a `PRO_CLIENT` label: three separate copies of this function had
// drifted into three routes, none of them looking at the bucket.

import { MediaVisibility } from '@/lib/prismaEnums'

/**
 * PUBLIC when the pro is asking to show the asset (featured in the portfolio or
 * eligible for Looks), PRO_CLIENT otherwise.
 *
 * Takes a named object rather than two positional booleans on purpose: the
 * copies this replaces had the SAME NAME and the arguments in the OPPOSITE
 * order, so a call written against the wrong one still compiled and still type
 * checked. Both flags are booleans — the compiler could never catch it.
 */
export function requestedVisibilityFromFlags(args: {
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
}): MediaVisibility {
  return args.isFeaturedInPortfolio || args.isEligibleForLooks
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}
