import { ConsultActorType } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickNonEmptyString,
  requireClient,
} from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  loadConsultAnalysisState,
  runConsultAnalysis,
} from '@/lib/consult/analysisContract'
import {
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { ConsultWriteError } from '@/lib/consult/errors'
import type {
  ConsultAnalysisStartResponseDTO,
  ConsultAnalysisStateResponseDTO,
} from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function readStartInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const promptVersion = pickNonEmptyString(body.promptVersion)
  if (
    !idempotencyKey ||
    !promptVersion ||
    typeof body.schemaVersion !== 'number' ||
    !Number.isInteger(body.schemaVersion)
  ) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return {
    idempotencyKey,
    schemaVersion: body.schemaVersion,
    promptVersion,
  }
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()
    const analysis = await loadConsultAnalysisState({
      consultSessionId: id,
      clientId: auth.clientId,
      actorUserId: auth.user.id,
    })
    return jsonOk<ConsultAnalysisStateResponseDTO>({ analysis })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('GET consult analysis error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()
    const result = await runConsultAnalysis({
      consultSessionId: id,
      clientId: auth.clientId,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      loadInput: () => readStartInput(req),
    })
    return jsonOk<ConsultAnalysisStartResponseDTO>({
      analysis: result.state,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST consult analysis error', { error: safeError(error) })
    return jsonFail(500, 'Internal server error')
  }
}
