// POST /api/v1/admin/look-tags/[slug] — SUPER_ADMIN tag control (social-first D1).
// One action-dispatched route: ban / unban a tag, rename its display label, or
// merge its looks into another tag. Every state change is audited. Ban
// enforcement itself is at the data layer (LookTag.bannedAt); this is the lever.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { isRecord } from '@/lib/guards'
import {
  mergeLookTags,
  renameLookTag,
  setLookTagBanned,
  type AdminLookTagActionResult,
} from '@/lib/looks/adminTags'

export const dynamic = 'force-dynamic'

type TagRouteContext = RouteContext<{ slug: string }>

function statusForCode(code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT'): number {
  if (code === 'NOT_FOUND') return 404
  if (code === 'CONFLICT') return 409
  return 400
}

function failFromResult(
  result: Extract<AdminLookTagActionResult, { ok: false }>,
): Response {
  return jsonFail(statusForCode(result.code), result.message)
}

export async function POST(req: Request, ctx: TagRouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const { slug: rawSlug } = await resolveRouteParams(ctx)
    const slug = typeof rawSlug === 'string' ? rawSlug.trim() : ''
    if (!slug) return jsonFail(400, 'Missing tag slug.')

    const body: unknown = await req.json().catch(() => null)
    const action = isRecord(body) ? body.action : null
    const adminUserId = auth.user.id
    const now = new Date()

    if (action === 'ban' || action === 'unban') {
      const banned = action === 'ban'
      const result = await setLookTagBanned({ slug, banned, now })
      if (!result.ok) return failFromResult(result)

      await writeAdminAuditLog({
        adminUserId,
        action: banned ? 'LOOK_TAG_BANNED' : 'LOOK_TAG_UNBANNED',
        targetType: 'other',
        targetId: result.tag.slug,
        newValue: { bannedAt: result.tag.bannedAt },
      })
      return jsonOk({ ok: true, tag: result.tag })
    }

    if (action === 'rename') {
      const display = isRecord(body) && typeof body.display === 'string' ? body.display : ''
      const result = await renameLookTag({ slug, display })
      if (!result.ok) return failFromResult(result)

      await writeAdminAuditLog({
        adminUserId,
        action: 'LOOK_TAG_RENAMED',
        targetType: 'other',
        targetId: result.tag.slug,
        newValue: { display: result.tag.display },
      })
      return jsonOk({ ok: true, tag: result.tag })
    }

    if (action === 'merge') {
      const targetSlug =
        isRecord(body) && typeof body.targetSlug === 'string' ? body.targetSlug : ''
      const result = await mergeLookTags({ fromSlug: slug, toSlug: targetSlug })
      if (!result.ok) return failFromResult(result)

      await writeAdminAuditLog({
        adminUserId,
        action: 'LOOK_TAG_MERGED',
        targetType: 'other',
        targetId: result.tag.slug,
        metadata: {
          fromSlug: slug,
          toSlug: result.tag.slug,
          movedLookCount: result.movedLookCount,
        },
      })
      return jsonOk({
        ok: true,
        tag: result.tag,
        movedLookCount: result.movedLookCount,
      })
    }

    return jsonFail(400, 'Unknown tag action.')
  } catch (error) {
    console.error('POST /api/v1/admin/look-tags/[slug] error', error)
    return jsonFail(500, 'Internal server error')
  }
}
