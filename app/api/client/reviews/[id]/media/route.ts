// app/api/client/reviews/[id]/media/route.ts

import { MediaType, MediaVisibility, Role } from '@prisma/client'
import { NextRequest } from 'next/server'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveStoragePointers, safeUrl } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const MAX_CLIENT_IMAGES = 6
const MAX_CLIENT_VIDEOS = 1
const MAX_TOTAL = MAX_CLIENT_IMAGES + MAX_CLIENT_VIDEOS

const PATH_MAX = 2048
const BUCKET_MAX = 128
const SIGNED_TTL_SECONDS = 60 * 10

type AddReviewMediaBody = {
  media?: unknown
}

type IncomingMediaItem = {
  url: string
  thumbUrl?: string | null
  mediaType: MediaType
  storageBucket?: string | null
  storagePath?: string | null
  thumbBucket?: string | null
  thumbPath?: string | null
}

type ResolvedMediaItem = {
  mediaType: MediaType
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isMediaType(value: unknown): value is MediaType {
  return value === MediaType.IMAGE || value === MediaType.VIDEO
}

function isPublicBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPublic
}

function isPrivateBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPrivate
}

function safeBucket(raw: unknown): string | null {
  const value = pickString(raw)

  if (!value) return null
  if (value.length > BUCKET_MAX) return null
  if (value === BUCKETS.mediaPrivate) return BUCKETS.mediaPrivate
  if (value === BUCKETS.mediaPublic) return BUCKETS.mediaPublic

  return null
}

function safeStoragePath(raw: unknown): string | null {
  const value = pickString(raw)

  if (!value) return null
  if (value.length > PATH_MAX) return null
  if (value.startsWith('/')) return null
  if (value.includes('..')) return null

  return value
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []

  const out: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!isRecord(raw)) continue

    const url = safeUrl(raw.url)
    if (!url) continue

    const thumbUrlRaw = raw.thumbUrl
    const thumbUrl =
      thumbUrlRaw === null || thumbUrlRaw === undefined || thumbUrlRaw === ''
        ? null
        : safeUrl(thumbUrlRaw)

    if (thumbUrlRaw && !thumbUrl) continue

    const mediaType = isMediaType(raw.mediaType)
      ? raw.mediaType
      : MediaType.IMAGE

    out.push({
      url,
      thumbUrl,
      mediaType,
      storageBucket: pickString(raw.storageBucket) ?? null,
      storagePath: pickString(raw.storagePath) ?? null,
      thumbBucket: pickString(raw.thumbBucket) ?? null,
      thumbPath: pickString(raw.thumbPath) ?? null,
    })
  }

  return out
}

function enforceCaps(items: IncomingMediaItem[]): string | null {
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

function resolveReviewMediaItem(item: IncomingMediaItem): ResolvedMediaItem {
  const pointers = resolveStoragePointers({
    url: item.url,
    thumbUrl: item.thumbUrl ?? null,
    storageBucket: item.storageBucket ?? null,
    storagePath: item.storagePath ?? null,
    thumbBucket: item.thumbBucket ?? null,
    thumbPath: item.thumbPath ?? null,
  })

  if (!pointers) {
    throw new Error(
      'Media must include storageBucket/storagePath or a parsable Supabase URL.',
    )
  }

  const storageBucket = safeBucket(pointers.storageBucket)
  const storagePath = safeStoragePath(pointers.storagePath)
  const thumbBucket = pointers.thumbBucket ? safeBucket(pointers.thumbBucket) : null
  const thumbPath = pointers.thumbPath ? safeStoragePath(pointers.thumbPath) : null

  if (!storageBucket || !storagePath) {
    throw new Error('Invalid storageBucket/storagePath.')
  }

  if ((thumbBucket && !thumbPath) || (!thumbBucket && thumbPath)) {
    throw new Error('thumbBucket and thumbPath must be provided together.')
  }

  if (storageBucket !== BUCKETS.mediaPublic) {
    throw new Error(`Review media must upload to ${BUCKETS.mediaPublic}.`)
  }

  if (thumbBucket && thumbBucket !== BUCKETS.mediaPublic) {
    throw new Error(`Review thumb must upload to ${BUCKETS.mediaPublic}.`)
  }

  return {
    mediaType: item.mediaType,
    storageBucket,
    storagePath,
    thumbBucket,
    thumbPath,
  }
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireClient()

    if (!auth.ok) return auth.res

    const { user, clientId } = auth

    const { id } = await context.params
    const reviewId = pickString(id)

    if (!reviewId) {
      return jsonFail(400, 'Missing review id.')
    }

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const incoming = parseMedia(body.media)

    if (!incoming.length) {
      return jsonFail(400, 'No valid media provided.')
    }

    const capError = enforceCaps(incoming)

    if (capError) {
      return jsonFail(400, capError)
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

    const resolved: ResolvedMediaItem[] = []

    for (const item of incoming) {
      try {
        resolved.push(resolveReviewMediaItem(item))
      } catch (error: unknown) {
        return jsonFail(400, errMessage(error))
      }
    }

    for (const media of resolved) {
      const fileExists = await objectExists(
        media.storageBucket,
        media.storagePath,
      )

      if (!fileExists) {
        return jsonFail(400, 'Uploaded file not found in storage.')
      }

      if (media.thumbBucket && media.thumbPath) {
        const thumbExists = await objectExists(
          media.thumbBucket,
          media.thumbPath,
        )

        if (!thumbExists) {
          return jsonFail(400, 'Uploaded thumb not found in storage.')
        }
      }
    }

    const bookingId = review.bookingId

    const created = await prisma.$transaction(async (tx) => {
      const rows = await Promise.all(
        resolved.map((media) =>
          tx.mediaAsset.create({
            data: {
              professionalId: review.professionalId,
              bookingId,
              reviewId: review.id,
              storageBucket: media.storageBucket,
              storagePath: media.storagePath,
              thumbBucket: media.thumbBucket,
              thumbPath: media.thumbPath,
              url: null,
              thumbUrl: null,
              mediaType: media.mediaType,
              visibility: MediaVisibility.PUBLIC,
              uploadedByUserId: user.id,
              uploadedByRole: Role.CLIENT,
              isFeaturedInPortfolio: false,
              isEligibleForLooks: false,
              reviewLocked: true,
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
          }),
        ),
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
    console.error('POST /api/client/reviews/[id]/media error', error)

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