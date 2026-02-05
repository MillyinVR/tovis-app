// app/(main)/search/SearchClient.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MapPin, X } from 'lucide-react'

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

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
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

export default function SearchClient() {
  const [tab, setTab] = useState<Tab>('PROS')

  // query text
  const [q, setQ] = useState('')

  // location search (google autocomplete)
  const [locOpen, setLocOpen] = useState(false)
  const [locQuery, setLocQuery] = useState('')
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [predLoading, setPredLoading] = useState(false)

  // selected location (lat/lng bias)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [selectedLat, setSelectedLat] = useState<number | null>(null)
  const [selectedLng, setSelectedLng] = useState<number | null>(null)

  const [radiusMiles, setRadiusMiles] = useState(15)

  // results
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<SearchResult>({ pros: [], services: [] })

  const debounceRef = useRef<any>(null)

  // --- location autocomplete ---
  useEffect(() => {
    if (!locOpen) return

    const input = locQuery.trim()
    if (!input) {
      setPredictions([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        setPredLoading(true)
        const sessionToken = crypto?.randomUUID?.() ?? String(Date.now())

        const qs = new URLSearchParams({
          input,
          sessionToken,
          // optional bias if we already have a selection
          ...(selectedLat != null && selectedLng != null
            ? { lat: String(selectedLat), lng: String(selectedLng), radiusMeters: String(Math.round(radiusMiles * 1609.34)) }
            : {}),
        })

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, { cache: 'no-store' })
        const j = await safeJson(res)
        if (!res.ok) throw new Error(j?.error || 'Failed to load suggestions')

        setPredictions(Array.isArray(j?.predictions) ? j.predictions : [])
      } catch {
        setPredictions([])
      } finally {
        setPredLoading(false)
      }
    }, 180)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [locOpen, locQuery, radiusMiles, selectedLat, selectedLng])

  async function choosePrediction(p: PlacePrediction) {
    try {
      setPredLoading(true)

      const sessionToken = crypto?.randomUUID?.() ?? String(Date.now())
      const res = await fetch(`/api/google/places/details?placeId=${encodeURIComponent(p.placeId)}&sessionToken=${encodeURIComponent(sessionToken)}`, {
        cache: 'no-store',
      })
      const j = await safeJson(res)
      if (!res.ok) throw new Error(j?.error || 'Failed to load place details')

      const place = j?.place
      const lat = typeof place?.lat === 'number' ? place.lat : null
      const lng = typeof place?.lng === 'number' ? place.lng : null

      setSelectedLabel(p.description)
      setSelectedPlaceId(String(place?.placeId || p.placeId))
      setSelectedLat(lat)
      setSelectedLng(lng)

      setLocOpen(false)
      setLocQuery('')
      setPredictions([])
    } finally {
      setPredLoading(false)
    }
  }

  function clearLocation() {
    setSelectedLabel(null)
    setSelectedPlaceId(null)
    setSelectedLat(null)
    setSelectedLng(null)
  }

  // --- search API ---
  const canSearch = useMemo(() => q.trim().length > 0 || (selectedLat != null && selectedLng != null), [q, selectedLat, selectedLng])

  useEffect(() => {
    if (!canSearch) {
      setData({ pros: [], services: [] })
      setErr(null)
      return
    }

    const handle = setTimeout(async () => {
      try {
        setLoading(true)
        setErr(null)

        const qs = new URLSearchParams()
        if (q.trim()) qs.set('q', q.trim())
        qs.set('tab', tab)
        qs.set('radiusMiles', String(radiusMiles))

        if (selectedLat != null && selectedLng != null) {
          qs.set('lat', String(selectedLat))
          qs.set('lng', String(selectedLng))
        }

        const res = await fetch(`/api/search?${qs.toString()}`, { cache: 'no-store' })
        const j = await safeJson(res)
        if (!res.ok) throw new Error(j?.error || 'Search failed.')

        setData({
          pros: Array.isArray(j?.pros) ? j.pros : [],
          services: Array.isArray(j?.services) ? j.services : [],
        })
      } catch (e: any) {
        setErr(e?.message || 'Search failed.')
        setData({ pros: [], services: [] })
      } finally {
        setLoading(false)
      }
    }, 220)

    return () => clearTimeout(handle)
  }, [canSearch, q, tab, selectedLat, selectedLng, radiusMiles])

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
            >
              <MapPin size={16} className="opacity-80" />
              {selectedLabel ? 'Location set' : 'Choose location'}
            </button>

            {selectedLabel ? (
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
          <div className="mt-3 rounded-card border border-white/10 bg-bgPrimary/20 p-3">
            <div className="text-[12px] font-black text-textPrimary">Search near</div>

            <div className="mt-2 flex items-center gap-2 rounded-full border border-white/10 bg-bgSecondary px-4 py-3">
              <Search size={16} className="opacity-80" />
              <input
                value={locQuery}
                onChange={(e) => setLocQuery(e.target.value)}
                placeholder="City, neighborhood, or address"
                className="w-full bg-transparent text-[13px] font-semibold text-textPrimary outline-none placeholder:text-textSecondary"
                autoFocus
              />
              {predLoading ? <div className="text-[11px] font-bold text-textSecondary">…</div> : null}
            </div>

            <div className="mt-2 flex items-center justify-between">
              <div className="text-[11px] font-semibold text-textSecondary">
                Radius: <span className="text-textPrimary font-black">{radiusMiles} mi</span>
              </div>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
                className="w-40"
              />
            </div>

            <div className="mt-3 grid gap-2">
              {predictions.length ? (
                predictions.slice(0, 7).map((p) => (
                  <button
                    key={p.placeId}
                    type="button"
                    onClick={() => choosePrediction(p)}
                    className="rounded-card border border-white/10 bg-bgSecondary p-3 text-left hover:bg-white/5"
                  >
                    <div className="text-[13px] font-black text-textPrimary">{p.mainText || p.description}</div>
                    <div className="mt-1 text-[12px] font-semibold text-textSecondary">{p.secondaryText || p.description}</div>
                  </button>
                ))
              ) : (
                <div className="text-[12px] font-semibold text-textSecondary">
                  Start typing a city or address.
                </div>
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
                        <a href={href} className="min-w-0">
                          <div className="truncate text-[14px] font-black text-textPrimary">{p.businessName || 'Professional'}</div>
                          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                            {(p.professionType || 'Beauty professional') + ' • ' + loc}
                            {dist ? <span className="text-textSecondary"> • {dist}</span> : null}
                          </div>
                        </a>

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
                          <a
                            href={href}
                            className="rounded-full bg-accentPrimary px-3 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
                          >
                            View
                          </a>
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
