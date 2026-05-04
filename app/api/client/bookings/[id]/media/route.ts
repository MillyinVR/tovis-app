// app/api/client/bookings/[id]/media/route.ts
import { type NextRequest } from 'next/server'

import { jsonFail } from '@/app/api/_utils/responses'

export const dynamic = 'force-dynamic'

function gone(id: string) {
  return jsonFail(
    410,
    'Use POST /api/client/reviews/[reviewId]/media to attach media to a review (review media).',
    {
      hint: {
        receivedId: id,
        correctEndpoint: '/api/client/reviews/[reviewId]/media',
      },
    },
  )
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return gone(id)
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return gone(id)
}
