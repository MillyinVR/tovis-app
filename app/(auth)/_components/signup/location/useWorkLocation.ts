// app/(auth)/_components/signup/location/useWorkLocation.ts
//
// Where a pro works: in a salon (an address picked from Google) or mobile (a
// base ZIP plus a radius). Extracted from SignupProClient so the social
// completion form's pro branch asks the identical question — which is also the
// extraction the become-a-pro form is waiting on.
//
// The lookup failures this produces are handed to `onLocationError` rather than
// stored here: the two forms key field errors by name so they can focus the
// first invalid one in their own order, and one field must not have two
// competing sources of truth for its message.

'use client'

import { useMemo, useState } from 'react'

import type { ProSignupLocation } from '@/lib/pro/proProfileSetup'
import {
  fetchAutocomplete,
  fetchGeocodeByPostal,
  fetchPlaceDetails,
  fetchTimeZoneId,
  isUsZip,
  type GooglePrediction,
} from './placesClient'

export type WorkLocationMode = 'SALON' | 'MOBILE'

export type ConfirmedWorkLocation = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string | null
  placeId: string | null
  formattedAddress: string | null
  name: string | null
}

export type WorkLocationController = {
  mode: WorkLocationMode
  setMode(next: WorkLocationMode): void
  query: string
  predictions: GooglePrediction[]
  loading: boolean
  confirmed: ConfirmedWorkLocation | null
  radiusMiles: string
  setRadiusMiles(next: string): void

  refreshPredictions(input: string): Promise<void>
  pickPrediction(p: GooglePrediction): Promise<void>
  confirmZip(): Promise<void>
  reset(nextQuery?: string): void

  isConfirmed(): boolean
  label(): string
  placeholder(): string

  /** Validation messages, or null when the field is fine. */
  validateLocation(): string | null
  validateRadius(): string | null
  /** The wire shape, or null when nothing usable is confirmed. */
  toSignupLocation(): ProSignupLocation | null
}

