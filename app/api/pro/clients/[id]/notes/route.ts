// app/api/pro/clients/[id]/notes/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'
import {
  normalizeAuthorableNoteKind,
  visibilityForNoteKind,
} from '@/lib/clients/clientNoteKinds'

export const dynamic = 'force-dynamic'

const TITLE_MAX = 80
const BODY_MAX = 4000

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // ✅ single source of truth visibility gate
    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)

    const title = pickString(body.title)
    const noteBody = pickString(body.body)

    if (!noteBody) return jsonFail(400, 'Note body is required.')

    // Kind drives visibility (visibilityForNoteKind is the single policy point).
    // DO_NOT_REBOOK is not authorable here — it collapses to GENERAL.
    const kind = normalizeAuthorableNoteKind(body.kind)

    // Encrypt the exact stored (post-slice) values so plaintext and envelope match.
    const storedTitle = title ? title.slice(0, TITLE_MAX) : null
    const storedBody = noteBody.slice(0, BODY_MAX)

    const created = await prisma.clientProfessionalNote.create({
      data: {
        clientId,
        professionalId,
        title: storedTitle,
        body: storedBody,
        // Dual-write: plaintext (above) + AEAD envelope during burn-in.
        titleEncrypted: encryptedNoteInput(storedTitle),
        bodyEncrypted: encryptedNoteInput(storedBody),
        kind,
        visibility: visibilityForNoteKind(kind),
      },
      select: { id: true },
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/notes error', e)
    return jsonFail(500, 'Failed to create note.')
  }
}