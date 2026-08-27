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
import { proceedConsultCaptureToAnalysis } from '@/lib/consult/captureContract'
import { ConsultWriteError } from '@/lib/consult/errors'
import type { ConsultCaptureStateDTO } from '@/lib/dto/consult'
import { isTransactionSerializationError } from '@/lib/prismaErrors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { id: string }

// Explicit client choice to run the analysis with an incomplete accepted pack
// (Tori, 2026-08-27). Requires the finished inspiration step and at least one
// accepted capture; a session already at ANALYSIS_PENDING replays as success.
export async function POST(_req: Request, ctx: RouteContext<Params>) {
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

    const result = await proceedConsultCaptureToAnalysis({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
    })
    return jsonOk<{ capture: ConsultCaptureStateDTO; advanced: boolean }>({
      capture: result.capture,
      advanced: result.advanced,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    if (isTransactionSerializationError(error)) {
      const conflictResponse = consultWriteErrorResponse(
        new ConsultWriteError('INVALID_STATE', 'Consult state changed.'),
      )
      if (conflictResponse) return conflictResponse
    }
    console.error('POST consult capture proceed error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return jsonFail(500, 'Internal server error')
  }
}
