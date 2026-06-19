// app/api/client/bookings/[id]/share-look/route.ts
//
// Publishes a client-authored look from a completed visit (Share-your-look
// capture). The heavy lifting lives in createClientLookFromVisit; this route
// authenticates the client, parses the body, and owns idempotency + error mapping.

import { Role } from '@prisma/client'

import { jsonFail, pickString, requireClient } from '@/app/api/_utils'
import { withRouteIdempotency } from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { isRecord } from '@/lib/guards'
import {
  ClientLookError,
  createClientLookFromVisit,
  type ClientLookPhotoSource,
} from '@/lib/looks/publication/clientLookService'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ShareLookResponseBody = {
  ok: true
  look: {
    id: string
    visibility: string
    serviceId: string
    primaryMediaAssetId: string
  }
}

/** Parses one photo source: a fresh upload session OR a reused visit photo. */
function parsePhotoSource(value: unknown): ClientLookPhotoSource | null {
  if (!isRecord(value)) return null

  const uploadSessionId = pickString(value.uploadSessionId)
  if (uploadSessionId) return { uploadSessionId }

  const reuseMediaAssetId = pickString(value.reuseMediaAssetId)
  if (reuseMediaAssetId) return { reuseMediaAssetId }

  return null
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { user, clientId } = auth

    const { id: rawId } = await resolveRouteParams(ctx)
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const name = pickString(body.name)
    if (!name) return jsonFail(400, 'A look name is required.')

    const caption = pickString(body.caption)
    const isPublic = body.isPublic !== false // default to public unless explicitly false

    const after = parsePhotoSource(body.after)
    if (!after) return jsonFail(400, 'An after photo is required to share a look.')

    const before = parsePhotoSource(body.before)

    return await withRouteIdempotency<ShareLookResponseBody>(
      {
        request: req,
        actor: { actorKey: clientId, actorRole: Role.CLIENT },
        route: IDEMPOTENCY_ROUTES.CLIENT_SHARE_LOOK,
        requestLabel: 'share look',
        requestBody: { bookingId, clientId, name, caption, isPublic, after, before },
        operation: 'POST /api/client/bookings/[id]/share-look',
      },
      async () => {
        const result = await createClientLookFromVisit(prisma, {
          clientId,
          bookingId,
          uploadedByUserId: user.id,
          name,
          caption,
          isPublic,
          after,
          before,
        })

        return {
          status: 201,
          body: {
            ok: true,
            look: {
              id: result.lookPostId,
              visibility: result.visibility,
              serviceId: result.serviceId,
              primaryMediaAssetId: result.primaryMediaAssetId,
            },
          },
        }
      },
    )
  } catch (error: unknown) {
    if (error instanceof ClientLookError) {
      return jsonFail(error.httpStatus, error.message)
    }

    console.error('POST /api/client/bookings/[id]/share-look error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Internal server error.')
  }
}
