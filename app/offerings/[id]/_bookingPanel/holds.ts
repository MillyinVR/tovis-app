// app/offerings/[id]/_bookingPanel/holds.ts
import type { ServiceLocationType } from './types'
import { safeJson } from './api'
import { normalizeLocationType, clearHoldParamsOnly, replaceQuery } from './url'
import type { useRouter, useSearchParams } from 'next/navigation'

export async function deleteHoldById(holdId: string) {
  if (!holdId) return
  try {
    const res = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'DELETE' })
    if (res.status === 404) return
  } catch {
    // ignore
  }
}

export async function clearHoldAndParams(args: {
  holdId: string | null
  router: ReturnType<typeof useRouter>
  searchParams: ReturnType<typeof useSearchParams>
}) {
  const { holdId, router, searchParams } = args
  if (holdId) await deleteHoldById(holdId)
  clearHoldParamsOnly(router, searchParams)
}

export function parseHoldResponse(data: any): {
  holdId: string
  holdUntilMs: number
  scheduledForISO: string
  locationType?: ServiceLocationType | null

  // NEW:
  locationId?: string | null
  locationTimeZone?: string | null
} {
  const hold = data?.hold

  const holdId = typeof hold?.id === 'string' ? hold.id : ''
  const expiresAtIso = typeof hold?.expiresAt === 'string' ? hold.expiresAt : ''
  const scheduledForIso = typeof hold?.scheduledFor === 'string' ? hold.scheduledFor : ''
  const locationType = normalizeLocationType(hold?.locationType)

  // NEW:
  const locationId = typeof hold?.locationId === 'string' ? hold.locationId : null
  const locationTimeZone = typeof hold?.locationTimeZone === 'string' ? hold.locationTimeZone : null

  const holdUntilMs = expiresAtIso ? new Date(expiresAtIso).getTime() : NaN
  if (!holdId || !scheduledForIso || !Number.isFinite(holdUntilMs)) {
    throw new Error('Hold response was missing fields.')
  }

  return {
    holdId,
    holdUntilMs,
    scheduledForISO: scheduledForIso,
    locationType,
    locationId,
    locationTimeZone,
  }
}

export async function createHoldForSelectedSlot(args: {
  offeringId: string
  scheduledFor: string
  locationType: ServiceLocationType

  // NEW:
  locationId?: string | null

  router: ReturnType<typeof useRouter>
  searchParams: ReturnType<typeof useSearchParams>
  previousHoldId?: string | null
}) {
  const { offeringId, scheduledFor, locationType, locationId, router, searchParams, previousHoldId } = args

  if (previousHoldId) await deleteHoldById(previousHoldId)

  const res = await fetch('/api/holds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      offeringId,
      scheduledFor,
      locationType,
      // NEW:
      locationId: locationId || null,
    }),
  })

  const data = await safeJson(res)
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to hold slot.')

  const parsed = parseHoldResponse(data)

  // Keep URL in sync so refresh/back works reliably.
  replaceQuery(router, searchParams, (qs) => {
    qs.set('holdId', parsed.holdId)
    qs.set('holdUntil', String(parsed.holdUntilMs))
    qs.set('scheduledFor', parsed.scheduledForISO)
    qs.set('locationType', locationType)

    // NEW:
    if (parsed.locationId) qs.set('locationId', parsed.locationId)
    else qs.delete('locationId')

    // Keep this legacy param because your BookingPanel falls back to it,
    // and it makes refresh resilient even before availability refetch completes.
    if (parsed.locationTimeZone) qs.set('proTimeZone', parsed.locationTimeZone)
    else qs.delete('proTimeZone')
  })

  return {
    holdId: parsed.holdId,
    holdUntilMs: parsed.holdUntilMs,
    scheduledFor: parsed.scheduledForISO,

    // NEW (useful for callers)
    locationId: parsed.locationId ?? null,
    locationTimeZone: parsed.locationTimeZone ?? null,
  }
}

export async function fetchHoldById(holdId: string) {
  const res = await fetch(`/api/holds/${encodeURIComponent(holdId)}`, { method: 'GET' })
  if (res.status === 404) return { missing: true as const }

  const data = await safeJson(res)
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Failed to load hold (${res.status}).`)

  const parsed = parseHoldResponse(data)

  return {
    missing: false as const,
    scheduledForISO: parsed.scheduledForISO,
    holdUntilMs: parsed.holdUntilMs,
    locationType: parsed.locationType ?? null,

    // NEW:
    locationId: parsed.locationId ?? null,
    locationTimeZone: parsed.locationTimeZone ?? null,
  }
}
