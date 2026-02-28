// app/api/admin/professionals/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { pickBool, pickString } from '@/app/api/_utils/pick'
import { AdminPermissionRole, VerificationStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeStatus(v: unknown): VerificationStatus | null {
  const s = pickString(v)?.trim().toUpperCase()
  if (!s) return null

  if (s === 'PENDING') return VerificationStatus.PENDING
  if (s === 'APPROVED') return VerificationStatus.APPROVED
  if (s === 'REJECTED') return VerificationStatus.REJECTED
  if (s === 'NEEDS_INFO') return VerificationStatus.NEEDS_INFO

  return null
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: ['ADMIN'] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await getParams(ctx)
    const professionalId = trimId(id)
    if (!professionalId) {
      return NextResponse.json({ error: 'Missing professional id.' }, { status: 400 })
    }

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER],
      scope: { professionalId },
    })
    if (!perm.ok) return perm.res

    // Optional but helpful: reject totally wrong content types
    const ct = req.headers.get('content-type') || ''
    if (ct && !ct.includes('application/json')) {
      return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 })
    }

    const body = await req.json().catch(() => ({} as any))

    const rawStatus = pickString(body?.verificationStatus)
    const status = normalizeStatus(rawStatus)
    const licenseVerified = pickBool(body?.licenseVerified)

    // If they sent a non-empty status string but it’s invalid, reject (don’t silently ignore)
    if (rawStatus && !status) {
      return NextResponse.json(
        { error: 'Invalid verificationStatus. Use PENDING, APPROVED, REJECTED, or NEEDS_INFO.' },
        { status: 400 },
      )
    }

    if (status == null && licenseVerified == null) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    // Nice: fail with 404 instead of throwing a Prisma error
    const exists = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true },
    })
    if (!exists) {
      return NextResponse.json({ error: 'Professional not found.' }, { status: 404 })
    }

    const updated = await prisma.professionalProfile.update({
      where: { id: professionalId },
      data: {
        ...(status != null ? { verificationStatus: status } : {}),
        ...(licenseVerified != null ? { licenseVerified } : {}),
      },
      select: { id: true, verificationStatus: true, licenseVerified: true },
    })

    // best-effort log (never fail request)
    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          professionalId,
          action: 'PRO_VERIFICATION_UPDATED',
          note: `status=${status ?? 'UNCHANGED'} licenseVerified=${licenseVerified ?? 'UNCHANGED'}`,
        },
      })
      .catch(() => null)

    return NextResponse.json({ ok: true, professional: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/admin/professionals/[id] error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}