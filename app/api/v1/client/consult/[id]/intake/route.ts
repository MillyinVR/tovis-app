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
  consultNotFoundResponse,
  consultWriteErrorResponse,
} from '@/lib/consult/apiErrors'
import { loadHairColorIntakeState } from '@/lib/consult/intakeContract'
import {
  appendHairColorIntakeRevision,
  ConsultWriteError,
} from '@/lib/consult/writeBoundary'
import type {
  ConsultIntakeStateResponseDTO,
  ConsultIntakeSubmitResponseDTO,
} from '@/lib/dto/consult'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

async function readSubmitInput(req: Request) {
  const body = await readJsonRecord(req)
  const idempotencyKey = pickNonEmptyString(body.idempotencyKey)
  const packVersion = integer(body.packVersion)
  const schemaVersion = integer(body.schemaVersion)
  if (
    !idempotencyKey ||
    packVersion === null ||
    schemaVersion === null ||
    typeof body.complete !== 'boolean' ||
    !('answers' in body)
  ) {
    throw new ConsultWriteError('INVALID_REQUEST', 'Invalid request.')
  }
  return {
    idempotencyKey,
    packVersion,
    schemaVersion,
    complete: body.complete,
    answers: body.answers,
  }
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const intake = await loadHairColorIntakeState({
      consultSessionId: id,
      clientId: auth.clientId,
    })
    return jsonOk<ConsultIntakeStateResponseDTO>({ intake })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('GET /api/v1/client/consult/[id]/intake error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { id } = await resolveRouteParams(ctx)
    if (!id) return consultNotFoundResponse()

    const result = await appendHairColorIntakeRevision({
      consultSessionId: id,
      actor: { type: ConsultActorType.CLIENT, id: auth.user.id },
      // The canonical boundary invokes this only after holding the same session
      // lock revocation uses and proving every prerequisite.
      loadInput: () => readSubmitInput(req),
    })
    const intake = await loadHairColorIntakeState({
      consultSessionId: id,
      clientId: auth.clientId,
    })
    return jsonOk<ConsultIntakeSubmitResponseDTO>({
      intake,
      replayed: result.replayed,
    })
  } catch (error: unknown) {
    const response = consultWriteErrorResponse(error)
    if (response) return response
    console.error('POST /api/v1/client/consult/[id]/intake error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error')
  }
}
