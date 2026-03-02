// lib/viewerLocation.ts

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

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

export function normalizeViewerLocation(raw: unknown): ViewerLocation | null {
  if (!isRecord(raw)) return null

  const label = pickString(raw.label)
  const lat = pickNumber(raw.lat)
  const lng = pickNumber(raw.lng)
  const radiusMiles = pickNumber(raw.radiusMiles)
  const updatedAtMs = pickNumber(raw.updatedAtMs)
  const placeId = raw.placeId == null ? null : pickString(raw.placeId)

  if (!label || lat == null || lng == null || radiusMiles == null || updatedAtMs == null) return null

  return {
    label,
    lat,
    lng,
    radiusMiles: clampInt(radiusMiles, VIEWER_RADIUS_MIN_MILES, VIEWER_RADIUS_MAX_MILES),
    updatedAtMs,
    placeId: placeId ?? null,
  }
}

function dispatchViewerLocationEvent(v: ViewerLocation | null) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(VIEWER_LOCATION_EVENT, { detail: v }))
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

export function saveViewerLocation(v: ViewerLocation | null) {
  if (typeof window === 'undefined') return
  try {
    if (!v) {
      window.localStorage.removeItem(VIEWER_LOCATION_STORAGE_KEY)
      dispatchViewerLocationEvent(null)
      return
    }
    window.localStorage.setItem(VIEWER_LOCATION_STORAGE_KEY, JSON.stringify(v))
    dispatchViewerLocationEvent(v)
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
  const v = loadViewerLocation()
  if (!v) return null
  return { lat: v.lat, lng: v.lng, radiusMiles: v.radiusMiles, placeId: v.placeId }
}

/**
 * Subscribe to viewer location changes.
 * Fires when:
 * - setViewerLocation/clearViewerLocation/saveViewerLocation is called
 * - localStorage changes in another tab (storage event)
 *
 * Returns an unsubscribe function.
 */
export function subscribeViewerLocation(onChange: (v: ViewerLocation | null) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onCustomEvent = (e: Event) => {
    // Local, justified cast: we emit CustomEvent.detail in dispatchViewerLocationEvent.
    const ce = e as CustomEvent<unknown>
    const detail = ce.detail

    if (detail == null) {
      onChange(null)
      return
    }

    const normalized = normalizeViewerLocation(detail)
    if (normalized) onChange(normalized)
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== VIEWER_LOCATION_STORAGE_KEY) return
    onChange(loadViewerLocation())
  }

  window.addEventListener(VIEWER_LOCATION_EVENT, onCustomEvent as EventListener)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(VIEWER_LOCATION_EVENT, onCustomEvent as EventListener)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Helper for wiring into AvailabilityDrawer context cleanly.
 */
export function viewerLocationToDrawerContextFields(v: ViewerLocation | null) {
  if (!v) return {}
  return {
    viewerLat: v.lat,
    viewerLng: v.lng,
    viewerRadiusMiles: v.radiusMiles,
    viewerPlaceId: v.placeId,
    viewerLocationLabel: v.label,
  } as const
}