// app/booking/[id]/page.tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import {
  BellRing,
  CalendarPlus,
  Check,
  Clock,
  MessageCircle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import ProProfileLink from '@/app/_components/ProProfileLink'
import { prisma } from '@/lib/prisma'
import { COPY } from '@/lib/copy'
import { getCurrentUser } from '@/lib/currentUser'
import { formatRoundedDollars, moneyToString } from '@/lib/money'
import { mapsHrefFromLocation } from '@/lib/maps'
import { messageStartHref } from '@/lib/messages'
import { formatConsultProposalStartingPrice } from '@/lib/looks/startingPrice'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { DEFAULT_TIME_ZONE, pickTimeZoneOrNull } from '@/lib/timeZone'
import { formatInTimeZone } from '@/lib/time'
import { labelForBookingStatus } from '@/lib/booking/statusLabel'
import { resolveBookingLocationMeta } from '@/lib/booking/locationMeta'

export const dynamic = 'force-dynamic'

/** One icon per "what happens next" step, in the order COPY lists them. */
const NEXT_STEP_ICONS: readonly LucideIcon[] = [Clock, BellRing, ShieldCheck]

type PageProps = {
  params: { id: string } | Promise<{ id: string }>
}

const bookingReceiptProfessionalSelect = {
  id: true,
  ...professionalPublicDisplayNameSelect,
  timeZone: true,
  location: true,
} satisfies Prisma.ProfessionalProfileSelect

