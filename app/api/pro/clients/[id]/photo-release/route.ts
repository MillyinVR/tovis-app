// app/api/pro/clients/[id]/photo-release/route.ts
//
// Photo-release consent state on the ClientProfile (PR4 — flagged, legal-gated).
// This records the client's standing release decision; it does NOT change the
// public-sharing path, which remains review-promotion only (publicShareGuard).
// 404s when the flag is off.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { PhotoReleaseStatus } from '@prisma/client'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'

export const dynamic = 'force-dynamic'

function asStatus(value: unknown): PhotoReleaseStatus | null {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return (Object.values(PhotoReleaseStatus) as string[]).includes(v)
    ? (v as PhotoReleaseStatus)
    : null
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    if (!isClientTechnicalRecordEnabled()) return jsonFail(404, 'Not found.')

    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)
    const status = asStatus(body.status)
    if (!status) return jsonFail(400, 'A valid release status is required.')

    const cleared = status === PhotoReleaseStatus.NOT_SET

    await prisma.clientProfile.update({
      where: { id: clientId },
      data: {
        photoReleaseStatus: status,
        photoReleaseAt: cleared ? null : new Date(),
        photoReleaseByProfessionalId: cleared ? null : professionalId,
      },
      select: { id: true },
    })

    return jsonOk({ status }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/clients/[id]/photo-release error', e)
    return jsonFail(500, 'Failed to update photo-release status.')
  }
}
