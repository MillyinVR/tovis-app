// app/api/pro/clients/[id]/allergies/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { assertProCanViewClient } from '@/lib/clientVisibility'

export const dynamic = 'force-dynamic'

const ALLOWED_SEVERITY = new Set(['MILD', 'MODERATE', 'SEVERE'])

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id } = await context.params
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    // ✅ single source of truth visibility gate
    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const body = (await req.json().catch(() => ({}))) as any
    const label = pickString(body?.label)
    const description = pickString(body?.description)
    const severityRaw = upper(body?.severity || 'MODERATE')
    const severity = ALLOWED_SEVERITY.has(severityRaw) ? severityRaw : 'MODERATE'

    if (!label) return jsonFail(400, 'Label is required.')

    await prisma.clientAllergy.create({
      data: {
        clientId,
        label,
        description: description ?? null,
        severity: severity as any,
        recordedByProfessionalId: professionalId,
      } as any,
      select: { id: true },
    })

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/allergies error', e)
    return jsonFail(500, 'Failed to add allergy.')
  }
}
