// app/api/v1/pro/practice/[id]/attach/route.ts
//
// "Attach later" — promote a practice shot into real media.
//
// A practice shot has no booking and no service anchor, which is exactly why it
// isn't a MediaAsset. This route is the moment those become known:
//
//   target BOOKING → the shot joins one of the pro's bookings as PRO_CLIENT
//                    session media (phase OTHER), through the booking write
//                    boundary, so every booking rule still applies.
//   target LOOK    → the shot becomes a PUBLIC MediaAsset + a LookPost, through
//                    the same publication service POST /pro/media uses.
//
// ⚠️ The bytes are COPIED, never shared. The practice shot keeps its own object,
// so deleting it later can't pull the file out from under the media it produced
// — and the copy lands in the destination's own namespace (bookings/<id>/… or
// media-public), so a promoted asset is indistinguishable from one uploaded
// there directly.
//
// The copy happens BEFORE the row write and is not transactional: a failed write
// leaves an orphaned object in storage. That is the same trade POST /pro/media
// already makes (bytes land before the create), and the reason the request is
// validated up front rather than discovering a refusal after the copy.

import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'
import { NextRequest } from 'next/server'

import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import {
  bookingErrorJsonFail,
} from '@/app/api/_utils/bookingResponses'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { isBookingError } from '@/lib/booking/errors'
import { uploadProBookingMedia } from '@/lib/booking/writeBoundary'
import type {
  ProBookingMediaItemDTO,
  ProMediaCreatedDTO,
} from '@/lib/dto/mediaAttach'
import type {
  ProPracticeAttachResponseDTO,
  ProPracticeAttachTarget,
} from '@/lib/dto/proPractice'
import { createOrUpdateProLookFromMediaAsset } from '@/lib/looks/publication/service'
import {
  copyStorageObject,
  StorageCopyError,
} from '@/lib/media/copyToPublicBucket'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { prisma } from '@/lib/prisma'
import {
  isProPracticeDisabled,
  loadOwnedPracticeShot,
  PRACTICE_CAPTION_MAX,
  PRACTICE_DISABLED_MESSAGE,
  PRACTICE_SHOT_SELECT,
  toPracticeShotDTO,
  type PracticeShotRow,
} from '@/lib/proPractice'
import { safeError } from '@/lib/security/logging'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveProTenantId } from '@/lib/tenant/bookingAttribution'

export const dynamic = 'force-dynamic'

function parseTarget(value: unknown): ProPracticeAttachTarget | null {
  const s = upper(value)
  if (s === 'BOOKING') return 'BOOKING'
  if (s === 'LOOK') return 'LOOK'
  return null
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((entry) => pickString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  )
}

/** bookings/<bookingId>/other/YYYY/MM/DD/<ts>_<rand>.<ext> — mirrors the
 *  booking-scoped path the signing route mints for a direct session upload. */
function buildBookingPath(bookingId: string, ext: string): string {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const rand = Math.random().toString(16).slice(2)
  return [
    'bookings',
    bookingId,
    MediaPhase.OTHER.toLowerCase(),
    yyyy,
    mm,
    dd,
    `${now.getTime()}_${rand}.${ext}`,
  ].join('/')
}

/** pro/<proId>/practice_look_public/YYYY-MM/<ts>_<rand>.<ext> */
function buildProLookPath(professionalId: string, ext: string): string {
  const ym = new Date().toISOString().slice(0, 7)
  const rand = Math.random().toString(16).slice(2)
  return `pro/${professionalId}/practice_look_public/${ym}/${Date.now()}_${rand}.${ext}`
}

