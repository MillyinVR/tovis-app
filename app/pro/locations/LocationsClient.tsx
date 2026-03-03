// app/pro/locations/LocationsClient.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import PlacesAutocomplete from './PlacesAutocomplete'
import { directionsHrefFromLocation, mapsHrefFromLocation } from '@/lib/maps'

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

type ToastState = { tone: 'success' | 'error'; title: string; body?: string | null }

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function readNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function readBool(v: unknown): boolean {
  return typeof v === 'boolean' ? v : Boolean(v)
}

function readNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function readErrorMessage(v: unknown): string | null {
  if (!isRecord(v)) return null
  const e = v.error
  return typeof e === 'string' && e.trim() ? e : null
}

function parseLocationType(v: string): LocationType {
  const s = v.trim().toUpperCase()
  if (s === 'SALON') return 'SALON'
  if (s === 'SUITE') return 'SUITE'
  if (s === 'MOBILE_BASE') return 'MOBILE_BASE'
  return 'SALON'
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function isValidUsZip(v: string) {
  return /^\d{5}(-\d{4})?$/.test(v.trim())
}

function parsePickedPlace(v: unknown): PickedPlace | null {
  if (!isRecord(v)) return null
  return {
    placeId: readNullableString(v.placeId),
    formattedAddress: readNullableString(v.formattedAddress),
    city: readNullableString(v.city),
    state: readNullableString(v.state),
    postalCode: readNullableString(v.postalCode),
    countryCode: readNullableString(v.countryCode),
    lat: readNullableNumber(v.lat),
    lng: readNullableNumber(v.lng),
    name: readNullableString(v.name),
    sessionToken: readNullableString(v.sessionToken),
  }
}

function parseLocationsPayload(v: unknown): ProLocation[] {
  if (!isRecord(v)) return []
  const raw = v.locations
  if (!Array.isArray(raw)) return []

  const out: ProLocation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = readString(item.id)
    const type = parseLocationType(readString(item.type))
    if (!id) continue

    out.push({
      id,
      type,
      name: readNullableString(item.name),
      isPrimary: readBool(item.isPrimary),
      isBookable: readBool(item.isBookable),

      formattedAddress: readNullableString(item.formattedAddress),
      city: readNullableString(item.city),
      state: readNullableString(item.state),
      postalCode: readNullableString(item.postalCode),
      countryCode: readNullableString(item.countryCode),
      placeId: readNullableString(item.placeId),

      lat: readNullableNumber(item.lat),
      lng: readNullableNumber(item.lng),
      timeZone: readNullableString(item.timeZone),
      createdAt: readString(item.createdAt) || new Date().toISOString(),
    })
  }

  return out
}

function formatLocationTitle(l: ProLocation) {
  return (
    l.name ||
    (l.type === 'SALON'
      ? 'Salon location'
      : l.type === 'SUITE'
        ? 'Suite location'
        : 'Mobile base')
  )
}

function formatLocationAddress(l: ProLocation) {
  const addr = (l.formattedAddress || '').trim()
  if (addr) return addr
  const cityState = [l.city, l.state].filter(Boolean).join(', ')
  if (cityState) return cityState
  if (l.postalCode) return `ZIP ${l.postalCode}`
  return '—'
}

function kmToMiles(km: number) {
  return Math.round(km * 0.621371)
}

