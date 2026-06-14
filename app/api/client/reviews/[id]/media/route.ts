// app/api/client/reviews/[id]/media/route.ts

import { MediaType, MediaVisibility, Role, UploadSurface } from '@prisma/client'
import { NextRequest } from 'next/server'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { isRecord } from '@/lib/guards'
import { safeUrl } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import {
  consumeUploadSession,
  UploadSessionError,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { resolveProTenantId } from '@/lib/tenant/bookingAttribution'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

const MAX_CLIENT_IMAGES = 6
const MAX_CLIENT_VIDEOS = 1
const MAX_TOTAL = MAX_CLIENT_IMAGES + MAX_CLIENT_VIDEOS

const SIGNED_TTL_SECONDS = 60 * 10

type AddReviewMediaBody = {
  media?: unknown
}

type IncomingMediaItem = {
  uploadSessionId: string
}

type ResolvedMediaItem = {
  uploadSessionId: string
  mediaType: MediaType
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
}

function isPublicBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPublic
}

function isPrivateBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPrivate
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []

  const out: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!isRecord(raw)) continue

    const uploadSessionId = pickString(raw.uploadSessionId)
    if (!uploadSessionId) continue

    out.push({ uploadSessionId })
  }

  return out
}

function enforceCaps(items: ResolvedMediaItem[]): string | null {
  if (items.length > MAX_TOTAL) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_TOTAL} total).`
  }

  let images = 0
  let videos = 0

  for (const item of items) {
    if (item.mediaType === MediaType.VIDEO) {
      videos += 1
    } else {
      images += 1
    }
  }

  if (images > MAX_CLIENT_IMAGES) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images.`
  }

  if (videos > MAX_CLIENT_VIDEOS) {
    return `You can upload up to ${MAX_CLIENT_VIDEOS} video.`
  }

  return null
}

async function signObjectUrl(
  bucket: string,
  path: string,
): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_TTL_SECONDS)

    if (error) return null

    return safeUrl(data?.signedUrl)
  } catch {
    return null
  }
}

/**
 * Verify object exists before writing DB row.
 * For private objects: sign + HEAD.
 * For public objects: getPublicUrl + HEAD.
 */
async function objectExists(bucket: string, path: string): Promise<boolean> {
  if (isPrivateBucket(bucket)) {
    const signed = await signObjectUrl(bucket, path)

    if (!signed) return false

    const head = await fetch(signed, { method: 'HEAD' }).catch(() => null)

    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false

    const get = await fetch(signed, { method: 'GET' }).catch(() => null)

    return Boolean(get?.ok)
  }

  if (isPublicBucket(bucket)) {
    const admin = getSupabaseAdmin()
    const { data } = admin.storage.from(bucket).getPublicUrl(path)
    const url = safeUrl(data?.publicUrl)

    if (!url) return false

    const head = await fetch(url, { method: 'HEAD' }).catch(() => null)

    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false

    const get = await fetch(url, { method: 'GET' }).catch(() => null)

    return Boolean(get?.ok)
  }

  return false
}

