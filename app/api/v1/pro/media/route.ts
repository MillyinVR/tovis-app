// app/api/v1/pro/media/route.ts
import { prisma } from '@/lib/prisma'
import { resolveProTenantId } from '@/lib/tenant/bookingAttribution'
import {
  jsonFail,
  jsonOk,
  pickString,
  requirePro,
  upper,
} from '@/app/api/_utils'
import {
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  UploadSurface,
} from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'
import { resolveFocalPoint } from '@/lib/media/focalPoint'
import { buildMediaAssetCreateData } from '@/lib/media/recordMediaAsset'
import {
  consumeUploadSession,
  UploadSessionError,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import { createOrUpdateProLookFromMediaAsset } from '@/lib/looks/publication/service'
import type {
  ProMediaCreatedDTO,
  ProMediaCreateResponseDTO,
  ProManagedMediaItemDTO,
  ProManagedMediaListResponseDTO,
  ProMediaServiceTagDTO,
} from '@/lib/dto/mediaAttach'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { renderMediaUrlsBatch } from '@/lib/media/renderUrls'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

type StorageBucket = (typeof BUCKETS)[keyof typeof BUCKETS]
type JsonRecord = Record<string, unknown>

function getStr(body: JsonRecord, key: string): string | null {
  return pickString(body[key])
}

function getStrFrom(body: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = getStr(body, key)
    if (value) return value
  }

  return null
}

function isStorageBucket(v: unknown): v is StorageBucket {
  return v === BUCKETS.mediaPublic || v === BUCKETS.mediaPrivate
}

function isPublicBucket(bucket: StorageBucket): boolean {
  return bucket === BUCKETS.mediaPublic
}

/**
 * Visibility rule:
 * - If it's eligible for looks OR featured, it is PUBLIC.
 * - Otherwise PRO_CLIENT.
 */
function computeVisibility(
  isEligibleForLooks: boolean,
  isFeaturedInPortfolio: boolean,
): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}

function parseMediaType(v: unknown): MediaType {
  const s = upper(v)
  return s === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE
}

function parseBoolLoose(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v

  if (typeof v === 'number') {
    if (v === 1) return true
    if (v === 0) return false
    return fallback
  }

  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  }

  return fallback
}

function pickStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((entry) => pickString(entry))
      .filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.trim().length > 0,
      )
      .map((entry) => entry.trim())
  }

  if (typeof v === 'string' && v.trim()) {
    return v
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return []
}

