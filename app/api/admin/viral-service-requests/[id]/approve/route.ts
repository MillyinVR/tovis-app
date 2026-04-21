// app/api/admin/viral-service-requests/[id]/approve/route.ts
import { NextRequest } from 'next/server'

import { handleLegacyViralModerationRoute } from '@/lib/adminModeration/service'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await getParams(ctx)

  return handleLegacyViralModerationRoute(req, {
    targetId: id,
    forcedAction: 'approve',
  })
}