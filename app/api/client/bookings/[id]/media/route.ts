// app/api/client/bookings/[id]/media/route.ts
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function gone(id: string) {
  return NextResponse.json(
    {
      error: 'Use POST /api/client/reviews/[reviewId]/media to attach media to a review (review media).',
      hint: {
        receivedId: id,
        correctEndpoint: '/api/client/reviews/[reviewId]/media',
      },
    },
    { status: 410 },
  )
}

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return gone(id)
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return gone(id)
}
