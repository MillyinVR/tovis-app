// app/api/admin/looks/[id]/moderate/route.ts
import { NextRequest } from 'next/server'

import { handleAdminModerationRoute } from '@/lib/adminModeration/service'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await getParams(ctx)

  return handleAdminModerationRoute(req, {
    kind: 'LOOK_POST',
    targetId: id,
  })
}