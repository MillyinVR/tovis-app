// app/(main)/search/SearchMapClient.tsx
'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { directionsHrefFromLocation, mapsHrefFromLocation } from '@/lib/maps'
import type { Bounds, Pin } from './_components/MapView'

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

type ApiResponse = {
  ok: boolean
  pros?: unknown[]
  error?: unknown
}

type PlacesPrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
  distanceMeters: number | null
}

const MapView = dynamic(() => import('./_components/MapView'), { ssr: false })

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const APP_BOTTOM_INSET = 'max(var(--app-footer-space, 0px), env(safe-area-inset-bottom))'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function isNullableString(x: unknown): x is string | null {
  return x === null || typeof x === 'string'
}

function isNullableNumber(x: unknown): x is number | null {
  return x === null || (typeof x === 'number' && Number.isFinite(x))
}

function isPrimaryLocation(x: unknown): x is ApiPro['primaryLocation'] {
  if (x === null) return true
  if (!isRecord(x)) return false
  return (
    typeof x.id === 'string' &&
    isNullableString(x.formattedAddress) &&
    isNullableString(x.city) &&
    isNullableString(x.state) &&
    isNullableString(x.timeZone) &&
    isNullableNumber(x.lat) &&
    isNullableNumber(x.lng) &&
    isNullableString(x.placeId)
  )
}

function isApiPro(x: unknown): x is ApiPro {
  if (!isRecord(x)) return false
  return (
    typeof x.id === 'string' &&
    isNullableString(x.businessName) &&
    isNullableString(x.professionType) &&
    isNullableString(x.avatarUrl) &&
    isNullableString(x.locationLabel) &&
    isNullableNumber(x.distanceMiles) &&
    isPrimaryLocation(x.primaryLocation)
  )
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function nearlyEqual(a: number, b: number, eps = 1e-5) {
  return Math.abs(a - b) < eps
}

function coordsEqual(a: Coords | null, b: Coords, eps = 1e-5) {
  if (!a) return false
  return nearlyEqual(a.lat, b.lat, eps) && nearlyEqual(a.lng, b.lng, eps)
}

function haversineMiles(a: Coords, b: Coords) {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))
  return R * c
}

function isUsZip(input: string) {
  return /^\d{5}(?:-\d{4})?$/.test(input.trim())
}

function zoomForRadiusMiles(mi: number) {
  if (mi <= 5) return 12
  if (mi <= 10) return 11
  if (mi <= 15) return 11
  if (mi <= 25) return 10
  return 9
}

function newSessionToken() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

/**
 * Explicit parse:
 *  - "@encinitas ca" -> locationOnly
 *  - "lashes 92024"  -> query="lashes", location="92024"
 *  - "lashes near empire state building" -> query="lashes", location="empire state building"
 *  - "92024" -> query="", location="92024"
 */
function splitQueryAndLocation(raw: string): { query: string; location: string | null } {
  const s = raw.trim()
  if (!s) return { query: '', location: null }

  if (s.startsWith('@')) {
    const loc = s.slice(1).trim()
    return { query: '', location: loc || null }
  }

  const zipMatch = s.match(/\b\d{5}(?:-\d{4})?\b/)
  if (zipMatch) {
    const zip = zipMatch[0]
    const query = s.replace(zip, '').replace(/\s{2,}/g, ' ').trim()
    return { query, location: zip }
  }

  const m = s.match(/\b(?:near|in|at)\b\s+(.+)$/i)
  if (m && m[1]) {
    const location = m[1].trim()
    const query = s.slice(0, m.index).trim()
    return { query, location: location || null }
  }

  return { query: s, location: null }
}

function tokenize(s: string) {
  return s.trim().split(/\s+/).filter(Boolean)
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
  const t = tokenize(raw)
  if (!t.length) return false
  return SERVICE_LEAD_WORDS.has(t[0].toLowerCase())
}

function deriveAutocompleteTarget(raw: string): { serviceText: string; locationText: string } | null {
  const s = raw.trim()
  if (!s) return null

  const { query, location } = splitQueryAndLocation(s)
  if (location) return { serviceText: query.trim(), locationText: location.trim() }

  const tokens = tokenize(s)
  if (!tokens.length) return null

  if (!looksServiceLed(s)) {
    return { serviceText: '', locationText: s }
  }

  if (tokens.length === 1) return null
  const k = Math.min(4, tokens.length - 1)
  const locationText = tokens.slice(tokens.length - k).join(' ')
  const serviceText = tokens.slice(0, tokens.length - k).join(' ').trim()
  return { serviceText, locationText }
}

