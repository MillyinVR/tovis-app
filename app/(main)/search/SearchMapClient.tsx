// app/(main)/search/SearchMapClient.tsx
'use client'

import dynamic from 'next/dynamic'
import { ChevronDown, MapPin, Search, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { directionsHrefFromLocation, mapsHrefFromLocation } from '@/lib/maps'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { useMediaQuery } from '@/lib/ui/useMediaQuery'
import { MEDIA } from '@/lib/ui/breakpoints'
import type { Bounds, Pin } from './_components/MapView'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'
import { isArray, isRecord } from '@/lib/guards'
import DiscoverCategoryRail from './_components/DiscoverCategoryRail'
import DiscoverGridView from './_components/DiscoverGridView'
import DiscoverViewToggle from './_components/DiscoverViewToggle'
import DiscoverModeToggle from './_components/DiscoverModeToggle'
import TrendingProRail from './_components/TrendingProRail'
import TrendingTagsRail from './_components/TrendingTagsRail'
import LooksBookableGrid from './_components/LooksBookableGrid'
import DiscoverProRows from './_components/DiscoverProRows'
import DiscoverActiveProCard from './_components/DiscoverActiveProCard'
import { fetchDiscoverCategories } from './_lib/discoverCategoryApi'
import { preferredProLocation, type ApiLocationPreview, type ApiPro } from './_lib/discoverProTypes'
import { isSortMode, sortPros, type SortMode } from './_lib/discoverSort'
import type { DiscoverMode, DiscoverViewMode } from './_lib/discoverViewTypes'
import type { DiscoverCategoryOption } from '@/lib/discovery/categoryTypes'

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

const MapView = dynamic(() => import('./_components/MapView'), { ssr: false })

const APP_BOTTOM_INSET = 'max(var(--app-footer-space, 0px), env(safe-area-inset-bottom))'

// Compact branded loader for the discover panels (grid + map bottom card),
// where BrandLoader's full splash is too tall. Reuses the app's spinner idiom
// (animate-spin ring) with brand tokens only.
function DiscoverLoadingRow() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-[13px] font-semibold text-textSecondary"
    >
      <span
        aria-hidden
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-surfaceGlass/30 border-t-accentPrimary"
      />
      Finding pros nearby…
    </div>
  )
}

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

function isLocationPreview(value: unknown): value is ApiLocationPreview | null {
  if (value === null) return true
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isNullableString(value.formattedAddress) &&
    isNullableString(value.city) &&
    isNullableString(value.state) &&
    isNullableString(value.timeZone) &&
    isNullableString(value.placeId) &&
    isNullableNumber(value.lat) &&
    isNullableNumber(value.lng) &&
    typeof value.isPrimary === 'boolean'
  )
}

function isApiPro(value: unknown): value is ApiPro {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    isNullableString(value.businessName) &&
    typeof value.displayName === 'string' &&
    isNullableString(value.handle) &&
    isNullableString(value.professionType) &&
    isNullableString(value.avatarUrl) &&
    isNullableString(value.locationLabel) &&
    isNullableNumber(value.distanceMiles) &&
    isNullableNumber(value.ratingAvg) &&
    typeof value.ratingCount === 'number' &&
    isNullableNumber(value.minPrice) &&
    typeof value.supportsMobile === 'boolean' &&
    isLocationPreview(value.closestLocation) &&
    isLocationPreview(value.primaryLocation)
  )
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
  const firstToken = tokenize(raw)[0]
  if (firstToken === undefined) return false

  return SERVICE_LEAD_WORDS.has(firstToken.toLowerCase())
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

