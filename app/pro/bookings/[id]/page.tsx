// app/pro/bookings/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from '../BookingActions'
import { moneyToString } from '@/lib/money'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

type StatusFilter = 'ALL' | 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED'
type SearchParams = Record<string, string | string[] | undefined>

type BookingRow = {
  id: string
  status: string
  scheduledFor: Date
  startedAt: Date | null
  finishedAt: Date | null

  // Option B truth
  totalDurationMinutes: number
  subtotalSnapshot: any

  // For display
  locationTimeZone: string | null

  // Option B: service items
  serviceItems: Array<{
    id: string
    sortOrder: number
    service: { id: string; name: string } | null
  }>

  client: {
    id: string
    firstName: string
    lastName: string
    phone: string | null
    user: { email: string } | null
  }
}

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function normalizeStatusFilter(raw: unknown): StatusFilter {
  const s = String(raw || '').toUpperCase().trim()
  if (s === 'PENDING' || s === 'ACCEPTED' || s === 'COMPLETED' || s === 'CANCELLED') return s
  return 'ALL'
}

function normalizeTz(raw: unknown, fallback: string) {
  const candidate = typeof raw === 'string' ? raw.trim() : ''
  const cleaned = sanitizeTimeZone(candidate, fallback) || fallback
  return isValidIanaTimeZone(cleaned) ? cleaned : fallback
}

/**
 * Get wall-clock parts for a UTC instant rendered in `timeZone`.
 * (We keep this logic here because your `lib/timeZone` is for validation/sanitizing,
 * and we still need day-boundaries without dragging in a whole date library.)
 */
function getZonedParts(dateUtc: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  } as any)

  const parts = dtf.formatToParts(dateUtc)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value

  // Some engines can return "24" for hour at midnight edges.
  let year = Number(map.year)
  let month = Number(map.month)
  let day = Number(map.day)
  let hour = Number(map.hour)
  const minute = Number(map.minute)
  const second = Number(map.second)

  if (hour === 24) hour = 0

  return { year, month, day, hour, minute, second }
}

/** offset minutes between UTC and tz at a given UTC instant */
function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const z = getZonedParts(dateUtc, timeZone)
  const asIfUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asIfUtc - dateUtc.getTime()) / 60_000)
}

/** Convert a wall-clock time in timeZone into UTC Date (two-pass for DST) */
function zonedTimeToUtc(args: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  timeZone: string
}) {
  const { year, month, day, hour, minute, timeZone } = args

  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
  const offset1 = getTimeZoneOffsetMinutes(guess, timeZone)
  guess = new Date(guess.getTime() - offset1 * 60_000)

  const offset2 = getTimeZoneOffsetMinutes(guess, timeZone)
  if (offset2 !== offset1) guess = new Date(guess.getTime() - (offset2 - offset1) * 60_000)

  return guess
}

