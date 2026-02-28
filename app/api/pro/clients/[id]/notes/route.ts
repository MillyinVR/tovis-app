// app/api/pro/clients/[id]/notes/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { assertProCanViewClient } from '@/lib/clientVisibility'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

const TITLE_MAX = 80
const BODY_MAX = 4000

export async function POST(req: Request, context: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await Promise.resolve((context as any).params)
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // ✅ single source of truth visibility gate
    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = (await req.json().catch(() => ({}))) as any
    const title = pickString(body?.title)
    const noteBody = pickString(body?.body)

    if (!noteBody) return jsonFail(400, 'Note body is required.')

    await prisma.clientProfessionalNote.create({
      data: {
        clientId,
        professionalId,
        title: title ? title.slice(0, TITLE_MAX) : null,
        body: noteBody.slice(0, BODY_MAX),
        visibility: 'PROFESSIONALS_ONLY' as any,
      } as any,
      select: { id: true },
    })

    return jsonOk({ ok: true }, 201)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/notes error', e)
    return jsonFail(500, 'Failed to create note.')
  }
}
