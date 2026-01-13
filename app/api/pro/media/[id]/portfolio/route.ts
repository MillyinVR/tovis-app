// app/api/pro/media/[id]/portfolio/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }
type MediaVisibility = 'PUBLIC' | 'PRIVATE'

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function computeVisibility(nextFeatured: boolean, isEligibleForLooks: boolean): MediaVisibility {
  return nextFeatured || isEligibleForLooks ? 'PUBLIC' : 'PRIVATE'
}

function publicUrlFor(bucket: string, path: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/${bucket}/${path}`
}

async function guardProOwner(id: string) {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    return { ok: false as const, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const proId = user.professionalProfile.id

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      professionalId: true,
      isFeaturedInPortfolio: true,
      isEligibleForLooks: true,
      visibility: true,

      // NEW fields
      storageBucket: true,
      storagePath: true,
    },
  })

  if (!media) return { ok: false as const, res: NextResponse.json({ error: 'Media not found' }, { status: 404 }) }
  if (media.professionalId !== proId) return { ok: false as const, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { ok: true as const, proId, media }
}

async function promoteIfNeeded(media: { storageBucket: string | null; storagePath: string | null }) {
  if (media.storageBucket !== 'media_private') return null
  if (!media.storagePath) return null

  const fromBucket = 'media_private'
  const toBucket = 'media_public'
  const fromPath = media.storagePath

  // Put promoted assets into a clear namespace
  const toPath = fromPath.replace(/^/, 'promoted/') // keeps uniqueness + adds prefix

  const { error } = await supabaseAdmin.storage.from(fromBucket).copy(fromPath, `${toBucket}/${toPath}`)
  if (error) {
    // If copy API varies in your version, we’ll adjust, but this is the intended call shape.
    throw new Error(error.message || 'Failed to promote media')
  }

  const url = publicUrlFor(toBucket, toPath)
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')

  return { bucket: toBucket, path: toPath, url }
}

export async function POST(_req: NextRequest, props: Props) {
  try {
    const { id: rawId } = await props.params
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const guard = await guardProOwner(id)
    if (!guard.ok) return guard.res

    // If featuring: ensure it’s public-renderable
    let promoted: { bucket: string; path: string; url: string } | null = null
    if (guard.media.storageBucket === 'media_private') {
      promoted = await promoteIfNeeded(guard.media)
    }

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        isFeaturedInPortfolio: true,
        visibility: computeVisibility(true, guard.media.isEligibleForLooks),

        ...(promoted
          ? {
              storageBucket: promoted.bucket,
              storagePath: promoted.path,
              url: promoted.url,
            }
          : {}),
      },
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

    return NextResponse.json({ ok: true, media: updated }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: (e as any)?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: Props) {
  try {
    const { id: rawId } = await props.params
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const guard = await guardProOwner(id)
    if (!guard.ok) return guard.res

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        isFeaturedInPortfolio: false,
        visibility: computeVisibility(false, guard.media.isEligibleForLooks),
      },
      select: { id: true, isFeaturedInPortfolio: true, isEligibleForLooks: true, visibility: true },
    })

    return NextResponse.json({ ok: true, media: updated }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/pro/media/[id]/portfolio error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
