// app/(main)/booking/AvailabilityDrawer/components/ClientAddressCreateModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { safeJson } from '../utils/safeJson'
import type { MobileAddressOption } from '../types'

type PlacePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type PlaceDetails = {
  placeId: string
  name: string | null
  formattedAddress: string
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: number | null
  lng: number | null
  components: Record<string, string>
}

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (address: MobileAddressOption | null) => void | Promise<void>
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parsePredictions(raw: unknown): PlacePrediction[] {
  if (!isRecord(raw) || !Array.isArray(raw.predictions)) return []

  return raw.predictions.reduce<PlacePrediction[]>((acc, row) => {
    if (!isRecord(row)) return acc

    const placeId = pickString(row.placeId)
    const description = pickString(row.description)
    if (!placeId || !description) return acc

    acc.push({
      placeId,
      description,
      mainText: pickString(row.mainText) ?? description,
      secondaryText: pickString(row.secondaryText) ?? '',
    })

    return acc
  }, [])
}

function parsePlaceDetails(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw) || !isRecord(raw.place)) return null
  const place = raw.place

  const placeId = pickString(place.placeId)
  const formattedAddress = pickString(place.formattedAddress)

  if (!placeId || !formattedAddress) return null

  const components =
    isRecord(place.components)
      ? Object.entries(place.components).reduce<Record<string, string>>(
          (acc, [key, value]) => {
            if (typeof value === 'string' && value.trim()) acc[key] = value.trim()
            return acc
          },
          {},
        )
      : {}

  return {
    placeId,
    name: pickString(place.name),
    formattedAddress,
    city: pickString(place.city),
    state: pickString(place.state),
    postalCode: pickString(place.postalCode),
    countryCode: pickString(place.countryCode),
    lat: pickNumber(place.lat),
    lng: pickNumber(place.lng),
    components,
  }
}

function parseCreatedAddress(raw: unknown): MobileAddressOption | null {
  if (!isRecord(raw) || !isRecord(raw.address)) return null
  const address = raw.address

  const id = pickString(address.id)
  const formattedAddress = pickString(address.formattedAddress)
  if (!id || !formattedAddress) return null

  return {
    id,
    label: pickString(address.label) ?? 'Service address',
    formattedAddress,
    isDefault: Boolean(address.isDefault),
  }
}

function buildAddressLine1(place: PlaceDetails) {
  const streetNumber = place.components.street_number ?? ''
  const route = place.components.route ?? ''
  const joined = [streetNumber, route].filter(Boolean).join(' ').trim()
  if (joined) return joined
  return place.name ?? place.formattedAddress
}

function buildSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tovis-${Date.now()}`
}

export default function ClientAddressCreateModal(props: Props) {
  const { open, onClose, onSaved } = props

  const [query, setQuery] = useState('')
  const [label, setLabel] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [isDefault, setIsDefault] = useState(false)

  const [sessionToken, setSessionToken] = useState<string>(() => buildSessionToken())
  const [searching, setSearching] = useState(false)
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSessionToken(buildSessionToken())
    setQuery('')
    setLabel('')
    setAddressLine2('')
    setIsDefault(false)
    setSearching(false)
    setPredictions([])
    setSelectedPlace(null)
    setSaving(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()

    if (selectedPlace && trimmed === selectedPlace.formattedAddress) {
      setPredictions([])
      return
    }

    if (trimmed.length < 3) {
      setPredictions([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true)
        setError(null)

        const qs = new URLSearchParams({
          input: trimmed,
          kind: 'ADDRESS',
          components: 'country:us',
          sessionToken,
        })

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })

        const raw = await safeJson(res)
        if (!res.ok) {
          throw new Error(
            (isRecord(raw) && pickString(raw.error)) || 'Failed to search addresses.',
          )
        }

        setPredictions(parsePredictions(raw))
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setPredictions([])
        setError(e instanceof Error ? e.message : 'Failed to search addresses.')
      } finally {
        setSearching(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, query, sessionToken, selectedPlace])

  const canSave = useMemo(() => {
    return Boolean(selectedPlace && !saving)
  }, [selectedPlace, saving])

  async function selectPrediction(prediction: PlacePrediction) {
    try {
      setError(null)
      setSearching(true)

      const qs = new URLSearchParams({
        placeId: prediction.placeId,
        sessionToken,
      })

      const res = await fetch(`/api/google/places/details?${qs.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          (isRecord(raw) && pickString(raw.error)) || 'Failed to load address details.',
        )
      }

      const details = parsePlaceDetails(raw)
      if (!details) throw new Error('Google returned an invalid address.')

      setSelectedPlace(details)
      setQuery(details.formattedAddress)
      setPredictions([])

      if (!label.trim()) {
        setLabel(details.name ?? 'Service address')
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load address details.')
    } finally {
      setSearching(false)
    }
  }

  async function saveAddress() {
    if (!selectedPlace || saving) return

    try {
      setSaving(true)
      setError(null)

      const payload = {
        kind: 'SERVICE_ADDRESS',
        label: label.trim() || selectedPlace.name || 'Service address',
        formattedAddress: selectedPlace.formattedAddress,
        addressLine1: buildAddressLine1(selectedPlace),
        addressLine2: addressLine2.trim() || null,
        city: selectedPlace.city,
        state: selectedPlace.state,
        postalCode: selectedPlace.postalCode,
        countryCode: selectedPlace.countryCode,
        placeId: selectedPlace.placeId,
        lat: selectedPlace.lat,
        lng: selectedPlace.lng,
        isDefault,
      }

      const res = await fetch('/api/client/addresses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          (isRecord(raw) && pickString(raw.error)) || 'Failed to save address.',
        )
      }

      await onSaved(parseCreatedAddress(raw))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save address.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-4"
      onClick={() => {
        if (saving) return
        onClose()
      }}
    >
      <div
        className="tovis-glass-soft w-full max-w-lg rounded-[26px] border border-white/10 bg-bgPrimary/90 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add mobile service address"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-textPrimary">
              Add mobile service address
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Save a service address without leaving booking.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-bgPrimary/30 text-textPrimary hover:bg-white/10 disabled:opacity-60"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-[12px] font-semibold text-toneDanger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-[12px] font-black text-textPrimary">
              Search address
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedPlace(null)
              }}
              placeholder="Start typing an address…"
              className="w-full rounded-card border border-white/10 bg-bgPrimary/25 px-3 py-3 text-[14px] font-semibold text-textPrimary outline-none transition placeholder:text-textSecondary/70 focus:border-accentPrimary/35"
            />
          </label>

          {searching ? (
            <div className="rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-3 text-[12px] font-semibold text-textSecondary">
              Searching…
            </div>
          ) : null}

          {!searching && predictions.length > 0 ? (
            <div className="max-h-56 overflow-y-auto rounded-card border border-white/10 bg-bgPrimary/20">
              {predictions.map((prediction) => (
                <button
                  key={prediction.placeId}
                  type="button"
                  onClick={() => {
                    void selectPrediction(prediction)
                  }}
                  className="block w-full border-b border-white/8 px-3 py-3 text-left last:border-b-0 hover:bg-white/6"
                >
                  <div className="text-[13px] font-black text-textPrimary">
                    {prediction.mainText}
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                    {prediction.secondaryText || prediction.description}
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {selectedPlace ? (
            <div className="rounded-card border border-accentPrimary/20 bg-accentPrimary/10 px-3 py-3">
              <div className="text-[12px] font-black text-textPrimary">
                Selected address
              </div>
              <div className="mt-1 text-[12px] font-semibold leading-5 text-textSecondary">
                {selectedPlace.formattedAddress}
              </div>
            </div>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-[12px] font-black text-textPrimary">
              Label
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Home, Mom’s house, Hotel…"
              className="w-full rounded-card border border-white/10 bg-bgPrimary/25 px-3 py-3 text-[14px] font-semibold text-textPrimary outline-none transition placeholder:text-textSecondary/70 focus:border-accentPrimary/35"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-black text-textPrimary">
              Address line 2
            </span>
            <input
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Apt, suite, gate code…"
              className="w-full rounded-card border border-white/10 bg-bgPrimary/25 px-3 py-3 text-[14px] font-semibold text-textPrimary outline-none transition placeholder:text-textSecondary/70 focus:border-accentPrimary/35"
            />
          </label>

          <label className="flex items-center gap-2 text-[12px] font-semibold text-textSecondary">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              disabled={saving}
            />
            Make this my default mobile service address
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-white/10 bg-bgPrimary/20 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/8 disabled:opacity-60"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => {
              void saveAddress()
            }}
            disabled={!canSave}
            className="rounded-full border border-accentPrimary/35 bg-accentPrimary/20 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-accentPrimary/28 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </div>
    </div>
  )
}