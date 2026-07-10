// app/api/v1/pro/clients/[id]/technical/route.ts
//
// Read API for the client technical record (PR4 — flagged, legal-gated): the
// authoring pro's formula history + scope-redacted consent/patch-test records +
// the client's photo-release status. The web `/pro/clients/[id]` page loads this
// lazily (only when the technical tab is open); native does the same via this
// endpoint so the server-decrypted free text stays out of the always-fetched
// chart aggregate. Decrypt + access-matrix scoping happen inside the shared
// `loadTechnicalRecord` loader. 404s entirely when the flag is off (surface stays
// dark). PRO-only.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { loadTechnicalRecord } from '@/lib/clients/technicalRecordLoader'

export const dynamic = 'force-dynamic'

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const proId = auth.professionalId

    // Flag-gate first: keep the surface fully dark for non-allowlisted pros.
    if (!isClientTechnicalRecordEnabled(proId))
      return jsonFail(404, 'Not found.')

    const params = await resolveRouteParams(ctx)
    const clientId = pickString(params?.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // Read-sibling privacy choice: don't reveal existence to a pro who can't view.
    const gate = await assertProCanViewClient(proId, clientId)
    if (!gate.ok) return jsonFail(404, 'Client not found.')

    const data = await loadTechnicalRecord(clientId, proId)

    return jsonOk({
      formula: data.formula.map((f) => ({
        id: f.id,
        when: iso(f.when),
        timeZone: f.whenLocationTimeZone,
        serviceName: f.serviceName,
        brand: f.brand,
        developer: f.developer,
        ratio: f.ratio,
        processingTimeMinutes: f.processingTimeMinutes,
        resultNotes: f.resultNotes,
      })),
      consents: data.consents.map((c) => ({
        id: c.id,
        scope: c.scope,
        kind: c.kind,
        when: iso(c.when),
        timeZone: c.whenLocationTimeZone,
        serviceScope: c.serviceScope,
        signedAt: iso(c.signedAt),
        proofMethod: c.proofMethod,
        proofRef: c.proofRef,
        patchTestResult: c.patchTestResult,
        validUntil: iso(c.validUntil),
        notes: c.notes,
        byName: c.byName,
      })),
      photoReleaseStatus: data.photoReleaseStatus,
    })
  } catch (e) {
    console.error('GET /api/v1/pro/clients/[id]/technical error:', e)
    return jsonFail(500, 'Failed to load the technical record.')
  }
}
