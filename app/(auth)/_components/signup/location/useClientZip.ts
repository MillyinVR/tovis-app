// app/(auth)/_components/signup/location/useClientZip.ts
//
// The ZIP a client signup confirms about itself. Extracted from
// SignupClientClient so the social completion form asks for it the same way
// rather than growing a second, subtly different copy.
//
// Errors stay with the CALLER. Both forms key field errors by name so they can
// focus the first invalid one in their own order, and a hook that owned the
// message would have to be asked for it anyway — so `confirmIfValid` hands the
// message back instead of storing it.

'use client'

import { useCallback, useState } from 'react'

import type { ClientSignupLocation } from '@/lib/auth/registration/signupLocation'
import {
  fetchGeocodeByPostal,
  fetchTimeZoneId,
  isUsZip,
} from './placesClient'

export type ConfirmedZip = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string
}

export type ZipConfirmResult = {
  confirmed: ConfirmedZip | null
  errorMessage: string | null
}

export type ClientZipController = {
  zip: string
  loading: boolean
  confirmed: ConfirmedZip | null
  /** Typing invalidates the confirmation — the text no longer describes it. */
  change(next: string): void
  /** Keep the text, drop the confirmation (the "Change" affordance). */
  reset(next?: string): void
  confirmIfValid(rawInput?: string): Promise<ZipConfirmResult>
}

/** The wire shape the register / social-complete routes read. */
export function clientZipToSignupLocation(
  confirmed: ConfirmedZip,
): ClientSignupLocation {
  return {
    kind: 'CLIENT_ZIP',
    postalCode: confirmed.postalCode,
    city: confirmed.city,
    state: confirmed.state,
    countryCode: confirmed.countryCode,
    lat: confirmed.lat,
    lng: confirmed.lng,
    timeZoneId: confirmed.timeZoneId,
  }
}

export function useClientZip(initialZip = ''): ClientZipController {
  const [zip, setZip] = useState(initialZip)
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedZip | null>(null)

  const change = useCallback((next: string) => {
    setZip(next)
    setConfirmed(null)
  }, [])

  const reset = useCallback((next = '') => {
    setZip(next)
    setConfirmed(null)
  }, [])

  const confirmIfValid = useCallback(
    async (rawInput?: string): Promise<ZipConfirmResult> => {
      const raw = (rawInput ?? zip).trim()

      if (!raw) return { confirmed: null, errorMessage: null }

      if (confirmed?.postalCode && confirmed.postalCode === raw) {
        return { confirmed, errorMessage: null }
      }

      if (!isUsZip(raw)) {
        setConfirmed(null)
        return {
          confirmed: null,
          errorMessage: 'Please enter a valid 5-digit ZIP code.',
        }
      }

      if (loading) return { confirmed, errorMessage: null }

      setLoading(true)

      try {
        const geo = await fetchGeocodeByPostal({ postalCode: raw })
        const tz = await fetchTimeZoneId({ lat: geo.lat, lng: geo.lng })

        const nextConfirmed: ConfirmedZip = {
          timeZoneId: tz,
          lat: geo.lat,
          lng: geo.lng,
          city: geo.city,
          state: geo.state,
          countryCode: geo.countryCode,
          postalCode: geo.postalCode,
        }

        setConfirmed(nextConfirmed)
        setZip(geo.postalCode)
        return { confirmed: nextConfirmed, errorMessage: null }
      } catch (e) {
        setConfirmed(null)
        return {
          confirmed: null,
          errorMessage:
            e instanceof Error ? e.message : 'Could not confirm ZIP code.',
        }
      } finally {
        setLoading(false)
      }
    },
    [zip, confirmed, loading],
  )

  return { zip, loading, confirmed, change, reset, confirmIfValid }
}
