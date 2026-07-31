// app/api/v1/admin/consent-forms/[id]/versions/route.ts
//
// K14 — publish new text for a platform template. Same rule as everywhere else:
// this appends a version, it does not edit one. A pro who already adopted the
// template keeps THEIR copy of the old words (adoption copies the text), so
// re-publishing here can never change what a client already signed.
import { AdminPermissionRole, Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
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
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const params = await resolveRouteParams(context)
    const formId = pickString(params.id)
    if (!formId) return jsonFail(400, 'Missing form id.')

    const body = await readJsonRecord(req)
    const text = parseConsentFormText({ title: body.title, body: body.body })
    if (!text.ok) return jsonFail(400, text.error)

    // professionalId null — an admin publishes platform text, never into a pro's
    // own form.
    const form = await prisma.consentForm.findFirst({
      where: { id: formId, professionalId: null },
      select: {
        id: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { title: true, body: true },
        },
      },
    })
    if (!form) return jsonFail(404, 'Template not found.')

    const current = form.versions[0]
    if (
      current &&
      consentTextsMatch(current.title, text.value.title) &&
      consentTextsMatch(current.body, text.value.body)
    ) {
      return jsonFail(409, 'Nothing changed — this is already the current text.')
    }

    const version = await publishConsentFormVersion(prisma, {
      formId: form.id,
      title: text.value.title,
      body: text.value.body,
      publishedByProfessionalId: null,
    })

    await writeAdminAuditLog({
      adminUserId: auth.user.id,
      action: 'consent_form.template_version_published',
      targetType: 'other',
      targetId: form.id,
      newValue: { title: text.value.title, version: version.version },
    })

    return jsonOk({ id: version.id, version: version.version }, 201)
  } catch (e) {
    if (e instanceof ConsentFormPublishConflictError) {
      return jsonFail(409, e.message)
    }
    console.error('POST /api/v1/admin/consent-forms/[id]/versions error', e)
    return jsonFail(500, 'Failed to publish template version.')
  }
}
