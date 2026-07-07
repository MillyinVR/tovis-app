// GET /api/v1/admin/boards — list public (SHARED) boards for the admin
// moderation queue (social-first D3). SUPER_ADMIN only. `?q=` matches board
// name, slug, or owner handle; `?visibility=ALL|VISIBLE|HIDDEN` narrows by
// hide state. Hide/unhide lives at .../boards/[id]/hide.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  isAdminBoardVisibilityFilter,
  listAdminBoards,
} from '@/lib/boards/adminBoards'

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
    const rawVisibility = params.get('visibility')
    const visibility = isAdminBoardVisibilityFilter(rawVisibility)
      ? rawVisibility
      : 'ALL'
    const q = params.get('q') ?? ''

    const items = await listAdminBoards({ q, visibility })
    return jsonOk({ ok: true, items })
  } catch (error) {
    console.error('GET /api/v1/admin/boards error', error)
    return jsonFail(500, 'Internal server error')
  }
}
