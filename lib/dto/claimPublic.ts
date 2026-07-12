// lib/dto/claimPublic.ts
//
// Wire contract for GET /api/v1/public/claim/[token] — the public read that
// backs the native (iOS) claim screen. The web /claim/[token] page is RSC-only,
// so native reads booking context through this JSON endpoint instead.

export type ClaimPublicViewState = 'ready' | 'revoked' | 'already_claimed'

export type ClaimPublicBookingDTO = {
  serviceName: string | null
  /** Pro's public display name (respects nameDisplay); never null. */
  professionalName: string
  /** ISO-8601 instant, or null when the booking has no scheduled time. */
  scheduledFor: string | null
  /** IANA timezone the appointment should be rendered in; clients format it. */
  timeZone: string
  locationLabel: string | null
}

export type ClaimPublicViewResponseDTO = {
  state: ClaimPublicViewState
  /** The name/contact the pro put on file for this claim (invite snapshot). */
  invitedName: string | null
  invitedEmail: string | null
  invitedPhone: string | null
  /**
   * Pro's public display name resolved from the booking OR the invite's own pro
   * (respects nameDisplay); null for a pro-less claim (cold self-serve orphan).
   */
  professionalName: string | null
  /** Booking context, or null for a booking-less claim. */
  booking: ClaimPublicBookingDTO | null
}
