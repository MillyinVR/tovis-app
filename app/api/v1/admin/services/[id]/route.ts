// app/api/v1/admin/services/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole, Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { safeUrl } from '@/app/api/_utils/media'
import { pickBool, pickInt, pickMethod, pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { parseMoney } from '@/lib/moneyDecimal'
import { prisma } from '@/lib/prisma'
import { CONSULT_FACT_FIELDS, consultFactsConflict } from '@/lib/services/consultFacts'
import {
  ADDITIONAL_CATEGORY_IDS_FIELD,
  PrimaryCategoryLinkError,
  parseAdditionalCategoryIds,
  replaceServiceCategoryLinks,
} from '@/lib/services/categoryLinks'

export const dynamic = 'force-dynamic'

type ServiceForPatch = {
  id: string
  categoryId: string
  /** Current diagnostic facts, so a PARTIAL edit is checked against what is stored. */
  maxLiftLevels: number | null
  isChemical: boolean
}

type HttpStatusError = Error & {
  status?: number
}

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseBoolish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value

  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!text) return null

  if (text === 'true' || text === '1' || text === 'on' || text === 'yes') {
    return true
  }

  if (text === 'false' || text === '0' || text === 'off' || text === 'no') {
    return false
  }

  return null
}

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.trunc(value) === value &&
    value > 0
  )
}

function toStatusError(error: unknown): HttpStatusError | null {
  if (!(error instanceof Error)) return null

  const maybeStatus = (error as { status?: unknown }).status

  if (typeof maybeStatus === 'number') {
    return Object.assign(error, { status: maybeStatus })
  }

  return error
}

function forbiddenError(): HttpStatusError {
  return Object.assign(new Error('Forbidden'), { status: 403 })
}

function statusFromUnknown(error: unknown): number {
  const typed = toStatusError(error)
  return typeof typed?.status === 'number' ? typed.status : 500
}

async function getServiceOr404(
  serviceId: string,
): Promise<ServiceForPatch | null> {
  return await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      categoryId: true,
      // Read back so a partial edit of the diagnostic facts can be checked
      // against what is already stored, not just against what was posted.
      maxLiftLevels: true,
      isChemical: true,
    },
  })
}

async function assertAdminScopeOrThrow(args: {
  adminUserId: string
  serviceId: string
  categoryId: string
}): Promise<void> {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [
      AdminPermissionRole.SUPER_ADMIN,
      AdminPermissionRole.SUPPORT,
    ],
    scope: {
      serviceId: args.serviceId,
      categoryId: args.categoryId,
    },
  })

  if (!ok) throw forbiddenError()
}

async function assertAdminCategoryScopeOrThrow(args: {
  adminUserId: string
  categoryId: string
}): Promise<void> {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [
      AdminPermissionRole.SUPER_ADMIN,
      AdminPermissionRole.SUPPORT,
    ],
    scope: {
      categoryId: args.categoryId,
    },
  })

  if (!ok) throw forbiddenError()
}

function wantsRedirect(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? ''
  const contentType = req.headers.get('content-type') ?? ''
  const isForm =
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')

  return req.method === 'POST' && isForm && accept.includes('text/html')
}

function formHasAny(form: FormData, keys: readonly string[]): boolean {
  return keys.some((key) => form.has(key))
}

function redirectToService(req: NextRequest, serviceId: string): Response {
  return NextResponse.redirect(
    new URL(`/admin/services/${encodeURIComponent(serviceId)}`, req.url),
    { status: 303 },
  )
}

function buildServiceUpdateAuditNote(args: {
  changedKeys: string[]
  categoryChanged: boolean
}): string {
  return [
    `changedKeys=${args.changedKeys.join(',')}`,
    `categoryChanged=${String(args.categoryChanged)}`,
  ].join(' ')
}

async function handleUpdate(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const auth = await requireUser({ roles: ['ADMIN'] })
  if (!auth.ok) return auth.res

  const { id } = await resolveRouteParams(ctx)
  const serviceId = trimId(id)

  if (!serviceId) return jsonFail(400, 'Missing id')

  const service = await getServiceOr404(serviceId)
  if (!service) return jsonFail(404, 'Service not found')

  await assertAdminScopeOrThrow({
    adminUserId: auth.user.id,
    serviceId: service.id,
    categoryId: service.categoryId,
  })

  if (req.method === 'POST') {
    const form = await req.formData()
    const method = (pickMethod(form.get('_method')) ?? '').toUpperCase()

    if (method !== 'PATCH') return jsonFail(400, 'Unsupported')

    return await patchFromForm({
      req,
      service,
      adminUserId: auth.user.id,
      form,
    })
  }

  if (req.method === 'PATCH') {
    const form = await req.formData().catch(() => null)
    if (!form) return jsonFail(400, 'Invalid form body')

    return await patchFromForm({
      req,
      service,
      adminUserId: auth.user.id,
      form,
    })
  }

  return jsonFail(400, 'Unsupported')
}

