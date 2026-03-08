// app/client/settings/ClientAddressesSettings.tsx
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import {
  loadViewerLocation,
  setViewerLocation,
  VIEWER_RADIUS_DEFAULT_MILES,
} from '@/lib/viewerLocation'

type AddressKind = 'SEARCH_AREA' | 'SERVICE_ADDRESS'

type AddressRecord = {
  id: string
  kind: AddressKind
  label: string | null
  isDefault: boolean
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  createdAt: string
  updatedAt: string
}

type PlacePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type PlaceDetails = {
  placeId: string
  name: string | null
  formattedAddress: string | null
  lat: number
  lng: number
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
}

type DraftAddress = {
  kind: AddressKind
  label: string
  isDefault: boolean
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
}

const EMPTY_DRAFT_SEARCH: DraftAddress = {
  kind: 'SEARCH_AREA',
  label: '',
  isDefault: false,
  formattedAddress: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  countryCode: 'US',
  placeId: null,
  lat: null,
  lng: null,
}

const EMPTY_DRAFT_SERVICE: DraftAddress = {
  kind: 'SERVICE_ADDRESS',
  label: '',
  isDefault: false,
  formattedAddress: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  countryCode: 'US',
  placeId: null,
  lat: null,
  lng: null,
}

function makeSessionToken() {
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function pickText(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickErrorMessage(raw: unknown, fallback: string) {
  if (isRecord(raw) && typeof raw.error === 'string' && raw.error.trim()) {
    return raw.error.trim()
  }
  return fallback
}

function parsePredictions(raw: unknown): PlacePrediction[] {
  if (!isRecord(raw)) return []

  const arr = raw.predictions
  if (!Array.isArray(arr)) return []

  return arr
    .map((row) => {
      if (!isRecord(row)) return null

      const placeId = pickText(row.placeId)
      const description = pickText(row.description)
      const mainText = pickText(row.mainText)
      const secondaryText = pickText(row.secondaryText)

      if (!placeId || !description) return null

      return {
        placeId,
        description,
        mainText,
        secondaryText,
      }
    })
    .filter((row): row is PlacePrediction => Boolean(row))
}

function parsePlaceDetails(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw)) return null

  const place = raw.place
  if (!isRecord(place)) return null

  const placeId = pickText(place.placeId)
  const lat =
    typeof place.lat === 'number' && Number.isFinite(place.lat)
      ? place.lat
      : null
  const lng =
    typeof place.lng === 'number' && Number.isFinite(place.lng)
      ? place.lng
      : null

  if (!placeId || lat == null || lng == null) return null

  return {
    placeId,
    name: pickText(place.name) || null,
    formattedAddress: pickText(place.formattedAddress) || null,
    lat,
    lng,
    city: pickText(place.city) || null,
    state: pickText(place.state) || null,
    postalCode: pickText(place.postalCode) || null,
    countryCode: pickText(place.countryCode) || null,
  }
}

function parseGeocode(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw)) return null
  if (!isRecord(raw.geo)) return null

  const geo = raw.geo
  const lat =
    typeof geo.lat === 'number' && Number.isFinite(geo.lat) ? geo.lat : null
  const lng =
    typeof geo.lng === 'number' && Number.isFinite(geo.lng) ? geo.lng : null

  const postalCode = pickText(geo.postalCode) || null
  if (!postalCode) return null

  return {
    placeId: '',
    name: postalCode,
    formattedAddress: [postalCode, pickText(geo.city), pickText(geo.state)]
      .filter(Boolean)
      .join(', ') || postalCode,
    lat: lat ?? 0,
    lng: lng ?? 0,
    city: pickText(geo.city) || null,
    state: pickText(geo.state) || null,
    postalCode,
    countryCode: pickText(geo.countryCode) || null,
  }
}

