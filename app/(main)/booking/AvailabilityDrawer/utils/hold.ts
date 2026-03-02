// app/(main)/booking/AvailabilityDrawer/utils/hold.ts
import type { HoldParsed, ServiceLocationType } from '../types'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = pickString(v)?.toUpperCase() ?? ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

/**
 * Parses POST /api/holds response:
 * jsonOk({ hold: { id, scheduledFor, expiresAt, locationType, ... } }, status)
 */
export function parseHoldResponse(data: unknown): HoldParsed {
  if (!isRecord(data) || data.ok !== true) {
    throw new Error('Hold response malformed.')
  }

  const holdRaw = (data as Record<string, unknown>).hold
  if (!isRecord(holdRaw)) {
    throw new Error('Hold response missing hold.')
  }

  const holdId = pickString(holdRaw.id)
  const expiresAtIso = pickString(holdRaw.expiresAt)
  const scheduledForISO = pickString(holdRaw.scheduledFor)
  const loc = normalizeLocationType(holdRaw.locationType)

  if (!holdId || !expiresAtIso || !scheduledForISO) {
    throw new Error('Hold response missing fields.')
  }

  const holdUntilMs = new Date(expiresAtIso).getTime()
  const scheduledMs = new Date(scheduledForISO).getTime()

  if (!Number.isFinite(holdUntilMs) || !Number.isFinite(scheduledMs)) {
    throw new Error('Hold response has invalid dates.')
  }

  return { holdId, holdUntilMs, scheduledForISO, locationType: loc }
}

export async function deleteHoldById(holdId: string) {
  const id = (holdId || '').trim()
  if (!id) return
  try {
    await fetch(`/api/holds/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' })
  } catch {
    // intentionally swallow; delete is best-effort
  }
}