// app/api/pro/schedule/publish/route.ts
//
// POST /api/pro/schedule/publish
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

      if (!readiness.ok) {
        return jsonFail(
          422,
          'Schedule cannot be published until all blockers are resolved.',
          {
            blockers: readiness.blockers,
          },
        )
      }

      return jsonOk({
        ok: true,
        liveModes: readiness.liveModes,
        locationsPublished: 0,
        scheduleConfigVersion: null,
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

    if (!readiness.ok) {
      return jsonFail(
        422,
        'Locations were published, but the professional is still not ready for booking.',
        {
          locationsPublished: result.locationsPublished,
          scheduleConfigVersion: result.scheduleConfigVersion,
          blockers: readiness.blockers,
          blockedLocations,
        },
      )
    }

    return jsonOk({
      ok: true,
      liveModes: readiness.liveModes,
      locationsPublished: result.locationsPublished,
      scheduleConfigVersion: result.scheduleConfigVersion,
      blockedLocations,
    })
  } catch (error) {
    captureBookingException({ error, route: 'POST /api/pro/schedule/publish' })
    return jsonFail(500, 'Internal server error.')
  }
}