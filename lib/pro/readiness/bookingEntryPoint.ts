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
  }
}