function mediaTypeFromContentType(contentType: string): MediaType {
  return contentType.toLowerCase().startsWith('video/')
    ? MediaType.VIDEO
    : MediaType.IMAGE
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireClient()

    if (!auth.ok) return auth.res

    const { user, clientId } = auth

    const { id } = await resolveRouteParams(context)
    const reviewId = pickString(id)

    if (!reviewId) {
      return jsonFail(400, 'Missing review id.')
    }

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const incoming = parseMedia(body.media)

    if (!incoming.length) {
      return jsonFail(400, 'No valid media provided.')
    }

    if (incoming.length > MAX_TOTAL) {
      return jsonFail(
        400,
        `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_TOTAL} total).`,
      )
    }

    const review = await prisma.review.findUnique({
      where: {
        id: reviewId,
      },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        bookingId: true,
      },
    })

    if (!review) {
      return jsonFail(404, 'Review not found.')
    }

    if (review.clientId !== clientId) {
      return jsonFail(403, 'Forbidden.')
    }

    if (!review.bookingId) {
      return jsonFail(
        409,
        'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.',
      )
    }

    const existingCount = await prisma.mediaAsset.count({
      where: {
        reviewId: review.id,
        uploadedByRole: Role.CLIENT,
      },
    })

    if (existingCount + incoming.length > MAX_TOTAL) {
      return jsonFail(
        400,
        `This review already has ${existingCount} upload(s). Max is ${MAX_TOTAL}.`,
      )
    }

    // Validate every upload session up front (ownership + surface + expiry).
    // The storage pointer is read back from each session, never the client body.
    const resolved: ResolvedMediaItem[] = []

    for (const item of incoming) {
      let session
      try {
        session = await validateUploadSession(prisma, {
          uploadSessionId: item.uploadSessionId,
          surface: UploadSurface.CLIENT_REVIEW,
          clientId,
          now: new Date(),
        })
      } catch (error: unknown) {
        if (error instanceof UploadSessionError) {
          return jsonFail(error.httpStatus, error.message)
        }
        throw error
      }

      if (session.storageBucket !== BUCKETS.mediaPublic) {
        return jsonFail(400, `Review media must upload to ${BUCKETS.mediaPublic}.`)
      }

      resolved.push({
        uploadSessionId: item.uploadSessionId,
        mediaType: mediaTypeFromContentType(session.contentType),
        storageBucket: session.storageBucket,
        storagePath: session.storagePath,
        thumbBucket: null,
        thumbPath: null,
      })
    }

    const capError = enforceCaps(resolved)

    if (capError) {
      return jsonFail(400, capError)
    }

    for (const media of resolved) {
      const fileExists = await objectExists(
        media.storageBucket,
        media.storagePath,
      )

      if (!fileExists) {
        return jsonFail(400, 'Uploaded file not found in storage.')
      }
    }

    const bookingId = review.bookingId

    const created = await prisma.$transaction(async (tx) => {
      const proTenantId = await resolveProTenantId(tx, review.professionalId)
      const rows = await Promise.all(
        resolved.map(async (media) => {
          const row = await tx.mediaAsset.create({
            data: {
              ...buildMediaAssetCreateData({
                professionalId: review.professionalId,
                proTenantId,
                bookingId,
                reviewId: review.id,
                storageBucket: media.storageBucket,
                storagePath: media.storagePath,
                thumbBucket: media.thumbBucket,
                thumbPath: media.thumbPath,
                mediaType: media.mediaType,
                visibility: MediaVisibility.PUBLIC,
                uploadedByUserId: user.id,
                uploadedByRole: Role.CLIENT,
                reviewLocked: true,
              }),
            },
            select: {
              id: true,
              mediaType: true,
              visibility: true,
              createdAt: true,
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
              url: true,
              thumbUrl: true,
            },
          })

          await consumeUploadSession(tx, {
            uploadSessionId: media.uploadSessionId,
            mediaAssetId: row.id,
            now: new Date(),
          })

          return row
        }),
      )

      const updated = await tx.review.findUnique({
        where: {
          id: reviewId,
        },
        include: {
          mediaAssets: true,
        },
      })

      return {
        rows,
        updated,
      }
    })

    const createdForUI = await Promise.all(
      created.rows.map(async (media) => {
        const { renderUrl, renderThumbUrl } = await renderMediaUrls({
          storageBucket: media.storageBucket,
          storagePath: media.storagePath,
          thumbBucket: media.thumbBucket,
          thumbPath: media.thumbPath,
          url: media.url,
          thumbUrl: media.thumbUrl,
        })

        return {
          ...media,
          renderUrl,
          renderThumbUrl,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        }
      }),
    )

    return jsonOk(
      {
        createdCount: createdForUI.length,
        created: createdForUI,
        review: created.updated,
      },
      201,
    )
  } catch (error: unknown) {
    console.error('POST /api/client/reviews/[id]/media error', {
      error: safeError(error),
    })

    const message = errMessage(error)
    const safe =
      message.includes('Media') ||
      message.includes('storage') ||
      message.includes('thumb') ||
      message.includes('Review')
        ? message
        : 'Internal server error'

    return jsonFail(500, safe)
  }
}