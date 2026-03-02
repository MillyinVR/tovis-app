// app/(main)/search/SearchClient.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed, MapPin, Search, X } from 'lucide-react'

import {
  VIEWER_RADIUS_DEFAULT_MILES,
  VIEWER_RADIUS_MAX_MILES,
  VIEWER_RADIUS_MIN_MILES,
  clearViewerLocation,
  loadViewerLocation,
  setViewerLocation,
  subscribeViewerLocation,
  type ViewerLocation,
} from '@/lib/viewerLocation'

type Tab = 'PROS' | 'SERVICES'

type SearchResult = {
  pros: Array<{
    id: string
    businessName: string | null
    professionType: string | null
    avatarUrl: string | null
    locationLabel: string | null
    distanceMiles: number | null
    primaryLocation: {
      id: string
      formattedAddress: string | null
      city: string | null
      state: string | null
      timeZone: string | null
      lat: number | null
      lng: number | null
      placeId: string | null
    } | null
  }>
  services: Array<{
    id: string
    name: string
    categoryName: string | null
  }>
}

type PlacePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickString(x: unknown): string | null {
  return typeof x === 'string' && x.trim() ? x.trim() : null
}

function pickNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(n)
  return Math.min(Math.max(x, min), max)
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function parsePredictions(raw: unknown): PlacePrediction[] {
  if (!isRecord(raw)) return []
  const preds = raw.predictions
  if (!Array.isArray(preds)) return []

  const out: PlacePrediction[] = []
  for (const p of preds) {
    if (!isRecord(p)) continue
    const placeId = pickString(p.placeId)
    const description = pickString(p.description)
    const mainText = pickString(p.mainText) ?? (description ? description.split(',')[0]?.trim() : null)
    const secondaryText = pickString(p.secondaryText) ?? ''
    if (!placeId || !description || !mainText) continue
    out.push({ placeId, description, mainText, secondaryText })
  }
  return out
}

function parsePlaceDetails(raw: unknown): { placeId: string; lat: number; lng: number } | null {
  if (!isRecord(raw)) return null
  const place = raw.place
  if (!isRecord(place)) return null

  const placeId = pickString(place.placeId)
  const lat = pickNumber(place.lat)
  const lng = pickNumber(place.lng)

  if (!placeId || lat == null || lng == null) return null
  return { placeId, lat, lng }
}

function parseSearchResult(raw: unknown): SearchResult {
  const empty: SearchResult = { pros: [], services: [] }
  if (!isRecord(raw)) return empty

  const prosRaw = raw.pros
  const servicesRaw = raw.services

  const pros: SearchResult['pros'] = []
  if (Array.isArray(prosRaw)) {
    for (const row of prosRaw) {
      if (!isRecord(row)) continue
      const id = pickString(row.id)
      if (!id) continue

      let primaryLocation: SearchResult['pros'][number]['primaryLocation'] = null
      const pl = row.primaryLocation
      if (isRecord(pl)) {
        const plId = pickString(pl.id)
        if (plId) {
          primaryLocation = {
            id: plId,
            formattedAddress: pickString(pl.formattedAddress),
            city: pickString(pl.city),
            state: pickString(pl.state),
            timeZone: pickString(pl.timeZone),
            lat: pickNumber(pl.lat),
            lng: pickNumber(pl.lng),
            placeId: pickString(pl.placeId),
          }
        }
      }

      pros.push({
        id,
        businessName: pickString(row.businessName),
        professionType: pickString(row.professionType),
        avatarUrl: pickString(row.avatarUrl),
        locationLabel: pickString(row.locationLabel),
        distanceMiles: pickNumber(row.distanceMiles),
        primaryLocation,
      })
    }
  }

  const services: SearchResult['services'] = []
  if (Array.isArray(servicesRaw)) {
    for (const row of servicesRaw) {
      if (!isRecord(row)) continue
      const id = pickString(row.id)
      const name = pickString(row.name)
      if (!id || !name) continue
      services.push({ id, name, categoryName: pickString(row.categoryName) })
    }
  }

  return { pros, services }
}

