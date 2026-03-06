// app/client/components/SavedServicesWithProviders.tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import {
  clearViewerLocation,
  loadViewerLocation,
  setViewerLocation,
  subscribeViewerLocation,
  VIEWER_RADIUS_DEFAULT_MILES,
  VIEWER_RADIUS_MAX_MILES,
  VIEWER_RADIUS_MIN_MILES,
  type ViewerLocation,
} from '@/lib/viewerLocation'

type SavedService = {
  id: string
  name: string
  description: string | null
  defaultImageUrl: string | null
  categoryName: string | null
  categorySlug: string | null
}

type ProviderCard = {
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: string | null
    location: string | null
  }
  opening: {
    id: string
    startAt: string
    endAt: string | null
    discountPct: number | null
    note: string | null
    timeZone: string
    locationType: string
    locationId: string
    city: string | null
    state: string | null
    formattedAddress: string | null
  }
  distanceMiles: number
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
}

const RADIUS_OPTIONS = [5, 10, 15, 25, 50].filter(
  (n) => n >= VIEWER_RADIUS_MIN_MILES && n <= VIEWER_RADIUS_MAX_MILES,
)

function fmtSoon(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return 'Soon'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function makeSessionToken() {
  // stable-enough, not crypto (works in browser)
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

function pickText(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function parsePredictions(raw: unknown): PlacePrediction[] {
  if (!isRecord(raw)) return []
  const arr = raw.predictions
  if (!Array.isArray(arr)) return []
  return arr
    .map((p) => {
      if (!isRecord(p)) return null
      const placeId = pickText(p.placeId)
      const description = pickText(p.description)
      const mainText = pickText(p.mainText)
      const secondaryText = pickText(p.secondaryText)
      if (!placeId || !description) return null
      return { placeId, description, mainText, secondaryText }
    })
    .filter((x): x is PlacePrediction => Boolean(x))
}

function parsePlaceDetails(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw)) return null
  const place = raw.place
  if (!isRecord(place)) return null

  const placeId = pickText(place.placeId)
  const name = pickText(place.name) || null
  const formattedAddress = pickText(place.formattedAddress) || null

  const lat = typeof place.lat === 'number' && Number.isFinite(place.lat) ? place.lat : null
  const lng = typeof place.lng === 'number' && Number.isFinite(place.lng) ? place.lng : null
  if (!placeId || lat == null || lng == null) return null

  const city = pickText(place.city) || null
  const state = pickText(place.state) || null
  const postalCode = pickText(place.postalCode) || null

  return { placeId, name, formattedAddress, lat, lng, city, state, postalCode }
}

export default function SavedServicesWithProviders({ services }: { services: SavedService[] }) {
  const [viewer, setViewer] = useState<ViewerLocation | null>(null)
  const [radiusMiles, setRadiusMiles] = useState<number>(VIEWER_RADIUS_DEFAULT_MILES)

  const [byServiceId, setByServiceId] = useState<Record<string, ProviderCard[]>>({})
  const [loadingProviders, setLoadingProviders] = useState(false)

  // Quick location UI (inline)
  const [locOpen, setLocOpen] = useState(false)
  const [locQuery, setLocQuery] = useState('')
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [predLoading, setPredLoading] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const sessionTokenRef = useRef<string>('')

  useEffect(() => {
    const initial = loadViewerLocation()
    setViewer(initial)
    if (initial?.radiusMiles) setRadiusMiles(initial.radiusMiles)

    return subscribeViewerLocation((v) => {
      setViewer(v)
      if (v?.radiusMiles) setRadiusMiles(v.radiusMiles)
    })
  }, [])

  const serviceIds = useMemo(() => services.map((s) => s.id).filter(Boolean), [services])

  const applyRadius = useCallback(
    (nextMiles: number) => {
      setRadiusMiles(nextMiles)

      if (!viewer) return
      setViewerLocation({
        label: viewer.label,
        lat: viewer.lat,
        lng: viewer.lng,
        placeId: viewer.placeId,
        radiusMiles: nextMiles,
      })
    },
    [viewer],
  )

  const openLocationInline = useCallback(() => {
    sessionTokenRef.current = makeSessionToken()
    setLocError(null)
    setLocQuery('')
    setPredictions([])
    setLocOpen(true)
  }, [])

  const closeLocationInline = useCallback(() => {
    setLocOpen(false)
    setLocError(null)
    setLocQuery('')
    setPredictions([])
    setPredLoading(false)
  }, [])

  // Debounced autocomplete
  useEffect(() => {
    if (!locOpen) return
    const q = locQuery.trim()
    if (q.length < 2) {
      setPredictions([])
      setPredLoading(false)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        setPredLoading(true)
        setLocError(null)

        const qs = new URLSearchParams()
        qs.set('input', q)
        qs.set('sessionToken', sessionTokenRef.current || makeSessionToken())
        qs.set('kind', 'AREA') // ZIP/city/state style
        qs.set('components', 'country:us')

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        })

        const raw = await safeJson(res)
        if (!res.ok) {
          setPredictions([])
          setLocError('Could not search locations.')
          return
        }

        setPredictions(parsePredictions(raw))
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setPredictions([])
        setLocError('Could not search locations.')
      } finally {
        setPredLoading(false)
      }
    }, 220)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [locOpen, locQuery])

  const choosePrediction = useCallback(
    async (p: PlacePrediction) => {
      try {
        setLocError(null)

        const qs = new URLSearchParams()
        qs.set('placeId', p.placeId)
        qs.set('sessionToken', sessionTokenRef.current || makeSessionToken())

        const res = await fetch(`/api/google/places/details?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })

        const raw = await safeJson(res)
        if (!res.ok) {
          setLocError('Could not load that location.')
          return
        }

        const place = parsePlaceDetails(raw)
        if (!place) {
          setLocError('Could not read that location.')
          return
        }

        const label = p.description || place.formattedAddress || 'Location'
        setViewerLocation({
          label,
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId,
          radiusMiles,
        })

        closeLocationInline()
      } catch {
        setLocError('Could not set location.')
      }
    },
    [closeLocationInline, radiusMiles],
  )

  const useMyLocation = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocError('Geolocation not available in this browser.')
      return
    }

    setLocError(null)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setViewerLocation({
          label: 'Current location',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          placeId: null,
          radiusMiles,
        })
        closeLocationInline()
      },
      () => setLocError('Could not access your location. Try ZIP code instead.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }, [closeLocationInline, radiusMiles])

  // Load providers per saved service
  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()

    async function run() {
      if (!viewer || !serviceIds.length) {
        setByServiceId({})
        return
      }

      setLoadingProviders(true)

      try {
        const qs = new URLSearchParams()
        qs.set('serviceIds', serviceIds.join(','))
        qs.set('lat', String(viewer.lat))
        qs.set('lng', String(viewer.lng))
        qs.set('radiusMiles', String(viewer.radiusMiles))
        qs.set('days', '14')
        qs.set('perService', '10')

        const res = await fetch(`/api/client/saved-services/providers?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        })

        const data = await safeJson(res)
        if (!res.ok) throw new Error('Failed to load providers.')

        const map =
          isRecord(data) && isRecord(data.byServiceId) ? (data.byServiceId as Record<string, ProviderCard[]>) : {}

        if (!cancelled) setByServiceId(map)
      } catch {
        if (!cancelled) setByServiceId({})
      } finally {
        if (!cancelled) setLoadingProviders(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [viewer?.lat, viewer?.lng, viewer?.radiusMiles, serviceIds.join('|')])

  if (!services.length) return null

  return (
    <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="text-sm font-black">Saved services</div>

        {viewer ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-textSecondary">
            <span>Within</span>
            <select
              value={viewer.radiusMiles}
              onChange={(e) => applyRadius(Number(e.target.value))}
              className="rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-1.5 text-xs font-black text-textPrimary outline-none"
              aria-label="Radius"
            >
              {RADIUS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} mi
                </option>
              ))}
            </select>

            <span className="hidden sm:inline">•</span>

            <button
              type="button"
              onClick={openLocationInline}
              className="hidden sm:inline rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-1.5 text-xs font-black text-textPrimary hover:bg-white/10"
              title="Change location"
            >
              {viewer.label}
            </button>

            <button
              type="button"
              onClick={() => clearViewerLocation()}
              className="hidden sm:inline rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary"
              title="Clear location"
            >
              Clear
            </button>

            {loadingProviders ? <span className="sr-only">Loading</span> : null}
          </div>
        ) : (
          <div className="text-xs font-semibold text-textSecondary">
            <button
              type="button"
              onClick={openLocationInline}
              className="font-black text-textPrimary underline underline-offset-4 hover:opacity-90"
            >
              Set your location
            </button>{' '}
            to see nearby openings, or{' '}
            <Link href="/client/settings#location" className="font-black text-textPrimary underline underline-offset-4">
              go to settings
            </Link>
            .
          </div>
        )}
      </div>

      {/* Inline quick-set location panel */}
      {locOpen ? (
        <div className="mb-4 rounded-card border border-white/10 bg-bgPrimary/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-black text-textPrimary">Set your location</div>
            <button
              type="button"
              onClick={closeLocationInline}
              className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-[12px] font-black text-textSecondary hover:text-textPrimary"
            >
              Close
            </button>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={locQuery}
              onChange={(e) => setLocQuery(e.target.value)}
              placeholder='ZIP code or city (e.g. "92101" or "San Diego")'
              className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
            />

            <button
              type="button"
              onClick={useMyLocation}
              className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-sm font-black text-textPrimary hover:bg-white/10"
              title="Use current GPS location"
            >
              Use GPS
            </button>
          </div>

          {locError ? <div className="mt-2 text-[12px] font-semibold text-rose-300">{locError}</div> : null}

          {predLoading ? <div className="mt-2 text-[12px] font-semibold text-textSecondary">Searching…</div> : null}

          {predictions.length ? (
            <div className="mt-2 grid gap-2">
              {predictions.slice(0, 6).map((p) => (
                <button
                  key={p.placeId}
                  type="button"
                  onClick={() => choosePrediction(p)}
                  className="rounded-card border border-white/10 bg-bgSecondary p-2 text-left hover:bg-white/5"
                >
                  <div className="text-[13px] font-black text-textPrimary">{p.mainText || p.description}</div>
                  {p.secondaryText ? (
                    <div className="text-[12px] font-semibold text-textSecondary">{p.secondaryText}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3">
        {services.map((svc) => {
          const providers = byServiceId[svc.id] ?? []

          return (
            <div key={svc.id} className="rounded-card border border-white/10 bg-bgPrimary/15 p-3">
              <div className="flex gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-bgSecondary">
                  {svc.defaultImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={svc.defaultImageUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-black text-textPrimary">{svc.name}</div>
                  {svc.categoryName ? (
                    <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">{svc.categoryName}</div>
                  ) : null}
                  {svc.description ? (
                    <div className="mt-1 line-clamp-2 text-[12px] font-semibold text-textSecondary">
                      {svc.description}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                {!viewer ? (
                  <div className="text-[12px] font-semibold text-textSecondary">
                    <button
                      type="button"
                      onClick={openLocationInline}
                      className="font-black text-textPrimary underline underline-offset-4 hover:opacity-90"
                    >
                      Set your location
                    </button>{' '}
                    to see who has openings for this service.
                  </div>
                ) : providers.length === 0 ? (
                  <div className="text-[12px] font-semibold text-textSecondary">
                    No openings soon within {viewer.radiusMiles} miles.
                  </div>
                ) : (
                  <div className="looksNoScrollbar flex gap-2 overflow-x-auto pb-1">
                    {providers.map((p) => {
                      const proName = (p.professional.businessName ?? p.professional.handle ?? 'Professional').trim()
                      return (
                        <Link
                          key={p.professional.id}
                          href={`/professionals/${encodeURIComponent(p.professional.id)}?tab=services`}
                          className="min-w-[220px] rounded-card border border-white/10 bg-bgSecondary p-3 hover:bg-white/5"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/30">
                              {p.professional.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.professional.avatarUrl}
                                  alt={proName}
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-black text-textPrimary">{proName}</div>
                              <div className="truncate text-[12px] font-semibold text-textSecondary">
                                {(p.professional.professionType ?? 'Pro') +
                                  (p.professional.location ? ` • ${p.professional.location}` : '')}
                              </div>
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="text-[12px] font-black text-textPrimary">{fmtSoon(p.opening.startAt)}</div>
                            <div className="text-[12px] font-semibold text-textSecondary">
                              {p.distanceMiles.toFixed(1)} mi
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}