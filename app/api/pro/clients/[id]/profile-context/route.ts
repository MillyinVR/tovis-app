// app/api/pro/clients/[id]/profile-context/route.ts
//
// Pro-captured chart context on the ClientProfile: occupation (encrypted-at-rest)
// and a social handle for tagging (distinct from the client's own creator handle).
// Both are nullable; sending null/blank clears the field.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'

export const dynamic = 'force-dynamic'

const OCCUPATION_MAX = 200
const HANDLE_MAX = 120

function normalizeSocialHandle(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^@+/, '')
  if (!trimmed) return null
  return trimmed.slice(0, HANDLE_MAX)
}

export async function PATCH(req: Request, context: RouteContext) {
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

    const occupationRaw = pickString(body.occupation)
    const occupation = occupationRaw ? occupationRaw.slice(0, OCCUPATION_MAX) : ''
    const socialHandle = normalizeSocialHandle(pickString(body.proCapturedSocialHandle))

    await prisma.clientProfile.update({
      where: { id: clientId },
      data: {
        // Encrypted-only (no plaintext column); blank clears the envelope.
        occupationEncrypted: encryptedNoteInput(occupation),
        proCapturedSocialHandle: socialHandle,
      },
      select: { id: true },
    })

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/clients/[id]/profile-context error', e)
    return jsonFail(500, 'Failed to update profile context.')
  }
}
