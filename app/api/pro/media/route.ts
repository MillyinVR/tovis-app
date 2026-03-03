// app/api/pro/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { MediaType, MediaVisibility } from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'

export const dynamic = 'force-dynamic'

type StorageBucket = (typeof BUCKETS)[keyof typeof BUCKETS]
type JsonRecord = Record<string, unknown>

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function readJsonObject(req: Request): Promise<JsonRecord> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function getStr(body: JsonRecord, key: string) {
  return pickString(body[key])
}

function getStrFrom(body: JsonRecord, keys: string[]) {
  for (const k of keys) {
    const v = getStr(body, k)
    if (v) return v
  }
  return null
}

function isStorageBucket(v: unknown): v is StorageBucket {
  return v === BUCKETS.mediaPublic || v === BUCKETS.mediaPrivate
}

function isPublicBucket(b: StorageBucket) {
  return b === BUCKETS.mediaPublic
}

/**
 * Visibility rule:
 * - If it's eligible for looks OR featured, it is PUBLIC.
 * - Otherwise PRO_CLIENT.
 */
function computeVisibility(isEligibleForLooks: boolean, isFeaturedInPortfolio: boolean): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

function parseMediaType(v: unknown): MediaType {
  const s = upper(v)
  return s === 'VIDEO' ? MediaType.VIDEO : MediaType.IMAGE
}

function parseBoolLoose(v: unknown, fallback = false) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : fallback
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
      .map((x) => pickString(x))
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
  }

  // Optional convenience: allow "id1,id2,id3"
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  return []
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = await readJsonObject(req)

    // Accept multiple possible keys without unsafe casts
    const bucketRaw = getStrFrom(body, ['bucket', 'storageBucket'])
    const path = getStrFrom(body, ['path', 'storagePath'])
    const publicUrl = getStrFrom(body, ['publicUrl', 'url'])

    const thumbBucketRaw = getStr(body, 'thumbBucket')
    const thumbPath = getStr(body, 'thumbPath')
    const thumbPublicUrl = getStr(body, 'thumbPublicUrl')

    if (!bucketRaw || !path) return jsonFail(400, 'Missing upload bucket/path.')
    if (!isStorageBucket(bucketRaw)) return jsonFail(400, 'Invalid upload bucket.')

    const bucket: StorageBucket = bucketRaw

    const caption = getStr(body, 'caption')
    const mediaType = parseMediaType(body.mediaType)

    const isEligibleForLooks = parseBoolLoose(body.isEligibleForLooks, false)
    const isFeaturedInPortfolio = parseBoolLoose(body.isFeaturedInPortfolio, false)

    const visibility = computeVisibility(isEligibleForLooks, isFeaturedInPortfolio)

    // Safety rail: prevent accidental leaks
    if (visibility === MediaVisibility.PUBLIC && !isPublicBucket(bucket)) {
      return jsonFail(400, 'Looks/portfolio media must be uploaded to the public bucket.')
    }
    if (visibility === MediaVisibility.PRO_CLIENT && isPublicBucket(bucket)) {
      return jsonFail(400, 'Private (pro-client) media must be uploaded to the private bucket.')
    }

    if (isPublicBucket(bucket) && !publicUrl) {
      return jsonFail(400, 'Missing publicUrl for public upload.')
    }

    // Only store render-safe URL in DB. Private objects are signed at read time.
    const url = isPublicBucket(bucket) ? publicUrl : null

    // Thumb handling
    let thumbBucket: StorageBucket | null = null
    if (thumbBucketRaw) {
      if (!isStorageBucket(thumbBucketRaw)) return jsonFail(400, 'Invalid thumb bucket.')
      thumbBucket = thumbBucketRaw
    }

    if (thumbBucket && !thumbPath) return jsonFail(400, 'thumbPath is required when thumbBucket is provided.')

    if (thumbBucket && isPublicBucket(thumbBucket) && !thumbPublicUrl) {
      return jsonFail(400, 'thumbPublicUrl is required for public thumbnails.')
    }

    const thumbUrl =
      thumbBucket && thumbPath && isPublicBucket(thumbBucket) ? thumbPublicUrl : null

    const serviceIdsRaw = pickStringArray(body.serviceIds)
    const serviceIds = Array.from(new Set(serviceIdsRaw))

    if (serviceIds.length === 0) return jsonFail(400, 'Select at least one service tag.')

    // Validate service IDs exist and are active
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