// app/api/pro/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/**
 * STRICT timezone input:
 * - undefined => no change
 * - null or "" => clear (set null)
 * - valid IANA string => set trimmed string
 * - anything else => 400
 *
 * Never "sanitize" invalid input into UTC here.
 * If the user sends garbage, we reject it.
 */
function normalizeTimeZonePatch(
  raw: unknown,
): { ok: true; value?: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined } // no change

  if (raw === null) return { ok: true, value: null } // clear

  const s = pickString(raw)
  if (s === null) {
    return { ok: false, error: 'Invalid timeZone. Provide a valid IANA timezone string, null, or omit the field.' }
  }

  const trimmed = s.trim()

  // allow clear with empty string
  if (!trimmed) return { ok: true, value: null }

  if (!isValidIanaTimeZone(trimmed)) {
    return { ok: false, error: 'Invalid timeZone (must be a valid IANA timezone, e.g. "America/New_York").' }
  }

  return { ok: true, value: trimmed }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proProfileId = auth.professionalId

    const body = await req.json().catch(() => ({} as any))

    const autoAcceptBookings = pickBoolean(body?.autoAcceptBookings)

    const tzResult = normalizeTimeZonePatch(body?.timeZone)
    if (!tzResult.ok) return jsonFail(400, tzResult.error)
    const timeZone = tzResult.value // undefined=no change, null=clear, string=set

    if (autoAcceptBookings === undefined && timeZone === undefined) {
      return jsonFail(400, 'Nothing to update. Provide autoAcceptBookings (boolean) and/or timeZone.')
    }

    const professionalProfile = await prisma.professionalProfile.update({
      where: { id: proProfileId },
      data: {
        ...(autoAcceptBookings !== undefined ? { autoAcceptBookings } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}), // ✅ can set null
      },
      select: {
        id: true,
        autoAcceptBookings: true,
        timeZone: true,
      },
    })

    return jsonOk({ ok: true, professionalProfile }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/settings error:', e)
    return jsonFail(500, 'Failed to update settings.')
  }
}
