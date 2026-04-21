// app/api/pro/looks/route.ts
import { LookPostVisibility } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  requirePro,
} from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import {
  createOrUpdateProLookFromMediaAsset,
} from '@/lib/looks/publication/service'
import type {
  CreateProLookRequestDto,
  ProLookPublicationResultDto,
} from '@/lib/looks/publication/contracts'

export const dynamic = 'force-dynamic'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function pickOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  return undefined
}

function parseLookPostVisibility(
  value: unknown,
): LookPostVisibility | undefined {
  if (value === undefined) return undefined
  if (value === LookPostVisibility.PUBLIC) return LookPostVisibility.PUBLIC
  if (value === LookPostVisibility.FOLLOWERS_ONLY) {
    return LookPostVisibility.FOLLOWERS_ONLY
  }
  if (value === LookPostVisibility.UNLISTED) {
    return LookPostVisibility.UNLISTED
  }

  return undefined
}

function buildCreateProLookRequestDto(
  body: JsonRecord,
): CreateProLookRequestDto {
  const mediaAssetId = pickOptionalString(body.mediaAssetId)
  const primaryServiceId =
    pickOptionalString(body.primaryServiceId) ??
    pickOptionalString(body.serviceId)
  const caption =
    body.caption === null ? null : pickOptionalString(body.caption)
  const priceStartingAt =
    body.priceStartingAt === null
      ? null
      : pickOptionalString(body.priceStartingAt)
  const publish = pickOptionalBoolean(body.publish)

  if (!mediaAssetId) {
    throw new Error('mediaAssetId is required.')
  }

  const visibility = parseLookPostVisibility(body.visibility)
  if (body.visibility !== undefined && visibility === undefined) {
    throw new Error('visibility is invalid.')
  }

  return {
    mediaAssetId,
    ...(primaryServiceId !== null ? { primaryServiceId } : {}),
    ...(caption !== null ? { caption } : body.caption === null ? { caption: null } : {}),
    ...(priceStartingAt !== null
      ? { priceStartingAt }
      : body.priceStartingAt === null
        ? { priceStartingAt: null }
        : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(publish !== undefined ? { publish } : {}),
  }
}

function toErrorResponse(error: unknown): Response {
  const message =
    error instanceof Error ? error.message : 'Internal server error.'

  if (message === 'mediaAssetId is required.') {
    return jsonFail(400, message)
  }

  if (message === 'primaryServiceId is required.') {
    return jsonFail(400, message)
  }

  if (message === 'visibility is invalid.') {
    return jsonFail(400, message)
  }

  if (message === 'Media asset not found.') {
    return jsonFail(404, message)
  }

  if (message === 'Not allowed to publish this media asset.') {
    return jsonFail(403, message)
  }

  if (
    message === 'Looks publication requires a public media asset.' ||
    message ===
      'Media asset must be marked eligible for Looks before publication.' ||
    message ===
      'primaryServiceId must be one of the media asset service tags.'
  ) {
    return jsonFail(400, message)
  }

  if (
    message.startsWith('caption must be ') ||
    message === 'priceStartingAt must be a valid decimal string.' ||
    message === 'priceStartingAt must be zero or greater.'
  ) {
    return jsonFail(400, message)
  }

  return jsonFail(500, message)
}

export async function GET() {
  return jsonFail(501, 'GET /api/pro/looks is not implemented yet.')
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const body = await readJsonBody(req)
    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const request = buildCreateProLookRequestDto(body)

    const result = await createOrUpdateProLookFromMediaAsset(prisma, {
      professionalId: auth.professionalId,
      request,
    })

    const response: ProLookPublicationResultDto = result

    return jsonOk(response, 201)
  } catch (error: unknown) {
    console.error('POST /api/pro/looks error', error)
    return toErrorResponse(error)
  }
}