function parseOptionalLookVisibility(
  value: unknown,
): LookPostVisibility | undefined {
  if (value === undefined) return undefined

  if (value === LookPostVisibility.PUBLIC) {
    return LookPostVisibility.PUBLIC
  }

  if (value === LookPostVisibility.FOLLOWERS_ONLY) {
    return LookPostVisibility.FOLLOWERS_ONLY
  }

  if (value === LookPostVisibility.UNLISTED) {
    return LookPostVisibility.UNLISTED
  }

  return undefined
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId
    const body = await readJsonRecord(req)

    const uploadSessionId = getStr(body, 'uploadSessionId')

    if (!uploadSessionId) {
      return jsonFail(400, 'Missing uploadSessionId.')
    }

    const caption = getStr(body, 'caption')
    const mediaType = parseMediaType(body.mediaType)

    const isEligibleForLooks = parseBoolLoose(
      body.isEligibleForLooks,
      false,
    )
    const isFeaturedInPortfolio = parseBoolLoose(
      body.isFeaturedInPortfolio,
      false,
    )

    const visibility = computeVisibility(
      isEligibleForLooks,
      isFeaturedInPortfolio,
    )

    // The storage pointer is read back from the UploadSession the signing route
    // minted — never from the client. A LOOKS or PORTFOLIO session is accepted
    // (the pro flips between the two at attach time).
    let session
    try {
      session = await validateUploadSession(prisma, {
        uploadSessionId,
        surface: [UploadSurface.PRO_LOOKS, UploadSurface.PRO_PORTFOLIO],
        professionalId,
        now: new Date(),
      })
    } catch (sessionError: unknown) {
      if (sessionError instanceof UploadSessionError) {
        return jsonFail(sessionError.httpStatus, sessionError.message)
      }
      throw sessionError
    }

    if (!isStorageBucket(session.storageBucket)) {
      return jsonFail(400, 'Invalid upload bucket.')
    }

    const bucket: StorageBucket = session.storageBucket
    const path = session.storagePath

    if (visibility === MediaVisibility.PUBLIC && !isPublicBucket(bucket)) {
      return jsonFail(
        400,
        'Looks/portfolio media must be uploaded to the public bucket.',
      )
    }

    if (visibility === MediaVisibility.PRO_CLIENT && isPublicBucket(bucket)) {
      return jsonFail(
        400,
        'Private (pro-client) media must be uploaded to the private bucket.',
      )
    }

    // Public URL is reconstructed from the canonical pointer (matches the
    // signing route); renderMediaUrls also derives it, so this is a legacy
    // convenience only.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    const url =
      isPublicBucket(bucket) && base
        ? `${base}/storage/v1/object/public/${bucket}/${path}`
        : null

    const thumbBucket: StorageBucket | null = null
    const thumbPath: string | null = null
    const thumbUrl: string | null = null

    const serviceIdsRaw = pickStringArray(body.serviceIds)
    const serviceIds = Array.from(new Set(serviceIdsRaw))

    if (serviceIds.length === 0) {
      return jsonFail(400, 'Select at least one service tag.')
    }

    const services = await prisma.service.findMany({
      where: {
        id: { in: serviceIds },
        isActive: true,
      },
      select: {
        id: true,
      },
    })

    if (services.length !== serviceIds.length) {
      return jsonFail(400, 'One or more serviceIds are invalid.')
    }

    const requestedPrimaryServiceId = getStrFrom(body, [
      'primaryServiceId',
      'serviceId',
    ])

    const primaryServiceId =
      requestedPrimaryServiceId ??
      (serviceIds.length === 1 ? serviceIds[0] : null)

    if (
      requestedPrimaryServiceId !== null &&
      !serviceIds.includes(requestedPrimaryServiceId)
    ) {
      return jsonFail(
        400,
        'primaryServiceId must be included in serviceIds.',
      )
    }

    const publishToLooks = parseBoolLoose(
      body.publishToLooks,
      isEligibleForLooks,
    )

    if (publishToLooks && !isEligibleForLooks) {
      return jsonFail(
        400,
        'publishToLooks requires isEligibleForLooks to be true.',
      )
    }

    if (isEligibleForLooks && !primaryServiceId) {
      return jsonFail(
        400,
        'primaryServiceId is required when publishing to Looks with multiple service tags.',
      )
    }

    // Every MediaAsset anchors to one bookable service. Portfolio uploads always
    // carry >=1 service tag (guarded above), so fall back to the first selected
    // when the pro didn't nominate an explicit primary.
    const mediaPrimaryServiceId = primaryServiceId ?? serviceIds[0]
    if (!mediaPrimaryServiceId) {
      return jsonFail(400, 'Select at least one service tag.')
    }

    const lookVisibility = parseOptionalLookVisibility(
      body.lookVisibility ?? body.visibilityOverride,
    )

    if (
      (body.lookVisibility !== undefined ||
        body.visibilityOverride !== undefined) &&
      lookVisibility === undefined
    ) {
      return jsonFail(400, 'Invalid look visibility.')
    }

    const priceStartingAt = getStr(body, 'priceStartingAt')

    // Optional normalized subject focal point: [0,1] from the top-left origin of
    // the EXIF-corrected upright image, so the Looks feed's cover-crop can center
    // on the subject instead of the geometric middle. The native authoring flow
    // supplies it from the camera's face detection (camera C6); web's editor
    // bakes its crop into the pixels instead and sends nothing, so this stays
    // optional. Lenient like the booking-media route: a missing/malformed focal
    // degrades to null (center), never a 400 — it's a crop hint, not load-bearing.
    const focal = resolveFocalPoint(
      typeof body.focalX === 'number' ? body.focalX : null,
      typeof body.focalY === 'number' ? body.focalY : null,
    )

    const result = await prisma.$transaction(async (tx) => {
      const proTenantId = await resolveProTenantId(tx, professionalId)
      const created = await tx.mediaAsset.create({
        data: {
          ...buildMediaAssetCreateData({
            professionalId,
            proTenantId,
            primaryServiceId: mediaPrimaryServiceId,

            url,
            thumbUrl,

            caption,
            mediaType,
            visibility,

            focalX: focal?.x ?? null,
            focalY: focal?.y ?? null,

            isFeaturedInPortfolio,
            // §19b: a featured upload is Looks-eligible too (unified public atom),
            // so the publish below can back a Look from featured-only media.
            isEligibleForLooks: isEligibleForLooks || isFeaturedInPortfolio,

            storageBucket: bucket,
            storagePath: path,

            thumbBucket,
            thumbPath: thumbBucket && thumbPath ? thumbPath : null,
          }),

          services: {
            createMany: {
              data: serviceIds.map((serviceId) => ({ serviceId })),
              skipDuplicates: true,
            },
          },
        },
        include: {
          services: {
            include: {
              service: true,
            },
          },
        },
      })

      // §19b — every PUBLIC upload (Looks-eligible OR featured-to-portfolio)
      // becomes a LookPost, the single public-content atom. It's published when
      // the pro published to Looks or featured it; a Looks-eligible-only upload
      // stays a draft. The publication service then mirrors the look's published
      // state back onto the asset's portfolio flags.
      const lookPublication =
        visibility === MediaVisibility.PUBLIC
          ? await createOrUpdateProLookFromMediaAsset(tx, {
              professionalId,
              request: {
                mediaAssetId: created.id,
                primaryServiceId: mediaPrimaryServiceId,
                caption: caption || null,
                priceStartingAt: priceStartingAt || null,
                ...(lookVisibility !== undefined
                  ? { visibility: lookVisibility }
                  : {}),
                publish: publishToLooks || isFeaturedInPortfolio,
              },
            })
          : null

      // Consume the session inside the same transaction; a CONSUME_CONFLICT
      // (double-attach) rolls the whole create back.
      await consumeUploadSession(tx, {
        uploadSessionId,
        mediaAssetId: created.id,
        now: new Date(),
      })

      // The publication mirror may have moved the asset's portfolio flags after
      // create; read the reconciled values so the response echoes DB truth.
      const finalFlags = await tx.mediaAsset.findUnique({
        where: { id: created.id },
        select: {
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
          visibility: true,
        },
      })

      return {
        media: created,
        finalFlags,
        lookPublication,
      }
    })

    const media = {
      id: result.media.id,
      professionalId: result.media.professionalId,
      primaryServiceId: result.media.primaryServiceId,
      mediaType: result.media.mediaType,
      visibility: result.finalFlags?.visibility ?? result.media.visibility,
      caption: result.media.caption,
      isFeaturedInPortfolio:
        result.finalFlags?.isFeaturedInPortfolio ??
        result.media.isFeaturedInPortfolio,
      isEligibleForLooks:
        result.finalFlags?.isEligibleForLooks ?? result.media.isEligibleForLooks,
      url: result.media.url,
      thumbUrl: result.media.thumbUrl,
      createdAt: result.media.createdAt.toISOString(),
      services: result.media.services.map((tag) => ({
        serviceId: tag.serviceId,
        name: tag.service.name,
      })),
    } satisfies ProMediaCreatedDTO

    return jsonOk(
      {
        media,
        ...(result.lookPublication
          ? { lookPublication: result.lookPublication }
          : {}),
      } satisfies ProMediaCreateResponseDTO,
      201,
    )
  } catch (e: unknown) {
    console.error('POST /api/v1/pro/media error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Internal server error')
  }
}