function normalizePrediction(x: unknown): PlacesPrediction | null {
  if (!isRecord(x)) return null
  const placeId = typeof x.placeId === 'string' ? x.placeId : ''
  const description = typeof x.description === 'string' ? x.description : ''
  if (!placeId || !description) return null

  const mainText = typeof x.mainText === 'string' ? x.mainText : description
  const secondaryText = typeof x.secondaryText === 'string' ? x.secondaryText : ''
  const types = Array.isArray(x.types) ? x.types.filter((t) => typeof t === 'string') : []
  const distanceMeters = typeof x.distanceMeters === 'number' ? x.distanceMeters : null

  return { placeId, description, mainText, secondaryText, types, distanceMeters }
}

type ResolvedPlace = { coords: Coords; label: string; viewport: Bounds | null }

function parseResolvedPlace(raw: unknown): ResolvedPlace | null {
  if (!isRecord(raw)) return null
  const place = raw.place
  if (!isRecord(place)) return null

  const lat = typeof place.lat === 'number' ? place.lat : null
  const lng = typeof place.lng === 'number' ? place.lng : null
  if (lat == null || lng == null) return null

  const viewport =
    isRecord(place.viewport) &&
    typeof place.viewport.north === 'number' &&
    typeof place.viewport.south === 'number' &&
    typeof place.viewport.east === 'number' &&
    typeof place.viewport.west === 'number'
      ? (place.viewport as Bounds)
      : null

  const name = typeof place.name === 'string' ? place.name : ''
  const formattedAddress = typeof place.formattedAddress === 'string' ? place.formattedAddress : ''
  const label = formattedAddress || name || 'Selected place'

  return { coords: { lat, lng }, label, viewport }
}

type SortMode = 'DISTANCE' | 'NAME'
function sortPros(list: ApiPro[], mode: SortMode): ApiPro[] {
  const out = [...list]
  if (mode === 'NAME') {
    out.sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
    return out
  }
  // DISTANCE
  out.sort((a, b) => {
    const ad = typeof a.distanceMiles === 'number' ? a.distanceMiles : Number.POSITIVE_INFINITY
    const bd = typeof b.distanceMiles === 'number' ? b.distanceMiles : Number.POSITIVE_INFINITY
    return ad - bd
  })
  return out
}

