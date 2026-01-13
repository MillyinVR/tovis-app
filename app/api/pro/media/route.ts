// app/api/pro/media/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRIVATE'

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

function pickString(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function computeVisibility(isEligibleForLooks: boolean, isFeaturedInPortfolio: boolean): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio ? 'PUBLIC' : 'PRIVATE'
}

function isValidBucket(b: string) {
  return b === 'media-public' || b === 'media-private'
}

function isPublicBucket(b: string) {
  return b === 'media-public'
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'PRO' || !user.professionalProfile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CreateMediaBody

    const bucket = pickString(body.bucket)
    const path = pickString(body.path)
    const publicUrl = pickString(body.publicUrl)

    const thumbBucket = pickString(body.thumbBucket)
    const thumbPath = pickString(body.thumbPath)
    const thumbPublicUrl = pickString(body.thumbPublicUrl)

    if (!bucket || !path || !isValidBucket(bucket)) {
      return NextResponse.json({ error: 'Missing/invalid upload bucket/path' }, { status: 400 })
    }

    // If public bucket, we require a publicUrl so the UI can render instantly.
    if (isPublicBucket(bucket) && !publicUrl) {
      return NextResponse.json({ error: 'Missing publicUrl for public upload' }, { status: 400 })
    }

    const url = isPublicBucket(bucket) ? publicUrl : `supabase://${bucket}/${path}`

    const thumbUrl =
      thumbBucket && thumbPath
        ? isPublicBucket(thumbBucket) && thumbPublicUrl
          ? thumbPublicUrl
          : `supabase://${thumbBucket}/${thumbPath}`
        : null

    const captionRaw = typeof body.caption === 'string' ? body.caption.trim() : ''
    const caption = captionRaw ? captionRaw : null

    const mediaType: MediaType = body.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE'

    const isEligibleForLooks = Boolean(body.isEligibleForLooks)
    const isFeaturedInPortfolio = Boolean(body.isFeaturedInPortfolio)
    const visibility: MediaVisibility = computeVisibility(isEligibleForLooks, isFeaturedInPortfolio)

    const serviceIds: string[] = Array.isArray(body.serviceIds)
      ? (body.serviceIds as unknown[])
          .filter((x: unknown): x is string => typeof x === 'string' && x.trim() !== '')
          .map((s) => s.trim())
      : []

    if (serviceIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one service tag.' }, { status: 400 })
    }

    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    })

    if (services.length !== serviceIds.length) {
      return NextResponse.json({ error: 'One or more serviceIds are invalid.' }, { status: 400 })
    }

    const proId = user.professionalProfile.id

    const created = await prisma.mediaAsset.create({
      data: {
        professionalId: proId,

        url,
        thumbUrl,

        caption,
        mediaType,
        visibility,
        isFeaturedInPortfolio,
        isEligibleForLooks,

        // ✅ canonical storage
        storageBucket: bucket,
        storagePath: path,
        thumbBucket: thumbBucket && isValidBucket(thumbBucket) ? thumbBucket : null,
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

    return NextResponse.json({ ok: true, media: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
