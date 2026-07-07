// PUT    /api/v1/admin/boards/[id]/hide — hide a public board (404s its public page)
// DELETE /api/v1/admin/boards/[id]/hide — unhide it
//
// SUPER_ADMIN only. Repeat actions are no-ops; every state change is audited.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { setBoardHidden } from '@/lib/boards/adminBoards'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type BoardRouteContext = RouteContext<{ id: string }>

async function handle(
  ctx: BoardRouteContext,
  hidden: boolean,
): Promise<Response> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return auth.res

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
  })
  if (!permission.ok) return permission.res

  const { id: rawId } = await resolveRouteParams(ctx)
  const boardId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!boardId) return jsonFail(400, 'Missing board id.')

  const result = await setBoardHidden(prisma, {
    boardId,
    hidden,
    adminUserId: auth.user.id,
    now: new Date(),
  })

  if (!result.found) return jsonFail(404, 'Board not found.')

  if (result.changed) {
    await writeAdminAuditLog({
      adminUserId: auth.user.id,
      action: hidden ? 'BOARD_HIDDEN' : 'BOARD_UNHIDDEN',
      targetType: 'board',
      targetId: boardId,
      newValue: { hiddenAt: result.hiddenAt },
    })
  }

  return jsonOk({ ok: true, hidden: result.hidden })
}

export async function PUT(_req: Request, ctx: BoardRouteContext) {
  try {
    return await handle(ctx, true)
  } catch (error) {
    console.error('PUT /api/v1/admin/boards/[id]/hide error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: Request, ctx: BoardRouteContext) {
  try {
    return await handle(ctx, false)
  } catch (error) {
    console.error('DELETE /api/v1/admin/boards/[id]/hide error', error)
    return jsonFail(500, 'Internal server error')
  }
}
