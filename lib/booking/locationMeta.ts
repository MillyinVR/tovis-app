// lib/booking/locationMeta.ts
//
// Resolves a booking's display location for the "tap for directions" UI shared
// by the Pro bookings list and detail screens. SALON bookings read the captured
// pro-location snapshot; MOBILE bookings read the client-address snapshot (the
// place the pro physically travels to). Address text comes from
// `pickFormattedAddressFromSnapshot`, which reads both the legacy plaintext and
// the AEAD envelope's plaintext-dev shape without needing decryption — rows that
// only carry ciphertext resolve to `null`, so callers simply omit the chip.
import { ServiceLocationType } from '@prisma/client'
import { pickFormattedAddressFromSnapshot } from './snapshots'

export type BookingLocationMeta = {
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  isMobile: boolean
}

// Structural input — both the list's `bookingSelect` payload and the detail
// page's full Booking satisfy it.
export type BookingLocationSnapshotInput = {
  locationType: ServiceLocationType | null
  locationAddressSnapshot: unknown
  locationLatSnapshot: number | null
  locationLngSnapshot: number | null
  clientAddressSnapshot: unknown
  clientAddressLatSnapshot: number | null
  clientAddressLngSnapshot: number | null
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function resolveBookingLocationMeta(
  booking: BookingLocationSnapshotInput,
): BookingLocationMeta {
  const isMobile = booking.locationType === ServiceLocationType.MOBILE

  const snapshot = isMobile
    ? booking.clientAddressSnapshot
    : booking.locationAddressSnapshot
  const lat = isMobile
    ? booking.clientAddressLatSnapshot
    : booking.locationLatSnapshot
  const lng = isMobile
    ? booking.clientAddressLngSnapshot
    : booking.locationLngSnapshot

  return {
    formattedAddress: pickFormattedAddressFromSnapshot(snapshot),
    lat: finiteOrNull(lat),
    lng: finiteOrNull(lng),
    isMobile,
  }
}
