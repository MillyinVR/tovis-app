// app/api/pro/clients/[id]/formula/route.ts
//
// Pro-authored formula history (PR4 — flagged, legal-gated). Author-scoped,
// PRIVATE_TO_AUTHOR, NEVER public. 404s entirely when the flag is off so the
// surface stays dark until prod + migration are ready.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { ClientNoteVisibility } from '@prisma/client'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'

export const dynamic = 'force-dynamic'

const SHORT_MAX = 120
const NOTES_MAX = 4000

function parseMinutes(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(24 * 60, Math.round(n))
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId))
      return jsonFail(404, 'Not found.')

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = await readJsonRecord(req)

    const brand = pickString(body.brand)?.slice(0, SHORT_MAX) ?? null
    const developer = pickString(body.developer)?.slice(0, SHORT_MAX) ?? null
    const ratio = pickString(body.ratio)?.slice(0, SHORT_MAX) ?? null
    const processingTimeMinutes = parseMinutes(body.processingTimeMinutes)
    const resultNotes = pickString(body.resultNotes)?.slice(0, NOTES_MAX) ?? null
    const bookingId = pickString(body.bookingId)

    if (!brand && !developer && !ratio && !processingTimeMinutes && !resultNotes) {
      return jsonFail(400, 'Add at least one formula detail.')
    }

    // If tied to a visit, the booking must belong to this client.
    if (bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: bookingId, clientId },
        select: { id: true },
      })
      if (!booking) return jsonFail(400, 'Booking does not belong to this client.')
    }

    const created = await prisma.clientFormulaEntry.create({
      data: {
        clientId,
        professionalId,
        bookingId: bookingId || null,
        brand,
        developer,
        ratio,
        processingTimeMinutes,
        resultNotesEncrypted: encryptedNoteInput(resultNotes),
        visibility: ClientNoteVisibility.PRIVATE_TO_AUTHOR,
      },
      select: { id: true },
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/formula error', e)
    return jsonFail(500, 'Failed to save formula entry.')
  }
}
