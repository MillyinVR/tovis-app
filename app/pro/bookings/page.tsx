// app/pro/bookings/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  SessionStep,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { getVisibleClientIdSetForPro } from '@/lib/clientVisibility'
import BookingActions from './BookingActions'
import { moneyToString } from '@/lib/money'
import {
  resolveBookingLocationMeta,
  type BookingLocationMeta,
} from '@/lib/booking/locationMeta'
import { mapsHrefFromLocation } from '@/lib/maps'
import ClientNameLink from '@/app/_components/ClientNameLink'
import EmptyState from '@/app/_components/boundaries/EmptyState'
import { Avatar, Badge } from '@/app/_components/ui'
import type { BadgeTone } from '@/app/_components/ui'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
  getZonedParts,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'
import { resolveProScheduleTimeZone } from '@/lib/proLocations/resolveProScheduleTimeZone'
import { isCloseoutPaymentAndAftercareComplete } from '@/lib/booking/closeoutState'
import { labelForBookingStatus } from '@/lib/booking/statusLabel'

export const dynamic = 'force-dynamic'

type StatusFilter =
  | 'ALL'
  | 'PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
type SearchParams = Record<string, string | string[] | undefined>

const BOOKING_STATUS = {
  PENDING: BookingStatus.PENDING,
  ACCEPTED: BookingStatus.ACCEPTED,
  IN_PROGRESS: BookingStatus.IN_PROGRESS,
  COMPLETED: BookingStatus.COMPLETED,
  CANCELLED: BookingStatus.CANCELLED,
} as const satisfies Record<Exclude<StatusFilter, 'ALL'>, BookingStatus>

const bookingSelect = {
  id: true,
  status: true,
  sessionStep: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  locationTimeZone: true,

  checkoutStatus: true,
  paymentCollectedAt: true,
  aftercareSummary: {
    select: {
      sentToClientAt: true,
    },
  },

  // Appointment location — drives the tap-for-directions chip. SALON bookings
  // read the pro-location snapshot; MOBILE bookings read the client-address
  // snapshot (where the pro physically travels). Snapshots are captured at
  // booking time; `pickFormattedAddressFromSnapshot` reads display text without
  // needing decryption (encrypted-only rows simply resolve to null → no chip).
  locationType: true,
  locationAddressSnapshot: true,
  locationLatSnapshot: true,
  locationLngSnapshot: true,
  clientAddressSnapshot: true,
  clientAddressLatSnapshot: true,
  clientAddressLngSnapshot: true,

  totalDurationMinutes: true,
  subtotalSnapshot: true,
  totalAmount: true,
  discountAmount: true,
  taxAmount: true,
  tipAmount: true,

  service: {
    select: {
      name: true,
    },
  },

  serviceItems: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      itemType: true,
      sortOrder: true,
      service: { select: { name: true } },
      priceSnapshot: true,
      durationMinutesSnapshot: true,
      parentItemId: true,
    },
    take: 50,
  },

  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      user: { select: { email: true } },
    },
  },
} satisfies Prisma.BookingSelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function normalizeStatusFilter(raw: unknown): StatusFilter {
  const s = String(raw || '').toUpperCase().trim()
  if (
    s === 'PENDING' ||
    s === 'ACCEPTED' ||
    s === 'IN_PROGRESS' ||
    s === 'COMPLETED' ||
    s === 'CANCELLED'
  ) {
    return s
  }

  return 'ALL'
}

