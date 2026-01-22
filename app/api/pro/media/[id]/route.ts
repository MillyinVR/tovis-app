// app/api/pro/media/[id]/route.ts
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }
type StorageBucket = 'media-public' | 'media-private'

function isStorageBucket(v: unknown): v is StorageBucket {
  return v === 'media-public' || v === 'media-private'
}

export async function DELETE(_req: NextRequest, props: Props) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id: rawId } = await props.params
    const mediaId = pickString(rawId)
    if (!mediaId) return jsonFail(400, 'Missing media id.')

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        professionalId: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
      },
    })

    if (!media) return jsonFail(404, 'Media not found.')
    if (media.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')

    const mainBucket = isStorageBucket(media.storageBucket) ? media.storageBucket : null
    const mainPath = pickString(media.storagePath)

    if (mainBucket && mainPath) {
      await supabaseAdmin.storage.from(mainBucket).remove([mainPath]).catch(() => null)
    }

    const tBucket = isStorageBucket(media.thumbBucket) ? media.thumbBucket : null
    const tPath = pickString(media.thumbPath)

    if (tBucket && tPath) {
      await supabaseAdmin.storage.from(tBucket).remove([tPath]).catch(() => null)
    }

    await prisma.mediaAsset.delete({ where: { id: mediaId } })

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/media/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}
