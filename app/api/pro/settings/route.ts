// app/api/pro/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * STRICT timezone input:
 * - undefined => no change
 * - null or "" => clear (set null)
 * - valid IANA string => set trimmed string
 * - anything else => 400
 */
function normalizeTimeZonePatch(
  raw: unknown,
): { ok: true; value?: string | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined } // no change
  if (raw === null) return { ok: true, value: null } // clear

  const s = pickString(raw)
  if (s === undefined) {
    return { ok: false, error: 'Invalid timeZone. Provide a valid IANA timezone string, null, or omit the field.' }
  }

  const trimmed = s.trim()
  if (!trimmed) return { ok: true, value: null } // allow clear with empty string

  if (!isValidIanaTimeZone(trimmed)) {
    return { ok: false, error: 'Invalid timeZone (must be a valid IANA timezone, e.g. "America/New_York").' }
  }

  return { ok: true, value: trimmed }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as unknown
    if (!isPlainObject(body)) return jsonFail(400, 'Invalid body.')

    const autoAcceptBookings = pickBoolean(body.autoAcceptBookings)

    const tzResult = normalizeTimeZonePatch(body.timeZone)
    if (!tzResult.ok) return jsonFail(400, tzResult.error)
    const timeZone = tzResult.value // undefined=no change, null=clear, string=set

    if (autoAcceptBookings === undefined && timeZone === undefined) {
      return jsonFail(400, 'Nothing to update. Provide autoAcceptBookings (boolean) and/or timeZone.')
    }

    const professionalProfile = await prisma.professionalProfile.update({
      where: { id: professionalId },
      data: {
        ...(autoAcceptBookings !== undefined ? { autoAcceptBookings } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
      },
      select: { id: true, autoAcceptBookings: true, timeZone: true },
    })

    return jsonOk({ ok: true, professionalProfile }, 200)
  } catch (e) {
    console.error('PATCH /api/pro/settings error:', e)
    return jsonFail(500, 'Failed to update settings.')
  }
}