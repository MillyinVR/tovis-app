// app/api/v1/admin/viral-service-requests/[id]/service/route.ts
//
// "This look is really a layered haircut" — the admin saying so, on the record.
//
// Tori, 2026-09-15: *"when the admin approves or adds a viral service it should
// be connected on our end to the actual service the pro will be doing."* This is
// that connection. It creates (or attaches) the catalog `Service` the look
// becomes, links the real service(s) underneath it, and points the request at
// both.
//
// Separate from `../moderate` on purpose: that route runs shared moderation and
// the approval fan-out. Deciding what a look IS is a different act from deciding
// whether it may be published, it can be done and redone before approval, and
// folding it into the moderation handler would put catalog writes behind a
// status transition.
//
// Permissions follow `/admin/viral-requests` and the admin services route
// TOGETHER: ADMIN role, SUPER_ADMIN/SUPPORT, and — because this writes a catalog
// row — the category scope check for the service's own category AND for every
// base service's category. An admin scoped to Nails must not file a look under
// Hair, or attach a haircut underneath one.
import { NextRequest } from 'next/server'
import { AdminPermissionRole } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickInt, pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { prisma } from '@/lib/prisma'
import {
  ViralBaseServiceChainError,
  ViralBaseServiceEmptyError,
  ViralBaseServiceSelfLinkError,
  parseViralBaseServiceIds,
} from '@/lib/services/viralBaseServiceLinks'
import {
  ViralCatalogServiceNameTakenError,
  ViralCatalogServiceNotFoundError,
  linkViralLookToCatalogService,
  type ViralCatalogServiceInput,
} from '@/lib/viralRequests/catalogService'

export const dynamic = 'force-dynamic'

/** The catalog default duration when the admin does not name one. */
const FALLBACK_DURATION_MINUTES = 60

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.trunc(value) === value &&
    value > 0
  )
}

