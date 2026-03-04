// app/pro/locations/PlacesAutocomplete.tsx
'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'

type JsonObject = Record<string, unknown>
type Kind = 'ADDRESS' | 'AREA' | 'ANY'

type Prediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
  distanceMeters: number | null
}

type PlaceDetails = {
  placeId: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: number
  lng: number
  name: string | null
  sessionToken: string
}

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Wraps lib/http.safeJson (unknown|null) and guarantees a plain object.
 * This lets the rest of this file safely read fields as `unknown`.
 */
async function safeJsonObject(res: Response): Promise<JsonObject> {
  const data = await safeJson(res)
  return isRecord(data) ? data : {}
}

function pickText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function pickNullableText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

function pickNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function makeSessionToken() {
  // Lightweight token: good enough for grouping requests in a single user "session"
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function parsePredictions(data: JsonObject): Prediction[] {
  const raw = data.predictions
  if (!Array.isArray(raw)) return []

  const out: Prediction[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue

    const placeId = pickText(item.placeId).trim()
    const description = pickText(item.description).trim()
    if (!placeId || !description) continue

    const mainText = pickText(item.mainText).trim()
    const secondaryText = pickText(item.secondaryText).trim()

    const types = Array.isArray(item.types) ? item.types.filter((x): x is string => typeof x === 'string') : []
    const distanceMeters = pickNullableNumber(item.distanceMeters)

    out.push({ placeId, description, mainText, secondaryText, types, distanceMeters })
  }
  return out
}

function parsePlaceDetails(data: JsonObject, sessionToken: string): PlaceDetails | null {
  const p = data.place
  if (!isRecord(p)) return null

  const placeId = pickText(p.placeId).trim()
  const lat = pickNullableNumber(p.lat)
  const lng = pickNullableNumber(p.lng)
  if (!placeId || lat == null || lng == null) return null

  return {
    placeId,
    formattedAddress: pickNullableText(p.formattedAddress),
    city: pickNullableText(p.city),
    state: pickNullableText(p.state),
    postalCode: pickNullableText(p.postalCode),
    countryCode: pickNullableText(p.countryCode),
    lat,
    lng,
    name: pickNullableText(p.name),
    sessionToken,
  }
}

function isAbortError(e: unknown) {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    typeof (e as { name: unknown }).name === 'string' &&
    (e as { name: string }).name === 'AbortError'
  )
}

