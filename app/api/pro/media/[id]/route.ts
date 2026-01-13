// app/api/pro/media/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function isValidBucket(b: string) {
  return b === 'media-public' || b === 'media-private'
}

export async function DELETE(_req: NextRequest, props: Props) {
  try {
    const { id: rawId } = await props.params
    const id = pickString(rawId)
    if (!id) return NextResponse.json({ error: 'Missing media id' }, { status: 400 })

    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const media = await prisma.mediaAsset.findUnique({
      where: { id },
      select: {
        id: true,
        professionalId: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
      },
    })

    if (!media) return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    if (media.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete files from storage (best effort)
    const mainBucket = typeof media.storageBucket === 'string' ? media.storageBucket.trim() : ''
    const mainPath = typeof media.storagePath === 'string' ? media.storagePath.trim() : ''

    if (mainBucket && mainPath && isValidBucket(mainBucket)) {
      await supabaseAdmin.storage.from(mainBucket).remove([mainPath]).catch(() => null)
    }

    const tBucket = typeof media.thumbBucket === 'string' ? media.thumbBucket.trim() : ''
    const tPath = typeof media.thumbPath === 'string' ? media.thumbPath.trim() : ''

    if (tBucket && tPath && isValidBucket(tBucket)) {
      await supabaseAdmin.storage.from(tBucket).remove([tPath]).catch(() => null)
    }

    // Delete DB record last
    await prisma.mediaAsset.delete({ where: { id } })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/pro/media/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
