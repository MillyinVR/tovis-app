// app/pro/locations/PlacesAutocomplete.tsx

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function makeSessionToken() {
  // lightweight token: good enough for grouping requests
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function PlacesAutocomplete({
  onPickPlace,
  disabled,
}: {
  onPickPlace: (place: any) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  const sessionToken = useMemo(() => makeSessionToken(), [])
  const timerRef = useRef<any>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const query = q.trim()
    if (!query) {
      setItems([])
      setError(null)
      setLoading(false)
      return
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/google/places/autocomplete?input=${encodeURIComponent(query)}&sessionToken=${encodeURIComponent(sessionToken)}`,
          { cache: 'no-store' },
        )
        const data = await safeJson(res)
        if (!res.ok) throw new Error(data?.error || 'Autocomplete failed')

        setItems(Array.isArray(data?.predictions) ? data.predictions : [])
      } catch (e: any) {
        setError(e?.message || 'Autocomplete failed')
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 180)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [q, sessionToken])

  async function pick(placeId: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/google/places/details?placeId=${encodeURIComponent(placeId)}&sessionToken=${encodeURIComponent(sessionToken)}`,
        { cache: 'no-store' },
      )
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Details failed')

      const place = data?.place
      if (!place?.placeId || typeof place?.lat !== 'number' || typeof place?.lng !== 'number') {
        throw new Error('Place details missing lat/lng')
      }

      onPickPlace(place)
      setQ('')
      setItems([])
    } catch (e: any) {
      setError(e?.message || 'Failed to select place')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.75)' }}>
          Address (Google Places)
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Start typing an address..."
          disabled={disabled || loading}
          style={{
            padding: 10,
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.25)',
            color: 'white',
            outline: 'none',
          }}
        />
      </label>

      {loading ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>Searching…</div>
      ) : null}

      {error ? <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div> : null}

      {items.length ? (
        <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, overflow: 'hidden' }}>
          {items.slice(0, 6).map((p) => (
            <button
              key={p.placeId}
              type="button"
              onClick={() => pick(p.placeId)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                border: 'none',
                background: 'rgba(0,0,0,0.22)',
                color: 'white',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 13 }}>{p.mainText || p.description}</div>
              {p.secondaryText ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{p.secondaryText}</div>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
