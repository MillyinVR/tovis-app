// app/api/client/bookings/[id]/review-media-options/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, professionalId: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.clientId !== user.clientProfile.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    // Only pro-uploaded booking media that isn't already attached to a review
    // Default: AFTER only (safest for reviews).
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

    return NextResponse.json({ ok: true, items }, { status: 200 })
  } catch (e) {
    console.error('GET /api/client/bookings/[id]/review-media-options error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
