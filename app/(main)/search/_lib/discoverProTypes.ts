// app/(main)/search/_lib/discoverProTypes.ts
//
// Shared DTO shapes for the discover/search pro results. These describe the
// `/api/v1/search/pros` response (validated by the type guards in
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
  /**
   * W7: true when `formattedAddress`/`placeId`/`lat`/`lng` above are the pro's
   * REAL ones, because they chose to publish this address. False means the
   * preview is redacted — address null, coordinates coarsened to a ~1.1km grid.
   *
   * Anything that routes a client somewhere must branch on this, never on "is
   * there a coordinate": a coarsened coordinate is still a coordinate.
   */
  isAddressPublic: boolean
  /** W7: SALON / SUITE / MOBILE_BASE. */
  locationType: string | null
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
