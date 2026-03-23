// app/api/client/bookings/[id]/review/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  BookingCheckoutStatus,
  MediaType,
  MediaVisibility,
  Role,
} from '@prisma/client'
import {
  requireClient,
  pickString,
  jsonFail,
  jsonOk,
  safeUrl,
  resolveStoragePointers,
} from '@/app/api/_utils'
import { parseIdArray, parseRating1to5 } from '@/lib/media'

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

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function isMediaType(x: unknown): x is MediaType {
  return x === MediaType.IMAGE || x === MediaType.VIDEO
}

function isReviewCloseoutEligible(args: {
  aftercareSentAt: Date | null | undefined
  checkoutStatus: BookingCheckoutStatus | null | undefined
}): boolean {
  return (
    Boolean(args.aftercareSentAt) &&
    (args.checkoutStatus === BookingCheckoutStatus.PAID ||
      args.checkoutStatus === BookingCheckoutStatus.WAIVED)
  )
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []

  const items: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!isRecord(raw)) continue

    const url = safeUrl(raw.url)
    if (!url) continue

    const thumbUrlRaw = raw.thumbUrl
    const thumbUrl =
      thumbUrlRaw == null || thumbUrlRaw === '' ? null : safeUrl(thumbUrlRaw)
    if (thumbUrlRaw && !thumbUrl) continue

    const mediaType: MediaType = isMediaType(raw.mediaType)
      ? raw.mediaType
      : MediaType.IMAGE

    items.push({
      url,
      thumbUrl,
      mediaType,
      storageBucket: pickString(raw.storageBucket) ?? null,
      storagePath: pickString(raw.storagePath) ?? null,
      thumbBucket: pickString(raw.thumbBucket) ?? null,
      thumbPath: pickString(raw.thumbPath) ?? null,
    })
  }

  return items
}

function enforceClientMediaCaps(items: IncomingMediaItem[]): string | null {
  if (!items.length) return null

  if (items.length > MAX_CLIENT_MEDIA_TOTAL) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_CLIENT_MEDIA_TOTAL} total).`
  }

  let images = 0
  let videos = 0

  for (const m of items) {
    if (m.mediaType === MediaType.VIDEO) videos += 1
    else images += 1
  }

  if (images > MAX_CLIENT_IMAGES) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images.`
  }

  if (videos > MAX_CLIENT_VIDEOS) {
    return `You can upload up to ${MAX_CLIENT_VIDEOS} video.`
  }

  return null
}

/**
 * Review media visibility rule:
 * Anything attached to a review is PUBLIC.
 */
