// app/api/pro/license/route.ts
//
// Pro self-edit of their license metadata (number / state / expiration date).
// Editing flags the profile for admin re-review (licenseReviewPending = true)
// but deliberately does NOT change verificationStatus — an APPROVED pro keeps
// their access while the re-review is pending. Only an actually-expired license
// cuts access (enforced in proReadiness, not here).
//
// The license IMAGE is uploaded separately via /api/pro/verification-docs.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { emitAdminVerificationReviewNeeded } from '@/lib/notifications/adminNotifications'
import { prisma } from '@/lib/prisma'
import { isUsStateCode } from '@/lib/usStates'

export const dynamic = 'force-dynamic'

function normalizeLicenseNumber(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : ''
}

function parseExpiry(v: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (v == null || v === '') return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? { ok: true, value: d } : { ok: false }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    const body = await readJsonRecord(req)

    const state = typeof body.licenseState === 'string' ? body.licenseState.trim().toUpperCase() : ''
    if (!isUsStateCode(state)) {
      return jsonFail(400, 'Please select a valid US state.', { code: 'STATE_INVALID' })
    }

    const licenseNumber = normalizeLicenseNumber(body.licenseNumber)
    if (!licenseNumber) {
      return jsonFail(400, 'License/registration number is required.', {
        code: 'LICENSE_REQUIRED',
      })
    }

    const expiry = parseExpiry(body.licenseExpiry)
    if (!expiry.ok) {
      return jsonFail(400, 'Invalid expiration date.', { code: 'LICENSE_EXPIRY_INVALID' })
    }

    const current = await prisma.professionalProfile.findUnique({
      where: { id: proId },
      select: { id: true, licenseNumber: true, licenseState: true, licenseExpiry: true },
    })
    if (!current) return jsonFail(404, 'Professional profile not found.')

    const updated = await prisma.$transaction(async (tx) => {
      const license = await tx.professionalProfile.update({
        where: { id: proId },
        data: {
          licenseNumber,
          licenseState: state,
          licenseExpiry: expiry.value,
          // Back into the admin queue for re-review — access is unaffected.
          licenseReviewPending: true,
        },
        select: {
          id: true,
          licenseNumber: true,
          licenseState: true,
          licenseExpiry: true,
          licenseReviewPending: true,
          verificationStatus: true,
        },
      })

      // Alert admins that this pro needs a license re-review.
      await emitAdminVerificationReviewNeeded({ tx, professionalId: proId })

      return license
    })

    return jsonOk({ license: updated })
  } catch (error: unknown) {
    console.error('PATCH /api/pro/license error', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonFail(500, message)
  }
}
