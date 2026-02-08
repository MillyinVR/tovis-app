// app/api/client/bookings/[id]/review-media-options/route.ts
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, jsonFail, jsonOk, upper } from '@/app/api/_utils'
import { MediaType, MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

// For “select appointment photos to add to review”, it’s clearer to show:
// BEFORE → AFTER → OTHER, then newest first within each group.
const PHASE_RANK: Record<string, number> = {
  BEFORE: 0,
  AFTER: 1,
  OTHER: 2,
}

function phaseRank(v: unknown) {
  const s = upper(v)
  return PHASE_RANK[s] ?? 9
}

function sortKey(a: { phase: unknown; createdAt: Date }, b: { phase: unknown; createdAt: Date }) {
  const pr = phaseRank(a.phase) - phaseRank(b.phase)
  if (pr !== 0) return pr
  return b.createdAt.getTime() - a.createdAt.getTime()
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClient()
    if (auth.res) return auth.res
    const { clientId } = auth

    const { id } = await ctx.params
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        finishedAt: true,
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    // ✅ Appointment media that is:
    // - tied to this booking
    // - still “appointment-only” (not already attached to a review)
    // - visible to pro+client only
    // - uploaded by PRO or CLIENT (both are eligible to be attached to review)
    //
    // Note: We include both IMAGE + VIDEO. Your review route caps selection anyway.
    const raw = await prisma.mediaAsset.findMany({
      where: {
        bookingId: booking.id,
        professionalId: booking.professionalId,
        reviewId: null,
        visibility: MediaVisibility.PRO_CLIENT,
        mediaType: { in: [MediaType.IMAGE, MediaType.VIDEO] },
        uploadedByRole: { in: ['PRO', 'CLIENT'] },
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
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/review-media-options error', e)
    return jsonFail(500, 'Internal server error')
  }
}
