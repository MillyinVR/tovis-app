// app/pro/locations/LocationsClient.tsx
'use client'

import { useMemo, useState } from 'react'
import PlacesAutocomplete from './PlacesAutocomplete'

type LocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE'

export type ProLocation = {
  id: string
  type: LocationType
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

type PickedPlace = {
  placeId: string | null
  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: number | null
  lng: number | null
  name?: string | null
  sessionToken?: string | null
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function isValidUsZip(v: string) {
  return /^\d{5}(-\d{4})?$/.test(v.trim())
}

export default function LocationsClient({ initialLocations }: { initialLocations: ProLocation[] }) {
  const [locations, setLocations] = useState<ProLocation[]>(initialLocations)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New location form
  const [type, setType] = useState<LocationType>('SALON')
  const [name, setName] = useState('')
  const [isPrimary, setIsPrimary] = useState(true)

  // MOBILE_BASE fields
  const [mobilePostalCode, setMobilePostalCode] = useState('')
  const [mobileRadiusKm, setMobileRadiusKm] = useState(25) // sensible default

  const canSave = useMemo(() => !saving, [saving])

  async function refresh() {
    const res = await fetch('/api/pro/locations', { cache: 'no-store' })
    const data = await safeJson(res)
    if (res.ok) setLocations((data?.locations ?? []) as ProLocation[])
  }

  /**
   * ✅ Create SALON/SUITE via onboarding endpoint (Place Details + TimeZone + primary handling)
   */
  async function createFromPlace(place: PickedPlace) {
    setSaving(true)
    setError(null)

    try {
      const placeId = (place?.placeId || '').trim()
      if (!placeId) throw new Error('Please pick an address from the list.')

      const mode: 'SALON' | 'SUITE' = type === 'SUITE' ? 'SUITE' : 'SALON'

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          placeId,
          locationName: name.trim() || null,
          sessionToken: place?.sessionToken ?? null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create location')

      setName('')
      setIsPrimary(false) // after first create, default new ones to not primary
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to create location')
    } finally {
      setSaving(false)
    }
  }

  /**
   * ✅ Create MOBILE_BASE via onboarding endpoint (zip + radiusKm → geocode + timezone)
   */
  async function createMobileBase() {
    setSaving(true)
    setError(null)

    try {
      const zip = mobilePostalCode.trim()
      if (!isValidUsZip(zip)) throw new Error('Enter a valid US ZIP code (e.g. 92024).')

      const radius = clampInt(Number(mobileRadiusKm), 1, 200)

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'MOBILE',
          postalCode: zip,
          radiusKm: radius,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to create mobile base')

      setMobilePostalCode('')
      setMobileRadiusKm(25)
      setName('')
      setIsPrimary(false)
      await refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to create mobile base')
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

  const showPlacePicker = type === 'SALON' || type === 'SUITE'
  const showMobileForm = type === 'MOBILE_BASE'

  return (
    <div className="grid gap-4">
      {/* Add */}
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3 text-[13px] font-black text-textPrimary">Add a location</div>

        <div className="grid gap-3">
          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textSecondary">Type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LocationType)}
              className={cx(
                'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                'text-[13px] font-bold text-textPrimary outline-none',
              )}
              disabled={saving}
            >
              <option value="SALON">Salon</option>
              <option value="SUITE">Suite</option>
              <option value="MOBILE_BASE">Mobile Base</option>
            </select>
          </label>

          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textSecondary">Name (optional)</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'MOBILE_BASE' ? 'e.g. Mobile in North County' : 'e.g. Encinitas Studio'}
              className={cx(
                'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                'text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70 outline-none',
              )}
              disabled={saving}
            />
          </label>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-textPrimary/85">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} disabled={saving} />
            Make primary
          </label>

          {showPlacePicker ? (
            <>
              <div className="text-[13px] text-textSecondary">
                Pick an address so your profile can show up in “near me” search.
              </div>

              {/* NOTE: onboarding route always makes the created location primary.
                  If you want to respect isPrimary=false, we can change the API.
                  For now: UI checkbox is forward-looking. */}
              <PlacesAutocomplete disabled={!canSave} onPickPlace={(p: any) => void createFromPlace(p as PickedPlace)} />
            </>
          ) : null}

          {showMobileForm ? (
            <>
              <div className="text-[13px] text-textSecondary">
                Set your “home base” ZIP and how far you travel. This is used for discovery + mobile service logic.
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-2">
                  <div className="text-[12px] font-black text-textSecondary">ZIP code</div>
                  <input
                    value={mobilePostalCode}
                    onChange={(e) => setMobilePostalCode(e.target.value)}
                    placeholder="e.g. 92024"
                    className={cx(
                      'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                      'text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70 outline-none',
                    )}
                    disabled={saving}
                    inputMode="numeric"
                  />
                </label>

                <label className="grid gap-2">
                  <div className="text-[12px] font-black text-textSecondary">Travel radius</div>
                  <select
                    value={mobileRadiusKm}
                    onChange={(e) => setMobileRadiusKm(Number(e.target.value))}
                    className={cx(
                      'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                      'text-[13px] font-bold text-textPrimary outline-none',
                    )}
                    disabled={saving}
                  >
                    <option value={5}>5 km</option>
                    <option value={10}>10 km</option>
                    <option value={15}>15 km</option>
                    <option value={25}>25 km</option>
                    <option value={40}>40 km</option>
                    <option value={60}>60 km</option>
                    <option value={100}>100 km</option>
                    <option value={150}>150 km</option>
                    <option value={200}>200 km</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                disabled={!canSave}
                onClick={() => void createMobileBase()}
                className="mt-1 rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
              >
                Save mobile base
              </button>
            </>
          ) : null}

          {error ? <div className="text-[13px] font-semibold text-microAccent">{error}</div> : null}
        </div>
      </div>

      {/* List */}
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3 text-[13px] font-black text-textPrimary">Your locations</div>

        {locations.length === 0 ? (
          <div className="text-[13px] text-textSecondary">No locations yet.</div>
        ) : (
          <div className="grid gap-2">
            {locations.map((l) => (
              <div key={l.id} className="rounded-card border border-white/10 bg-bgPrimary/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[13px] font-black text-textPrimary">
                    {l.name ||
                      (l.type === 'SALON'
                        ? 'Salon location'
                        : l.type === 'SUITE'
                          ? 'Suite location'
                          : 'Mobile base')}
                  </div>

                  {l.isPrimary ? (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-black text-textPrimary">
                      PRIMARY
                    </span>
                  ) : null}

                  <span className="text-[11px] font-bold text-textSecondary">{l.type}</span>
                </div>

                <div className="mt-2 text-[13px] font-semibold text-textPrimary/85">
                  {l.formattedAddress ||
                    ([l.city, l.state].filter(Boolean).join(', ') || null) ||
                    (l.postalCode ? `ZIP ${l.postalCode}` : null) ||
                    '—'}
                </div>

                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  TZ: {l.timeZone || '—'} • Lat/Lng: {l.lat ?? '—'},{l.lng ?? '—'}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!l.isPrimary ? (
                    <button
                      onClick={() => void setPrimaryLocation(l.id)}
                      disabled={saving}
                      className="rounded-full border border-white/15 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-50"
                    >
                      Set primary
                    </button>
                  ) : null}

                  <button
                    onClick={() => void deleteLocation(l.id)}
                    disabled={saving}
                    className="rounded-full border border-white/15 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* tiny footnote because otherwise future-you will hate present-you */}
      <div className="text-[12px] font-semibold text-textSecondary">
        Note: your onboarding create endpoint currently makes the created location primary automatically. If you want the “Make primary”
        checkbox to actually be honored, we can add an optional flag to the API next.
      </div>
    </div>
  )
}
