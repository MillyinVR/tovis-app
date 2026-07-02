// GET /api/v1/pro/camera/shot-packs — trending shot packs for the native
// AI-photographer camera: server-driven pose/shot recipes (guide steps +
// per-step expectations + pose rules). Content is curated in
// lib/pro/cameraShotPacks.ts and refreshes every camera without an app
// release; the app matches packs to the booking's service client-side.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadCameraShotPacks } from '@/lib/pro/cameraShotPacks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    return jsonOk(loadCameraShotPacks())
  } catch (error) {
    console.error('GET /api/v1/pro/camera/shot-packs error', error)
    return jsonFail(500, 'Internal server error')
  }
}