function formatDate(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
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

function bookingTitle(items: BookingRow['serviceItems']) {
  const names = items
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((i) => i.service?.name)
    .filter(Boolean) as string[]

  if (names.length === 0) return 'Service'
  if (names.length === 1) return names[0]
  return `${names[0]} + ${names.length - 1} more`
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

function PriceBlock({ subtotalSnapshot }: { subtotalSnapshot: any }) {
  const subtotalStr = moneyToString(subtotalSnapshot) ?? '0.00'
  return <div className="text-[12px] text-textSecondary">Total: ${subtotalStr}</div>
}

function Section({
  title,
  items,
  proTimeZone,
}: {
  title: string
  items: BookingRow[]
  proTimeZone: string
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
            const apptTz = normalizeTz(b.locationTimeZone, proTimeZone)

            return (
              <div key={b.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-[13px] font-black text-textPrimary">{bookingTitle(b.serviceItems)}</div>
                      <StatusPill status={b.status} />
                    </div>

                    <div className="mt-1 text-[12px] text-textSecondary">
                      <a
                        href={`/pro/clients/${b.client.id}`}
                        className="font-black text-textPrimary underline decoration-white/20 underline-offset-2 hover:decoration-white/40"
                      >
                        {b.client.firstName} {b.client.lastName}
                      </a>
                      {b.client.user?.email ? ` • ${b.client.user.email}` : ''}
                      {b.client.phone ? ` • ${b.client.phone}` : ''}
                    </div>

                    <div className="mt-2 text-[12px] text-textSecondary">
                      {formatDate(b.scheduledFor, apptTz)} • {Math.round(b.totalDurationMinutes)} min
                      {apptTz !== proTimeZone ? <span className="text-textSecondary/70"> · {apptTz}</span> : null}
                    </div>

                    <div className="mt-2">
                      <PriceBlock subtotalSnapshot={b.subtotalSnapshot} />
                    </div>

                    <a
                      href={`/pro/bookings/${b.id}`}
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
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings')
  }

  const sp = (await props.searchParams?.catch(() => ({} as SearchParams))) ?? ({} as SearchParams)
  const statusFilter = normalizeStatusFilter(firstParam(sp.status))

  const proId = user.professionalProfile.id
  const proTimeZone = normalizeTz(user.professionalProfile.timeZone, 'America/Los_Angeles')

  // Grouping boundaries based on the PRO’s timezone
  const nowUtc = new Date()
  const nowParts = getZonedParts(nowUtc, proTimeZone)

  const startOfTodayUtc = zonedTimeToUtc({
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    hour: 0,
    minute: 0,
    timeZone: proTimeZone,
  })

  const startOfTomorrowUtc = zonedTimeToUtc({
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day + 1,
    hour: 0,
    minute: 0,
    timeZone: proTimeZone,
  })

  const statusWhere = statusFilter === 'ALL' ? {} : { status: statusFilter }

  const select = {
    id: true,
    status: true,
    scheduledFor: true,
    startedAt: true,
    finishedAt: true,

    totalDurationMinutes: true,
    subtotalSnapshot: true,

    locationTimeZone: true,

    serviceItems: {
      orderBy: { sortOrder: 'asc' as const },
      select: {
        id: true,
        sortOrder: true,
        service: { select: { id: true, name: true } },
      },
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
  } as const

  const [todayBookings, upcomingBookings, pastBookings] = await Promise.all([
    prisma.booking.findMany({
      where: {
        professionalId: proId,
        ...statusWhere,
        scheduledFor: { gte: startOfTodayUtc, lt: startOfTomorrowUtc },
      },
      orderBy: { scheduledFor: 'asc' },
      select,
      take: 500,
    }),
    prisma.booking.findMany({
      where: {
        professionalId: proId,
        ...statusWhere,
        scheduledFor: { gte: startOfTomorrowUtc },
      },
      orderBy: { scheduledFor: 'asc' },
      select,
      take: 500,
    }),
    prisma.booking.findMany({
      where: {
        professionalId: proId,
        ...statusWhere,
        scheduledFor: { lt: startOfTodayUtc },
      },
      orderBy: { scheduledFor: 'desc' },
      select,
      take: 500,
    }),
  ])

  // Normalize duration in-case nulls sneak in (they shouldn’t, but humans exist)
  const coerce = (rows: any[]) =>
    rows.map((b) => ({
      ...b,
      totalDurationMinutes: Number(b.totalDurationMinutes ?? 0) || 0,
    })) as BookingRow[]

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-textPrimary">Bookings</h1>
            <div className="mt-1 text-[12px] text-textSecondary">
              Today, upcoming, and past. <span className="text-textSecondary/70">({proTimeZone})</span>
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
        <Section title="Today" items={coerce(todayBookings)} proTimeZone={proTimeZone} />
        <Section title="Upcoming" items={coerce(upcomingBookings)} proTimeZone={proTimeZone} />
        <Section title="Past" items={coerce(pastBookings)} proTimeZone={proTimeZone} />
      </div>
    </main>
  )
}
