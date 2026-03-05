// app/api/client/reviews/[id]/media/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { MediaType, MediaVisibility, Role } from '@prisma/client'

import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { pickString } from '@/lib/pick'

import { BUCKETS } from '@/lib/storageBuckets'
import { safeUrl, resolveStoragePointers } from '@/lib/media'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const MAX_CLIENT_IMAGES = 6
const MAX_CLIENT_VIDEOS = 1
const MAX_TOTAL = MAX_CLIENT_IMAGES + MAX_CLIENT_VIDEOS

const PATH_MAX = 2048
const BUCKET_MAX = 128
const SIGNED_TTL_SECONDS = 60 * 10

type AddReviewMediaBody = { media?: unknown }

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

function isPublicBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPublic
}

function isPrivateBucket(bucket: string): boolean {
  return bucket === BUCKETS.mediaPrivate
}

function safeBucket(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > BUCKET_MAX) return null
  if (s === BUCKETS.mediaPrivate) return BUCKETS.mediaPrivate
  if (s === BUCKETS.mediaPublic) return BUCKETS.mediaPublic
  return null
}

function safeStoragePath(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > PATH_MAX) return null
  if (s.startsWith('/')) return null
  if (s.includes('..')) return null
  return s
}

function parseMedia(bodyMedia: unknown): IncomingMediaItem[] {
  if (!Array.isArray(bodyMedia)) return []
  const out: IncomingMediaItem[] = []

  for (const raw of bodyMedia) {
    if (!isRecord(raw)) continue

    const url = safeUrl(raw.url)
    if (!url) continue

    const thumbUrlRaw = raw.thumbUrl
    const thumbUrl = thumbUrlRaw == null || thumbUrlRaw === '' ? null : safeUrl(thumbUrlRaw)
    if (thumbUrlRaw && !thumbUrl) continue

    const mediaType = isMediaType(raw.mediaType) ? raw.mediaType : MediaType.IMAGE

    // NOTE: we accept these fields but we will re-derive + validate below
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

function enforceCaps(items: IncomingMediaItem[]) {
  if (items.length > MAX_TOTAL) {
    return `You can upload up to ${MAX_CLIENT_IMAGES} images + ${MAX_CLIENT_VIDEOS} video (${MAX_TOTAL} total).`
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

async function signObjectUrl(bucket: string, path: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_TTL_SECONDS)
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
  // private -> signed url
  if (isPrivateBucket(bucket)) {
    const signed = await signObjectUrl(bucket, path)
    if (!signed) return false
    const head = await fetch(signed, { method: 'HEAD' }).catch(() => null)
    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false
    const get = await fetch(signed, { method: 'GET' }).catch(() => null)
    return Boolean(get?.ok)
  }

  // public -> public url
  if (isPublicBucket(bucket)) {
    const admin = getSupabaseAdmin()
    const { data } = admin.storage.from(bucket).getPublicUrl(path)
    const u = safeUrl(data?.publicUrl)
    if (!u) return false
    const head = await fetch(u, { method: 'HEAD' }).catch(() => null)
    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false
    const get = await fetch(u, { method: 'GET' }).catch(() => null)
    return Boolean(get?.ok)
  }

  return false
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res
    const { user, clientId } = auth

    const { id } = await context.params
    const reviewId = pickString(id)
    if (!reviewId) return jsonFail(400, 'Missing review id.')

    const body = (await req.json().catch(() => ({}))) as AddReviewMediaBody
    const incoming = parseMedia(body.media)
    if (!incoming.length) return jsonFail(400, 'No valid media provided.')

    const capError = enforceCaps(incoming)
    if (capError) return jsonFail(400, capError)

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, clientId: true, professionalId: true, bookingId: true },
    })

    if (!review) return jsonFail(404, 'Review not found.')
    if (review.clientId !== clientId) return jsonFail(403, 'Forbidden.')
    if (!review.bookingId) {
      return jsonFail(
        409,
        'This review is not linked to a booking. Media must be attached to a booking to appear in aftercare.',
      )
    }

    // include existing uploads in cap
    const existingCount = await prisma.mediaAsset.count({
      where: { reviewId: review.id, uploadedByRole: Role.CLIENT },
    })
    if (existingCount + incoming.length > MAX_TOTAL) {
      return jsonFail(400, `This review already has ${existingCount} upload(s). Max is ${MAX_TOTAL}.`)
    }

    // Resolve + validate pointers (Option A)
    const resolved = incoming.map((m) => {
      const ptrs = resolveStoragePointers({
        url: m.url,
        thumbUrl: m.thumbUrl ?? null,
        storageBucket: m.storageBucket ?? null,
        storagePath: m.storagePath ?? null,
        thumbBucket: m.thumbBucket ?? null,
        thumbPath: m.thumbPath ?? null,
      })
      if (!ptrs) throw new Error('Media must include storageBucket/storagePath (or a parsable Supabase URL).')

      const storageBucket = safeBucket(ptrs.storageBucket)
      const storagePath = safeStoragePath(ptrs.storagePath)
      const thumbBucket = ptrs.thumbBucket ? safeBucket(ptrs.thumbBucket) : null
      const thumbPath = ptrs.thumbPath ? safeStoragePath(ptrs.thumbPath) : null

      if (!storageBucket || !storagePath) {
        throw new Error('Invalid storageBucket/storagePath.')
      }
      if ((thumbBucket && !thumbPath) || (!thumbBucket && thumbPath)) {
        throw new Error('thumbBucket and thumbPath must be provided together.')
      }

      return {
        mediaType: m.mediaType,
        storageBucket,
        storagePath,
        thumbBucket,
        thumbPath,
      }
    })

    // Verify objects exist before DB write (prevents broken media rows)
    for (const m of resolved) {
      const ok = await objectExists(m.storageBucket, m.storagePath)
      if (!ok) return jsonFail(400, 'Uploaded file not found in storage.')
      if (m.thumbBucket && m.thumbPath) {
        const okThumb = await objectExists(m.thumbBucket, m.thumbPath)
        if (!okThumb) return jsonFail(400, 'Uploaded thumb not found in storage.')
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const rows = await Promise.all(
        resolved.map((m) =>
          tx.mediaAsset.create({
            data: {
              professionalId: review.professionalId,
              bookingId: review.bookingId!,
              reviewId: review.id,

              // ✅ Option A: canonical pointers
              storageBucket: m.storageBucket,
              storagePath: m.storagePath,
              thumbBucket: m.thumbBucket,
              thumbPath: m.thumbPath,

              // ✅ Legacy convenience: only store url fields for PUBLIC bucket (optional)
              url: null,
              thumbUrl: null,

              mediaType: m.mediaType,

              // Review media is PUBLIC
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
        where: { id: reviewId },
        include: { mediaAssets: true },
      })

      return { rows, updated }
    })

    // Response: return render-safe URLs (signed/public), without mutating DB
    const createdForUI = await Promise.all(
      created.rows.map(async (m) => {
        const { renderUrl, renderThumbUrl } = await renderMediaUrls({
          storageBucket: m.storageBucket,
          storagePath: m.storagePath,
          thumbBucket: m.thumbBucket,
          thumbPath: m.thumbPath,
          url: m.url,
          thumbUrl: m.thumbUrl,
        })

        return {
          ...m,
          renderUrl,
          renderThumbUrl,
          // optional: keep url/thumbUrl render-safe for UI convenience
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
  } catch (e: unknown) {
    console.error('POST /api/client/reviews/[id]/media error', e)
    const msg = errMessage(e)
    const safe =
      msg.includes('Media') || msg.includes('storage') || msg.includes('thumb')
        ? msg
        : 'Internal server error'
    return jsonFail(500, safe)
  }
}