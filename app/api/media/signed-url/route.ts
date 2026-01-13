// app/api/media/signed-url/route.ts

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path')?.trim()
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media'
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 60)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Failed to sign url' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, url: data.signedUrl })
}
