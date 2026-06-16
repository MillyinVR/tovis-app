// app/client/settings/ClientLocationSettings.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
}

const RADIUS_OPTIONS = [5, 10, 15, 25, 50].filter(
  (n) => n >= VIEWER_RADIUS_MIN_MILES && n <= VIEWER_RADIUS_MAX_MILES,
)

function makeSessionToken() {
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
  const lat = typeof place.lat === 'number' && Number.isFinite(place.lat) ? place.lat : null
  const lng = typeof place.lng === 'number' && Number.isFinite(place.lng) ? place.lng : null
  if (!placeId || lat == null || lng == null) return null
  return {
    placeId,
    name: pickText(place.name) || null,
    formattedAddress: pickText(place.formattedAddress) || null,
    lat,
    lng,
  }
}

export default function ClientLocationSettings() {
  const [viewer, setViewer] = useState<ViewerLocation | null>(null)
  const [radiusMiles, setRadiusMiles] = useState(VIEWER_RADIUS_DEFAULT_MILES)

  const [query, setQuery] = useState('')
  const [predictions, setPredictions] = useState<PlacePrediction[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const sessionTokenRef = useRef<string>(makeSessionToken())

  useEffect(() => {
    const initial = loadViewerLocation()
    setViewer(initial)
    if (initial?.radiusMiles) setRadiusMiles(initial.radiusMiles)
    return subscribeViewerLocation((v) => {
      setViewer(v)
      if (v?.radiusMiles) setRadiusMiles(v.radiusMiles)
    })
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setPredictions([])
      setLoading(false)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        setLoading(true)
        setErr(null)

        const qs = new URLSearchParams()
        qs.set('input', q)
        qs.set('sessionToken', sessionTokenRef.current)
        qs.set('kind', 'AREA')
        qs.set('components', 'country:us')

        const res = await fetch(`/api/google/places/autocomplete?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: ac.signal,
        })
        const raw = await safeJson(res)
        if (!res.ok) {
          setPredictions([])
          setErr('Could not search locations.')
          return
        }
        setPredictions(parsePredictions(raw))
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setPredictions([])
        setErr('Could not search locations.')
      } finally {
        setLoading(false)
      }
    }, 220)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [query])

  const applyRadius = useCallback(
    (next: number) => {
      setRadiusMiles(next)
      if (!viewer) return
      setViewerLocation({
        label: viewer.label,
        lat: viewer.lat,
        lng: viewer.lng,
        placeId: viewer.placeId,
        radiusMiles: next,
      })
    },
    [viewer],
  )

  const choose = useCallback(
    async (p: PlacePrediction) => {
      setErr(null)
      try {
        const qs = new URLSearchParams()
        qs.set('placeId', p.placeId)
        qs.set('sessionToken', sessionTokenRef.current)

        const res = await fetch(`/api/google/places/details?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        const raw = await safeJson(res)
        if (!res.ok) {
          setErr('Could not load that location.')
          return
        }
        const place = parsePlaceDetails(raw)
        if (!place) {
          setErr('Could not read that location.')
          return
        }

        setViewerLocation({
          label: p.description || place.formattedAddress || 'Location',
          lat: place.lat,
          lng: place.lng,
          placeId: place.placeId,
          radiusMiles,
        })

        setQuery('')
        setPredictions([])
        sessionTokenRef.current = makeSessionToken()
      } catch {
        setErr('Could not set location.')
      }
    },
    [radiusMiles],
  )

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold text-textSecondary">
          Current:{' '}
          <span className="font-black text-textPrimary">
            {viewer ? `${viewer.label} • ${viewer.radiusMiles} mi` : 'Not set'}
          </span>
        </div>

        {viewer ? (
          <button
            type="button"
            onClick={() => clearViewerLocation()}
            className="rounded-full border border-white/10 bg-transparent px-3 py-1.5 text-xs font-black text-textSecondary hover:text-textPrimary"
          >
            Clear
          </button>
        ) : null}

        <Link
          href="/looks"
          className="ml-auto rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-1.5 text-xs font-black text-textPrimary hover:bg-white/10"
        >
          Browse Looks
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-textSecondary">Radius</span>
        <select
          value={viewer?.radiusMiles ?? radiusMiles}
          onChange={(e) => applyRadius(Number(e.target.value))}
          className="rounded-full border border-white/10 bg-bgPrimary/20 px-3 py-1.5 text-xs font-black text-textPrimary outline-none"
        >
          {RADIUS_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} mi
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='ZIP code or city (e.g. "92101" or "San Diego")'
          className="w-full rounded-card border border-white/10 bg-bgPrimary/20 px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary"
        />

        {err ? <div className="text-[12px] font-semibold text-rose-300">{err}</div> : null}
        {loading ? <div className="text-[12px] font-semibold text-textSecondary">Searching…</div> : null}

        {predictions.length ? (
          <div className="grid gap-2">
            {predictions.slice(0, 8).map((p) => (
              <button
                key={p.placeId}
                type="button"
                onClick={() => choose(p)}
                className="rounded-card border border-white/10 bg-bgPrimary/15 p-2 text-left hover:bg-white/5"
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
    </div>
  )
}