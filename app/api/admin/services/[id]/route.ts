// app/api/admin/services/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickInt, pickMethod, pickString, pickBool } from '@/app/api/_utils/pick'
import { parseMoney } from '@/lib/money'
import { safeUrl } from '@/app/api/_utils/media'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Checkbox / bool normalization that works with:
 * - <input type="checkbox"> => "on"
 * - explicit strings => "true" / "false"
 * - numbers => "1" / "0"
 */
function parseBoolish(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!s) return null
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  return null
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.trunc(n) === n && n > 0
}

async function getServiceOr404(serviceId: string) {
  return await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, categoryId: true },
  })
}

async function assertAdminScopeOrThrow(args: { adminUserId: string; serviceId: string; categoryId: string }) {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    scope: { serviceId: args.serviceId, categoryId: args.categoryId },
  })
  if (!ok) throw Object.assign(new Error('Forbidden'), { status: 403 })
}

async function assertAdminCategoryScopeOrThrow(args: { adminUserId: string; categoryId: string }) {
  const ok = await hasAdminPermission({
    adminUserId: args.adminUserId,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.SUPPORT],
    scope: { categoryId: args.categoryId },
  })
  if (!ok) throw Object.assign(new Error('Forbidden'), { status: 403 })
}

function wantsRedirect(req: NextRequest) {
  // If it’s an HTML form, we usually want redirects.
  const accept = req.headers.get('accept') || ''
  const ct = req.headers.get('content-type') || ''
  const isForm = ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')
  return req.method === 'POST' && isForm && accept.includes('text/html')
}

function formHasAny(form: FormData, keys: string[]) {
  for (const k of keys) if (form.has(k)) return true
  return false
}

async function handleUpdate(req: NextRequest, ctx: Ctx) {
  const auth = await requireUser({ roles: ['ADMIN'] })
  if (!auth.ok) return auth.res
  const user = auth.user

  const { id } = await getParams(ctx)
  const serviceId = trimId(id)
  if (!serviceId) return jsonFail(400, 'Missing id')

  const svc = await getServiceOr404(serviceId)
  if (!svc) return jsonFail(404, 'Service not found')

  await assertAdminScopeOrThrow({ adminUserId: user.id, serviceId: svc.id, categoryId: svc.categoryId })

  // Support:
  // - HTML form POST with _method=PATCH
  // - real PATCH with FormData body
  if (req.method === 'POST') {
    const form = await req.formData()
    const method = (pickMethod(form.get('_method')) ?? '').toUpperCase()
    if (method !== 'PATCH') return jsonFail(400, 'Unsupported')
    return await patchFromForm({ req, svc, adminUserId: user.id, form })
  }

  if (req.method === 'PATCH') {
    const form = await req.formData().catch(() => null)
    if (!form) return jsonFail(400, 'Invalid form body')
    return await patchFromForm({ req, svc, adminUserId: user.id, form })
  }

  return jsonFail(400, 'Unsupported')
}

type PatchArgs = {
  req: NextRequest
  svc: { id: string; categoryId: string }
  adminUserId: string
  form: FormData
}

