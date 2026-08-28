// app/pro/bookings/new/NewBookingForm.tsx 

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { errorFromResponse, readErrorMessage, safeJson } from '@/lib/http'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import {
  mergeBookingOverrideFlags,
  readBookingOverridePrompt,
  type BookingOverrideFlag,
  type BookingOverridePrompt,
} from '@/lib/booking/overridePrompts'
import {
  CONFIRM_HOLD_OVERLAP_FIELD,
  readHoldOverlapDecision,
  type HeldSlotDecision,
} from '@/lib/booking/holdOverlapPrompt'
import { HoldOverlapDecisionDialog } from '@/app/pro/_components/HoldOverlapDecisionDialog'
import type {
  ProBookingNewClientDTO,
  ProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'
import type { OfferingAddOnItemDTO } from '@/lib/dto/offeringAddOns'
import { isRecord } from '@/lib/guards'
import { loginHrefFromHere } from '@/lib/clientNavigation'
import { pad2 } from '@/lib/format/pad2'
import {
  makePlacesSessionToken,
  parsePlaceDetails,
  parsePlacePredictions,
  type PlacePrediction,
} from '@/lib/clientAddresses/placesAutocomplete'
import { moneyToString } from '@/lib/money'
import type {
  DepositType,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'
import {
  STRIPE_MIN_CHARGE_CENTS,
} from '@/lib/booking/discoveryDepositPlan'
import { computeUpfrontDepositCents } from '@/lib/booking/prepay'
import {
  OVERLAP_CONFLICT_FETCH_WINDOW_MS,
  OVERLAP_FALLBACK_NAME,
  OVERLAP_HOLD_NAME,
} from '@/lib/calendar/constants'
import {
  formatOverlapNames,
  normalizeCalendarOverlapEvents,
  overlappingClientNamesForRange,
} from '@/lib/calendar/overlap'
import { isValidIanaTimeZone, sanitizeTimeZone } from '@/lib/timeZone'
import {
  datetimeLocalToUtcIsoStrict,
  formatInTimeZone,
  formatSlotFullLabel,
  WALL_TIME_ERROR_MESSAGE,
} from '@/lib/time'

import OpenSlotPicker from './OpenSlotPicker'
import BookingOverridePromptCard from '@/app/pro/_components/BookingOverridePromptCard'
import { controlClassName } from '@/app/_components/ui'

const STATUS_COPY = {
  401: 'Please log in to continue.',
  403: 'You do not have access to do that.',
}

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

// K10-B: everything the deposit step needs to size the amount and preview the
// concrete auto-release datetime. Server-computed (env knobs live server-side);
// the write boundary recomputes the amount authoritatively on submit.
export type ProBookingDepositConfig = {
  stripeReady: boolean
  depositEnabled: boolean
  depositType: DepositType | null
  depositFlatAmountCents: number | null
  depositPercent: number | null
  /** Hours before the appointment the unpaid hold releases. */
  releaseLeadHours: number
  /** Minimum hours after creation the client always gets to pay. */
  releaseFloorHours: number
}

type Props = {
  professionalId: string
  clients: ProBookingNewClientDTO[]
  offerings: ProBookingNewOfferingDTO[]
  locations: BookableLocationOption[]
  clientAddressesByClientId: Record<string, ClientServiceAddressOption[]>
  depositConfig: ProBookingDepositConfig
  defaultClientId?: string
  defaultOfferingId?: string
  defaultLocationId?: string
  defaultLocationType?: ServiceLocationType
  defaultScheduledAt?: string
  cancelHref?: string
  cancelMode?: CancelMode
  /**
   * K19: the server's `recurringAppointmentsEnabled()`. 🔴 The kill switch has
   * to reach the CONTROL, not just the route — an unflagged "Repeats" step
   * would offer an option `POST /api/v1/pro/booking-series` answers 404 to
   * ([[kill-switch-must-reach-the-control]]). Default false so a caller that
   * forgets to pass it gets the dark behaviour, never the lit one.
   */
  recurringEnabled?: boolean
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
  placeId: string | null
  lat: number | null
  lng: number | null
  isDefault: boolean
}

// K19/K20 — what the "repeats" step offers.
//
//  - ✅ OPEN-ENDED, as of K20. K19 withheld it because a series with no end
//    simply stopped dead at the materialization horizon (K18-B) — an option
//    whose operator had not been built is an offer the app cannot keep
//    ([[verifiable-rail-still-needs-an-operator]]). K20 built the operator: the
//    roll-forward cron keeps every ACTIVE series booked ~90 days ahead, so
//    "keep going" is now a promise the app can hold. It sends
//    `occurrenceCount: null`, which the boundary has accepted since K18.
//
//  - 🔴 STILL NO per-occurrence deposit option. `depositPerOccurrence` works,
//    but every occurrence's pay link is delivered AT CREATION, so a client would
//    get a dozen "pay for your appointment" messages in one burst (K18-A).
//    Staggering them needs a scheduled deposit-REQUEST rail that still does not
//    exist — the roll-forward creates bookings, not payment requests, so K20 did
//    NOT dissolve this one. A deposit on a repeating booking is therefore the
//    FIRST occurrence's only, which is what the boundary does when
//    `depositPerOccurrence` is false.
//
// The counts stay inside the boundary's own MIN/MAX (1…104 occurrences, 1…8
// week interval); the server re-validates, so this list is the offer, not the
// rule.
const REPEAT_INTERVAL_WEEKS_OPTIONS = [1, 2, 3, 4, 6, 8] as const
const REPEAT_COUNT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12] as const
/** Select value standing for `occurrenceCount: null`. */
const REPEAT_COUNT_OPEN_ENDED = 'open'
const REPEAT_INTERVAL_DEFAULT = 4
const REPEAT_COUNT_DEFAULT = 6

function repeatIntervalLabel(weeks: number): string {
  if (weeks === 1) return 'Every week'
  return `Every ${weeks} weeks`
}

function readSeriesId(data: unknown): string | null {
  if (!isRecord(data)) return null
  const value = data.seriesId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function redirectToLogin(router: ReturnType<typeof useRouter>, reason?: string) {
  router.push(loginHrefFromHere('/pro', reason))
}

function readBookingId(data: unknown): string | null {
  if (!isRecord(data)) return null
  const booking = data.booking
  if (!isRecord(booking)) return null
  const id = booking.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

type BookingOverrideBody = {
  allowShortNotice: boolean
  allowFarFuture: boolean
  allowOutsideWorkingHours: boolean
}

function overrideBodyFromFlags(
  flags: readonly BookingOverrideFlag[],
): BookingOverrideBody {
  return {
    allowShortNotice: flags.includes('allowShortNotice'),
    allowFarFuture: flags.includes('allowFarFuture'),
    allowOutsideWorkingHours: flags.includes('allowOutsideWorkingHours'),
  }
}

function defaultDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate(),
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
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

function normalizeAddOns(data: unknown): OfferingAddOnItemDTO[] {
  if (!isRecord(data)) return []

  const raw = data.addOns
  if (!Array.isArray(raw)) return []

  const out: OfferingAddOnItemDTO[] = []

  for (const item of raw) {
    if (!isRecord(item)) continue

    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const serviceId =
      typeof item.serviceId === 'string' ? item.serviceId.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const price = typeof item.price === 'string' ? item.price.trim() : ''
    // 0 is a legal, intentional add-on duration (instant/retail add-on) —
    // only a negative/missing minutes value means the entry is unusable.
    const minutes = typeof item.minutes === 'number' ? item.minutes : -1

    if (!id || !serviceId || !title || !price || minutes < 0) continue

    out.push({
      id,
      serviceId,
      title,
      group: typeof item.group === 'string' ? item.group : null,
      price,
      minutes,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
      isRecommended: item.isRecommended === true,
      isPreselected: item.isPreselected === true,
    })
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

// Passive double-book heads-up. When the pro picks a custom time that collides
// with an existing appointment, we surface a soft "overlaps {client}" note —
// the pre-submit mirror of the calendar grid's amber signal + the reschedule
// confirm modal's `pendingOverlapName`. The server still allows a pro overlap
// (PRO_AUTHORIZED_OVERLAP); this only surfaces it before submit. Non-blocking.

// A generous window around the proposed start to fetch candidate bookings; the
// precise half-open `hasOverlap` check does the real filtering. ±1 day comfortably
// The overlap-warning phrases are shared with the calendar confirm modal so one
// collision cannot be described two ways, and the wire→overlap-check normalizer
// now lives in lib/calendar/overlap.ts so it is unit-testable
// (B-D8, consolidated in B5).

const SUMMARY_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// Pretty-prints the picked wall-clock for the summary rail. This is the exact
// local time the pro typed (no instant, no zone math), so it's plain string
// formatting — the @/lib/time barrel is for instants and stays the source of
// truth for the actual UTC conversion at submit.
function formatWallClock(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return ''

  const month = SUMMARY_MONTHS[Number(m[2]) - 1] ?? ''
  const day = Number(m[3])
  const hour24 = Number(m[4])
  const minute = m[5]
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = ((hour24 + 11) % 12) + 1

  return `${month} ${day}, ${hour12}:${minute} ${period}`
}

function FormCard({
  step,
  title,
  children,
}: {
  step: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="tovis-glass rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4">
      <div className="mb-3.5 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accentPrimary font-mono text-[9px] font-bold text-bgPrimary">
          {step}
        </span>
        <span className="font-display text-[15px] font-bold text-textPrimary">
          {title}
        </span>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[12.5px] text-textMuted">{label}</span>
      <span className="text-right font-display text-[13px] font-bold text-textPrimary">
        {value || '—'}
      </span>
    </div>
  )
}

export default function NewBookingForm({
  professionalId,
  clients,
  offerings,
  locations,
  clientAddressesByClientId,
  depositConfig,
  defaultClientId,
  defaultOfferingId,
  defaultLocationId,
  defaultLocationType,
  defaultScheduledAt,
  cancelHref = '/pro/bookings',
  cancelMode = 'href',
  recurringEnabled = false,
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
  // Selectable add-ons for the chosen offering + mode, and the pro's selection.
  // Fetched from GET /api/v1/offerings/add-ons (the same source the client
  // booking flow uses); the selected link ids fold duration + price into the
  // booking and persist as ADD_ON line items server-side.
  const [addOnOptions, setAddOnOptions] = useState<OfferingAddOnItemDTO[]>([])
  const [addOnsLoading, setAddOnsLoading] = useState(false)
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([])
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
    placeId: null,
    lat: null,
    lng: null,
    isDefault: true,
  })

  // Google Places autocomplete for the new service address. Picking a suggestion
  // fills the fields + an exact pin (placeId/lat/lng); editing an address field
  // by hand clears the pin so the server re-geocodes what was typed.
  const [serviceQuery, setServiceQuery] = useState('')
  const [servicePredictions, setServicePredictions] = useState<PlacePrediction[]>(
    [],
  )
  const [serviceSearching, setServiceSearching] = useState(false)
  const serviceSessionTokenRef = useRef(makePlacesSessionToken())

  function updateServiceAddressField(patch: Partial<ServiceAddressFormState>) {
    // Any manual edit to an address-defining field invalidates a picked pin.
    setServiceAddress((current) => ({
      ...current,
      ...patch,
      placeId: null,
      lat: null,
      lng: null,
    }))
  }

  useEffect(() => {
    const q = serviceQuery.trim()
    if (q.length < 3) {
      setServicePredictions([])
      setServiceSearching(false)
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        setServiceSearching(true)
        const qs = new URLSearchParams()
        qs.set('input', q)
        qs.set('sessionToken', serviceSessionTokenRef.current)
        qs.set('kind', 'ADDRESS')
        qs.set('components', 'country:us')

        const res = await fetch(
          `/api/v1/google/places/autocomplete?${qs.toString()}`,
          {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: ac.signal,
          },
        )
        const raw = await safeJson(res)
        setServicePredictions(res.ok ? parsePlacePredictions(raw) : [])
      } catch (e) {
        if ((e as { name?: unknown })?.name === 'AbortError') return
        setServicePredictions([])
      } finally {
        setServiceSearching(false)
      }
    }, 220)

    return () => {
      ac.abort()
      window.clearTimeout(t)
    }
  }, [serviceQuery])

  async function chooseServicePrediction(prediction: PlacePrediction) {
    try {
      const qs = new URLSearchParams()
      qs.set('placeId', prediction.placeId)
      qs.set('sessionToken', serviceSessionTokenRef.current)

      const res = await fetch(`/api/v1/google/places/details?${qs.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      const raw = await safeJson(res)
      if (!res.ok) return

      const place = parsePlaceDetails(raw)
      if (!place) return

      const streetLine = [place.components.street_number, place.components.route]
        .filter(Boolean)
        .join(' ')
        .trim()

      setServiceAddress((current) => ({
        ...current,
        label: current.label.trim() || prediction.mainText || 'Home',
        formattedAddress: place.formattedAddress,
        addressLine1: streetLine || place.formattedAddress,
        city: place.city ?? current.city,
        state: place.state ?? current.state,
        postalCode: place.postalCode ?? current.postalCode,
        countryCode: place.countryCode ?? 'US',
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
      }))
      setServiceQuery(prediction.description)
      setServicePredictions([])
      serviceSessionTokenRef.current = makePlacesSessionToken()
    } catch {
      // Non-fatal — the pro can still complete the fields manually.
    }
  }
  const [scheduledAt, setScheduledAt] = useState(
    defaultScheduledAt ?? defaultDatetimeLocal(),
  )
  // Time selection has two modes: pick a real open slot (default), or enter a
  // free custom time (with the scheduling overrides). A prefilled time (e.g.
  // tapping an empty calendar slot) opens straight into custom mode, mirroring
  // iOS `ProNewBookingView`.
  const [timeMode, setTimeMode] = useState<'slots' | 'custom'>(
    defaultScheduledAt ? 'custom' : 'slots',
  )
  // The chosen open slot's ISO UTC start instant (slots mode only).
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [internalNotes, setInternalNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Soft scheduling overrides. The server is the source of truth for whether a
  // requested time trips a pro-overridable rule (outside working hours, short
  // notice, too far out). When it does, it replies with an override-gated
  // `code`; we surface a warning + confirmation and let the pro book anyway by
  // re-submitting with the matching `allow…` flag.
  const [overridePrompt, setOverridePrompt] =
    useState<BookingOverridePrompt | null>(null)
  const [authorizedOverrideFlags, setAuthorizedOverrideFlags] = useState<
    BookingOverrideFlag[]
  >([])
  const [overrideReason, setOverrideReason] = useState('')

  // B5 follow-up: a client is mid-checkout on the minutes the pro just asked
  // for. Same soft-confirmation shape as the override prompt above — the server
  // refuses once with the decision, the pro answers, and the next submit
  // carries `confirmHoldOverlap` (which also mints a fresh idempotency key,
  // since the key is keyed on the body).
  const [holdOverlapDecision, setHoldOverlapDecision] =
    useState<HeldSlotDecision | null>(null)
  const [holdOverlapConfirmed, setHoldOverlapConfirmed] = useState(false)

  // Carries the submit key across a network-error retry so a request that
  // actually landed can't double-book. Keyed to the exact body, so editing
  // the form (or an override retry, which adds flags) mints a fresh key.
  const submitIdempotencyKeyRef = useRef<{
    key: string
    bodyJson: string
  } | null>(null)

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
          `/api/v1/pro/clients/search?q=${encodeURIComponent(query)}`,
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
          `/api/v1/pro/clients/${encodeURIComponent(clientId)}/service-addresses`,
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

  // Load the add-ons available for the chosen offering in the chosen mode. Any
  // change to offering or mode clears the prior selection (add-ons are scoped to
  // an offering + location mode), so a stale add-on can't ride along.
  useEffect(() => {
    setSelectedAddOnIds([])
    setAddOnOptions([])

    if (!offeringId) {
      setAddOnsLoading(false)
      return
    }

    const controller = new AbortController()

    void (async () => {
      try {
        setAddOnsLoading(true)
        const qs = new URLSearchParams({ offeringId, locationType })
        const res = await fetch(`/api/v1/offerings/add-ons?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        const data = await safeJson(res)
        setAddOnOptions(res.ok ? normalizeAddOns(data) : [])
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setAddOnOptions([])
      } finally {
        setAddOnsLoading(false)
      }
    })()

    return () => controller.abort()
  }, [offeringId, locationType])

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

  // A scheduling override only applies to the exact slot it was confirmed for.
  // If the pro changes the time, location, mode, or service, drop it so the new
  // slot is validated from scratch.
  useEffect(() => {
    setOverridePrompt(null)
    setAuthorizedOverrideFlags([])
    setOverrideReason('')
    // Same rule for the live-hold answer, and for the same reason: the pro
    // agreed to book over ONE client's checkout on ONE slot. Carrying that
    // consent to a different time (or a different service, which changes the
    // window) would book over somebody they were never shown.
    setHoldOverlapDecision(null)
    setHoldOverlapConfirmed(false)
  }, [scheduledAt, locationId, locationType, offeringId, selectedAddOnIds])

  const overrideAuthorized = overridePrompt
    ? authorizedOverrideFlags.includes(overridePrompt.flag)
    : true

  /** The pro chose to take the slot: remember it, close, and re-submit. */
  function proceedOverHold() {
    setHoldOverlapConfirmed(true)
    setHoldOverlapDecision(null)
    void submitBooking({ confirmHoldOverlap: true })
  }

  /**
   * The pro chose to leave the client to it. The attempt is simply abandoned —
   * nothing to persist, exactly as if they had navigated away. The form keeps
   * everything they typed, so waiting a minute and pressing Book again is the
   * whole recovery.
   */
  function waitForHold() {
    setHoldOverlapDecision(null)
  }

  function toggleOverrideAuthorized(flag: BookingOverrideFlag, next: boolean) {
    setAuthorizedOverrideFlags((current) => {
      if (next) return mergeBookingOverrideFlags(current, flag)
      return current.filter((value) => value !== flag)
    })
  }

  function toggleAddOn(id: string, next: boolean) {
    setSelectedAddOnIds((current) => {
      if (next) {
        return current.includes(id) ? current : [...current, id]
      }
      return current.filter((value) => value !== id)
    })
  }

  const selectedAddOns = useMemo(
    () => addOnOptions.filter((addOn) => selectedAddOnIds.includes(addOn.id)),
    [addOnOptions, selectedAddOnIds],
  )
  const addOnMinutesTotal = useMemo(
    () => selectedAddOns.reduce((sum, addOn) => sum + addOn.minutes, 0),
    [selectedAddOns],
  )
  const addOnPriceTotal = useMemo(
    () =>
      selectedAddOns.reduce(
        (sum, addOn) => sum + (Number(addOn.price) || 0),
        0,
      ),
    [selectedAddOns],
  )

  // Total appointment length (base service in the chosen mode + add-ons). Drives
  // both the summary rail and the proposed window for the double-book check.
  const proposedDurationMinutes = useMemo(
    () =>
      selectedOffering
        ? pickDisplayDurationMinutes(selectedOffering, locationType) +
          addOnMinutesTotal
        : 0,
    [selectedOffering, locationType, addOnMinutesTotal],
  )

  // The proposed booking's start instant as UTC ISO, or null when it can't be
  // resolved yet (no slot picked, or an off-grid custom wall time). Slots mode
  // submits the chosen instant directly; custom mode converts the wall-clock in
  // the booking-location timezone — the same resolution `handleSubmit` does, but
  // read-only (no error surfacing) so the passive check can run as the pro types.
  const proposedStartISO = useMemo<string | null>(() => {
    if (timeMode === 'slots') return selectedSlot
    if (!scheduledAt) return null

    const resolved = datetimeLocalToUtcIsoStrict(scheduledAt, bookingTimeZone)
    return resolved.ok ? resolved.iso : null
  }, [timeMode, selectedSlot, scheduledAt, bookingTimeZone])

  // K10-B: the deposit step. The preview amount reuses the SAME money helper
  // the write boundary runs (account term vs prepay term, max not sum, prepay
  // capped at the bill); the server recomputes authoritatively on submit, so a
  // price-grace ramp can only make the real amount smaller, never larger.
  const [depositSkipped, setDepositSkipped] = useState(false)

  const depositAmountCents = useMemo(() => {
    if (!selectedOffering) return 0

    const baseCents = Math.round(
      (Number(pickDisplayPrice(selectedOffering, locationType)) || 0) * 100,
    )
    const subtotalCents = baseCents + Math.round(addOnPriceTotal * 100)

    return computeUpfrontDepositCents({
      scopeDepositRequired: depositConfig.depositEnabled,
      settings: {
        depositEnabled: depositConfig.depositEnabled,
        depositType: depositConfig.depositType ?? 'FLAT',
        depositFlatAmountCents: depositConfig.depositFlatAmountCents,
        depositPercent: depositConfig.depositPercent,
      },
      serviceSubtotalCents: subtotalCents,
      prepayScope: selectedOffering.prepayScope,
      baseServiceCents: baseCents,
      bookingTotalCents: subtotalCents,
    })
  }, [selectedOffering, locationType, addOnPriceTotal, depositConfig])

  // Offered only when there is something chargeable and somewhere for the
  // charge to land. The client-contact requirement is enforced server-side
  // (the create is REFUSED, and the refusal surfaces in the form error).
  const depositAvailable =
    depositConfig.stripeReady && depositAmountCents >= STRIPE_MIN_CHARGE_CENTS
  const depositRequested = depositAvailable && !depositSkipped

  // The concrete auto-release moment the pro is agreeing to:
  // max(appointment − lead, now + floor), shown in the booking's timezone.
  const depositReleasePreview = useMemo(() => {
    if (!depositRequested || !proposedStartISO) return null

    const start = new Date(proposedStartISO).getTime()
    if (!Number.isFinite(start)) return null

    const releaseAt = new Date(
      Math.max(
        start - depositConfig.releaseLeadHours * 60 * 60 * 1000,
        Date.now() + depositConfig.releaseFloorHours * 60 * 60 * 1000,
      ),
    )

    return formatInTimeZone(
      releaseAt,
      sanitizeTimeZone(bookingTimeZone, 'UTC'),
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      },
    )
  }, [depositRequested, proposedStartISO, depositConfig, bookingTimeZone])

  // ── K19: the "repeats" step ────────────────────────────────────────────────
  //
  // Turning this on sends the whole form to POST /api/v1/pro/booking-series
  // instead of POST /api/v1/pro/bookings. The series route takes an EXISTING
  // client id and an EXISTING saved service address — it has no inline
  // create-a-client or create-an-address payload — so the control is withheld
  // (and force-reset) whenever the form is in one of those modes, rather than
  // being offered and then refused on submit.
  const [repeats, setRepeats] = useState(false)
  const [intervalWeeks, setIntervalWeeks] = useState(REPEAT_INTERVAL_DEFAULT)
  // null = open-ended (K20). The boundary has accepted null since K18; what it
  // was missing until K20 was something to advance the window.
  const [occurrenceCount, setOccurrenceCount] = useState<number | null>(
    REPEAT_COUNT_DEFAULT,
  )

  const repeatBlockedReason: string | null =
    clientMode === 'new'
      ? 'Repeating appointments need a saved client. Create this client first, then book the series.'
      : locationType === 'MOBILE' && addressMode === 'new'
        ? 'Repeating appointments need a saved service address. Save the address with this booking first, then book the series.'
        : null

  const repeatAvailable = recurringEnabled && repeatBlockedReason === null

  // A pro who picks "new client" AFTER switching repeats on must not silently
  // submit a series request the route will refuse — the toggle goes back off
  // with the reason still on screen.
  useEffect(() => {
    if (!repeatAvailable && repeats) setRepeats(false)
  }, [repeatAvailable, repeats])

  // Clients the proposed time collides with (empty when clear). Fetched from the
  // pro calendar so it stays in lockstep with the grid's own overlap signal.
  const [overlapNames, setOverlapNames] = useState<string[]>([])
  // Gate only — the check still waits for a chosen location, because the form
  // can't be submitted without one. It is NOT the scope of the query below.
  const hasBookingLocation = selectedLocation !== null

  useEffect(() => {
    if (
      loading ||
      !hasBookingLocation ||
      !proposedStartISO ||
      proposedDurationMinutes <= 0
    ) {
      setOverlapNames([])
      return
    }

    const startMs = new Date(proposedStartISO).getTime()
    if (!Number.isFinite(startMs)) {
      setOverlapNames([])
      return
    }

    const endISO = new Date(
      startMs + proposedDurationMinutes * 60_000,
    ).toISOString()
    const fromISO = new Date(
      startMs - OVERLAP_CONFLICT_FETCH_WINDOW_MS,
    ).toISOString()
    const toISO = new Date(
      startMs + OVERLAP_CONFLICT_FETCH_WINDOW_MS,
    ).toISOString()

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        // 🔴 ALL locations, not the one being booked.
        // `Booking_no_active_professional_overlap` excludes on `professionalId`
        // ALONE — there is no location term — so a pro booking a salon slot got
        // no warning at all about the mobile job already sitting in it, and then
        // a hard refusal on submit. A warning has to ask about the same resource
        // the write is checked against. (K3 widened the calendar grid's own feed;
        // this surface reads the same route and was left narrow.)
        const qs = new URLSearchParams({
          from: fromISO,
          to: toISO,
          scope: 'ALL',
        })

        const res = await fetch(`/api/v1/pro/calendar?${qs.toString()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        // A background check never redirects or errors the form — on any
        // non-OK response (expired session, etc.) we just clear the note.
        if (!res.ok) {
          setOverlapNames([])
          return
        }

        const data = await safeJson(res)
        setOverlapNames(
          overlappingClientNamesForRange(
            { startsAt: proposedStartISO, endsAt: endISO },
            normalizeCalendarOverlapEvents({
              data,
              holdName: OVERLAP_HOLD_NAME,
            }),
            OVERLAP_FALLBACK_NAME,
          ),
        )
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setOverlapNames([])
      }
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [loading, hasBookingLocation, proposedStartISO, proposedDurationMinutes])

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

  const submitBlockers = [
    loading ? 'Still loading' : null,
    !selectedOffering ? 'Select a service' : null,
    !locationId ? 'Select a pro location' : null,
    timeMode === 'slots'
      ? !selectedSlot
        ? 'Pick an open time'
        : null
      : !scheduledAt
        ? 'Select date and time'
        : null,
    clientMode === 'existing' && !clientId ? 'Select an existing client' : null,
    clientMode === 'new' && !newClientReady
      ? 'Enter new client first name, last name, and email'
      : null,
    locationType === 'MOBILE' &&
    addressMode === 'existing' &&
    (!clientAddressId || clientAddressesLoading)
      ? 'Select a saved client service address'
      : null,
    locationType === 'MOBILE' &&
    addressMode === 'new' &&
    !newServiceAddressReady
      ? 'Enter a valid mobile service address'
      : null,
    overridePrompt && !overrideAuthorized
      ? 'Confirm the scheduling override to continue'
      : null,
  ].filter((blocker): blocker is string => Boolean(blocker))

  const submitDisabled = submitBlockers.length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void submitBooking()
  }

  /**
   * `confirmHoldOverlap` is passed in rather than read off state because the
   * popup's "book it anyway" re-submits immediately: a `setState` in the same
   * tick would not be visible to this call, and the retry would ask the same
   * question forever.
   */
  async function submitBooking(options?: { confirmHoldOverlap?: boolean }) {
    setError(null)

    if (loading) return

    const confirmHoldOverlap =
      options?.confirmHoldOverlap ?? holdOverlapConfirmed

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

    if (timeMode === 'slots' ? !selectedSlot : !scheduledAt) {
      setError(
        timeMode === 'slots'
          ? 'Pick an open time, or switch to a custom time.'
          : 'Date and time are required.',
      )
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

    // Slots mode submits the chosen open slot's ISO instant directly; custom
    // mode converts the wall-clock input in the booking-location timezone.
    let scheduledForISO: string
    if (timeMode === 'slots') {
      if (!selectedSlot) {
        setError('Pick an open time, or switch to a custom time.')
        return
      }
      scheduledForISO = selectedSlot
    } else {
      const scheduledResult = datetimeLocalToUtcIsoStrict(
        scheduledAt,
        bookingTimeZone,
      )

      if (!scheduledResult.ok) {
        setError(WALL_TIME_ERROR_MESSAGE[scheduledResult.reason])
        return
      }

      scheduledForISO = scheduledResult.iso
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
            placeId: serviceAddress.placeId,
            lat: serviceAddress.lat,
            lng: serviceAddress.lng,
            isDefault: serviceAddress.isDefault,
          }
        : null

    const trimmedOverrideReason = overrideReason.trim()
    const overrideBody = overrideBodyFromFlags(authorizedOverrideFlags)
    // Present only once the pro has actually answered — an absent field is
    // "ask me", which is what every first attempt must be.
    //
    // Single bookings only. A SERIES is materialized unattended, so its source
    // refuses on ANY conflict before the pro branch is reached — the decision
    // can never be raised there, and a field the route would ignore is one more
    // thing to wonder about later.
    const holdOverlapBody = confirmHoldOverlap
      ? { [CONFIRM_HOLD_OVERLAP_FIELD]: true }
      : {}

    setLoading(true)

    // K19: a repeating booking is a different resource, not a flag on this one.
    // `submitAsSeries` re-derives `repeatAvailable` rather than trusting the
    // `repeats` state alone, so a mode switch that raced the effect above still
    // posts the single booking the route can actually accept.
    const submitAsSeries = repeats && repeatAvailable

    try {
      const bodyJson = submitAsSeries
        ? JSON.stringify({
            clientId,
            offeringId: selectedOffering.id,
            addOnIds: selectedAddOnIds,
            locationType,
            locationId,
            clientAddressId:
              locationType === 'MOBILE' ? clientAddressId || null : null,
            firstOccurrenceAt: scheduledForISO,
            intervalWeeks,
            occurrenceCount,
            internalNotes: internalNotes.trim() || null,
            overrideReason: trimmedOverrideReason || null,
            depositRequested,
            // First occurrence only — see REPEAT_* above (K18-A).
            depositPerOccurrence: false,
            ...overrideBody,
          })
        : JSON.stringify({
            clientId: clientMode === 'existing' ? clientId : null,
            client: clientPayload,
            offeringId: selectedOffering.id,
            addOnIds: selectedAddOnIds,
            locationType,
            locationId,
            clientAddressId:
              locationType === 'MOBILE' && addressMode === 'existing'
                ? clientAddressId
                : null,
            serviceAddress: serviceAddressPayload,
            scheduledFor: scheduledForISO,
            internalNotes: internalNotes.trim() || null,
            overrideReason: trimmedOverrideReason || null,
            depositRequested,
            ...holdOverlapBody,
            ...overrideBody,
          })

      const cached = submitIdempotencyKeyRef.current
      const idempotencyKey =
        cached && cached.bodyJson === bodyJson
          ? cached.key
          : buildClientIdempotencyKey({
              scope: submitAsSeries
                ? 'pro-booking-series-create'
                : 'pro-booking-create',
              entityId: selectedOffering.id,
              action: 'create',
              nonce: bodyJson,
            })

      submitIdempotencyKeyRef.current = { key: idempotencyKey, bodyJson }

  const res = await fetch(
    submitAsSeries ? '/api/v1/pro/booking-series' : '/api/v1/pro/bookings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...idempotencyHeaders(idempotencyKey),
      },
      body: bodyJson,
    },
  )

  if (res.status === 401) {
    submitIdempotencyKeyRef.current = null
    redirectToLogin(router, 'new-booking')
    return
  }

  const data = await safeJson(res)

  if (!res.ok) {
    submitIdempotencyKeyRef.current = null

    // A client is checking out for these minutes right now. Not a dead end —
    // the pro is shown who is holding it (new or returning to them, and nothing
    // else) and decides. Checked before the override prompt because it is a
    // different KIND of answer: an override says "my own rule doesn't apply
    // here", this one says "take it from someone mid-payment".
    //
    // `holdOverlapConfirmed` guards the loop: once answered, a second refusal
    // with the same code would be a server bug, and re-opening the popup would
    // trap the pro in it.
    const heldSlot = readHoldOverlapDecision(data)

    if (heldSlot && !confirmHoldOverlap) {
      setHoldOverlapDecision(heldSlot)
      setError(null)
      return
    }

    // If the failure is an unauthorized, pro-overridable scheduling rule, turn
    // it into a soft confirmation instead of a dead-end error: surface the
    // warning + checkbox so the pro can book anyway on the next submit.
    const prompt = readBookingOverridePrompt(data, 'create')

    if (prompt && !authorizedOverrideFlags.includes(prompt.flag)) {
      setOverridePrompt(prompt)
      setError(null)
      return
    }

    setError(errorFromResponse(res, data, { byStatus: STATUS_COPY }))
    return
  }

  submitIdempotencyKeyRef.current = null

  // 🔴 A series lands on the SERIES page, never on occurrence 0's booking page.
  // The 201 can carry eleven bookings and one skip, and the booking page has
  // nowhere to say so — a pro who asked for twelve would be shown one
  // appointment and no hint that a date is missing
  // ([[an-always-empty-key-looks-like-an-export]]).
  const nextSeriesId = submitAsSeries ? readSeriesId(data) : null

  if (nextSeriesId) {
    router.push(
      `/pro/bookings/series/${encodeURIComponent(nextSeriesId)}`,
    )
  } else {
    const nextBookingId = readBookingId(data)

    if (nextBookingId) {
      router.push(`/pro/bookings/${encodeURIComponent(nextBookingId)}`)
    } else {
      router.push('/pro/bookings')
    }
  }

  router.refresh()
} catch (err) {
  console.error(err)
  setError('Network error creating booking. Try again.')
} finally {
  setLoading(false)
}
  }

  const field = controlClassName({ surface: 'solid' })
  const label = 'text-[12px] font-black text-textPrimary'
  const helper = 'mt-2 text-[12px] text-textSecondary'
  const toggleBtn =
    'flex-1 rounded-xl border px-3 py-2 text-[12px] font-black transition disabled:opacity-60'
  const toggleActive = 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
  const toggleIdle =
    'border-surfaceGlass/10 bg-bgPrimary text-textSecondary hover:border-surfaceGlass/20 hover:text-textPrimary'

  const tzLabel = sanitizeTimeZone(bookingTimeZone, 'UTC')

  // Live tallies for the desktop summary rail — derived from the same state the
  // form already tracks; no new sources of truth.
  const summaryClientName =
    clientMode === 'new'
      ? `${newClient.firstName} ${newClient.lastName}`.trim()
      : (existingClientOptions.find((option) => option.id === clientId)
          ?.fullName ?? '')
  const summaryService = selectedOffering
    ? selectedOffering.title || selectedOffering.service.name
    : ''
  const summaryDuration = proposedDurationMinutes
  const summaryPrice = selectedOffering
    ? moneyToString(
        pickDisplayPrice(selectedOffering, locationType) + addOnPriceTotal,
      )
    : null
  const summaryWhere = (() => {
    if (locationType === 'SALON') {
      return selectedLocation ? `Salon · ${selectedLocation.label}` : 'Salon'
    }
    if (addressMode === 'existing') {
      const saved = selectedClientAddresses.find(
        (address) => address.id === clientAddressId,
      )
      return saved ? `Mobile · ${saved.label}` : 'Mobile'
    }
    const typed =
      serviceAddress.formattedAddress.trim() ||
      serviceAddress.addressLine1.trim() ||
      serviceAddress.label.trim()
    return typed ? `Mobile · ${typed}` : 'Mobile'
  })()
  const summaryWhen =
    timeMode === 'slots'
      ? selectedSlot
        ? formatSlotFullLabel(selectedSlot, bookingTimeZone)
        : ''
      : formatWallClock(scheduledAt)

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid gap-3.5 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="grid gap-3.5">
          <FormCard step={1} title="Client">
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
                : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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
                : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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
          </FormCard>

          <FormCard step={2} title="Service &amp; place">
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
                : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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
                : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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

      {offeringId && (addOnsLoading || addOnOptions.length > 0) ? (
        <div className="grid gap-2">
          <div className={label}>Add-ons</div>

          {addOnsLoading ? (
            <div className="text-[12px] text-textSecondary">
              Loading add-ons…
            </div>
          ) : (
            <div className="grid gap-1.5">
              {addOnOptions.map((addOn) => {
                const checked = selectedAddOnIds.includes(addOn.id)
                return (
                  <label
                    key={addOn.id}
                    className={[
                      'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition',
                      checked
                        ? 'border-accentPrimary/60 bg-accentPrimary/10'
                        : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
                      loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={loading}
                        onChange={(e) => toggleAddOn(addOn.id, e.target.checked)}
                        className="h-4 w-4 rounded border-surfaceGlass/10 bg-bgPrimary"
                      />
                      <span className="text-[13px] font-black text-textPrimary">
                        {addOn.title}
                      </span>
                      {addOn.isRecommended ? (
                        <span className="rounded-full bg-accentPrimary/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-accentPrimary">
                          Popular
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap text-right text-[12px] font-black text-textSecondary">
                      +${addOn.price}
                      {addOn.minutes > 0 ? ` · ${addOn.minutes} min` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          <div className={helper}>
            Add-ons extend the appointment length and total price.
          </div>
        </div>
      ) : null}

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
                    : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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
                    : 'border-surfaceGlass/10 bg-bgPrimary hover:border-surfaceGlass/20',
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
              <div className="grid gap-2 sm:col-span-2">
                <label htmlFor="serviceAddressSearch" className={label}>
                  Search address
                </label>
                <input
                  id="serviceAddressSearch"
                  value={serviceQuery}
                  disabled={loading}
                  onChange={(e) => setServiceQuery(e.target.value)}
                  placeholder="Start typing the client’s address…"
                  className={field}
                  autoComplete="off"
                />
                <div className={helper}>
                  Pick a suggestion for the most accurate location and travel
                  pin. You can also fill the fields below manually.
                </div>

                {serviceSearching ? (
                  <div className="text-[12px] text-textSecondary">Searching…</div>
                ) : null}

                {servicePredictions.length ? (
                  <div className="grid gap-1.5">
                    {servicePredictions.slice(0, 6).map((prediction) => (
                      <button
                        key={prediction.placeId}
                        type="button"
                        disabled={loading}
                        onClick={() => void chooseServicePrediction(prediction)}
                        className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary/40 p-2 text-left hover:bg-surfaceGlass/5 disabled:opacity-60"
                      >
                        <div className="text-[13px] font-black text-textPrimary">
                          {prediction.mainText || prediction.description}
                        </div>
                        {prediction.secondaryText ? (
                          <div className="text-[12px] text-textSecondary">
                            {prediction.secondaryText}
                          </div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                {serviceAddress.lat != null && serviceAddress.lng != null ? (
                  <div className="rounded-xl border border-toneSuccess/25 bg-toneSuccess/10 p-2 text-[12px] font-semibold text-textPrimary">
                    Location confirmed — exact travel pin saved.
                  </div>
                ) : null}
              </div>

              <div className="sm:col-span-2 text-[12px] font-black uppercase tracking-wide text-textSecondary">
                Or enter manually
              </div>

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
                    updateServiceAddressField({
                      formattedAddress: e.target.value,
                    })
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
                    updateServiceAddressField({ addressLine1: e.target.value })
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
                    updateServiceAddressField({ city: e.target.value })
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
                    updateServiceAddressField({ state: e.target.value })
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
                    updateServiceAddressField({ postalCode: e.target.value })
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
                    updateServiceAddressField({ countryCode: e.target.value })
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
                  className="h-4 w-4 rounded border-surfaceGlass/10 bg-bgPrimary"
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
          </FormCard>

          <FormCard step={3} title="When">
      <div className="grid gap-3">
        <div className="grid gap-2">
          <span className={label}>
            Date &amp; time <span className="text-textSecondary">*</span>
          </span>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => setTimeMode('slots')}
              aria-pressed={timeMode === 'slots'}
              className={`${toggleBtn} ${
                timeMode === 'slots' ? toggleActive : toggleIdle
              }`}
            >
              Open times
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setTimeMode('custom')}
              aria-pressed={timeMode === 'custom'}
              className={`${toggleBtn} ${
                timeMode === 'custom' ? toggleActive : toggleIdle
              }`}
            >
              Custom time
            </button>
          </div>
        </div>

        {timeMode === 'slots' ? (
          selectedOffering && selectedLocation ? (
            <OpenSlotPicker
              professionalId={professionalId}
              serviceId={selectedOffering.service.id}
              offeringId={selectedOffering.id}
              locationId={selectedLocation.id}
              locationType={locationType}
              locationTimeZone={bookingTimeZone}
              clientAddressId={
                locationType === 'MOBILE' &&
                addressMode === 'existing' &&
                clientAddressId
                  ? clientAddressId
                  : null
              }
              addOnIds={selectedAddOnIds}
              value={selectedSlot}
              onChange={setSelectedSlot}
              disabled={loading}
            />
          ) : (
            <div className={helper}>
              Choose a service and location to see the pro’s open times.
            </div>
          )
        ) : (
          <div className="grid gap-2">
            <input
              id="datetime"
              type="datetime-local"
              value={scheduledAt}
              disabled={loading}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={field}
            />

            <div className={helper}>
              Interpreted in <span className="font-black">{tzLabel}</span> based
              on the selected booking location, then stored as UTC. Off-grid
              times may need the scheduling overrides below.
            </div>
          </div>
        )}

        {overlapNames.length > 0 ? (
          <div
            role="status"
            className="rounded-xl border border-toneWarn/25 bg-toneWarn/10 p-3"
          >
            <div className="text-[12px] font-black uppercase tracking-wide text-toneWarn">
              Schedule conflict
            </div>
            <div className="mt-1 text-[12px] text-textSecondary">
              This overlaps {formatOverlapNames(overlapNames)}. You can still
              book it.
            </div>
          </div>
        ) : null}
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
          className={`${field} min-h-24 resize-y`}
        />
      </div>
          </FormCard>

      {depositAvailable ? (
        <FormCard step={4} title="Deposit">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={depositRequested}
              disabled={loading}
              onChange={(e) => setDepositSkipped(!e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accentPrimary"
            />
            <span className="grid gap-1">
              <span className={label}>
                Require a{' '}
                {moneyToString(depositAmountCents / 100)
                  ? `$${moneyToString(depositAmountCents / 100)}`
                  : ''}{' '}
                deposit before the appointment
              </span>
              <span className="text-[12px] text-textSecondary">
                The client gets a secure pay link by email or text — no account
                needed. The deposit counts toward the final total.
              </span>
            </span>
          </label>

          {depositRequested ? (
            <div className="rounded-card border border-toneWarn/30 bg-toneWarn/10 px-3 py-2 text-[12px] text-textPrimary">
              {depositReleasePreview ? (
                <>
                  If unpaid by{' '}
                  <span className="font-black">{depositReleasePreview}</span>,
                  this booking cancels automatically and the time opens back up.
                </>
              ) : (
                <>
                  If the deposit stays unpaid, this booking cancels
                  automatically before the appointment and the time opens back
                  up. Pick a time to see the exact deadline.
                </>
              )}
            </div>
          ) : (
            <div className={helper}>
              No deposit will be requested — you can collect payment at the
              appointment as usual.
            </div>
          )}
        </FormCard>
      ) : null}

      {/* K19 — the repeats step. Rendered ONLY when the server says the feature
          is on: the kill switch has to reach the control, or the pro is offered
          a form the route answers 404 to. */}
      {recurringEnabled ? (
        <FormCard step={depositAvailable ? 5 : 4} title="Repeats">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={repeats}
              disabled={loading || !repeatAvailable}
              onChange={(e) => setRepeats(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accentPrimary"
              data-testid="repeats-toggle"
            />
            <span className="grid gap-1">
              <span className={label}>Repeat this appointment</span>
              <span className="text-[12px] text-textSecondary">
                Books the whole run now, so the time is held on your calendar.
              </span>
            </span>
          </label>

          {repeatBlockedReason ? (
            <div className={helper} data-testid="repeats-blocked">
              {repeatBlockedReason}
            </div>
          ) : null}

          {repeats && repeatAvailable ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className={label} htmlFor="repeat-interval">
                  How often
                </label>
                <select
                  id="repeat-interval"
                  className={field}
                  value={intervalWeeks}
                  disabled={loading}
                  onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                >
                  {REPEAT_INTERVAL_WEEKS_OPTIONS.map((weeks) => (
                    <option key={weeks} value={weeks}>
                      {repeatIntervalLabel(weeks)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className={label} htmlFor="repeat-count">
                  How many appointments
                </label>
                <select
                  id="repeat-count"
                  className={field}
                  value={occurrenceCount ?? REPEAT_COUNT_OPEN_ENDED}
                  disabled={loading}
                  onChange={(e) =>
                    setOccurrenceCount(
                      e.target.value === REPEAT_COUNT_OPEN_ENDED
                        ? null
                        : Number(e.target.value),
                    )
                  }
                >
                  {REPEAT_COUNT_OPTIONS.map((count) => (
                    <option key={count} value={count}>
                      {count} appointments
                    </option>
                  ))}
                  <option value={REPEAT_COUNT_OPEN_ENDED}>
                    Keep going until I stop it
                  </option>
                </select>
              </div>
            </div>
          ) : null}

          {repeats && repeatAvailable ? (
            <div className="rounded-card border border-toneInfo/30 bg-toneInfo/10 px-3 py-2 text-[12px] text-textPrimary">
              A date already taken by another appointment is skipped, not
              double-booked — you will see exactly which ones on the next screen.
              {occurrenceCount == null
                ? ' An open-ended series books the next few months now and adds further dates automatically until you end it.'
                : ''}
              {depositRequested
                ? ' The deposit is requested once, for the first appointment.'
                : ''}
            </div>
          ) : null}
        </FormCard>
      ) : null}

      {overridePrompt ? (
        <BookingOverridePromptCard
          prompt={overridePrompt}
          authorized={overrideAuthorized}
          disabled={loading}
          reason={overrideReason}
          onToggleAuthorized={(next) =>
            toggleOverrideAuthorized(overridePrompt.flag, next)
          }
          onReasonChange={setOverrideReason}
          helperClassName={helper}
          fieldClassName={field}
        />
      ) : null}

      <HoldOverlapDecisionDialog
        decision={holdOverlapDecision}
        intent="create"
        timeZone={bookingTimeZone}
        busy={loading}
        onProceed={proceedOverHold}
        onWait={waitForHold}
      />

      {error ? (
        <div className="rounded-card border border-toneDanger/20 bg-toneDanger/10 px-3 py-2 text-[12px] font-black text-toneDanger">
          {error}
        </div>
      ) : null}

      {submitBlockers.length > 0 ? (
        <div className="rounded-card border border-toneDanger/20 bg-toneDanger/10 px-3 py-2 text-[12px] font-black text-toneDanger">
          To create this booking: {submitBlockers[0]}
        </div>
      ) : null}
        </div>

        <aside className="lg:sticky lg:top-4">
          <div className="tovis-glass rounded-card border border-surfaceGlass/10 bg-bgSurface p-4">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
              Booking summary
            </div>

            <div className="mt-3 grid gap-2.5">
              <SummaryRow label="Client" value={summaryClientName} />
              <SummaryRow label="Service" value={summaryService} />
              {selectedAddOns.length ? (
                <SummaryRow
                  label="Add-ons"
                  value={selectedAddOns.map((addOn) => addOn.title).join(', ')}
                />
              ) : null}
              <SummaryRow label="Where" value={summaryWhere} />
              <SummaryRow label="When" value={summaryWhen} />
              <SummaryRow
                label="Duration"
                value={summaryDuration ? `${summaryDuration} min` : ''}
              />
              {depositAvailable ? (
                <SummaryRow
                  label="Deposit"
                  value={
                    depositRequested
                      ? `$${moneyToString(depositAmountCents / 100) ?? ''}`
                      : 'Skipped'
                  }
                />
              ) : null}
              {recurringEnabled && repeats && repeatAvailable ? (
                <SummaryRow
                  label="Repeats"
                  value={`${repeatIntervalLabel(intervalWeeks)} · ${
                    occurrenceCount == null
                      ? 'open-ended'
                      : `${occurrenceCount} appointments`
                  }`}
                />
              ) : null}
            </div>

            <div className="mt-3.5 flex items-baseline justify-between border-t border-dashed border-surfaceGlass/10 pt-3.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-textMuted">
                Total
              </span>
              <span className="font-display text-[24px] font-bold text-textPrimary">
                {summaryPrice ? `$${summaryPrice}` : '—'}
              </span>
            </div>

            <button
              type="submit"
              disabled={submitDisabled}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accentPrimary text-[14px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:opacity-60"
            >
              {loading
                ? 'Creating…'
                : repeats && repeatAvailable
                  ? 'Create recurring booking'
                  : 'Create booking'}
            </button>

            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="mt-2.5 flex h-11 w-full items-center justify-center rounded-xl border border-surfaceGlass/10 bg-bgPrimary text-[13px] font-black text-textPrimary transition hover:border-surfaceGlass/20 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </aside>
      </div>
    </form>
  )
}