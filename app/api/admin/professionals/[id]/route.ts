// app/api/admin/professionals/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { AdminPermissionRole, VerificationStatus } from '@prisma/client'
import { hasAdminPermission } from '@/lib/adminPermissions'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickBool(v: unknown) {
  return typeof v === 'boolean' ? v : null
}

function normalizeStatus(v: unknown): VerificationStatus | null {
  const s = pickString(v)?.toUpperCase()
  if (s === 'PENDING') return VerificationStatus.PENDING
  if (s === 'APPROVED') return VerificationStatus.APPROVED
  if (s === 'REJECTED') return VerificationStatus.REJECTED
  return null
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing professional id.' }, { status: 400 })

    // Permission: reviewer or super admin, scoped to this professional if applicable
    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER],
      scope: { professionalId: id },
    })
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const status = normalizeStatus(body?.verificationStatus)
    const licenseVerified = pickBool(body?.licenseVerified)

    if (!status && licenseVerified == null) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const updated = await prisma.professionalProfile.update({
      where: { id },
      data: {
        ...(status ? { verificationStatus: status } : {}),
        ...(licenseVerified != null ? { licenseVerified } : {}),
      },
      select: { id: true, verificationStatus: true, licenseVerified: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          professionalId: id,
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