function parseAddresses(raw: unknown): AddressRecord[] {
  if (!isRecord(raw)) return []

  const arr = raw.addresses
  if (!Array.isArray(arr)) return []

  return arr
    .map((row) => {
      if (!isRecord(row)) return null

      const id = pickText(row.id)
      const kind = pickText(row.kind)
      if (!id || (kind !== 'SEARCH_AREA' && kind !== 'SERVICE_ADDRESS')) {
        return null
      }

      const lat =
        typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : null
      const lng =
        typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : null

      return {
        id,
        kind,
        label: pickText(row.label) || null,
        isDefault: Boolean(row.isDefault),
        formattedAddress: pickText(row.formattedAddress) || null,
        addressLine1: pickText(row.addressLine1) || null,
        addressLine2: pickText(row.addressLine2) || null,
        city: pickText(row.city) || null,
        state: pickText(row.state) || null,
        postalCode: pickText(row.postalCode) || null,
        countryCode: pickText(row.countryCode) || null,
        placeId: pickText(row.placeId) || null,
        lat,
        lng,
        createdAt: pickText(row.createdAt) || '',
        updatedAt: pickText(row.updatedAt) || '',
      }
    })
    .filter((row): row is AddressRecord => Boolean(row))
}

function isUsZip(input: string) {
  return /^\d{5}(?:-\d{4})?$/.test(input.trim())
}

function addressTitle(address: AddressRecord) {
  return (
    address.label ||
    address.formattedAddress ||
    address.addressLine1 ||
    [address.city, address.state].filter(Boolean).join(', ') ||
    address.postalCode ||
    (address.kind === 'SEARCH_AREA' ? 'Search area' : 'Service address')
  )
}

function addressSubtitle(address: AddressRecord) {
  return (
    address.formattedAddress ||
    [
      address.addressLine1,
      address.addressLine2,
      [address.city, address.state, address.postalCode]
        .filter(Boolean)
        .join(' '),
    ]
      .filter(Boolean)
      .join(', ') ||
    null
  )
}

