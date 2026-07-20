// app/pro/bookings/[id]/aftercare/AftercareForm.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ClickableMedia from '@/app/_components/media/ClickableMedia'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { getZonedParts } from '@/lib/time'
import { safeJson, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import {
  addDaysToYmd,
  compareYmd,
  isoToYmdInTimeZone,
  stepYmd,
  SUGGESTED_REBOOK_WINDOW_SPAN_DAYS,
  todayYmdInTimeZone,
  ymdToIsoEndOfDay,
  ymdToIsoStartOfDay,
  type StepUnit,
} from './aftercareDates'
import AvailabilityCalendarPopup from './AvailabilityCalendarPopup'
import RebookSlotPicker, {
  type SelectedRebookSlot,
} from './RebookSlotPicker'

type MediaType = 'IMAGE' | 'VIDEO'
type MediaVisibility = 'PUBLIC' | 'PRO_CLIENT'
type Role = 'CLIENT' | 'PRO' | 'ADMIN'
type MediaPhase = 'BEFORE' | 'AFTER' | 'OTHER'

type MediaItem = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  uploadedByRole: Role | null
  reviewId: string | null
  createdAt: string
  phase: MediaPhase
  renderUrl: string | null
  renderThumbUrl: string | null
  url?: string | null
  thumbUrl?: string | null
}

type RebookMode = 'NONE' | 'BOOKED_NEXT_APPOINTMENT' | 'RECOMMENDED_WINDOW'

type RecommendedProduct = {
  id: string
  name: string
  url: string
  note?: string
}

type Props = {
  bookingId: string
  timeZone: string
  // Source-booking context used to propose a real next-appointment slot from the
  // pro's own availability (same service + location).
  rebookProfessionalId: string
  rebookServiceId: string
  rebookOfferingId: string | null
  rebookLocationType: 'SALON' | 'MOBILE'
  rebookLocationId: string
  rebookClientAddressId: string | null
  // The booking's ClientProfile id — used to list the client's saved service
  // addresses so the pro can pick which one the mobile next appointment is at.
  rebookClientProfileId: string
  existingNotes: string
  existingRebookedFor: string | null
  existingRebookMode?: RebookMode | null
  existingRebookWindowStart?: string | null
  existingRebookWindowEnd?: string | null
  existingRebookDeclinedAt?: string | null
  // Auto-suggested recommended-window dates for a fresh wrap-up (service date +
  // the offering's typical rebook interval). The server sends these only when no
  // aftercare has been saved yet; when present, they pre-select
  // RECOMMENDED_WINDOW so the rebook recommendation defaults to a real date
  // instead of "None". The pro can still edit or clear it.
  suggestedRebookWindowStart?: string | null
  suggestedRebookWindowEnd?: string | null
  // The previously-saved exact next-appointment slot, if any (for prefill).
  existingRebookSlot?: {
    offeringId: string | null
    locationId: string
    locationType: 'SALON' | 'MOBILE'
    clientAddressId?: string | null
    startsAt: string
    endsAt: string
  } | null
  existingMedia: MediaItem[]
  // Pro-chosen featured before/after pair (the primary comparison the client
  // sees). Null → the client falls back to the earliest before/after.
  existingFeaturedBeforeAssetId?: string | null
  existingFeaturedAfterAssetId?: string | null
  existingRecommendedProducts?: RecommendedProduct[]

  // Step 5 explicit state
  existingDraftSavedAt?: string | null
  existingSentToClientAt?: string | null
  existingLastEditedAt?: string | null
  existingVersion?: number | null
  existingIsFinalized?: boolean
  // When true the booking is already completed: render the aftercare as a
  // locked, no-edit summary (disable every input, hide the save/send actions).
  readOnly?: boolean
}

const FORCE_EVENT = 'tovis:pro-session:force'

const MAX_PRODUCTS = 10
const PRODUCT_NAME_MAX = 80
const PRODUCT_NOTE_MAX = 140
const NOTES_MAX = 4000

function currentPathWithQuery() {
  if (typeof window === 'undefined') return '/pro'
  return (
    window.location.pathname + window.location.search + window.location.hash
  )
}

function sanitizeFrom(from: string) {
  const trimmed = from.trim()
  if (!trimmed) return '/pro'
  if (!trimmed.startsWith('/')) return '/pro'
  if (trimmed.startsWith('//')) return '/pro'
  return trimmed
}

function redirectToLogin(
  router: ReturnType<typeof useRouter>,
  reason?: string,
) {
  const from = sanitizeFrom(currentPathWithQuery())
  const qs = new URLSearchParams({ from })
  if (reason) qs.set('reason', reason)
  router.push(`/login?${qs.toString()}`)
}

