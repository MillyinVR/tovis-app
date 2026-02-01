// app/pro/bookings/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from './BookingActions'
import { moneyToString } from '@/lib/money'
import { Prisma } from '@prisma/client'
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

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function normalizeStatusFilter(raw: unknown): StatusFilter {
  const s = String(raw || '').toUpperCase().trim()
  if (s === 'PENDING' || s === 'ACCEPTED' || s === 'COMPLETED' || s === 'CANCELLED') return s
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
    <span className={['inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-black', tone].join(' ')}>
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
      {pills.map((p) => {
        const isActive = active === p.key
        const href = p.key === 'ALL' ? '/pro/bookings' : `/pro/bookings?status=${encodeURIComponent(p.key)}`
        return (
          <a
            key={p.key}
            href={href}
            className={[
              'rounded-full border px-4 py-2 text-[12px] font-black transition',
              isActive
                ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary'
                : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
            ].join(' ')}
          >
            {p.label}
          </a>
        )
      })}
    </div>
  )
}


async function resolveProScheduleTimeZone(proId: string, proTimeZoneRaw: unknown): Promise<string> {
  const primary = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true, isPrimary: true },
    select: { timeZone: true },
  })

  const primaryTz = pickTimeZoneOrNull(primary?.timeZone)
  if (primaryTz) return primaryTz

  const any = await prisma.professionalLocation.findFirst({
    where: { professionalId: proId, isBookable: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { timeZone: true },
  })

  const anyTz = pickTimeZoneOrNull(any?.timeZone)
  if (anyTz) return anyTz

  const proTz = pickTimeZoneOrNull(proTimeZoneRaw)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
}

/**
 * Row display timezone:
 * Prefer booking.locationTimeZone snapshot (appointment truth),
 * else fall back to scheduleTz (validated/sanitized to UTC).
 */
function bookingDisplayTimeZone(bookingLocationTimeZone: unknown, scheduleTz: string) {
  const bookingTz = pickTimeZoneOrNull(bookingLocationTimeZone)
  if (bookingTz) return bookingTz
  return sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
}

function formatWhenForRow(date: Date, tz: string) {
  const safe = isValidIanaTimeZone(tz) ? tz : DEFAULT_TIME_ZONE
  return formatAppointmentWhen(date, safe)
}

/**
 * DST-safe boundaries:
 * "Today" and "Tomorrow" are computed as local day-starts in scheduleTz,
 * converted to UTC instants via zonedTimeToUtc.
 */
function computeTodayTomorrowBoundsUtc(nowUtc: Date, scheduleTz: string) {
  const tz = sanitizeTimeZone(scheduleTz, DEFAULT_TIME_ZONE)
  const p = getZonedParts(nowUtc, tz)

  const startOfTodayUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  // ✅ no "+24h" — day+1 in local calendar time, DST-safe
  const startOfTomorrowUtc = zonedTimeToUtc({
    year: p.year,
    month: p.month,
    day: p.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    timeZone: tz,
  })

  return { startOfTodayUtc, startOfTomorrowUtc, tz }
}

