// app/(main)/booking/AvailabilityDrawer/utils/hold.ts

import type { HoldParsed, ServiceLocationType } from '../types'

function normalizeLocationType(v: unknown): ServiceLocationType | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

export function parseHoldResponse(data: any): HoldParsed {
  const hold = data?.hold
  const holdId = typeof hold?.id === 'string' ? hold.id : ''
  const expiresAtIso = typeof hold?.expiresAt === 'string' ? hold.expiresAt : ''
  const scheduledForISO = typeof hold?.scheduledFor === 'string' ? hold.scheduledFor : ''
  const loc = normalizeLocationType(hold?.locationType)

  const holdUntilMs = expiresAtIso ? new Date(expiresAtIso).getTime() : NaN
  if (!holdId || !scheduledForISO || !Number.isFinite(holdUntilMs)) {
    throw new Error('Hold response missing fields.')
  }
  return { holdId, holdUntilMs, scheduledForISO, locationType: loc }
}

export async function deleteHoldById(holdId: string) {
  if (!holdId) return
  await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'DELETE' }).catch(() => {})
}
