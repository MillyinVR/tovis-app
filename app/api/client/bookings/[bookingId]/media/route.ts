import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function gone(bookingId: string) {
  return NextResponse.json(
    {
      error: 'Use POST /api/client/reviews/[reviewId]/media to attach media to a review (review media).',
      hint: {
        receivedBookingId: bookingId,
        correctEndpoint: '/api/client/reviews/[reviewId]/media',
      },
    },
    { status: 410 },
  )
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await context.params
  return gone(bookingId)
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await context.params
  return gone(bookingId)
}
