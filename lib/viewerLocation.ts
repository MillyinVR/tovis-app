// lib/viewerLocation.ts
import { isRecord } from '@/lib/guards'
import { clampInt, pickNumber, pickString } from '@/lib/pick'

export type ViewerLocation = {
  label: string
  placeId: string | null
  lat: number
  lng: number
  radiusMiles: number
  updatedAtMs: number
}

export type ViewerParams = {
  lat: number
  lng: number
  radiusMiles: number | null
  placeId: string | null
}

export const VIEWER_LOCATION_STORAGE_KEY = 'tovis.viewerLocation.v1'
export const VIEWER_LOCATION_EVENT = 'tovis:viewerLocation'

export const VIEWER_RADIUS_MIN_MILES = 5
export const VIEWER_RADIUS_MAX_MILES = 50
export const VIEWER_RADIUS_DEFAULT_MILES = 15

export function normalizeViewerLocation(raw: unknown): ViewerLocation | null {
  if (!isRecord(raw)) return null

  const label = pickString(raw.label)
  const lat = pickNumber(raw.lat)
  const lng = pickNumber(raw.lng)
  const radiusMiles = pickNumber(raw.radiusMiles)
  const updatedAtMs = pickNumber(raw.updatedAtMs)

  const placeId =
    raw.placeId == null ? null : pickString(raw.placeId)

  if (
    !label ||
    lat == null ||
    lng == null ||
    radiusMiles == null ||
    updatedAtMs == null
  ) {
    return null
  }

  return {
    label,
    lat,
    lng,
    radiusMiles: clampInt(
      radiusMiles,
      VIEWER_RADIUS_MIN_MILES,
      VIEWER_RADIUS_MAX_MILES,
    ),
    updatedAtMs,
    placeId: placeId ?? null,
  }
}

function dispatchViewerLocationEvent(value: ViewerLocation | null) {
  if (typeof window === 'undefined') return

  try {
    window.dispatchEvent(
      new CustomEvent<ViewerLocation | null>(VIEWER_LOCATION_EVENT, {
        detail: value,
      }),
    )
  } catch {
    // ignore
  }
}

export function loadViewerLocation(): ViewerLocation | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(VIEWER_LOCATION_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    return normalizeViewerLocation(parsed)
  } catch {
    return null
  }
}

export function saveViewerLocation(value: ViewerLocation | null) {
  if (typeof window === 'undefined') return

  try {
    if (!value) {
      window.localStorage.removeItem(VIEWER_LOCATION_STORAGE_KEY)
      dispatchViewerLocationEvent(null)
      return
    }

    window.localStorage.setItem(
      VIEWER_LOCATION_STORAGE_KEY,
      JSON.stringify(value),
    )

    dispatchViewerLocationEvent(value)
  } catch {
    // ignore
  }
}

export function setViewerLocation(args: {
  label: string
  lat: number
  lng: number
  radiusMiles?: number | null
  placeId?: string | null
}): ViewerLocation {
  const next: ViewerLocation = {
    label: args.label.trim() || 'Location',
    lat: args.lat,
    lng: args.lng,
    radiusMiles: clampInt(
      typeof args.radiusMiles === 'number' && Number.isFinite(args.radiusMiles)
        ? args.radiusMiles
        : VIEWER_RADIUS_DEFAULT_MILES,
      VIEWER_RADIUS_MIN_MILES,
      VIEWER_RADIUS_MAX_MILES,
    ),
    updatedAtMs: Date.now(),
    placeId: args.placeId?.trim() ? args.placeId.trim() : null,
  }

  saveViewerLocation(next)
  return next
}

export function clearViewerLocation() {
  saveViewerLocation(null)
}

export function getViewerParams(): ViewerParams | null {
  const value = loadViewerLocation()
  if (!value) return null

  return {
    lat: value.lat,
    lng: value.lng,
    radiusMiles: value.radiusMiles,
    placeId: value.placeId,
  }
}

/**
 * Subscribe to viewer location changes.
 * Fires when:
 * - saveViewerLocation / setViewerLocation / clearViewerLocation is called
 * - localStorage changes in another tab
 */
export function subscribeViewerLocation(
  onChange: (value: ViewerLocation | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const onCustomEvent = (event: Event) => {
    if (!(event instanceof CustomEvent)) return

    const normalized = normalizeViewerLocation(event.detail)
    onChange(normalized)
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== VIEWER_LOCATION_STORAGE_KEY) return
    onChange(loadViewerLocation())
  }

  window.addEventListener(VIEWER_LOCATION_EVENT, onCustomEvent)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(VIEWER_LOCATION_EVENT, onCustomEvent)
    window.removeEventListener('storage', onStorage)
  }
}

export function viewerLocationToDrawerContextFields(
  value: ViewerLocation | null,
) {
  if (!value) return {}

  return {
    viewerLat: value.lat,
    viewerLng: value.lng,
    viewerRadiusMiles: value.radiusMiles,
    viewerPlaceId: value.placeId,
    viewerLocationLabel: value.label,
  } as const
}