async function patchFromForm(args: PatchArgs) {
  const { req, svc, adminUserId, form } = args

  // ----------------------------
  // 1) Toggle-only: isActive only
  // ----------------------------
  const isActivePresent = form.has('isActive')
  const isActiveParsed = parseBoolish(pickString(form.get('isActive')))

  // Any field other than isActive means “not toggle-only”
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
      where: { id: svc.id },
      data: { isActive: isActiveParsed },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId,
          serviceId: svc.id,
          categoryId: svc.categoryId,
          action: 'SERVICE_TOGGLED',
          note: `isActive=${isActiveParsed}`,
        },
      })
      .catch(() => null)

    if (wantsRedirect(req)) {
      return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(svc.id)}`, req.url), { status: 303 })
    }
    return jsonOk({}, 200)
  }

  // ----------------------------
  // 2) Partial update: update only fields that are PRESENT
  // ----------------------------
  const update: Record<string, any> = {}

  // name
  if (form.has('name')) {
    const name = (pickString(form.get('name')) ?? '').trim()
    if (!name) return jsonFail(400, 'Missing name')
    update.name = name
  }

  // categoryId
  let nextCategoryId: string | null = null
  if (form.has('categoryId')) {
    const categoryId = (pickString(form.get('categoryId')) ?? '').trim()
    if (!categoryId) return jsonFail(400, 'Missing categoryId')
    nextCategoryId = categoryId
    update.categoryId = categoryId
  }

  // defaultDurationMinutes
  if (form.has('defaultDurationMinutes')) {
    const v = pickInt(form.get('defaultDurationMinutes'))
    if (!isPositiveInt(v)) return jsonFail(400, 'Invalid defaultDurationMinutes')
    update.defaultDurationMinutes = v
  }

  // minPrice
  if (form.has('minPrice')) {
    const minPriceRaw = (pickString(form.get('minPrice')) ?? '').trim()
    if (!minPriceRaw) return jsonFail(400, 'Missing minPrice')
    try {
      update.minPrice = parseMoney(minPriceRaw)
    } catch {
      return jsonFail(400, 'Invalid minPrice. Use e.g. 45 or 45.00')
    }
  }

  // description (allow clear)
  if (form.has('description')) {
    const descriptionRaw = (pickString(form.get('description')) ?? '').trim()
    update.description = descriptionRaw ? descriptionRaw : null
  }

  // allowMobile (checkbox-friendly) — only if present
  if (form.has('allowMobile')) {
    const allowMobile =
      pickBool(form.get('allowMobile')) ?? (parseBoolish(pickString(form.get('allowMobile'))) ?? false)
    update.allowMobile = allowMobile
  }

  // isAddOnEligible — only if present
  if (form.has('isAddOnEligible')) {
    const isAddOnEligible =
      pickBool(form.get('isAddOnEligible')) ?? (parseBoolish(pickString(form.get('isAddOnEligible'))) ?? false)
    update.isAddOnEligible = isAddOnEligible
  }

  // addOnGroup (allow clear) — only if present
  if (form.has('addOnGroup')) {
    const addOnGroupRaw = (pickString(form.get('addOnGroup')) ?? '').trim()
    update.addOnGroup = addOnGroupRaw ? addOnGroupRaw : null
  }

  // isActive can be part of partial updates too (only if present + parseable)
  if (form.has('isActive')) {
    const isActive = pickBool(form.get('isActive')) ?? (parseBoolish(pickString(form.get('isActive'))) ?? null)
    if (isActive !== null) update.isActive = isActive
  }

  // defaultImageUrl (allow clear)
  if (form.has('defaultImageUrl')) {
    const raw = (pickString(form.get('defaultImageUrl')) ?? '').trim()

    if (raw === '') {
      update.defaultImageUrl = null
    } else {
      const cleaned = safeUrl(raw)
      if (!cleaned) return jsonFail(400, 'Invalid defaultImageUrl')
      update.defaultImageUrl = cleaned
    }
  }

  // No valid fields?
  if (Object.keys(update).length === 0) {
    return jsonFail(400, 'No valid fields to update')
  }

  // If category is changing, permission-check destination category too.
  const destCategoryId = nextCategoryId
  if (destCategoryId && destCategoryId !== svc.categoryId) {
    await assertAdminCategoryScopeOrThrow({ adminUserId, categoryId: destCategoryId })
  }

  await prisma.service.update({
    where: { id: svc.id },
    data: update,
  })

  await prisma.adminActionLog
    .create({
      data: {
        adminUserId,
        serviceId: svc.id,
        categoryId: destCategoryId ?? svc.categoryId,
        action: 'SERVICE_UPDATED',
        note:
          update.name ??
          (Object.keys(update).length === 1 && update.defaultImageUrl !== undefined ? 'defaultImageUrl' : '(partial update)'),
      },
    })
    .catch(() => null)

  if (wantsRedirect(req)) {
    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(svc.id)}`, req.url), { status: 303 })
  }
  return jsonOk({}, 200)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    return await handleUpdate(req, ctx)
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    if (status === 403) return jsonFail(403, 'Forbidden')
    console.error('POST /api/admin/services/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    return await handleUpdate(req, ctx)
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    if (status === 403) return jsonFail(403, 'Forbidden')
    console.error('PATCH /api/admin/services/[id] error', e)
    return jsonFail(500, 'Internal server error')
  }
}