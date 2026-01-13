// app/offerings/[id]/_bookingPanel/availability.ts
import { safeJson } from './api'
import type { ServiceLocationType } from './types'

type FetchDayAvailabilityArgs = {
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType
  ymd: string
  locationId?: string | null

  /**
   * Optional client preferences.
   * If omitted, the API uses its own defaults (recommended).
   */
  stepMinutes?: number | null

  /**
   * "Don't allow booking within X minutes from now"
   * API uses this as lead time. If omitted, API default applies.
   */
  leadTimeMinutes?: number | null
}

function clampInt(n: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function asFiniteInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export async function fetchDayAvailability(args: FetchDayAvailabilityArgs) {
  const qs = new URLSearchParams()
  qs.set('professionalId', args.professionalId)
  qs.set('serviceId', args.serviceId)
  qs.set('locationType', args.locationType)
  qs.set('date', args.ymd)

  // Only send overrides if the client explicitly asked for them.
  // Otherwise, let the API use server truth (location settings + sane defaults).
  const step = asFiniteInt(args.stepMinutes)
  if (step != null) qs.set('stepMinutes', String(clampInt(step, 5, 60)))

  const lead = asFiniteInt(args.leadTimeMinutes)
  if (lead != null) qs.set('leadMinutes', String(clampInt(lead, 0, 240)))

  if (args.locationId) qs.set('locationId', args.locationId)

  const res = await fetch(`/api/availability/day?${qs.toString()}`)
  const data = await safeJson(res)

  if (!res.ok) throw new Error(data?.error || `Failed to load day availability (${res.status}).`)
  if (!data?.ok) throw new Error(data?.error || 'Failed to load day availability.')

  const timeZone = typeof data?.timeZone === 'string' ? data.timeZone : null
  const locationId = typeof data?.locationId === 'string' ? data.locationId : null
  const slots = Array.isArray(data?.slots) ? data.slots : []

  // Useful for UI, but optional. Returned by the updated API.
  const stepMinutes = asFiniteInt(data?.stepMinutes)
  const leadTimeMinutes = asFiniteInt(data?.leadTimeMinutes)
  const adjacencyBufferMinutes = asFiniteInt(data?.adjacencyBufferMinutes)

  return {
    timeZone,
    locationId,
    slots,

    // Optional metadata (UI can ignore if it doesn't care)
    meta: {
      stepMinutes: stepMinutes != null ? clampInt(stepMinutes, 5, 60) : null,
      leadTimeMinutes: leadTimeMinutes != null ? clampInt(leadTimeMinutes, 0, 240) : null,
      adjacencyBufferMinutes:
        adjacencyBufferMinutes != null ? clampInt(adjacencyBufferMinutes, 0, 120) : null,
    },
  }
}
