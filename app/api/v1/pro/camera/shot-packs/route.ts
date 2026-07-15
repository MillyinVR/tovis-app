// GET /api/v1/pro/camera/shot-packs — trending shot packs for the native
// AI-photographer camera: server-driven pose/shot recipes (guide steps +
// per-step expectations + pose rules). Pack CONTENT is curated in
// lib/pro/cameraShotPacks.ts; the ORDER is engagement-driven (C10) — packs are
// re-ranked by how hot their service family is in the Looks feed right now
// (LookCategoryTrendStat, refreshed daily). The app matches packs to the
// booking's service client-side; the ranking is global, so the payload is
// identical for every pro.
//
// CACHING: the payload changes only when the content version bumps OR the live
// ordering shifts, so the ETag folds BOTH (see buildShotPacksEtag) and the
// client revalidates against it. `no-store` would forbid the very caching the
// contract promises, so we send a short-lived private cache directive instead
// and answer a matching `If-None-Match` with 304.
import { NextResponse } from 'next/server'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { buildShotPacksEtag, loadCameraShotPacks } from '@/lib/pro/cameraShotPacks'
import { prisma } from '@/lib/prisma'

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

    const payload = await loadCameraShotPacks(prisma)
    const etag = buildShotPacksEtag(payload)
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
