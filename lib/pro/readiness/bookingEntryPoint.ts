// lib/pro/readiness/bookingEntryPoint.ts
//
// Converts trusted booking-source context into the readiness entry point used by
// pro readiness policy.
//
// Important: this is not a client-trust boundary. Callers should only pass
// source values that were derived or validated server-side.

import { BookingSource } from '@prisma/client'

import type { ProBookingEntryPoint } from '@/lib/pro/readiness/proReadiness'

export type BookingEntryPointSource =
  | 'BROAD_DISCOVERY'
  | 'SPECIFIC_SEARCH'
  | 'DIRECT_PROFILE'
  | 'NFC_CARD'
  | 'SHORT_CODE'
  | 'QR_CODE'
  | 'AFTERCARE_REBOOK'
  | 'SALON_WHITE_LABEL'
  | 'PRO_CREATED'

export type HoldBookingEntryPointContext = Readonly<{
  /**
   * Optional request-level hint. This is intentionally low-trust.
   *
   * Safe values such as BROAD_DISCOVERY, SPECIFIC_SEARCH, and DIRECT_PROFILE
   * may be honored directly. Privileged values such as NFC_CARD, SHORT_CODE,
   * QR_CODE, AFTERCARE_REBOOK, SALON_WHITE_LABEL, and PRO_CREATED require a
   * matching server-validated context flag below.
   */
  requestedEntryPoint?: BookingEntryPointSource | null

  /**
   * Server-validated context flags. These should only be set after the route
   * has validated the matching token/card/code/source.
   */
  hasAftercareToken?: boolean
  hasNfcCard?: boolean
  hasShortCode?: boolean
  hasQrCode?: boolean
  hasSalonWhiteLabelContext?: boolean
  hasProCreatedContext?: boolean
  hasDirectProfileContext?: boolean
}>

export function parseBookingEntryPointSource(
  value: unknown,
): BookingEntryPointSource | null {
  if (typeof value !== 'string') return null

  switch (value.trim().toUpperCase()) {
    case 'BROAD_DISCOVERY':
    case 'SPECIFIC_SEARCH':
    case 'DIRECT_PROFILE':
    case 'NFC_CARD':
    case 'SHORT_CODE':
    case 'QR_CODE':
    case 'AFTERCARE_REBOOK':
    case 'SALON_WHITE_LABEL':
    case 'PRO_CREATED':
      return value.trim().toUpperCase() as BookingEntryPointSource
    default:
      return null
  }
}

export function bookingEntryPointFromSource(
  source: BookingEntryPointSource | null | undefined,
): ProBookingEntryPoint {
  switch (source) {
    case 'BROAD_DISCOVERY':
      return 'BROAD_DISCOVERY'

    case 'SPECIFIC_SEARCH':
      return 'SPECIFIC_SEARCH'

    case 'DIRECT_PROFILE':
      return 'DIRECT_PROFILE'

    case 'NFC_CARD':
      return 'NFC_CARD'

    case 'SHORT_CODE':
      return 'SHORT_CODE'

    case 'QR_CODE':
      return 'QR_CODE'

    case 'PRO_CREATED':
      return 'PRO_CREATED'

    // Aftercare rebook is an intentional client path, not broad marketplace
    // discovery. Reuse the existing readiness policy bucket for now.
    case 'AFTERCARE_REBOOK':
      return 'DIRECT_PROFILE'

    // Salon white-label is also intentional/contextual, not broad discovery.
    // It may deserve its own readiness policy later, but for this PR we avoid
    // expanding the enum unless the policy actually differs.
    case 'SALON_WHITE_LABEL':
      return 'DIRECT_PROFILE'

    case null:
    case undefined:
      return 'BROAD_DISCOVERY'
  }
}

export function bookingEntryPointFromHoldContext(
  context: HoldBookingEntryPointContext,
): ProBookingEntryPoint {
  const requested = context.requestedEntryPoint ?? null

  // Privileged/contextual entry points must come from server-validated context,
  // not raw client input.
  if (context.hasAftercareToken) {
    return bookingEntryPointFromSource('AFTERCARE_REBOOK')
  }

  if (context.hasNfcCard) {
    return bookingEntryPointFromSource('NFC_CARD')
  }

  if (context.hasShortCode) {
    return bookingEntryPointFromSource('SHORT_CODE')
  }

  if (context.hasQrCode) {
    return bookingEntryPointFromSource('QR_CODE')
  }

  if (context.hasSalonWhiteLabelContext) {
    return bookingEntryPointFromSource('SALON_WHITE_LABEL')
  }

  if (context.hasProCreatedContext) {
    return bookingEntryPointFromSource('PRO_CREATED')
  }

  if (context.hasDirectProfileContext) {
    return bookingEntryPointFromSource('DIRECT_PROFILE')
  }

  // Low-risk request hints may be honored directly.
  if (requested === 'SPECIFIC_SEARCH') {
    return bookingEntryPointFromSource('SPECIFIC_SEARCH')
  }

  if (requested === 'DIRECT_PROFILE') {
    return bookingEntryPointFromSource('DIRECT_PROFILE')
  }

  // Treat absent, invalid, or privileged-but-unvalidated request hints as broad
  // discovery. This is the strictest/default marketplace readiness policy.
  return bookingEntryPointFromSource('BROAD_DISCOVERY')
}

export function bookingEntryPointFromBookingSource(
  source: BookingSource,
): ProBookingEntryPoint {
  switch (source) {
    case BookingSource.DISCOVERY:
      return 'BROAD_DISCOVERY'

    case BookingSource.AFTERCARE:
      return bookingEntryPointFromSource('AFTERCARE_REBOOK')

    case BookingSource.REQUESTED:
      return 'DIRECT_PROFILE'

    // IMPORTED bookings are created pro-side via createProBooking (entry point
    // PRO_CREATED) and never reach this client-finalize mapping; treat as the
    // strictest marketplace default for exhaustiveness.
    case BookingSource.IMPORTED:
      return 'BROAD_DISCOVERY'
  }
}