function ConfirmModal(props: {
  open: boolean
  title: string
  body?: string | null
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  tone?: 'danger' | 'neutral'
  onCancel: () => void
  onConfirm: () => void
}) {
  const {
    open,
    title,
    body,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    busy = false,
    tone = 'neutral',
    onCancel,
    onConfirm,
  } = props

  if (!open) return null

  const confirmTone =
    tone === 'danger'
      ? 'border-toneDanger/35 bg-toneDanger/10 text-toneDanger hover:border-toneDanger/55'
      : 'border-accentPrimary/35 bg-accentPrimary/12 text-textPrimary hover:border-accentPrimary/55'

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-bgSecondary shadow-[0_50px_160px_rgb(0_0_0/0.78)] backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-white/10 p-4">
          <div className="text-[14px] font-black text-textPrimary">{title}</div>
          {body ? <div className="mt-1 text-[12px] text-textSecondary">{body}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cx(
              'rounded-full border px-4 py-2 text-[12px] font-black transition disabled:opacity-60',
              confirmTone,
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Toast(props: ToastState) {
  const tone =
    props.tone === 'success'
      ? 'border-toneSuccess/25 bg-toneSuccess/10'
      : 'border-toneDanger/25 bg-toneDanger/10'

  return (
    <div
      className={cx(
        'rounded-2xl border px-4 py-3 shadow-[0_24px_90px_rgb(0_0_0/0.55)] backdrop-blur-xl',
        'tovis-glass-strong tovis-noise',
        tone,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="text-sm font-black text-textPrimary">{props.title}</div>
      {props.body ? <div className="mt-0.5 text-xs text-textSecondary">{props.body}</div> : null}
    </div>
  )
}

export default function LocationsClient({ initialLocations }: { initialLocations: ProLocation[] }) {
  const [locations, setLocations] = useState<ProLocation[]>(initialLocations)

  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimer = useRef<number | null>(null)

  function showToast(next: ToastState, ms = 2200) {
    setToast(next)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  // New location form
  const [type, setType] = useState<LocationType>('SALON')
  const [name, setName] = useState('')
  const [makePrimary, setMakePrimary] = useState<boolean>(() => initialLocations.length === 0)

  // picked place (SALON/SUITE)
  const [pickedPlace, setPickedPlace] = useState<PickedPlace | null>(null)

  // MOBILE_BASE fields
  const [mobilePostalCode, setMobilePostalCode] = useState('')
  const [mobileRadiusKm, setMobileRadiusKm] = useState(25)

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })

  const canInteract = useMemo(() => !busy, [busy])

  const showPlacePicker = type === 'SALON' || type === 'SUITE'
  const showMobileForm = type === 'MOBILE_BASE'

  // When type changes, reset type-specific state
  useEffect(() => {
    setError(null)
    setPickedPlace(null)
    // Keep name + makePrimary (user intent)
  }, [type])

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pro/locations', { cache: 'no-store' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? `Failed to refresh (${res.status}).`)
      setLocations(parseLocationsPayload(data))
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to refresh.'
      setError(msg)
      showToast({ tone: 'error', title: 'Couldn’t refresh', body: msg })
    } finally {
      setBusy(false)
      setBusyId(null)
    }
  }

  async function setPrimaryLocation(id: string) {
    setBusy(true)
    setBusyId(id)
    setError(null)

    // optimistic
    setLocations((prev) => prev.map((l) => ({ ...l, isPrimary: l.id === id })))

    try {
      const res = await fetch(`/api/pro/locations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrimary: true }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? `Failed to set primary (${res.status}).`)

      showToast({ tone: 'success', title: 'Primary updated' })
      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to set primary.'
      setError(msg)
      showToast({ tone: 'error', title: 'Couldn’t set primary', body: msg })
      await refresh()
    } finally {
      setBusy(false)
      setBusyId(null)
    }
  }

  async function deleteLocationConfirmed(id: string) {
    setBusy(true)
    setBusyId(id)
    setError(null)

    try {
      const res = await fetch(`/api/pro/locations/${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? `Failed to delete (${res.status}).`)

      showToast({ tone: 'success', title: 'Location deleted' })
      setConfirmDelete({ open: false, id: null })
      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to delete location.'
      setError(msg)
      showToast({ tone: 'error', title: 'Couldn’t delete', body: msg })
    } finally {
      setBusy(false)
      setBusyId(null)
    }
  }

  /**
   * Create SALON/SUITE via onboarding endpoint (Place Details + TimeZone)
   * Then: honor "Make primary" by restoring previous primary when unchecked.
   */
  async function createFromPickedPlace() {
    setBusy(true)
    setBusyId(null)
    setError(null)

    try {
      const placeId = (pickedPlace?.placeId || '').trim()
      if (!placeId) throw new Error('Pick an address from the list first.')

      const prevPrimary = locations.find((l) => l.isPrimary)?.id ?? null
      const mode: 'SALON' | 'SUITE' = type === 'SUITE' ? 'SUITE' : 'SALON'

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          placeId,
          locationName: name.trim() || null,
          sessionToken: pickedPlace?.sessionToken ?? null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? 'Failed to create location.')

      // If user did NOT want it primary and we had a previous primary, restore it.
      // (This effectively de-primary's the newly created one.)
      if (!makePrimary && prevPrimary) {
        const res2 = await fetch(`/api/pro/locations/${encodeURIComponent(prevPrimary)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPrimary: true }),
        })
        const data2 = await safeJson(res2)
        if (!res2.ok) {
          // Not fatal; the location exists. Just warn.
          showToast({
            tone: 'error',
            title: 'Created, but primary restore failed',
            body: readErrorMessage(data2) ?? `Restore failed (${res2.status}).`,
          })
        }
      } else {
        showToast({ tone: 'success', title: 'Location added' })
      }

      // reset form bits
      setName('')
      setPickedPlace(null)
      setMakePrimary(false) // future additions default to not primary once at least one exists

      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to create location.'
      setError(msg)
      showToast({ tone: 'error', title: 'Couldn’t add location', body: msg })
    } finally {
      setBusy(false)
      setBusyId(null)
    }
  }

  /**
   * Create MOBILE_BASE via onboarding endpoint (zip + radiusKm → geocode + timezone)
   * Then honor "Make primary" same way as above.
   */
  async function createMobileBase() {
    setBusy(true)
    setBusyId(null)
    setError(null)

    try {
      const zip = mobilePostalCode.trim()
      if (!isValidUsZip(zip)) throw new Error('Enter a valid US ZIP code (e.g. 92024).')

      const radius = clampInt(Number(mobileRadiusKm), 1, 200)
      const prevPrimary = locations.find((l) => l.isPrimary)?.id ?? null

      const res = await fetch('/api/pro/onboarding/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'MOBILE',
          postalCode: zip,
          radiusKm: radius,
          locationName: name.trim() || null,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(readErrorMessage(data) ?? 'Failed to create mobile base.')

      if (!makePrimary && prevPrimary) {
        const res2 = await fetch(`/api/pro/locations/${encodeURIComponent(prevPrimary)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPrimary: true }),
        })
        const data2 = await safeJson(res2)
        if (!res2.ok) {
          showToast({
            tone: 'error',
            title: 'Created, but primary restore failed',
            body: readErrorMessage(data2) ?? `Restore failed (${res2.status}).`,
          })
        }
      } else {
        showToast({ tone: 'success', title: 'Mobile base added' })
      }

      setMobilePostalCode('')
      setMobileRadiusKm(25)
      setName('')
      setMakePrimary(false)
      await refresh()
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to create mobile base.'
      setError(msg)
      showToast({ tone: 'error', title: 'Couldn’t add mobile base', body: msg })
    } finally {
      setBusy(false)
      setBusyId(null)
    }
  }

  const radiusOptions = useMemo(() => [5, 10, 15, 25, 40, 60, 100, 150, 200], [])

  const primaryCount = useMemo(() => locations.filter((l) => l.isPrimary).length, [locations])

  return (
    <div className="grid gap-4">
      {/* Toast */}
      {toast ? (
        <div className="fixed right-3 top-3 z-[9999] w-[min(380px,calc(100vw-24px))]">
          <Toast tone={toast.tone} title={toast.title} body={toast.body ?? null} />
        </div>
      ) : null}

      <ConfirmModal
        open={confirmDelete.open}
        title="Delete this location?"
        body="This removes it from your profile and booking system. If you have bookings tied to it, the server may block deletion."
        confirmLabel="Delete"
        tone="danger"
        busy={busy && Boolean(confirmDelete.id)}
        onCancel={() => (busy ? null : setConfirmDelete({ open: false, id: null }))}
        onConfirm={() => {
          const id = confirmDelete.id
          if (!id || busy) return
          void deleteLocationConfirmed(id)
        }}
      />

      {/* Add */}
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[13px] font-black text-textPrimary">Add a location</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              This powers “near me” discovery and sets the timezone used for booking math.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-1 text-[11px] font-black text-textPrimary">
              {locations.length} total
            </span>
            <span className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-1 text-[11px] font-black text-textPrimary">
              {primaryCount ? 'Primary set' : 'No primary'}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!canInteract}
              className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-1.5 text-[11px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-2">
            <div className="text-[12px] font-black text-textSecondary">Type</div>
            <select
              value={type}
              onChange={(e) => setType(parseLocationType(e.target.value))}
              className={cx(
                'rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2',
                'text-[13px] font-bold text-textPrimary outline-none',
              )}
              disabled={busy}
            >
              <option value="SALON">Salon</option>
              <option value="SUITE">Suite</option>
              <option value="MOBILE_BASE">Mobile base</option>
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
              disabled={busy}
            />
          </label>

          <label className="flex items-center gap-2 text-[13px] font-semibold text-textPrimary/85">
            <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} disabled={busy} />
            Make primary
            <span className="text-[12px] font-semibold text-textSecondary">
              (what clients see first)
            </span>
          </label>

          {showPlacePicker ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-bgPrimary/20 p-3">
              <div className="text-[13px] text-textSecondary">
                Search and pick an address. Then confirm to add it.
              </div>

              <PlacesAutocomplete
                disabled={!canInteract}
                onPickPlace={(raw: unknown) => {
                  const parsed = parsePickedPlace(raw)
                  if (!parsed || !parsed.placeId) {
                    setError('Please pick an address from the list.')
                    showToast({ tone: 'error', title: 'Pick a valid address' })
                    return
                  }
                  setError(null)
                  setPickedPlace(parsed)
                  showToast({ tone: 'success', title: 'Address selected', body: parsed.formattedAddress ?? 'Ready to add.' }, 1600)
                }}
              />

              {pickedPlace ? (
                <div className="rounded-2xl border border-white/10 bg-bgSecondary/50 p-3">
                  <div className="text-[11px] font-black text-textSecondary">Selected</div>
                  <div className="mt-1 text-[13px] font-black text-textPrimary">
                    {pickedPlace.formattedAddress || '—'}
                  </div>
                  <div className="mt-1 text-[12px] text-textSecondary">
                    {pickedPlace.city ? `${pickedPlace.city}${pickedPlace.state ? `, ${pickedPlace.state}` : ''}` : null}
                    {pickedPlace.postalCode ? ` • ${pickedPlace.postalCode}` : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPickedPlace(null)}
                      disabled={busy}
                      className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
                    >
                      Clear
                    </button>

                    <button
                      type="button"
                      onClick={() => void createFromPickedPlace()}
                      disabled={busy}
                      className="rounded-full border border-accentPrimary/45 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
                    >
                      {busy ? 'Adding…' : 'Add location'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-textSecondary">
                  Tip: picking the address improves map accuracy and discovery ranking.
                </div>
              )}
            </div>
          ) : null}

          {showMobileForm ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-bgPrimary/20 p-3">
              <div className="text-[13px] text-textSecondary">
                Set your home ZIP and travel radius. This powers mobile discovery.
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
                    disabled={busy}
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
                    disabled={busy}
                  >
                    {radiusOptions.map((km) => (
                      <option key={km} value={km}>
                        {km} km (~{kmToMiles(km)} mi)
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                disabled={!canInteract}
                onClick={() => void createMobileBase()}
                className="mt-1 rounded-full border border-accentPrimary/45 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
              >
                {busy ? 'Saving…' : 'Save mobile base'}
              </button>
            </div>
          ) : null}

          {error ? <div className="text-[13px] font-semibold text-toneDanger">{error}</div> : null}
        </div>
      </div>

      {/* List */}
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="mb-3 text-[13px] font-black text-textPrimary">Your locations</div>

        {locations.length === 0 ? (
          <div className="text-[13px] text-textSecondary">No locations yet.</div>
        ) : (
          <div className="grid gap-2">
            {locations.map((l) => {
              const mapsHref = mapsHrefFromLocation({
                placeId: l.placeId,
                lat: l.lat,
                lng: l.lng,
                formattedAddress: l.formattedAddress,
                name: l.name ?? undefined,
              })
              const dirHref = directionsHrefFromLocation({
                placeId: l.placeId,
                lat: l.lat,
                lng: l.lng,
                formattedAddress: l.formattedAddress,
                name: l.name ?? undefined,
              })

              return (
                <div key={l.id} className="rounded-card border border-white/10 bg-bgPrimary/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-[13px] font-black text-textPrimary">{formatLocationTitle(l)}</div>

                        {l.isPrimary ? (
                          <span className="rounded-full border border-accentPrimary/35 bg-accentPrimary/10 px-2 py-1 text-[11px] font-black text-textPrimary">
                            PRIMARY
                          </span>
                        ) : null}

                        <span className="text-[11px] font-bold text-textSecondary">{l.type}</span>
                        {!l.isBookable ? (
                          <span className="rounded-full border border-toneWarn/30 bg-bgPrimary/25 px-2 py-1 text-[11px] font-black text-toneWarn">
                            Not bookable
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-[13px] font-semibold text-textPrimary/85">{formatLocationAddress(l)}</div>

                      <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                        TZ: {l.timeZone || '—'} • Lat/Lng: {l.lat ?? '—'},{l.lng ?? '—'}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {mapsHref ? (
                        <a
                          href={mapsHref}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
                        >
                          Maps
                        </a>
                      ) : null}

                      {dirHref ? (
                        <a
                          href={dirHref}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
                        >
                          Directions
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!l.isPrimary ? (
                      <button
                        type="button"
                        onClick={() => void setPrimaryLocation(l.id)}
                        disabled={busy}
                        className="rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
                      >
                        {busyId === l.id ? 'Setting…' : 'Set primary'}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ open: true, id: l.id })}
                      disabled={busy}
                      className="rounded-full border border-toneDanger/30 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-toneDanger hover:border-toneDanger/55 disabled:opacity-60"
                    >
                      {busyId === l.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="text-[12px] font-semibold text-textSecondary">
        Pro tip: keep your <span className="font-extrabold text-textPrimary">primary</span> location accurate — it affects discovery and default booking context.
      </div>
    </div>
  )
}