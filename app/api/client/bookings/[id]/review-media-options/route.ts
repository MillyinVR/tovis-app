// app/api/client/bookings/[id]/review-media-options/route.ts
import { prisma } from '@/lib/prisma'
import {
  requireClient,
  pickString,
  jsonFail,
  jsonOk,
} from '@/app/api/_utils'
import {
  MediaType,
  MediaVisibility,
  MediaPhase,
  Role,
} from '@prisma/client'
import { assertClientBookingReviewEligibility } from '@/lib/booking/writeBoundary'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { renderMediaUrls } from '@/lib/media/renderUrls'
export const dynamic = 'force-dynamic'

const PHASE_RANK: Record<MediaPhase, number> = {
  [MediaPhase.BEFORE]: 0,
  [MediaPhase.AFTER]: 1,
  [MediaPhase.OTHER]: 2,
}

function phaseRank(value: MediaPhase): number {
  return PHASE_RANK[value] ?? 9
}

function sortKey(
  a: { phase: MediaPhase; createdAt: Date },
  b: { phase: MediaPhase; createdAt: Date },
): number {
  const rankDelta = phaseRank(a.phase) - phaseRank(b.phase)
  if (rankDelta !== 0) return rankDelta
  return b.createdAt.getTime() - a.createdAt.getTime()
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const eligibility = await assertClientBookingReviewEligibility({
      bookingId,
      clientId,
    })

    const raw = await prisma.mediaAsset.findMany({
      where: {
        bookingId: eligibility.booking.id,
        professionalId: eligibility.booking.professionalId,
        reviewId: null,
        reviewLocked: false,
        visibility: MediaVisibility.PRO_CLIENT,
        mediaType: { in: [MediaType.IMAGE, MediaType.VIDEO] },
        uploadedByRole: Role.PRO,
      },
      select: {
        id: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        createdAt: true,
        phase: true,
      },
      take: 80,
    })

    const items = await Promise.all(
      raw.sort(sortKey).map(async (row) => {
        const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
        return {
          id: row.id,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
          mediaType: row.mediaType,
          createdAt: row.createdAt,
          phase: row.phase,
        }
      }),
    )

    return jsonOk({ items })
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error(
      'GET /api/client/bookings/[id]/review-media-options error',
      error,
    )
    return jsonFail(500, 'Internal server error.')
  }
}