const REVIEW_MEDIA_VISIBILITY = MediaVisibility.PUBLIC

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { user, clientId } = auth

    const { id: rawId } = await ctx.params
    const bookingId = pickString(rawId)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const body = (await req.json().catch(() => ({}))) as CreateReviewBody

    const rating = parseRating1to5(body.rating)
    if (!rating) {
      return jsonFail(400, 'Rating must be an integer from 1–5.')
    }

    const headline =
      typeof body.headline === 'string' ? body.headline.trim() : null
    const reviewBody = typeof body.body === 'string' ? body.body.trim() : null

    const clientMediaItems = parseMedia(body.media)
    const attachedMediaIds = parseIdArray(
      body.attachedMediaIds,
      MAX_ATTACH_APPT_MEDIA,
    )

    const capError = enforceClientMediaCaps(clientMediaItems)
    if (capError) return jsonFail(400, capError)

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        clientId: true,
        professionalId: true,
        checkoutStatus: true,
        aftercareSummary: {
          select: {
            id: true,
            sentToClientAt: true,
          },
        },
      },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.clientId !== clientId) return jsonFail(403, 'Forbidden.')

    const reviewEligible = isReviewCloseoutEligible({
      aftercareSentAt: booking.aftercareSummary?.sentToClientAt,
      checkoutStatus: booking.checkoutStatus,
    })

    if (!reviewEligible) {
      return jsonFail(
        409,
        'Review is not available until aftercare is finalized and checkout is complete.',
      )
    }

    const existing = await prisma.review.findFirst({
      where: {
        bookingId: booking.id,
        clientId,
      },
      select: { id: true },
    })

    if (existing) {
      return jsonFail(409, 'Review already exists for this booking.', {
        reviewId: existing.id,
      })
    }

    const resolvedClientMedia = clientMediaItems.map((m) => {
      const ptrs = resolveStoragePointers({
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        storageBucket: m.storageBucket ?? null,
        storagePath: m.storagePath ?? null,
        thumbBucket: m.thumbBucket ?? null,
        thumbPath: m.thumbPath ?? null,
      })

      if (!ptrs) {
        throw new Error('MEDIA_POINTERS_REQUIRED')
      }

      return {
        mediaType: m.mediaType,
        caption: null as string | null,
        storageBucket: ptrs.storageBucket,
        storagePath: ptrs.storagePath,
        thumbBucket: ptrs.thumbBucket,
        thumbPath: ptrs.thumbPath,
        url: null as string | null,
        thumbUrl: null as string | null,
      }
    })

    const fullReview = await prisma.$transaction(async (tx) => {
      // Only allow attaching appointment media that still belongs to this booking,
      // is not already attached to another review, and is still private booking media.
      // Preserve current review behavior: only PRO-uploaded appointment media can be attached.
      const attachables = attachedMediaIds.length
        ? await tx.mediaAsset.findMany({
            where: {
              id: { in: attachedMediaIds },
              bookingId: booking.id,
              professionalId: booking.professionalId,
              uploadedByRole: Role.PRO,
              reviewId: null,
              reviewLocked: false,
              visibility: MediaVisibility.PRO_CLIENT,
              mediaType: { in: [MediaType.IMAGE, MediaType.VIDEO] },
            },
            select: { id: true },
          })
        : []

      if (
        attachedMediaIds.length > 0 &&
        attachables.length !== attachedMediaIds.length
      ) {
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

      if (attachables.length > 0) {
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

      if (resolvedClientMedia.length > 0) {
        await tx.mediaAsset.createMany({
          data: resolvedClientMedia.map((m) => ({
            professionalId: booking.professionalId,
            bookingId: booking.id,
            reviewId: review.id,
            mediaType: m.mediaType,
            visibility: REVIEW_MEDIA_VISIBILITY,
            uploadedByUserId: user.id,
            uploadedByRole: Role.CLIENT,
            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
            reviewLocked: true,
            storageBucket: m.storageBucket,
            storagePath: m.storagePath,
            thumbBucket: m.thumbBucket,
            thumbPath: m.thumbPath,
            url: m.url,
            thumbUrl: m.thumbUrl,
            caption: m.caption,
          })),
        })
      }

      return tx.review.findUnique({
        where: { id: review.id },
        include: {
          mediaAssets: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              mediaType: true,
              createdAt: true,
              visibility: true,
              uploadedByRole: true,
              isFeaturedInPortfolio: true,
              isEligibleForLooks: true,
              reviewLocked: true,
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
              url: true,
              thumbUrl: true,
            },
          },
        },
      })
    })

    if (!fullReview) return jsonFail(500, 'Internal server error.')
    return jsonOk({ review: fullReview }, 201)
  } catch (e: unknown) {
    const message =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message?: unknown }).message || '')
        : ''

    if (message === 'ATTACH_INVALID') {
      return jsonFail(
        400,
        'One or more selected appointment media items are not available to attach.',
      )
    }

    if (message === 'MEDIA_POINTERS_REQUIRED') {
      return jsonFail(
        400,
        'Media must include storageBucket/storagePath (or a Supabase Storage URL we can parse).',
      )
    }

    console.error('POST /api/client/bookings/[id]/review error', e)
    return jsonFail(500, 'Internal server error.')
  }
}