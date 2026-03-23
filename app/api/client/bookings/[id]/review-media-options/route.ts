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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { clientId } = auth

    const { id: rawId } = await ctx.params
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
        url: true,
        thumbUrl: true,
        mediaType: true,
        createdAt: true,
        phase: true,
      },
      take: 80,
    })

    const items = raw.sort(sortKey)

    return jsonOk({ items })
  } catch (error: unknown) {
    console.error(
      'GET /api/client/bookings/[id]/review-media-options error',
      error,
    )
    return jsonFail(500, 'Internal server error.')
  }
}