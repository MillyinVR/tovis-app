// app/api/pro/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { MediaType, MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type StorageBucket = 'media-public' | 'media-private'

type CreateMediaBody = {
  bucket?: unknown
  path?: unknown
  publicUrl?: unknown

  thumbBucket?: unknown
  thumbPath?: unknown
  thumbPublicUrl?: unknown

  caption?: unknown
  mediaType?: unknown
  isFeaturedInPortfolio?: unknown
  isEligibleForLooks?: unknown
  serviceIds?: unknown
}

function isStorageBucket(v: unknown): v is StorageBucket {
  return v === 'media-public' || v === 'media-private'
}

function isPublicBucket(b: StorageBucket) {
  return b === 'media-public'
}

/**
 * Prisma truth:
 * - PUBLIC
 * - PRO_CLIENT (this is your "private" equivalent)
 */
function computeVisibility(isEligibleForLooks: boolean, isFeaturedInPortfolio: boolean): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

function parseMediaType(v: unknown): MediaType {
  const s = upper(v)
  return s === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => pickString(x)) // likely string | null
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim())
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as CreateMediaBody

    const bucketRaw = pickString(body.bucket)
    const path = pickString(body.path)
    const publicUrl = pickString(body.publicUrl)

    const thumbBucketRaw = pickString(body.thumbBucket)
    const thumbPath = pickString(body.thumbPath)
    const thumbPublicUrl = pickString(body.thumbPublicUrl)

    if (!bucketRaw || !path) return jsonFail(400, 'Missing upload bucket/path.')
    if (!isStorageBucket(bucketRaw)) return jsonFail(400, 'Invalid upload bucket.')

    const bucket: StorageBucket = bucketRaw

    if (isPublicBucket(bucket) && !publicUrl) {
      return jsonFail(400, 'Missing publicUrl for public upload.')
    }

    // url column stores:
    // - public http url for public bucket
    // - supabase://bucket/path placeholder for private (resolved via signed url API)
    const url = isPublicBucket(bucket) ? publicUrl! : `supabase://${bucket}/${path}`

    const thumbBucket: StorageBucket | null =
      thumbBucketRaw && isStorageBucket(thumbBucketRaw) ? thumbBucketRaw : null

    const thumbUrl =
      thumbBucket && thumbPath
        ? isPublicBucket(thumbBucket) && thumbPublicUrl
          ? thumbPublicUrl
          : `supabase://${thumbBucket}/${thumbPath}`
        : null

    const caption = pickString(body.caption)
    const mediaType = parseMediaType(body.mediaType)

    const isEligibleForLooks = Boolean(body.isEligibleForLooks)
    const isFeaturedInPortfolio = Boolean(body.isFeaturedInPortfolio)

    // Derived visibility (Prisma enum)
    const visibility = computeVisibility(isEligibleForLooks, isFeaturedInPortfolio)

    const serviceIds = pickStringArray(body.serviceIds)
    if (serviceIds.length === 0) return jsonFail(400, 'Select at least one service tag.')

    // Validate service IDs belong to active services
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, isActive: true },
      select: { id: true },
    })
    if (services.length !== serviceIds.length) {
      return jsonFail(400, 'One or more serviceIds are invalid.')
    }

    const created = await prisma.mediaAsset.create({
      data: {
        professionalId,

        url,
        thumbUrl,

        caption: caption || null,
        mediaType,
        visibility,

        isFeaturedInPortfolio,
        isEligibleForLooks,

        storageBucket: bucket,
        storagePath: path,
        thumbBucket,
        thumbPath: thumbBucket && thumbPath ? thumbPath : null,

        services: {
          createMany: {
            data: serviceIds.map((serviceId) => ({ serviceId })),
            skipDuplicates: true,
          },
        },
      },
      include: {
        services: { include: { service: true } },
      },
    })

    return jsonOk({ media: created }, 201)
  } catch (e) {
    console.error('POST /api/pro/media error', e)
    return jsonFail(500, 'Internal server error')
  }
}