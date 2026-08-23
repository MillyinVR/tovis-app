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
import {
  deleteConsultCapture,
} from '@/lib/consult/captureContract'
import type { ConsultCaptureDeleteResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { id: string; captureId: string }

export async function DELETE(_req: Request, ctx: RouteContext<Params>) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const limited = await enforceRateLimit({
      bucket: 'client:consult:write',
      identity: await rateLimitIdentity(auth.user.id),
    })
    if (limited) return limited
    const { id, captureId } = await resolveRouteParams(ctx)
    if (!id || !captureId) return consultNotFoundResponse()

    await deleteConsultCapture({
      consultSessionId: id,
      captureId,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    })
    return jsonOk<ConsultCaptureDeleteResponseDTO>({ deleted: true })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('DELETE consult capture error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
