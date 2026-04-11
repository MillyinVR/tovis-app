'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { safeJson, readErrorMessage } from '@/lib/http'
import type {
  ProBookingNewClientDTO,
  ProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'
import { isRecord } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import {
  isValidIanaTimeZone,
  sanitizeTimeZone,
  zonedTimeToUtc,
} from '@/lib/timeZone'

type ServiceLocationType = 'SALON' | 'MOBILE'
type ProfessionalLocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE'
type CancelMode = 'href' | 'back'
type ClientMode = 'existing' | 'new'
type AddressMode = 'existing' | 'new'

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

type ClientSearchResult = {
  id: string
  fullName: string
  canViewClient: boolean
  email: string | null
  phone: string | null
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

type NewClientFormState = {
  firstName: string
  lastName: string
  email: string
  phone: string
}

type ServiceAddressFormState = {
  label: string
  formattedAddress: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  countryCode: string
  isDefault: boolean
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

function formatClientSearchLabel(client: ClientSearchResult) {
  const email = client.email ? ` • ${client.email}` : ''
  const phone = client.phone ? ` • ${client.phone}` : ''
  return `${client.fullName}${email}${phone}`
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

function normalizeOptionalInput(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isNewClientComplete(client: NewClientFormState) {
  return Boolean(
    normalizeOptionalInput(client.firstName) &&
      normalizeOptionalInput(client.lastName) &&
      normalizeOptionalInput(client.email),
  )
}

function isServiceAddressComplete(address: ServiceAddressFormState) {
  const hasAddressLine = Boolean(
    normalizeOptionalInput(address.formattedAddress) ||
      normalizeOptionalInput(address.addressLine1),
  )
  const hasArea =
    Boolean(normalizeOptionalInput(address.postalCode)) ||
    Boolean(
      normalizeOptionalInput(address.city) &&
        normalizeOptionalInput(address.state),
    )

  return hasAddressLine && hasArea
}

function normalizeSearchClients(data: unknown): ClientSearchResult[] {
  if (!isRecord(data)) return []

  const groups = ['recentClients', 'otherClients'] as const
  const seen = new Set<string>()
  const out: ClientSearchResult[] = []

  for (const key of groups) {
    const value = data[key]
    if (!Array.isArray(value)) continue

    for (const item of value) {
      if (!isRecord(item)) continue

      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id || seen.has(id)) continue

      const fullName =
        typeof item.fullName === 'string' && item.fullName.trim()
          ? item.fullName.trim()
          : 'Client'

      const email =
        typeof item.email === 'string' && item.email.trim()
          ? item.email.trim()
          : null

      const phone =
        typeof item.phone === 'string' && item.phone.trim()
          ? item.phone.trim()
          : null

      const canViewClient = item.canViewClient !== false

      seen.add(id)
      out.push({
        id,
        fullName,
        canViewClient,
        email,
        phone,
      })
    }
  }

  return out
}

function normalizeServiceAddresses(data: unknown): ClientServiceAddressOption[] {
  if (!isRecord(data)) return []

  const raw = data.addresses
  if (!Array.isArray(raw)) return []

  const out: ClientServiceAddressOption[] = []

  for (const item of raw) {
    if (!isRecord(item)) continue

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) continue

    const label =
      typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : 'Service address'

    const formattedAddress =
      typeof item.formattedAddress === 'string' && item.formattedAddress.trim()
        ? item.formattedAddress.trim()
        : ''

    if (!formattedAddress) continue

    out.push({
      id,
      label,
      formattedAddress,
      isDefault: Boolean(item.isDefault),
    })
  }

  return out
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

  const [clientMode, setClientMode] = useState<ClientMode>(
    defaultClientId ? 'existing' : 'new',
  )
  const [clientSearch, setClientSearch] = useState('')
  const [clientSearchLoading, setClientSearchLoading] = useState(false)
  const [clientSearchResults, setClientSearchResults] = useState<
    ClientSearchResult[]
  >([])
  const [clientId, setClientId] = useState(defaultClientId ?? '')
  const [newClient, setNewClient] = useState<NewClientFormState>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })

  const [offeringId, setOfferingId] = useState(defaultOfferingId ?? '')
  const [locationType, setLocationType] = useState<ServiceLocationType>(
    normalizeDefaultLocationType(defaultLocationType),
  )
  const [locationId, setLocationId] = useState(defaultLocationId ?? '')
  const [addressMode, setAddressMode] = useState<AddressMode>('existing')
  const [clientAddressId, setClientAddressId] = useState('')
  const [clientAddressesLoading, setClientAddressesLoading] = useState(false)
  const [clientAddressesError, setClientAddressesError] = useState<string | null>(
    null,
  )
  const [clientAddressOptions, setClientAddressOptions] = useState<
    ClientServiceAddressOption[]
  >(() =>
    defaultClientId ? clientAddressesByClientId[defaultClientId] ?? [] : [],
  )
  const [serviceAddress, setServiceAddress] = useState<ServiceAddressFormState>({
    label: '',
    formattedAddress: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    countryCode: 'US',
    isDefault: true,
  })
  const [scheduledAt, setScheduledAt] = useState(
    defaultScheduledAt ?? defaultDatetimeLocal(),
  )
  const [internalNotes, setInternalNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const offeringOptions = useMemo(() => offerings ?? [], [offerings])

  const seedSelectedClient = useMemo(() => {
    if (!clientId) return null

    const dtoMatch = clients.find((client) => client.id === clientId)
    if (!dtoMatch) return null

    const fullName =
      `${dtoMatch.firstName} ${dtoMatch.lastName}`.trim() || 'Client'

    return {
      id: dtoMatch.id,
      fullName,
      canViewClient: true,
      email: dtoMatch.user?.email ?? null,
      phone: dtoMatch.phone ?? null,
    } satisfies ClientSearchResult
  }, [clients, clientId])

  useEffect(() => {
    if (clientMode !== 'existing') return

    const query = clientSearch.trim()
    if (!query) {
      setClientSearchResults(seedSelectedClient ? [seedSelectedClient] : [])
      setClientSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        setClientSearchLoading(true)

        const res = await fetch(
          `/api/pro/clients/search?q=${encodeURIComponent(query)}`,
          {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store',
          },
        )

        if (res.status === 401) {
          redirectToLogin(router, 'new-booking')
          return
        }

        const data = await safeJson(res)

        if (!res.ok) {
          console.error('Client search failed:', readErrorMessage(data))
          setClientSearchResults(seedSelectedClient ? [seedSelectedClient] : [])
          return
        }

        setClientSearchResults(normalizeSearchClients(data))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }

        console.error('Client search network error:', err)
        setClientSearchResults(seedSelectedClient ? [seedSelectedClient] : [])
      } finally {
        setClientSearchLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [clientMode, clientSearch, router, seedSelectedClient])

  useEffect(() => {
    if (clientMode !== 'existing' || !clientId) {
      setClientAddressesLoading(false)
      setClientAddressesError(null)
      setClientAddressOptions([])
      return
    }

    const seeded = clientAddressesByClientId[clientId] ?? []
    setClientAddressOptions(seeded)
    setClientAddressesError(null)

    const controller = new AbortController()

    void (async () => {
      try {
        setClientAddressesLoading(true)

        const res = await fetch(
          `/api/pro/clients/${encodeURIComponent(clientId)}/service-addresses`,
          {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store',
          },
        )

        if (res.status === 401) {
          redirectToLogin(router, 'new-booking')
          return
        }

        const data = await safeJson(res)

        if (!res.ok) {
          const message = readErrorMessage(data) || 'Failed to load service addresses.'
          setClientAddressesError(message)
          return
        }

        setClientAddressOptions(normalizeServiceAddresses(data))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }

        console.error('Client address load network error:', err)
        setClientAddressesError('Failed to load service addresses.')
      } finally {
        setClientAddressesLoading(false)
      }
    })()

    return () => {
      controller.abort()
    }
  }, [clientMode, clientId, clientAddressesByClientId, router])

  const existingClientOptions = useMemo(() => {
    const byId = new Map<string, ClientSearchResult>()

    if (seedSelectedClient) {
      byId.set(seedSelectedClient.id, seedSelectedClient)
    }

    for (const client of clientSearchResults) {
      if (!byId.has(client.id)) {
        byId.set(client.id, client)
      }
    }

    return Array.from(byId.values())
  }, [clientSearchResults, seedSelectedClient])

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
    if (clientMode !== 'existing' || !clientId) return []
    return clientAddressOptions
  }, [clientMode, clientId, clientAddressOptions])

  const canUseSavedAddresses =
    clientMode === 'existing' && !!clientId && selectedClientAddresses.length > 0

  useEffect(() => {
    if (locationType !== 'MOBILE') {
      setClientAddressId('')
      return
    }

    if (clientMode !== 'existing' || !clientId) {
      setAddressMode('new')
      setClientAddressId('')
      return
    }

    if (!selectedClientAddresses.length) {
      setAddressMode('new')
      setClientAddressId('')
      return
    }

    if (addressMode === 'existing') {
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
    }
  }, [
    locationType,
    clientMode,
    clientId,
    selectedClientAddresses,
    addressMode,
  ])

  function handleCancel() {
    if (loading) return

    if (cancelMode === 'back') {
      router.back()
      return
    }

    router.push(cancelHref)
  }

  const newClientReady = isNewClientComplete(newClient)
  const newServiceAddressReady = isServiceAddressComplete(serviceAddress)

  const submitDisabled =
    loading ||
    !selectedOffering ||
    !locationId ||
    !scheduledAt ||
    (clientMode === 'existing' ? !clientId : !newClientReady) ||
    (locationType === 'MOBILE'
      ? addressMode === 'existing'
        ? !clientAddressId || clientAddressesLoading
        : !newServiceAddressReady
      : false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (loading) return

    if (clientMode === 'existing' && !clientId) {
      setError('Select an existing client or switch to new client.')
      return
    }

    if (clientMode === 'new' && !newClientReady) {
      setError('First name, last name, and email are required for a new client.')
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

    if (locationType === 'MOBILE') {
      if (addressMode === 'existing' && !clientAddressId) {
        setError('Select a saved client service address.')
        return
      }

      if (addressMode === 'new' && !newServiceAddressReady) {
        setError(
          'Enter a service address with an address line and either postal code or city and state.',
        )
        return
      }
    }

    const scheduledForISO = toUtcIsoFromDatetimeLocalInTimeZone(
      scheduledAt,
      bookingTimeZone,
    )

    if (!scheduledForISO) {
      setError('Please choose a valid date and time.')
      return
    }

    const clientPayload =
      clientMode === 'new'
        ? {
            firstName: normalizeOptionalInput(newClient.firstName),
            lastName: normalizeOptionalInput(newClient.lastName),
            email: normalizeOptionalInput(newClient.email),
            phone: normalizeOptionalInput(newClient.phone),
          }
        : null

    const serviceAddressPayload =
      locationType === 'MOBILE' && addressMode === 'new'
        ? {
            label: normalizeOptionalInput(serviceAddress.label),
            formattedAddress: normalizeOptionalInput(
              serviceAddress.formattedAddress,
            ),
            addressLine1: normalizeOptionalInput(serviceAddress.addressLine1),
            addressLine2: normalizeOptionalInput(serviceAddress.addressLine2),
            city: normalizeOptionalInput(serviceAddress.city),
            state: normalizeOptionalInput(serviceAddress.state),
            postalCode: normalizeOptionalInput(serviceAddress.postalCode),
            countryCode:
              normalizeOptionalInput(serviceAddress.countryCode) ?? 'US',
            isDefault: serviceAddress.isDefault,
          }
        : null

    setLoading(true)

    try {
      const res = await fetch('/api/pro/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientMode === 'existing' ? clientId : null,
          client: clientPayload,
          offeringId: selectedOffering.id,
          locationType,
          locationId,
          clientAddressId:
            locationType === 'MOBILE' && addressMode === 'existing'
              ? clientAddressId
              : null,
          serviceAddress: serviceAddressPayload,
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

  return (
    <form
      onSubmit={handleSubmit}
      className="tovis-glass grid gap-4 rounded-card border border-white/10 bg-bgSecondary p-4"
    >
      <div className="grid gap-2">
        <div className={label}>
          Client <span className="text-textSecondary">*</span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => setClientMode('existing')}
            className={[
              'rounded-card border px-4 py-3 text-left transition',
              clientMode === 'existing'
                ? 'border-accentPrimary/60 bg-accentPrimary/10'
                : 'border-white/10 bg-bgPrimary hover:border-white/20',
              loading ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            <div className="text-[13px] font-black text-textPrimary">
              Existing client
            </div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Search only clients this pro is allowed to see.
            </div>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => setClientMode('new')}
            className={[
              'rounded-card border px-4 py-3 text-left transition',
              clientMode === 'new'
                ? 'border-accentPrimary/60 bg-accentPrimary/10'
                : 'border-white/10 bg-bgPrimary hover:border-white/20',
              loading ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            <div className="text-[13px] font-black text-textPrimary">
              New client
            </div>
            <div className="mt-1 text-[12px] text-textSecondary">
              Create the client during booking and send an invite automatically.
            </div>
          </button>
        </div>
      </div>

      {clientMode === 'existing' ? (
        <div className="grid gap-2">
          <label htmlFor="clientSearch" className={label}>
            Search clients
          </label>

          <input
            id="clientSearch"
            value={clientSearch}
            disabled={loading}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Search by name, email, or phone"
            className={field}
          />

          <label htmlFor="client" className={label}>
            Select client <span className="text-textSecondary">*</span>
          </label>

          <select
            id="client"
            value={clientId}
            disabled={loading || existingClientOptions.length === 0}
            onChange={(e) => setClientId(e.target.value)}
            className={field}
          >
            <option value="">
              {clientSearch.trim()
                ? clientSearchLoading
                  ? 'Searching clients...'
                  : existingClientOptions.length
                    ? 'Select client'
                    : 'No matching visible clients'
                : clientId
                  ? 'Selected client'
                  : 'Type to search clients'}
            </option>

            {existingClientOptions.map((client) => (
              <option key={client.id} value={client.id}>
                {formatClientSearchLabel(client)}
              </option>
            ))}
          </select>

          <div className={helper}>
            Search results come from the pro-scoped client search API.
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label htmlFor="newClientFirstName" className={label}>
              First name <span className="text-textSecondary">*</span>
            </label>
            <input
              id="newClientFirstName"
              value={newClient.firstName}
              disabled={loading}
              onChange={(e) =>
                setNewClient((current) => ({
                  ...current,
                  firstName: e.target.value,
                }))
              }
              className={field}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="newClientLastName" className={label}>
              Last name <span className="text-textSecondary">*</span>
            </label>
            <input
              id="newClientLastName"
              value={newClient.lastName}
              disabled={loading}
              onChange={(e) =>
                setNewClient((current) => ({
                  ...current,
                  lastName: e.target.value,
                }))
              }
              className={field}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="newClientEmail" className={label}>
              Email <span className="text-textSecondary">*</span>
            </label>
            <input
              id="newClientEmail"
              type="email"
              value={newClient.email}
              disabled={loading}
              onChange={(e) =>
                setNewClient((current) => ({
                  ...current,
                  email: e.target.value,
                }))
              }
              className={field}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="newClientPhone" className={label}>
              Phone
            </label>
            <input
              id="newClientPhone"
              type="tel"
              value={newClient.phone}
              disabled={loading}
              onChange={(e) =>
                setNewClient((current) => ({
                  ...current,
                  phone: e.target.value,
                }))
              }
              className={field}
            />
          </div>

          <div className="sm:col-span-2">
            <div className={helper}>
              A client account will be created or matched by email, and an invite can be sent from the booking flow.
            </div>
          </div>
        </div>
      )}

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
              Book at a saved client address or enter a new service address.
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
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className={label}>
              Service address <span className="text-textSecondary">*</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={loading || !canUseSavedAddresses}
                onClick={() => setAddressMode('existing')}
                className={[
                  'rounded-card border px-4 py-3 text-left transition',
                  addressMode === 'existing'
                    ? 'border-accentPrimary/60 bg-accentPrimary/10'
                    : 'border-white/10 bg-bgPrimary hover:border-white/20',
                  loading || !canUseSavedAddresses
                    ? 'cursor-not-allowed opacity-50'
                    : '',
                ].join(' ')}
              >
                <div className="text-[13px] font-black text-textPrimary">
                  Saved address
                </div>
                <div className="mt-1 text-[12px] text-textSecondary">
                  Use an existing client service address.
                </div>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => setAddressMode('new')}
                className={[
                  'rounded-card border px-4 py-3 text-left transition',
                  addressMode === 'new'
                    ? 'border-accentPrimary/60 bg-accentPrimary/10'
                    : 'border-white/10 bg-bgPrimary hover:border-white/20',
                  loading ? 'cursor-not-allowed opacity-50' : '',
                ].join(' ')}
              >
                <div className="text-[13px] font-black text-textPrimary">
                  New service address
                </div>
                <div className="mt-1 text-[12px] text-textSecondary">
                  Enter the address inline for this mobile booking.
                </div>
              </button>
            </div>
          </div>

          {addressMode === 'existing' ? (
            <div className="grid gap-2">
              <label htmlFor="clientAddress" className={label}>
                Saved client address <span className="text-textSecondary">*</span>
              </label>

              <select
                id="clientAddress"
                value={clientAddressId}
                disabled={loading || clientAddressesLoading || !canUseSavedAddresses}
                onChange={(e) => setClientAddressId(e.target.value)}
                className={field}
              >
                <option value="">
                  {!clientId && clientMode === 'existing'
                    ? 'Select client first'
                    : clientAddressesLoading
                      ? 'Loading service addresses...'
                      : canUseSavedAddresses
                        ? 'Select client address'
                        : 'No saved client address available'}
                </option>

                {selectedClientAddresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label} • {address.formattedAddress}
                  </option>
                ))}
              </select>

              {clientAddressesError ? (
                <div className="mt-2 text-[12px] font-black text-toneDanger">
                  {clientAddressesError}
                </div>
              ) : !canUseSavedAddresses ? (
                <div className="mt-2 text-[12px] font-black text-toneDanger">
                  No saved service address is available for this selection. Use
                  “New service address” instead.
                </div>
              ) : (
                <div className={helper}>
                  Choose one of the client’s saved mobile addresses.
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="serviceAddressLabel" className={label}>
                  Address label
                </label>
                <input
                  id="serviceAddressLabel"
                  value={serviceAddress.label}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      label: e.target.value,
                    }))
                  }
                  placeholder="Home, Office, Hotel, etc."
                  className={field}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="serviceAddressFormatted" className={label}>
                  Full address
                </label>
                <input
                  id="serviceAddressFormatted"
                  value={serviceAddress.formattedAddress}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      formattedAddress: e.target.value,
                    }))
                  }
                  placeholder="123 Main St, City, ST 12345"
                  className={field}
                />
              </div>

              <div className="grid gap-2 sm:col-span-2">
                <label htmlFor="serviceAddressLine1" className={label}>
                  Address line 1 <span className="text-textSecondary">*</span>
                </label>
                <input
                  id="serviceAddressLine1"
                  value={serviceAddress.addressLine1}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      addressLine1: e.target.value,
                    }))
                  }
                  placeholder="Street address"
                  className={field}
                />
              </div>

              <div className="grid gap-2 sm:col-span-2">
                <label htmlFor="serviceAddressLine2" className={label}>
                  Address line 2
                </label>
                <input
                  id="serviceAddressLine2"
                  value={serviceAddress.addressLine2}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      addressLine2: e.target.value,
                    }))
                  }
                  placeholder="Apt, suite, unit, gate code, etc."
                  className={field}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="serviceAddressCity" className={label}>
                  City
                </label>
                <input
                  id="serviceAddressCity"
                  value={serviceAddress.city}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      city: e.target.value,
                    }))
                  }
                  className={field}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="serviceAddressState" className={label}>
                  State
                </label>
                <input
                  id="serviceAddressState"
                  value={serviceAddress.state}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      state: e.target.value,
                    }))
                  }
                  className={field}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="serviceAddressPostalCode" className={label}>
                  Postal code
                </label>
                <input
                  id="serviceAddressPostalCode"
                  value={serviceAddress.postalCode}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      postalCode: e.target.value,
                    }))
                  }
                  className={field}
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="serviceAddressCountryCode" className={label}>
                  Country code
                </label>
                <input
                  id="serviceAddressCountryCode"
                  value={serviceAddress.countryCode}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      countryCode: e.target.value,
                    }))
                  }
                  placeholder="US"
                  className={field}
                />
              </div>

              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={serviceAddress.isDefault}
                  disabled={loading}
                  onChange={(e) =>
                    setServiceAddress((current) => ({
                      ...current,
                      isDefault: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-white/10 bg-bgPrimary"
                />
                <span className="text-[12px] text-textSecondary">
                  Save as the default mobile service address for this client
                </span>
              </label>

              <div className="sm:col-span-2">
                <div className={helper}>
                  Enter an address line plus either postal code or city and state.
                </div>
              </div>
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
          disabled={submitDisabled}
          className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:opacity-60"
        >
          {loading ? 'Creating…' : 'Create booking'}
        </button>
      </div>
    </form>
  )
}