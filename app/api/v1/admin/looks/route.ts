// GET /api/v1/admin/looks — cross-tenant Looks moderation queue (social-first
// AM1). SUPER_ADMIN only. Lists looks by moderation status / report volume,
// newest first; client-authored looks are included by design. Per-look actions
// live at .../looks/[id]/{moderate,dismiss-reports,feature}.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  isAdminLookModerationStatusFilter,
  listAdminLookModeration,
} from '@/lib/privacy/adminLookModeration'

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

    const params = new URL(req.url).searchParams
    const rawStatus = params.get('status')
    const status = isAdminLookModerationStatusFilter(rawStatus)
      ? rawStatus
      : 'REPORTED'
    const q = params.get('q') ?? ''

    const items = await listAdminLookModeration({ status, q })
    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/admin/looks error', error)
    return jsonFail(500, 'Internal server error')
  }
}
