import { FounderSpecialty } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { resolveFounderPortalAccess } from '@/lib/founders/access'
import {
  enrollFoundingClient,
  enrollFoundingProfessional,
  FounderEnrollmentError,
  founderAdminSummary,
  moderateFounderReport,
} from '@/lib/founders/admin'

export const dynamic = 'force-dynamic'

function parseSpecialty(value: unknown): FounderSpecialty | null {
  if (typeof value !== 'string') return null
  return (
    Object.values(FounderSpecialty).find((candidate) => candidate === value) ??
    null
  )
}

async function requireFounderAdmin() {
  const auth = await requireUser()
  if (!auth.ok) return auth
  const access = await resolveFounderPortalAccess(auth.user)
  return access.canAdminister
    ? auth
    : { ok: false as const, res: jsonFail(403, 'Founder administrator access required.') }
}

export async function GET() {
  try {
    const auth = await requireFounderAdmin()
    if (!auth.ok) return auth.res
    return jsonOk({ summary: await founderAdminSummary() })
  } catch (error: unknown) {
    console.error('GET /api/v1/founders/admin', error)
    return jsonFail(500, 'Could not load founder administration.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireFounderAdmin()
    if (!auth.ok) return auth.res
    const input = await readJsonRecord(req)
    const audience = pickString(input.audience)?.trim().toUpperCase()
    const email = pickString(input.email) ?? '' // pii-plaintext-read-ok: SUPER_ADMIN founder enrollment request boundary

    if (audience === 'PRO') {
      const specialty = parseSpecialty(input.specialty)
      if (!specialty) return jsonFail(400, 'Choose a professional specialty.')
      const memberId = await enrollFoundingProfessional({ email, specialty })
      return jsonOk({ memberId }, 201)
    }

    if (audience === 'CLIENT') {
      const sponsorEmail = pickString(input.sponsorEmail) ?? ''
      const result = await enrollFoundingClient({ email, sponsorEmail })
      return jsonOk(result, 201)
    }

    return jsonFail(400, 'Choose professional or client enrollment.')
  } catch (error: unknown) {
    if (error instanceof FounderEnrollmentError) {
      return jsonFail(error.status, error.message)
    }
    console.error('POST /api/v1/founders/admin', error)
    return jsonFail(500, 'Could not enroll this founder.')
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireFounderAdmin()
    if (!auth.ok) return auth.res
    const input = await readJsonRecord(req)
    const reportId = pickString(input.reportId)?.trim() ?? ''
    const action = pickString(input.action)?.trim().toUpperCase()
    if (!reportId || (action !== 'HIDE' && action !== 'RESOLVE')) {
      return jsonFail(400, 'Choose a report and moderation action.')
    }
    await moderateFounderReport({ reportId, action, adminUserId: auth.user.id })
    return jsonOk({ resolved: true })
  } catch (error: unknown) {
    if (error instanceof FounderEnrollmentError) {
      return jsonFail(error.status, error.message)
    }
    console.error('PATCH /api/v1/founders/admin', error)
    return jsonFail(500, 'Could not resolve this report.')
  }
}
