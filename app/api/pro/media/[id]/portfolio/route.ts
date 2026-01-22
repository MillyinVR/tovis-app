// app/api/pro/media/[id]/portfolio/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

type MediaVisibility = 'PUBLIC' | 'PRIVATE'
type StorageBucket = 'media-public' | 'media-private'

function computeVisibility(isFeaturedInPortfolio: boolean, isEligibleForLooks: boolean): MediaVisibility {
  return isFeaturedInPortfolio || isEligibleForLooks ? 'PUBLIC' : 'PRIVATE'
}

function publicUrlFor(bucket: StorageBucket, path: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  // for Supabase public bucket access
  return `${base}/storage/v1/object/public/${bucket}/${path}`
}

function isStorageBucket(v: unknown): v is StorageBucket {
  return v === 'media-public' || v === 'media-private'
}

async function loadOwnedMedia(mediaId: string, professionalId: string) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      professionalId: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      visibility: true,
      storageBucket: true,
      storagePath: true,
      url: true,
    },
  })

  if (!media) return { ok: false as const, status: 404, error: 'Media not found.' }
  if (media.professionalId !== professionalId) return { ok: false as const, status: 403, error: 'Forbidden.' }
  return { ok: true as const, media }
}

async function promoteIfNeeded(media: { storageBucket: string | null; storagePath: string | null }) {
  if (!isStorageBucket(media.storageBucket)) return null
  if (media.storageBucket !== 'media-private') return null
  if (!media.storagePath) return null

  const fromBucket: StorageBucket = 'media-private'
  const toBucket: StorageBucket = 'media-public'

  const fromPath = media.storagePath
  const toPath = `promoted/${fromPath}`

  // Copy private -> public
  const copyRes = await supabaseAdmin.storage.from(fromBucket).copy(fromPath, `${toBucket}/${toPath}`)
  const copyErr: any = (copyRes as any)?.error
  if (copyErr) throw new Error(copyErr.message || 'Failed to promote media')

  const url = publicUrlFor(toBucket, toPath)
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')

  // Optional cleanup: don’t hard-fail if remove fails
  await supabaseAdmin.storage.from(fromBucket).remove([fromPath]).catch(() => null)

  return { bucket: toBucket, path: toPath, url }
}

export async function POST(_req: NextRequest, props: Props) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await props.params
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const owned = await loadOwnedMedia(mediaId, professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)

    const promoted = await promoteIfNeeded({
      storageBucket: owned.media.storageBucket,
      storagePath: owned.media.storagePath,
    })

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: true,
        visibility: computeVisibility(true, owned.media.isEligibleForLooks),
        ...(promoted
          ? {
              storageBucket: promoted.bucket,
              storagePath: promoted.path,
              url: promoted.url,
            }
          : {}),
      } as any,
      select: {
        id: true,
        isFeaturedInPortfolio: true,
        isEligibleForLooks: true,
        visibility: true,
        url: true,
        storageBucket: true,
        storagePath: true,
      },
    })

    return jsonOk({ media: updated }, 200)
  } catch (e) {
    console.error('POST /api/pro/media/[id]/portfolio error', e)
    return jsonFail(500, (e as any)?.message || 'Internal server error')
  }
}

export async function DELETE(_req: NextRequest, props: Props) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await props.params
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const owned = await loadOwnedMedia(mediaId, professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)

    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: {
        isFeaturedInPortfolio: false,
        visibility: computeVisibility(false, owned.media.isEligibleForLooks),
      } as any,
      select: { id: true, isFeaturedInPortfolio: true, isEligibleForLooks: true, visibility: true },
    })

    return jsonOk({ media: updated }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/media/[id]/portfolio error', e)
    return jsonFail(500, 'Internal server error')
  }
}