function durationLabel(totalDurationMinutes: unknown): number {
  const n = Number(totalDurationMinutes ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function sumDecimal(values: Prisma.Decimal[]) {
  return values.reduce((acc, v) => acc.add(v), new Prisma.Decimal(0))
}

function formatMoneyOrNull(v: Prisma.Decimal | null | undefined): string | null {
  if (v == null) return null
  return moneyToString(v)
}

function statusBadgeTone(status: string): BadgeTone {
  switch (status) {
    case BookingStatus.ACCEPTED:
    case BookingStatus.IN_PROGRESS:
      return 'accent'
    case BookingStatus.COMPLETED:
      return 'success'
    case BookingStatus.CANCELLED:
      return 'danger'
    default:
      return 'neutral'
  }
}

function StatusPill({ status }: { status: string }) {
  const s = String(status || '')

  return <Badge tone={statusBadgeTone(s)}>{labelForBookingStatus(s)}</Badge>
}

// A booking "needs closeout" when the pro has sent aftercare (so it drops out
// of the active-session footer) but payment + checkout aren't finished yet. It
// still lives under the Active/IN_PROGRESS filter and otherwise looks identical
// to a session still being worked — this is the "don't forget me" surface the
// footer used to provide. The booking is intentionally NOT auto-completed on
// aftercare send; it completes via closeout logic once payment lands.
function needsCloseout(booking: BookingRow): boolean {
  if (
    booking.status !== BookingStatus.ACCEPTED &&
    booking.status !== BookingStatus.IN_PROGRESS
  ) {
    return false
  }
  if (booking.finishedAt) return false

  const aftercareSentAt = booking.aftercareSummary?.sentToClientAt ?? null
  if (!aftercareSentAt) return false

  return !isCloseoutPaymentAndAftercareComplete({
    aftercareSentAt,
    checkoutStatus: booking.checkoutStatus,
    paymentCollectedAt: booking.paymentCollectedAt,
  })
}

function CloseoutBadge({ bookingId }: { bookingId: string }) {
  return (
    <Link
      href={`/pro/bookings/${encodeURIComponent(bookingId)}/session`}
      title="Aftercare sent, but payment isn't collected yet. Tap to finish closeout."
      className="inline-flex items-center gap-1 rounded-full border border-toneWarn/40 bg-toneWarn/10 px-2 py-1 text-[11px] font-black text-toneWarn transition hover:border-toneWarn/70 hover:bg-toneWarn/15"
    >
      Payment due
    </Link>
  )
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )
}

function ExternalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden
      className={['fill-none stroke-current', className].filter(Boolean).join(' ')}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

// Tap-for-directions chip. Hands off to the device's default maps app via the
// shared `lib/maps` helper (no duplicate URL logic). Rendered only when the
// booking has a resolved address; lives as its own anchor so it stays an
// independent ≥44px tap target on the card.
function LocationChip({ meta }: { meta: BookingLocationMeta }) {
  if (!meta.formattedAddress) return null

  const href = mapsHrefFromLocation({
    formattedAddress: meta.formattedAddress,
    lat: meta.lat,
    lng: meta.lng,
  })

  const inner = (
    <>
      <PinIcon
        className={meta.isMobile ? 'text-accentPrimary' : 'text-textMuted'}
      />
      {meta.isMobile ? (
        <span className="shrink-0 font-mono text-[8px] font-bold uppercase tracking-[0.12em] text-accentPrimary">
          Mobile
        </span>
      ) : null}
      <span className="truncate text-[12px] text-textSecondary">
        {meta.formattedAddress}
      </span>
    </>
  )

  const chipBase =
    'mt-2 inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2'

  if (!href) {
    return <div className={chipBase}>{inner}</div>
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${chipBase} transition hover:border-accentPrimary/40`}
    >
      {inner}
      <ExternalIcon className="text-textMuted" />
    </a>
  )
}

function StatCard({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone?: 'accent' | 'warn'
}) {
  const cardCls =
    tone === 'warn'
      ? 'border-toneWarn/30 bg-toneWarn/10'
      : 'border-white/10 bg-bgSecondary'
  const valueCls =
    tone === 'accent'
      ? 'text-accentPrimary'
      : tone === 'warn'
        ? 'text-toneWarn'
        : 'text-textPrimary'
  const labelCls = tone === 'warn' ? 'text-toneWarn' : 'text-textSecondary/70'

  return (
    <div
      className={`tovis-glass min-w-30 flex-1 rounded-card border px-4 py-3 ${cardCls}`}
    >
      <div className={`font-display text-[24px] font-bold ${valueCls}`}>
        {value}
      </div>
      <div
        className={`mt-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] ${labelCls}`}
      >
        {label}
      </div>
    </div>
  )
}

function FilterPills({ active }: { active: StatusFilter }) {
  const pills: Array<{ key: StatusFilter; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'PENDING', label: 'Pending' },
    { key: 'ACCEPTED', label: 'Accepted' },
    { key: 'IN_PROGRESS', label: 'Active' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((pill) => {
        const isActive = active === pill.key
        const href =
          pill.key === 'ALL'
            ? '/pro/bookings'
            : `/pro/bookings?status=${encodeURIComponent(pill.key)}`

        return (
          <Link
            key={pill.key}
            href={href}
            className={[
              'rounded-full border px-4 py-2 text-[12px] font-black transition',
              isActive
                ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
            ].join(' ')}
          >
            {pill.label}
          </Link>
        )
      })}
    </div>
  )
}

function bookingDisplayTimeZone(
  bookingLocationTimeZone: unknown,
  scheduleTz: string,
) {
  const bookingTz = pickTimeZoneOrNull(bookingLocationTimeZone)
  if (bookingTz) return bookingTz
  return sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
}

function formatWhenForRow(date: Date, tz: string) {
  const safe = isValidIanaTimeZone(tz) ? tz : DEFAULT_TIME_ZONE
  return formatAppointmentWhen(date, safe)
}

function computeTodayTomorrowBoundsUtc(nowUtc: Date, scheduleTz: string) {
  const tz = sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
  const parts = getZonedParts(nowUtc, tz)

  const startOfTodayUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  const startOfTomorrowUtc = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { startOfTodayUtc, startOfTomorrowUtc }
}

function getBaseAndAddOnNames(booking: BookingRow) {
  const items = Array.isArray(booking.serviceItems) ? booking.serviceItems : []

  const baseItem =
    items.find((item) => item.itemType === BookingServiceItemType.BASE) ??
    items[0] ??
    null

  const addOnItems = items.filter(
    (item) => item.itemType === BookingServiceItemType.ADD_ON,
  )

  const baseName = baseItem?.service?.name ?? booking.service?.name ?? 'Service'
  const addOnNames = addOnItems
    .map((item) => item.service?.name ?? '')
    .map((name) => name.trim())
    .filter(Boolean)

  return { baseName, addOnNames }
}

function computeFallbackSubtotal(booking: BookingRow): Prisma.Decimal | null {
  const items = Array.isArray(booking.serviceItems) ? booking.serviceItems : []
  if (!items.length) return null
  return sumDecimal(items.map((item) => item.priceSnapshot))
}

function PriceBlock({ booking }: { booking: BookingRow }) {
  const explicitTotal = booking.totalAmount ?? null
  if (explicitTotal != null) {
    return (
      <div className="text-[12px] text-textSecondary">
        Total: ${formatMoneyOrNull(explicitTotal) ?? '0.00'}
      </div>
    )
  }

  const subtotal = booking.subtotalSnapshot ?? computeFallbackSubtotal(booking)
  if (subtotal == null) {
    return <div className="text-[12px] text-textSecondary">Total unavailable</div>
  }

  const zero = new Prisma.Decimal(0)
  const discount = booking.discountAmount ?? null
  const tax = booking.taxAmount ?? null
  const tip = booking.tipAmount ?? null

  const computedTotal = subtotal
    .minus(discount ?? zero)
    .plus(tax ?? zero)
    .plus(tip ?? zero)

  const subtotalStr = formatMoneyOrNull(subtotal) ?? '0.00'
  const totalStr = formatMoneyOrNull(computedTotal) ?? subtotalStr
  const discountStr = discount != null ? formatMoneyOrNull(discount) : null
  const taxStr = tax != null ? formatMoneyOrNull(tax) : null
  const tipStr = tip != null ? formatMoneyOrNull(tip) : null

  const hasModifiers = Boolean(discountStr || taxStr || tipStr)
  if (!hasModifiers) {
    return <div className="text-[12px] text-textSecondary">Total: ${subtotalStr}</div>
  }

  return (
    <div className="grid gap-1 text-[12px] text-textSecondary">
      <div>Subtotal: ${subtotalStr}</div>
      {discountStr ? <div>Discount: -${discountStr}</div> : null}
      {taxStr ? <div>Tax: +${taxStr}</div> : null}
      {tipStr ? <div>Tip: +${tipStr}</div> : null}
      <div className="font-black text-textPrimary">Total: ${totalStr}</div>
    </div>
  )
}

function Section({
  title,
  items,
  scheduleTz,
  visibleClientIdSet,
}: {
  title: string
  items: BookingRow[]
  scheduleTz: string
  visibleClientIdSet: ReadonlySet<string>
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>
        <div className="text-[12px] text-textSecondary">
          {items.length ? `${items.length} total` : ''}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No bookings here yet." />
      ) : (
        <div className="grid gap-3">
          {items.map((booking, index) => {
            const dur = durationLabel(booking.totalDurationMinutes)
            const canLinkClient = visibleClientIdSet.has(String(booking.client.id))
            const rowTz = bookingDisplayTimeZone(
              booking.locationTimeZone,
              scheduleTz,
            )
            const { baseName, addOnNames } = getBaseAndAddOnNames(booking)
            const locationMeta = resolveBookingLocationMeta(booking)
            const clientName = `${booking.client.firstName ?? ''} ${
              booking.client.lastName ?? ''
            }`.trim()

            return (
              <div
                key={booking.id}
                className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 transition hover:border-accentPrimary/30"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-[15px] font-bold text-textPrimary">
                        {baseName}
                      </h3>

                      <StatusPill status={booking.status} />

                      {needsCloseout(booking) ? (
                        <CloseoutBadge bookingId={booking.id} />
                      ) : null}
                    </div>

                    {addOnNames.length ? (
                      <div className="mt-1 truncate text-[12px] text-textSecondary">
                        + {addOnNames.join(', ')}
                      </div>
                    ) : null}

                    <div className="mt-2.5 flex items-center gap-2">
                      <Avatar
                        name={clientName || undefined}
                        index={index}
                        size="sm"
                        aria-hidden
                      />
                      <div className="min-w-0 text-[12px] text-textSecondary">
                        <ClientNameLink
                          canLink={canLinkClient}
                          clientId={booking.client.id}
                        >
                          {clientName || 'Client'}
                        </ClientNameLink>
                        {booking.client.user?.email
                          ? ` • ${booking.client.user.email}`
                          : ''}
                        {booking.client.phone
                          ? ` • ${booking.client.phone}`
                          : ''}
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-textSecondary">
                      <span className="inline-flex items-center gap-1.5">
                        <ClockIcon className="text-textMuted" />
                        {formatWhenForRow(booking.scheduledFor, rowTz)}
                        {dur ? ` • ${dur} min` : ''}
                      </span>
                    </div>

                    <div className="mt-2">
                      <PriceBlock booking={booking} />
                    </div>

                    <LocationChip meta={locationMeta} />

                    {booking.status === BookingStatus.IN_PROGRESS ? (
                      <div className="mt-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-accentPrimary">
                        Session ·{' '}
                        {String(booking.sessionStep ?? SessionStep.NONE).replaceAll(
                          '_',
                          ' ',
                        )}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link
                        href={`/pro/bookings/${encodeURIComponent(booking.id)}`}
                        className="inline-block text-[11px] font-black text-textPrimary underline decoration-white/20 underline-offset-2 hover:decoration-white/40"
                      >
                        Details &amp; aftercare
                      </Link>

                      {booking.status === BookingStatus.IN_PROGRESS ? (
                        <Link
                          href={`/pro/bookings/${encodeURIComponent(booking.id)}/session`}
                          className="inline-block text-[11px] font-black text-accentPrimary underline decoration-accentPrimary/30 underline-offset-2 hover:decoration-accentPrimary/60"
                        >
                          Resume session
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                    <BookingActions
                      bookingId={booking.id}
                      status={booking.status}
                      sessionStep={booking.sessionStep}
                      startedAt={
                        booking.startedAt ? booking.startedAt.toISOString() : null
                      }
                      finishedAt={
                        booking.finishedAt ? booking.finishedAt.toISOString() : null
                      }
                      timeZone={rowTz}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default async function ProBookingsPage(props: {
  searchParams?: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings')
  }

  const sp =
    (await props.searchParams?.catch(() => ({} as SearchParams))) ??
    ({} as SearchParams)
  const statusFilter = normalizeStatusFilter(firstParam(sp.status))

  const proId = user.professionalProfile.id
  const scheduleTz = await resolveProScheduleTimeZone(
    proId,
    user.professionalProfile.timeZone,
  )

  const nowUtc = new Date()
  const { startOfTodayUtc, startOfTomorrowUtc } = computeTodayTomorrowBoundsUtc(
    nowUtc,
    scheduleTz,
  )

  // Single source of truth for chart linkability — same rule as the clients
  // list and the page gate (includes the 30-day RECENT_COMPLETED window).
  const visibleClientIdSet = await getVisibleClientIdSetForPro(proId)

  const nonCancelledStatusWhere:
    | { status: { not: BookingStatus } }
    | { status: BookingStatus }
    | null =
    statusFilter === 'ALL'
      ? { status: { not: BOOKING_STATUS.CANCELLED } }
      : statusFilter === 'CANCELLED'
        ? null
        : { status: statusFilter }

  const activeBucketsPromise: Promise<[BookingRow[], BookingRow[], BookingRow[]]> =
    nonCancelledStatusWhere == null
      ? Promise.resolve([[], [], []])
      : Promise.all([
          prisma.booking.findMany({
            where: {
              professionalId: proId,
              ...nonCancelledStatusWhere,
              scheduledFor: { gte: startOfTodayUtc, lt: startOfTomorrowUtc },
            },
            orderBy: { scheduledFor: 'asc' },
            select: bookingSelect,
          }),
          prisma.booking.findMany({
            where: {
              professionalId: proId,
              ...nonCancelledStatusWhere,
              scheduledFor: { gte: startOfTomorrowUtc },
            },
            orderBy: { scheduledFor: 'asc' },
            select: bookingSelect,
          }),
          prisma.booking.findMany({
            where: {
              professionalId: proId,
              ...nonCancelledStatusWhere,
              scheduledFor: { lt: startOfTodayUtc },
            },
            orderBy: { scheduledFor: 'desc' },
            select: bookingSelect,
          }),
        ])

  const cancelledBookingsPromise: Promise<BookingRow[]> =
    statusFilter === 'ALL' || statusFilter === 'CANCELLED'
      ? prisma.booking.findMany({
          where: {
            professionalId: proId,
            status: BOOKING_STATUS.CANCELLED,
          },
          orderBy: { scheduledFor: 'desc' },
          select: bookingSelect,
        })
      : Promise.resolve([])

  const [[todayBookings, upcomingBookings, pastBookings], cancelledBookings] =
    await Promise.all([activeBucketsPromise, cancelledBookingsPromise])

  const showTz = pickTimeZoneOrNull(scheduleTz)

  // Operational at-a-glance counts from the currently-loaded buckets. "Payment
  // due" is the needsCloseout set (aftercare sent, payment not yet collected) —
  // the same warn-styled "don't forget me" surface the cards carry.
  const activeBuckets = [...todayBookings, ...upcomingBookings, ...pastBookings]
  const todayCount = todayBookings.length
  const inSessionCount = activeBuckets.filter(
    (booking) => booking.status === BookingStatus.IN_PROGRESS,
  ).length
  const paymentDueCount = activeBuckets.filter((booking) =>
    needsCloseout(booking),
  ).length

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
              Studio · Bookings
            </div>
            <h1 className="mt-1.5 font-display text-[28px] font-bold tracking-tight text-textPrimary">
              Bookings
            </h1>
            <div className="mt-1 text-[12px] text-textSecondary">
              Today, upcoming, and past.
              {showTz ? (
                <span className="font-mono text-[11px] text-textSecondary/70">
                  {' · '}
                  {showTz}
                </span>
              ) : null}
            </div>
          </div>

          <Link
            href="/pro/bookings/new"
            className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
          >
            + New booking
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <StatCard value={todayCount} label="Today" />
          <StatCard value={inSessionCount} label="In session" tone="accent" />
          <StatCard value={paymentDueCount} label="Payment due" tone="warn" />
        </div>

        <div className="mt-4">
          <FilterPills active={statusFilter} />
        </div>
      </header>

      <div className="grid gap-6">
        {statusFilter !== 'CANCELLED' ? (
          <>
            <Section
              title="Today"
              items={todayBookings}
              scheduleTz={scheduleTz}
              visibleClientIdSet={visibleClientIdSet}
            />
            <Section
              title="Upcoming"
              items={upcomingBookings}
              scheduleTz={scheduleTz}
              visibleClientIdSet={visibleClientIdSet}
            />
            <Section
              title="Past"
              items={pastBookings}
              scheduleTz={scheduleTz}
              visibleClientIdSet={visibleClientIdSet}
            />
          </>
        ) : null}

        {statusFilter === 'ALL' || statusFilter === 'CANCELLED' ? (
          <Section
            title="Cancelled"
            items={cancelledBookings}
            scheduleTz={scheduleTz}
            visibleClientIdSet={visibleClientIdSet}
          />
        ) : null}
      </div>
    </main>
  )
}