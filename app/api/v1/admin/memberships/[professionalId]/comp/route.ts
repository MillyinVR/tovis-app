// PUT    /api/v1/admin/memberships/[professionalId]/comp — grant/extend free months
// DELETE /api/v1/admin/memberships/[professionalId]/comp — revoke the comp
//
// SUPER_ADMIN only (money-adjacent). Grants stack: months extend from the
// later of now / the current comp expiry, and the latest grant's tier wins.
// Every grant/revoke lands in the admin audit log.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickString } from '@/app/api/_utils/pick'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import {
  COMP_MAX_MONTHS,
  COMP_MIN_MONTHS,
  grantMembershipComp,
  parseCompMonths,
  parseCompPlanKey,
  revokeMembershipComp,
} from '@/lib/membership/comp'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type CompRouteContext = RouteContext<{ professionalId: string }>

type AdminMembershipAuth =
  | { ok: true; adminUserId: string; professionalId: string }
  | { ok: false; res: Response }

async function requireMembershipAdmin(
  ctx: CompRouteContext,
): Promise<AdminMembershipAuth> {
  const auth = await requireUser({ roles: [Role.ADMIN] })
  if (!auth.ok) return { ok: false, res: auth.res }

  const { professionalId: rawId } = await resolveRouteParams(ctx)
  const professionalId = typeof rawId === 'string' ? rawId.trim() : ''
  if (!professionalId) {
    return { ok: false, res: jsonFail(400, 'Missing professional id.') }
  }

  const permission = await requireAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    scope: { professionalId },
  })
  if (!permission.ok) return { ok: false, res: permission.res }

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: { id: true },
  })
  if (!pro) {
    return { ok: false, res: jsonFail(404, 'Professional not found.') }
  }

  return { ok: true, adminUserId: auth.user.id, professionalId }
}

export async function PUT(req: Request, ctx: CompRouteContext) {
  try {
    const auth = await requireMembershipAdmin(ctx)
    if (!auth.ok) return auth.res

    const body = await readJsonRecord(req)

    const planKey = parseCompPlanKey(body.planKey)
    if (!planKey) {
      return jsonFail(400, 'planKey must be pro, premium, or studio.')
    }

    const months = parseCompMonths(body.months)
    if (!months) {
      return jsonFail(
        400,
        `months must be a whole number between ${COMP_MIN_MONTHS} and ${COMP_MAX_MONTHS}.`,
      )
    }

    const note = pickString(body.note)?.slice(0, 500) ?? null

    const result = await grantMembershipComp({
      professionalId: auth.professionalId,
      planKey,
      months,
      note,
      grantedByUserId: auth.adminUserId,
    })

    await writeAdminAuditLog({
      adminUserId: auth.adminUserId,
      action: 'membership_comp_grant',
      professionalId: auth.professionalId,
      note,
      newValue: {
        compPlanKey: result.compPlanKey,
        compUntil: result.compUntil.toISOString(),
        months,
      },
    })

    return jsonOk({
      ok: true,
      comp: {
        planKey: result.compPlanKey,
        until: result.compUntil.toISOString(),
      },
    })
  } catch (error) {
    console.error('PUT /api/v1/admin/memberships/[id]/comp error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: Request, ctx: CompRouteContext) {
  try {
    const auth = await requireMembershipAdmin(ctx)
    if (!auth.ok) return auth.res

    const result = await revokeMembershipComp({
      professionalId: auth.professionalId,
    })

    if (result.hadComp) {
      await writeAdminAuditLog({
        adminUserId: auth.adminUserId,
        action: 'membership_comp_revoke',
        professionalId: auth.professionalId,
      })
    }

    return jsonOk({ ok: true, hadComp: result.hadComp })
  } catch (error) {
    console.error('DELETE /api/v1/admin/memberships/[id]/comp error', error)
    return jsonFail(500, 'Internal server error')
  }
}
