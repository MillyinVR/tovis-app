// app/pro/bookings/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BookingServiceItemType, Prisma } from '@prisma/client'
import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from './BookingActions'
import { moneyToString } from '@/lib/money'
import ClientNameLink from '@/app/_components/ClientNameLink'
import {
  DEFAULT_TIME_ZONE,
  isValidIanaTimeZone,
  pickTimeZoneOrNull,
  sanitizeTimeZone,
  getZonedParts,
  zonedTimeToUtc,
} from '@/lib/timeZone'
import { formatAppointmentWhen } from '@/lib/formatInTimeZone'

export const dynamic = 'force-dynamic'

type StatusFilter = 'ALL' | 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type SearchParams = Record<string, string | string[] | undefined>

const BOOKING_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const satisfies Record<Exclude<StatusFilter, 'ALL'>, BookingStatus>

const bookingSelect = {
  id: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,
  locationTimeZone: true,

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
    s === 'COMPLETED' ||
    s === 'CANCELLED'
  ) {
    return s
  }
  return 'ALL'
}

function formatStatus(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pending'
    case 'ACCEPTED':
      return 'Accepted'
    case 'COMPLETED':
      return 'Completed'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return status
  }
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

function StatusPill({ status }: { status: string }) {
  const s = String(status || '')
  const tone =
    s === 'PENDING'
      ? 'border-white/10 bg-bgPrimary text-textPrimary'
      : s === 'ACCEPTED'
        ? 'border-accentPrimary/30 bg-bgPrimary text-textPrimary'
        : s === 'COMPLETED'
          ? 'border-toneSuccess/30 bg-bgPrimary text-toneSuccess'
          : s === 'CANCELLED'
            ? 'border-toneDanger/30 bg-bgPrimary text-toneDanger'
            : 'border-white/10 bg-bgPrimary text-textSecondary'

  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-black',
        tone,
      ].join(' ')}
    >
      {formatStatus(s)}
    </span>
  )
}

function FilterPills({ active }: { active: StatusFilter }) {
  const pills: Array<{ key: StatusFilter; label: string }> = [
    { key: 'ALL', label: 'All' },
    { key: 'PENDING', label: 'Pending' },
    { key: 'ACCEPTED', label: 'Accepted' },
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

async function resolveProScheduleTimeZone(
  proId: string,
  proTimeZoneRaw: unknown,
): Promise<string> {
  const locations = await prisma.professionalLocation.findMany({
    where: {
      professionalId: proId,
      isBookable: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      timeZone: true,
    },
    take: 50,
  })

  for (const location of locations) {
    const tz = pickTimeZoneOrNull(location.timeZone)
    if (tz) return tz
  }

  const proTz = pickTimeZoneOrNull(proTimeZoneRaw)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
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
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] text-textSecondary">
          No bookings here yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((booking) => {
            const dur = durationLabel(booking.totalDurationMinutes)
            const canLinkClient = visibleClientIdSet.has(String(booking.client.id))
            const rowTz = bookingDisplayTimeZone(
              booking.locationTimeZone,
              scheduleTz,
            )
            const { baseName, addOnNames } = getBaseAndAddOnNames(booking)

            return (
              <div
                key={booking.id}
                className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-black text-textPrimary">
                          {baseName}
                        </div>

                        {addOnNames.length ? (
                          <div className="mt-1 truncate text-[12px] text-textSecondary">
                            + {addOnNames.join(', ')}
                          </div>
                        ) : null}
                      </div>

                      <StatusPill status={booking.status} />
                    </div>

                    <div className="mt-1 text-[12px] text-textSecondary">
                      <ClientNameLink
                        canLink={canLinkClient}
                        clientId={booking.client.id}
                      >
                        {booking.client.firstName} {booking.client.lastName}
                      </ClientNameLink>
                      {booking.client.user?.email
                        ? ` • ${booking.client.user.email}`
                        : ''}
                      {booking.client.phone ? ` • ${booking.client.phone}` : ''}
                    </div>

                    <div className="mt-2 text-[12px] text-textSecondary">
                      {formatWhenForRow(booking.scheduledFor, rowTz)}
                      {dur ? ` • ${dur} min` : ''}
                    </div>

                    <div className="mt-2">
                      <PriceBlock booking={booking} />
                    </div>

                    <Link
                      href={`/pro/bookings/${encodeURIComponent(booking.id)}`}
                      className="mt-3 inline-block text-[11px] font-black text-textPrimary underline decoration-white/20 underline-offset-2 hover:decoration-white/40"
                    >
                      Details &amp; aftercare
                    </Link>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                    <BookingActions
                      bookingId={booking.id}
                      currentStatus={booking.status}
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

  const now = new Date()
  const visibleClientRows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      OR: [
        { status: BOOKING_STATUS.PENDING },
        { startedAt: { not: null }, finishedAt: null },
        { status: BOOKING_STATUS.ACCEPTED, scheduledFor: { gte: now } },
      ],
    },
    select: { clientId: true },
    take: 2000,
  })

  const visibleClientIdSet = new Set<string>(
    visibleClientRows.map((row) => String(row.clientId)),
  )

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

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">Bookings</h1>
            <div className="mt-1 text-[12px] text-textSecondary">
              Today, upcoming, past, and cancelled.
              {showTz ? (
                <span className="text-textSecondary/70"> ({showTz})</span>
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

        <div className="mt-4">
          <div className="mb-2 text-[12px] font-black text-textPrimary">
            Filter
          </div>
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