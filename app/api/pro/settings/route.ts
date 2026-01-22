// app/api/pro/settings/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function pickNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s : undefined
}

function normalizeTimeZoneInput(raw: unknown): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined }

  const candidate = pickNonEmptyString(raw)
  if (!candidate) {
    return { ok: false, error: 'Invalid timeZone (must be a non-empty IANA timezone string).' }
  }

  const cleaned = sanitizeTimeZone(candidate, 'UTC') || ''
  if (!cleaned || !isValidIanaTimeZone(cleaned)) {
    return { ok: false, error: 'Invalid timeZone (must be a valid IANA timezone, e.g. "America/Los_Angeles").' }
  }

  return { ok: true, value: cleaned }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proProfileId = auth.professionalId

    const body = await req.json().catch(() => ({} as any))

    const autoAcceptBookings = pickBoolean(body?.autoAcceptBookings)

    const tzResult = normalizeTimeZoneInput(body?.timeZone)
    if (!tzResult.ok) return jsonFail(400, tzResult.error)
    const timeZone = tzResult.value // undefined => no change

    if (autoAcceptBookings === undefined && timeZone === undefined) {
      return jsonFail(400, 'Nothing to update. Provide autoAcceptBookings (boolean) and/or timeZone (IANA string).')
    }

    const professionalProfile = await prisma.professionalProfile.update({
      where: { id: proProfileId },
      data: {
        ...(autoAcceptBookings !== undefined ? { autoAcceptBookings } : {}),
        ...(timeZone !== undefined ? { timeZone } : {}),
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
