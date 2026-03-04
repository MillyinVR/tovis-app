// app/pro/locations/LocationsClient.tsx
'use client'

import { useMemo, useState } from 'react'
import PlacesAutocomplete from './PlacesAutocomplete'
import { cn } from '@/lib/utils'
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

type JsonObject = Record<string, unknown>

function isRecord(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function safeJsonObject(res: Response): Promise<JsonObject> {
  const raw: unknown = await res.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function isValidUsZip(v: string) {
  return /^\d{5}(-\d{4})?$/.test(v.trim())
}

function parsePickedPlace(v: unknown): PickedPlace | null {
  if (!isRecord(v)) return null
  const placeId = typeof v.placeId === 'string' ? v.placeId : null
  const sessionToken = typeof v.sessionToken === 'string' ? v.sessionToken : null
  return {
    placeId,
    formattedAddress: typeof v.formattedAddress === 'string' ? v.formattedAddress : null,
    city: typeof v.city === 'string' ? v.city : null,
    state: typeof v.state === 'string' ? v.state : null,
    postalCode: typeof v.postalCode === 'string' ? v.postalCode : null,
    countryCode: typeof v.countryCode === 'string' ? v.countryCode : null,
    lat: typeof v.lat === 'number' && Number.isFinite(v.lat) ? v.lat : null,
    lng: typeof v.lng === 'number' && Number.isFinite(v.lng) ? v.lng : null,
    name: typeof v.name === 'string' ? v.name : null,
    sessionToken,
  }
}

function parseProLocation(v: unknown): ProLocation | null {
  if (!isRecord(v)) return null

  const id = typeof v.id === 'string' ? v.id : ''
  const type = typeof v.type === 'string' ? v.type : ''
  if (!id || (type !== 'SALON' && type !== 'SUITE' && type !== 'MOBILE_BASE')) return null

  return {
    id,
    type,
    name: typeof v.name === 'string' ? v.name : null,
    isPrimary: Boolean(v.isPrimary),
    isBookable: Boolean(v.isBookable),

    formattedAddress: typeof v.formattedAddress === 'string' ? v.formattedAddress : null,
    city: typeof v.city === 'string' ? v.city : null,
    state: typeof v.state === 'string' ? v.state : null,
    postalCode: typeof v.postalCode === 'string' ? v.postalCode : null,
    countryCode: typeof v.countryCode === 'string' ? v.countryCode : null,
    placeId: typeof v.placeId === 'string' ? v.placeId : null,

    lat: typeof v.lat === 'number' && Number.isFinite(v.lat) ? v.lat : null,
    lng: typeof v.lng === 'number' && Number.isFinite(v.lng) ? v.lng : null,
    timeZone: typeof v.timeZone === 'string' ? v.timeZone : null,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date().toISOString(),
  }
}

export default function LocationsClient({ initialLocations }: { initialLocations: ProLocation[] }) {
  const [locations, setLocations] = useState<ProLocation[]>(initialLocations)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New location form
  const [type, setType] = useState<LocationType>('SALON')
  const [name, setName] = useState('')
  const [makePrimary, setMakePrimary] = useState(true)

  // MOBILE_BASE fields (miles — matches Prisma: mobileRadiusMiles)
  const [mobilePostalCode, setMobilePostalCode] = useState('')
  const [mobileRadiusMiles, setMobileRadiusMiles] = useState(25)

  const canSave = useMemo(() => !saving, [saving])

  async function refresh() {
    const res = await fetch('/api/pro/locations', { cache: 'no-store' })
    const data = await safeJsonObject(res)

    const raw = Array.isArray(data.locations) ? data.locations : []
    const parsed = raw.map(parseProLocation).filter((x): x is ProLocation => Boolean(x))

    if (res.ok) setLocations(parsed)
  }

  async function createFromPlace(place: PickedPlace) {
    setSaving(true)
    setError(null)

    try {
      const placeId = (place.placeId || '').trim()
      if (!placeId) throw new Error('Please pick an address from the list.')

      const mode: 'SALON' | 'SUITE' = type === 'SUITE' ? 'SUITE' : 'SALON'

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          placeId,
          locationName: name.trim() || null,
          sessionToken: place.sessionToken ?? null,
          makePrimary,
        }),
      })

      const data = await safeJsonObject(res)
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create location')

      setName('')
      setMakePrimary(false)
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create location'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function createMobileBase() {
    setSaving(true)
    setError(null)

    try {
      const zip = mobilePostalCode.trim()
      if (!isValidUsZip(zip)) throw new Error('Enter a valid US ZIP code (e.g. 92024).')

      const miles = clampInt(Number(mobileRadiusMiles), 1, 200)

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'MOBILE',
          postalCode: zip,
          radiusMiles: miles,
          makePrimary,
        }),
      })

      const data = await safeJsonObject(res)
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to create mobile base')

      setMobilePostalCode('')
      setMobileRadiusMiles(25)
      setName('')
      setMakePrimary(false)
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create mobile base'
      setError(msg)
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
      const data = await safeJsonObject(res)
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to set primary')
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to set primary'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  async function deleteLocation(id: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pro/locations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await safeJsonObject(res)
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Failed to delete location')
      await refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete location'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const showPlacePicker = type === 'SALON' || type === 'SUITE'
  const showMobileForm = type === 'MOBILE_BASE'

  return (
    <div className="grid gap-4">
      {/* Add */}
      <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 tovis-glass">
        <div className="mb-3 text-[13px] font-black text-textPrimary">Add a location</div>

        <div className="grid gap-3">
          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textSecondary">Type</div>
            <select
              value={type}
              onChange={(e) => {
                const v = e.target.value
                setType(v === 'SUITE' ? 'SUITE' : v === 'MOBILE_BASE' ? 'MOBILE_BASE' : 'SALON')
              }}
              className={cn(
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
              className={cn(
                'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                'text-[13px] font-semibold text-textPrimary placeholder:text-textSecondary/70 outline-none',
              )}
              disabled={saving}
            />
          </label>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-textPrimary/85">
            <input
              type="checkbox"
              checked={makePrimary}
              onChange={(e) => setMakePrimary(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            Make primary
          </label>

          {showPlacePicker ? (
            <>
              <div className="text-[13px] text-textSecondary">
                Pick an address so your profile can show up in “near me” search.
              </div>

              <PlacesAutocomplete
                disabled={!canSave}
                onPickPlace={(p: unknown) => {
                  const parsed = parsePickedPlace(p)
                  if (!parsed) {
                    setError('Please pick an address from the list.')
                    return
                  }
                  void createFromPlace(parsed)
                }}
              />
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
                    className={cn(
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
                    value={mobileRadiusMiles}
                    onChange={(e) => setMobileRadiusMiles(Number(e.target.value))}
                    className={cn(
                      'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                      'text-[13px] font-bold text-textPrimary outline-none',
                    )}
                    disabled={saving}
                  >
                    <option value={5}>5 miles</option>
                    <option value={10}>10 miles</option>
                    <option value={15}>15 miles</option>
                    <option value={25}>25 miles</option>
                    <option value={40}>40 miles</option>
                    <option value={60}>60 miles</option>
                    <option value={100}>100 miles</option>
                    <option value={150}>150 miles</option>
                    <option value={200}>200 miles</option>
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

          {error ? <div className="text-[13px] font-semibold text-toneDanger">{error}</div> : null}
        </div>
      </div>

      {/* List */}
      <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 tovis-glass">
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
                      (l.type === 'SALON' ? 'Salon location' : l.type === 'SUITE' ? 'Suite location' : 'Mobile base')}
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
                      type="button"
                      onClick={() => void setPrimaryLocation(l.id)}
                      disabled={saving}
                      className="rounded-full border border-white/15 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-white/10 disabled:opacity-50"
                    >
                      Set primary
                    </button>
                  ) : null}

                  <button
                    type="button"
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

      <div className="text-[12px] font-semibold text-textSecondary">
        Pro tip: only set “Primary” to the location you actually want clients to find first.
      </div>
    </div>
  )
}