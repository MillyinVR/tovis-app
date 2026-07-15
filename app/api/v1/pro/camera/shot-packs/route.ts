// GET /api/v1/pro/camera/shot-packs — trending shot packs for the native
// AI-photographer camera: server-driven pose/shot recipes (guide steps +
// per-step expectations + pose rules). Content is curated in
// lib/pro/cameraShotPacks.ts and refreshes every camera without an app
// release; the app matches packs to the booking's service client-side.
//
// CACHING: the payload only changes when `SHOT_PACKS_VERSION` bumps, so we
// expose that version as a weak ETag and let the client revalidate against it
// (both sides document version-based caching — see ProShotPacks.swift). `no-store`
// would forbid the very caching the contract promises, so we send a short-lived
// private cache directive instead and answer a matching `If-None-Match` with 304.
import { NextResponse } from 'next/server'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadCameraShotPacks } from '@/lib/pro/cameraShotPacks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Per-pro-authed but identical for every pro, so the client (not a shared CDN)
// caches it; revalidate quietly for a day while serving the cached copy.
const CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=86400'

function ifNoneMatch(req: Request | undefined, etag: string): boolean {
  const header = req?.headers.get('if-none-match')
  if (!header) return false
  return header.split(',').some((tag) => tag.trim() === etag)
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const payload = loadCameraShotPacks()
    const etag = `W/"shot-packs-${payload.version}"`
    const headers = { ETag: etag, 'Cache-Control': CACHE_CONTROL }

    if (ifNoneMatch(req, etag)) {
      return new NextResponse(null, { status: 304, headers })
    }

    return jsonOk(payload, { headers })
  } catch (error) {
    console.error('GET /api/v1/pro/camera/shot-packs error', error)
    return jsonFail(500, 'Internal server error')
  }
}
