// app/api/v1/pro/clients/[id]/do-not-rebook/route.ts
//
// The "do not rebook" flag is an author-scoped DO_NOT_REBOOK note
// (PRIVATE_TO_AUTHOR) — no new table, reusing the typed-note mechanism. PUT sets
// it (replacing any prior reason); DELETE clears it. Both are scoped to the
// authoring pro, so one pro's flag never reaches another pro's chart.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { ClientNoteKind } from '@prisma/client'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'
import { visibilityForNoteKind } from '@/lib/clients/clientNoteKinds'

export const dynamic = 'force-dynamic'

const REASON_MAX = 2000

export async function PUT(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)
    const reason = pickString(body.reason)
    const storedReason = reason ? reason.slice(0, REASON_MAX) : ''

    // Replace any prior flag for this (client, author) pair so it stays singular.
    await prisma.$transaction([
      prisma.clientProfessionalNote.deleteMany({
        where: { clientId, professionalId, kind: ClientNoteKind.DO_NOT_REBOOK },
      }),
      prisma.clientProfessionalNote.create({
        data: {
          clientId,
          professionalId,
          title: null,
          body: storedReason,
          bodyEncrypted: encryptedNoteInput(storedReason),
          kind: ClientNoteKind.DO_NOT_REBOOK,
          visibility: visibilityForNoteKind(ClientNoteKind.DO_NOT_REBOOK),
        },
      }),
    ])

    return jsonOk({ doNotRebook: true }, 200)
  } catch (e) {
    console.error('PUT /api/v1/pro/clients/[id]/do-not-rebook error', e)
    return jsonFail(500, 'Failed to update do-not-rebook flag.')
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    await prisma.clientProfessionalNote.deleteMany({
      where: { clientId, professionalId, kind: ClientNoteKind.DO_NOT_REBOOK },
    })

    return jsonOk({ doNotRebook: false }, 200)
  } catch (e) {
    console.error('DELETE /api/v1/pro/clients/[id]/do-not-rebook error', e)
    return jsonFail(500, 'Failed to clear do-not-rebook flag.')
  }
}
