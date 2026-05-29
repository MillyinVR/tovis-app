// app/api/admin/professionals/[id]/route.ts

import { NextRequest } from 'next/server'
import { AdminPermissionRole, Role, VerificationStatus } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickBool, pickString } from '@/app/api/_utils/pick'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { prisma } from '@/lib/prisma'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStatus(value: unknown): VerificationStatus | null {
  const status = pickString(value)?.trim().toUpperCase()
  if (!status) return null

  if (status === 'PENDING') return VerificationStatus.PENDING
  if (status === 'APPROVED') return VerificationStatus.APPROVED
  if (status === 'REJECTED') return VerificationStatus.REJECTED
  if (status === 'NEEDS_INFO') return VerificationStatus.NEEDS_INFO

  return null
}

async function readJsonBody(
  req: NextRequest,
): Promise<Record<string, unknown> | null> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType && !contentType.includes('application/json')) {
    return null
  }

  try {
    const parsed: unknown = await req.json()
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildVerificationUpdateNote(args: {
  status: VerificationStatus | null
  licenseVerified: boolean | null
}): string {
  return [
    `status=${args.status ?? 'UNCHANGED'}`,
    `licenseVerified=${
      args.licenseVerified == null ? 'UNCHANGED' : String(args.licenseVerified)
    }`,
  ].join(' ')
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id } = await getParams(ctx)
    const professionalId = trimId(id)

    if (!professionalId) {
      return jsonFail(400, 'Missing professional id.')
    }

    const permission = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: { professionalId },
    })

    if (!permission.ok) {
      return permission.res
    }

    const body = await readJsonBody(req)

    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const rawStatus = pickString(body.verificationStatus)
    const status = normalizeStatus(rawStatus)
    const licenseVerified = pickBool(body.licenseVerified)

    if (rawStatus && !status) {
      return jsonFail(
        400,
        'Invalid verificationStatus. Use PENDING, APPROVED, REJECTED, or NEEDS_INFO.',
      )
    }

    if (status == null && licenseVerified == null) {
      return jsonFail(400, 'Nothing to update.')
    }

    const exists = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: { id: true },
    })

    if (!exists) {
      return jsonFail(404, 'Professional not found.')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const professional = await tx.professionalProfile.update({
        where: { id: professionalId },
        data: {
          ...(status != null ? { verificationStatus: status } : {}),
          ...(licenseVerified != null ? { licenseVerified } : {}),
        },
        select: {
          id: true,
          verificationStatus: true,
          licenseVerified: true,
        },
      })

      if (status != null) {
        await refreshProfessional(professionalId, 'verification.status', tx)
      }

      return professional
    })

    await writeAdminAuditLog({
      adminUserId: user.id,
      professionalId,
      action: 'PRO_VERIFICATION_UPDATED',
      note: buildVerificationUpdateNote({
        status,
        licenseVerified,
      }),
    }).catch(() => null)

    return jsonOk({ professional: updated })
  } catch (error: unknown) {
    console.error('PATCH /api/admin/professionals/[id] error', error)

    const message =
      error instanceof Error ? error.message : 'Internal server error'

    return jsonFail(500, message)
  }
}