function mapsHref(address: AddressRecord) {
  if (address.lat != null && address.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${address.lat},${address.lng}`,
    )}`
  }

  const text =
    address.formattedAddress ||
    [
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.state,
      address.postalCode,
    ]
      .filter(Boolean)
      .join(', ')

  if (!text) return null

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    text,
  )}`
}

function toDraftFromAddress(address: AddressRecord): DraftAddress {
  return {
    kind: address.kind,
    label: address.label ?? '',
    isDefault: address.isDefault,
    formattedAddress: address.formattedAddress ?? null,
    addressLine1: address.addressLine1 ?? null,
    addressLine2: address.addressLine2 ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postalCode: address.postalCode ?? null,
    countryCode: address.countryCode ?? 'US',
    placeId: address.placeId ?? null,
    lat: address.lat ?? null,
    lng: address.lng ?? null,
  }
}

export default function ClientAddressesSettings() {
  const [addresses, setAddresses] = useState<AddressRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)

  const [searchDraft, setSearchDraft] = useState<DraftAddress>(EMPTY_DRAFT_SEARCH)
  const [serviceDraft, setServiceDraft] = useState<DraftAddress>(EMPTY_DRAFT_SERVICE)

  const [searchQuery, setSearchQuery] = useState('')
  const [serviceQuery, setServiceQuery] = useState('')

  const [searchPredictions, setSearchPredictions] = useState<PlacePrediction[]>([])
  const [servicePredictions, setServicePredictions] = useState<PlacePrediction[]>([])

  const [searchLoading, setSearchLoading] = useState(false)
  const [serviceLoading, setServiceLoading] = useState(false)

  const searchSessionTokenRef = useRef(makeSessionToken())
  const serviceSessionTokenRef = useRef(makeSessionToken())

  const searchAreas = useMemo(
    () => addresses.filter((a) => a.kind === 'SEARCH_AREA'),
    [addresses],
  )

  const serviceAddresses = useMemo(
    () => addresses.filter((a) => a.kind === 'SERVICE_ADDRESS'),
    [addresses],
  )

  const defaultSearchArea = useMemo(
    () => searchAreas.find((a) => a.isDefault) ?? null,
    [searchAreas],
  )

  const defaultServiceAddress = useMemo(
    () => serviceAddresses.find((a) => a.isDefault) ?? null,
    [serviceAddresses],
  )

  const loadAddresses = useCallback(async () => {
    try {
      setLoading(true)
      setErr(null)

      const res = await fetch('/api/client/addresses', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(raw, 'Could not load addresses.'))
      }

      setAddresses(parseAddresses(raw))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load addresses.')
      setAddresses([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAddresses()
  }, [loadAddresses])

  useEffect(() => {
    const q = searchQuery.trim()

    if (q.length < 2 || isUsZip(q)) {
      setSearchPredictions([])
      setSearchLoading(false)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        setSearchLoading(true)
        setErr(null)

        const qs = new URLSearchParams()
        qs.set('input', q)
        qs.set('sessionToken', searchSessionTokenRef.current)
        qs.set('kind', 'AREA')
        qs.set('components', 'country:us')

        const res = await fetch(
          `/api/google/places/autocomplete?${qs.toString()}`,
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: ac.signal,
          },
        )

        const raw = await safeJson(res)
        if (!res.ok) {
          setSearchPredictions([])
          setErr('Could not search areas.')
          return
        }

        setSearchPredictions(parsePredictions(raw))
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setSearchPredictions([])
        setErr('Could not search areas.')
      } finally {
        setSearchLoading(false)
      }
    }, 220)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [searchQuery])

  useEffect(() => {
    const q = serviceQuery.trim()

    if (q.length < 3) {
      setServicePredictions([])
      setServiceLoading(false)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        setServiceLoading(true)
        setErr(null)

        const qs = new URLSearchParams()
        qs.set('input', q)
        qs.set('sessionToken', serviceSessionTokenRef.current)
        qs.set('kind', 'ADDRESS')
        qs.set('components', 'country:us')

        const res = await fetch(
          `/api/google/places/autocomplete?${qs.toString()}`,
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: ac.signal,
          },
        )

        const raw = await safeJson(res)
        if (!res.ok) {
          setServicePredictions([])
          setErr('Could not search addresses.')
          return
        }

        setServicePredictions(parsePredictions(raw))
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setServicePredictions([])
        setErr('Could not search addresses.')
      } finally {
        setServiceLoading(false)
      }
    }, 220)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [serviceQuery])

  const applyDefaultSearchAreaToViewer = useCallback((address: AddressRecord) => {
    if (address.kind !== 'SEARCH_AREA') return
    if (address.lat == null || address.lng == null) return

    const currentViewer = loadViewerLocation()
    const radiusMiles =
      currentViewer?.radiusMiles ?? VIEWER_RADIUS_DEFAULT_MILES

    setViewerLocation({
      label:
        address.label ||
        address.formattedAddress ||
        [address.city, address.state].filter(Boolean).join(', ') ||
        address.postalCode ||
        'Search area',
      lat: address.lat,
      lng: address.lng,
      placeId: address.placeId,
      radiusMiles,
    })
  }, [])

  const chooseSearchPrediction = useCallback(async (prediction: PlacePrediction) => {
    try {
      setErr(null)

      const qs = new URLSearchParams()
      qs.set('placeId', prediction.placeId)
      qs.set('sessionToken', searchSessionTokenRef.current)

      const res = await fetch(`/api/google/places/details?${qs.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        setErr('Could not load that area.')
        return
      }

      const place = parsePlaceDetails(raw)
      if (!place) {
        setErr('Could not read that area.')
        return
      }

      setSearchDraft((prev) => ({
        ...prev,
        formattedAddress: place.formattedAddress,
        city: place.city,
        state: place.state,
        postalCode: place.postalCode,
        countryCode: place.countryCode ?? 'US',
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
      }))

      if (!searchDraft.label.trim()) {
        setSearchDraft((prev) => ({
          ...prev,
          label:
            prev.label ||
            prediction.mainText ||
            place.formattedAddress ||
            'Search area',
        }))
      }

      setSearchQuery(prediction.description)
      setSearchPredictions([])
      searchSessionTokenRef.current = makeSessionToken()
    } catch {
      setErr('Could not set that area.')
    }
  }, [searchDraft.label])

  const chooseSearchZip = useCallback(async () => {
    const postalCode = searchQuery.trim()
    if (!isUsZip(postalCode)) return

    try {
      setErr(null)
      setSearchLoading(true)

      const qs = new URLSearchParams()
      qs.set('postalCode', postalCode)
      qs.set('components', 'country:us')

      const res = await fetch(`/api/google/geocode?${qs.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        setErr(pickErrorMessage(raw, 'Could not resolve that ZIP code.'))
        return
      }

      const place = parseGeocode(raw)
      if (!place) {
        setErr('Could not read that ZIP code.')
        return
      }

      setSearchDraft((prev) => ({
        ...prev,
        formattedAddress: place.formattedAddress,
        city: place.city,
        state: place.state,
        postalCode: place.postalCode,
        countryCode: place.countryCode ?? 'US',
        placeId: null,
        lat: Number.isFinite(place.lat) ? place.lat : null,
        lng: Number.isFinite(place.lng) ? place.lng : null,
      }))

      if (!searchDraft.label.trim()) {
        setSearchDraft((prev) => ({
          ...prev,
          label:
            prev.label ||
            place.postalCode ||
            [place.city, place.state].filter(Boolean).join(', ') ||
            'Search area',
        }))
      }

      setSearchPredictions([])
    } catch {
      setErr('Could not resolve that ZIP code.')
    } finally {
      setSearchLoading(false)
    }
  }, [searchQuery, searchDraft.label])

  const chooseServicePrediction = useCallback(async (prediction: PlacePrediction) => {
    try {
      setErr(null)

      const qs = new URLSearchParams()
      qs.set('placeId', prediction.placeId)
      qs.set('sessionToken', serviceSessionTokenRef.current)

      const res = await fetch(`/api/google/places/details?${qs.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        setErr('Could not load that address.')
        return
      }

      const place = parsePlaceDetails(raw)
      if (!place) {
        setErr('Could not read that address.')
        return
      }

      setServiceDraft((prev) => ({
        ...prev,
        formattedAddress: place.formattedAddress,
        addressLine1: place.formattedAddress,
        city: place.city,
        state: place.state,
        postalCode: place.postalCode,
        countryCode: place.countryCode ?? 'US',
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
      }))

      if (!serviceDraft.label.trim()) {
        setServiceDraft((prev) => ({
          ...prev,
          label:
            prev.label ||
            prediction.mainText ||
            'Home',
        }))
      }

      setServiceQuery(prediction.description)
      setServicePredictions([])
      serviceSessionTokenRef.current = makeSessionToken()
    } catch {
      setErr('Could not set that address.')
    }
  }, [serviceDraft.label])

  const resetSearchDraft = useCallback(() => {
    setEditingId(null)
    setSearchDraft({
      ...EMPTY_DRAFT_SEARCH,
      isDefault: searchAreas.length === 0,
    })
    setSearchQuery('')
    setSearchPredictions([])
    searchSessionTokenRef.current = makeSessionToken()
  }, [searchAreas.length])

  const resetServiceDraft = useCallback(() => {
    setEditingId(null)
    setServiceDraft({
      ...EMPTY_DRAFT_SERVICE,
      isDefault: serviceAddresses.length === 0,
    })
    setServiceQuery('')
    setServicePredictions([])
    serviceSessionTokenRef.current = makeSessionToken()
  }, [serviceAddresses.length])

  useEffect(() => {
    if (!loading && searchAreas.length === 0 && !editingId) {
      setSearchDraft((prev) => ({ ...prev, isDefault: true }))
    }
  }, [loading, searchAreas.length, editingId])

  useEffect(() => {
    if (!loading && serviceAddresses.length === 0 && !editingId) {
      setServiceDraft((prev) => ({ ...prev, isDefault: true }))
    }
  }, [loading, serviceAddresses.length, editingId])

  const saveSearchArea = useCallback(async () => {
    try {
      setSaving(true)
      setErr(null)

      const payload = {
        kind: 'SEARCH_AREA' as const,
        label: searchDraft.label || null,
        isDefault: searchDraft.isDefault,
        formattedAddress: searchDraft.formattedAddress,
        city: searchDraft.city,
        state: searchDraft.state,
        postalCode: searchDraft.postalCode,
        countryCode: searchDraft.countryCode,
        placeId: searchDraft.placeId,
        lat: searchDraft.lat,
        lng: searchDraft.lng,
      }

      const isEdit = Boolean(editingId)
      const url = isEdit
        ? `/api/client/addresses/${encodeURIComponent(editingId!)}`
        : '/api/client/addresses'

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          pickErrorMessage(raw, 'Could not save search area.'),
        )
      }

      await loadAddresses()
      const updatedAddress = isRecord(raw) && isRecord(raw.address)
        ? parseAddresses({ addresses: [raw.address] })[0] ?? null
        : null

      if (updatedAddress?.isDefault) {
        applyDefaultSearchAreaToViewer(updatedAddress)
      } else if (!updatedAddress && searchDraft.isDefault) {
        const refreshed = await fetch('/api/client/addresses', {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        const refreshedRaw = await safeJson(refreshed)
        const next = parseAddresses(refreshedRaw)
          .find((a) => a.kind === 'SEARCH_AREA' && a.isDefault)
        if (next) applyDefaultSearchAreaToViewer(next)
      }

      resetSearchDraft()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save search area.')
    } finally {
      setSaving(false)
    }
  }, [
    searchDraft,
    editingId,
    loadAddresses,
    applyDefaultSearchAreaToViewer,
    resetSearchDraft,
  ])

  const saveServiceAddress = useCallback(async () => {
    try {
      setSaving(true)
      setErr(null)

      const payload = {
        kind: 'SERVICE_ADDRESS' as const,
        label: serviceDraft.label || null,
        isDefault: serviceDraft.isDefault,
        formattedAddress: serviceDraft.formattedAddress,
        addressLine1: serviceDraft.addressLine1,
        addressLine2: serviceDraft.addressLine2,
        city: serviceDraft.city,
        state: serviceDraft.state,
        postalCode: serviceDraft.postalCode,
        countryCode: serviceDraft.countryCode,
        placeId: serviceDraft.placeId,
        lat: serviceDraft.lat,
        lng: serviceDraft.lng,
      }

      const isEdit = Boolean(editingId)
      const url = isEdit
        ? `/api/client/addresses/${encodeURIComponent(editingId!)}`
        : '/api/client/addresses'

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(
          pickErrorMessage(raw, 'Could not save service address.'),
        )
      }

      await loadAddresses()
      resetServiceDraft()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save service address.')
    } finally {
      setSaving(false)
    }
  }, [serviceDraft, editingId, loadAddresses, resetServiceDraft])

  const startEdit = useCallback((address: AddressRecord) => {
    setErr(null)
    setEditingId(address.id)

    if (address.kind === 'SEARCH_AREA') {
      setSearchDraft(toDraftFromAddress(address))
      setSearchQuery(
        address.formattedAddress ||
          [address.city, address.state].filter(Boolean).join(', ') ||
          address.postalCode ||
          '',
      )
      setSearchPredictions([])
    } else {
      setServiceDraft(toDraftFromAddress(address))
      setServiceQuery(
        address.formattedAddress ||
          [
            address.addressLine1,
            address.city,
            address.state,
            address.postalCode,
          ]
            .filter(Boolean)
            .join(', ') ||
          '',
      )
      setServicePredictions([])
    }
  }, [])

  const setDefault = useCallback(async (address: AddressRecord) => {
    try {
      setSaving(true)
      setErr(null)

      const res = await fetch(
        `/api/client/addresses/${encodeURIComponent(address.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ isDefault: true }),
        },
      )

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(raw, 'Could not update default address.'))
      }

      await loadAddresses()

      if (address.kind === 'SEARCH_AREA') {
        const updated = parseAddresses({ addresses: [isRecord(raw) ? raw.address : null] })[0] ?? null
        if (updated) applyDefaultSearchAreaToViewer(updated)
      }
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : 'Could not update default address.',
      )
    } finally {
      setSaving(false)
    }
  }, [loadAddresses, applyDefaultSearchAreaToViewer])

  const removeAddress = useCallback(async (address: AddressRecord) => {
    try {
      setDeletingId(address.id)
      setErr(null)

      const res = await fetch(
        `/api/client/addresses/${encodeURIComponent(address.id)}`,
        {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        },
      )

      const raw = await safeJson(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(raw, 'Could not delete address.'))
      }

      await loadAddresses()
      if (editingId === address.id) {
        if (address.kind === 'SEARCH_AREA') resetSearchDraft()
        else resetServiceDraft()
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete address.')
    } finally {
      setDeletingId(null)
    }
  }, [editingId, loadAddresses, resetSearchDraft, resetServiceDraft])

  return (
    <div className="grid gap-6">
      {err ? (
        <div className="rounded-card border border-rose-400/20 bg-rose-500/10 p-3 text-sm font-semibold text-rose-200">
          {err}
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-black text-textPrimary">
              Search areas
            </div>
            <div className="mt-1 text-xs font-semibold text-textSecondary">
              Use ZIP or area-level places for salon discovery and nearby search.
            </div>
          </div>

          {defaultSearchArea ? (
            <div className="text-xs font-semibold text-textSecondary">
              Default:{' '}
              <span className="font-black text-textPrimary">
                {addressTitle(defaultSearchArea)}
              </span>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/10 p-3 text-sm font-semibold text-textSecondary">
            Loading saved areas…
          </div>
        ) : null}

        {searchAreas.length ? (
          <div className="grid gap-2">
            {searchAreas.map((address) => (
              <div
                key={address.id}
                className="rounded-card border border-white/10 bg-bgPrimary/10 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-textPrimary">
                        {addressTitle(address)}
                      </div>
                      {address.isDefault ? (
                        <span className="rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                          Default
                        </span>
                      ) : null}
                    </div>

                    {addressSubtitle(address) ? (
                      <div className="mt-1 text-xs font-semibold text-textSecondary">
                        {addressSubtitle(address)}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!address.isDefault ? (
                      <button
                        type="button"
                        onClick={() => void setDefault(address)}
                        disabled={saving}
                        className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary disabled:opacity-60"
                      >
                        Make default
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => startEdit(address)}
                      disabled={saving}
                      className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary disabled:opacity-60"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void removeAddress(address)}
                      disabled={deletingId === address.id || saving}
                      className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-rose-200 hover:text-rose-100 disabled:opacity-60"
                    >
                      {deletingId === address.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !loading ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/10 p-3 text-sm font-semibold text-textSecondary">
            No saved search areas yet.
          </div>
        ) : null}

        <div className="rounded-card border border-white/10 bg-bgPrimary/10 p-4">
          <div className="text-sm font-black text-textPrimary">
            {editingId && searchDraft.kind === 'SEARCH_AREA'
              ? 'Edit search area'
              : 'Add search area'}
          </div>

          <div className="mt-3 grid gap-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-textSecondary">
                Label
              </div>
              <input
                value={searchDraft.label}
                onChange={(e) =>
                  setSearchDraft((prev) => ({ ...prev, label: e.target.value }))
                }
                placeholder='Home area, Work area, "San Diego", etc.'
                className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
              />
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-textSecondary">
                Search by ZIP or area
              </div>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='ZIP code or city (e.g. "92101" or "San Diego")'
                className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
              />

              {isUsZip(searchQuery.trim()) ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void chooseSearchZip()}
                    disabled={searchLoading}
                    className="rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-1.5 text-xs font-black text-textPrimary hover:bg-white/10 disabled:opacity-60"
                  >
                    {searchLoading ? 'Resolving ZIP…' : `Use ZIP ${searchQuery.trim()}`}
                  </button>
                </div>
              ) : null}

              {searchLoading && !isUsZip(searchQuery.trim()) ? (
                <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                  Searching…
                </div>
              ) : null}

              {searchPredictions.length ? (
                <div className="mt-2 grid gap-2">
                  {searchPredictions.slice(0, 8).map((prediction) => (
                    <button
                      key={prediction.placeId}
                      type="button"
                      onClick={() => void chooseSearchPrediction(prediction)}
                      className="rounded-card border border-white/10 bg-bgPrimary/15 p-2 text-left hover:bg-white/5"
                    >
                      <div className="text-[13px] font-black text-textPrimary">
                        {prediction.mainText || prediction.description}
                      </div>
                      {prediction.secondaryText ? (
                        <div className="text-[12px] font-semibold text-textSecondary">
                          {prediction.secondaryText}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {(searchDraft.formattedAddress ||
              searchDraft.postalCode ||
              searchDraft.city ||
              searchDraft.state) ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-3">
                <div className="text-xs font-black uppercase tracking-wide text-textSecondary">
                  Selected area
                </div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {searchDraft.formattedAddress ||
                    [searchDraft.city, searchDraft.state]
                      .filter(Boolean)
                      .join(', ') ||
                    searchDraft.postalCode ||
                    'Selected area'}
                </div>
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm font-semibold text-textSecondary">
              <input
                type="checkbox"
                checked={searchDraft.isDefault}
                onChange={(e) =>
                  setSearchDraft((prev) => ({
                    ...prev,
                    isDefault: e.target.checked,
                  }))
                }
              />
              Make this my default search area
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={resetSearchDraft}
                disabled={saving}
                className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/40 disabled:opacity-60"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => void saveSearchArea()}
                disabled={
                  saving ||
                  !(
                    searchDraft.formattedAddress ||
                    searchDraft.postalCode ||
                    searchDraft.city ||
                    searchDraft.state ||
                    (searchDraft.lat != null && searchDraft.lng != null)
                  )
                }
                className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editingId && searchDraft.kind === 'SEARCH_AREA' ? 'Save area' : 'Add area'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-black text-textPrimary">
              Mobile service addresses
            </div>
            <div className="mt-1 text-xs font-semibold text-textSecondary">
              Required for at-home appointments. Salon-only browsing does not need this.
            </div>
          </div>

          {defaultServiceAddress ? (
            <div className="text-xs font-semibold text-textSecondary">
              Default:{' '}
              <span className="font-black text-textPrimary">
                {addressTitle(defaultServiceAddress)}
              </span>
            </div>
          ) : null}
        </div>

        {serviceAddresses.length ? (
          <div className="grid gap-2">
            {serviceAddresses.map((address) => {
              const mapsUrl = mapsHref(address)

              return (
                <div
                  key={address.id}
                  className="rounded-card border border-white/10 bg-bgPrimary/10 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-black text-textPrimary">
                          {addressTitle(address)}
                        </div>
                        {address.isDefault ? (
                          <span className="rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                            Default
                          </span>
                        ) : null}
                      </div>

                      {addressSubtitle(address) ? (
                        <div className="mt-1 text-xs font-semibold text-textSecondary">
                          {addressSubtitle(address)}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {mapsUrl ? (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary"
                        >
                          Open in Maps
                        </a>
                      ) : null}

                      {!address.isDefault ? (
                        <button
                          type="button"
                          onClick={() => void setDefault(address)}
                          disabled={saving}
                          className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary disabled:opacity-60"
                        >
                          Make default
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => startEdit(address)}
                        disabled={saving}
                        className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary disabled:opacity-60"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => void removeAddress(address)}
                        disabled={deletingId === address.id || saving}
                        className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-rose-200 hover:text-rose-100 disabled:opacity-60"
                      >
                        {deletingId === address.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-card border border-white/10 bg-bgPrimary/10 p-3 text-sm font-semibold text-textSecondary">
            No saved service addresses yet.
          </div>
        )}

        <div className="rounded-card border border-white/10 bg-bgPrimary/10 p-4">
          <div className="text-sm font-black text-textPrimary">
            {editingId && serviceDraft.kind === 'SERVICE_ADDRESS'
              ? 'Edit service address'
              : 'Add service address'}
          </div>

          <div className="mt-3 grid gap-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-textSecondary">
                Label
              </div>
              <input
                value={serviceDraft.label}
                onChange={(e) =>
                  setServiceDraft((prev) => ({ ...prev, label: e.target.value }))
                }
                placeholder='Home, Work, Hotel, Event, etc.'
                className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
              />
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-textSecondary">
                Search address
              </div>
              <input
                value={serviceQuery}
                onChange={(e) => setServiceQuery(e.target.value)}
                placeholder='Street address for at-home service'
                className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
              />

              {serviceLoading ? (
                <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                  Searching…
                </div>
              ) : null}

              {servicePredictions.length ? (
                <div className="mt-2 grid gap-2">
                  {servicePredictions.slice(0, 8).map((prediction) => (
                    <button
                      key={prediction.placeId}
                      type="button"
                      onClick={() => void chooseServicePrediction(prediction)}
                      className="rounded-card border border-white/10 bg-bgPrimary/15 p-2 text-left hover:bg-white/5"
                    >
                      <div className="text-[13px] font-black text-textPrimary">
                        {prediction.mainText || prediction.description}
                      </div>
                      {prediction.secondaryText ? (
                        <div className="text-[12px] font-semibold text-textSecondary">
                          {prediction.secondaryText}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {(serviceDraft.formattedAddress ||
              serviceDraft.addressLine1) ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary p-3">
                <div className="text-xs font-black uppercase tracking-wide text-textSecondary">
                  Selected address
                </div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {serviceDraft.formattedAddress ||
                    serviceDraft.addressLine1}
                </div>
                {serviceDraft.city || serviceDraft.state || serviceDraft.postalCode ? (
                  <div className="mt-1 text-xs font-semibold text-textSecondary">
                    {[serviceDraft.city, serviceDraft.state, serviceDraft.postalCode]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  Address line 1
                </div>
                <input
                  value={serviceDraft.addressLine1 ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      addressLine1: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  Address line 2
                </div>
                <input
                  value={serviceDraft.addressLine2 ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      addressLine2: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  City
                </div>
                <input
                  value={serviceDraft.city ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      city: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  State
                </div>
                <input
                  value={serviceDraft.state ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      state: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  ZIP / postal code
                </div>
                <input
                  value={serviceDraft.postalCode ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      postalCode: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-textSecondary">
                  Country
                </div>
                <input
                  value={serviceDraft.countryCode ?? ''}
                  onChange={(e) =>
                    setServiceDraft((prev) => ({
                      ...prev,
                      countryCode: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-textSecondary">
              <input
                type="checkbox"
                checked={serviceDraft.isDefault}
                onChange={(e) =>
                  setServiceDraft((prev) => ({
                    ...prev,
                    isDefault: e.target.checked,
                  }))
                }
              />
              Make this my default mobile service address
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={resetServiceDraft}
                disabled={saving}
                className="rounded-full border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold text-textPrimary hover:bg-bgSecondary/40 disabled:opacity-60"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => void saveServiceAddress()}
                disabled={
                  saving ||
                  !(
                    serviceDraft.formattedAddress ||
                    serviceDraft.addressLine1
                  )
                }
                className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold text-textPrimary hover:bg-bgSecondary/70 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editingId && serviceDraft.kind === 'SERVICE_ADDRESS' ? 'Save address' : 'Add address'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}