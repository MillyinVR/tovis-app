// app/api/v1/client/bookings/[id]/media/route.ts
import { type NextRequest } from 'next/server'

import { jsonFail } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'

export const dynamic = 'force-dynamic'

function gone(id: string) {
  return jsonFail(
    410,
    'Use POST /api/v1/client/reviews/[reviewId]/media to attach media to a review (review media).',
    {
      hint: {
        receivedId: id,
        correctEndpoint: '/api/v1/client/reviews/[reviewId]/media',
      },
    },
  )
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const { id } = await resolveRouteParams(context)
  return gone(id)
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await resolveRouteParams(context)
  return gone(id)
}