/** Best-effort cleanup of a copy whose row write then failed. */
async function removeOrphanedCopy(bucket: string, path: string): Promise<void> {
  try {
    await getSupabaseAdmin().storage.from(bucket).remove([path])
  } catch (error) {
    console.error('POST /api/v1/pro/practice/[id]/attach orphan cleanup failed', {
      error: safeError(error),
    })
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    if (await isProPracticeDisabled()) {
      return jsonFail(503, PRACTICE_DISABLED_MESSAGE, {
        code: 'PRO_PRACTICE_DISABLED',
      })
    }

    const professionalId = auth.professionalId

    const { id: rawId } = await resolveRouteParams(ctx)
    const shotId = pickString(rawId)
    if (!shotId) return jsonFail(400, 'Missing practice shot id.')

    const owned = await loadOwnedPracticeShot(shotId, professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)
    const shot = owned.shot

    if (shot.attachedMediaId) {
      return jsonFail(409, 'This practice shot has already been attached.', {
        code: 'PRACTICE_ALREADY_ATTACHED',
      })
    }

    const body = await readJsonRecord(req)

    const target = parseTarget(body.target)
    if (!target) return jsonFail(400, 'target must be BOOKING or LOOK.')

    const caption = pickString(body.caption) ?? shot.caption
    if (caption && caption.length > PRACTICE_CAPTION_MAX) {
      return jsonFail(400, `Caption must be ${PRACTICE_CAPTION_MAX} characters or fewer.`)
    }

    return target === 'BOOKING'
      ? await attachToBooking({
          shot,
          professionalId,
          uploadedByUserId: auth.userId,
          bookingId: pickString(body.bookingId),
          caption,
        })
      : await attachToLook({
          shot,
          professionalId,
          serviceIds: pickStringArray(body.serviceIds),
          requestedPrimaryServiceId: pickString(body.primaryServiceId),
          caption,
          // Defaults to FALSE. An omitted field must never post to the world —
          // the caller says `publish: true` when the pro taps Publish; anything
          // else lands the look as a draft the pro can still publish later.
          publish: body.publish === true,
        })
  } catch (e) {
    if (e instanceof StorageCopyError) {
      console.error('POST /api/v1/pro/practice/[id]/attach copy failed', {
        error: safeError(e),
      })
      return jsonFail(502, 'Couldn’t copy that photo. Please try again.')
    }
    console.error('POST /api/v1/pro/practice/[id]/attach error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}

// ── target BOOKING ───────────────────────────────────────────────────────────

async function attachToBooking(args: {
  shot: PracticeShotRow
  professionalId: string
  uploadedByUserId: string
  bookingId: string | null
  caption: string | null
}) {
  const { shot, professionalId, bookingId, caption } = args

  if (!bookingId) return jsonFail(400, 'Missing bookingId.')

  // Ownership is re-checked inside the write boundary (which answers
  // BOOKING_NOT_FOUND for another pro's booking); this pre-check exists so the
  // bytes aren't copied for a booking that was never going to accept them.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, professionalId: true },
  })

  if (!booking || booking.professionalId !== professionalId) {
    return jsonFail(404, 'Booking not found.')
  }

  const copied = await copyStorageObject({
    sourceBucket: shot.storageBucket,
    sourcePath: shot.storagePath,
    destBucket: BUCKETS.mediaPrivate,
    buildDestPath: (ext) => buildBookingPath(bookingId, ext),
  })

  let result
  try {
    // phase OTHER on purpose. A practice shot is not part of the before/after
    // record of this booking — it never satisfies a session gate, and OTHER is
    // the one phase the boundary's step check accepts at any session step. The
    // boundary's OTHER rules (accepted, not cancelled, not completed) still
    // apply and are surfaced verbatim.
    result = await uploadProBookingMedia({
      bookingId,
      professionalId,
      uploadedByUserId: args.uploadedByUserId,
      storageBucket: copied.storageBucket,
      storagePath: copied.storagePath,
      thumbBucket: null,
      thumbPath: null,
      caption,
      phase: MediaPhase.OTHER,
      mediaType: shot.mediaType,
      focalX: shot.focalX,
      focalY: shot.focalY,
    })
  } catch (error) {
    await removeOrphanedCopy(copied.storageBucket, copied.storagePath)
    if (isBookingError(error)) return bookingErrorJsonFail(error)
    throw error
  }

  const created = result.created
  const updated = await markAttached(shot.id, created.id)

  const rendered = await renderMediaUrls({
    storageBucket: created.storageBucket,
    storagePath: created.storagePath,
    thumbBucket: created.thumbBucket,
    thumbPath: created.thumbPath,
    url: created.url,
    thumbUrl: created.thumbUrl,
  })

  const bookingMedia: ProBookingMediaItemDTO = {
    id: created.id,
    mediaType: created.mediaType,
    visibility: created.visibility,
    phase: created.phase,
    caption: created.caption,
    createdAt: created.createdAt.toISOString(),
    reviewId: created.reviewId,
    isEligibleForLooks: created.isEligibleForLooks,
    isFeaturedInPortfolio: created.isFeaturedInPortfolio,
    url: created.url,
    thumbUrl: created.thumbUrl,
    renderUrl: rendered.renderUrl,
    renderThumbUrl: rendered.renderThumbUrl,
  }

  return jsonOk(
    {
      target: 'BOOKING',
      shot: await toPracticeShotDTO(updated),
      bookingMedia,
    } satisfies ProPracticeAttachResponseDTO,
    201,
  )
}

// ── target LOOK ──────────────────────────────────────────────────────────────

async function attachToLook(args: {
  shot: PracticeShotRow
  professionalId: string
  serviceIds: string[]
  requestedPrimaryServiceId: string | null
  caption: string | null
  publish: boolean
}) {
  const { shot, professionalId, serviceIds, requestedPrimaryServiceId, caption } = args

  // A look always routes to "book this", so it needs a real service — the same
  // rule POST /pro/media enforces for a portfolio upload.
  if (serviceIds.length === 0) {
    return jsonFail(400, 'Select at least one service tag.')
  }

  if (requestedPrimaryServiceId && !serviceIds.includes(requestedPrimaryServiceId)) {
    return jsonFail(400, 'primaryServiceId must be included in serviceIds.')
  }

  const services = await prisma.service.findMany({
    where: { id: { in: serviceIds }, isActive: true },
    select: { id: true },
  })

  if (services.length !== serviceIds.length) {
    return jsonFail(400, 'One or more serviceIds are invalid.')
  }

  const primaryServiceId = requestedPrimaryServiceId ?? serviceIds[0]
  if (!primaryServiceId) return jsonFail(400, 'Select at least one service tag.')

  // A video can't back a look tile the way the publication service expects.
  if (shot.mediaType !== MediaType.IMAGE) {
    return jsonFail(400, 'Only a photo can be published as a look.')
  }

  const copied = await copyStorageObject({
    sourceBucket: shot.storageBucket,
    sourcePath: shot.storagePath,
    destBucket: BUCKETS.mediaPublic,
    buildDestPath: (ext) => buildProLookPath(professionalId, ext),
  })

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const url = base
    ? `${base}/storage/v1/object/public/${copied.storageBucket}/${copied.storagePath}`
    : null

  let outcome
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const proTenantId = await resolveProTenantId(tx, professionalId)

      const created = await tx.mediaAsset.create({
        data: {
          ...buildMediaAssetCreateData({
            professionalId,
            proTenantId,
            primaryServiceId,
            url,
            thumbUrl: null,
            caption,
            mediaType: MediaType.IMAGE,
            visibility: MediaVisibility.PUBLIC,
            focalX: shot.focalX,
            focalY: shot.focalY,
            // §19b — a published look is portfolio-featured too (one public atom).
            isEligibleForLooks: true,
            isFeaturedInPortfolio: args.publish,
            storageBucket: copied.storageBucket,
            storagePath: copied.storagePath,
            thumbBucket: null,
            thumbPath: null,
          }),
          services: {
            createMany: {
              data: serviceIds.map((serviceId) => ({ serviceId })),
              skipDuplicates: true,
            },
          },
        },
        include: { services: { include: { service: true } } },
      })

      const lookPublication = await createOrUpdateProLookFromMediaAsset(tx, {
        professionalId,
        request: {
          mediaAssetId: created.id,
          primaryServiceId,
          caption: caption || null,
          publish: args.publish,
        },
      })

      const shotRow = await tx.practiceShot.update({
        where: { id: shot.id },
        data: { attachedMediaId: created.id, attachedAt: new Date() },
        select: PRACTICE_SHOT_SELECT,
      })

      const finalFlags = await tx.mediaAsset.findUnique({
        where: { id: created.id },
        select: {
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
        },
      })

      return { created, lookPublication, shotRow, finalFlags }
    })
  } catch (error) {
    await removeOrphanedCopy(copied.storageBucket, copied.storagePath)
    throw error
  }

  const media: ProMediaCreatedDTO = {
    id: outcome.created.id,
    professionalId: outcome.created.professionalId,
    primaryServiceId: outcome.created.primaryServiceId,
    mediaType: outcome.created.mediaType,
    visibility: outcome.finalFlags?.visibility ?? outcome.created.visibility,
    caption: outcome.created.caption,
    isFeaturedInPortfolio:
      outcome.finalFlags?.isFeaturedInPortfolio ?? outcome.created.isFeaturedInPortfolio,
    isEligibleForLooks:
      outcome.finalFlags?.isEligibleForLooks ?? outcome.created.isEligibleForLooks,
    url: outcome.created.url,
    thumbUrl: outcome.created.thumbUrl,
    createdAt: outcome.created.createdAt.toISOString(),
    services: outcome.created.services.map((tag) => ({
      serviceId: tag.serviceId,
      name: tag.service.name,
    })),
  }

  return jsonOk(
    {
      target: 'LOOK',
      shot: await toPracticeShotDTO(outcome.shotRow),
      media,
      lookPublication: outcome.lookPublication,
    } satisfies ProPracticeAttachResponseDTO,
    201,
  )
}

/**
 * Mark the shot used.
 *
 * ⚠️ For the BOOKING target this cannot join the write boundary's transaction —
 * `uploadProBookingMedia` owns its own and takes no callback — so there is a
 * narrow window where the media exists and the shot is still unmarked. The cost
 * of losing that race is a pro being able to attach the same shot twice (two
 * MediaAssets over two copies of the bytes), which is untidy, not damaging, and
 * visible to them. The LOOK target has no such window: it marks inside its own
 * transaction.
 */
async function markAttached(shotId: string, mediaAssetId: string) {
  return prisma.practiceShot.update({
    where: { id: shotId },
    data: { attachedMediaId: mediaAssetId, attachedAt: new Date() },
    select: PRACTICE_SHOT_SELECT,
  })
}
