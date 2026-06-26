// app/(main)/search/_lib/discoverProTypes.ts
//
// Shared DTO shapes for the discover/search pro results. These describe the
// `/api/search/pros` response (validated by the type guards in
// SearchMapClient) and are reused by the presentational row/card components so
// the pro shape has a single source.

export type ApiLocationPreview = {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
}

export type ApiPro = {
  id: string
  businessName: string | null
  displayName: string
  handle: string | null
  professionType: string | null
  avatarUrl: string | null
  locationLabel: string | null
  distanceMiles: number | null
  ratingAvg: number | null
  ratingCount: number
  minPrice: number | null
  supportsMobile: boolean
  closestLocation: ApiLocationPreview | null
  primaryLocation: ApiLocationPreview | null
}

/** The location used to plot/route a pro — closest, falling back to primary. */
export function preferredProLocation(pro: ApiPro): ApiLocationPreview | null {
  return pro.closestLocation ?? pro.primaryLocation
}