function trimmedOrNull(value: unknown): string | null {
  const text = (pickString(value) ?? '').trim()
  return text ? text : null
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res

    const adminUserId = auth.user.id

    const isSupport = await hasAdminPermission({
      adminUserId,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.SUPPORT,
      ],
    })
    if (!isSupport) return jsonFail(403, 'Forbidden')

    const { id } = await resolveRouteParams(ctx)
    const requestId = (pickString(id) ?? '').trim()
    if (!requestId) return jsonFail(400, 'Missing viral request id.')

    const form = await req.formData()

    // Absent means "leave the links alone", which is meaningless here: this
    // route's whole job is to state them. Refuse rather than write a service
    // with nothing underneath it.
    const baseServiceIds = parseViralBaseServiceIds(form)
    if (baseServiceIds === null) {
      return jsonFail(400, 'Missing baseServiceIds.')
    }

    const attachServiceId = trimmedOrNull(form.get('serviceId'))
    const name = trimmedOrNull(form.get('name'))

    // Exactly one of the two modes — never inferred from which fields happen to
    // be filled in.
    if (attachServiceId && name) {
      return jsonFail(
        400,
        'Send either serviceId (attach an existing service) or name (create one), not both.',
      )
    }

    const request = await prisma.viralServiceRequest.findUnique({
      where: { id: requestId },
      // `removedAt` is the gate, not decoration: a pulled look must not gain a
      // catalog service. No `name` — the audit note is redacted, so nothing
      // downstream reads it.
      select: { id: true, removedAt: true },
    })
    if (!request || request.removedAt) return jsonFail(404, 'Not found.')

    // `service` and the category the scope check runs on are decided together,
    // so there is exactly one read per mode and no re-derivation below.
    let service: ViralCatalogServiceInput
    let serviceCategoryId: string

    if (attachServiceId) {
      const attached = await prisma.service.findUnique({
        where: { id: attachServiceId },
        select: { id: true, categoryId: true },
      })
      if (!attached) return jsonFail(404, 'Not found.')

      service = { mode: 'attach', serviceId: attached.id }
      // The lib reads this row again inside the transaction, deliberately: this
      // read is for the permission check, and the write must see the row as it
      // is when it writes, not as it was when we authorised.
      serviceCategoryId = attached.categoryId
    } else if (name) {
      const categoryId = trimmedOrNull(form.get('categoryId'))
      if (!categoryId) return jsonFail(400, 'Missing categoryId.')

      const defaultDurationMinutes =
        pickInt(form.get('defaultDurationMinutes')) ?? FALLBACK_DURATION_MINUTES
      if (!isPositiveInt(defaultDurationMinutes)) {
        return jsonFail(400, 'Invalid defaultDurationMinutes.')
      }

      service = {
        mode: 'create',
        name,
        categoryId,
        description: trimmedOrNull(form.get('description')),
        proBreakdown: trimmedOrNull(form.get('proBreakdown')),
        defaultDurationMinutes,
      }
      serviceCategoryId = categoryId
    } else {
      return jsonFail(400, 'Missing serviceId or name.')
    }

    // Every category this write touches must be in the admin's scope: the
    // service's own, and each base service's. Read the base services BEFORE the
    // transaction so a refusal costs no write.
    const baseServices = await prisma.service.findMany({
      where: { id: { in: baseServiceIds } },
      select: { id: true, categoryId: true },
    })

    const found = new Set(baseServices.map((row) => row.id))
    const missing = baseServiceIds.filter((baseId) => !found.has(baseId))
    if (missing.length > 0) {
      return jsonFail(400, `Unknown base service(s): ${missing.join(', ')}`)
    }

    const scopedCategoryIds = new Set<string>([
      serviceCategoryId,
      ...baseServices.map((row) => row.categoryId),
    ])

    for (const categoryId of scopedCategoryIds) {
      const okCategory = await hasAdminPermission({
        adminUserId,
        allowedRoles: [
          AdminPermissionRole.SUPER_ADMIN,
          AdminPermissionRole.SUPPORT,
        ],
        scope: { categoryId },
      })
      if (!okCategory) return jsonFail(403, 'Forbidden')
    }

    const linked = await prisma.$transaction((tx) =>
      linkViralLookToCatalogService(tx, {
        requestId: request.id,
        service,
        baseServiceIds,
      }),
    )

    await writeAdminAuditLog({
      adminUserId,
      serviceId: linked.serviceId,
      categoryId: linked.categoryId,
      action: linked.created
        ? 'VIRAL_LOOK_SERVICE_CREATED'
        : 'VIRAL_LOOK_SERVICE_ATTACHED',
      // Deliberately generic: `note` is on `redactAuditPayload`'s key list, so
      // EVERY audit note is stored as "[REDACTED]" (free text can carry PII).
      // Interpolating the look and service names here would read like a record
      // and be unrecoverable — the facts go in `metadata`, which survives.
      note: 'Viral look linked to a catalog service',
      metadata: {
        viralServiceRequestId: request.id,
        serviceId: linked.serviceId,
        serviceName: linked.serviceName,
        categoryId: linked.categoryId,
        baseServiceIds: linked.baseServiceIds,
      },
    }).catch(() => null)

    return jsonOk({ service: linked }, 200)
  } catch (error) {
    // The write path's own refusals are the admin's mistakes, not server faults,
    // so they answer 400 with the reason rather than a blank 500.
    if (
      error instanceof ViralBaseServiceEmptyError ||
      error instanceof ViralBaseServiceSelfLinkError ||
      error instanceof ViralBaseServiceChainError ||
      error instanceof ViralCatalogServiceNameTakenError
    ) {
      return jsonFail(400, error.message)
    }

    if (error instanceof ViralCatalogServiceNotFoundError) {
      return jsonFail(404, error.message)
    }

    console.error(
      'POST /api/v1/admin/viral-service-requests/[id]/service error',
      error,
    )
    return jsonFail(500, 'Internal server error')
  }
}
