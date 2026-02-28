// app/api/client/bookings/[id]/review/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MediaType, MediaVisibility, Role } from '@prisma/client'
import {
  requireClient,
  pickString,
  jsonFail,
  safeUrl,
  resolveStoragePointers,
  parseIdArray,
  parseRating1to5,
  jsonOk,
} from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

const MAX_ATTACH_APPT_MEDIA = 6
const MAX_CLIENT_IMAGES = 6
const MAX_CLIENT_VIDEOS = 1
const MAX_CLIENT_MEDIA_TOTAL = MAX_CLIENT_IMAGES + MAX_CLIENT_VIDEOS

type CreateReviewBody = {
  rating?: unknown
  headline?: unknown
  body?: unknown
  media?: unknown
  attachedMediaIds?: unknown
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

function isMediaType(x: unknown): x is MediaType {
  return x === MediaType.IMAGE || x === MediaType.VIDEO
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []
  const items: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>

    const url = safeUrl(obj.url)
    if (!url) continue

    const thumbUrlRaw = obj.thumbUrl
    const thumbUrl = thumbUrlRaw == null || thumbUrlRaw === '' ? null : safeUrl(thumbUrlRaw)
    if (thumbUrlRaw && !thumbUrl) continue

    const mediaType: MediaType = isMediaType(obj.mediaType) ? obj.mediaType : MediaType.IMAGE

    items.push({
      url,
      thumbUrl,
      mediaType,
      storageBucket: pickString(obj.storageBucket) ?? null,
      storagePath: pickString(obj.storagePath) ?? null,
      thumbBucket: pickString(obj.thumbBucket) ?? null,
      thumbPath: pickString(obj.thumbPath) ?? null,
    })
  }

  return items
}

function enforceClientMediaCaps(items: IncomingMediaItem[]) {
  if (!items.length) return null

  if (items.length > MAX_CLIENT_MEDIA_TOTAL) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_CLIENT_MEDIA_TOTAL} total).`
  }

  let images = 0
  let videos = 0
  for (const m of items) {
    if (m.mediaType === MediaType.VIDEO) videos++
    else images++
  }

  if (images > MAX_CLIENT_IMAGES) return `You can upload up to ${MAX_CLIENT_IMAGES} images.`
  if (videos > MAX_CLIENT_VIDEOS) return `You can upload up to ${MAX_CLIENT_VIDEOS} video.`
  return null
}

/**
 * Review media visibility rule:
 * - Anything attached to a review is PUBLIC (client opted in by attaching/uploading).
 *
 * PRO_CLIENT is for booking/aftercare-only media, not review media.
 */
const REVIEW_MEDIA_VISIBILITY = MediaVisibility.PUBLIC

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { user, clientId } = auth

    const { id } = await ctx.params
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as CreateReviewBody

    const rating = parseRating1to5(body.rating)
    if (!rating) return jsonFail(400, 'Rating must be an integer from 1–5.')

    const headline = typeof body.headline === 'string' ? body.headline.trim() : null
    const reviewBody = typeof body.body === 'string' ? body.body.trim() : null

    const clientMediaItems = parseMedia(body.media)

    // Allow selecting up to 6 appointment media (pro-uploaded booking media only)
    const attachedMediaIds = parseIdArray(body.attachedMediaIds, MAX_ATTACH_APPT_MEDIA)

    // Enforce caps for client uploads
    const capError = enforceClientMediaCaps(clientMediaItems)
    if (capError) return jsonFail(400, capError)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, professionalId: true },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const existing = await prisma.review.findFirst({
      where: { bookingId: booking.id, clientId },
      select: { id: true },
    })

    if (existing) {
      return jsonFail(409, 'Review already exists for this booking.', { reviewId: existing.id })
    }

    // Validate pointers before transaction (fast fail)
    const resolvedClientMedia = clientMediaItems.map((m) => {
      const ptrs = resolveStoragePointers(m)
      if (!ptrs) throw new Error('Media must include storageBucket/storagePath or a parsable Supabase Storage URL.')
      return { ...m, ...ptrs }
    })

    const fullReview = await prisma.$transaction(async (tx) => {
      // Only allow attaching PRO-uploaded booking media that isn't already attached/locked into a review
      const attachables = attachedMediaIds.length
        ? await tx.mediaAsset.findMany({
            where: {
              id: { in: attachedMediaIds },
              bookingId: booking.id,
              professionalId: booking.professionalId,
              uploadedByRole: Role.PRO,
              reviewId: null,
            },
            select: { id: true },
          })
        : []

      if (attachedMediaIds.length && attachables.length !== attachedMediaIds.length) {
        throw new Error('ATTACH_INVALID')
      }

      const review = await tx.review.create({
        data: {
          clientId,
          professionalId: booking.professionalId,
          bookingId: booking.id,
          rating,
          headline: headline || null,
          body: reviewBody || null,
        },
        select: { id: true },
      })

      // Attach selected appointment media -> becomes PUBLIC because it is now in a review
      if (attachables.length) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: attachables.map((a) => a.id) } },
          data: {
            reviewId: review.id,
            visibility: REVIEW_MEDIA_VISIBILITY,
            isEligibleForLooks: false,
            isFeaturedInPortfolio: false,
            reviewLocked: true,
          },
        })
      }

      // Client-uploaded media for review -> created as PUBLIC (review media)
      if (resolvedClientMedia.length) {
        await tx.mediaAsset.createMany({
          data: resolvedClientMedia.map((m) => ({
            professionalId: booking.professionalId,
            bookingId: booking.id,
            reviewId: review.id,

            url: m.url,
            thumbUrl: m.thumbUrl ?? null,
            mediaType: m.mediaType,

            visibility: REVIEW_MEDIA_VISIBILITY,
            uploadedByUserId: user.id,
            uploadedByRole: Role.CLIENT,

            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
            reviewLocked: true,

            storageBucket: m.storageBucket!,
            storagePath: m.storagePath!,
            thumbBucket: m.thumbBucket ?? null,
            thumbPath: m.thumbPath ?? null,
          })),
        })
      }

      const full = await tx.review.findUnique({
        where: { id: review.id },
        include: {
          mediaAssets: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              url: true,
              thumbUrl: true,
              mediaType: true,
              createdAt: true,
              visibility: true,
              uploadedByRole: true,
              isFeaturedInPortfolio: true,
              isEligibleForLooks: true,
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
            },
          },
        },
      })

      return full
    })

    if (!fullReview) return jsonFail(500, 'Internal server error')

    return jsonOk({ review: fullReview }, 201)
  } catch (e: unknown) {
    const message =
      e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message || '') : ''

    if (message === 'ATTACH_INVALID') {
      return jsonFail(400, 'One or more selected images are not available to attach.')
    }

    console.error('POST /api/client/bookings/[id]/review error', e)

    const msg = message && message.includes('storage') ? message : 'Internal server error'
    return jsonFail(500, msg)
  }
}