function buildDirectionsHref(args: { placeId?: string | null; lat?: number | null; lng?: number | null; address?: string | null }) {
  const placeId = (args.placeId || '').trim()
  if (placeId) return `https://www.google.com/maps/dir/?api=1&destination_place_id=${encodeURIComponent(placeId)}`

  const lat = typeof args.lat === 'number' ? args.lat : null
  const lng = typeof args.lng === 'number' ? args.lng : null
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

  const addr = (args.address || '').trim()
  if (addr) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`

  return null
}

function canUseGeolocation() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

function getSessionToken() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // ignore
  }
  return String(Date.now())
}

export default function SearchClient() {
  const [tab, setTab] = useState<Tab>('PROS')

  // query text
  const [q, setQ] = useState('')

  // viewer location (canonical, from /lib/viewerLocation)
  const [viewerLoc, setViewerLoc] = useState<ViewerLocation | null>(null)
  const [radiusMiles, setRadiusMiles] = useState<number>(VIEWER_RADIUS_DEFAULT_MILES)

  // location panel + autocomplete
  const [locOpen, setLocOpen] = useState(false)
  const [locQuery, setLocQuery] = useState('')
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [predLoading, setPredLoading] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  // results
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<SearchResult>({ pros: [], services: [] })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const predAbortRef = useRef<AbortController | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const placesSessionTokenRef = useRef<string | null>(null)

  // hydrate + subscribe to changes (cross-tab + other screens)
  useEffect(() => {
    const initial = loadViewerLocation()
    setViewerLoc(initial)
    if (initial) setRadiusMiles(clampInt(initial.radiusMiles, VIEWER_RADIUS_MIN_MILES, VIEWER_RADIUS_MAX_MILES))

    return subscribeViewerLocation((v) => {
      setViewerLoc(v)
      if (v) setRadiusMiles(clampInt(v.radiusMiles, VIEWER_RADIUS_MIN_MILES, VIEWER_RADIUS_MAX_MILES))
    })
  }, [])

  // keep session token stable while location panel is open
  useEffect(() => {
    if (!locOpen) {
      placesSessionTokenRef.current = null
      return
    }
    placesSessionTokenRef.current = getSessionToken()
  }, [locOpen])

  // close location panel on Escape
  useEffect(() => {
    if (!locOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLocOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locOpen])

  const clearPredDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const clearPredRequest = useCallback(() => {
    predAbortRef.current?.abort()
    predAbortRef.current = null
  }, [])

  const clearSearchRequest = useCallback(() => {
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
  }, [])

  // --- location autocomplete ---
  useEffect(() => {
    if (!locOpen) return

    const input = locQuery.trim()
    setLocError(null)

    if (!input) {
      clearPredDebounce()
      clearPredRequest()
      setPredictions([])
      setPredLoading(false)
      return
    }

    clearPredDebounce()

    debounceRef.current = setTimeout(async () => {
      try {
        setPredLoading(true)
        clearPredRequest()

        const controller = new AbortController()
        predAbortRef.current = controller

        const sessionToken = placesSessionTokenRef.current ?? getSessionToken()

        const qs = new URLSearchParams({ input, sessionToken })

        // optional bias: current viewerLoc if present
        if (viewerLoc) {
          qs.set('lat', String(viewerLoc.lat))
          qs.set('lng', String(viewerLoc.lng))
          qs.set('radiusMeters', String(Math.round(radiusMiles * 1609.34)))
        }

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })

        const raw = await safeJson(res)
        if (!res.ok) {
          const msg = isRecord(raw) ? pickString(raw.error) : null
          throw new Error(msg || 'Failed to load suggestions')
        }

        setPredictions(parsePredictions(raw))
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setPredictions([])
        setLocError(e instanceof Error ? e.message : 'Failed to load suggestions')
      } finally {
        setPredLoading(false)
      }
    }, 180)

    return () => clearPredDebounce()
  }, [locOpen, locQuery, viewerLoc, radiusMiles, clearPredDebounce, clearPredRequest])

  const choosePrediction = useCallback(
    async (p: PlacePrediction) => {
      try {
        setPredLoading(true)
        setLocError(null)

        const sessionToken = placesSessionTokenRef.current ?? getSessionToken()

        const res = await fetch(
          `/api/google/places/details?placeId=${encodeURIComponent(p.placeId)}&sessionToken=${encodeURIComponent(sessionToken)}`,
          { cache: 'no-store', headers: { Accept: 'application/json' } },
        )

        const raw = await safeJson(res)
        if (!res.ok) {
          const msg = isRecord(raw) ? pickString(raw.error) : null
          throw new Error(msg || 'Failed to load place details')
        }

        const place = parsePlaceDetails(raw)
        if (!place) throw new Error('Place details malformed.')

        // canonical write (storage + event)
        setViewerLocation({
          label: p.description,
          placeId: place.placeId,
          lat: place.lat,
          lng: place.lng,
          radiusMiles,
        })

        // ✅ hard-close the panel + suggestions
        setLocOpen(false)
        setLocQuery('')
        setPredictions([])
      } catch (e: unknown) {
        setLocError(e instanceof Error ? e.message : 'Failed to load place details.')
      } finally {
        setPredLoading(false)
      }
    },
    [radiusMiles],
  )

  const clearLocation = useCallback(() => {
    clearViewerLocation()
    setLocQuery('')
    setPredictions([])
    setLocError(null)
  }, [])

  const useMyLocation = useCallback(() => {
    if (!canUseGeolocation()) {
      setLocError('Geolocation is not available on this device/browser.')
      return
    }

    setLocError(null)
    setPredLoading(true)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude

        setViewerLocation({
          label: 'Current location',
          placeId: null,
          lat,
          lng,
          radiusMiles,
        })

        setLocOpen(false)
        setLocQuery('')
        setPredictions([])
        setPredLoading(false)
      },
      () => {
        setLocError('Could not access your location. Check browser permissions.')
        setPredLoading(false)
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    )
  }, [radiusMiles])

  // update radius (and persist if we have a location)
  const onRadiusChange = useCallback(
    (next: number) => {
      const r = clampInt(next, VIEWER_RADIUS_MIN_MILES, VIEWER_RADIUS_MAX_MILES)
      setRadiusMiles(r)

      if (viewerLoc) {
        setViewerLocation({
          label: viewerLoc.label,
          placeId: viewerLoc.placeId,
          lat: viewerLoc.lat,
          lng: viewerLoc.lng,
          radiusMiles: r,
        })
      }
    },
    [viewerLoc],
  )

  // --- search API ---
  const canSearch = useMemo(() => q.trim().length > 0 || Boolean(viewerLoc), [q, viewerLoc])

  useEffect(() => {
    if (!canSearch) {
      clearSearchRequest()
      setData({ pros: [], services: [] })
      setErr(null)
      setLoading(false)
      return
    }

    const handle = setTimeout(async () => {
      try {
        setLoading(true)
        setErr(null)

        clearSearchRequest()
        const controller = new AbortController()
        searchAbortRef.current = controller

        const qs = new URLSearchParams()
        if (q.trim()) qs.set('q', q.trim())
        qs.set('tab', tab)
        qs.set('radiusMiles', String(clampInt(radiusMiles, VIEWER_RADIUS_MIN_MILES, VIEWER_RADIUS_MAX_MILES)))

        if (viewerLoc) {
          qs.set('lat', String(viewerLoc.lat))
          qs.set('lng', String(viewerLoc.lng))
        }

        const res = await fetch(`/api/search?${qs.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })

        const raw = await safeJson(res)
        if (!res.ok) {
          const msg = isRecord(raw) ? pickString(raw.error) : null
          throw new Error(msg || 'Search failed.')
        }

        setData(parseSearchResult(raw))
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        setErr(e instanceof Error ? e.message : 'Search failed.')
        setData({ pros: [], services: [] })
      } finally {
        setLoading(false)
      }
    }, 220)

    return () => clearTimeout(handle)
  }, [canSearch, q, tab, viewerLoc, radiusMiles, clearSearchRequest])

  const locationButtonLabel = useMemo(() => {
    if (!viewerLoc?.label) return 'Choose location'
    const s = viewerLoc.label.trim()
    return s.length > 22 ? `${s.slice(0, 22)}…` : s
  }, [viewerLoc?.label])

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 text-textPrimary">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[18px] font-black tracking-tight">Search</div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              Pros, services, and later: map + live availability. (We’re building the empire.)
            </div>
          </div>

          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('PROS')}
              className={cx(
                'rounded-full border px-3 py-2 text-[12px] font-black transition',
                tab === 'PROS'
                  ? 'border-accentPrimary bg-bgPrimary/25 text-textPrimary'
                  : 'border-white/10 bg-bgPrimary/10 text-textSecondary hover:text-textPrimary',
              )}
            >
              Pros
            </button>
            <button
              type="button"
              onClick={() => setTab('SERVICES')}
              className={cx(
                'rounded-full border px-3 py-2 text-[12px] font-black transition',
                tab === 'SERVICES'
                  ? 'border-accentPrimary bg-bgPrimary/25 text-textPrimary'
                  : 'border-white/10 bg-bgPrimary/10 text-textSecondary hover:text-textPrimary',
              )}
            >
              Services
            </button>
          </div>
        </div>

        {/* Search row */}
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-bgPrimary/20 px-4 py-3">
            <Search size={16} className="opacity-80" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === 'PROS' ? 'Search pros (name, type)…' : 'Search services…'}
              className="w-full bg-transparent text-[13px] font-semibold text-textPrimary outline-none placeholder:text-textSecondary"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ('')}
                className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 hover:bg-white/10"
                aria-label="Clear"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLocOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-bgPrimary/20 px-4 py-3 text-[12px] font-black text-textPrimary hover:bg-white/5"
              aria-expanded={locOpen}
              aria-controls="search-location-panel"
            >
              <MapPin size={16} className="opacity-80" />
              {locationButtonLabel}
            </button>

            {viewerLoc ? (
              <button
                type="button"
                onClick={clearLocation}
                className="rounded-full border border-white/10 bg-bgPrimary/10 px-3 py-3 text-[12px] font-black text-textSecondary hover:text-textPrimary"
                aria-label="Clear location"
                title="Clear location"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        {/* Location dropdown */}
        {locOpen ? (
          <div id="search-location-panel" className="mt-3 rounded-card border border-white/10 bg-bgPrimary/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12px] font-black text-textPrimary">Search near</div>

              <button
                type="button"
                onClick={useMyLocation}
                className={cx(
                  'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px] font-black transition',
                  'border-white/10 bg-bgSecondary text-textPrimary hover:bg-white/5',
                )}
                title="Use your current location"
              >
                <LocateFixed size={14} className="opacity-80" />
                Use my location
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2 rounded-full border border-white/10 bg-bgSecondary px-4 py-3">
              <Search size={16} className="opacity-80" />
              <input
                value={locQuery}
                onChange={(e) => setLocQuery(e.target.value)}
                placeholder="City, neighborhood, or address"
                className="w-full bg-transparent text-[13px] font-semibold text-textPrimary outline-none placeholder:text-textSecondary"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && predictions[0] && !predLoading) {
                    e.preventDefault()
                    void choosePrediction(predictions[0])
                  }
                }}
              />
              {predLoading ? <div className="text-[11px] font-bold text-textSecondary">…</div> : null}
            </div>

            <div className="mt-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold text-textSecondary">
                Radius: <span className="text-textPrimary font-black">{radiusMiles} mi</span>
              </div>
              <input
                type="range"
                min={VIEWER_RADIUS_MIN_MILES}
                max={VIEWER_RADIUS_MAX_MILES}
                step={5}
                value={radiusMiles}
                onChange={(e) => onRadiusChange(Number(e.target.value))}
                className="w-40"
              />
            </div>

            {locError ? <div className="mt-2 text-[12px] font-semibold text-toneDanger">{locError}</div> : null}

            <div className="mt-3 grid gap-2">
              {predictions.length ? (
                predictions.slice(0, 7).map((p) => (
                  <button
                    key={p.placeId}
                    type="button"
                    onClick={() => void choosePrediction(p)}
                    className="rounded-card border border-white/10 bg-bgSecondary p-3 text-left hover:bg-white/5"
                  >
                    <div className="text-[13px] font-black text-textPrimary">{p.mainText || p.description}</div>
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">{p.secondaryText || p.description}</div>
                  </button>
                ))
              ) : (
                <div className="text-[12px] font-semibold text-textSecondary">Start typing a city or address.</div>
              )}
            </div>
          </div>
        ) : null}

        {/* Results */}
        <div className="mt-5">
          {loading ? <div className="text-[13px] font-semibold text-textSecondary">Searching…</div> : null}
          {err ? <div className="mt-2 text-[13px] font-semibold text-microAccent">{err}</div> : null}

          {!loading && !err && tab === 'PROS' ? (
            <div className="mt-3 grid gap-2">
              {data.pros.length ? (
                data.pros.map((p) => {
                  const href = `/professionals/${encodeURIComponent(p.id)}`
                  const loc = p.locationLabel || 'Location not set'
                  const dist = typeof p.distanceMiles === 'number' ? `${p.distanceMiles.toFixed(1)} mi` : null

                  const directions = buildDirectionsHref({
                    placeId: p.primaryLocation?.placeId ?? null,
                    lat: p.primaryLocation?.lat ?? null,
                    lng: p.primaryLocation?.lng ?? null,
                    address: p.primaryLocation?.formattedAddress ?? null,
                  })

                  return (
                    <div key={p.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={href} className="min-w-0">
                          <div className="truncate text-[14px] font-black text-textPrimary">{p.businessName || 'Professional'}</div>
                          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                            {(p.professionType || 'Beauty professional') + ' • ' + loc}
                            {dist ? <span className="text-textSecondary"> • {dist}</span> : null}
                          </div>
                        </Link>

                        <div className="flex items-center gap-2">
                          {directions ? (
                            <a
                              href={directions}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-white/5"
                            >
                              Directions
                            </a>
                          ) : null}
                          <Link
                            href={href}
                            className="rounded-full bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
                          >
                            View
                          </Link>
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="text-[13px] font-semibold text-textSecondary">No pros found.</div>
              )}
            </div>
          ) : null}

          {!loading && !err && tab === 'SERVICES' ? (
            <div className="mt-3 grid gap-2">
              {data.services.length ? (
                data.services.map((s) => (
                  <div key={s.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-3">
                    <div className="text-[14px] font-black text-textPrimary">{s.name}</div>
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">{s.categoryName || 'Service'}</div>
                  </div>
                ))
              ) : (
                <div className="text-[13px] font-semibold text-textSecondary">No services found.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}