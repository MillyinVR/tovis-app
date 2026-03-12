// app/pro/bookings/new/NewBookingForm.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { moneyToString } from '@/lib/money'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { safeJson, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import type {
  ProBookingNewClientDTO,
  ProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'

type ServiceLocationType = 'SALON' | 'MOBILE'
type ProfessionalLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE'
type CancelMode = 'href' | 'back'

type BookableLocationOption = {
  id: string
  label: string
  type: ProfessionalLocationType
  isBookable: boolean
  isPrimary: boolean
  timeZone: string | null
}

type ClientServiceAddressOption = {
  id: string
  label: string
  formattedAddress: string
  isDefault: boolean
}

type Props = {
  clients: ProBookingNewClientDTO[]
  offerings: ProBookingNewOfferingDTO[]
  locations: BookableLocationOption[]
  clientAddressesByClientId: Record<string, ClientServiceAddressOption[]>
  defaultClientId?: string
  defaultOfferingId?: string
  defaultLocationId?: string
  defaultLocationType?: ServiceLocationType
  defaultScheduledAt?: string
  cancelHref?: string
  cancelMode?: CancelMode
}

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro'
  return window.location.pathname + window.location.search + window.location.hash
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'
  return trimmed
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

function readBookingId(data: unknown): string | null {
  if (!isRecord(data)) return null
  const booking = data.booking
  if (!isRecord(booking)) return null
  const id = booking.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function errorFromResponse(res: Response, data: unknown) {
  const msg = readErrorMessage(data)
  if (msg) return msg
  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You do not have access to do that.'
  return `Request failed (${res.status}).`
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function defaultDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate(),
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function parseDatetimeLocal(value: string): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
} | null {
  if (!value || typeof value !== 'string') return null

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return { year, month, day, hour, minute }
}

function toUtcIsoFromDatetimeLocalInTimeZone(
  value: string,
  timeZone: string,
): string | null {
  const parts = parseDatetimeLocal(value)
  if (!parts) return null

  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const utcDate = zonedTimeToUtc({ ...parts, second: 0, timeZone: tz })

  if (Number.isNaN(utcDate.getTime())) return null
  return utcDate.toISOString()
}

function pickDisplayPrice(
  offering: ProBookingNewOfferingDTO,
  mode: ServiceLocationType,
): number {
  if (mode === 'MOBILE') {
    if (offering.mobilePriceStartingAt != null) {
      return offering.mobilePriceStartingAt
    }
    if (offering.service.minPrice != null) {
      return offering.service.minPrice
    }
    return 0
  }

  if (offering.salonPriceStartingAt != null) {
    return offering.salonPriceStartingAt
  }
  if (offering.service.minPrice != null) {
    return offering.service.minPrice
  }
  return 0
}

function pickDisplayDurationMinutes(
  offering: ProBookingNewOfferingDTO,
  mode: ServiceLocationType,
): number {
  if (mode === 'MOBILE') {
    if (offering.mobileDurationMinutes != null) {
      return offering.mobileDurationMinutes
    }
    if (offering.service.defaultDurationMinutes != null) {
      return offering.service.defaultDurationMinutes
    }
    return 0
  }

  if (offering.salonDurationMinutes != null) {
    return offering.salonDurationMinutes
  }
  if (offering.service.defaultDurationMinutes != null) {
    return offering.service.defaultDurationMinutes
  }
  return 0
}

function locationSupportsMode(
  location: BookableLocationOption,
  mode: ServiceLocationType,
): boolean {
  if (!location.isBookable) return false

  if (mode === 'MOBILE') {
    return location.type === 'MOBILE_BASE'
  }

  return location.type === 'SALON' || location.type === 'SUITE'
}

function offeringSupportsMode(
  offering: ProBookingNewOfferingDTO,
  mode: ServiceLocationType,
): boolean {
  return mode === 'MOBILE'
    ? Boolean(offering.offersMobile)
    : Boolean(offering.offersInSalon)
}

function normalizeDefaultLocationType(
  value: ServiceLocationType | undefined,
): ServiceLocationType {
  return value === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function formatClientLabel(client: ProBookingNewClientDTO) {
  const name =
    `${client.firstName} ${client.lastName}`.trim() || 'Unnamed client'
  const email = client.user?.email ? ` • ${client.user.email}` : ''
  const phone = client.phone ? ` • ${client.phone}` : ''
  return `${name}${email}${phone}`
}

function formatOfferingLabel(
  offering: ProBookingNewOfferingDTO,
  mode: ServiceLocationType,
) {
  const category = offering.service.category?.name
  const base = offering.title || offering.service.name
  const price = moneyToString(pickDisplayPrice(offering, mode))
  const durationMinutes = pickDisplayDurationMinutes(offering, mode)

  return `${category ? `${category} • ` : ''}${base} • $${price} • ${durationMinutes} min`
}

export default function NewBookingForm({
  clients,
  offerings,
  locations,
  clientAddressesByClientId,
  defaultClientId,
  defaultOfferingId,
  defaultLocationId,
  defaultLocationType,
  defaultScheduledAt,
  cancelHref = '/pro/bookings',
  cancelMode = 'href',
}: Props) {
  const router = useRouter()

  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [offeringId, setOfferingId] = useState(defaultOfferingId ?? '')
  const [locationType, setLocationType] = useState<ServiceLocationType>(
    normalizeDefaultLocationType(defaultLocationType),
  )
  const [locationId, setLocationId] = useState(defaultLocationId ?? '')
  const [clientAddressId, setClientAddressId] = useState('')
  const [scheduledAt, setScheduledAt] = useState(
    defaultScheduledAt ?? defaultDatetimeLocal(),
  )
  const [internalNotes, setInternalNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clientOptions = useMemo(() => clients ?? [], [clients])
  const offeringOptions = useMemo(() => offerings ?? [], [offerings])

  const selectedOffering = useMemo(
    () => offeringOptions.find((offering) => offering.id === offeringId) ?? null,
    [offeringOptions, offeringId],
  )

  const allowedModes = useMemo(
    () => ({
      salon: Boolean(selectedOffering?.offersInSalon),
      mobile: Boolean(selectedOffering?.offersMobile),
    }),
    [selectedOffering],
  )

  useEffect(() => {
    if (!selectedOffering) return

    if (locationType === 'SALON' && allowedModes.salon) return
    if (locationType === 'MOBILE' && allowedModes.mobile) return

    if (allowedModes.salon) {
      setLocationType('SALON')
      return
    }

    if (allowedModes.mobile) {
      setLocationType('MOBILE')
    }
  }, [selectedOffering, allowedModes, locationType])

  const visibleOfferings = useMemo(
    () =>
      offeringOptions.filter((offering) =>
        offeringSupportsMode(offering, locationType),
      ),
    [offeringOptions, locationType],
  )

  useEffect(() => {
    if (!offeringId) return
    if (visibleOfferings.some((offering) => offering.id === offeringId)) {
      return
    }
    setOfferingId('')
  }, [visibleOfferings, offeringId])

  const availableLocations = useMemo(
    () =>
      locations.filter((location) =>
        locationSupportsMode(location, locationType),
      ),
    [locations, locationType],
  )

  useEffect(() => {
    if (!availableLocations.length) {
      setLocationId('')
      return
    }

    setLocationId((current) => {
      if (
        current &&
        availableLocations.some((location) => location.id === current)
      ) {
        return current
      }

      return (
        availableLocations.find((location) => location.isPrimary)?.id ??
        availableLocations[0]?.id ??
        ''
      )
    })
  }, [availableLocations])

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === locationId) ?? null,
    [locations, locationId],
  )

  const bookingTimeZone: string = useMemo(() => {
    const tz = selectedLocation?.timeZone
    return typeof tz === 'string' && isValidIanaTimeZone(tz) ? tz : 'UTC'
  }, [selectedLocation])

  const selectedClientAddresses = useMemo(() => {
    if (!clientId) return []
    return clientAddressesByClientId[clientId] ?? []
  }, [clientId, clientAddressesByClientId])

  useEffect(() => {
    if (locationType !== 'MOBILE') {
      setClientAddressId('')
      return
    }

    if (!selectedClientAddresses.length) {
      setClientAddressId('')
      return
    }

    setClientAddressId((current) => {
      if (
        current &&
        selectedClientAddresses.some((address) => address.id === current)
      ) {
        return current
      }

      return (
        selectedClientAddresses.find((address) => address.isDefault)?.id ??
        selectedClientAddresses[0]?.id ??
        ''
      )
    })
  }, [locationType, selectedClientAddresses])

  function handleCancel() {
    if (loading) return

    if (cancelMode === 'back') {
      router.back()
      return
    }

    router.push(cancelHref)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (loading) return

    if (!clientId) {
      setError('Client is required.')
      return
    }

    if (!selectedOffering) {
      setError('Service is required.')
      return
    }

    if (!scheduledAt) {
      setError('Date and time are required.')
      return
    }

    if (!locationId) {
      setError('Select a bookable location.')
      return
    }

    if (locationType === 'MOBILE' && !clientAddressId) {
      setError('Mobile bookings require a saved client service address.')
      return
    }

    if (!offeringSupportsMode(selectedOffering, locationType)) {
      setError('Selected service does not support this booking mode.')
      return
    }

    if (!selectedLocation) {
      setError('Select a valid location.')
      return
    }

    if (!locationSupportsMode(selectedLocation, locationType)) {
      setError('Selected location does not support this booking mode.')
      return
    }

    const scheduledForISO = toUtcIsoFromDatetimeLocalInTimeZone(
      scheduledAt,
      bookingTimeZone,
    )

    if (!scheduledForISO) {
      setError('Please choose a valid date and time.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/pro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          offeringId: selectedOffering.id,
          locationType,
          locationId,
          clientAddressId: locationType === 'MOBILE' ? clientAddressId : null,
          scheduledFor: scheduledForISO,
          internalNotes: internalNotes.trim() || null,
        }),
      })

      if (res.status === 401) {
        redirectToLogin(router, 'new-booking')
        return
      }

      const data = await safeJson(res)

      if (!res.ok) {
        setError(errorFromResponse(res, data))
        return
      }

      const nextBookingId = readBookingId(data)

      if (nextBookingId) {
        router.push(`/pro/bookings/${encodeURIComponent(nextBookingId)}`)
      } else {
        router.push('/pro/bookings')
      }

      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error creating booking.')
    } finally {
      setLoading(false)
    }
  }

  const field =
    'w-full rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary/70 focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60'
  const label = 'text-[12px] font-black text-textPrimary'
  const helper = 'mt-2 text-[12px] text-textSecondary'

  const tzLabel = sanitizeTimeZone(bookingTimeZone, 'UTC')
  const mobileUnavailableBecauseNoAddress =
    locationType === 'MOBILE' && clientId && selectedClientAddresses.length === 0

  return (
    <form
      onSubmit={handleSubmit}
      className="tovis-glass grid gap-4 rounded-card border border-white/10 bg-bgSecondary p-4"
    >
      <div className="grid gap-2">
        <label htmlFor="client" className={label}>
          Client <span className="text-textSecondary">*</span>
        </label>

        <select
          id="client"
          value={clientId}
          disabled={loading}
          onChange={(e) => setClientId(e.target.value)}
          className={field}
        >
          <option value="">Select client</option>
          {clientOptions.map((client) => (
            <option key={client.id} value={client.id}>
              {formatClientLabel(client)}
            </option>
          ))}
        </select>

        {defaultClientId ? (
          <div className={helper}>
            Client preselected. You can change it if needed.
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className={label}>
          Booking mode <span className="text-textSecondary">*</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => setLocationType('SALON')}
            className={[
              'rounded-card border px-4 py-3 text-left transition',
              locationType === 'SALON'
                ? 'border-accentPrimary/60 bg-accentPrimary/10'
                : 'border-white/10 bg-bgPrimary hover:border-white/20',
              loading ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            <div className="text-[13px] font-black text-textPrimary">Salon</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Book at the pro’s salon or suite location.
            </div>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => setLocationType('MOBILE')}
            className={[
              'rounded-card border px-4 py-3 text-left transition',
              locationType === 'MOBILE'
                ? 'border-accentPrimary/60 bg-accentPrimary/10'
                : 'border-white/10 bg-bgPrimary hover:border-white/20',
              loading ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            <div className="text-[13px] font-black text-textPrimary">Mobile</div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Book at the client’s saved service address.
            </div>
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <label htmlFor="offering" className={label}>
          Service <span className="text-textSecondary">*</span>
        </label>

        <select
          id="offering"
          value={offeringId}
          disabled={loading}
          onChange={(e) => setOfferingId(e.target.value)}
          className={field}
        >
          <option value="">
            {visibleOfferings.length
              ? 'Select service'
              : 'No services for this mode'}
          </option>
          {visibleOfferings.map((offering) => (
            <option key={offering.id} value={offering.id}>
              {formatOfferingLabel(offering, locationType)}
            </option>
          ))}
        </select>

        {!visibleOfferings.length ? (
          <div className="mt-2 text-[12px] font-black text-toneDanger">
            No active offerings are available for this booking mode.
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <label htmlFor="location" className={label}>
          Pro location <span className="text-textSecondary">*</span>
        </label>

        <select
          id="location"
          value={locationId}
          disabled={loading || availableLocations.length === 0}
          onChange={(e) => setLocationId(e.target.value)}
          className={field}
        >
          <option value="">
            {availableLocations.length
              ? 'Select location'
              : 'No matching locations'}
          </option>
          {availableLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>

        {!availableLocations.length ? (
          <div className="mt-2 text-[12px] font-black text-toneDanger">
            No bookable {locationType === 'MOBILE' ? 'mobile' : 'salon'} location
            is available.
          </div>
        ) : null}
      </div>

      {locationType === 'MOBILE' ? (
        <div className="grid gap-2">
          <label htmlFor="clientAddress" className={label}>
            Client mobile address <span className="text-textSecondary">*</span>
          </label>

          <select
            id="clientAddress"
            value={clientAddressId}
            disabled={loading || !clientId || selectedClientAddresses.length === 0}
            onChange={(e) => setClientAddressId(e.target.value)}
            className={field}
          >
            <option value="">
              {!clientId
                ? 'Select client first'
                : selectedClientAddresses.length
                  ? 'Select client address'
                  : 'No saved mobile address'}
            </option>

            {selectedClientAddresses.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label} • {address.formattedAddress}
              </option>
            ))}
          </select>

          {mobileUnavailableBecauseNoAddress ? (
            <div className="mt-2 text-[12px] font-black text-toneDanger">
              This client does not have a saved service address, so a mobile
              booking cannot be created yet.
            </div>
          ) : (
            <div className={helper}>
              Mobile bookings must use a saved client service address.
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-2">
        <label htmlFor="datetime" className={label}>
          Date &amp; time <span className="text-textSecondary">*</span>
        </label>

        <input
          id="datetime"
          type="datetime-local"
          value={scheduledAt}
          disabled={loading}
          onChange={(e) => setScheduledAt(e.target.value)}
          className={field}
        />

        <div className={helper}>
          Interpreted in <span className="font-black">{tzLabel}</span> based on
          the selected booking location, then stored as UTC.
        </div>
      </div>

      <div className="grid gap-2">
        <label htmlFor="notes" className={label}>
          Internal notes
        </label>

        <textarea
          id="notes"
          value={internalNotes}
          disabled={loading}
          onChange={(e) => setInternalNotes(e.target.value)}
          rows={3}
          placeholder="Optional internal notes for this booking"
          className={`${field} min-h-[96px] resize-y`}
        />
      </div>

      {error ? (
        <div className="rounded-card border border-toneDanger/20 bg-toneDanger/10 px-3 py-2 text-[12px] font-black text-toneDanger">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={loading}
          className="rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20 disabled:opacity-60"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={
            loading ||
            !clientId ||
            !selectedOffering ||
            !locationId ||
            (locationType === 'MOBILE' && !clientAddressId)
          }
          className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {loading ? 'Creating…' : 'Create booking'}
        </button>
      </div>
    </form>
  )
}