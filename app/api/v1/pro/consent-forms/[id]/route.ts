// app/api/v1/pro/consent-forms/[id]/route.ts
//
// K14 — retire or restore a consent form. This is the ONLY mutable thing about a
// form: its text lives on append-only versions, so "I don't use this waiver any
// more" has to be a flag on the form rather than an edit to the words. Retiring
// never touches history — records signed against it keep resolving their version.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId))
      return jsonFail(404, 'Not found.')

    const params = await resolveRouteParams(context)
    const formId = pickString(params.id)
    if (!formId) return jsonFail(400, 'Missing form id.')

    const body = await readJsonRecord(req)
    if (typeof body.isActive !== 'boolean') {
      return jsonFail(400, 'isActive must be true or false.')
    }

    const form = await prisma.consentForm.findFirst({
      where: { id: formId, professionalId },
      select: { id: true },
    })
    if (!form) return jsonFail(404, 'Form not found.')

    await prisma.consentForm.update({
      where: { id: form.id },
      data: { isActive: body.isActive },
    })

    return jsonOk({ id: form.id, isActive: body.isActive })
  } catch (e) {
    console.error('PATCH /api/v1/pro/consent-forms/[id] error', e)
    return jsonFail(500, 'Failed to update form.')
  }
}
