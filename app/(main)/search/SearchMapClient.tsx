'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { directionsHrefFromLocation, mapsHrefFromLocation } from '@/lib/maps'
import type { Pin } from './_components/MapView'

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

type ApiResponse = {
  ok: boolean
  pros: ApiPro[]
  services: any[]
}

type Coords = { lat: number; lng: number }

const MapView = dynamic(() => import('./_components/MapView'), { ssr: false })

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
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

export default function SearchMapClient() {
  const [q, setQ] = useState('')
  const [radiusMiles, setRadiusMiles] = useState(15)

  const [me, setMe] = useState<Coords | null>(null)
  const [geoDenied, setGeoDenied] = useState(false)

  // viewport center for “search this area”
  const [mapCenter, setMapCenter] = useState<Coords | null>(null)
  const [searchedCenter, setSearchedCenter] = useState<Coords | null>(null)

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [pros, setPros] = useState<ApiPro[]>([])

  const [activeProId, setActiveProId] = useState<string | null>(null)
  const activePro = useMemo(() => pros.find((p) => p.id === activeProId) ?? null, [pros, activeProId])

  // list scroll sync
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // map “focus” ping when selecting list item
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)

  const pinPros = useMemo(() => {
    return pros
      .map((p) => {
        const lat = p.primaryLocation?.lat ?? null
        const lng = p.primaryLocation?.lng ?? null
        if (lat == null || lng == null) return null
        return { pro: p, lat, lng }
      })
      .filter(Boolean) as Array<{ pro: ApiPro; lat: number; lng: number }>
  }, [pros])

  const pins: Pin[] = useMemo(() => {
    return pinPros.map((x) => ({
      id: x.pro.id,
      lat: x.lat,
      lng: x.lng,
      label: x.pro.businessName || 'Beauty professional',
      sublabel: x.pro.locationLabel || x.pro.professionType || '',
      active: x.pro.id === activeProId,
    }))
  }, [pinPros, activeProId])

  // Acquire geolocation once
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!navigator.geolocation) {
      setGeoDenied(true)
      setMe(null)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMe(c)
        setGeoDenied(false)
        setMapCenter(c)
        setSearchedCenter(c)
      },
      () => {
        setGeoDenied(true)
        setMe(null)
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [])

  async function runSearch(next?: { q?: string; radiusMiles?: number; origin?: Coords | null }) {
    const qq = (next?.q ?? q).trim()
    const rr = next?.radiusMiles ?? radiusMiles
    const origin = next?.origin ?? me

    setLoading(true)
    setErr(null)

    try {
      const qs = new URLSearchParams()
      qs.set('tab', 'PROS')
      if (qq) qs.set('q', qq)
      qs.set('radiusMiles', String(rr))

      if (origin) {
        qs.set('lat', String(origin.lat))
        qs.set('lng', String(origin.lng))
      }

      const res = await fetch(`/api/search?${qs.toString()}`, { cache: 'no-store' })
      const data = (await safeJson(res)) as Partial<ApiResponse>
      if (!res.ok) throw new Error((data as any)?.error || 'Search failed.')

      const list = Array.isArray(data?.pros) ? (data!.pros as ApiPro[]) : []
      setPros(list)

      const first = list.find((p) => p.primaryLocation?.lat != null && p.primaryLocation?.lng != null)
      setActiveProId(first?.id ?? null)

      if (origin) setSearchedCenter(origin)
    } catch (e: any) {
      setErr(e?.message || 'Search failed.')
      setPros([])
      setActiveProId(null)
    } finally {
      setLoading(false)
    }
  }

  // auto-run when we get coords or radius changes
  useEffect(() => {
    void runSearch({ origin: me })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, radiusMiles])

  const headerHint = useMemo(() => {
    if (loading) return 'Finding pros near you…'
    if (err) return 'Search failed'
    if (!pros.length) return 'No results'
    return `${pros.length} pro${pros.length === 1 ? '' : 's'}`
  }, [loading, err, pros.length])

  const showSearchArea = useMemo(() => {
    if (!mapCenter || !searchedCenter) return false
    return haversineMiles(mapCenter, searchedCenter) >= 0.35
  }, [mapCenter, searchedCenter])

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

  function handleSelectPin(id: string) {
    setActiveProId(id)

    const el = itemRefs.current[id]
    if (el && listRef.current) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function handleSelectList(p: ApiPro) {
    setActiveProId(p.id)

    const lat = p.primaryLocation?.lat ?? null
    const lng = p.primaryLocation?.lng ?? null
    if (lat != null && lng != null) {
      setFocus({ lat, lng })
      setTimeout(() => setFocus(null), 250)
    }
  }

  return (
    <main className="mx-auto max-w-240 px-0 pb-0 pt-0">
      <div className="relative h-[calc(100dvh-var(--app-footer-space,0px))] w-full overflow-hidden bg-bgPrimary">
        {/* Map */}
        <div className="absolute inset-0 z-0">
          <MapView
            me={me}
            radiusMiles={radiusMiles}
            pins={pins}
            focus={focus}
            onSelectPin={handleSelectPin}
            onViewportChange={(center) => setMapCenter(center)}
          />
        </div>

        {/* Dark top gradient overlay */}
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
              // ✅ extra separation from the map so it doesn’t wash out
              'shadow-[0_18px_60px_rgba(0,0,0,0.65)]',
            )}
          >
            <div className="flex items-start gap-3">
              {/* Search */}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-black text-textPrimary/85 tracking-wide">Search</div>

                <div
                  className={cx(
                    'mt-1 flex items-center gap-2 rounded-2xl px-3 py-2',
                    // ✅ darker like your “before”
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
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runSearch({ q, origin: mapCenter ?? me })
                    }}
                    placeholder="Hair, lashes, makeup… or a pro name"
                    className={cx(
                      'w-full bg-transparent text-[14px] font-semibold text-textPrimary',
                      'placeholder:text-textPrimary/60 outline-none',
                    )}
                  />

                  {/* ✅ icon on the RIGHT */}
                  <span className="select-none text-[13px] text-textPrimary/75" aria-hidden>
                    🔎
                  </span>
                </div>

                {geoDenied ? (
                  <div className="mt-2 text-[12px] font-semibold text-microAccent">
                    Location is off — we can still search by text, but distance sorting won’t be accurate.
                  </div>
                ) : null}
              </div>

              {/* Controls */}
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
                    onClick={() => void runSearch({ origin: mapCenter ?? me })}
                    className="rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
                  >
                    Go
                  </button>
                </div>
              </div>
            </div>

            {/* ✅ pill tucked INSIDE the top bar block (feels “native”) */}
            {showSearchArea ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => void runSearch({ origin: mapCenter })}
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
        <div className="absolute left-0 right-0 z-20 px-3" style={{ bottom: 'var(--app-footer-space, 0px)', paddingBottom: '12px' }}>
          <div className="tovis-glass-strong rounded-card border border-white/10 bg-bgSecondary p-3">
            {err ? (
              <div className="text-[13px] font-semibold text-microAccent">{err}</div>
            ) : loading ? (
              <div className="text-[13px] font-semibold text-textSecondary">Loading…</div>
            ) : !pros.length ? (
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
                        <a
                          href={`/professionals/${encodeURIComponent(activePro.id)}`}
                          className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                        >
                          View
                        </a>

                        {activeOpenHref ? (
                          <a
                            href={activeOpenHref}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10"
                            title="Open in Maps"
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
                    {pros.slice(0, 30).map((p) => {
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
                                {(p.professionType || 'Professional') +
                                  (p.locationLabel ? ` • ${p.locationLabel}` : '')}
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