function errorFromResponse(res: Response, data: unknown) {
  const msg = readErrorMessage(data)
  if (msg) return msg

  if (isRecord(data)) {
    const m = data.message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }

  if (res.status === 401) return 'Please log in to continue.'
  if (res.status === 403) return 'You don’t have access to do that.'
  return `Request failed (${res.status}).`
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function isRebookMode(x: unknown): x is RebookMode {
  return (
    x === 'NONE' ||
    x === 'BOOKED_NEXT_APPOINTMENT' ||
    x === 'RECOMMENDED_WINDOW'
  )
}

function pickString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isValidHttpUrl(url: string) {
  const s = url.trim()
  if (!s) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function safeId() {
  const maybeCrypto = globalThis.crypto
  if (
    maybeCrypto &&
    typeof maybeCrypto === 'object' &&
    typeof maybeCrypto.randomUUID === 'function'
  ) {
    return maybeCrypto.randomUUID()
  }
  return `${Date.now()}-${Math.random()}`
}

function cardClass() {
  return 'rounded-card border border-white/10 bg-bgSecondary p-4 text-textPrimary'
}

function subtleTextClass() {
  return 'text-xs font-semibold text-textSecondary'
}

function sectionTitleClass() {
  return 'text-xs font-black tracking-wide text-textPrimary'
}

function pillClass(active: boolean) {
  return [
    'inline-flex items-center rounded-full px-3 py-1 text-xs font-black transition',
    'border border-white/10',
    active
      ? 'bg-accentPrimary text-bgPrimary'
      : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}

function primaryBtn(disabled: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    disabled
      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60'
      : 'border border-white/10 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
  ].join(' ')
}

function secondaryBtn(disabled: boolean) {
  return [
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-black transition',
    disabled
      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-60'
      : 'border border-white/10 bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}

function inputClass(disabled: boolean) {
  return [
    'w-full rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none',
    disabled ? 'opacity-60 cursor-not-allowed' : 'focus:border-white/20',
  ].join(' ')
}

function labelClass() {
  return 'mb-1 block text-xs font-black text-textSecondary'
}

const SHORT_MONTHS = [
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
] as const

function toDisplayDateTime(iso: string | null | undefined, timeZone: string) {
  if (!iso) return null

  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  try {
    const tz = sanitizeTimeZone(timeZone, 'UTC') || 'UTC'
    const p = getZonedParts(d, tz)

    const month = SHORT_MONTHS[p.month - 1]
    if (!month) return d.toISOString()

    const dayPeriod = p.hour < 12 ? 'AM' : 'PM'
    const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12
    const minute = String(p.minute).padStart(2, '0')

    return `${month} ${p.day}, ${p.year} at ${hour12}:${minute} ${dayPeriod}`
  } catch {
    return d.toISOString()
  }
}

export default function AftercareForm({
  bookingId,
  timeZone,
  rebookProfessionalId,
  rebookServiceId,
  rebookOfferingId,
  rebookLocationType,
  rebookLocationId,
  rebookClientAddressId,
  rebookClientProfileId,
  existingNotes,
  existingRebookedFor,
  existingRebookMode,
  existingRebookWindowStart,
  existingRebookWindowEnd,
  existingRebookDeclinedAt,
  suggestedRebookWindowStart,
  suggestedRebookWindowEnd,
  existingRebookSlot,
  existingMedia,
  existingFeaturedBeforeAssetId,
  existingFeaturedAfterAssetId,
  existingRecommendedProducts,
  existingDraftSavedAt,
  existingSentToClientAt,
  existingLastEditedAt,
  existingVersion,
  existingIsFinalized,
  readOnly = false,
}: Props) {
  const router = useRouter()

  const tz = useMemo(
    () => sanitizeTimeZone(timeZone, 'UTC') || 'UTC',
    [timeZone],
  )

  // Calendar anchors in the pro's timezone for date-only window bounds.
  const todayYmd = useMemo(() => todayYmdInTimeZone(tz), [tz])
  const tomorrowYmd = useMemo(
    () => addDaysToYmd(todayYmd, 1) ?? todayYmd,
    [todayYmd],
  )

  const [notes, setNotes] = useState((existingNotes || '').slice(0, NOTES_MAX))

  const [products, setProducts] = useState<RecommendedProduct[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)

  const [rebookMode, setRebookMode] = useState<RebookMode>('NONE')
  const [rebookSlot, setRebookSlot] = useState<SelectedRebookSlot | null>(null)
  const [windowStart, setWindowStart] = useState<string>('')
  const [windowEnd, setWindowEnd] = useState<string>('')

  // MOBILE bookings: which of the client's saved service addresses the next
  // appointment is at. Defaults to the address saved on the proposal, else the
  // source booking's. `mobileAddresses === null` means "not loaded yet".
  const [mobileAddresses, setMobileAddresses] = useState<
    | { id: string; label: string; formattedAddress: string; isDefault: boolean }[]
    | null
  >(null)
  const [mobileAddressesError, setMobileAddressesError] = useState<
    string | null
  >(null)
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    existingRebookSlot?.clientAddressId ?? rebookClientAddressId,
  )

  // Which window date field, if any, has the "open my calendar" popup showing.
  const [pickerTarget, setPickerTarget] = useState<
    'windowStart' | 'windowEnd' | null
  >(null)

  const [createRebookReminder, setCreateRebookReminder] = useState(false)
  const [rebookDaysBefore, setRebookDaysBefore] = useState('2')

  const [createProductReminder, setCreateProductReminder] = useState(false)
  const [productDaysAfter, setProductDaysAfter] = useState('7')

  // Pro-chosen featured before/after pair (null = client sees the earliest).
  const [featuredBeforeId, setFeaturedBeforeId] = useState<string | null>(
    existingFeaturedBeforeAssetId ?? null,
  )
  const [featuredAfterId, setFeaturedAfterId] = useState<string | null>(
    existingFeaturedAfterAssetId ?? null,
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Explicit server-backed state
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    existingDraftSavedAt ?? null,
  )
  const [sentToClientAt, setSentToClientAt] = useState<string | null>(
    existingSentToClientAt ?? null,
  )
  const [lastEditedAt, setLastEditedAt] = useState<string | null>(
    existingLastEditedAt ?? null,
  )
  const [version, setVersion] = useState<number | null>(existingVersion ?? null)

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const modeFromProps =
      existingRebookMode && isRebookMode(existingRebookMode)
        ? existingRebookMode
        : null

    // A previously-saved rebook selection: an explicit non-NONE mode, or any
    // saved window/booked date. (`existingRebookMode` arrives as 'NONE' for a
    // fresh wrap-up, so it alone doesn't count as a saved selection.)
    const hasSavedRebookSelection =
      (modeFromProps != null && modeFromProps !== 'NONE') ||
      Boolean(existingRebookWindowStart) ||
      Boolean(existingRebookWindowEnd) ||
      Boolean(existingRebookedFor)

    // The server sends a suggestion only for a fresh wrap-up; apply it to
    // pre-select a recommended window when nothing has been chosen yet.
    const applySuggestion =
      !hasSavedRebookSelection &&
      Boolean(suggestedRebookWindowStart) &&
      Boolean(suggestedRebookWindowEnd)

    const inferred: RebookMode = applySuggestion
      ? 'RECOMMENDED_WINDOW'
      : (modeFromProps ??
        (existingRebookWindowStart || existingRebookWindowEnd
          ? 'RECOMMENDED_WINDOW'
          : existingRebookedFor
            ? 'BOOKED_NEXT_APPOINTMENT'
            : 'NONE'))

    setRebookMode(inferred)

    setRebookSlot(
      existingRebookSlot && existingRebookSlot.offeringId
        ? {
            offeringId: existingRebookSlot.offeringId,
            locationId: existingRebookSlot.locationId,
            locationType: existingRebookSlot.locationType,
            clientAddressId: existingRebookSlot.clientAddressId ?? null,
            startsAt: existingRebookSlot.startsAt,
            endsAt: existingRebookSlot.endsAt,
          }
        : null,
    )
    setWindowStart(
      applySuggestion && suggestedRebookWindowStart
        ? isoToYmdInTimeZone(suggestedRebookWindowStart, tz)
        : existingRebookWindowStart
          ? isoToYmdInTimeZone(existingRebookWindowStart, tz)
          : '',
    )
    setWindowEnd(
      applySuggestion && suggestedRebookWindowEnd
        ? isoToYmdInTimeZone(suggestedRebookWindowEnd, tz)
        : existingRebookWindowEnd
          ? isoToYmdInTimeZone(existingRebookWindowEnd, tz)
          : '',
    )

    setCreateRebookReminder(Boolean(existingRebookedFor))

    setProducts(
      (existingRecommendedProducts || []).slice(0, MAX_PRODUCTS).map((p) => ({
        id: p.id || safeId(),
        name: p.name || '',
        url: p.url || '',
        note: p.note || '',
      })),
    )

    setDraftSavedAt(existingDraftSavedAt ?? null)
    setSentToClientAt(existingSentToClientAt ?? null)
    setLastEditedAt(existingLastEditedAt ?? null)
    setVersion(existingVersion ?? null)
  }, [
    existingRebookMode,
    existingRebookedFor,
    existingRebookWindowStart,
    existingRebookWindowEnd,
    suggestedRebookWindowStart,
    suggestedRebookWindowEnd,
    existingRebookSlot,
    existingRecommendedProducts,
    existingDraftSavedAt,
    existingSentToClientAt,
    existingLastEditedAt,
    existingVersion,
    tz,
  ])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  // MOBILE bookings: load the client's saved service addresses so the pro can
  // pick where the next appointment happens (the availability query and the
  // saved proposal both carry the pick). Salon bookings never need this.
  useEffect(() => {
    if (rebookLocationType !== 'MOBILE' || readOnly) return

    const controller = new AbortController()

    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/pro/clients/${encodeURIComponent(rebookClientProfileId)}/service-addresses`,
          { signal: controller.signal },
        )
        const data = await safeJson(res)
        if (!res.ok || !isRecord(data) || !Array.isArray(data.addresses)) {
          setMobileAddressesError('Could not load the client’s saved addresses.')
          setMobileAddresses([])
          return
        }

        const addresses = data.addresses.flatMap((raw) => {
          if (!isRecord(raw) || typeof raw.id !== 'string') return []
          return [
            {
              id: raw.id,
              label: typeof raw.label === 'string' ? raw.label : 'Service address',
              formattedAddress:
                typeof raw.formattedAddress === 'string'
                  ? raw.formattedAddress
                  : '',
              isDefault: raw.isDefault === true,
            },
          ]
        })

        setMobileAddresses(addresses)
        setMobileAddressesError(null)
        // Keep a valid selection: prefer what's already picked when it still
        // exists, else the client's default, else their first address.
        setSelectedAddressId((current) => {
          if (current && addresses.some((a) => a.id === current)) return current
          return (
            addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null
          )
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setMobileAddressesError('Could not load the client’s saved addresses.')
        setMobileAddresses([])
      }
    })()

    return () => controller.abort()
  }, [rebookLocationType, rebookClientProfileId, readOnly])

  function onPickMobileAddress(nextId: string) {
    markDirty()
    setSelectedAddressId(nextId || null)
    // The picked slot came from the previous address's availability — a
    // different destination means different travel windows, so re-pick.
    setRebookSlot((current) =>
      current && current.clientAddressId !== (nextId || null) ? null : current,
    )
  }

  function markDirty() {
    setError(null)
    setSuccess(null)
    setProductsError(null)
  }

  // Tap a before/after photo's "Feature" pill to make it the primary pair the
  // client sees; tap again to clear (client falls back to the earliest).
  function toggleFeaturedBefore(id: string) {
    markDirty()
    setFeaturedBeforeId((current) => (current === id ? null : id))
  }
  function toggleFeaturedAfter(id: string) {
    markDirty()
    setFeaturedAfterId((current) => (current === id ? null : id))
  }

  const sortedMedia = useMemo(() => {
    return [...(existingMedia || [])].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [existingMedia])

  const beforeMedia = useMemo(
    () => sortedMedia.filter((m) => m.phase === 'BEFORE'),
    [sortedMedia],
  )
  const afterMedia = useMemo(
    () => sortedMedia.filter((m) => m.phase === 'AFTER'),
    [sortedMedia],
  )
  const otherMedia = useMemo(
    () => sortedMedia.filter((m) => m.phase !== 'BEFORE' && m.phase !== 'AFTER'),
    [sortedMedia],
  )

  const hasBookedDate = Boolean(rebookSlot)
  const hasWindowStart = Boolean(windowStart.trim())
  const hasWindowEnd = Boolean(windowEnd.trim())

  const windowError =
    rebookMode === 'RECOMMENDED_WINDOW' && (hasWindowStart || hasWindowEnd)
      ? (() => {
          if (!hasWindowStart || !hasWindowEnd) {
            return 'Pick both a window start and end date.'
          }
          if (compareYmd(windowEnd, windowStart) <= 0) {
            return 'Window end must be after window start.'
          }
          return null
        })()
      : null

  useEffect(() => {
    if (rebookMode !== 'BOOKED_NEXT_APPOINTMENT' && createRebookReminder) {
      setCreateRebookReminder(false)
    }
  }, [rebookMode, createRebookReminder])

  useEffect(() => {
    if (
      rebookMode === 'BOOKED_NEXT_APPOINTMENT' &&
      !hasBookedDate &&
      createRebookReminder
    ) {
      setCreateRebookReminder(false)
    }
  }, [rebookMode, hasBookedDate, createRebookReminder])

  function onChangeMode(next: RebookMode) {
    setError(null)
    setProductsError(null)
    setRebookMode(next)
    markDirty()

    if (next === 'NONE') {
      setRebookSlot(null)
      setWindowStart('')
      setWindowEnd('')
      setCreateRebookReminder(false)
      return
    }

    if (next === 'BOOKED_NEXT_APPOINTMENT') {
      setWindowStart('')
      setWindowEnd('')
      return
    }

    if (next === 'RECOMMENDED_WINDOW') {
      setRebookSlot(null)
      setCreateRebookReminder(false)
    }
  }

  function onPickRebookSlot(slot: SelectedRebookSlot | null) {
    setRebookSlot(slot)
    markDirty()
  }

  // Setting/stepping the window start advances the end to a full suggested span
  // ahead whenever the current end is empty or would collapse to/before the new
  // start — so the auto-advanced window matches the fresh auto-suggested width
  // instead of a 1-day sliver (decided w/ Tori 2026-07-09). The hard floor stays
  // "end after start" (the end input `min` + client/server validators); only
  // this automatic advance lands on the span.
  function applyWindowStart(nextStart: string) {
    markDirty()
    setWindowStart(nextStart)
    setWindowEnd((prevEnd) => {
      const spannedEnd =
        addDaysToYmd(nextStart, SUGGESTED_REBOOK_WINDOW_SPAN_DAYS) ?? nextStart
      return !prevEnd || compareYmd(prevEnd, nextStart) <= 0 ? spannedEnd : prevEnd
    })
  }

  function applyWindowEnd(nextEnd: string) {
    markDirty()
    setWindowEnd(nextEnd)
  }

  function stepWindowStart(unit: StepUnit) {
    applyWindowStart(stepYmd(windowStart, unit, tomorrowYmd))
  }

  function stepWindowEnd(unit: StepUnit) {
    const fallback = addDaysToYmd(windowStart || tomorrowYmd, 1) ?? tomorrowYmd
    const stepped = stepYmd(windowEnd, unit, fallback)
    const minEnd = windowStart ? addDaysToYmd(windowStart, 1) : null
    applyWindowEnd(
      minEnd && compareYmd(stepped, minEnd) < 0 ? minEnd : stepped,
    )
  }

  // Calendar-popup pickers (return a "YYYY-MM-DD" day).
  function pickWindowEnd(ymd: string) {
    const minEnd = windowStart ? addDaysToYmd(windowStart, 1) : null
    applyWindowEnd(minEnd && compareYmd(ymd, minEnd) < 0 ? minEnd : ymd)
  }

  function addProduct() {
    if (products.length >= MAX_PRODUCTS) return
    setProductsError(null)
    markDirty()
    setProducts((p) => [...p, { id: safeId(), name: '', url: '', note: '' }])
  }

  function updateProduct(id: string, patch: Partial<RecommendedProduct>) {
    setProductsError(null)
    markDirty()
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
  }

  function removeProduct(id: string) {
    setProductsError(null)
    markDirty()
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  function validateProducts(list: RecommendedProduct[]) {
    for (const p of list) {
      const name = p.name.trim()
      const url = p.url.trim()
      const note = pickString(p.note).trim()

      if (!name && !url && !note) continue

      if (!name) return 'Each product needs a name.'
      if (name.length > PRODUCT_NAME_MAX) {
        return `Product name is too long (max ${PRODUCT_NAME_MAX}).`
      }
      if (!url) return 'Each product needs a link.'
      if (!isValidHttpUrl(url)) {
        return 'Product links must be valid http/https URLs.'
      }
      if (note.length > PRODUCT_NOTE_MAX) {
        return `Product note is too long (max ${PRODUCT_NOTE_MAX}).`
      }
    }
    return null
  }

  function buildPayload(sendToClient: boolean) {
    // The booked next appointment is now driven by a real picked slot; its
    // startsAt is the canonical rebookedFor.
    const rebookISO =
      rebookMode === 'BOOKED_NEXT_APPOINTMENT' ? rebookSlot?.startsAt ?? null : null
    const windowStartISO = ymdToIsoStartOfDay(windowStart, tz)
    const windowEndISO = ymdToIsoEndOfDay(windowEnd, tz)

    const daysBeforeRaw = parseInt(rebookDaysBefore, 10)
    const daysAfterRaw = parseInt(productDaysAfter, 10)

    const sanitizedProducts = products
      .map((p) => {
        const name = p.name.trim().slice(0, PRODUCT_NAME_MAX)
        const url = p.url.trim()
        const note = pickString(p.note).trim().slice(0, PRODUCT_NOTE_MAX) || null

        return {
          name,
          url,
          note,
        }
      })
      .filter((p) => {
        const hasName = p.name.length > 0
        const hasValidUrl = isValidHttpUrl(p.url)

        if (sendToClient) {
          return p.name || p.url || p.note
        }

        return hasName && hasValidUrl
      })
      .map((p) => ({
        productId: null,
        externalName: p.name,
        externalUrl: p.url,
        note: p.note,
      }))

    // Only send a featured id that still maps to a current before/after photo,
    // so a stale selection (e.g. a since-deleted photo) clears instead of
    // tripping the server's ownership/phase validation.
    const validFeaturedBefore =
      featuredBeforeId && beforeMedia.some((m) => m.id === featuredBeforeId)
        ? featuredBeforeId
        : null
    const validFeaturedAfter =
      featuredAfterId && afterMedia.some((m) => m.id === featuredAfterId)
        ? featuredAfterId
        : null

    return {
      notes: notes.trim().slice(0, NOTES_MAX) || '',
      recommendedProducts: sanitizedProducts,
      featuredBeforeAssetId: validFeaturedBefore,
      featuredAfterAssetId: validFeaturedAfter,
      rebookMode,
      rebookedFor: rebookISO,
      rebookSlot:
        rebookMode === 'BOOKED_NEXT_APPOINTMENT' && rebookSlot
          ? {
              offeringId: rebookSlot.offeringId,
              locationId: rebookSlot.locationId,
              locationType: rebookSlot.locationType,
              clientAddressId: rebookSlot.clientAddressId,
              startsAt: rebookSlot.startsAt,
              endsAt: rebookSlot.endsAt,
            }
          : null,
      rebookWindowStart:
        rebookMode === 'RECOMMENDED_WINDOW' ? windowStartISO : null,
      rebookWindowEnd:
        rebookMode === 'RECOMMENDED_WINDOW' ? windowEndISO : null,
      createRebookReminder:
        rebookMode === 'BOOKED_NEXT_APPOINTMENT' && !!rebookISO
          ? createRebookReminder
          : false,
      rebookReminderDaysBefore: clampInt(daysBeforeRaw, 1, 30, 2),
      createProductReminder,
      productReminderDaysAfter: clampInt(daysAfterRaw, 1, 180, 7),
      sendToClient,
      timeZone: tz,
      version: version ?? existingVersion ?? null,
    }
  }

  function validateBeforePost(sendToClient: boolean) {
    if (!bookingId) return 'Missing booking id.'

    const windowStartISO = ymdToIsoStartOfDay(windowStart, tz)
    const windowEndISO = ymdToIsoEndOfDay(windowEnd, tz)
    const now = Date.now()

    if (rebookMode === 'BOOKED_NEXT_APPOINTMENT') {
      if (!rebookOfferingId) {
        return 'This booking has no service offering set, so an exact next appointment can’t be proposed. Use “Booking window” instead.'
      }

      if (
        rebookLocationType === 'MOBILE' &&
        !selectedAddressId &&
        !rebookClientAddressId
      ) {
        return 'This client has no saved service address, so a mobile next appointment can’t be proposed. Use “Booking window” instead.'
      }

      if (!rebookSlot) {
        return 'Pick an available next-appointment time, or change rebook mode to “None”.'
      }

      const rebookDate = new Date(rebookSlot.startsAt)
      if (
        Number.isNaN(rebookDate.getTime()) ||
        rebookDate.getTime() <= now
      ) {
        return 'The next appointment must be in the future.'
      }
    }

    if (rebookMode === 'RECOMMENDED_WINDOW') {
      if (!windowStart.trim() || !windowEnd.trim()) {
        return 'Pick both a start and end date for the recommended booking window.'
      }

      if (!windowStartISO || !windowEndISO) {
        return 'Window dates are invalid.'
      }

      // Date-only window: the start must be a future calendar day (today's
      // start-of-day is already in the past), and the end must be after it.
      if (compareYmd(windowStart, todayYmd) <= 0) {
        return 'Recommended booking window must start in the future.'
      }

      if (compareYmd(windowEnd, windowStart) <= 0) {
        return 'Window end must be after window start.'
      }
    }

    const prodErr = validateProducts(products)

    if (prodErr && sendToClient) {
      setProductsError(prodErr)
      return 'Fix product links/names before continuing.'
    }

    if (prodErr && !sendToClient) {
      setProductsError(
        'Incomplete products will not be saved until they have both a name and link.',
      )
    }

    return null
  }

  function dispatchForceRefresh() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new Event(FORCE_EVENT))
  }

  async function postAftercare(sendToClient: boolean) {
    setError(null)
    setSuccess(null)
    setProductsError(null)

    const validationError = validateBeforePost(sendToClient)
    if (validationError) {
      setError(validationError)
      return
    }

    if (loading) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)

    try {
      const payload = buildPayload(sendToClient)
      // nonce: the payload itself. Aftercare is saved iteratively (edit ->
      // Save draft -> edit -> Save draft), and `version` bumps after every
      // save, so two sequential saves in the same 60s bucket carry different
      // bodies. Without a nonce they share a key and the server rejects the
      // second with a 409 body-hash conflict. Keying on the payload lets a
      // genuinely different save through while a true double-click (identical
      // payload, same version) still dedupes.
      const idempotencyKey = buildClientIdempotencyKey({
        scope: 'booking-aftercare',
        entityId: bookingId,
        action: sendToClient ? 'send' : 'draft',
        nonce: JSON.stringify(payload),
      })
      const res = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(idempotencyKey),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      )

      if (res.status === 401) {
        redirectToLogin(router, 'aftercare')
        return
      }

      const data = await safeJson(res)
      if (!res.ok) {
        const nextError = errorFromResponse(res, data)
        setError(nextError)

        if (nextError.toLowerCase().includes('out of date')) {
          router.refresh()
          dispatchForceRefresh()
        }

        return
      }

      const r = isRecord(data) ? data : null
      const aftercare = isRecord(r?.aftercare) ? r.aftercare : null

      const clientNotified = r?.clientNotified === true

      setDraftSavedAt(
        typeof aftercare?.draftSavedAt === 'string'
          ? aftercare.draftSavedAt
          : null,
      )

      setSentToClientAt(
        typeof aftercare?.sentToClientAt === 'string'
          ? aftercare.sentToClientAt
          : null,
      )

      setLastEditedAt(
        typeof aftercare?.lastEditedAt === 'string'
          ? aftercare.lastEditedAt
          : null,
      )

      setVersion(
        typeof aftercare?.version === 'number' ? aftercare.version : null,
      )

    // Don't router.refresh() here: this page is force-dynamic, so a refresh
    // re-runs the whole server component and re-signs + reloads every before/
    // after image on every draft save. The save's own response already updated
    // draft/sent/version state above, and the session footer refreshes via the
    // force event below — nothing server-rendered on this page changed.
    dispatchForceRefresh()

    if (sendToClient) {
      // Sending aftercare proceeds to the wrap-up screen, where the "sent"
      // status plus payment/checkout closeout live. Any remaining closeout
      // items show there as to-dos; a fully-closed booking lands on the hub's
      // done state.
      setSuccess(
        clientNotified
          ? 'Aftercare sent to client.'
          : 'Aftercare saved and marked sent, but client delivery was not queued.',
      )
      router.push(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
      return
    }

    setSuccess('Aftercare draft saved.')
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error(err)
      setError('Network error posting aftercare.')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  const showBooked = rebookMode === 'BOOKED_NEXT_APPOINTMENT'
  const showWindow = rebookMode === 'RECOMMENDED_WINDOW'
  const disabled = loading || readOnly

  const finalized = Boolean(sentToClientAt || existingIsFinalized)
  const draftExists = Boolean(draftSavedAt) && !finalized

  const lastEditedLabel = toDisplayDateTime(lastEditedAt, tz)
  const draftSavedLabel = toDisplayDateTime(draftSavedAt, tz)
  const sentLabel = toDisplayDateTime(sentToClientAt, tz)

  return (
    <div className="grid gap-3">
      <div className="rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-xs font-black text-accentPrimary">
          Client-facing
        </div>
        <div className="mt-1 text-sm font-semibold text-textSecondary">
          This is the client’s official booking summary. Drafts are not
          completed closeout. Only sending finalizes aftercare.
        </div>

        <div className="mt-3 grid gap-2 text-sm">
          <div className="text-textSecondary">
            Status:{' '}
            <span className="font-black text-textPrimary">
              {finalized
                ? '✅ finalized + sent'
                : draftExists
                  ? '📝 draft saved'
                  : '❌ not started'}
            </span>
          </div>

          {version != null ? (
            <div className="text-textSecondary">
              Version:{' '}
              <span className="font-black text-textPrimary">{version}</span>
            </div>
          ) : null}

          {lastEditedLabel ? (
            <div className="text-textSecondary">
              Last edited:{' '}
              <span className="font-black text-textPrimary">
                {lastEditedLabel}
              </span>
            </div>
          ) : null}

          {draftSavedLabel && !finalized ? (
            <div className="text-textSecondary">
              Draft saved:{' '}
              <span className="font-black text-textPrimary">
                {draftSavedLabel}
              </span>
            </div>
          ) : null}

          {sentLabel ? (
            <div className="text-textSecondary">
              Sent to client:{' '}
              <span className="font-black text-textPrimary">{sentLabel}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/*
        Desktop reflows into two columns (see .brand-aftercare-columns); on
        mobile/tablet the columns linearize in DOM order back to a single
        stack. Left = the visual record + the instructions written from it.
        Right = the repeat-visit drivers (rebook, products, reminders). The
        Save/Send actions stay full-width below both columns.
      */}
      <div className="brand-aftercare-columns">
        <div className="brand-aftercare-col">
          <div className={cardClass()}>
            <div className={sectionTitleClass()}>Photos</div>
            <div className={subtleTextClass()}>
              Visible to you + the client (PRO_CLIENT). Not public. Tap
              “Feature” on a before and an after photo to set the pair the client
              sees first — the rest show as thumbnails. Leave both unset to
              feature the earliest of each.
            </div>

            <div className="mt-3 grid gap-4">
              <div>
                <div className="text-sm font-black text-textPrimary">
                  Before
                </div>
                <div className={subtleTextClass()}>
                  Before photos/videos from this booking.
                </div>
                <MediaGrid
                  items={beforeMedia}
                  feature={{
                    label: 'before',
                    selectedId: featuredBeforeId,
                    onToggle: toggleFeaturedBefore,
                    disabled: readOnly,
                  }}
                />
              </div>

              <div>
                <div className="text-sm font-black text-textPrimary">After</div>
                <div className={subtleTextClass()}>
                  After photos/videos from this booking.
                </div>
                <MediaGrid
                  items={afterMedia}
                  feature={{
                    label: 'after',
                    selectedId: featuredAfterId,
                    onToggle: toggleFeaturedAfter,
                    disabled: readOnly,
                  }}
                />
              </div>

              {otherMedia.length ? (
                <div>
                  <div className="text-sm font-black text-textPrimary">
                    Other
                  </div>
                  <div className={subtleTextClass()}>
                    Extra photos/videos attached to this booking.
                  </div>
                  <MediaGrid items={otherMedia} />
                </div>
              ) : null}
            </div>
          </div>

          <div className={cardClass()}>
            <div className={sectionTitleClass()}>Aftercare instructions</div>
            <div className={subtleTextClass()}>
              Write this like doctor instructions: clear, specific, and
              actionable.
            </div>

            <div className="mt-3">
              <label className={labelClass()} htmlFor="notes">
                Notes
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value.slice(0, NOTES_MAX))
                  markDirty()
                }}
                rows={5}
                disabled={disabled}
                placeholder="E.g. wash after 48 hours, use sulfate-free shampoo, avoid tight ponytails for 7 days…"
                className={[
                  'w-full resize-y rounded-card border border-white/10 bg-bgPrimary px-3 py-2 text-sm text-textPrimary outline-none',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'focus:border-white/20',
                ].join(' ')}
              />
              <div className="mt-1 text-xs font-semibold text-textSecondary">
                {notes.length}/{NOTES_MAX}
              </div>
            </div>
          </div>
        </div>

        <div className="brand-aftercare-col">
          <div className={cardClass()}>
            <div className={sectionTitleClass()}>Rebook</div>
            <div className={subtleTextClass()}>
              The single biggest driver of repeat visits — propose the exact
              next appointment, or a booking window, before the client leaves.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onChangeMode('NONE')}
                disabled={disabled}
                className={pillClass(rebookMode === 'NONE')}
              >
                None
              </button>

              <button
                type="button"
                onClick={() => onChangeMode('BOOKED_NEXT_APPOINTMENT')}
                disabled={disabled}
                className={pillClass(
                  rebookMode === 'BOOKED_NEXT_APPOINTMENT',
                )}
                title="Recommend a single ideal next booking date"
              >
                Next booking date
              </button>

              <button
                type="button"
                onClick={() => onChangeMode('RECOMMENDED_WINDOW')}
                disabled={disabled}
                className={pillClass(rebookMode === 'RECOMMENDED_WINDOW')}
                title="Recommend a date range the client should book within"
              >
                Booking window
              </button>
            </div>

            {showBooked ? (
              <div className="mt-4">
                {existingRebookDeclinedAt ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className="brand-pro-session-pill"
                      data-tone="danger"
                    >
                      Client declined
                    </span>
                    <span className="text-xs font-semibold text-textSecondary">
                      They declined the time you proposed. Pick a new time and
                      re-send to offer another.
                    </span>
                  </div>
                ) : null}

                {rebookLocationType === 'MOBILE' ? (
                  <div className="mb-3">
                    <label className={labelClass()}>Service address</label>
                    {mobileAddresses && mobileAddresses.length === 0 ? (
                      rebookClientAddressId ? (
                        <div className="mt-1 text-xs font-semibold text-textSecondary">
                          Using the address from this appointment — the client
                          has no other saved service addresses.
                        </div>
                      ) : (
                        <div className="mt-2 rounded-card border border-toneWarn/30 bg-bgPrimary p-3 text-xs font-semibold text-textSecondary">
                          This client has no saved service address, so a mobile
                          next appointment can’t be proposed. Use “Booking
                          window” instead.
                        </div>
                      )
                    ) : (
                      <select
                        value={selectedAddressId ?? ''}
                        disabled={disabled || mobileAddresses === null}
                        onChange={(e) => onPickMobileAddress(e.target.value)}
                        className={inputClass(Boolean(disabled))}
                        aria-label="Service address for the next appointment"
                      >
                        {mobileAddresses === null ? (
                          <option value="">Loading addresses…</option>
                        ) : (
                          mobileAddresses.map((address) => (
                            <option key={address.id} value={address.id}>
                              {address.label}
                              {address.formattedAddress
                                ? ` — ${address.formattedAddress}`
                                : ''}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                    {mobileAddressesError ? (
                      <div className="mt-1 text-xs font-semibold text-textSecondary">
                        {mobileAddressesError} Open times use the appointment’s
                        original address.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {rebookLocationType === 'MOBILE' &&
                mobileAddresses?.length === 0 &&
                !rebookClientAddressId ? null : (
                  <>
                    <label className={labelClass()}>Next appointment time</label>
                    <RebookSlotPicker
                      professionalId={rebookProfessionalId}
                      serviceId={rebookServiceId}
                      offeringId={rebookOfferingId}
                      locationType={rebookLocationType}
                      locationId={rebookLocationId}
                      clientAddressId={
                        selectedAddressId ?? rebookClientAddressId
                      }
                      timeZone={tz}
                      minYmd={tomorrowYmd}
                      value={rebookSlot}
                      disabled={disabled}
                      onChange={onPickRebookSlot}
                    />
                  </>
                )}
                <div className="mt-2 text-xs font-semibold text-textSecondary">
                  Pick a real open time from your schedule. It shows on the
                  client’s summary and can power a reminder.
                </div>
              </div>
            ) : null}

            {showWindow ? (
              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass()}>Window start</label>
                    <input
                      type="date"
                      value={windowStart}
                      min={tomorrowYmd}
                      disabled={disabled}
                      onChange={(e) => applyWindowStart(e.target.value)}
                      className={inputClass(Boolean(disabled))}
                    />
                    <StepButtons
                      disabled={disabled}
                      onStep={stepWindowStart}
                      onOpenCalendar={() => setPickerTarget('windowStart')}
                    />
                  </div>

                  <div>
                    <label className={labelClass()}>Window end</label>
                    <input
                      type="date"
                      value={windowEnd}
                      min={
                        windowStart
                          ? addDaysToYmd(windowStart, 1) ?? tomorrowYmd
                          : tomorrowYmd
                      }
                      disabled={disabled}
                      onChange={(e) => applyWindowEnd(e.target.value)}
                      className={inputClass(Boolean(disabled))}
                    />
                    <StepButtons
                      disabled={disabled}
                      onStep={stepWindowEnd}
                      onOpenCalendar={() => setPickerTarget('windowEnd')}
                    />
                  </div>
                </div>

                {windowError ? (
                  <div className="text-sm font-semibold text-microAccent">
                    {windowError}
                  </div>
                ) : (
                  <div className="text-xs font-semibold text-textSecondary">
                    Just dates — the client books an available time within this
                    range from your schedule.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className={cardClass()}>
            <div className={sectionTitleClass()}>Recommended products</div>
            <div className={subtleTextClass()}>
              Add products with links (Amazon storefront, pro shop, etc.). Links
              must be http/https.
            </div>

            <div className="mt-3 grid gap-3">
              {products.length === 0 ? (
                <div className="text-sm font-semibold text-textSecondary">
                  No products added yet.
                </div>
              ) : (
                products.map((p, idx) => (
                  <div
                    key={p.id}
                    className="rounded-card border border-white/10 bg-bgPrimary p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black text-textPrimary">
                        Product {idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeProduct(p.id)}
                        disabled={disabled}
                        className={secondaryBtn(Boolean(disabled))}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3">
                      <div>
                        <label className={labelClass()}>Product name</label>
                        <input
                          value={p.name}
                          disabled={disabled}
                          maxLength={PRODUCT_NAME_MAX}
                          onChange={(e) =>
                            updateProduct(p.id, { name: e.target.value })
                          }
                          placeholder="e.g. Sulfate-free shampoo"
                          className={inputClass(Boolean(disabled))}
                        />
                      </div>

                      <div>
                        <label className={labelClass()}>Product link</label>
                        <input
                          value={p.url}
                          disabled={disabled}
                          onChange={(e) =>
                            updateProduct(p.id, { url: e.target.value })
                          }
                          placeholder="https://amazon.com/…"
                          className={inputClass(Boolean(disabled))}
                        />
                        {p.url.trim() && !isValidHttpUrl(p.url) ? (
                          <div className="mt-1 text-xs font-semibold text-microAccent">
                            Link must be a valid http/https URL.
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <label className={labelClass()}>Note (optional)</label>
                        <input
                          value={pickString(p.note)}
                          disabled={disabled}
                          maxLength={PRODUCT_NOTE_MAX}
                          onChange={(e) =>
                            updateProduct(p.id, { note: e.target.value })
                          }
                          placeholder="e.g. Use 2–3x/week to maintain shine"
                          className={inputClass(Boolean(disabled))}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}

              <button
                type="button"
                onClick={addProduct}
                disabled={disabled || products.length >= MAX_PRODUCTS}
                className={secondaryBtn(
                  Boolean(disabled || products.length >= MAX_PRODUCTS),
                )}
              >
                + Add product
              </button>

              {productsError ? (
                <div className="text-sm font-semibold text-microAccent">
                  {productsError}
                </div>
              ) : null}
            </div>
          </div>

          <div className={cardClass()}>
            <div className={sectionTitleClass()}>Smart reminders</div>
            <div className={subtleTextClass()}>
              Nudge Future You to check in at the right time.
            </div>

            <label
              className={[
                'mt-3 flex items-center gap-2 text-sm font-semibold',
                rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                  ? 'text-textPrimary'
                  : 'text-textSecondary opacity-60',
              ].join(' ')}
              title={
                rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                  ? undefined
                  : 'Rebook reminders only apply to a single recommended date (not window mode).'
              }
            >
              <input
                type="checkbox"
                checked={createRebookReminder}
                disabled={
                  !(rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate) ||
                  disabled
                }
                onChange={(e) => {
                  setCreateRebookReminder(e.target.checked)
                  markDirty()
                }}
              />
              <span>
                Create a rebook reminder{' '}
                <select
                  value={rebookDaysBefore}
                  disabled={
                    !(
                      rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                    ) || disabled
                  }
                  onChange={(e) => {
                    setRebookDaysBefore(e.target.value)
                    markDirty()
                  }}
                  className={[
                    'mx-1 rounded-full border border-white/10 bg-bgPrimary px-2 py-1 text-xs font-black text-textPrimary',
                    !(
                      rebookMode === 'BOOKED_NEXT_APPOINTMENT' && hasBookedDate
                    ) || disabled
                      ? 'cursor-not-allowed opacity-60'
                      : '',
                  ].join(' ')}
                >
                  <option value="1">1 day</option>
                  <option value="2">2 days</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                </select>
                before the recommended date.
              </span>
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-textPrimary">
              <input
                type="checkbox"
                checked={createProductReminder}
                disabled={disabled}
                onChange={(e) => {
                  setCreateProductReminder(e.target.checked)
                  markDirty()
                }}
              />
              <span>
                Create a product follow-up{' '}
                <select
                  value={productDaysAfter}
                  disabled={disabled}
                  onChange={(e) => {
                    setProductDaysAfter(e.target.value)
                    markDirty()
                  }}
                  className={[
                    'mx-1 rounded-full border border-white/10 bg-bgPrimary px-2 py-1 text-xs font-black text-textPrimary',
                    disabled ? 'cursor-not-allowed opacity-60' : '',
                  ].join(' ')}
                >
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
                after the booking.
              </span>
            </label>

            <div className="mt-2 text-xs font-semibold text-textSecondary">
              These go into your Reminders tab so Future You remembers to check
              in.
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="text-sm font-semibold text-microAccent">{error}</div>
      ) : null}

      {success ? (
        <div className="text-sm font-semibold text-textPrimary">{success}</div>
      ) : null}

      {readOnly ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={disabled || !!windowError}
            onClick={() => postAftercare(false)}
            className={secondaryBtn(Boolean(disabled || !!windowError))}
          >
            {loading ? 'Saving…' : 'Save draft'}
          </button>

          <button
            type="button"
            disabled={disabled || !!windowError}
            onClick={() => postAftercare(true)}
            className={primaryBtn(Boolean(disabled || !!windowError))}
          >
            {loading
              ? 'Sending…'
              : finalized
                ? 'Send update to client'
                : 'Send to client'}
          </button>
        </div>
      )}

      {pickerTarget ? (
        <AvailabilityCalendarPopup
          open
          tz={tz}
          title={
            pickerTarget === 'windowStart'
              ? 'Pick a window start date'
              : 'Pick a window end date'
          }
          minYmd={
            pickerTarget === 'windowStart'
              ? tomorrowYmd
              : windowStart
                ? addDaysToYmd(windowStart, 1) ?? tomorrowYmd
                : tomorrowYmd
          }
          anchorYmd={
            pickerTarget === 'windowStart'
              ? windowStart || undefined
              : windowEnd || windowStart || undefined
          }
          onClose={() => setPickerTarget(null)}
          onPick={(ymd) => {
            if (pickerTarget === 'windowStart') applyWindowStart(ymd)
            else pickWindowEnd(ymd)
          }}
        />
      ) : null}
    </div>
  )
}

const STEP_UNITS: { unit: StepUnit; label: string }[] = [
  { unit: 'day', label: '+1 day' },
  { unit: 'week', label: '+1 week' },
  { unit: 'month', label: '+1 month' },
]

function StepButtons({
  disabled,
  onStep,
  onOpenCalendar,
}: {
  disabled: boolean
  onStep: (unit: StepUnit) => void
  onOpenCalendar?: () => void
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {onOpenCalendar ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenCalendar}
          className={secondaryBtn(Boolean(disabled))}
        >
          📅 My calendar
        </button>
      ) : null}
      {STEP_UNITS.map(({ unit, label }) => (
        <button
          key={unit}
          type="button"
          disabled={disabled}
          onClick={() => onStep(unit)}
          className={secondaryBtn(Boolean(disabled))}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function MediaGrid({
  items,
  feature,
}: {
  items: MediaItem[]
  // When provided (before/after grids), image tiles get a "Feature" pill that
  // marks this photo as the primary half of the client's before/after pair.
  feature?: {
    label: 'before' | 'after'
    selectedId: string | null
    onToggle: (id: string) => void
    disabled?: boolean
  }
}) {
  if (!items || items.length === 0) {
    return (
      <div className="mt-2 text-sm font-semibold text-textSecondary">
        None yet.
      </div>
    )
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {items.map((m) => {
        const isVideo = m.mediaType === 'VIDEO'
        const isProClient = m.visibility === 'PRO_CLIENT'
        // The reveal comparison is image-only, so only images are featurable.
        const canFeature = Boolean(feature) && !isVideo
        const isFeatured = feature?.selectedId === m.id

        // Enlarge opens the shared in-place fullscreen viewer (local state, no
        // navigation), so closing just dismisses the overlay instead of
        // re-running this force-dynamic page and reloading every image.
        // ClickableMedia falls back full→thumb, so a thumb-only "before" asset
        // is still openable (previously it rendered as a dead, non-clickable
        // tile while "after" opened fine). The Feature pill sits OUTSIDE the
        // ClickableMedia button (a nested <button> is invalid), so tapping it
        // toggles the selection without opening the viewer.
        return (
          <div key={m.id} className="relative">
            <ClickableMedia
              thumbSrc={m.renderThumbUrl}
              fullSrc={m.renderUrl}
              mediaType={m.mediaType}
              alt="Booking media"
              hidePlayBadge
              className={[
                'aspect-square rounded-card bg-bgPrimary transition',
                isFeatured
                  ? 'border-2 border-accentPrimary'
                  : isProClient
                    ? 'border border-white/10'
                    : 'border border-transparent',
                'hover:bg-surfaceGlass',
              ].join(' ')}
            >
              {isVideo ? (
                <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                  VIDEO
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                {isProClient ? 'PRO + CLIENT' : 'PUBLIC'}
              </div>
            </ClickableMedia>

            {canFeature ? (
              <button
                type="button"
                disabled={feature?.disabled}
                aria-pressed={isFeatured}
                aria-label={
                  isFeatured
                    ? `Remove this ${feature?.label} photo as featured`
                    : `Feature this ${feature?.label} photo`
                }
                onClick={() => feature?.onToggle(m.id)}
                className={[
                  'absolute right-1 top-1 z-10 rounded-full px-2 py-1 text-[10px] font-black transition',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  isFeatured
                    ? 'bg-accentPrimary text-bgPrimary'
                    : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                ].join(' ')}
              >
                {isFeatured ? '★ Featured' : 'Feature'}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}