export default function SearchMapClient() {
  const [q, setQ] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(15)
  const [sortMode, setSortMode] = useState<SortMode>('DISTANCE')

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
  const activePro = useMemo(() => pros.find((p) => p.id === activeProId) ?? null, [pros, activeProId])

  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const focusTimerRef = useRef<number | null>(null)

  const reqIdRef = useRef(0)
  const inFlightRef = useRef<AbortController | null>(null)
  const lastSearchRef = useRef<{ query: string; origin: Coords | null }>({ query: '', origin: null })

  // Autocomplete state
  const inputRef = useRef<HTMLInputElement | null>(null)
  const acRootRef = useRef<HTMLDivElement | null>(null)
  const [placeSessionToken, setPlaceSessionToken] = useState(() => newSessionToken())
  const [acOpen, setAcOpen] = useState(false)
  const [acLoading, setAcLoading] = useState(false)
  const [acPreds, setAcPreds] = useState<PlacesPrediction[]>([])
  const [acIndex, setAcIndex] = useState(-1)
  const acAbortRef = useRef<AbortController | null>(null)

  // 🚫 Critical: suppress autocomplete after selection until user edits again.
  const [acEnabled, setAcEnabled] = useState(true)

  const displayPros = useMemo(() => sortPros(pros, sortMode), [pros, sortMode])

  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = []
    for (const p of pros) {
      const lat = p.primaryLocation?.lat ?? null
      const lng = p.primaryLocation?.lng ?? null
      if (lat == null || lng == null) continue
      out.push({
        id: p.id,
        lat,
        lng,
        label: p.businessName || 'Beauty professional',
        sublabel: p.locationLabel || p.professionType || '',
        active: p.id === activeProId,
      })
    }
    return out
  }, [pros, activeProId])

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

  // Close autocomplete on outside click
  useEffect(() => {
    if (!acOpen) return
    const onDown = (e: PointerEvent) => {
      const root = acRootRef.current
      if (!root) return
      if (root.contains(e.target as Node)) return
      setAcOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [acOpen])

  // Geolocation (initial origin)
  const didInitialSearchRef = useRef(false)
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoDenied(true)
      setMe(null)
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMe(c)
        setGeoDenied(false)

        if (!didInitialSearchRef.current) {
          didInitialSearchRef.current = true
          setOrigin(c)
          setOriginLabel('Near you')
          setFitBounds(null)
          lastSearchRef.current = { query: '', origin: c }
          void runSearch({ query: '', origin: c })
        }
      },
      () => {
        setGeoDenied(true)
        setMe(null)
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSearch = useCallback(
    async (args: { query: string; origin: Coords | null }) => {
      const myReqId = ++reqIdRef.current

      inFlightRef.current?.abort()
      const controller = new AbortController()
      inFlightRef.current = controller

      setLoading(true)
      setErr(null)

      try {
        const qs = new URLSearchParams()
        qs.set('tab', 'PROS')
        if (args.query) qs.set('q', args.query)
        qs.set('radiusMiles', String(radiusMiles))

        if (args.origin) {
          qs.set('lat', String(args.origin.lat))
          qs.set('lng', String(args.origin.lng))
        }

        const res = await fetch(`/api/search?${qs.toString()}`, { cache: 'no-store', signal: controller.signal })
        const body = await safeJson(res)

        if (reqIdRef.current !== myReqId) return

        if (!res.ok || !isRecord(body) || body.ok !== true) {
          const msg = isRecord(body) && typeof body.error === 'string' ? body.error : 'Search failed.'
          throw new Error(msg)
        }

        const rawPros = Array.isArray(body.pros) ? body.pros : []
        const list = rawPros.filter(isApiPro)

        setPros(list)
        const first = list.find((p) => p.primaryLocation?.lat != null && p.primaryLocation?.lng != null)
        setActiveProId((prev) => (prev && list.some((p) => p.id === prev) ? prev : first?.id ?? null))
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        const msg = e instanceof Error ? e.message : 'Search failed.'
        setErr(msg)
        setPros([])
        setActiveProId(null)
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false)
        if (inFlightRef.current === controller) inFlightRef.current = null
      }
    },
    [radiusMiles],
  )

  // Radius change reruns last search
  useEffect(() => {
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
      const loc = locationText.trim()
      if (!loc) return null

      const sessionToken = newSessionToken()
      const kind = isUsZip(loc) ? 'AREA' : 'ANY'

      const bias = mapCenter ?? origin ?? me
      const qsA = new URLSearchParams({
        input: loc,
        sessionToken,
        kind,
        components: 'country:us',
      })
      if (bias) {
        qsA.set('lat', String(bias.lat))
        qsA.set('lng', String(bias.lng))
        qsA.set('radiusMeters', '50000')
      }

      const resA = await fetch(`/api/google/places/autocomplete?${qsA.toString()}`, { cache: 'no-store' })
      const aRaw = await safeJson(resA)
      if (!resA.ok || !isRecord(aRaw) || !Array.isArray(aRaw.predictions)) return null

      const preds = aRaw.predictions.map(normalizePrediction).filter((p): p is PlacesPrediction => Boolean(p))
      if (!preds.length) return null

      const chosen = preds[0]
      const qsD = new URLSearchParams({ placeId: chosen.placeId, sessionToken })
      const resD = await fetch(`/api/google/places/details?${qsD.toString()}`, { cache: 'no-store' })
      const dRaw = await safeJson(resD)
      if (!resD.ok || !isRecord(dRaw)) return null

      return parseResolvedPlace(dRaw)
    },
    [mapCenter, origin, me],
  )

  // Autocomplete fetch (debounced)
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

        const qs = new URLSearchParams({
          input: target,
          kind,
          sessionToken: placeSessionToken,
          components: 'country:us',
        })
        if (bias) {
          qs.set('lat', String(bias.lat))
          qs.set('lng', String(bias.lng))
          qs.set('radiusMeters', '50000')
        }

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const raw = await safeJson(res)
        if (!res.ok || !isRecord(raw) || !Array.isArray(raw.predictions)) {
          setAcPreds([])
          setAcOpen(false)
          setAcIndex(-1)
          return
        }

        const preds = raw.predictions.map(normalizePrediction).filter((p): p is PlacesPrediction => Boolean(p))
        setAcPreds(preds)
        setAcOpen(preds.length > 0)
        setAcIndex(preds.length > 0 ? 0 : -1)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
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
    async (p: PlacesPrediction) => {
      // Always close dropdown immediately (UX)
      setAcOpen(false)
      setAcPreds([])
      setAcIndex(-1)

      const sessionToken = placeSessionToken
      const qsD = new URLSearchParams({ placeId: p.placeId, sessionToken })
      const resD = await fetch(`/api/google/places/details?${qsD.toString()}`, { cache: 'no-store' })
      const dRaw = await safeJson(resD)
      if (!resD.ok || !isRecord(dRaw)) return

      const resolved = parseResolvedPlace(dRaw)
      if (!resolved) return

      // Autofill: keep service text, commit “near <place>” so hitting Enter later still parses.
      const serviceText = acTarget?.serviceText?.trim() ?? splitQueryAndLocation(q).query.trim()
      const nextInput = serviceText ? `${serviceText} near ${p.description}` : p.description
      setQ(nextInput)

      // Suppress autocomplete until user edits again
      setAcEnabled(false)

      // Apply origin + run search
      applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMiles))
      lastSearchRef.current = { query: serviceText, origin: resolved.coords }
      void runSearch({ query: serviceText, origin: resolved.coords })

      // New token for next place interaction (billing grouping)
      setPlaceSessionToken(newSessionToken())

      // Keep focus in input (feels “native”)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    },
    [placeSessionToken, acTarget, q, applyOrigin, radiusMiles, runSearch],
  )

  const inferAndSearch = useCallback(async () => {
    // close dropdown no matter what — this fixes your screenshot scenario
    setAcOpen(false)

    const raw = q.trim()
    if (!raw) {
      const o = lastSearchRef.current.origin ?? origin ?? mapCenter ?? me
      lastSearchRef.current = { query: '', origin: o ?? null }
      void runSearch({ query: '', origin: o ?? null })
      return
    }

    const { query, location } = splitQueryAndLocation(raw)

    if (location) {
      const resolved = await resolvePlaceFromText(location)
      if (resolved) {
        applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMiles))
        lastSearchRef.current = { query: query.trim(), origin: resolved.coords }
        void runSearch({ query: query.trim(), origin: resolved.coords })
        return
      }
    }

    // Ambiguous: try whole string as location if it doesn't look service-led
    if (!looksServiceLed(raw)) {
      const resolved = await resolvePlaceFromText(raw)
      if (resolved) {
        applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMiles))
        lastSearchRef.current = { query: '', origin: resolved.coords }
        void runSearch({ query: '', origin: resolved.coords })
        return
      }
    }

    // Tail split for service-led (“lashes encinitas”)
    const tokens = tokenize(raw)
    if (tokens.length >= 2) {
      const maxK = Math.min(4, tokens.length - 1)
      for (let k = maxK; k >= 1; k--) {
        const locText = tokens.slice(tokens.length - k).join(' ')
        const serviceText = tokens.slice(0, tokens.length - k).join(' ').trim()
        const resolved = await resolvePlaceFromText(locText)
        if (resolved) {
          applyOrigin(resolved, resolved.viewport ? undefined : zoomForRadiusMiles(radiusMiles))
          lastSearchRef.current = { query: serviceText, origin: resolved.coords }
          void runSearch({ query: serviceText, origin: resolved.coords })
          return
        }
      }
    }

    // fallback: text search around current origin
    const o = lastSearchRef.current.origin ?? origin ?? mapCenter ?? me
    lastSearchRef.current = { query: raw, origin: o ?? null }
    void runSearch({ query: raw, origin: o ?? null })
  }, [q, origin, mapCenter, me, radiusMiles, applyOrigin, runSearch, resolvePlaceFromText])

  const headerHint = useMemo(() => {
    if (loading) return 'Finding pros…'
    if (err) return 'Search failed'
    if (!pros.length) return 'No results'
    return `${pros.length} pro${pros.length === 1 ? '' : 's'}`
  }, [loading, err, pros.length])

  const showSearchArea = useMemo(() => {
    if (!mapCenter || !origin) return false
    return haversineMiles(mapCenter, origin) >= 0.35
  }, [mapCenter, origin])

  const activeNavHref = useMemo(() => {
    if (!activePro) return null
    const loc = activePro.primaryLocation
    return directionsHrefFromLocation({
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      placeId: loc?.placeId ?? null,
      formattedAddress: loc?.formattedAddress ?? null,
      name: activePro.businessName ?? null,
    })
  }, [activePro])

  const activeOpenHref = useMemo(() => {
    if (!activePro) return null
    const loc = activePro.primaryLocation
    return mapsHrefFromLocation({
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      placeId: loc?.placeId ?? null,
      formattedAddress: loc?.formattedAddress ?? null,
      name: activePro.businessName ?? null,
    })
  }, [activePro])

  const handleSelectPin = useCallback((id: string) => {
    setActiveProId(id)
    const el = itemRefs.current[id]
    if (el && listRef.current) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const handleSelectList = useCallback((p: ApiPro) => {
    setActiveProId(p.id)
    const lat = p.primaryLocation?.lat ?? null
    const lng = p.primaryLocation?.lng ?? null
    if (lat != null && lng != null) {
      setFocus({ lat, lng })
      if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = window.setTimeout(() => setFocus(null), 250)
    }
  }, [])

  const quickChip = useCallback(
    (service: string) => {
      const base = originLabel ? `${service} near ${originLabel}` : service
      setQ(service)
      // keep existing origin; run search immediately
      const o = lastSearchRef.current.origin ?? origin ?? mapCenter ?? me
      lastSearchRef.current = { query: service, origin: o ?? null }
      void runSearch({ query: service, origin: o ?? null })
    },
    [originLabel, origin, mapCenter, me, runSearch],
  )

  return (
    <main className="mx-auto max-w-240 px-0 pb-0 pt-0">
      <div className="relative w-full overflow-hidden bg-bgPrimary" style={{ height: `calc(100dvh - ${APP_BOTTOM_INSET})` }}>
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

        <div
          className={cx(
            'pointer-events-none absolute left-0 right-0 top-0 z-10 h-[190px]',
            'bg-gradient-to-b from-black/60 via-black/25 to-transparent',
          )}
        />

        {/* Top bar */}
        <div className="absolute left-0 right-0 top-0 z-20 px-3 pt-3">
          <div
            className={cx(
              'tovis-glass-strong rounded-card border border-white/12 bg-bgSecondary/80 p-3 backdrop-blur-xl',
              'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
            )}
            ref={acRootRef}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-black text-textPrimary/85 tracking-wide">Search</div>

                <div
                  className={cx(
                    'mt-1 flex items-center gap-2 rounded-2xl px-3 py-2',
                    'bg-bgPrimary/20',
                    'backdrop-blur-xl',
                    'border border-white/12',
                    'shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]',
                    'focus-within:border-white/20',
                    'focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),_0_0_0_3px_rgba(var(--accent-primary),0.25)]',
                    'transition-shadow transition-colors duration-200',
                  )}
                >
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setAcEnabled(true) // user edited => re-enable autocomplete
                      setAcOpen(true)
                    }}
                    onFocus={() => {
                      if (acEnabled && acPreds.length) setAcOpen(true)
                    }}
                    onBlur={() => {
                      // delay so click selection works reliably
                      window.setTimeout(() => setAcOpen(false), 120)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setAcIndex((i) => Math.min(acPreds.length - 1, Math.max(0, i + 1)))
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setAcIndex((i) => Math.max(0, i - 1))
                      } else if (e.key === 'Escape') {
                        setAcOpen(false)
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (acOpen && acPreds.length > 0 && acIndex >= 0 && acIndex < acPreds.length) {
                          void commitSelection(acPreds[acIndex])
                        } else {
                          void inferAndSearch()
                        }
                      }
                    }}
                    placeholder="ZIP, city, neighborhood, landmark, or “lashes 92024”"
                    className={cx(
                      'w-full bg-transparent text-[14px] font-semibold text-textPrimary',
                      'placeholder:text-textPrimary/60 outline-none',
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
                      ✕
                    </button>
                  ) : null}

                  {acLoading ? (
                    <span className="select-none text-[12px] font-black text-textPrimary/70" aria-hidden>
                      …
                    </span>
                  ) : (
                    <span className="select-none text-[13px] text-textPrimary/75" aria-hidden>
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-textSecondary">
                    {origin ? `Searching near: ${originLabel}` : 'Pick a place to set origin.'}
                  </div>

                  {geoDenied ? (
                    <div className="text-[12px] font-semibold text-microAccent">Location off — place searches still work.</div>
                  ) : null}
                </div>

                {/* Autocomplete dropdown */}
                {acOpen && acPreds.length > 0 ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-white/12 bg-bgPrimary/45 backdrop-blur-xl">
                    {acPreds.slice(0, 8).map((p, idx) => (
                      <button
                        key={p.placeId}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          void commitSelection(p)
                        }}
                        onMouseEnter={() => setAcIndex(idx)}
                        className={cx(
                          'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition',
                          idx === acIndex ? 'bg-white/10' : 'bg-transparent hover:bg-white/10',
                          'border-b border-white/10 last:border-b-0',
                        )}
                      >
                        <div className="text-[13px] font-black text-textPrimary">{p.mainText}</div>
                        <div className="text-[12px] font-semibold text-textSecondary">{p.secondaryText || p.description}</div>
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
                    onChange={(e) => setRadiusMiles(Number(e.target.value))}
                    className={cx(
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
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className={cx(
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
                        setOrigin(me)
                        setOriginLabel('Near you')
                        setFitBounds(null)
                        lastSearchRef.current = { query: lastSearchRef.current.query, origin: me }
                        void runSearch({ query: lastSearchRef.current.query, origin: me })
                      }}
                      className="rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                    >
                      Use me
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Quick chips (final 10% UX) */}
            {!q && !loading ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {['Lashes', 'Haircut', 'Nails', 'Brows', 'Facial'].map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => quickChip(x.toLowerCase())}
                    className="rounded-full border border-white/12 bg-bgPrimary/20 px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                  >
                    {x}
                  </button>
                ))}
              </div>
            ) : null}

            {showSearchArea ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    if (!mapCenter) return
                    setOrigin(mapCenter)
                    setOriginLabel('Map center')
                    setFitBounds(null)

                    const query = lastSearchRef.current.query
                    lastSearchRef.current = { query, origin: mapCenter }
                    void runSearch({ query, origin: mapCenter })
                  }}
                  className={cx(
                    'rounded-full px-4 py-2 text-[12px] font-black',
                    'border border-white/15',
                    'bg-bgPrimary/25 backdrop-blur-xl',
                    'text-textPrimary',
                    'shadow-[0_14px_40px_rgba(0,0,0,0.55)]',
                    'hover:bg-white/10 transition',
                  )}
                >
                  Search this area
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bottom sheet */}
        <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: APP_BOTTOM_INSET, paddingBottom: 12 }}>
          <div className="tovis-glass-strong rounded-card border border-white/10 bg-bgSecondary p-3">
            {err ? (
              <div className="text-[13px] font-semibold text-microAccent">{err}</div>
            ) : loading ? (
              <div className="text-[13px] font-semibold text-textSecondary">Loading…</div>
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
                            (activePro.locationLabel ? ` • ${activePro.locationLabel}` : '')}
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

                <div ref={listRef} className="max-h-[34dvh] overflow-y-auto pr-1 overlayScroll">
                  <div className="grid gap-2">
                    {displayPros.slice(0, 30).map((p) => {
                      const active = p.id === activeProId
                      const hasPin = p.primaryLocation?.lat != null && p.primaryLocation?.lng != null

                      return (
                        <button
                          key={p.id}
                          ref={(el) => {
                            itemRefs.current[p.id] = el
                          }}
                          type="button"
                          onClick={() => handleSelectList(p)}
                          className={cx(
                            'w-full rounded-card border border-white/10 p-3 text-left transition',
                            active ? 'bg-white/10' : 'bg-bgPrimary/25 hover:bg-white/10',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-black text-textPrimary">
                                {p.businessName || 'Beauty professional'}
                              </div>
                              <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                                {(p.professionType || 'Professional') + (p.locationLabel ? ` • ${p.locationLabel}` : '')}
                                {!hasPin ? <span className="ml-2 text-microAccent">• no pin</span> : null}
                              </div>
                            </div>

                            {typeof p.distanceMiles === 'number' ? (
                              <div className="shrink-0 text-[12px] font-black text-textSecondary">
                                {p.distanceMiles.toFixed(1)} mi
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
      </div>
    </main>
  )
}