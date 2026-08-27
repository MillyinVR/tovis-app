// The client chart's photo query, in ONE place.
//
// Same story as `chartBookingSelect.ts`: the web chart's timeline
// (app/pro/clients/[id]/page.tsx → loadPhotoTimeline) and the native chart API
// (GET /api/v1/pro/clients/[id]/chart) read the same MediaAssets, and their
// hand-copied `where` clauses had drifted in two ways that mattered:
//
//   1. The API did not filter `mediaType: 'IMAGE'`, so a video attached to a
//      booking was handed to the client as a photo with a still thumbnail.
//   2. The API's review branch was `{ reviewId: { not: null } }` with NO
//      `visibility` condition — so a review photo the client had NOT made
//      public was visible on device to a pro who did not shoot it, while the
//      web chart correctly withheld it. That is the access matrix (own craft
//      always; another pro's only when the CLIENT promoted it) being enforced
//      on one surface and not the other.
//
// One `where`, so the matrix can't be enforced by only half the app again.

import type { Prisma } from '@prisma/client'

/** How many chart photos either surface reads. Was 500 on web, 200 on the API. */
export const CHART_PHOTO_TAKE = 500

export function chartPhotoWhere(args: {
  clientId: string
  proId: string
}): Prisma.MediaAssetWhereInput {
  const { clientId, proId } = args

  return {
    mediaType: 'IMAGE',
    booking: { clientId },
    OR: [
      // The viewing pro's own craft — always theirs to see.
      { professionalId: proId },
      // Another pro's work, only once the CLIENT promoted it with a public review.
      { visibility: 'PUBLIC', reviewId: { not: null } },
    ],
  }
}
