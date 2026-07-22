// lib/lastMinute/openingDuration.ts
//
// How long a last-minute opening actually occupies the pro's calendar.
//
// One opening carries several services and the client picks ONE at claim time,
// so the window the pro is promising is the LONGEST of them — the conservative
// choice `createLastMinuteOpening` validates before publishing the row. The
// read-side liveness check (`lib/booking/storedSlotLiveness.ts`) has to ask
// about the same window, or an opening could be published against one duration
// and re-checked against another.

import { clampInt } from '@/lib/pick'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import { ServiceLocationType } from '@prisma/client'

/** The shortest window an opening can occupy, matching `checkSlotReadiness`. */
export const MIN_OPENING_DURATION_MINUTES = 15

export type OpeningDurationSource = {
  salonDurationMinutes: number | null
  mobileDurationMinutes: number | null
  /** The service's own default, used when the offering leaves the mode blank. */
  defaultDurationMinutes: number | null
}

export function resolveOpeningModeDurationMinutes(
  source: OpeningDurationSource,
  locationType: ServiceLocationType,
): number {
  const raw =
    locationType === ServiceLocationType.MOBILE
      ? source.mobileDurationMinutes
      : source.salonDurationMinutes

  const fallback = source.defaultDurationMinutes || 60
  const picked =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback

  return clampInt(picked, MIN_OPENING_DURATION_MINUTES, MAX_SLOT_DURATION_MINUTES)
}

/**
 * The longest of an opening's services, i.e. the window it promises. Returns
 * null for an opening with no usable service — a row with nothing claimable,
 * which the feeds already drop.
 */
export function resolveOpeningWindowMinutes(
  sources: readonly OpeningDurationSource[],
  locationType: ServiceLocationType,
): number | null {
  if (sources.length === 0) return null

  return sources.reduce(
    (longest, source) =>
      Math.max(longest, resolveOpeningModeDurationMinutes(source, locationType)),
    MIN_OPENING_DURATION_MINUTES,
  )
}
