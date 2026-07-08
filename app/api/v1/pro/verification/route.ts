// app/api/v1/pro/verification/route.ts
//
// Read-only snapshot of the pro's verification state: status + license
// details + the doc list + the profession's accepted upload methods. Backs the
// native verification screen (the iOS counterpart to the web /pro/verification
// page, which reads the same shape directly from Prisma server-side). The
// mutations already have endpoints — license edit (PATCH /pro/license), doc
// upload (POST /pro/uploads → POST /pro/verification-docs), doc delete
// (DELETE /pro/verification-docs/[id]) — this just fills the missing GET.

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { requiresLicense } from '@/lib/licensing/licenseRequirement'
import {
  verificationDocTypeLabel,
  verificationMethodsForProfession,
} from '@/lib/pro/verification/methods'

export const dynamic = 'force-dynamic'

// License expiry is a calendar date, not an instant — expose it as YYYY-MM-DD
// (matches the web page's date-input value) so the client never re-derives a
// day from an instant in the wrong zone.
function toDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const pro = await prisma.professionalProfile.findUnique({
      where: { id: auth.professionalId },
      select: {
        professionType: true,
        verificationStatus: true,
        licenseState: true,
        licenseNumber: true,
        licenseExpiry: true,
        licenseVerified: true,
        verificationDocs: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            type: true,
            status: true,
            label: true,
            createdAt: true,
            adminNote: true,
          },
        },
      },
    })

    if (!pro) return jsonFail(404, 'Professional profile not found.')

    const isLicensed = Boolean(
      pro.professionType && requiresLicense(pro.professionType, pro.licenseState),
    )

    return jsonOk({
      verification: {
        status: pro.verificationStatus,
        licenseVerified: pro.licenseVerified,
        isLicensed,
        license: {
          state: pro.licenseState,
          number: pro.licenseNumber,
          expiry: toDateOnly(pro.licenseExpiry),
        },
        methods: verificationMethodsForProfession(pro.professionType),
        docs: pro.verificationDocs.map((d) => ({
          id: d.id,
          type: d.type,
          typeLabel: verificationDocTypeLabel(d.type),
          status: d.status,
          label: d.label,
          createdAt: d.createdAt.toISOString(),
          adminNote: d.adminNote,
        })),
      },
    })
  } catch (error: unknown) {
    console.error('GET /api/v1/pro/verification error', error)
    return jsonFail(500, 'Internal server error')
  }
}
