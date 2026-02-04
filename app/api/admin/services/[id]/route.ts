// app/api/admin/services/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { AdminPermissionRole } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { pickInt, pickMethod, pickString, pickBool } from '@/app/api/_utils/pick'
import { parseMoney } from '@/lib/money'
import { safeUrl } from '@/app/api/_utils/media'

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

async function handleUpdate(req: NextRequest, ctx: Ctx) {
  const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
  if (res) return res

  const { id } = await getParams(ctx)
  const serviceId = trimId(id)
  if (!serviceId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const svc = await getServiceOr404(serviceId)
  if (!svc) return NextResponse.json({ error: 'Service not found' }, { status: 404 })

  await assertAdminScopeOrThrow({ adminUserId: user.id, serviceId: svc.id, categoryId: svc.categoryId })

  // Support:
  // - HTML form POST with _method=PATCH
  // - real PATCH with FormData body
  if (req.method === 'POST') {
    const form = await req.formData()
    const method = (pickMethod(form.get('_method')) ?? '').toUpperCase()
    if (method !== 'PATCH') return NextResponse.json({ error: 'Unsupported' }, { status: 400 })
    return await patchFromForm({ req, svc, adminUserId: user.id, form })
  }

  if (req.method === 'PATCH') {
    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'Invalid form body' }, { status: 400 })
    return await patchFromForm({ req, svc, adminUserId: user.id, form })
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 })
}

async function patchFromForm(args: {
  req: NextRequest
  svc: { id: string; categoryId: string }
  adminUserId: string
  form: FormData
}) {
  const { req, svc, adminUserId, form } = args

  // --- Detect toggle-only intent safely ---
  const isActiveRaw = pickString(form.get('isActive'))
  const isActiveParsed = parseBoolish(isActiveRaw)

  // If any of these are present, it’s a “full edit” request (NOT toggle-only)
  const hasFullEditFields =
    Boolean(pickString(form.get('name'))) ||
    Boolean(pickString(form.get('categoryId'))) ||
    form.has('defaultDurationMinutes') ||
    Boolean(pickString(form.get('minPrice'))) ||
    Boolean(pickString(form.get('description'))) ||
    form.has('allowMobile') ||
    form.has('isAddOnEligible') ||
    Boolean(pickString(form.get('addOnGroup'))) ||
    // important: allow clearing (field present) OR setting (non-empty)
    form.has('defaultImageUrl')

  // Toggle-only: isActive is parseable AND no other edit fields present.
  if (isActiveParsed !== null && !hasFullEditFields) {
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
    return NextResponse.json({ ok: true })
  }

  // ---- full edit ----
  const name = (pickString(form.get('name')) ?? '').trim()
  const categoryId = (pickString(form.get('categoryId')) ?? '').trim()
  const defaultDurationMinutes = pickInt(form.get('defaultDurationMinutes'))
  const minPriceRaw = (pickString(form.get('minPrice')) ?? '').trim()
  const descriptionRaw = (pickString(form.get('description')) ?? '').trim()

  // checkbox-friendly booleans
  const allowMobile =
    pickBool(form.get('allowMobile')) ??
    (parseBoolish(pickString(form.get('allowMobile'))) ?? false)

  const isAddOnEligible =
    pickBool(form.get('isAddOnEligible')) ??
    (parseBoolish(pickString(form.get('isAddOnEligible'))) ?? false)

  const addOnGroupRaw = (pickString(form.get('addOnGroup')) ?? '').trim()
  const addOnGroup = addOnGroupRaw || null

  // allow isActive in full edit (overlay sends it)
  const isActive =
    pickBool(form.get('isActive')) ??
    (parseBoolish(pickString(form.get('isActive'))) ?? null)

  // default image url (allow clear)
  const defaultImageUrlRaw = (pickString(form.get('defaultImageUrl')) ?? '').trim()
  const defaultImageUrl =
    defaultImageUrlRaw === ''
      ? null
      : defaultImageUrlRaw
        ? safeUrl(defaultImageUrlRaw)
        : undefined

  if (defaultImageUrlRaw && defaultImageUrlRaw !== '' && !defaultImageUrl) {
    return NextResponse.json({ error: 'Invalid defaultImageUrl' }, { status: 400 })
  }

  if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  if (!categoryId) return NextResponse.json({ error: 'Missing categoryId' }, { status: 400 })
  if (!isPositiveInt(defaultDurationMinutes)) {
    return NextResponse.json({ error: 'Invalid defaultDurationMinutes' }, { status: 400 })
  }
  if (!minPriceRaw) return NextResponse.json({ error: 'Missing minPrice' }, { status: 400 })

  let minPrice
  try {
    minPrice = parseMoney(minPriceRaw)
  } catch {
    return NextResponse.json({ error: 'Invalid minPrice. Use e.g. 45 or 45.00' }, { status: 400 })
  }

  // If moving categories, permission-check destination category scope too.
  if (categoryId !== svc.categoryId) {
    await assertAdminCategoryScopeOrThrow({ adminUserId, categoryId })
  }

  await prisma.service.update({
    where: { id: svc.id },
    data: {
      name,
      categoryId,
      defaultDurationMinutes,
      minPrice,
      description: descriptionRaw || null,
      allowMobile,
      isAddOnEligible,
      addOnGroup,

      ...(isActive !== null ? { isActive } : {}),

      // allow clear or set
      ...(defaultImageUrl !== undefined ? { defaultImageUrl } : {}),
    },
  })

  await prisma.adminActionLog
    .create({
      data: {
        adminUserId,
        serviceId: svc.id,
        categoryId,
        action: 'SERVICE_UPDATED',
        note: name,
      },
    })
    .catch(() => null)

  if (wantsRedirect(req)) {
    return NextResponse.redirect(new URL(`/admin/services/${encodeURIComponent(svc.id)}`, req.url), { status: 303 })
  }
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    return await handleUpdate(req, ctx)
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    if (status === 403) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('POST /api/admin/services/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    return await handleUpdate(req, ctx)
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    if (status === 403) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    console.error('PATCH /api/admin/services/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
