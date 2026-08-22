// app/api/v1/pro/schedule/publish/route.ts
//
// POST /api/v1/pro/schedule/publish
//
// Canonical publish endpoint for turning draft/unbookable locations into
// bookable locations. This route validates location-level publishability first,
// then re-runs full professional readiness after the transaction.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  checkProReadiness,
  evaluatePublishableLocation,
} from '@/lib/pro/readiness/proReadiness'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { refreshLocation } from '@/lib/search/index/refreshSearchIndex'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const draftLocations = await prisma.professionalLocation.findMany({
      where: {
        professionalId,
        isBookable: false,
        archivedAt: null,
      },
      select: {
        id: true,
        type: true,
        formattedAddress: true,
        timeZone: true,
        workingHours: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    })

    if (draftLocations.length === 0) {
      const readiness = await checkProReadiness(professionalId)

      // Nothing to publish is not a failure to publish. This branch is what a
      // pro hits on their SECOND click, once the first one already flipped
      // every draft location — returning 4xx here made the app say
      // "Couldn't publish" about a request that had nothing to refuse.
      // Remaining readiness blockers ride along as information.
      return jsonOk({
        liveModes: readiness.ok ? readiness.liveModes : [],
        locationsPublished: 0,
        scheduleConfigVersion: null,
        blockers: readiness.ok ? [] : readiness.blockers,
      })
    }

    const locationResults = draftLocations.map((location) =>
      evaluatePublishableLocation(location),
    )

    const publishableLocationIds = locationResults
      .filter((result) => result.ok)
      .map((result) => result.locationId)

    const blockedLocations = locationResults.filter((result) => !result.ok)

    if (publishableLocationIds.length === 0) {
      return jsonFail(
        422,
        'Schedule cannot be published until all location blockers are resolved.',
        {
          blockedLocations,
        },
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.professionalLocation.updateMany({
        where: {
          id: { in: publishableLocationIds },
          professionalId,
          isBookable: false,
        },
        data: {
          isBookable: true,
        },
      })

      const profile = await tx.professionalProfile.update({
        where: { id: professionalId },
        data: {
          scheduleConfigVersion: { increment: 1 },
        },
        select: {
          scheduleConfigVersion: true,
        },
      })

      return {
        locationsPublished: updated.count,
        scheduleConfigVersion: profile.scheduleConfigVersion,
      }
    })

    await Promise.all(
      publishableLocationIds.map((locationId) =>
        refreshLocation(locationId, 'location.update'),
      ),
    )

    const readiness = await checkProReadiness(professionalId)

    // The transaction above has ALREADY COMMITTED — the locations are bookable
    // and `scheduleConfigVersion` is bumped. Reporting a failure status for a
    // write that succeeded is what made the pro's own app tell them
    // "Couldn't publish" (and the web client skip its `refresh()`, so the page
    // kept rendering the stale draft state) over a blocker that has nothing to
    // do with locations — typically "you have no services yet".
    //
    // A publish that published is a success. Whether the pro is *bookable* is a
    // separate question, answered by `blockers`, which is empty when they are.
    // Genuine refusals — no publishable location at all — still return 422
    // above, because nothing was written in those.
    return jsonOk({
      liveModes: readiness.ok ? readiness.liveModes : [],
      locationsPublished: result.locationsPublished,
      scheduleConfigVersion: result.scheduleConfigVersion,
      blockedLocations,
      blockers: readiness.ok ? [] : readiness.blockers,
    })
  } catch (error) {
    captureBookingException({ error, route: 'POST /api/v1/pro/schedule/publish' })
    return jsonFail(500, 'Internal server error.')
  }
}