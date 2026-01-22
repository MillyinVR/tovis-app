// app/api/client/bookings/[id]/review-media-options/route.ts
import { prisma } from '@/lib/prisma'
import { requireClient, pickString, jsonFail, jsonOk } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

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
      select: { id: true, clientId: true, professionalId: true },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const items = await prisma.mediaAsset.findMany({
      where: {
        bookingId: booking.id,
        professionalId: booking.professionalId,
        uploadedByRole: 'PRO',
        reviewId: null,
        phase: 'AFTER',
      },
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        createdAt: true,
        phase: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return jsonOk({ items })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/review-media-options error', e)
    return jsonFail(500, 'Internal server error')
  }
}
