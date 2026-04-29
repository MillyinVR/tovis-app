// app/api/pro/schedule/publish/route.ts
//
// POST /api/pro/schedule/publish
//
// Single transactional operation that marks a pro's location as bookable after
// validating all pre-conditions.  On success, sets `isBookable = true` and
// increments `scheduleConfigVersion` on the pro's profile.
//
// Referenced from: Phase 4.1 of the production-readiness plan.
//

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { checkProReadiness } from '@/lib/pro/readiness/proReadiness'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    // Run readiness check BEFORE entering the transaction so we surface
    // all blockers in one pass.
    const readiness = await checkProReadiness(professionalId)

    if (!readiness.ok) {
      return jsonFail(422, 'Schedule cannot be published until all blockers are resolved.', {
        blockers: readiness.blockers,
      })
    }

    // Atomic publish: set every location to isBookable and bump the config
    // version so availability caches know to invalidate.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.professionalLocation.updateMany({
        where: {
          professionalId,
          // Only update locations that are not already bookable, to keep
          // the write idempotent.
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

    return jsonOk({
      ok: true,
      liveModes: readiness.liveModes,
      locationsPublished: result.locationsPublished,
      scheduleConfigVersion: result.scheduleConfigVersion,
    })
  } catch (error) {
    captureBookingException({ error, route: 'POST /api/pro/schedule/publish' })
    return jsonFail(500, 'Internal server error.')
  }
}
