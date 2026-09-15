// app/api/v1/pro/consent-forms/route.ts
//
// K14 — a pro's consent form library. Create a form from scratch, or adopt a
// platform template (D6: both origins exist from day one).
//
// Gated by the same `isClientTechnicalRecordEnabled` allowlist that already
// guards the consent surface these forms feed — deliberately NOT a second flag.
// Consent forms are part of the technical record; two switches for one feature
// is how a half-lit surface reaches a real pro.
import { ClientConsentKind } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'
import { parseConsentFormText } from '@/lib/consentForms/formText'
import { loadProConsentFormLibrary } from '@/lib/consentForms/loader'
import { createConsentFormWithFirstVersion } from '@/lib/consentForms/publish'
import {
  buildProConsentFormLibraryDTO,
  type ProConsentFormLibraryResponseDTO,
} from '@/lib/dto/proConsentForms'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * The pro's own forms plus the platform templates on offer — the read half of
 * this library, which shipped with three write routes and none.
 *
 * `/pro/forms` renders the SAME `loadProConsentFormLibrary` output server-side,
 * so the two surfaces cannot disagree about what a form is, what it was based
 * on, or how many records already point at it. That reuse is the whole design:
 * the loader was extracted from the page for exactly this route.
 */
export async function GET() {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    // Same gate, same 404 as every write route below: with the technical record
    // off for this pro, the library does not exist rather than being empty.
    if (!isClientTechnicalRecordEnabled(professionalId))
      return jsonFail(404, 'Not found.')

    const library = await loadProConsentFormLibrary(professionalId)
    const response: ProConsentFormLibraryResponseDTO =
      buildProConsentFormLibraryDTO(library)

    return jsonOk(response)
  } catch (e) {
    console.error('GET /api/v1/pro/consent-forms error', e)
    return jsonFail(500, 'Failed to load forms.')
  }
}

function asConsentKind(value: unknown): ClientConsentKind | null {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return (Object.values(ClientConsentKind) as string[]).includes(v)
    ? (v as ClientConsentKind)
    : null
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId))
      return jsonFail(404, 'Not found.')

    const body = await readJsonRecord(req)
    const sourceTemplateId = pickString(body.sourceTemplateId)

    if (sourceTemplateId) {
      return adoptTemplate({ professionalId, sourceTemplateId })
    }

    const kind = asConsentKind(body.kind)
    if (!kind) return jsonFail(400, 'A valid form kind is required.')

    const text = parseConsentFormText({ title: body.title, body: body.body })
    if (!text.ok) return jsonFail(400, text.error)

    const created = await prisma.$transaction((tx) =>
      createConsentFormWithFirstVersion(tx, {
        professionalId,
        kind,
        title: text.value.title,
        body: text.value.body,
      }),
    )

    return jsonOk({ id: created.formId, versionId: created.version.id }, 201)
  } catch (e) {
    console.error('POST /api/v1/pro/consent-forms error', e)
    return jsonFail(500, 'Failed to save form.')
  }
}

/**
 * Adopt a platform template into the pro's own library: a NEW form of their own,
 * carrying the template's current text verbatim and pointing back at the exact
 * template VERSION it came from. Copying rather than referencing is what lets the
 * pro edit it afterwards without touching the platform's text — and the
 * provenance columns are what keep "edited" distinguishable from "adopted as-is".
 */
async function adoptTemplate(args: {
  professionalId: string
  sourceTemplateId: string
}): Promise<Response> {
  const template = await prisma.consentForm.findFirst({
    // professionalId null = platform-owned. A pro cannot adopt another pro's
    // private form, and cannot adopt a retired template.
    where: { id: args.sourceTemplateId, professionalId: null, isActive: true },
    select: {
      id: true,
      kind: true,
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, title: true, body: true },
      },
    },
  })

  if (!template) return jsonFail(404, 'Template not found.')

  const source = template.versions[0]
  // A template with no published text is not adoptable: the pro would end up
  // with an empty waiver that reads as a real one.
  if (!source) return jsonFail(409, 'That template has no published text yet.')

  const existing = await prisma.consentForm.findFirst({
    where: { professionalId: args.professionalId, sourceTemplateId: template.id },
    select: { id: true },
  })
  if (existing) {
    return jsonFail(409, 'You have already added this template.')
  }

  const created = await prisma.$transaction((tx) =>
    createConsentFormWithFirstVersion(tx, {
      professionalId: args.professionalId,
      kind: template.kind,
      title: source.title,
      body: source.body,
      sourceTemplateId: template.id,
      sourceTemplateVersion: source,
    }),
  )

  return jsonOk({ id: created.formId, versionId: created.version.id }, 201)
}
