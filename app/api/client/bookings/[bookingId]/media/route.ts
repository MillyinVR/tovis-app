// app/api/client/bookings/[bookingId]/media/route.ts
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * IMPORTANT:
 * Media is attached to a REVIEW, not directly to a booking.
 * Use:
 *   POST /api/client/reviews/[reviewId]/media
 *
 * This route exists only to prevent confusing "works on my machine" bugs.
 */
export async function POST(_req: Request, { params }: { params: { bookingId: string } }) {
  return NextResponse.json(
    {
      error:
        'Use POST /api/client/reviews/[reviewId]/media to attach media to a review (review media).',
      hint: {
        receivedBookingId: params.bookingId,
        correctEndpoint: '/api/client/reviews/[reviewId]/media',
      },
    },
    { status: 410 },
  )
}
