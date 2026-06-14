// app/api/client/bookings/[id]/review/route.ts

import { NextRequest } from 'next/server'
import {
  BookingCloseoutAuditAction,
  MediaType,
  MediaVisibility,
  NotificationEventKey,
  NotificationPriority,
  Prisma,
  Role,
  UploadSurface,
} from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  pickString,
  requireClient,
} from '@/app/api/_utils'
import {
  consumeUploadSession,
  UploadSessionError,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import { createBookingCloseoutAuditLog } from '@/lib/booking/closeoutAudit'
import {
  getBookingFailPayload,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { assertClientBookingReviewEligibility } from '@/lib/booking/writeBoundary'
import { isRecord } from '@/lib/guards'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { parseIdArray, parseRating1to5 } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { resolveProTenantId } from '@/lib/tenant/bookingAttribution'

export const dynamic = 'force-dynamic'

const ROUTE_OPERATION = 'POST /api/client/bookings/[id]/review'

const MAX_ATTACH_APPT_MEDIA = 6
const MAX_CLIENT_IMAGES = 6
const MAX_CLIENT_VIDEOS = 1
const MAX_CLIENT_MEDIA_TOTAL = MAX_CLIENT_IMAGES + MAX_CLIENT_VIDEOS

type IncomingMediaItem = {
  uploadSessionId: string
}

type ResolvedClientMediaItem = {
  uploadSessionId: string
  mediaType: MediaType
  caption: string | null
  storageBucket: string
  storagePath: string
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

type ReviewTransactionResult = {
  created: boolean
  review: {
    id: string
    mediaAssets: Array<{
      id: string
      mediaType: MediaType
      createdAt: Date
      visibility: MediaVisibility
      uploadedByRole: Role | null
      isFeaturedInPortfolio: boolean
      isEligibleForLooks: boolean
      reviewLocked: boolean
      storageBucket: string | null
      storagePath: string | null
      thumbBucket: string | null
      thumbPath: string | null
      url: string | null
      thumbUrl: string | null
    }>
  } | null
}

function mediaTypeFromContentType(contentType: string): MediaType {
  return contentType.toLowerCase().startsWith('video/')
    ? MediaType.VIDEO
    : MediaType.IMAGE
}

function readRequestId(req: Request): string | null {
  return (
    pickString(req.headers.get('x-request-id')) ??
    pickString(req.headers.get('request-id')) ??
    null
  )
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []

  const items: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!isRecord(raw)) continue

    const uploadSessionId = pickString(raw.uploadSessionId)
    if (!uploadSessionId) continue

    items.push({ uploadSessionId })
  }

  return items
}

function enforceClientMediaCaps(
  items: ResolvedClientMediaItem[],
): string | null {
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
    eventKey: NotificationEventKey.REVIEW_RECEIVED,
    priority: NotificationPriority.NORMAL,
    title,
    body,
    href: `/pro/bookings/${args.bookingId}`,
    actorUserId: args.actorUserId,
    bookingId: args.bookingId,
    reviewId: args.reviewId,
    dedupeKey: `PRO_NOTIF:${NotificationEventKey.REVIEW_RECEIVED}:${args.reviewId}`,
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

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (isRecord(value)) {
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeNestedJsonValue(value[key])
    }

    return out
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (!isRecord(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const out: JsonObjectPayload = {}

  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeNestedJsonValue(value[key])
  }

  return out
}

async function renderReviewMediaUrls(
  review: NonNullable<ReviewTransactionResult['review']>,
) {
  const mediaAssets = await Promise.all(
    review.mediaAssets.map(async (row) => {
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(row)
      return {
        ...row,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
      }
    }),
  )

  return { ...review, mediaAssets }
}

function buildReviewResponseBody(
  review: ReviewTransactionResult['review'],
): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    review,
  })
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
): Response {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function buildIdempotencyRequestBody(args: {
  bookingId: string
  clientId: string
  actorUserId: string
  rating: number
  headline: string | null
  reviewBody: string | null
  attachedMediaIds: string[]
  uploadSessionIds: string[]
}): JsonObjectPayload {
  return normalizeJsonObjectPayload({
    bookingId: args.bookingId,
    clientId: args.clientId,
    actorUserId: args.actorUserId,
    rating: args.rating,
    headline: args.headline,
    body: args.reviewBody,
    attachedMediaIds: [...args.attachedMediaIds].sort(),
    uploadSessionIds: [...args.uploadSessionIds].sort(),
  })
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (!isRecord(error)) return ''

  const message = error.message
  return typeof message === 'string' ? message : ''
}

async function failReviewIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  await failStartedRouteIdempotency({
    idempotencyRecordId,
    operation: ROUTE_OPERATION,
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const { user, clientId } = auth
    const actorUserId = pickString(user.id)

    if (!actorUserId) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to create a review.',
      })
    }

    const { id: rawId } = await ctx.params
    const bookingId = pickString(rawId)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

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

    if (clientMediaItems.length > MAX_CLIENT_MEDIA_TOTAL) {
      return jsonFail(
        400,
        `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_CLIENT_MEDIA_TOTAL} total).`,
      )
    }

    const uploadSessionIds = clientMediaItems.map((item) => item.uploadSessionId)

    // Idempotency is keyed on the upload session ids (not storage pointers, which
    // the client never supplies). Begin BEFORE validating/consuming sessions so a
    // retry replays the cached response instead of failing on consumed sessions.
    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.CLIENT,
      },
      route: IDEMPOTENCY_ROUTES.CLIENT_REVIEW_CREATE,
      requestLabel: 'client review',
      requestBody: buildIdempotencyRequestBody({
        bookingId,
        clientId,
        actorUserId,
        rating,
        headline: headline || null,
        reviewBody: reviewBody || null,
        attachedMediaIds,
        uploadSessionIds,
      }),
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching review request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const requestId = readRequestId(req)

    // Validate each client-review upload session (ownership + surface + expiry).
    // The storage pointer is read back from the session, never the client body.
    const resolvedClientMedia: ResolvedClientMediaItem[] = []
    for (const item of clientMediaItems) {
      let session
      try {
        session = await validateUploadSession(prisma, {
          uploadSessionId: item.uploadSessionId,
          surface: UploadSurface.CLIENT_REVIEW,
          clientId,
          now: new Date(),
        })
      } catch (error: unknown) {
        await failReviewIdempotency(idempotencyRecordId)
        idempotencyRecordId = null
        if (error instanceof UploadSessionError) {
          return jsonFail(error.httpStatus, error.message)
        }
        throw error
      }

      resolvedClientMedia.push({
        uploadSessionId: item.uploadSessionId,
        mediaType: mediaTypeFromContentType(session.contentType),
        caption: null,
        storageBucket: session.storageBucket,
        storagePath: session.storagePath,
        thumbBucket: null,
        thumbPath: null,
        url: null,
        thumbUrl: null,
      })
    }

    const capError = enforceClientMediaCaps(resolvedClientMedia)
    if (capError) {
      await failReviewIdempotency(idempotencyRecordId)
      idempotencyRecordId = null
      return jsonFail(400, capError)
    }

    const eligibility = await assertClientBookingReviewEligibility({
      bookingId,
      clientId,
    })

    const reviewResult: ReviewTransactionResult = await prisma.$transaction(
      async (tx) => {
        const existingByKey = await tx.review.findFirst({
          where: {
            bookingId: eligibility.booking.id,
            clientId,
            idempotencyKey: idempotency.idempotencyKey,
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
            idempotencyKey: idempotency.idempotencyKey,
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
          const proTenantId = await resolveProTenantId(
            tx,
            eligibility.booking.professionalId,
          )
          await tx.mediaAsset.createMany({
            data: resolvedClientMedia.map((item) =>
              buildMediaAssetCreateData({
                professionalId: eligibility.booking.professionalId,
                proTenantId,
                bookingId: eligibility.booking.id,
                reviewId: review.id,
                mediaType: item.mediaType,
                visibility: REVIEW_MEDIA_VISIBILITY,
                uploadedByUserId: actorUserId,
                uploadedByRole: Role.CLIENT,
                reviewLocked: true,
                storageBucket: item.storageBucket,
                storagePath: item.storagePath,
                thumbBucket: item.thumbBucket,
                thumbPath: item.thumbPath,
                url: item.url,
                thumbUrl: item.thumbUrl,
                caption: item.caption,
              }),
            ),
          })

          // Consume each session (PENDING -> CONSUMED). A conflict rolls the
          // whole review transaction back; the MediaAsset (bucket,path) unique
          // index is the other half of the double-attach guard.
          for (const item of resolvedClientMedia) {
            await consumeUploadSession(tx, {
              uploadSessionId: item.uploadSessionId,
              now: new Date(),
            })
          }
        }

        await createBookingCloseoutAuditLog({
          tx,
          bookingId: eligibility.booking.id,
          professionalId: eligibility.booking.professionalId,
          actorUserId,
          action: BookingCloseoutAuditAction.REVIEW_CREATED,
          route: 'app/api/client/bookings/[id]/review/route.ts:POST',
          requestId,
          idempotencyKey: idempotency.idempotencyKey,
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
      },
    )

    if (!reviewResult.review) {
      await failReviewIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(500, 'Internal server error.')
    }

    const responseStatus = reviewResult.created ? 201 : 200
    const renderedReview = await renderReviewMediaUrls(reviewResult.review)
    const responseBody = buildReviewResponseBody(renderedReview)

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus,
      responseBody,
    })

    if (reviewResult.created) {
      try {
        await createReviewReceivedProNotification({
          professionalId: eligibility.booking.professionalId,
          bookingId: eligibility.booking.id,
          reviewId: reviewResult.review.id,
          actorUserId,
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

    return jsonOk(responseBody, responseStatus)
  } catch (error: unknown) {
    await failReviewIdempotency(idempotencyRecordId)

    const message = extractErrorMessage(error)

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
    captureBookingException({
      error,
      route: ROUTE_OPERATION,
    })

    return jsonFail(500, 'Internal server error.')
  }
}