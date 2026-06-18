// app/api/admin/professionals/[id]/route.ts

import { NextRequest } from 'next/server'
import {
  AdminPermissionRole,
  Role,
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { isUsStateCode } from '@/lib/usStates'
import { requiresLicense } from '@/lib/licensing/licenseRequirement'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickBool, pickString } from '@/app/api/_utils/pick'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { refreshProfessional } from '@/lib/search/index/refreshSearchIndex'

export const dynamic = 'force-dynamic'

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const user = auth.user

    const { id } = await resolveRouteParams(ctx)
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

    // Optional admin corrections to the license fields themselves.
    let licenseNumber: string | undefined
    if (typeof body.licenseNumber === 'string') {
      licenseNumber = body.licenseNumber.trim().toUpperCase().replace(/\s+/g, '')
    }
    let licenseState: string | undefined
    if (typeof body.licenseState === 'string') {
      const up = body.licenseState.trim().toUpperCase()
      if (!isUsStateCode(up)) return jsonFail(400, 'Invalid US state.')
      licenseState = up
    }
    let licenseExpiry: Date | null | undefined
    if (typeof body.licenseExpiry === 'string') {
      const s = body.licenseExpiry.trim()
      if (s === '') licenseExpiry = null
      else {
        const d = new Date(s)
        if (!Number.isFinite(d.getTime())) return jsonFail(400, 'Invalid expiration date.')
        licenseExpiry = d
      }
    }

    const hasLicenseEdit =
      licenseNumber !== undefined || licenseState !== undefined || licenseExpiry !== undefined

    if (status == null && licenseVerified == null && !hasLicenseEdit) {
      return jsonFail(400, 'Nothing to update.')
    }

    const existing = await prisma.professionalProfile.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        professionType: true,
        licenseState: true,
        licenseExpiry: true,
        verificationDocs: {
          where: { type: VerificationDocumentType.LICENSE },
          select: { id: true },
          take: 1,
        },
      },
    })

    if (!existing) {
      return jsonFail(404, 'Professional not found.')
    }

    // Approval gate: a license-required pro can't be APPROVED without both an
    // expiration date on file and an uploaded license document.
    if (status === VerificationStatus.APPROVED && existing.professionType) {
      const effectiveState = licenseState ?? existing.licenseState
      if (requiresLicense(existing.professionType, effectiveState)) {
        const effectiveExpiry =
          licenseExpiry !== undefined ? licenseExpiry : existing.licenseExpiry
        if (!effectiveExpiry) {
          return jsonFail(400, 'Set the license expiration date before approving.', {
            code: 'EXPIRY_REQUIRED',
          })
        }
        if (existing.verificationDocs.length === 0) {
          return jsonFail(400, 'A license document must be uploaded before approving.', {
            code: 'LICENSE_DOC_REQUIRED',
          })
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const professional = await tx.professionalProfile.update({
        where: { id: professionalId },
        data: {
          ...(status != null ? { verificationStatus: status } : {}),
          ...(licenseVerified != null ? { licenseVerified } : {}),
          ...(licenseNumber !== undefined ? { licenseNumber } : {}),
          ...(licenseState !== undefined ? { licenseState } : {}),
          ...(licenseExpiry !== undefined ? { licenseExpiry } : {}),
          // Approving or rejecting resolves any pending re-review.
          ...(status === VerificationStatus.APPROVED ||
          status === VerificationStatus.REJECTED
            ? { licenseReviewPending: false }
            : {}),
        },
        select: {
          id: true,
          verificationStatus: true,
          licenseVerified: true,
          licenseReviewPending: true,
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