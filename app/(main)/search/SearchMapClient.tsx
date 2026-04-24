// app/(main)/search/SearchMapClient.tsx
'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { directionsHrefFromLocation, mapsHrefFromLocation } from '@/lib/maps'
import type { Bounds, Pin } from './_components/MapView'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'
import { isArray, isRecord } from '@/lib/guards'
import DiscoverCategoryRail from './_components/DiscoverCategoryRail'
import DiscoverGridView from './_components/DiscoverGridView'
import DiscoverViewToggle from './_components/DiscoverViewToggle'
import { fetchDiscoverCategories } from './_lib/discoverCategoryApi'
import type { DiscoverViewMode } from './_lib/discoverViewTypes'
import type { DiscoverCategoryOption } from '@/lib/discovery/categoryTypes'

type ApiPro = {
  id: string
  businessName: string | null
  professionType: string | null
  avatarUrl: string | null
  locationLabel: string | null
  distanceMiles: number | null
  primaryLocation: null | {
    id: string
    formattedAddress: string | null
    city: string | null
    state: string | null
    timeZone: string | null
    lat: number | null
    lng: number | null
    placeId: string | null
  }
}

type Coords = { lat: number; lng: number }

type SearchArgs = {
  query: string
  origin: Coords | null
  categoryId: string | null
}

type PlacesPrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
  distanceMeters: number | null
}

type ResolvedPlace = {
  coords: Coords
  label: string
  viewport: Bounds | null
}

type SortMode = 'DISTANCE' | 'NAME'

const MapView = dynamic(() => import('./_components/MapView'), { ssr: false })

const APP_BOTTOM_INSET = 'max(var(--app-footer-space, 0px), env(safe-area-inset-bottom))'

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isBounds(value: unknown): value is Bounds {
  if (!isRecord(value)) return false

  return (
    typeof value.north === 'number' &&
    typeof value.south === 'number' &&
    typeof value.east === 'number' &&
    typeof value.west === 'number'
  )
}

function isPrimaryLocation(value: unknown): value is ApiPro['primaryLocation'] {
  if (value === null) return true
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isNullableString(value.formattedAddress) &&
    isNullableString(value.city) &&
    isNullableString(value.state) &&
    isNullableString(value.timeZone) &&
    isNullableNumber(value.lat) &&
    isNullableNumber(value.lng) &&
    isNullableString(value.placeId)
  )
}

function isApiPro(value: unknown): value is ApiPro {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isNullableString(value.businessName) &&
    isNullableString(value.professionType) &&
    isNullableString(value.avatarUrl) &&
    isNullableString(value.locationLabel) &&
    isNullableNumber(value.distanceMiles) &&
    isPrimaryLocation(value.primaryLocation)
  )
}

function isSortMode(value: string): value is SortMode {
  return value === 'DISTANCE' || value === 'NAME'
}

function nearlyEqual(a: number, b: number, eps = 1e-5) {
  return Math.abs(a - b) < eps
}

function coordsEqual(a: Coords | null, b: Coords, eps = 1e-5) {
  if (!a) return false
  return nearlyEqual(a.lat, b.lat, eps) && nearlyEqual(a.lng, b.lng, eps)
}

function haversineMiles(a: Coords, b: Coords) {
  const radiusMiles = 3958.7613
  const toRad = (degrees: number) => (degrees * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)

  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))

  return radiusMiles * c
}

function isUsZip(input: string) {
  return /^\d{5}(?:-\d{4})?$/.test(input.trim())
}

function zoomForRadiusMiles(radiusMiles: number) {
  if (radiusMiles <= 5) return 12
  if (radiusMiles <= 10) return 11
  if (radiusMiles <= 15) return 11
  if (radiusMiles <= 25) return 10
  return 9
}

