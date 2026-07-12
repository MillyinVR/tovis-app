// lib/clients/claimPublicView.ts
//
// Shared, presentation-safe derivations of a claim invite's booking context,
// used by BOTH the web /claim/[token] page (RSC) and the native read API
// GET /api/v1/public/claim/[token] so the two never drift.

import {
  formatProfessionalPublicDisplayName,
  pickProfessionalPublicDisplayName,
} from '@/lib/privacy/professionalDisplayName'
import { sanitizeTimeZone } from '@/lib/timeZone'

import type { ClientClaimLinkRow } from './clientClaimLinks'

export type ClaimPublicBooking = NonNullable<ClientClaimLinkRow['booking']>

/**
 * The pro's public display name for a claim invite, resolved from the booking's
 * pro when present else the invite's own (top-level) pro — null when the invite
 * is pro-less (a cold self-serve orphan). Use this for the booking-less header.
 */
export function resolveClaimProfessionalName(
  link: Pick<ClientClaimLinkRow, 'professional' | 'booking'>,
): string | null {
  return pickProfessionalPublicDisplayName(
    link.booking?.professional ?? link.professional,
  )
}

/**
 * A human location label for the booking, preferring the most specific known
 * value: full address → location name → city/state → the pro's profile location.
 */
export function buildClaimLocationLabel(
  booking: ClaimPublicBooking,
): string | null {
  const formattedAddress = booking.location?.formattedAddress?.trim()
  if (formattedAddress) return formattedAddress

  const locationName = booking.location?.name?.trim()
  if (locationName) return locationName

  const cityState = [booking.location?.city, booking.location?.state]
    .filter(Boolean)
    .join(', ')
    .trim()

  if (cityState) return cityState

  const professionalLocation = booking.professional?.location?.trim()
  if (professionalLocation) return professionalLocation

  return null
}

/**
 * The pro's public display name for the booking, resolved through the shared
 * privacy helper (respects nameDisplay), falling back to "your professional".
 */
export function buildClaimProfessionalLabel(
  booking: ClaimPublicBooking,
): string {
  return formatProfessionalPublicDisplayName(
    booking.professional ?? null,
    'your professional',
  )
}

/**
 * The timezone the appointment should be rendered in: the location's zone if
 * known, else the pro's, else UTC. Callers format the instant themselves.
 */
export function resolveClaimBookingTimeZone(
  booking: ClaimPublicBooking,
): string {
  return sanitizeTimeZone(
    booking.locationTimeZone ??
      booking.location?.timeZone ??
      booking.professional?.timeZone,
    'UTC',
  )
}
