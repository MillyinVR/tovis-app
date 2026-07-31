// app/api/v1/pro/consent-forms/[id]/versions/route.ts
//
// K14 — "editing" a consent form. There is no edit: this publishes version n+1
// and leaves every earlier version exactly as it was, because a client who
// signed v1 agreed to v1's words and nothing here may rewrite that.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import {
  consentTextsMatch,
  parseConsentFormText,
} from '@/lib/consentForms/formText'
import {
  ConsentFormPublishConflictError,
  publishConsentFormVersion,
} from '@/lib/consentForms/publish'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, context: RouteContext) {
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
    const text = parseConsentFormText({ title: body.title, body: body.body })
    if (!text.ok) return jsonFail(400, text.error)

    // Ownership, not visibility: a pro can READ a platform template (that is how
    // they adopt it) but publishing into it would put their words under the
    // platform's name on every other pro's library.
    const form = await prisma.consentForm.findFirst({
      where: { id: formId, professionalId },
      select: {
        id: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { title: true, body: true },
        },
      },
    })
    if (!form) return jsonFail(404, 'Form not found.')

    const current = form.versions[0]
    if (
      current &&
      consentTextsMatch(current.title, text.value.title) &&
      consentTextsMatch(current.body, text.value.body)
    ) {
      // Publishing an identical version would grow the history without changing
      // anything a client could read.
      return jsonFail(409, 'Nothing changed — this is already the current text.')
    }

    const version = await publishConsentFormVersion(prisma, {
      formId: form.id,
      title: text.value.title,
      body: text.value.body,
      publishedByProfessionalId: professionalId,
    })

    return jsonOk({ id: version.id, version: version.version }, 201)
  } catch (e) {
    if (e instanceof ConsentFormPublishConflictError) {
      return jsonFail(409, e.message)
    }
    console.error('POST /api/v1/pro/consent-forms/[id]/versions error', e)
    return jsonFail(500, 'Failed to publish form version.')
  }
}
