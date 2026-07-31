// app/api/v1/admin/consent-forms/route.ts
//
// K14 / D6 — platform consent templates. Tori's decision was BOTH platform
// templates and pro-authored forms, and the platform TEXT is a legal deliverable
// (Tori/legal must write and stand behind it). This route is the mechanism that
// text lands through; it deliberately ships with no seeded copy, because
// inventing legal wording would be worse than having none.
//
// A template is a ConsentForm with a NULL professionalId. Pros adopt it via
// POST /api/v1/pro/consent-forms { sourceTemplateId }, which copies the current
// version's words into a form of their own.
import { AdminPermissionRole, ClientConsentKind, Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { writeAdminAuditLog } from '@/lib/admin/auditLog'
import { parseConsentFormText } from '@/lib/consentForms/formText'
import { createConsentFormWithFirstVersion } from '@/lib/consentForms/publish'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const permission = await requireAdminPermission({
      adminUserId: auth.user.id,
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
    })
    if (!permission.ok) return permission.res

    const body = await readJsonRecord(req)

    const rawKind = typeof body.kind === 'string' ? body.kind.trim().toUpperCase() : ''
    if (!(Object.values(ClientConsentKind) as string[]).includes(rawKind)) {
      return jsonFail(400, 'A valid form kind is required.')
    }
    const kind = rawKind as ClientConsentKind

    const text = parseConsentFormText({ title: body.title, body: body.body })
    if (!text.ok) return jsonFail(400, text.error)

    const created = await prisma.$transaction((tx) =>
      createConsentFormWithFirstVersion(tx, {
        professionalId: null,
        kind,
        title: text.value.title,
        body: text.value.body,
      }),
    )

    // The template's WORDS are the artifact pros will stand behind in a dispute,
    // so who published them is worth recording. The body itself stays out of the
    // log — it lives, immutably, on the version row.
    await writeAdminAuditLog({
      adminUserId: auth.user.id,
      action: 'consent_form.template_created',
      targetType: 'other',
      targetId: created.formId,
      newValue: { kind, title: text.value.title, version: 1 },
    })

    return jsonOk({ id: created.formId, versionId: created.version.id }, 201)
  } catch (e) {
    console.error('POST /api/v1/admin/consent-forms error', e)
    return jsonFail(500, 'Failed to create template.')
  }
}
