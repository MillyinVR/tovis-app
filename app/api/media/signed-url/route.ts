// app/api/media/signed-url/route.ts
import { prisma } from '@/lib/prisma'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const path = pickString(searchParams.get('path'))
    if (!path) return jsonFail(400, 'Missing path.')

    // ✅ Only authenticated users can get signed URLs (even for PUBLIC, by design)
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const media = await prisma.mediaAsset.findFirst({
      where: { storagePath: path },
      select: { storageBucket: true, storagePath: true, visibility: true, professionalId: true },
    })

    if (!media) return jsonFail(404, 'Media not found.')

    const isOwnerPro = user.role === 'PRO' && user.professionalProfile?.id === media.professionalId

    // ✅ Prisma enum (no strings)
    if (media.visibility !== MediaVisibility.PUBLIC && !isOwnerPro) return jsonFail(403, 'Forbidden.')

    // ✅ Trust the DB bucket. If it's missing, that's a data problem.
    const bucket = pickString(media.storageBucket)
    if (!bucket) return jsonFail(500, 'Missing storage bucket.')

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(media.storagePath, 60 * 10) // 10m
    if (error || !data?.signedUrl) return jsonFail(500, 'Failed to sign url.', { details: error?.message })

    return jsonOk({ url: data.signedUrl })
  } catch (e) {
    console.error('GET /api/media/signed-url error', e)
    return jsonFail(500, 'Internal server error')
  }
}