// GET  /api/v1/admin/memberships/[professionalId]/camera — this month's AI-camera
//      usage (used / plan quota / granted bonus / remaining).
// POST /api/v1/admin/memberships/[professionalId]/camera — grant N bonus images
//      for the current month (v1 of the paid top-up ledger).
//
// SUPER_ADMIN only (allowance-adjacent). Every grant lands in the admin audit log.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import {
  getProCameraUsage,
  grantCameraBonusImages,
} from '@/lib/pro/cameraQuota'

import {
  requireMembershipAdmin,
  type MembershipAdminRouteContext,
} from '../../_adminAuth'

export const dynamic = 'force-dynamic'

const MAX_BONUS_PER_GRANT = 500

function parseBonusCount(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number.parseInt(value.trim(), 10)
        : NaN
  if (!Number.isInteger(n) || n <= 0 || n > MAX_BONUS_PER_GRANT) return null
  return n
}

export async function GET(_req: Request, ctx: MembershipAdminRouteContext) {
  try {
    const auth = await requireMembershipAdmin(ctx)
    if (!auth.ok) return auth.res

    const usage = await getProCameraUsage({ professionalId: auth.professionalId })
    return jsonOk({ usage })
  } catch (error) {
    console.error('GET /api/v1/admin/memberships/[id]/camera error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: MembershipAdminRouteContext) {
  try {
    const auth = await requireMembershipAdmin(ctx)
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)
    const count = parseBonusCount(body.count)
    if (count === null) {
      return jsonFail(400, `count must be a whole number between 1 and ${MAX_BONUS_PER_GRANT}.`)
    }

    const newBonusTotal = await grantCameraBonusImages({
      professionalId: auth.professionalId,
      count,
    })
    if (newBonusTotal === null) {
      return jsonFail(503, 'Could not grant bonus images right now — try again.')
    }

    await writeAdminAuditLog({
      adminUserId: auth.adminUserId,
      action: 'camera_bonus_grant',
      professionalId: auth.professionalId,
      newValue: { granted: count, bonusTotal: newBonusTotal },
    })

    const usage = await getProCameraUsage({ professionalId: auth.professionalId })
    return jsonOk({ usage })
  } catch (error) {
    console.error('POST /api/v1/admin/memberships/[id]/camera error', error)
    return jsonFail(500, 'Internal server error')
  }
}