// ✅ Strongly-typed select (includes add-ons + booking tz snapshot)
const bookingSelect = {
  id: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  finishedAt: true,

  // ✅ booking snapshot tz (preferred for display)
  locationTimeZone: true,

  totalDurationMinutes: true,
  subtotalSnapshot: true,
  totalAmount: true,
  discountAmount: true,
  taxAmount: true,
  tipAmount: true,

  service: { select: { name: true } },

  serviceItems: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      itemType: true, // "BASE" | "ADD_ON"
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

function PriceBlock({ b }: { b: BookingRow }) {
  const explicitTotal = b.totalAmount ?? null

  const subtotal = b.subtotalSnapshot
  const discount = b.discountAmount ?? null
  const tax = b.taxAmount ?? null
  const tip = b.tipAmount ?? null

  if (explicitTotal) {
    return <div className="text-[12px] text-textSecondary">Total: ${moneyToString(explicitTotal) ?? '0.00'}</div>
  }

  const z = new Prisma.Decimal(0)
  const computed = subtotal.minus(discount ?? z).plus(tax ?? z).plus(tip ?? z)

  const subtotalStr = moneyToString(subtotal) ?? '0.00'
  const totalStr = moneyToString(computed) ?? subtotalStr

  const discountStr = discount ? moneyToString(discount) : null
  const taxStr = tax ? moneyToString(tax) : null
  const tipStr = tip ? moneyToString(tip) : null

  const hasModifiers = Boolean(discountStr || taxStr || tipStr)
  if (!hasModifiers) return <div className="text-[12px] text-textSecondary">Total: ${subtotalStr}</div>

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

function getBaseAndAddOnNames(b: BookingRow) {
  const items = Array.isArray(b.serviceItems) ? b.serviceItems : []

  const base =
    items.find((x) => String((x as any).itemType || '').toUpperCase() === 'BASE') ??
    items.sort((a, c) => (a.sortOrder ?? 0) - (c.sortOrder ?? 0))[0] ??
    null

  const addOns = items.filter((x) => String((x as any).itemType || '').toUpperCase() === 'ADD_ON')

  const baseName = base?.service?.name ?? b.service?.name ?? 'Service'
  const addOnNames = addOns.map((x) => x.service?.name ?? '').map((s) => s.trim()).filter(Boolean)

  return { baseName, addOnNames }
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
  visibleClientIdSet: Set<string>
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[15px] font-black text-textPrimary">{title}</h2>
        <div className="text-[12px] text-textSecondary">{items.length ? `${items.length} total` : ''}</div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[12px] text-textSecondary">
          No bookings here yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((b) => {
            const dur = durationLabel(b.totalDurationMinutes)
            const canLinkClient = visibleClientIdSet.has(String(b.client.id))

            const rowTz = bookingDisplayTimeZone(b.locationTimeZone, scheduleTz)

            return (
              <div key={b.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const { baseName, addOnNames } = getBaseAndAddOnNames(b)

                        return (
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-black text-textPrimary">{baseName}</div>

                            {addOnNames.length ? (
                              <div className="mt-1 truncate text-[12px] text-textSecondary">+ {addOnNames.join(', ')}</div>
                            ) : null}
                          </div>
                        )
                      })()}

                      <StatusPill status={b.status} />
                    </div>

                    <div className="mt-1 text-[12px] text-textSecondary">
                      <ClientNameLink canLink={canLinkClient} clientId={b.client.id}>
                        {b.client.firstName} {b.client.lastName}
                      </ClientNameLink>
                      {b.client.user?.email ? ` • ${b.client.user.email}` : ''}
                      {b.client.phone ? ` • ${b.client.phone}` : ''}
                    </div>

                    <div className="mt-2 text-[12px] text-textSecondary">
                      {formatWhenForRow(b.scheduledFor, rowTz)}
                      {dur ? ` • ${dur} min` : ''}
                    </div>

                    <div className="mt-2">
                      <PriceBlock b={b} />
                    </div>

                    <a
                      href={`/pro/bookings/${encodeURIComponent(b.id)}`}
                      className="mt-3 inline-block text-[11px] font-black text-textPrimary underline decoration-white/20 underline-offset-2 hover:decoration-white/40"
                    >
                      Details &amp; aftercare
                    </a>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                    <BookingActions
                      bookingId={b.id}
                      currentStatus={b.status}
                      startedAt={b.startedAt ? b.startedAt.toISOString() : null}
                      finishedAt={b.finishedAt ? b.finishedAt.toISOString() : null}
                      timeZone={rowTz} // ✅ booking snapshot preferred
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

export default async function ProBookingsPage(props: { searchParams?: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings')
  }

  const sp = (await props.searchParams?.catch(() => ({} as SearchParams))) ?? ({} as SearchParams)
  const statusFilter = normalizeStatusFilter(firstParam(sp.status))

  const proId = user.professionalProfile.id

  // ✅ schedule timezone for “Today/Upcoming/Past” buckets (never LA fallback)
  const scheduleTz = await resolveProScheduleTimeZone(proId, user.professionalProfile.timeZone)

  // ✅ DST-safe “Today” boundaries anchored to scheduleTz
  const nowUtc = new Date()
  const { startOfTodayUtc, startOfTomorrowUtc } = computeTodayTomorrowBoundsUtc(nowUtc, scheduleTz)

  const statusWhere = statusFilter === 'ALL' ? {} : { status: statusFilter }

  /**
   * ✅ Build visibility Set once:
   * Pro can link to client chart only if they have:
   * - PENDING booking, OR
   * - booking in progress, OR
   * - ACCEPTED upcoming booking
   */
  const now = new Date()
  const visibleClientRows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      OR: [
        { status: 'PENDING' },
        { startedAt: { not: null }, finishedAt: null },
        { status: 'ACCEPTED', scheduledFor: { gte: now } },
      ],
    },
    select: { clientId: true },
    take: 2000,
  })
  const visibleClientIdSet = new Set<string>(visibleClientRows.map((r) => String(r.clientId)))

  const [todayBookings, upcomingBookings, pastBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { professionalId: proId, ...statusWhere, scheduledFor: { gte: startOfTodayUtc, lt: startOfTomorrowUtc } },
      orderBy: { scheduledFor: 'asc' },
      select: bookingSelect,
    }),
    prisma.booking.findMany({
      where: { professionalId: proId, ...statusWhere, scheduledFor: { gte: startOfTomorrowUtc } },
      orderBy: { scheduledFor: 'asc' },
      select: bookingSelect,
    }),
    prisma.booking.findMany({
      where: { professionalId: proId, ...statusWhere, scheduledFor: { lt: startOfTodayUtc } },
      orderBy: { scheduledFor: 'desc' },
      select: bookingSelect,
    }),
  ])

  const showTz = pickTimeZoneOrNull(scheduleTz)

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">Bookings</h1>
            <div className="mt-1 text-[12px] text-textSecondary">
              Today, upcoming, and past.
              {showTz ? <span className="text-textSecondary/70"> ({showTz})</span> : null}
            </div>
          </div>

          <a
            href="/pro/bookings/new"
            className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
          >
            + New booking
          </a>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[12px] font-black text-textPrimary">Filter</div>
          <FilterPills active={statusFilter} />
        </div>
      </header>

      <div className="grid gap-6">
        <Section title="Today" items={todayBookings} scheduleTz={scheduleTz} visibleClientIdSet={visibleClientIdSet} />
        <Section title="Upcoming" items={upcomingBookings} scheduleTz={scheduleTz} visibleClientIdSet={visibleClientIdSet} />
        <Section title="Past" items={pastBookings} scheduleTz={scheduleTz} visibleClientIdSet={visibleClientIdSet} />
      </div>
    </main>
  )
}
