// app/api/viral-service-requests/route.ts
import { jsonFail, jsonOk, pickInt } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { prisma } from '@/lib/prisma'
import {
  createClientViralRequest,
  listClientViralRequests,
} from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function pickTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return items
}

async function readJsonBody(req: Request): Promise<UnknownRecord | null> {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  try {
    const raw: unknown = await req.json()
    return isRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}

function isInputError(message: string): boolean {
  return (
    message === 'Viral request name is required.' ||
    message === 'Viral request name must be 160 characters or fewer.' ||
    message === 'sourceUrl must be a valid URL.' ||
    message === 'sourceUrl must use http or https.' ||
    message === 'links must be a valid URL.' ||
    message === 'links must use http or https.' ||
    message === 'mediaUrls must be a valid URL.' ||
    message === 'mediaUrls must use http or https.' ||
    message.startsWith('Text must be ')
  )
}

export async function GET(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(req.url)

    const rows = await listClientViralRequests(prisma, auth.clientId, {
      take: pickInt(searchParams.get('take')) ?? undefined,
      skip: pickInt(searchParams.get('skip')) ?? undefined,
    })

    return jsonOk({
      requests: rows.map(toViralRequestDto),
    })
  } catch (error) {
    console.error('GET /api/viral-service-requests error', error)
    return jsonFail(500, 'Couldn’t load viral requests. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const body = await readJsonBody(req)
    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.', {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      })
    }

    const requestedCategoryId = pickTrimmedString(body.requestedCategoryId)

    if (requestedCategoryId) {
      const category = await prisma.serviceCategory.findUnique({
        where: { id: requestedCategoryId },
        select: { id: true },
      })

      if (!category) {
        return jsonFail(400, 'Requested category not found.', {
          code: 'INVALID_REQUESTED_CATEGORY_ID',
        })
      }
    }

    const created = await createClientViralRequest(prisma, {
      clientId: auth.clientId,
      name: pickTrimmedString(body.name) ?? '',
      description: pickTrimmedString(body.description),
      sourceUrl: pickTrimmedString(body.sourceUrl),
      requestedCategoryId,
      links: pickStringArray(body.links),
      mediaUrls: pickStringArray(body.mediaUrls),
    })

    return jsonOk(
      {
        request: toViralRequestDto(created),
      },
      201,
    )
  } catch (error) {
    console.error('POST /api/viral-service-requests error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    if (isInputError(message)) {
      return jsonFail(400, message, {
        code: 'INVALID_VIRAL_REQUEST_INPUT',
      })
    }

    return jsonFail(500, 'Couldn’t create viral request. Try again.', {
      code: 'INTERNAL',
    })
  }
}