// GET /api/v1/admin/look-tags — list user-facing tags for the admin Tags queue
// (social-first D1). SUPER_ADMIN only. Most-used first; `?q=` matches slug or
// display, `?banned=ACTIVE|BANNED|ALL` narrows by ban state. Per-tag actions
// live at .../look-tags/[slug].
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  isAdminLookTagBannedFilter,
  listAdminLookTags,
} from '@/lib/looks/adminTags'

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
    const rawBanned = params.get('banned')
    const banned = isAdminLookTagBannedFilter(rawBanned) ? rawBanned : 'ALL'
    const q = params.get('q') ?? ''

    const items = await listAdminLookTags({ q, banned })
    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/admin/look-tags error', error)
    return jsonFail(500, 'Internal server error')
  }
}