// GET /api/v1/pro/media — the pro's own media library for the native media
// manager (the RSC-only web `/pro/media` grid + `OwnerMediaMenu` editor have no
// JSON API; this is the native read side). Lists the pro's most-recent media
// across all visibilities with the fields the editor reads/writes, and returns
// the taggable service options (the active Service taxonomy the PATCH validates
// `serviceIds` against) alongside so the editor is a single round-trip. PRO-only,
// owner-scoped by `professionalId`.
export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const [media, serviceRows, profile] = await Promise.all([
      prisma.mediaAsset.findMany({
        where: { professionalId },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: {
          id: true,
          mediaType: true,
          visibility: true,
          caption: true,
          createdAt: true,
          reviewId: true,
          isEligibleForLooks: true,
          isFeaturedInPortfolio: true,
          beforeAssetId: true,
          // single source of truth inputs for renderMediaUrlsBatch
          storageBucket: true,
          storagePath: true,
          thumbBucket: true,
          thumbPath: true,
          // legacy fallbacks (still allowed)
          url: true,
          thumbUrl: true,
          services: {
            select: { serviceId: true, service: { select: { name: true } } },
          },
        },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        take: 500,
        select: { id: true, name: true },
      }),
      // §18d — the pro's current cover banner, to flag the cover tile (§18e).
      prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { coverMediaAssetId: true },
      }),
    ])

    const coverMediaAssetId = profile?.coverMediaAssetId ?? null

    // Sign every private object in one round-trip per bucket (avoids an N+1
    // waterfall across the library).
    const rendered = await renderMediaUrlsBatch(
      media.map((m) => ({
        storageBucket: m.storageBucket,
        storagePath: m.storagePath,
        thumbBucket: m.thumbBucket,
        thumbPath: m.thumbPath,
        url: m.url,
        thumbUrl: m.thumbUrl,
      })),
    )

    const items = media.map(
      (m, i): ProManagedMediaItemDTO => ({
        id: m.id,
        mediaType: m.mediaType,
        visibility: m.visibility,
        caption: m.caption ?? null,
        createdAt: m.createdAt.toISOString(),
        reviewId: m.reviewId ?? null,
        isEligibleForLooks: Boolean(m.isEligibleForLooks),
        isFeaturedInPortfolio: Boolean(m.isFeaturedInPortfolio),
        isCoverMedia: m.id === coverMediaAssetId,
        beforeAssetId: m.beforeAssetId ?? null,
        services: m.services.map((tag) => ({
          serviceId: tag.serviceId,
          name: tag.service.name,
        })),
        url: m.url ?? null,
        thumbUrl: m.thumbUrl ?? null,
        renderUrl: rendered[i]?.renderUrl ?? null,
        renderThumbUrl: rendered[i]?.renderThumbUrl ?? null,
      }),
    )

    const serviceOptions = serviceRows.map(
      (s): ProMediaServiceTagDTO => ({ serviceId: s.id, name: s.name }),
    )

    return jsonOk(
      { items, serviceOptions } satisfies ProManagedMediaListResponseDTO,
      200,
    )
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/media error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Failed to load media.')
  }
}