type PatchArgs = {
  req: NextRequest
  service: ServiceForPatch
  adminUserId: string
  form: FormData
}

async function patchFromForm(args: PatchArgs): Promise<Response> {
  const { req, service, adminUserId, form } = args

  const isActivePresent = form.has('isActive')
  const isActiveParsed = parseBoolish(pickString(form.get('isActive')))

  const hasAnyNonToggleField = formHasAny(form, [
    'name',
    'categoryId',
    'defaultDurationMinutes',
    'minPrice',
    'description',
    'allowMobile',
    'isAddOnEligible',
    'addOnGroup',
    'defaultImageUrl',
    // The consult's diagnostic facts — what the work can and cannot achieve.
    ...CONSULT_FACT_FIELDS,
    ADDITIONAL_CATEGORY_IDS_FIELD,
  ])

  if (isActivePresent && isActiveParsed !== null && !hasAnyNonToggleField) {
    await prisma.service.update({
      where: { id: service.id },
      data: { isActive: isActiveParsed },
    })

    await writeAdminAuditLog({
      adminUserId,
      serviceId: service.id,
      categoryId: service.categoryId,
      action: 'SERVICE_TOGGLED',
      note: `isActive=${String(isActiveParsed)}`,
    }).catch(() => null)

    if (wantsRedirect(req)) {
      return redirectToService(req, service.id)
    }

    return jsonOk({}, 200)
  }

  const update: Prisma.ServiceUpdateInput = {}

  if (form.has('name')) {
    const name = (pickString(form.get('name')) ?? '').trim()
    if (!name) return jsonFail(400, 'Missing name')

    update.name = name
  }

  let nextCategoryId: string | null = null

  if (form.has('categoryId')) {
    const categoryId = (pickString(form.get('categoryId')) ?? '').trim()
    if (!categoryId) return jsonFail(400, 'Missing categoryId')

    nextCategoryId = categoryId
    update.category = {
      connect: { id: categoryId },
    }
  }

  if (form.has('defaultDurationMinutes')) {
    const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes'))
    if (!isPositiveInt(defaultDurationMinutes)) {
      return jsonFail(400, 'Invalid defaultDurationMinutes')
    }

    update.defaultDurationMinutes = defaultDurationMinutes
  }

  if (form.has('minPrice')) {
    const minPriceRaw = (pickString(form.get('minPrice')) ?? '').trim()
    if (!minPriceRaw) return jsonFail(400, 'Missing minPrice')

    try {
      update.minPrice = parseMoney(minPriceRaw)
    } catch {
      return jsonFail(400, 'Invalid minPrice. Use e.g. 45 or 45.00')
    }
  }

  if (form.has('description')) {
    const description = (pickString(form.get('description')) ?? '').trim()
    update.description = description || null
  }

  if (form.has('allowMobile')) {
    update.allowMobile =
      pickBool(form.get('allowMobile')) ??
      parseBoolish(pickString(form.get('allowMobile'))) ??
      false
  }

  if (form.has('isAddOnEligible')) {
    update.isAddOnEligible =
      pickBool(form.get('isAddOnEligible')) ??
      parseBoolish(pickString(form.get('isAddOnEligible'))) ??
      false
  }

  if (form.has('addOnGroup')) {
    const addOnGroup = (pickString(form.get('addOnGroup')) ?? '').trim()
    update.addOnGroup = addOnGroup || null
  }

  // ── The consult's diagnostic facts ────────────────────────────────────────
  //
  // What the work can and cannot ACHIEVE — the columns the look plan reasons
  // from. Admin-owned by design (Tori, 2026-09-13): the app hardcodes none of
  // this, `pnpm seed:service-facts` only ever fills a blank, and whatever is
  // saved here is what the consult uses from the next analysis onward.
  //
  // 🔴 A blank field is stored as NULL, not as 0 or false, wherever the column
  // allows it: "this service cannot lighten" and "nobody has told us yet" are
  // different facts and only one of them is safe to plan against.
  if (form.has('consultSummary')) {
    const consultSummary = (pickString(form.get('consultSummary')) ?? '').trim()
    update.consultSummary = consultSummary || null
  }

  if (form.has('limitations')) {
    const limitations = (pickString(form.get('limitations')) ?? '').trim()
    update.limitations = limitations || null
  }

  if (form.has('maxLiftLevels')) {
    const raw = (pickString(form.get('maxLiftLevels')) ?? '').trim()
    if (!raw) {
      update.maxLiftLevels = null
    } else {
      const maxLiftLevels = pickInt(form.get('maxLiftLevels'))
      // The DB CHECK enforces this too; refusing here is what turns a typo
      // into a readable message instead of a 500.
      if (maxLiftLevels === null || !Number.isInteger(maxLiftLevels) || maxLiftLevels < 0 || maxLiftLevels > 10) {
        return jsonFail(400, 'Invalid maxLiftLevels. Use 0–10, or leave it blank if unknown.')
      }
      update.maxLiftLevels = maxLiftLevels
    }
  }

  for (const field of ['depositsTone', 'isChemical', 'changesShape', 'addsLength'] as const) {
    if (form.has(field)) {
      update[field] =
        pickBool(form.get(field)) ?? parseBoolish(pickString(form.get(field))) ?? false
    }
  }

  // 🔴 A service that LIGHTENS is chemical work, always. The database says so
  // as well; checking here means an admin gets told why rather than a 500, and
  // the safer-looking half of the pair cannot be saved on its own by accident.
  // `update` is a Prisma input, so a field can legitimately be an operation
  // object rather than a value. Only a plain number is a lift level; anything
  // else means this request did not set one, so fall back to what is stored.
  const liftUpdate = update.maxLiftLevels
  const conflict = consultFactsConflict({
    maxLiftLevels:
      typeof liftUpdate === 'number' ? liftUpdate
      : liftUpdate === null ? null
      : service.maxLiftLevels,
    isChemical: typeof update.isChemical === 'boolean' ? update.isChemical : service.isChemical,
  })
  if (conflict) return jsonFail(400, conflict)

  if (form.has('isActive')) {
    const isActive =
      pickBool(form.get('isActive')) ??
      parseBoolish(pickString(form.get('isActive')))

    if (isActive !== null) {
      update.isActive = isActive
    }
  }

  if (form.has('defaultImageUrl')) {
    const raw = (pickString(form.get('defaultImageUrl')) ?? '').trim()

    if (!raw) {
      update.defaultImageUrl = null
    } else {
      const cleaned = safeUrl(raw)
      if (!cleaned) return jsonFail(400, 'Invalid defaultImageUrl')

      update.defaultImageUrl = cleaned
    }
  }

  // ABSENT means untouched: a form that does not carry the field cannot wipe
  // the links by saving. Present (even empty) is the new complete set.
  const additionalCategoryIds = parseAdditionalCategoryIds(form)

  if (Object.keys(update).length === 0 && additionalCategoryIds === null) {
    return jsonFail(400, 'No valid fields to update')
  }

  if (nextCategoryId && nextCategoryId !== service.categoryId) {
    await assertAdminCategoryScopeOrThrow({
      adminUserId,
      categoryId: nextCategoryId,
    })
  }

  const categoryId = nextCategoryId ?? service.categoryId

  if (additionalCategoryIds !== null) {
    if (additionalCategoryIds.includes(categoryId)) {
      return jsonFail(400, new PrimaryCategoryLinkError().message)
    }
    for (const linkedCategoryId of additionalCategoryIds) {
      await assertAdminCategoryScopeOrThrow({ adminUserId, categoryId: linkedCategoryId })
    }
  }

  const linkChange = await prisma.$transaction(async (tx) => {
    if (Object.keys(update).length) {
      await tx.service.update({
        where: { id: service.id },
        data: update,
      })
    }
    if (additionalCategoryIds === null) {
      // The form did not speak about links, so they stay — except one that now
      // points at the NEW primary, which is no longer a link by definition.
      if (nextCategoryId && nextCategoryId !== service.categoryId) {
        await tx.serviceCategoryLink.deleteMany({
          where: { serviceId: service.id, categoryId: nextCategoryId },
        })
      }
      return null
    }
    return replaceServiceCategoryLinks(tx, {
      serviceId: service.id,
      primaryCategoryId: categoryId,
      categoryIds: additionalCategoryIds,
    })
  })

  const changedKeys = [
    ...Object.keys(update),
    ...(linkChange && (linkChange.added || linkChange.removed) ? [ADDITIONAL_CATEGORY_IDS_FIELD] : []),
  ]

  await writeAdminAuditLog({
    adminUserId,
    serviceId: service.id,
    categoryId,
    action: 'SERVICE_UPDATED',
    note: buildServiceUpdateAuditNote({
      changedKeys,
      categoryChanged: categoryId !== service.categoryId,
    }),
  }).catch(() => null)

  if (wantsRedirect(req)) {
    return redirectToService(req, service.id)
  }

  return jsonOk({}, 200)
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  try {
    return await handleUpdate(req, ctx)
  } catch (error: unknown) {
    const status = statusFromUnknown(error)

    if (status === 403) return jsonFail(403, 'Forbidden')

    console.error('POST /api/v1/admin/services/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
  try {
    return await handleUpdate(req, ctx)
  } catch (error: unknown) {
    const status = statusFromUnknown(error)

    if (status === 403) return jsonFail(403, 'Forbidden')

    console.error('PATCH /api/v1/admin/services/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}