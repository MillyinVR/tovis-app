import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const mediaId = pickString(searchParams.get('id'))

  if (!mediaId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      url: true,
      visibility: true,
      storageBucket: true,
      storagePath: true,
      professionalId: true,
      bookingId: true,
      reviewId: true,
      uploadedByUserId: true,
    },
  })

  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If it's a public URL, just return it.
  if (media.url.startsWith('http')) {
    return NextResponse.json({ ok: true, url: media.url })
  }

  // Private media needs auth to even get a signed URL.
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Minimal access rule for now:
  // - Owner pro can view their own private media
  // Later you’ll expand this for: clients viewing consult/DM media etc.
  const isOwnerPro = user.role === 'PRO' && user.professionalProfile?.id === media.professionalId
  if (!isOwnerPro) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const bucket = pickString(media.storageBucket)
  const path = pickString(media.storagePath)
  if (!bucket || !path) return NextResponse.json({ error: 'Missing storage info' }, { status: 500 })

  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60) // 60s

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'Failed to sign URL' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: data.signedUrl })
}
