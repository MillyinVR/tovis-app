// PUT    /api/v1/admin/looks/[id]/feature — feature a look into the Spotlight feed
// DELETE /api/v1/admin/looks/[id]/feature — unfeature it
//
// SUPER_ADMIN only. Featuring is an honest editorial signal (featuredAt) that
// makes the look Spotlight-eligible without faking engagement; see
// buildLookPostSpotlightEligibilityWhere. Repeat actions are no-ops; every
// state change is audited.
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { setLookPostFeatured } from '@/lib/looks/featuring'
import { prisma } from '@/lib/prisma'
import {
  requireLookAdmin,
  type LookAdminRouteContext,
} from '../_utils/requireLookAdmin'

export const dynamic = 'force-dynamic'

async function handle(
  ctx: LookAdminRouteContext,
  featured: boolean,
): Promise<Response> {
  const auth = await requireLookAdmin(ctx)
  if (!auth.ok) return auth.res

  const result = await setLookPostFeatured(prisma, {
    lookPostId: auth.lookPostId,
    adminUserId: auth.adminUserId,
    featured,
  })

  if (!result.found) return jsonFail(404, 'Look post not found.')

  if (result.changed) {
    await writeAdminAuditLog({
      adminUserId: auth.adminUserId,
      action: featured ? 'LOOK_POST_FEATURED' : 'LOOK_POST_UNFEATURED',
      professionalId: result.professionalId,
      serviceId: result.serviceId,
      categoryId: result.categoryId,
      targetType: 'lookPost',
      targetId: auth.lookPostId,
      newValue: { featuredAt: result.featuredAt?.toISOString() ?? null },
    })
  }

  return jsonOk({ ok: true, featured: result.featured })
}

export async function PUT(_req: Request, ctx: LookAdminRouteContext) {
  try {
    return await handle(ctx, true)
  } catch (error) {
    console.error('PUT /api/v1/admin/looks/[id]/feature error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function DELETE(_req: Request, ctx: LookAdminRouteContext) {
  try {
    return await handle(ctx, false)
  } catch (error) {
    console.error('DELETE /api/v1/admin/looks/[id]/feature error', error)
    return jsonFail(500, 'Internal server error')
  }
}
