// app/api/admin/services/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole, Prisma } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { safeUrl } from '@/app/api/_utils/media'
import { pickBool, pickInt, pickMethod, pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { parseMoney } from '@/lib/money'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type ServiceForPatch = {
  id: string
  categoryId: string
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

  if (Object.keys(update).length === 0) {
    return jsonFail(400, 'No valid fields to update')
  }

  if (nextCategoryId && nextCategoryId !== service.categoryId) {
    await assertAdminCategoryScopeOrThrow({
      adminUserId,
      categoryId: nextCategoryId,
    })
  }

  await prisma.service.update({
    where: { id: service.id },
    data: update,
  })

  const changedKeys = Object.keys(update)
  const categoryId = nextCategoryId ?? service.categoryId

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

    console.error('POST /api/admin/services/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
  try {
    return await handleUpdate(req, ctx)
  } catch (error: unknown) {
    const status = statusFromUnknown(error)

    if (status === 403) return jsonFail(403, 'Forbidden')

    console.error('PATCH /api/admin/services/[id] error', error)
    return jsonFail(500, 'Internal server error')
  }
}