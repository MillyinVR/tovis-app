// app/api/v1/admin/looks/[id]/moderate/route.ts
import { NextRequest } from 'next/server'

import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { handleAdminModerationRoute } from '@/lib/adminModeration/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await resolveRouteParams(ctx)

  return handleAdminModerationRoute(req, {
    kind: 'LOOK_POST',
    targetId: id,
  })
}