// app/pro/locations/LocationsClient.tsx

'use client'

import { useMemo, useState } from 'react'
import PlacesAutocomplete from './PlacesAutocomplete'

type ProLocation = {
  id: string
  type: string
  name: string | null
  isPrimary: boolean
  isBookable: boolean
  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  timeZone: string | null
  createdAt: string
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function cardStyle(): React.CSSProperties {
  return {
    borderRadius: 16,
    padding: 14,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.04)',
  }
}

export default function LocationsClient({ initialLocations }: { initialLocations: ProLocation[] }) {
  const [locations, setLocations] = useState<ProLocation[]>(initialLocations)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New location form
  const [type, setType] = useState<'SALON' | 'MOBILE_BASE'>('SALON')
  const [name, setName] = useState('')
  const [isPrimary, setIsPrimary] = useState(true)

  const canSave = useMemo(() => {
    if (saving) return false
    if (type === 'SALON') return true // address selection enforces required bits
    return true
  }, [saving, type])

  async function refresh() {
    const res = await fetch('/api/pro/locations', { cache: 'no-store' })
    const data = await safeJson(res)
    if (res.ok) setLocations((data?.locations ?? []) as ProLocation[])
  }

  async function createFromPlace(place: any) {
    setSaving(true)
    setError(null)
    try {
      // Get timezone for lat/lng
      let timeZoneId: string | null = null
      if (typeof place?.lat === 'number' && typeof place?.lng === 'number') {
        const tzRes = await fetch(`/api/google/timezone?lat=${encodeURIComponent(place.lat)}&lng=${encodeURIComponent(place.lng)}`, {
          cache: 'no-store',
        })
        const tzData = await safeJson(tzRes)
        if (tzRes.ok) timeZoneId = tzData?.timeZoneId ?? null
      }

      const res = await fetch('/api/pro/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim() || null,
          isPrimary,
          isBookable: true,
          placeId: place?.placeId ?? null,
          formattedAddress: place?.formattedAddress ?? null,
          city: place?.city ?? null,
          state: place?.state ?? null,
          postalCode: place?.postalCode ?? null,
          countryCode: place?.countryCode ?? null,
          lat: place?.lat ?? null,
          lng: place?.lng ?? null,
          timeZone: timeZoneId,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create location')

      setName('')
      setIsPrimary(false)
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to create location')
    } finally {
      setSaving(false)
    }
  }

  async function setPrimaryLocation(id: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/locations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrimary: true }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to set primary')
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to set primary')
    } finally {
      setSaving(false)
    }
  }

  async function deleteLocation(id: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/locations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to delete location')
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete location')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={cardStyle()}>
        <div style={{ fontWeight: 1000, marginBottom: 10 }}>Add a location</div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.75)' }}>Type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'white' }}
              disabled={saving}
            >
              <option value="SALON">Salon / Suite</option>
              <option value="MOBILE_BASE">Mobile Base (optional)</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.75)' }}>Name (optional)</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Encinitas Studio"
              style={{ padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'white' }}
              disabled={saving}
            />
          </label>

          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              disabled={saving}
            />
            Make primary
          </label>

          {type === 'SALON' ? (
            <PlacesAutocomplete disabled={!canSave} onPickPlace={createFromPlace} />
          ) : (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
              Mobile base is optional. If you want discovery bias, pick a city/address anyway.
              <div style={{ marginTop: 10 }}>
                <PlacesAutocomplete disabled={!canSave} onPickPlace={createFromPlace} />
              </div>
            </div>
          )}

          {error ? <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div> : null}
        </div>
      </div>

      <div style={cardStyle()}>
        <div style={{ fontWeight: 1000, marginBottom: 10 }}>Your locations</div>

        {locations.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>No locations yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {locations.map((l) => (
              <div
                key={l.id}
                style={{
                  borderRadius: 14,
                  padding: 12,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(0,0,0,0.18)',
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 1000 }}>
                    {l.name || (l.type === 'SALON' ? 'Salon location' : 'Mobile base')}
                  </div>
                  {l.isPrimary ? (
                    <span style={{ fontSize: 12, fontWeight: 900, padding: '3px 8px', borderRadius: 999, border: '1px solid rgba(226,200,120,0.5)', color: '#E2C878' }}>
                      PRIMARY
                    </span>
                  ) : null}
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{l.type}</span>
                </div>

                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>
                  {l.formattedAddress || `${l.city || ''}${l.state ? `, ${l.state}` : ''}` || '—'}
                </div>

                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
                  TZ: {l.timeZone || '—'} • Lat/Lng: {l.lat ?? '—'},{l.lng ?? '—'}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!l.isPrimary ? (
                    <button
                      onClick={() => setPrimaryLocation(l.id)}
                      disabled={saving}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 12,
                        border: '1px solid rgba(226,200,120,0.6)',
                        background: 'rgba(226,200,120,0.12)',
                        color: '#E2C878',
                        fontWeight: 900,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Set primary
                    </button>
                  ) : null}

                  <button
                    onClick={() => deleteLocation(l.id)}
                    disabled={saving}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 12,
                      border: '1px solid rgba(239,68,68,0.7)',
                      background: 'rgba(239,68,68,0.10)',
                      color: 'rgba(255,170,170,0.95)',
                      fontWeight: 900,
                      cursor: saving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
