import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { loadConsultCaptureState } from '@/lib/consult/captureContract'
import type { ConsultCaptureStateResponseDTO } from '@/lib/dto/consult'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const capture = await loadConsultCaptureState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultCaptureStateResponseDTO>({ capture })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('GET consult capture error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
