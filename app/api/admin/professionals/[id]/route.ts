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
  const s = pickString(v)?.toUpperCase()
  if (s === 'PENDING') return VerificationStatus.PENDING
  if (s === 'APPROVED') return VerificationStatus.APPROVED
  if (s === 'REJECTED') return VerificationStatus.REJECTED
  return null
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { user, res } = await requireUser({ roles: ['ADMIN'] as any })
    if (res) return res

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

    const body = await req.json().catch(() => ({} as any))

    const status = normalizeStatus(body?.verificationStatus)
    const licenseVerified = pickBool(body?.licenseVerified)

    // If they sent a non-empty string but it’s invalid, reject (don’t silently ignore)
    const rawStatus = pickString(body?.verificationStatus)
    if (rawStatus && !status) {
      return NextResponse.json(
        { error: 'Invalid verificationStatus. Use PENDING, APPROVED, or REJECTED.' },
        { status: 400 },
      )
    }

    if (status === null && licenseVerified == null) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const updated = await prisma.professionalProfile.update({
      where: { id: professionalId },
      data: {
        ...(status ? { verificationStatus: status } : {}),
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
