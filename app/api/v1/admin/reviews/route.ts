// GET /api/v1/admin/reviews — recent reviews across ALL tenants for the
// moderation dashboard, optionally filtered by pro name/handle via ?q=.
//
// SUPER_ADMIN only. All PII (reviewer names) crosses inside
// lib/privacy/adminReviewModeration; this route never touches raw name fields.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { listAdminReviewModeration } from '@/lib/privacy/adminReviewModeration'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const q = new URL(req.url).searchParams.get('q') ?? ''
    const items = await listAdminReviewModeration(q)

    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/admin/reviews error', error)
    return jsonFail(500, 'Internal server error')
  }
}