export function useWorkLocation(args: {
  onLocationError: (message: string | null) => void
}): WorkLocationController {
  const { onLocationError } = args

  const [mode, setModeState] = useState<WorkLocationMode>('SALON')
  const [query, setQuery] = useState('')
  const [predictions, setPredictions] = useState<GooglePrediction[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedWorkLocation | null>(null)
  const [radiusMiles, setRadiusMiles] = useState('15')

  // One Places session token per mounted form: Google bills autocomplete +
  // details as a single session only when they share it.
  const sessionToken = useMemo(
    () =>
      globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(Date.now()),
    [],
  )

  function reset(nextQuery = '') {
    setQuery(nextQuery)
    setPredictions([])
    setConfirmed(null)
    onLocationError(null)
  }

  function setMode(next: WorkLocationMode) {
    setModeState(next)
    reset('')
  }

  function isConfirmed(): boolean {
    if (!confirmed) return false
    if (mode === 'MOBILE') return Boolean(confirmed.postalCode)
    return Boolean(confirmed.placeId) && Boolean(confirmed.formattedAddress)
  }

  function label(): string {
    return mode === 'MOBILE' ? 'Base ZIP code' : 'Salon / Suite address'
  }

  function placeholder(): string {
    return mode === 'MOBILE'
      ? 'Enter your ZIP code (e.g. 92101)'
      : 'Search your salon / suite address'
  }

  async function refreshPredictions(input: string): Promise<void> {
    onLocationError(null)
    setConfirmed(null)

    if (mode === 'MOBILE') {
      setQuery(input)
      setPredictions([])
      return
    }

    setQuery(input)
    const trimmed = input.trim()
    if (trimmed.length < 2) {
      setPredictions([])
      return
    }

    setLoading(true)
    try {
      const preds = await fetchAutocomplete({ input: trimmed, sessionToken })
      setPredictions(preds.slice(0, 6))
    } catch (e: unknown) {
      setPredictions([])
      onLocationError(
        e instanceof Error
          ? e.message
          : 'Location search is unavailable right now.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function pickPrediction(p: GooglePrediction): Promise<void> {
    onLocationError(null)
    setLoading(true)

    try {
      const details = await fetchPlaceDetails({
        placeId: p.placeId,
        sessionToken,
      })
      if (details.lat == null || details.lng == null) {
        throw new Error('Selected place is missing coordinates.')
      }

      const tz = await fetchTimeZoneId({ lat: details.lat, lng: details.lng })

      setConfirmed({
        timeZoneId: tz,
        lat: details.lat,
        lng: details.lng,
        city: details.city,
        state: details.state,
        countryCode: details.countryCode,
        postalCode: details.postalCode,
        placeId: details.placeId,
        formattedAddress: details.formattedAddress,
        name: details.name,
      })

      setPredictions([])
      setQuery(p.description)
    } catch (e: unknown) {
      setConfirmed(null)
      onLocationError(
        e instanceof Error ? e.message : 'Could not confirm location.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function confirmZip(): Promise<void> {
    onLocationError(null)

    const raw = query.trim()
    if (!isUsZip(raw)) {
      onLocationError('Please enter a valid 5-digit ZIP code.')
      return
    }

    setLoading(true)
    try {
      const geo = await fetchGeocodeByPostal({ postalCode: raw })
      const tz = await fetchTimeZoneId({ lat: geo.lat, lng: geo.lng })

      setConfirmed({
        timeZoneId: tz,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        countryCode: geo.countryCode,
        postalCode: geo.postalCode,
        placeId: null,
        formattedAddress: null,
        name: null,
      })

      setPredictions([])
      setQuery(geo.postalCode)
    } catch (e: unknown) {
      setConfirmed(null)
      onLocationError(
        e instanceof Error ? e.message : 'Could not confirm ZIP code.',
      )
    } finally {
      setLoading(false)
    }
  }

  function validateLocation(): string | null {
    if (isConfirmed() && confirmed) return null
    return mode === 'MOBILE'
      ? 'Please confirm your ZIP code.'
      : 'Please choose an address from the dropdown.'
  }

  function validateRadius(): string | null {
    if (mode !== 'MOBILE') return null
    const n = Number(radiusMiles)
    if (!Number.isFinite(n) || n < 1 || n > 200) {
      return 'Please enter a mobile radius between 1 and 200 miles.'
    }
    return null
  }

  function toSignupLocation(): ProSignupLocation | null {
    if (!confirmed) return null

    if (mode === 'MOBILE') {
      const postalCode = confirmed.postalCode ?? query.trim()
      if (!postalCode) return null
      return {
        kind: 'PRO_MOBILE',
        postalCode,
        city: confirmed.city,
        state: confirmed.state,
        countryCode: confirmed.countryCode,
        lat: confirmed.lat,
        lng: confirmed.lng,
        timeZoneId: confirmed.timeZoneId,
      }
    }

    // Mirrors isConfirmed()'s SALON branch: without a placeId there is no place
    // to store, so this returns null rather than asserting one exists.
    if (!confirmed.placeId) return null

    return {
      kind: 'PRO_SALON',
      placeId: confirmed.placeId,
      formattedAddress: confirmed.formattedAddress ?? query.trim(),
      city: confirmed.city,
      state: confirmed.state,
      postalCode: confirmed.postalCode,
      countryCode: confirmed.countryCode,
      lat: confirmed.lat,
      lng: confirmed.lng,
      timeZoneId: confirmed.timeZoneId,
      name: confirmed.name,
    }
  }

  return {
    mode,
    setMode,
    query,
    predictions,
    loading,
    confirmed,
    radiusMiles,
    setRadiusMiles,
    refreshPredictions,
    pickPrediction,
    confirmZip,
    reset,
    isConfirmed,
    label,
    placeholder,
    validateLocation,
    validateRadius,
    toSignupLocation,
  }
}
