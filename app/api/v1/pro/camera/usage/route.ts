// GET /api/v1/pro/camera/usage — the authed pro's own current-month AI-camera
// image usage (used / plan quota / granted bonus / remaining / whether metering
// is active). The pro-facing readout behind the "X of Y images left" panel;
// mirrors the SUPER_ADMIN readout (admin/memberships/[id]/camera GET), but scoped
// to the caller. Fails safe: Redis missing/erroring reports 0 used so the number
// is never scary, and the plan quota still comes through.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { getProCameraUsage } from '@/lib/pro/cameraQuota'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const usage = await getProCameraUsage({ professionalId: auth.professionalId })
    return jsonOk({ usage })
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/camera/usage error', { error: safeError(e) })
    return jsonFail(500, 'Failed to load camera usage.')
  }
}