function newSessionToken() {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

function splitQueryAndLocation(raw: string): { query: string; location: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { query: '', location: null }

  if (trimmed.startsWith('@')) {
    const location = trimmed.slice(1).trim()
    return { query: '', location: location || null }
  }

  const zipMatch = trimmed.match(/\b\d{5}(?:-\d{4})?\b/)
  if (zipMatch) {
    const zip = zipMatch[0]
    const query = trimmed.replace(zip, '').replace(/\s{2,}/g, ' ').trim()
    return { query, location: zip }
  }

  const locationMatch = trimmed.match(/\b(?:near|in|at)\b\s+(.+)$/i)
  if (locationMatch && locationMatch[1]) {
    const location = locationMatch[1].trim()
    const matchIndex = typeof locationMatch.index === 'number' ? locationMatch.index : 0
    const query = trimmed.slice(0, matchIndex).trim()
    return { query, location: location || null }
  }

  return { query: trimmed, location: null }
}

function tokenize(value: string) {
  return value.trim().split(/\s+/).filter(Boolean)
}

const SERVICE_LEAD_WORDS = new Set([
  'lash',
  'lashes',
  'hair',
  'haircut',
  'cut',
  'color',
  'balayage',
  'highlights',
  'blowout',
  'braids',
  'barber',
  'nail',
  'nails',
  'manicure',
  'pedicure',
  'facial',
  'skincare',
  'esthetician',
  'brow',
  'brows',
  'makeup',
  'wax',
  'waxing',
  'massage',
  'spraytan',
  'tanning',
])

function looksServiceLed(raw: string) {
  const tokens = tokenize(raw)
  if (!tokens.length) return false

  return SERVICE_LEAD_WORDS.has(tokens[0].toLowerCase())
}

function deriveAutocompleteTarget(raw: string): { serviceText: string; locationText: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const { query, location } = splitQueryAndLocation(trimmed)
  if (location) {
    return {
      serviceText: query.trim(),
      locationText: location.trim(),
    }
  }

  const tokens = tokenize(trimmed)
  if (!tokens.length) return null

  if (!looksServiceLed(trimmed)) {
    return {
      serviceText: '',
      locationText: trimmed,
    }
  }

  if (tokens.length === 1) return null

  const locationWordCount = Math.min(4, tokens.length - 1)
  const locationText = tokens.slice(tokens.length - locationWordCount).join(' ')
  const serviceText = tokens.slice(0, tokens.length - locationWordCount).join(' ').trim()

  return { serviceText, locationText }
}

function normalizePrediction(value: unknown): PlacesPrediction | null {
  if (!isRecord(value)) return null

  const placeId = typeof value.placeId === 'string' ? value.placeId : ''
  const description = typeof value.description === 'string' ? value.description : ''

  if (!placeId || !description) return null

  const mainText = typeof value.mainText === 'string' ? value.mainText : description
  const secondaryText = typeof value.secondaryText === 'string' ? value.secondaryText : ''
  const types = isArray(value.types) ? value.types.filter((type): type is string => typeof type === 'string') : []
  const distanceMeters = typeof value.distanceMeters === 'number' ? value.distanceMeters : null

  return {
    placeId,
    description,
    mainText,
    secondaryText,
    types,
    distanceMeters,
  }
}

function parseResolvedPlace(raw: unknown): ResolvedPlace | null {
  if (!isRecord(raw)) return null

  const place = raw.place
  if (!isRecord(place)) return null

  const lat = typeof place.lat === 'number' ? place.lat : null
  const lng = typeof place.lng === 'number' ? place.lng : null

  if (lat == null || lng == null) return null

  const viewport = isBounds(place.viewport) ? place.viewport : null
  const name = typeof place.name === 'string' ? place.name : ''
  const formattedAddress = typeof place.formattedAddress === 'string' ? place.formattedAddress : ''
  const label = formattedAddress || name || 'Selected place'

  return {
    coords: { lat, lng },
    label,
    viewport,
  }
}

function sortPros(list: ApiPro[], mode: SortMode): ApiPro[] {
  const sorted = [...list]

  if (mode === 'NAME') {
    sorted.sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
    return sorted
  }

  sorted.sort((a, b) => {
    const aDistance = typeof a.distanceMiles === 'number' ? a.distanceMiles : Number.POSITIVE_INFINITY
    const bDistance = typeof b.distanceMiles === 'number' ? b.distanceMiles : Number.POSITIVE_INFINITY

    return aDistance - bDistance
  })

  return sorted
}

export default function SearchMapClient() {
  const [q, setQ] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(15)
  const [sortMode, setSortMode] = useState<SortMode>('DISTANCE')

  const [categories, setCategories] = useState<DiscoverCategoryOption[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<DiscoverViewMode>('MAP')

  const [me, setMe] = useState<Coords | null>(null)
  const [geoDenied, setGeoDenied] = useState(false)

  const [mapCenter, setMapCenter] = useState<Coords | null>(null)
  const [origin, setOrigin] = useState<Coords | null>(null)
  const [originLabel, setOriginLabel] = useState<string>('')
  const [fitBounds, setFitBounds] = useState<Bounds | null>(null)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [pros, setPros] = useState<ApiPro[]>([])

  const [activeProId, setActiveProId] = useState<string | null>(null)
  const activePro = useMemo(() => pros.find((pro) => pro.id === activeProId) ?? null, [pros, activeProId])

  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const focusTimerRef = useRef<number | null>(null)

  const reqIdRef = useRef(0)
  const inFlightRef = useRef<AbortController | null>(null)
  const lastSearchRef = useRef<SearchArgs>({ query: '', origin: null, categoryId: null })
  const radiusMilesRef = useRef(radiusMiles)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const acRootRef = useRef<HTMLDivElement | null>(null)
  const [placeSessionToken, setPlaceSessionToken] = useState(() => newSessionToken())
  const [acOpen, setAcOpen] = useState(false)
  const [acLoading, setAcLoading] = useState(false)
  const [acPreds, setAcPreds] = useState<PlacesPrediction[]>([])
  const [acIndex, setAcIndex] = useState(-1)
  const acAbortRef = useRef<AbortController | null>(null)

  const [acEnabled, setAcEnabled] = useState(true)

  useEffect(() => {
    radiusMilesRef.current = radiusMiles
  }, [radiusMiles])

  const displayPros = useMemo(() => sortPros(pros, sortMode), [pros, sortMode])

  const pins: Pin[] = useMemo(() => {
    const nextPins: Pin[] = []

    for (const pro of pros) {
      const lat = pro.primaryLocation?.lat ?? null
      const lng = pro.primaryLocation?.lng ?? null

      if (lat == null || lng == null) continue

      nextPins.push({
        id: pro.id,
        lat,
        lng,
        label: pro.businessName || 'Beauty professional',
        sublabel: pro.locationLabel || pro.professionType || '',
        active: pro.id === activeProId,
      })
    }

    return nextPins
  }, [pros, activeProId])

  const runSearch = useCallback(async (args: SearchArgs) => {
    const myReqId = ++reqIdRef.current

    inFlightRef.current?.abort()

    const controller = new AbortController()
    inFlightRef.current = controller

    setLoading(true)
    setErr(null)

    try {
      const qs = new URLSearchParams()

      qs.set('tab', 'PROS')
      qs.set('radiusMiles', String(radiusMilesRef.current))

      if (args.query) qs.set('q', args.query)
      if (args.categoryId) qs.set('categoryId', args.categoryId)

      if (args.origin) {
        qs.set('lat', String(args.origin.lat))
        qs.set('lng', String(args.origin.lng))
      }

      const res = await fetch(`/api/search?${qs.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })

      const body = await safeJson(res)

      if (reqIdRef.current !== myReqId) return

      if (!res.ok || !isRecord(body) || body.ok !== true) {
        const message = isRecord(body) && typeof body.error === 'string' ? body.error : 'Search failed.'
        throw new Error(message)
      }

      const rawPros = isArray(body.pros) ? body.pros : []
      const nextPros = rawPros.filter(isApiPro)

      setPros(nextPros)

      const firstPinnedPro = nextPros.find((pro) => pro.primaryLocation?.lat != null && pro.primaryLocation?.lng != null)
      setActiveProId((prev) => (prev && nextPros.some((pro) => pro.id === prev) ? prev : firstPinnedPro?.id ?? null))
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      const message = error instanceof Error ? error.message : 'Search failed.'

      setErr(message)
      setPros([])
      setActiveProId(null)
    } finally {
      if (reqIdRef.current === myReqId) setLoading(false)
      if (inFlightRef.current === controller) inFlightRef.current = null
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadCategories() {
      try {
        const nextCategories = await fetchDiscoverCategories(controller.signal)
        setCategories(nextCategories)
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return

        console.error('Failed to load discover categories', error)
        setCategories([])
      }
    }

    void loadCategories()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)

      inFlightRef.current?.abort()
      acAbortRef.current?.abort()
    }
  }, [])

  const handleViewportChange = useCallback((center: Coords) => {
    setMapCenter((prev) => (coordsEqual(prev, center) ? prev : center))
  }, [])

  useEffect(() => {
    if (!acOpen) return

    const onDown = (event: PointerEvent) => {
      const root = acRootRef.current

      if (!root) return
      if (!(event.target instanceof Node)) return
      if (root.contains(event.target)) return

      setAcOpen(false)
    }

    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [acOpen])

  const didInitialSearchRef = useRef(false)

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoDenied(true)
      setMe(null)
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }

        setMe(coords)
        setGeoDenied(false)

        if (!didInitialSearchRef.current) {
          didInitialSearchRef.current = true
          setOrigin(coords)
          setOriginLabel('Near you')
          setFitBounds(null)

          const nextSearch: SearchArgs = {
            query: '',
            origin: coords,
            categoryId: null,
          }

          lastSearchRef.current = nextSearch
          void runSearch(nextSearch)
        }
      },
      () => {
        setGeoDenied(true)
        setMe(null)
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
      },
    )
  }, [runSearch])

  const didRadiusEffectRunRef = useRef(false)

  useEffect(() => {
    if (!didRadiusEffectRunRef.current) {
      didRadiusEffectRunRef.current = true
      return
    }

    void runSearch(lastSearchRef.current)
  }, [radiusMiles, runSearch])

  const applyOrigin = useCallback((resolved: ResolvedPlace, zoom?: number) => {
    setOrigin(resolved.coords)
    setOriginLabel(resolved.label)
    setFitBounds(resolved.viewport)
    setFocus({ lat: resolved.coords.lat, lng: resolved.coords.lng, zoom })

    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
    focusTimerRef.current = window.setTimeout(() => setFocus(null), 300)
  }, [])

  const resolvePlaceFromText = useCallback(
    async (locationText: string): Promise<ResolvedPlace | null> => {
      const location = locationText.trim()
      if (!location) return null

      const sessionToken = newSessionToken()
      const kind = isUsZip(location) ? 'AREA' : 'ANY'
      const bias = mapCenter ?? origin ?? me

      const autocompleteParams = new URLSearchParams({
        input: location,
        sessionToken,
        kind,
        components: 'country:us',
      })

      if (bias) {
        autocompleteParams.set('lat', String(bias.lat))
        autocompleteParams.set('lng', String(bias.lng))
        autocompleteParams.set('radiusMeters', '50000')
      }

      const autocompleteRes = await fetch(`/api/google/places/autocomplete?${autocompleteParams.toString()}`, {
        cache: 'no-store',
      })

      const autocompleteBody = await safeJson(autocompleteRes)

      if (!autocompleteRes.ok || !isRecord(autocompleteBody) || !isArray(autocompleteBody.predictions)) {
        return null
      }

      const predictions = autocompleteBody.predictions
        .map(normalizePrediction)
        .filter((prediction): prediction is PlacesPrediction => Boolean(prediction))

      if (!predictions.length) return null

      const chosen = predictions[0]
      const detailsParams = new URLSearchParams({
        placeId: chosen.placeId,
        sessionToken,
      })

      const detailsRes = await fetch(`/api/google/places/details?${detailsParams.toString()}`, {
        cache: 'no-store',
      })

      const detailsBody = await safeJson(detailsRes)

      if (!detailsRes.ok || !isRecord(detailsBody)) return null

      return parseResolvedPlace(detailsBody)
    },
    [mapCenter, origin, me],
  )

  const acTarget = useMemo(() => deriveAutocompleteTarget(q), [q])

  useEffect(() => {
    if (!acEnabled) {
      setAcOpen(false)
      setAcPreds([])
      setAcIndex(-1)
      setAcLoading(false)
      acAbortRef.current?.abort()
      acAbortRef.current = null
      return
    }

    const target = acTarget?.locationText?.trim() ?? ''

    if (!target || target.length < 2) {
      setAcPreds([])
      setAcOpen(false)
      setAcIndex(-1)
      setAcLoading(false)
      acAbortRef.current?.abort()
      acAbortRef.current = null
      return
    }

    setAcLoading(true)

    const timer = window.setTimeout(async () => {
      acAbortRef.current?.abort()

      const controller = new AbortController()
      acAbortRef.current = controller

      try {
        const kind = isUsZip(target) ? 'AREA' : 'ANY'
        const bias = mapCenter ?? origin ?? me

        const params = new URLSearchParams({
          input: target,
          kind,
          sessionToken: placeSessionToken,
          components: 'country:us',
        })

        if (bias) {
          params.set('lat', String(bias.lat))
          params.set('lng', String(bias.lng))
          params.set('radiusMeters', '50000')
        }

        const res = await fetch(`/api/google/places/autocomplete?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })

        const body = await safeJson(res)

        if (!res.ok || !isRecord(body) || !isArray(body.predictions)) {
          setAcPreds([])
          setAcOpen(false)
          setAcIndex(-1)
          return
        }

        const predictions = body.predictions
          .map(normalizePrediction)
          .filter((prediction): prediction is PlacesPrediction => Boolean(prediction))

        setAcPreds(predictions)
        setAcOpen(predictions.length > 0)
        setAcIndex(predictions.length > 0 ? 0 : -1)
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return

        setAcPreds([])
        setAcOpen(false)
        setAcIndex(-1)
      } finally {
        setAcLoading(false)
      }
    }, 220)

    return () => window.clearTimeout(timer)
  }, [acEnabled, acTarget?.locationText, mapCenter, origin, me, placeSessionToken])

  const commitSelection = useCallback(
    async (prediction: PlacesPrediction) => {
      setAcOpen(false)
      setAcPreds([])
      setAcIndex(-1)

      const sessionToken = placeSessionToken
      const detailsParams = new URLSearchParams({
        placeId: prediction.placeId,
        sessionToken,
      })

      const detailsRes = await fetch(`/api/google/places/details?${detailsParams.toString()}`, {
        cache: 'no-store',
      })

      const detailsBody = await safeJson(detailsRes)

      if (!detailsRes.ok || !isRecord(detailsBody)) return

      const resolved = parseResolvedPlace(detailsBody)
      if (!resolved) return

      const serviceText = acTarget?.serviceText?.trim() ?? splitQueryAndLocation(q).query.trim()
      const nextInput = serviceText ? `${serviceText} near ${prediction.description}` : prediction.description

      setQ(nextInput)
      setAcEnabled(false)

      applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMilesRef.current))

      const nextSearch: SearchArgs = {
        query: serviceText,
        origin: resolved.coords,
        categoryId: activeCategoryId,
      }

      lastSearchRef.current = nextSearch
      void runSearch(nextSearch)

      setPlaceSessionToken(newSessionToken())

      window.setTimeout(() => inputRef.current?.focus(), 0)
    },
    [placeSessionToken, acTarget, q, applyOrigin, activeCategoryId, runSearch],
  )

  const inferAndSearch = useCallback(async () => {
    setAcOpen(false)

    const raw = q.trim()

    if (!raw) {
      const fallbackOrigin = lastSearchRef.current.origin ?? origin ?? mapCenter ?? me
      const nextSearch: SearchArgs = {
        query: '',
        origin: fallbackOrigin ?? null,
        categoryId: activeCategoryId,
      }

      lastSearchRef.current = nextSearch
      void runSearch(nextSearch)
      return
    }

    const { query, location } = splitQueryAndLocation(raw)

    if (location) {
      const resolved = await resolvePlaceFromText(location)

      if (resolved) {
        applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMilesRef.current))

        const nextSearch: SearchArgs = {
          query: query.trim(),
          origin: resolved.coords,
          categoryId: activeCategoryId,
        }

        lastSearchRef.current = nextSearch
        void runSearch(nextSearch)
        return
      }
    }

    if (!looksServiceLed(raw)) {
      const resolved = await resolvePlaceFromText(raw)

      if (resolved) {
        applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMilesRef.current))

        const nextSearch: SearchArgs = {
          query: '',
          origin: resolved.coords,
          categoryId: activeCategoryId,
        }

        lastSearchRef.current = nextSearch
        void runSearch(nextSearch)
        return
      }
    }

    const tokens = tokenize(raw)

    if (tokens.length >= 2) {
      const maxLocationWords = Math.min(4, tokens.length - 1)

      for (let locationWordCount = maxLocationWords; locationWordCount >= 1; locationWordCount -= 1) {
        const locationText = tokens.slice(tokens.length - locationWordCount).join(' ')
        const serviceText = tokens.slice(0, tokens.length - locationWordCount).join(' ').trim()
        const resolved = await resolvePlaceFromText(locationText)

        if (resolved) {
          applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMilesRef.current))

          const nextSearch: SearchArgs = {
            query: serviceText,
            origin: resolved.coords,
            categoryId: activeCategoryId,
          }

          lastSearchRef.current = nextSearch
          void runSearch(nextSearch)
          return
        }
      }
    }

    const fallbackOrigin = lastSearchRef.current.origin ?? origin ?? mapCenter ?? me
    const nextSearch: SearchArgs = {
      query: raw,
      origin: fallbackOrigin ?? null,
      categoryId: activeCategoryId,
    }

    lastSearchRef.current = nextSearch
    void runSearch(nextSearch)
  }, [q, origin, mapCenter, me, applyOrigin, activeCategoryId, runSearch, resolvePlaceFromText])

  const handleSelectCategory = useCallback(
    (category: DiscoverCategoryOption) => {
      const nextCategoryId = category.kind === 'ALL' ? null : category.id

      setActiveCategoryId(nextCategoryId)

      const nextSearch: SearchArgs = {
        ...lastSearchRef.current,
        categoryId: nextCategoryId,
      }

      lastSearchRef.current = nextSearch
      void runSearch(nextSearch)
    },
    [runSearch],
  )

  const headerHint = useMemo(() => {
    if (loading) return 'Finding pros...'
    if (err) return 'Search failed'
    if (!pros.length) return 'No results'

    return `${pros.length} pro${pros.length === 1 ? '' : 's'}`
  }, [loading, err, pros.length])

  const showSearchArea = useMemo(() => {
    if (viewMode !== 'MAP') return false
    if (!mapCenter || !origin) return false

    return haversineMiles(mapCenter, origin) >= 0.35
  }, [viewMode, mapCenter, origin])

  const activeNavHref = useMemo(() => {
    if (!activePro) return null

    const location = activePro.primaryLocation

    return directionsHrefFromLocation({
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      placeId: location?.placeId ?? null,
      formattedAddress: location?.formattedAddress ?? null,
      name: activePro.businessName ?? null,
    })
  }, [activePro])

  const activeOpenHref = useMemo(() => {
    if (!activePro) return null

    const location = activePro.primaryLocation

    return mapsHrefFromLocation({
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      placeId: location?.placeId ?? null,
      formattedAddress: location?.formattedAddress ?? null,
      name: activePro.businessName ?? null,
    })
  }, [activePro])

  const handleSelectPin = useCallback((id: string) => {
    setActiveProId(id)

    const element = itemRefs.current[id]
    if (element && listRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [])

  const handleSelectList = useCallback((pro: ApiPro) => {
    setActiveProId(pro.id)

    const lat = pro.primaryLocation?.lat ?? null
    const lng = pro.primaryLocation?.lng ?? null

    if (lat != null && lng != null) {
      setFocus({ lat, lng })

      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = window.setTimeout(() => setFocus(null), 250)
    }
  }, [])

  const handleSelectGridPro = useCallback(
    (pro: { id: string }) => {
      const selectedPro = displayPros.find((item) => item.id === pro.id)
      if (!selectedPro) return

      handleSelectList(selectedPro)
    },
    [displayPros, handleSelectList],
  )

  return (
    <main className="mx-auto max-w-240 px-0 pb-0 pt-0">
      <div
        className="relative w-full overflow-hidden bg-bgPrimary"
        style={{ height: `calc(100dvh - ${APP_BOTTOM_INSET})` }}
      >
        {viewMode === 'MAP' ? (
          <div className="absolute inset-0 z-0">
            <MapView
              me={me}
              origin={origin}
              fitBounds={fitBounds}
              radiusMiles={radiusMiles}
              pins={pins}
              focus={focus}
              onSelectPin={handleSelectPin}
              onViewportChange={(center) => handleViewportChange(center)}
              enableClustering
            />
          </div>
        ) : (
          <div className="absolute inset-0 z-0 bg-bgPrimary" />
        )}

        <div
          className={cn(
            'pointer-events-none absolute left-0 right-0 top-0 z-10 h-[190px]',
            'bg-gradient-to-b from-black/60 via-black/25 to-transparent',
          )}
        />

        <div className="absolute left-0 right-0 top-0 z-20 px-3 pt-3">
          <div
            ref={acRootRef}
            className={cn(
              'tovis-glass-strong rounded-card border border-white/12 bg-bgSecondary/80 p-3 backdrop-blur-xl',
              'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-black tracking-wide text-textPrimary/85">Search</div>

                <div
                  className={cn(
                    'mt-1 flex items-center gap-2 rounded-2xl px-3 py-2',
                    'border border-white/12 bg-bgPrimary/20 backdrop-blur-xl',
                    'shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]',
                    'transition-colors transition-shadow duration-200',
                    'focus-within:border-white/20',
                    'focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),_0_0_0_3px_rgba(var(--accent-primary),0.25)]',
                  )}
                >
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(event) => {
                      setQ(event.target.value)
                      setAcEnabled(true)
                      setAcOpen(true)
                    }}
                    onFocus={() => {
                      if (acEnabled && acPreds.length) setAcOpen(true)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setAcOpen(false), 120)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setAcIndex((index) => Math.min(acPreds.length - 1, Math.max(0, index + 1)))
                        return
                      }

                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setAcIndex((index) => Math.max(0, index - 1))
                        return
                      }

                      if (event.key === 'Escape') {
                        setAcOpen(false)
                        return
                      }

                      if (event.key === 'Enter') {
                        event.preventDefault()

                        if (acOpen && acPreds.length > 0 && acIndex >= 0 && acIndex < acPreds.length) {
                          void commitSelection(acPreds[acIndex])
                          return
                        }

                        void inferAndSearch()
                      }
                    }}
                    placeholder={'ZIP, city, neighborhood, landmark, or "lashes 92024"'}
                    className={cn(
                      'w-full bg-transparent text-[14px] font-semibold text-textPrimary',
                      'outline-none placeholder:text-textPrimary/60',
                    )}
                  />

                  {q ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQ('')
                        setAcEnabled(true)
                        setAcOpen(false)
                        setAcPreds([])
                        setAcIndex(-1)
                      }}
                      className="rounded-full px-2 py-1 text-[12px] font-black text-textPrimary/70 hover:bg-white/10"
                      aria-label="Clear search"
                    >
                      x
                    </button>
                  ) : null}

                  {acLoading ? (
                    <span className="select-none text-[12px] font-black text-textPrimary/70" aria-hidden>
                      ...
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-textSecondary">
                    {origin ? `Searching near: ${originLabel}` : 'Pick a place to set origin.'}
                  </div>

                  {geoDenied ? (
                    <div className="text-[12px] font-semibold text-microAccent">
                      Location off - place searches still work.
                    </div>
                  ) : null}
                </div>

                {acOpen && acPreds.length > 0 ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-white/12 bg-bgPrimary/45 backdrop-blur-xl">
                    {acPreds.slice(0, 8).map((prediction, index) => (
                      <button
                        key={prediction.placeId}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          void commitSelection(prediction)
                        }}
                        onMouseEnter={() => setAcIndex(index)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition',
                          index === acIndex ? 'bg-white/10' : 'bg-transparent hover:bg-white/10',
                          'border-b border-white/10 last:border-b-0',
                        )}
                      >
                        <div className="text-[13px] font-black text-textPrimary">{prediction.mainText}</div>
                        <div className="text-[12px] font-semibold text-textSecondary">
                          {prediction.secondaryText || prediction.description}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <div className="text-[11px] font-extrabold text-textPrimary/70">{headerHint}</div>

                <div className="flex items-center gap-2">
                  <select
                    value={radiusMiles}
                    onChange={(event) => setRadiusMiles(Number(event.target.value))}
                    className={cn(
                      'rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2',
                      'text-[12px] font-black text-textPrimary outline-none',
                    )}
                    aria-label="Search radius"
                  >
                    <option value={5}>5 mi</option>
                    <option value={10}>10 mi</option>
                    <option value={15}>15 mi</option>
                    <option value={25}>25 mi</option>
                    <option value={50}>50 mi</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => void inferAndSearch()}
                    className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Go
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={sortMode}
                    onChange={(event) => {
                      if (isSortMode(event.target.value)) {
                        setSortMode(event.target.value)
                      }
                    }}
                    className={cn(
                      'rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2',
                      'text-[12px] font-black text-textPrimary outline-none',
                    )}
                    aria-label="Sort"
                  >
                    <option value="DISTANCE">Sort: Distance</option>
                    <option value="NAME">Sort: Name</option>
                  </select>

                  {me ? (
                    <button
                      type="button"
                      onClick={() => {
                        const nextSearch: SearchArgs = {
                          query: lastSearchRef.current.query,
                          origin: me,
                          categoryId: activeCategoryId,
                        }

                        setOrigin(me)
                        setOriginLabel('Near you')
                        setFitBounds(null)

                        lastSearchRef.current = nextSearch
                        void runSearch(nextSearch)
                      }}
                      className="rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                    >
                      Use me
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <DiscoverViewToggle value={viewMode} onChange={setViewMode} />

              <div className="shrink-0 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-textSecondary">
                Trending
              </div>
            </div>

            {categories.length > 0 ? (
              <div className="mt-3">
                <DiscoverCategoryRail
                  categories={categories}
                  activeCategoryId={activeCategoryId}
                  onSelectCategory={handleSelectCategory}
                />
              </div>
            ) : null}

            {showSearchArea ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    if (!mapCenter) return

                    const nextSearch: SearchArgs = {
                      query: lastSearchRef.current.query,
                      origin: mapCenter,
                      categoryId: activeCategoryId,
                    }

                    setOrigin(mapCenter)
                    setOriginLabel('Map center')
                    setFitBounds(null)

                    lastSearchRef.current = nextSearch
                    void runSearch(nextSearch)
                  }}
                  className={cn(
                    'rounded-full px-4 py-2 text-[12px] font-black',
                    'border border-white/15 bg-bgPrimary/25 backdrop-blur-xl',
                    'text-textPrimary',
                    'shadow-[0_14px_40px_rgba(0,0,0,0.55)]',
                    'transition hover:bg-white/10',
                  )}
                >
                  Search this area
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {viewMode === 'GRID' ? (
          <div
            className="absolute left-0 right-0 z-10 overflow-y-auto px-3 pb-4 pt-3"
            style={{
              top: 178,
              bottom: APP_BOTTOM_INSET,
            }}
          >
            {err ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4 text-[13px] font-semibold text-microAccent">
                {err}
              </div>
            ) : loading ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4 text-[13px] font-semibold text-textSecondary">
                Loading...
              </div>
            ) : (
              <DiscoverGridView pros={displayPros} activeProId={activeProId} onSelectPro={handleSelectGridPro} />
            )}
          </div>
        ) : null}

        {viewMode === 'MAP' ? (
          <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: APP_BOTTOM_INSET, paddingBottom: 12 }}>
            <div className="tovis-glass-strong rounded-card border border-white/10 bg-bgSecondary p-3">
              {err ? (
                <div className="text-[13px] font-semibold text-microAccent">{err}</div>
              ) : loading ? (
                <div className="text-[13px] font-semibold text-textSecondary">Loading...</div>
              ) : !displayPros.length ? (
                <div className="text-[13px] font-semibold text-textSecondary">
                  No pros found in this radius. Try increasing the distance or searching a different area.
                </div>
              ) : (
                <>
                  {activePro ? (
                    <div className="mb-3 rounded-card border border-white/10 bg-bgPrimary/25 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-black text-textPrimary">
                            {activePro.businessName || 'Beauty professional'}
                          </div>

                          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                            {(activePro.professionType || 'Professional') +
                              (activePro.locationLabel ? ` - ${activePro.locationLabel}` : '')}
                          </div>

                          {typeof activePro.distanceMiles === 'number' ? (
                            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                              {activePro.distanceMiles.toFixed(1)} miles away
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            href={`/professionals/${encodeURIComponent(activePro.id)}`}
                            className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                          >
                            View
                          </Link>

                          {activeOpenHref ? (
                            <a
                              href={activeOpenHref}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                            >
                              Open
                            </a>
                          ) : null}

                          {activeNavHref ? (
                            <a
                              href={activeNavHref}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
                            >
                              Navigate
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div ref={listRef} className="overlayScroll max-h-[34dvh] overflow-y-auto pr-1">
                    <div className="grid gap-2">
                      {displayPros.slice(0, 30).map((pro) => {
                        const active = pro.id === activeProId
                        const hasPin = pro.primaryLocation?.lat != null && pro.primaryLocation?.lng != null

                        return (
                          <button
                            key={pro.id}
                            ref={(element) => {
                              itemRefs.current[pro.id] = element
                            }}
                            type="button"
                            onClick={() => handleSelectList(pro)}
                            className={cn(
                              'w-full rounded-card border border-white/10 p-3 text-left transition',
                              active ? 'bg-white/10' : 'bg-bgPrimary/25 hover:bg-white/10',
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-black text-textPrimary">
                                  {pro.businessName || 'Beauty professional'}
                                </div>

                                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                                  {(pro.professionType || 'Professional') +
                                    (pro.locationLabel ? ` - ${pro.locationLabel}` : '')}
                                  {!hasPin ? <span className="ml-2 text-microAccent">- no pin</span> : null}
                                </div>
                              </div>

                              {typeof pro.distanceMiles === 'number' ? (
                                <div className="shrink-0 text-[12px] font-black text-textSecondary">
                                  {pro.distanceMiles.toFixed(1)} mi
                                </div>
                              ) : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}