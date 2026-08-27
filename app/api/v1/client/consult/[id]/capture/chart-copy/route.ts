import { ConsultActorType } from '@prisma/client'

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { updateConsultChartCopyChoice } from '@/lib/consult/captureContract'
import type {
  ConsultCaptureStateResponseDTO,
  ConsultChartCopyUpdateRequestDTO,
} from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Decision 2026-08-26: records the client's default-on but visibly optional
// choice to keep consult photos on their chart. Changeable until analysis runs.
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited

    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return jsonFail(400, 'Invalid request body')
    }
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as ConsultChartCopyUpdateRequestDTO).optIn !== 'boolean'
    ) {
      return jsonFail(400, 'Invalid request body')
    }
    const { optIn } = body as ConsultChartCopyUpdateRequestDTO

    const capture = await updateConsultChartCopyChoice({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      optIn,
    })
    return jsonOk<ConsultCaptureStateResponseDTO>({ capture })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST consult chart-copy error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
