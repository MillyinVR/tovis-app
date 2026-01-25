// lib/maps.ts

export function mapsHrefFromLocation(input: {
  placeId?: string | null
  lat?: number | null
  lng?: number | null
  formattedAddress?: string | null
  name?: string | null
}) {
  const placeId = (input.placeId || '').trim()
  if (placeId) {
    // Works great on mobile/desktop
    return `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`
  }

  const lat = typeof input.lat === 'number' ? input.lat : null
  const lng = typeof input.lng === 'number' ? input.lng : null
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
  }

  const addr = (input.formattedAddress || '').trim()
  const label = (input.name || '').trim()
  const q = (label && addr) ? `${label} ${addr}` : (addr || label)
  if (q) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
  }

  return null
}
