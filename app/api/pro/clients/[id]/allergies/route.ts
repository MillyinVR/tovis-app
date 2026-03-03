// app/api/pro/clients/[id]/allergies/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro, upper } from '@/app/api/_utils'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { AllergySeverity } from '@prisma/client'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Accept old UI words, map to Prisma truth
const SEVERITY_MAP: Record<string, AllergySeverity> = {
  LOW: AllergySeverity.LOW,
  MILD: AllergySeverity.LOW,

  MODERATE: AllergySeverity.MODERATE,

  HIGH: AllergySeverity.HIGH,
  SEVERE: AllergySeverity.HIGH,

  CRITICAL: AllergySeverity.CRITICAL,
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const { id } = await context.params
    const clientId = pickString(id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) return jsonFail(403, 'Forbidden.')

    const raw: unknown = await req.json().catch(() => ({}))
    const body: JsonObject = isRecord(raw) ? raw : {}

    const label = pickString(body.label)
    const description = pickString(body.description)

    const sevKey = upper(body.severity || 'MODERATE')
    const severity = SEVERITY_MAP[sevKey] ?? AllergySeverity.MODERATE

    if (!label) return jsonFail(400, 'Label is required.')

    await prisma.clientAllergy.create({
      data: {
        clientId,
        label,
        description: description ?? null,
        severity,
        recordedByProfessionalId: professionalId,
      },
      select: { id: true },
    })

    return jsonOk({}, 200)
  } catch (e) {
    console.error('POST /api/pro/clients/[id]/allergies error', e)
    return jsonFail(500, 'Failed to add allergy.')
  }
}