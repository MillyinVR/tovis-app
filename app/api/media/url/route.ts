// app/api/media/url/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mediaId = pickString(searchParams.get('id'))
    if (!mediaId) return jsonFail(400, 'Missing id.')

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        url: true,
        visibility: true,
        storageBucket: true,
        storagePath: true,
        professionalId: true,
      },
    })

    if (!media) return jsonFail(404, 'Not found.')

    // Already public URL stored
    if (typeof media.url === 'string' && media.url.startsWith('http')) {
      return jsonOk({ url: media.url })
    }

    // Private or storage-path based media requires auth
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const isOwnerPro = user.role === 'PRO' && user.professionalProfile?.id === media.professionalId

    // For now: only owner pro can view non-PUBLIC
    if (media.visibility !== 'PUBLIC' && !isOwnerPro) return jsonFail(403, 'Forbidden.')

    const bucket = pickString(media.storageBucket)
    const path = pickString(media.storagePath)
    if (!bucket || !path) return jsonFail(500, 'Missing storage info.')

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60) // 60s

    if (error || !data?.signedUrl) return jsonFail(500, error?.message || 'Failed to sign URL.')

    return jsonOk({ url: data.signedUrl })
  } catch (e) {
    console.error('GET /api/media/url error', e)
    return jsonFail(500, 'Internal server error')
  }
}