export default function SearchMapClient() {
  const [q, setQ] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(15)
  const [sortMode, setSortMode] = useState<SortMode>('DISTANCE')

  const [categories, setCategories] = useState<DiscoverCategoryOption[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<DiscoverViewMode>('MAP')

  // Discover is looks-first by default (social-first D2): a Pinterest-style
  // bookable-looks grid. The pro-finder (list + map) is a deliberate "Find a
  // pro" mode. Geolocation is only requested when the pro-finder is opened.
  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>('LOOKS')

  // On desktop (lg+) the toggle gives way to a permanent split — results list
  // on the left, live map on the right — so the map must stay mounted there
  // regardless of viewMode. SSR-safe; resolves to mobile-first then reconciles.
  const isDesktop = useMediaQuery(MEDIA.desktop)

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

  // Collapsible secondary controls (radius / sort / use-me) behind the filter
  // affordance — keeps the header clean while preserving every existing control.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // The scrollable GRID body sits below the floating header panel. Measure the
  // panel rather than hardcode an offset, so the headline + collapsible filters
  // never overlap the content.
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(178)

  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const focusTimerRef = useRef<number | null>(null)

  const reqIdRef = useRef(0)
  const inFlightRef = useRef<AbortController | null>(null)
  const lastSearchRef = useRef<SearchArgs>({ query: '', origin: null, categoryId: null })
  const radiusMilesRef = useRef(radiusMiles)

  // Secondary result filters — the API has supported these since the search
  // index landed; the UI just never exposed them.
  const [minRating, setMinRating] = useState<number | null>(null)
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const [openNowOnly, setOpenNowOnly] = useState(false)
  const [mobileOnly, setMobileOnly] = useState(false)
  const minRatingRef = useRef(minRating)
  const maxPriceRef = useRef(maxPrice)
  const openNowOnlyRef = useRef(openNowOnly)
  const mobileOnlyRef = useRef(mobileOnly)

  const sortModeRef = useRef<SortMode>(sortMode)

  useEffect(() => {
    minRatingRef.current = minRating
    maxPriceRef.current = maxPrice
    openNowOnlyRef.current = openNowOnly
    mobileOnlyRef.current = mobileOnly
    sortModeRef.current = sortMode
  }, [minRating, maxPrice, openNowOnly, mobileOnly, sortMode])

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

  // Honest replacement for the old "Trending near you" rail — which was just the
  // nearest pros mislabeled. This is the best-rated pros within the searched
  // radius (real rating signal only, no fabricated trending score); pros without
  // a rating are excluded so the label stays truthful.
  const topRatedPros = useMemo(
    () =>
      sortPros(pros, 'RATING')
        .filter((pro) => typeof pro.ratingAvg === 'number')
        .slice(0, 10),
    [pros],
  )

  // Active category as a slug — looks share the same ServiceCategory source, so
  // the slug filters the bookable-looks grid through the existing feed query.
  const activeCategorySlug = useMemo(() => {
    if (activeCategoryId === null) return null

    return (
      categories.find((category) => category.kind !== 'ALL' && category.id === activeCategoryId)?.slug ??
      null
    )
  }, [categories, activeCategoryId])

  useEffect(() => {
    const node = headerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (typeof height === 'number') setHeaderHeight(Math.ceil(height))
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const pins: Pin[] = useMemo(() => {
    const nextPins: Pin[] = []

    for (const pro of pros) {
      const location = preferredProLocation(pro)
      const lat = location?.lat ?? null
      const lng = location?.lng ?? null

      if (lat == null || lng == null) continue

      nextPins.push({
        id: pro.id,
        lat,
        lng,
        label: pro.displayName,
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

      qs.set('radiusMiles', String(radiusMilesRef.current))

      if (minRatingRef.current != null) {
        qs.set('minRating', String(minRatingRef.current))
      }
      if (maxPriceRef.current != null) {
        qs.set('maxPrice', String(maxPriceRef.current))
      }
      if (openNowOnlyRef.current) qs.set('openNow', '1')
      if (mobileOnlyRef.current) qs.set('mobile', '1')
      // Server-side ordering matters when results are truncated at the take
      // limit — the client-side sortPros then re-sorts the returned page.
      qs.set('sort', sortModeRef.current)

      if (args.query) qs.set('q', args.query)
      if (args.categoryId) qs.set('categoryId', args.categoryId)

      if (args.origin) {
        qs.set('lat', String(args.origin.lat))
        qs.set('lng', String(args.origin.lng))
      }

      const res = await fetch(`/api/v1/search/pros?${qs.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })

      const body = await safeJson(res)

      if (reqIdRef.current !== myReqId) return

      if (!res.ok || !isRecord(body) || body.ok !== true) {
        const message = isRecord(body) && typeof body.error === 'string' ? body.error : 'Search failed.'
        throw new Error(message)
      }

      const rawPros = isArray(body.items) ? body.items : []
      const nextPros = rawPros.filter(isApiPro)

      setPros(nextPros)

      const firstPinnedPro = nextPros.find((pro) => {
        const location = preferredProLocation(pro)
        return location?.lat != null && location.lng != null
      })
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
  const didGeoRequestRef = useRef(false)

  useEffect(() => {
    // Looks-first by default: don't prompt for location (or run the pro search)
    // until the viewer opens the "Find a pro" mode. Request geolocation exactly
    // once, the first time that mode is entered.
    if (discoverMode !== 'PROS') return
    if (didGeoRequestRef.current) return
    didGeoRequestRef.current = true

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
  }, [discoverMode, runSearch])

  const didRadiusEffectRunRef = useRef(false)

  useEffect(() => {
    if (!didRadiusEffectRunRef.current) {
      didRadiusEffectRunRef.current = true
      return
    }

    void runSearch(lastSearchRef.current)
  }, [radiusMiles, minRating, maxPrice, openNowOnly, mobileOnly, sortMode, runSearch])

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

      const autocompleteRes = await fetch(`/api/v1/google/places/autocomplete?${autocompleteParams.toString()}`, {
        cache: 'no-store',
      })

      const autocompleteBody = await safeJson(autocompleteRes)

      if (!autocompleteRes.ok || !isRecord(autocompleteBody) || !isArray(autocompleteBody.predictions)) {
        return null
      }

      const predictions = autocompleteBody.predictions
        .map(normalizePrediction)
        .filter((prediction): prediction is PlacesPrediction => Boolean(prediction))

      const chosen = predictions[0]
      if (chosen === undefined) return null
      const detailsParams = new URLSearchParams({
        placeId: chosen.placeId,
        sessionToken,
      })

      const detailsRes = await fetch(`/api/v1/google/places/details?${detailsParams.toString()}`, {
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

        const res = await fetch(`/api/v1/google/places/autocomplete?${params.toString()}`, {
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

      const detailsRes = await fetch(`/api/v1/google/places/details?${detailsParams.toString()}`, {
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

      // Keep the pending pro search in sync so a later switch to "Find a pro"
      // inherits the category — but in looks mode the selection drives the looks
      // grid (via activeCategorySlug) and no pro query is needed.
      lastSearchRef.current = {
        ...lastSearchRef.current,
        categoryId: nextCategoryId,
      }

      if (discoverMode !== 'PROS') return

      void runSearch(lastSearchRef.current)
    },
    [discoverMode, runSearch],
  )

  const headerHint = useMemo(() => {
    if (loading) return 'Finding pros...'
    if (err) return 'Search failed'
    if (!pros.length) return 'No results'

    return `${pros.length} pro${pros.length === 1 ? '' : 's'}`
  }, [loading, err, pros.length])

  // Count of secondary filters diverging from their defaults (radius 15 mi,
  // distance sort) — surfaced as a gold badge on the filter affordance.
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (radiusMiles !== 15) count += 1
    if (sortMode !== 'DISTANCE') count += 1
    if (minRating != null) count += 1
    if (maxPrice != null) count += 1
    if (openNowOnly) count += 1
    if (mobileOnly) count += 1
    return count
  }, [radiusMiles, sortMode, minRating, maxPrice, openNowOnly, mobileOnly])

  // The map is always live on desktop, so "Search this area" is relevant there
  // even when the mobile toggle would be in GRID mode.
  const showSearchArea = useMemo(() => {
    if (viewMode !== 'MAP' && !isDesktop) return false
    if (!mapCenter || !origin) return false

    return haversineMiles(mapCenter, origin) >= 0.35
  }, [viewMode, isDesktop, mapCenter, origin])

  const activeNavHref = useMemo(() => {
    if (!activePro) return null

    const location = preferredProLocation(activePro)

    return directionsHrefFromLocation({
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      placeId: location?.placeId ?? null,
      formattedAddress: location?.formattedAddress ?? null,
      name: activePro.displayName,
    })
  }, [activePro])

  const activeOpenHref = useMemo(() => {
    if (!activePro) return null

    const location = preferredProLocation(activePro)

    return mapsHrefFromLocation({
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      placeId: location?.placeId ?? null,
      formattedAddress: location?.formattedAddress ?? null,
      name: activePro.displayName,
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

    const location = preferredProLocation(pro)
    const lat = location?.lat ?? null
    const lng = location?.lng ?? null

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

  // Looks-first inspiration browse (default) — a normal-flow, responsive grid on
  // every breakpoint. The pro-finder split/map layout below is reserved for the
  // "Find a pro" mode.
  if (discoverMode === 'LOOKS') {
    return (
      <main
        className="mx-auto min-h-dvh max-w-6xl px-3 pt-3 lg:px-6 lg:pt-5"
        style={{ paddingBottom: `calc(${APP_BOTTOM_INSET} + 1.5rem)` }}
      >
        <header className="mb-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-[26px] font-semibold italic leading-none tracking-tight text-textPrimary">
              Discover
            </h1>

            <DiscoverModeToggle value={discoverMode} onChange={setDiscoverMode} />
          </div>

          <p className="text-[13px] font-semibold text-textSecondary">
            Tap any look to book the pro who made it.
          </p>

          {categories.length > 0 ? (
            <DiscoverCategoryRail
              categories={categories}
              activeCategoryId={activeCategoryId}
              onSelectCategory={handleSelectCategory}
            />
          ) : null}

          <TrendingTagsRail />
        </header>

        <LooksBookableGrid categorySlug={activeCategorySlug} showEmptyState heading={null} />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-240 px-0 pb-0 pt-0 lg:max-w-310">
      <div
        className="relative w-full overflow-hidden bg-bgPrimary lg:grid lg:grid-cols-[minmax(360px,420px)_1fr]"
        style={{ height: `calc(100dvh - ${APP_BOTTOM_INSET})` }}
      >
        {viewMode === 'MAP' || isDesktop ? (
          <div className="absolute inset-0 z-0 lg:static lg:z-0 lg:col-start-2 lg:row-start-1 lg:h-full">
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
          <div className="absolute inset-0 z-0 bg-bgPrimary lg:hidden" />
        )}

        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-47.5 bg-linear-to-b from-black/60 via-black/25 to-transparent lg:hidden"
        />

        {/* Left column: `contents` on mobile (the header floats over the map);
            a bordered flex column on desktop holding the header + results list. */}
        <div className="contents lg:col-start-1 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-white/10 lg:bg-bgPrimary">
        <div ref={headerRef} className="absolute left-0 right-0 top-0 z-20 px-3 pt-3 lg:relative lg:z-20 lg:shrink-0 lg:px-4 lg:pt-4">
          <div
            ref={acRootRef}
            className={cn(
              'tovis-glass-strong rounded-card border border-white/12 bg-bgSecondary/80 p-3 backdrop-blur-xl',
              'shadow-[0_18px_60px_rgba(0,0,0,0.65)] lg:shadow-none',
            )}
          >
            <div className="mb-3 flex justify-center lg:justify-start">
              <DiscoverModeToggle value={discoverMode} onChange={setDiscoverMode} />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="font-display text-[26px] font-semibold italic leading-none tracking-tight text-textPrimary">
                Discover
              </div>

              <button
                type="button"
                onClick={() => {
                  inputRef.current?.focus()
                  inputRef.current?.select()
                }}
                className="flex shrink-0 items-center gap-1.5 text-textSecondary transition-colors hover:text-textPrimary"
                aria-label="Change search location"
              >
                <MapPin size={14} aria-hidden className="text-accentPrimary" />
                <span className="max-w-[42vw] truncate font-display text-[13px] font-semibold lg:max-w-40">
                  {origin ? originLabel || 'Near you' : 'Set location'}
                </span>
                <ChevronDown size={12} aria-hidden className="text-textMuted" />
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-2xl px-3 py-2',
                      'border border-white/12 bg-bgPrimary/20 backdrop-blur-xl',
                      'shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]',
                      'transition duration-200',
                      'focus-within:border-white/20',
                      'focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_3px_rgba(var(--accent-primary),0.25)]',
                    )}
                  >
                    <Search size={16} aria-hidden className="shrink-0 text-textMuted" />
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

                        const highlighted = acOpen ? acPreds[acIndex] : undefined
                        if (highlighted !== undefined) {
                          void commitSelection(highlighted)
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

                <button
                  type="button"
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-pressed={filtersOpen}
                  aria-label="Filters"
                  className={cn(
                    'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors',
                    filtersOpen
                      ? 'border-accentPrimary bg-accentPrimary text-bgPrimary'
                      : 'border-white/12 bg-bgPrimary/20 text-textPrimary hover:bg-white/10',
                  )}
                >
                  <SlidersHorizontal size={16} />
                  {activeFilterCount > 0 && !filtersOpen ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-mono text-[9px] font-bold text-onAccent">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold text-textSecondary">
                  {origin ? `Searching near ${originLabel} · ${radiusMiles} mi` : 'Pick a place to set origin.'}
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

              {filtersOpen ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
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
                    <option value="RATING">Sort: Rating</option>
                    <option value="PRICE">Sort: Price</option>
                    <option value="NAME">Sort: Name</option>
                  </select>

                  <select
                    value={minRating ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value
                      setMinRating(raw ? Number(raw) : null)
                    }}
                    className={cn(
                      'rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2',
                      'text-[12px] font-black text-textPrimary outline-none',
                    )}
                    aria-label="Minimum rating"
                  >
                    <option value="">Rating: Any</option>
                    <option value={4}>Rating: 4.0+</option>
                    <option value={4.5}>Rating: 4.5+</option>
                  </select>

                  <select
                    value={maxPrice ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value
                      setMaxPrice(raw ? Number(raw) : null)
                    }}
                    className={cn(
                      'rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2',
                      'text-[12px] font-black text-textPrimary outline-none',
                    )}
                    aria-label="Maximum starting price"
                  >
                    <option value="">Price: Any</option>
                    <option value={50}>Under $50</option>
                    <option value={100}>Under $100</option>
                    <option value={200}>Under $200</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setOpenNowOnly((v) => !v)}
                    aria-pressed={openNowOnly}
                    className={cn(
                      'rounded-full border px-3 py-2 text-[12px] font-black transition',
                      openNowOnly
                        ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                        : 'border-white/12 bg-bgPrimary/20 text-textSecondary hover:bg-white/10',
                    )}
                  >
                    Open now
                  </button>

                  <button
                    type="button"
                    onClick={() => setMobileOnly((v) => !v)}
                    aria-pressed={mobileOnly}
                    className={cn(
                      'rounded-full border px-3 py-2 text-[12px] font-black transition',
                      mobileOnly
                        ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                        : 'border-white/12 bg-bgPrimary/20 text-textSecondary hover:bg-white/10',
                    )}
                  >
                    Comes to you
                  </button>

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

                  <button
                    type="button"
                    onClick={() => void inferAndSearch()}
                    className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Go
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 lg:justify-end">
              <div className="lg:hidden">
                <DiscoverViewToggle value={viewMode} onChange={setViewMode} />
              </div>

              <div className="shrink-0 font-mono text-[10px] font-black uppercase tracking-[0.18em] text-textSecondary">
                {headerHint}
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

        {isDesktop ? (
          <div
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3"
          >
            {err ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4 text-[13px] font-semibold text-microAccent">
                {err}
              </div>
            ) : loading ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4">
                <DiscoverLoadingRow />
              </div>
            ) : !displayPros.length ? (
              <EmptyState
                className="border-0 bg-transparent"
                title="No pros found nearby"
                description="Try increasing the distance or searching a different area."
              />
            ) : (
              <>
                {activePro ? (
                  <DiscoverActiveProCard pro={activePro} openHref={activeOpenHref} navHref={activeNavHref} />
                ) : null}

                <DiscoverProRows
                  pros={displayPros.slice(0, 30)}
                  activeProId={activeProId}
                  onSelect={handleSelectList}
                  itemRefs={itemRefs}
                />
              </>
            )}
          </div>
        ) : null}
        </div>

        {!isDesktop && viewMode === 'GRID' ? (
          <div
            className="absolute left-0 right-0 z-10 overflow-y-auto px-3 pb-4 pt-3"
            style={{
              top: headerHeight,
              bottom: APP_BOTTOM_INSET,
            }}
          >
            {err ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4 text-[13px] font-semibold text-microAccent">
                {err}
              </div>
            ) : loading ? (
              <div className="rounded-card border border-white/10 bg-bgSecondary/80 p-4">
                <DiscoverLoadingRow />
              </div>
            ) : (
              <div className="space-y-5">
                {topRatedPros.length > 0 ? (
                  <section>
                    <div className="mb-2.5 px-1 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-textMuted">
                      ◆ Top rated near you
                    </div>
                    <TrendingProRail pros={topRatedPros} onSelectPro={handleSelectGridPro} />
                  </section>
                ) : null}

                <section>
                  <div className="mb-2.5 px-1 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-textMuted">
                    ◆ Pros near you
                  </div>
                  <DiscoverGridView pros={displayPros} activeProId={activeProId} onSelectPro={handleSelectGridPro} />
                </section>

                <LooksBookableGrid categorySlug={activeCategorySlug} />
              </div>
            )}
          </div>
        ) : null}

        {!isDesktop && viewMode === 'MAP' ? (
          <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: APP_BOTTOM_INSET, paddingBottom: 12 }}>
            <div className="tovis-glass-strong rounded-card border border-white/10 bg-bgSecondary p-3">
              {err ? (
                <div className="text-[13px] font-semibold text-microAccent">{err}</div>
              ) : loading ? (
                <DiscoverLoadingRow />
              ) : !displayPros.length ? (
                <EmptyState
                  className="border-0 bg-transparent px-0 py-4"
                  title="No pros found nearby"
                  description="Try increasing the distance or searching a different area."
                />
              ) : (
                <>
                  {activePro ? (
                    <div className="mb-3">
                      <DiscoverActiveProCard pro={activePro} openHref={activeOpenHref} navHref={activeNavHref} />
                    </div>
                  ) : null}

                  <div ref={listRef} className="overlayScroll max-h-[34dvh] overflow-y-auto pr-1">
                    <DiscoverProRows
                      pros={displayPros.slice(0, 30)}
                      activeProId={activeProId}
                      onSelect={handleSelectList}
                      itemRefs={itemRefs}
                    />
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