// app/api/pro/looks/[id]/route.ts
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  getProLookPublicationById,
  updateProLookPublication,
} from '@/lib/looks/publication/service'
import {
  isLookPostVisibility,
  isProLookStateAction,
  type ProLookPublicationResultDto,
  type UpdateProLookRequestDto,
} from '@/lib/looks/publication/contracts'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

async function readJsonBody(req: Request): Promise<JsonRecord | null> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType && !contentType.includes('application/json')) {
    return null
  }

  try {
    const raw: unknown = await req.json()
    return isRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}

function buildUpdateProLookRequestDto(
  body: JsonRecord,
): UpdateProLookRequestDto {
  const hasCaption = Object.prototype.hasOwnProperty.call(body, 'caption')
  const hasPrimaryServiceId =
    Object.prototype.hasOwnProperty.call(body, 'primaryServiceId') ||
    Object.prototype.hasOwnProperty.call(body, 'serviceId')
  const hasPriceStartingAt =
    Object.prototype.hasOwnProperty.call(body, 'priceStartingAt')
  const hasVisibility =
    Object.prototype.hasOwnProperty.call(body, 'visibility')
  const hasStateAction =
    Object.prototype.hasOwnProperty.call(body, 'stateAction')

  if (
    !hasCaption &&
    !hasPrimaryServiceId &&
    !hasPriceStartingAt &&
    !hasVisibility &&
    !hasStateAction
  ) {
    throw new Error('Nothing to update.')
  }

  const request: UpdateProLookRequestDto = {}

  if (hasCaption) {
    if (body.caption === null) {
      request.caption = null
    } else if (typeof body.caption === 'string') {
      request.caption = body.caption
    } else {
      throw new Error('caption must be a string or null.')
    }
  }

  if (hasPrimaryServiceId) {
    const rawPrimaryServiceId =
      body.primaryServiceId ?? body.serviceId

    if (typeof rawPrimaryServiceId !== 'string') {
      throw new Error(
        'primaryServiceId must be a non-empty string when provided.',
      )
    }

    request.primaryServiceId = rawPrimaryServiceId
  }

  if (hasPriceStartingAt) {
    if (body.priceStartingAt === null) {
      request.priceStartingAt = null
    } else if (typeof body.priceStartingAt === 'string') {
      request.priceStartingAt = body.priceStartingAt
    } else {
      throw new Error('priceStartingAt must be a string or null.')
    }
  }

  if (hasVisibility) {
    if (!isLookPostVisibility(body.visibility)) {
      throw new Error('visibility is invalid.')
    }

    request.visibility = body.visibility
  }

  if (hasStateAction) {
    if (!isProLookStateAction(body.stateAction)) {
      throw new Error('stateAction is invalid.')
    }

    request.stateAction = body.stateAction
  }

  return request
}

function toErrorResponse(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : 'Internal server error.'

  if (message === 'Missing look id.') {
    return jsonFail(400, message)
  }

  if (
    message === 'Nothing to update.' ||
    message === 'caption must be a string or null.' ||
    message === 'priceStartingAt must be a string or null.' ||
    message ===
      'primaryServiceId must be a non-empty string when provided.' ||
    message === 'visibility is invalid.' ||
    message === 'stateAction is invalid.' ||
    message === 'primaryServiceId is required.' ||
    message ===
      'primaryServiceId must be one of the media asset service tags.' ||
    message ===
      'Looks publication requires a public media asset.' ||
    message ===
      'Media asset must be marked eligible for Looks before publication.' ||
    message.startsWith('caption must be ') ||
    message === 'priceStartingAt must be a valid decimal string.' ||
    message === 'priceStartingAt must be zero or greater.'
  ) {
    return jsonFail(400, message)
  }

  if (message === 'Look post not found.') {
    return jsonFail(404, message)
  }

  if (message === 'Not allowed to manage this look post.') {
    return jsonFail(403, message)
  }

  if (message === 'Removed look posts cannot be edited by professionals.') {
    return jsonFail(409, message)
  }

  return jsonFail(500, message)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.')
    }

    const result = await getProLookPublicationById(prisma, {
      professionalId: auth.professionalId,
      lookPostId,
    })

    const response: ProLookPublicationResultDto = result

    return jsonOk(response, 200)
  } catch (error: unknown) {
    console.error('GET /api/pro/looks/[id] error', error)
    return toErrorResponse(error)
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await getParams(ctx)
    const lookPostId = pickString(rawId)

    if (!lookPostId) {
      return jsonFail(400, 'Missing look id.')
    }

    const body = await readJsonBody(req)
    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const request = buildUpdateProLookRequestDto(body)

    const result = await updateProLookPublication(prisma, {
      professionalId: auth.professionalId,
      lookPostId,
      request,
    })

    const response: ProLookPublicationResultDto = result

    return jsonOk(response, 200)
  } catch (error: unknown) {
    console.error('PATCH /api/pro/looks/[id] error', error)
    return toErrorResponse(error)
  }
}