const bookingReceiptSelect = {
  id: true,
  clientId: true,
  professionalId: true,
  offeringId: true,

  scheduledFor: true,
  status: true,
  source: true,
  locationType: true,

  subtotalSnapshot: true,
  totalDurationMinutes: true,

  clientVisibleOverrideNote: true,

  locationTimeZone: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,

  // MOBILE bookings happen at the CLIENT's address, not the pro's — see
  // resolveBookedPlace.
  clientAddressSnapshot: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,

  location: {
    select: {
      id: true,
      name: true,
      formattedAddress: true,
      city: true,
      state: true,
      placeId: true,
      lat: true,
      lng: true,
      timeZone: true,
    },
  },

  service: {
    select: {
      id: true,
      name: true,
      defaultDurationMinutes: true,
      category: { select: { name: true } },
    },
  },

  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      serviceId: true,
      offeringId: true,
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      sortOrder: true,
      notes: true,
      service: { select: { name: true } },
    },
  },

  professional: {
    select: bookingReceiptProfessionalSelect,
  },

  // Book the Look, B4b — present only when this booking came from a
  // consultation's proposal. It is the record of what the client was actually
  // shown and agreed to: the base service item below covers only the FLOOR
  // offering the booking was finalized through, so without these lines the
  // receipt would understate the appointment by every beyond-floor line.
  consultBookingProposal: {
    select: {
      totalDurationMinutes: true,
      startingAtPrice: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          serviceName: true,
          price: true,
          durationMinutes: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type BookingReceiptRow = Prisma.BookingGetPayload<{
  select: typeof bookingReceiptSelect
}>

type ServiceItemRow = BookingReceiptRow['serviceItems'][number]

function fmtInTimeZone(dateUtc: Date, timeZone: string) {
  // No year: this is a confirmation for a booking days away, and the year pushed
  // the value onto a second line at 390px. No IANA id either — "America/
  // Los_Angeles" is a database key, not something a client reads. The short zone
  // name below carries the only part that matters when they're travelling.
  return formatInTimeZone(dateUtc, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "PDT" / "EST" — the human half of the timezone, for the muted second line. */
function fmtZoneAbbreviation(dateUtc: Date, timeZone: string) {
  const formatted = formatInTimeZone(dateUtc, timeZone, {
    hour: 'numeric',
    timeZoneName: 'short',
  })

  // "2 PM PDT" → "PDT". Falls back to the IANA id only if that shape changes.
  const parts = formatted.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : timeZone
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function friendlyLocationType(v: unknown) {
  const s = upper(v)
  if (s === 'SALON') return 'In salon'
  if (s === 'MOBILE') return 'Mobile'
  return null
}

function friendlySource(v: unknown) {
  const s = upper(v)
  if (s === 'DISCOVERY') return 'Found in Looks'
  if (s === 'REQUESTED') return 'Requested booking'
  if (s === 'AFTERCARE') return 'Rebooked from aftercare'
  return null
}

function friendlyStatus(v: unknown) {
  const s = upper(v)
  if (!s) return 'Unknown'
  // This page's own map had no IN_PROGRESS or NO_SHOW arm and fell through to
  // `return s`, printing the DB enum on a page a client can open from a link
  // (B10). PENDING keeps the longer wording — this is a confirmation page and
  // the extra clause is the whole point of it.
  if (s === 'PENDING') return 'Requested (waiting for confirmation)'
  if (s === 'WAITLIST') return 'Waitlist'
  return labelForBookingStatus(s)
}

function isAddOnItem(item: Pick<ServiceItemRow, 'notes' | 'sortOrder'>) {
  const note = (item.notes || '').trim().toUpperCase()
  if (note.startsWith('ADDON:')) return true
  return (item.sortOrder ?? 0) >= 100
}

function sumDecimal(values: Prisma.Decimal[]) {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0))
}

function decimalToNumber(v: unknown): number | null {
  if (v == null) return null

  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }

  if (typeof v === 'string') {
    const parsed = Number(v)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (typeof v === 'object' && v !== null) {
    const maybeToNumber = (v as { toNumber?: unknown }).toNumber
    if (typeof maybeToNumber === 'function') {
      const parsed = maybeToNumber.call(v) as number
      return Number.isFinite(parsed) ? parsed : null
    }

    const maybeToString = (v as { toString?: unknown }).toString
    if (typeof maybeToString === 'function') {
      const parsed = Number(String(maybeToString.call(v)))
      return Number.isFinite(parsed) ? parsed : null
    }
  }

  return null
}

function resolveReceiptTimeZone(args: {
  bookingLocationTimeZone: string | null
  bookedLocationTimeZone: string | null | undefined
  proTimeZone: string | null | undefined
}) {
  const bookingTz = pickTimeZoneOrNull(args.bookingLocationTimeZone)
  if (bookingTz) return bookingTz

  const locationTz = pickTimeZoneOrNull(args.bookedLocationTimeZone)
  if (locationTz) return locationTz

  const proTz = pickTimeZoneOrNull(args.proTimeZone)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
}

/**
 * The place this booking actually happens, and a maps link to it.
 *
 * This page used to hand-roll the resolution and only ever read the SALON
 * snapshot, so a MOBILE booking — which happens at the CLIENT's address —
 * rendered no location at all, and would have shown the *pro's* address had
 * that pro carried a `location` string. `resolveBookingLocationMeta` is the
 * shared helper the pro bookings list and detail already use; it picks the
 * client-address snapshot for MOBILE and the pro-location snapshot for SALON.
 *
 * The salon-only fallbacks (booked location's own address / name / city+state,
 * then the pro's location text) stay, because a SALON booking predating the
 * snapshot still has them. They are deliberately NOT applied to MOBILE: every
 * one of them describes the pro's premises, which is the wrong place.
 */
function resolveBookedPlace(booking: BookingReceiptRow): {
  label: string | null
  mapsHref: string | null
} {
  const meta = resolveBookingLocationMeta({
    locationType: booking.locationType,
    locationAddressSnapshot: booking.locationAddressSnapshot,
    locationLatSnapshot: decimalToNumber(booking.locationLatSnapshot),
    locationLngSnapshot: decimalToNumber(booking.locationLngSnapshot),
    clientAddressSnapshot: booking.clientAddressSnapshot,
    clientAddressLatSnapshot: decimalToNumber(booking.clientAddressLatSnapshot),
    clientAddressLngSnapshot: decimalToNumber(booking.clientAddressLngSnapshot),
  })

  const bookedLocation = meta.isMobile ? null : booking.location

  const label =
    meta.formattedAddress ??
    bookedLocation?.formattedAddress?.trim() ??
    bookedLocation?.name?.trim() ??
    ([bookedLocation?.city, bookedLocation?.state].filter(Boolean).join(', ') || null) ??
    (meta.isMobile ? null : booking.professional?.location?.trim() ?? null)

  // Coordinates beat a place id: the snapshot is what was booked, the pro's
  // ProfessionalLocation may have moved since.
  const hasSnapshotTruth = Boolean(meta.formattedAddress) || meta.lat != null || meta.lng != null

  const mapsHref = mapsHrefFromLocation({
    placeId: hasSnapshotTruth ? null : bookedLocation?.placeId ?? null,
    lat: meta.lat ?? decimalToNumber(bookedLocation?.lat),
    lng: meta.lng ?? decimalToNumber(bookedLocation?.lng),
    formattedAddress: meta.formattedAddress ?? bookedLocation?.formattedAddress ?? label,
    name: hasSnapshotTruth ? null : bookedLocation?.name ?? null,
  })

  return { label, mapsHref }
}

export default async function BookingReceiptPage(props: PageProps) {
  const { id } = await Promise.resolve(props.params)
  if (!id || typeof id !== 'string') notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user) {
    redirect(`/login?from=${encodeURIComponent(`/booking/${id}`)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: bookingReceiptSelect,
  })

  if (!booking) notFound()

  const isClientViewer = Boolean(user.clientProfile?.id && booking.clientId === user.clientProfile.id)
  const isProViewer = Boolean(user.professionalProfile?.id && booking.professionalId === user.professionalProfile.id)

  if (!isClientViewer && !isProViewer) notFound()

  const professional = booking.professional
  const service = booking.service

  const proName = formatProfessionalPublicDisplayName(professional, 'Professional')
  const serviceName = service?.name || 'Service'

  const appointmentTz = resolveReceiptTimeZone({
    bookingLocationTimeZone: booking.locationTimeZone,
    bookedLocationTimeZone: booking.location?.timeZone,
    proTimeZone: professional?.timeZone,
  })

  const when = fmtInTimeZone(new Date(booking.scheduledFor), appointmentTz)
  const whenZone = fmtZoneAbbreviation(new Date(booking.scheduledFor), appointmentTz)
  const { label: locationLabel, mapsHref } = resolveBookedPlace(booking)

  const calendarHref = `/api/v1/calendar?bookingId=${encodeURIComponent(booking.id)}`
  const messageHref =
    isClientViewer || isProViewer
      ? messageStartHref({ kind: 'BOOKING', bookingId: booking.id })
      : null

  const dashboardHref = isProViewer ? '/pro/bookings' : '/client/bookings'
  const dashboardLabel = isProViewer ? 'Go to pro dashboard' : 'Go to dashboard'

  const duration =
    (Number(booking.totalDurationMinutes ?? 0) > 0
      ? Number(booking.totalDurationMinutes)
      : service?.defaultDurationMinutes) ?? null

  const locationTypeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)
  const statusLabel = friendlyStatus(booking.status)
  const isWaiting = upper(booking.status) === 'PENDING'

  const overrideNote = booking.clientVisibleOverrideNote?.trim() || null

  const items = booking.serviceItems ?? []
  const baseItems = items.filter((item) => !isAddOnItem(item))
  const addOnItems = items.filter((item) => isAddOnItem(item))

  const addOnPrice = sumDecimal(addOnItems.map((item) => item.priceSnapshot))
  const addOnMinutes = addOnItems.reduce(
    (sum, item) => sum + (Number(item.durationMinutesSnapshot) || 0),
    0,
  )

  const subtotalDecimal =
    booking.subtotalSnapshot ??
    (items.length ? sumDecimal(items.map((item) => item.priceSnapshot)) : null)

  const CONFIRM = COPY.bookingConfirmation

  // Book the Look, B4b — a booking that came from a consultation's proposal.
  const consultProposal = booking.consultBookingProposal

  // ⚠️ STARTING price, never a settled one — the snapshot is fed by
  // salonPriceStartingAt / service.minPrice, and a consultation can revise the
  // total before the service happens. Always rendered behind COPY's "From".
  //
  // 🔴 SUPPRESSED on a consultation booking. `subtotalSnapshot` covers only the
  // FLOOR offering the booking was finalized through — the beyond-floor lines
  // are deliberately not BookingServiceItem rows (they are the pro's to settle
  // in the chair, decision 8) — so this figure is SMALLER than the "Starting
  // at" the client agreed to. Seen live: "From $180" printed directly above
  // "Starting at $225" on the same receipt. The consultation section below
  // carries the number she agreed to, with decision 5's framing beside it.
  const subtotalLabel = consultProposal
    ? null
    : formatRoundedDollars(subtotalDecimal)

  // The "Starting at $X" the client agreed to, composed by the SAME function
  // that composed it before the tap — never re-assembled here.
  const consultStartingAtLabel = consultProposal
    ? formatConsultProposalStartingPrice(consultProposal.startingAtPrice)
    : null

  // The hero is the CLIENT's moment. A pro opening the same URL is looking at a
  // request someone sent *them*, so they keep a plain header — "Request sent"
  // would be addressed to the wrong person.
  //
  // Only PENDING and the two live states earn a celebratory hero. COMPLETED,
  // CANCELLED and NO_SHOW get a neutral one: the mark reads as "this is good
  // news", and putting it over a cancelled booking would be a lie. Derived by
  // listing the celebratory statuses, so a NEW BookingStatus lands in the
  // neutral arm rather than silently inheriting the check.
  const bookingStatus = upper(booking.status)
  const isLive = bookingStatus === 'ACCEPTED' || bookingStatus === 'IN_PROGRESS'
  const showCelebration = isWaiting || isLive

  const heroTitle = isWaiting
    ? CONFIRM.title
    : isLive
      ? CONFIRM.titleSettled
      : CONFIRM.titleClosed
  // 🔴 The truth for HER pro's toggle. B4 promised one of exactly two sentences
  // before the tap ("yours as soon as you book" / "held for you — your pro
  // confirms in the morning"); the receipt repeats the one the booking's ACTUAL
  // status realised, so the promise and the outcome are the same words.
  //
  // It replaces the generic pending body deliberately: "has your request" is
  // silent about the fact that a PENDING booking ALREADY owns the slot
  // (BOOKING_BLOCKING_STATUSES, EXCLUDE-backed), which is the whole reason
  // decision 3's impulse booking is honest in request mode.
  const heroBody = consultProposal
    ? isWaiting
      ? COPY.consultProposal.commitRequest
      : isLive
        ? COPY.consultProposal.commitInstant
        : CONFIRM.closedBody
    : isWaiting
      ? `${proName} ${CONFIRM.hasYourRequest}`
      : isLive
        ? CONFIRM.settledBody
        : CONFIRM.closedBody

  const addOnNames = addOnItems.map((item) => item.service.name).filter(Boolean)

  const nextSteps: string[] = [
    `${proName} ${CONFIRM.stepReviews}`,
    CONFIRM.stepNotify,
    CONFIRM.stepNoCharge,
  ]

  const bookingDetailHref = isProViewer
    ? `/pro/bookings/${encodeURIComponent(booking.id)}`
    : `/client/bookings/${encodeURIComponent(booking.id)}`

  return (
    <main className="mx-auto max-w-180 px-4 pb-24 pt-10 text-textPrimary">
      {isClientViewer ? (
        <header className="flex flex-col items-center text-center">
          {showCelebration ? (
            <span
              aria-hidden="true"
              className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[image:var(--cta)]"
            >
              <Check className="h-9 w-9 text-onCta" strokeWidth={3} />
            </span>
          ) : null}

          <h1
            className={`font-display text-[30px] font-semibold tracking-[-0.02em] ${
              showCelebration ? 'mt-5' : ''
            }`}
          >
            {heroTitle}
          </h1>

          <p className="mt-2 max-w-[34ch] text-[14.5px] leading-snug text-textSecondary">
            {heroBody}
          </p>

          {isWaiting ? (
            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/12 px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold" />
              {CONFIRM.pendingPill}
            </span>
          ) : !isLive ? (
            // A closed booking must still say WHICH closed state it is — the
            // neutral header alone can't distinguish completed from cancelled.
            <span className="mt-4 inline-flex items-center rounded-full border border-textPrimary/15 bg-bgSurface px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textSecondary">
              {statusLabel}
            </span>
          ) : null}
        </header>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
              {CONFIRM.eyebrow}
            </div>
            <h1 className="mt-1 font-display text-[26px] font-semibold tracking-[-0.02em]">
              {serviceName}
            </h1>
            <div className="mt-1 text-[13px] text-textSecondary">
              {statusLabel}
              {sourceLabel ? ` · ${sourceLabel}` : null}
            </div>
          </div>

          <Link
            href={dashboardHref}
            className="text-[12px] font-black text-textPrimary hover:opacity-80"
          >
            ← Back
          </Link>
        </div>
      )}

      {/* Summary — the booking itself, led by what it is rather than its fields. */}
      <section className="mt-7 overflow-hidden rounded-card border border-textPrimary/12 bg-bgSurface">
        <div className="flex items-start justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] font-semibold tracking-[-0.01em]">
              {serviceName}
            </div>
            <div className="mt-1 truncate text-[12.5px] text-textSecondary">
              {COPY.bookings.withLabel.toLowerCase()}{' '}
              <ProProfileLink proId={professional?.id ?? null} label={proName} />
            </div>
          </div>

          <div className="shrink-0 text-right">
            {subtotalLabel ? (
              <div className="font-display text-[19px] font-bold tracking-[-0.02em] text-accentPrimary">
                {CONFIRM.priceFrom} {subtotalLabel}
              </div>
            ) : null}
            {duration ? (
              <div className="mt-0.5 font-mono text-[11px] text-textMuted">{duration} min</div>
            ) : null}
          </div>
        </div>

        {/* Label left, value right — but the value column keeps its own left edge
            so a long address wraps as a block instead of ragging off the label. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 border-t border-textPrimary/10 px-4 py-3.5 text-[13px]">
          <dt className="pt-px font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
            {CONFIRM.whenLabel}
          </dt>
          <dd className="text-right font-semibold text-textPrimary">
            {when}
            <span className="ml-1.5 font-normal text-textMuted">{whenZone}</span>
          </dd>

          {locationLabel ? (
            <>
              <dt className="pt-px font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
                {CONFIRM.whereLabel}
              </dt>
              <dd className="text-right font-semibold text-textPrimary">
                {locationTypeLabel ? (
                  <span className="text-textSecondary">{locationTypeLabel} · </span>
                ) : null}
                {mapsHref ? (
                  <a href={mapsHref} target="_blank" rel="noreferrer" className="hover:opacity-80">
                    {locationLabel}
                  </a>
                ) : (
                  locationLabel
                )}
              </dd>
            </>
          ) : null}

          {addOnNames.length ? (
            <>
              <dt className="pt-px font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
                {CONFIRM.addOnsLabel}
              </dt>
              <dd className="text-right font-semibold text-textPrimary">
                {addOnNames.join(' + ')}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      {/* What the consultation put together, as agreed. The booking's own
          subtotal covers only the FLOOR offering it was finalized through, so
          this is where the rest of the appointment lives until the pro finalizes
          in the chair (decision 8, B6). Decision 5's framing travels with the
          figure here exactly as it did before the tap. */}
      {isClientViewer && consultProposal ? (
        <section
          data-testid="booking-consult-proposal-receipt"
          className="mt-4 rounded-card border border-textPrimary/12 bg-bgSurface px-4 py-4"
        >
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
            {COPY.consultProposal.receiptTitle}
          </h2>

          <ul className="mt-3 grid gap-2">
            {consultProposal.lines.map((line) => (
              <li
                key={line.id}
                className="flex items-baseline justify-between gap-3 text-[13.5px]"
              >
                <span className="min-w-0 font-semibold text-textPrimary">
                  {line.serviceName}
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-textSecondary">
                  {line.durationMinutes} min ·{' '}
                  {formatRoundedDollars(line.price) ??
                    `$${moneyToString(line.price)}`}
                </span>
              </li>
            ))}
          </ul>

          {consultStartingAtLabel ? (
            <div className="mt-3 text-[18px] font-black leading-none text-textPrimary">
              {consultStartingAtLabel}
            </div>
          ) : null}
          <p className="mt-2 text-[12px] font-semibold leading-5 text-textSecondary">
            {COPY.consultProposal.estimateNote}{' '}
            {COPY.consultProposal.proDecides}
          </p>
        </section>
      ) : null}

      {isClientViewer && isWaiting ? (
        <section className="mt-4 rounded-card border border-textPrimary/12 bg-bgSurface px-4 py-4">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
            {CONFIRM.whatHappensNext}
          </h2>

          <ol className="mt-3 grid gap-3">
            {nextSteps.map((step, index) => {
              const Icon = NEXT_STEP_ICONS[index] ?? Clock
              return (
                <li key={step} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accentPrimary/12 text-accentPrimary"
                  >
                    <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
                  </span>
                  <span className="text-[13.5px] leading-snug text-textSecondary">{step}</span>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}

      {overrideNote ? (
        <div className="mt-4 whitespace-pre-wrap rounded-card border border-textPrimary/12 bg-bgSurface p-4 text-[13px] font-semibold text-textSecondary">
          <span className="font-black text-textPrimary">
            {isClientViewer ? 'Note from your pro:' : 'Note shared with your client:'}
          </span>{' '}
          {overrideNote}
        </div>
      ) : null}

      {/* Actions — one primary, the rest quiet beside it. */}
      <div className="mt-5 grid gap-2.5">
        <Link
          href={bookingDetailHref}
          className="flex h-[50px] items-center justify-center rounded-[15px] bg-[image:var(--cta)] font-display text-[15px] font-bold text-onCta transition hover:opacity-95"
        >
          {CONFIRM.viewBooking}
        </Link>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {messageHref ? (
            <Link
              href={messageHref}
              className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-textPrimary/15 bg-bgSurface text-[13.5px] font-bold text-textPrimary transition hover:border-textPrimary/30"
            >
              <MessageCircle className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
              {isClientViewer ? CONFIRM.message : 'Message client'}
            </Link>
          ) : null}

          <a
            href={calendarHref}
            className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-textPrimary/15 bg-bgSurface text-[13.5px] font-bold text-textPrimary transition hover:border-textPrimary/30"
          >
            <CalendarPlus className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
            {COPY.bookings.addToCalendar}
          </a>
        </div>

        <Link
          href={isClientViewer ? '/looks' : dashboardHref}
          className="mt-1 text-center text-[13px] font-semibold text-textSecondary transition hover:text-textPrimary"
        >
          {isClientViewer ? CONFIRM.backToLooks : dashboardLabel}
        </Link>
      </div>

      {items.length ? (
        <div className="mt-4 rounded-card border border-textPrimary/12 bg-bgSurface p-4">
          <div className="text-[12px] font-black text-textSecondary">Service breakdown</div>

          <div className="mt-3 grid gap-2">
            {baseItems.map((item) => {
              const price = moneyToString(item.priceSnapshot) ?? '0.00'
              const mins = Number(item.durationMinutesSnapshot) || 0

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-card border border-textPrimary/10 bg-bgPrimary/35 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-black text-textPrimary">
                      {item.service.name}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                      {mins} min
                    </div>
                  </div>

                  <div className="shrink-0 text-[12px] font-black text-textPrimary">
                    ${price}
                  </div>
                </div>
              )
            })}
          </div>

          {addOnItems.length ? (
            <div className="mt-4 border-t border-textPrimary/10 pt-4">
              <div className="text-[12px] font-black text-textSecondary">Add-ons</div>

              <div className="mt-3 grid gap-2">
                {addOnItems.map((item) => {
                  const price = moneyToString(item.priceSnapshot) ?? '0.00'
                  const mins = Number(item.durationMinutesSnapshot) || 0

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-card border border-textPrimary/10 bg-bgPrimary/35 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">
                          {item.service.name}
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-textSecondary">
                          +{mins} min
                        </div>
                      </div>

                      <div className="shrink-0 text-[12px] font-black text-textPrimary">
                        ${price}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 rounded-card border border-textPrimary/10 bg-bgPrimary/35 px-4 py-3 text-[12px] font-semibold text-textSecondary">
                Add-ons total:{' '}
                <span className="font-black text-textPrimary">
                  ${moneyToString(addOnPrice) ?? '0.00'}
                </span>{' '}
                · Time:{' '}
                <span className="font-black text-textPrimary">{addOnMinutes} min</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

    </main>
  )
}
