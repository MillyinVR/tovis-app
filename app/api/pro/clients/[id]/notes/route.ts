// app/api/pro/clients/[id]/notes/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { ClientNoteVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

const TITLE_MAX = 80
const BODY_MAX = 4000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function POST(req: Request, context: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const params = await Promise.resolve(context.params)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // ✅ single source of truth visibility gate
    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const raw = await req.json().catch(() => null)
    const body = isRecord(raw) ? raw : {}

    const title = pickString(body.title)
    const noteBody = pickString(body.body)

    if (!noteBody) return jsonFail(400, 'Note body is required.')

    const created = await prisma.clientProfessionalNote.create({
      data: {
        clientId,
        professionalId,
        title: title ? title.slice(0, TITLE_MAX) : null,
        body: noteBody.slice(0, BODY_MAX),
        visibility: ClientNoteVisibility.PROFESSIONALS_ONLY,
      },
      select: { id: true },
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/notes error', e)
    return jsonFail(500, 'Failed to create note.')
  }
}