export default function PlacesAutocomplete(props: {
  onPickPlace: (place: unknown) => void
  disabled?: boolean
  kind?: Kind
  label?: string
  placeholder?: string
}) {
  const {
    onPickPlace,
    disabled = false,
    kind = 'ADDRESS',
    label = 'Address (Google Places)',
    placeholder = 'Start typing an address…',
  } = props

  const listId = useId()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Prediction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  const sessionTokenRef = useRef<string>(makeSessionToken())
  type TimeoutHandle = ReturnType<typeof setTimeout>
  const timerRef = useRef<TimeoutHandle | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pickingRef = useRef(false)

  const hasQuery = Boolean(q.trim())

  const emptyState = useMemo(() => {
    if (!hasQuery) return 'Start typing to search.'
    if (loading) return 'Searching…'
    if (error) return error
    if (!items.length) return 'No matches.'
    return null
  }, [hasQuery, loading, error, items.length])

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      const el = wrapRef.current
      if (!el) return
      const t = e.target as Node | null
      if (t && el.contains(t)) return
      setOpen(false)
      setActiveIndex(-1)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [])

  // When disabled flips on, collapse UI
  useEffect(() => {
    if (!disabled) return
    setOpen(false)
    setItems([])
    setActiveIndex(-1)
    setError(null)
    setLoading(false)
  }, [disabled])

  // Debounced autocomplete
  useEffect(() => {
    if (disabled) return

    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    // cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    const query = q.trim()
    if (!query) {
      setItems([])
      setError(null)
      setLoading(false)
      setOpen(false)
      setActiveIndex(-1)
      return
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)

      const ac = new AbortController()
      abortRef.current = ac

      try {
        const url =
          `/api/google/places/autocomplete` +
          `?input=${encodeURIComponent(query)}` +
          `&sessionToken=${encodeURIComponent(sessionTokenRef.current)}` +
          `&kind=${encodeURIComponent(kind)}`

        const res = await fetch(url, { cache: 'no-store', signal: ac.signal })
        const data = await safeJsonObject(res)

        if (!res.ok) {
          const msg = typeof data.error === 'string' && data.error.trim() ? data.error : 'Autocomplete failed.'
          throw new Error(msg)
        }

        const preds = parsePredictions(data)
        setItems(preds)
        setOpen(true)
        setActiveIndex(preds.length ? 0 : -1)
      } catch (e: unknown) {
        if (isAbortError(e)) return
        const msg = e instanceof Error ? e.message : 'Autocomplete failed.'
        setError(msg)
        setItems([])
        setOpen(true)
        setActiveIndex(-1)
      } finally {
        if (abortRef.current === ac) abortRef.current = null
        setLoading(false)
      }
    }, 180)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [q, disabled, kind])

  async function pick(placeId: string, fillText: string) {
    if (disabled) return
    pickingRef.current = true

    // Immediately “autofill + close suggestions”
    setQ(fillText)
    setOpen(false)
    setItems([])
    setActiveIndex(-1)
    setError(null)

    // cancel autocomplete in-flight
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    setLoading(true)
    try {
      const st = sessionTokenRef.current
      const res = await fetch(
        `/api/google/places/details?placeId=${encodeURIComponent(placeId)}&sessionToken=${encodeURIComponent(st)}`,
        { cache: 'no-store' },
      )

      const data = await safeJsonObject(res)
      if (!res.ok) {
        const msg = typeof data.error === 'string' && data.error.trim() ? data.error : 'Details failed.'
        throw new Error(msg)
      }

      const place = parsePlaceDetails(data, st)
      if (!place) throw new Error('Place details missing lat/lng.')

      onPickPlace(place)

      // Reset query AFTER pick so UI is clean (and sessionToken resets for next search)
      setQ('')
      setItems([])
      setOpen(false)
      setActiveIndex(-1)
      sessionTokenRef.current = makeSessionToken()
      inputRef.current?.blur()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to select place.'
      setError(msg)
      setOpen(true)
    } finally {
      setLoading(false)
      pickingRef.current = false
    }
  }

  function clear() {
    setQ('')
    setItems([])
    setOpen(false)
    setActiveIndex(-1)
    setError(null)
    setLoading(false)
    sessionTokenRef.current = makeSessionToken()
    inputRef.current?.focus()
  }

  return (
    <div ref={wrapRef} className="relative grid gap-2">
      <div className="grid gap-1">
        <div className="text-[12px] font-black text-textSecondary">{label}</div>

        <div className="relative">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOpen(true)
            }}
            onFocus={() => {
              if (!disabled && q.trim()) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true)

              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                setActiveIndex(-1)
                return
              }

              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (!items.length) return
                setActiveIndex((i) => Math.min(items.length - 1, Math.max(0, i + 1)))
                return
              }

              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (!items.length) return
                setActiveIndex((i) => Math.max(0, i - 1))
                return
              }

              if (e.key === 'Enter') {
                if (!open || activeIndex < 0 || activeIndex >= items.length) return
                e.preventDefault()
                const p = items[activeIndex]
                void pick(p.placeId, p.mainText || p.description)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              'w-full rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2 pr-10',
              'text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70 outline-none',
              'focus:border-white/20',
              disabled && 'opacity-60',
            )}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
          />

          {hasQuery && !disabled ? (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-bgSecondary/60 px-2 py-1 text-[11px] font-black text-textPrimary hover:border-white/20"
              aria-label="Clear"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="text-[11px] text-textSecondary">{loading ? 'Searching…' : ' '}</div>
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-2xl border border-white/10 bg-bgSecondary shadow-[0_24px_90px_rgb(0_0_0/0.55)] backdrop-blur-xl"
        >
          {emptyState ? (
            <div className="px-3 py-3 text-[12px] font-semibold text-textSecondary">{emptyState}</div>
          ) : (
            <div className="grid">
              {items.slice(0, 6).map((p, idx) => {
                const active = idx === activeIndex
                return (
                  <button
                    key={p.placeId}
                    id={`${listId}-opt-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => void pick(p.placeId, p.mainText || p.description)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 transition',
                      active ? 'bg-bgPrimary/35' : 'bg-bgSecondary/40 hover:bg-bgPrimary/30',
                      'border-b border-white/10 last:border-b-0',
                    )}
                  >
                    <div className="text-[13px] font-black text-textPrimary">{p.mainText || p.description}</div>
                    {p.secondaryText ? (
                      <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">{p.secondaryText}</div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}