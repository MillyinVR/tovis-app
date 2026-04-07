// app/api/client/bookings/[id]/review/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  BookingCloseoutAuditAction,
  MediaType,
  MediaVisibility,
  NotificationPriority,
  NotificationType,
  ProNotificationReason,
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
import { assertClientBookingReviewEligibility } from '@/lib/booking/writeBoundary'
import {
  createBookingCloseoutAuditLog,
  normalizeIdempotencyKey,
} from '@/lib/booking/closeoutAudit'
import { createProNotification } from '@/lib/notifications/proNotifications'

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
  idempotencyKey?: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isMediaType(value: unknown): value is MediaType {
  return value === MediaType.IMAGE || value === MediaType.VIDEO
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

  for (const item of items) {
    if (item.mediaType === MediaType.VIDEO) videos += 1
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

async function createReviewReceivedProNotification(args: {
  professionalId: string
  bookingId: string
  reviewId: string
  actorUserId: string
  rating: number
  headline: string | null
  attachedAppointmentMediaCount: number
  clientUploadedMediaCount: number
}): Promise<void> {
  const title = 'New review received'
  const body = `A client left a ${args.rating}-star review.`

  await createProNotification({
    professionalId: args.professionalId,
    type: NotificationType.REVIEW,
    reason: ProNotificationReason.REVIEW_RECEIVED,
    priority: NotificationPriority.NORMAL,
    title,
    body,
    href: `/pro/bookings/${args.bookingId}`,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    reviewId: args.reviewId,
    dedupeKey: `PRO_NOTIF:${ProNotificationReason.REVIEW_RECEIVED}:${args.reviewId}`,
    data: {
      bookingId: args.bookingId,
      reviewId: args.reviewId,
      rating: args.rating,
      headline: args.headline,
      attachedAppointmentMediaCount: args.attachedAppointmentMediaCount,
      clientUploadedMediaCount: args.clientUploadedMediaCount,
      hasMedia:
        args.attachedAppointmentMediaCount + args.clientUploadedMediaCount > 0,
    },
  })
}

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

    const requestId = normalizeIdempotencyKey(req.headers.get('x-request-id'))
    const idempotencyKey = normalizeIdempotencyKey(
      req.headers.get('x-idempotency-key') ?? pickString(body.idempotencyKey),
    )

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

    const eligibility = await assertClientBookingReviewEligibility({
      bookingId,
      clientId,
    })

    const resolvedClientMedia = clientMediaItems.map((item) => {
      const pointers = resolveStoragePointers({
        url: item.url,
        thumbUrl: item.thumbUrl ?? null,
        storageBucket: item.storageBucket ?? null,
        storagePath: item.storagePath ?? null,
        thumbBucket: item.thumbBucket ?? null,
        thumbPath: item.thumbPath ?? null,
      })

      if (!pointers) {
        throw new Error('MEDIA_POINTERS_REQUIRED')
      }

      return {
        mediaType: item.mediaType,
        caption: null as string | null,
        storageBucket: pointers.storageBucket,
        storagePath: pointers.storagePath,
        thumbBucket: pointers.thumbBucket,
        thumbPath: pointers.thumbPath,
        url: null as string | null,
        thumbUrl: null as string | null,
      }
    })

    const reviewResult = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existingByKey = await tx.review.findFirst({
          where: {
            bookingId: eligibility.booking.id,
            clientId,
            idempotencyKey,
          },
          select: { id: true },
        })

        if (existingByKey) {
          const review = await tx.review.findUnique({
            where: { id: existingByKey.id },
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

          return {
            created: false,
            review,
          }
        }
      }

      const existing = await tx.review.findFirst({
        where: {
          bookingId: eligibility.booking.id,
          clientId,
        },
        select: { id: true },
      })

      if (existing) {
        throw new Error('REVIEW_ALREADY_EXISTS')
      }

      const attachables = attachedMediaIds.length
        ? await tx.mediaAsset.findMany({
            where: {
              id: { in: attachedMediaIds },
              bookingId: eligibility.booking.id,
              professionalId: eligibility.booking.professionalId,
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
          professionalId: eligibility.booking.professionalId,
          bookingId: eligibility.booking.id,
          rating,
          headline: headline || null,
          body: reviewBody || null,
          idempotencyKey,
          requestId,
        },
        select: { id: true },
      })

      if (attachables.length > 0) {
        await tx.mediaAsset.updateMany({
          where: {
            id: { in: attachables.map((item) => item.id) },
          },
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
          data: resolvedClientMedia.map((item) => ({
            professionalId: eligibility.booking.professionalId,
            bookingId: eligibility.booking.id,
            reviewId: review.id,
            mediaType: item.mediaType,
            visibility: REVIEW_MEDIA_VISIBILITY,
            uploadedByUserId: user.id,
            uploadedByRole: Role.CLIENT,
            isFeaturedInPortfolio: false,
            isEligibleForLooks: false,
            reviewLocked: true,
            storageBucket: item.storageBucket,
            storagePath: item.storagePath,
            thumbBucket: item.thumbBucket,
            thumbPath: item.thumbPath,
            url: item.url,
            thumbUrl: item.thumbUrl,
            caption: item.caption,
          })),
        })
      }

      await createBookingCloseoutAuditLog({
        tx,
        bookingId: eligibility.booking.id,
        professionalId: eligibility.booking.professionalId,
        actorUserId: user.id,
        action: BookingCloseoutAuditAction.REVIEW_CREATED,
        route: 'app/api/client/bookings/[id]/review/route.ts:POST',
        requestId,
        idempotencyKey,
        oldValue: null,
        newValue: {
          reviewId: review.id,
          rating,
          headline: headline || null,
          body: reviewBody || null,
          attachedAppointmentMediaIds: attachedMediaIds,
          clientUploadedMediaCount: resolvedClientMedia.length,
        },
      })

      const fullReview = await tx.review.findUnique({
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

      return {
        created: true,
        review: fullReview,
      }
    })

    if (!reviewResult.review) {
      return jsonFail(500, 'Internal server error.')
    }

    if (reviewResult.created) {
      try {
        await createReviewReceivedProNotification({
          professionalId: eligibility.booking.professionalId,
          bookingId: eligibility.booking.id,
          reviewId: reviewResult.review.id,
          actorUserId: user.id,
          rating,
          headline: headline || null,
          attachedAppointmentMediaCount: attachedMediaIds.length,
          clientUploadedMediaCount: resolvedClientMedia.length,
        })
      } catch (notificationError: unknown) {
        console.error(
          'POST /api/client/bookings/[id]/review pro notification error',
          notificationError,
        )
      }
    }

    return jsonOk(
      { review: reviewResult.review },
      reviewResult.created ? 201 : 200,
    )
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
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

    if (message === 'REVIEW_ALREADY_EXISTS') {
      return jsonFail(409, 'Review already exists for this booking.')
    }

    console.error('POST /api/client/bookings/[id]/review error', error)
    return jsonFail(500, 'Internal server error.')
  }
}