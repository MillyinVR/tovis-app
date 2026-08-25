// lib/auth/registration/signupLocation.ts
//
// The location a signup confirms about itself: a pro's work location, or a
// client's ZIP.
//
// The two PRO variants are NOT redeclared here — they are ProSignupLocation
// from lib/pro/proProfileSetup, which is what resolveProProfileSetup() and
// buildProfessionalProfileCreateData() already take. Before this module the
// register route carried its own byte-identical copy of both, so a field added
// to one shape silently did not reach the other.

import type { ProSignupLocation } from '@/lib/pro/proProfileSetup'
import { isRecord } from '@/lib/guards'

export type ClientSignupLocation = {
  kind: 'CLIENT_ZIP'
  postalCode: string
  city: string | null
  state: string | null
  countryCode: string | null
  lat: number
  lng: number
  timeZoneId: string
}

export type SignupLocation = ProSignupLocation | ClientSignupLocation

/**
 * Structural check on an untrusted request body. Deliberately the same shallow
 * shape the register route has always applied: presence and primitive type of
 * the fields the creation path reads, nothing more. Value-level validation
 * (a real IANA zone, a supported state, a plausible radius) stays with the
 * callers that already do it.
 */
export function isSignupLocationPayload(v: unknown): v is SignupLocation {
  if (!isRecord(v)) return false

  if (v.kind === 'PRO_SALON') {
    return (
      typeof v.placeId === 'string' &&
      typeof v.formattedAddress === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number' &&
      typeof v.timeZoneId === 'string'
    )
  }

  if (v.kind === 'PRO_MOBILE' || v.kind === 'CLIENT_ZIP') {
    return (
      typeof v.postalCode === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number' &&
      typeof v.timeZoneId === 'string'
    )
  }

  return false
}
