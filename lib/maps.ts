// lib/maps.ts

function isApplePlatform() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
  const isIPadOS = /Macintosh/i.test(ua) && (navigator as any).maxTouchPoints > 1
  return isIOS || isIPadOS
}

export type MapsLocationInput = {
  placeId?: string | null
  lat?: number | null
  lng?: number | null
  formattedAddress?: string | null
  name?: string | null
}

/**
 * "Open in Maps" (search/place view)
 * - Great for "view this place"
 * - Not guaranteed to start navigation automatically
 */
export function mapsHrefFromLocation(input: MapsLocationInput) {
  const placeId = (input.placeId || '').trim()
  if (placeId) {
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`
  }

  const lat = typeof input.lat === 'number' ? input.lat : null
  const lng = typeof input.lng === 'number' ? input.lng : null
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
  }

  const addr = (input.formattedAddress || '').trim()
  const label = (input.name || '').trim()
  const q = label && addr ? `${label} ${addr}` : addr || label
  if (q) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }

  return null
}

/**
 * Turn-by-turn navigation (directions)
 * - iOS/iPadOS: Apple Maps (feels native in Safari)
 * - Else: Google Maps directions
 */
export function directionsHrefFromLocation(input: MapsLocationInput) {
  const lat = typeof input.lat === 'number' ? input.lat : null
  const lng = typeof input.lng === 'number' ? input.lng : null
  const placeId = (input.placeId || '').trim()
  const addr = (input.formattedAddress || '').trim()
  const name = (input.name || '').trim()

  // ✅ Best: coordinates
  if (lat != null && lng != null) {
    const dest = `${lat},${lng}`

    if (isApplePlatform()) {
      // Apple Maps: daddr = destination
      return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=d`
    }

    // Google Maps directions
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
  }

  // ✅ Next best: placeId (Google only)
  if (placeId) {
    return `https://www.google.com/maps/dir/?api=1&destination_place_id=${encodeURIComponent(placeId)}`
  }

  // ✅ Fallback: address string
  const q = addr || name
  if (q) {
    if (isApplePlatform()) {
      return `https://maps.apple.com/?daddr=${encodeURIComponent(q)}&dirflg=d`
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
  }

  return null
}
