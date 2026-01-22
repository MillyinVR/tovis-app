import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import MonthlySourcePie from '../MonthlySourcePie'
import { sanitizeTimeZone, startOfDayUtcInTimeZone } from '@/lib/timeZone'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function parseMonthParam(raw: unknown) {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null
  const [y, m] = s.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return null
  return { y, m }
}

/**
 * Month window expressed as UTC instants, aligned to the pro's timezone.
 * monthStartUtc = start of month at 00:00 in pro tz (as UTC instant)
 * monthEndUtc   = start of next month at 00:00 in pro tz (as UTC instant)
 */
function monthWindowUtcForProTz(args: { y: number; m: number; timeZone: string }) {
  const tz = sanitizeTimeZone(args.timeZone, 'UTC')

  // noon UTC on the 1st avoids DST edge cases
  const anchorThis = new Date(Date.UTC(args.y, args.m - 1, 1, 12, 0, 0))
  const anchorNext = new Date(Date.UTC(args.y, args.m, 1, 12, 0, 0))

  const monthStartUtc = startOfDayUtcInTimeZone(anchorThis, tz)
  const monthEndUtc = startOfDayUtcInTimeZone(anchorNext, tz)

  return { monthStartUtc, monthEndUtc }
}

function monthKey(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}`
}

function monthLabelInTimeZone(y: number, m: number, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const d = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0))
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'long', year: 'numeric' }).format(d)
}

// Prisma Decimal dollars -> number dollars (safe-ish for dashboard math)
function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (!v) return 0
  // Prisma.Decimal supports toNumber(), but toString() is also safe.
  if (typeof (v as Prisma.Decimal).toNumber === 'function') {
    const n = (v as Prisma.Decimal).toNumber()
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(String(v))
  return Number.isFinite(n) ? n : 0
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

async function getMonthlyStats(proId: string, monthStartUtc: Date, monthEndUtc: Date) {
  const bookingsInMonth = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      scheduledFor: { gte: monthStartUtc, lt: monthEndUtc },
      status: 'COMPLETED',
    },
    select: {
      id: true,
      clientId: true,
      serviceId: true,
      source: true,

      // ✅ correct schema fields (Decimal dollars)
      subtotalSnapshot: true,
      tipAmount: true,
    },
  })

  const clientIds = Array.from(new Set(bookingsInMonth.map((b) => b.clientId)))

  // ✅ revenue from Booking.subtotalSnapshot (dollars)
  const serviceRevenueDollars = bookingsInMonth.reduce((sum: number, b) => {
    return sum + decimalToNumber(b.subtotalSnapshot)
  }, 0)

  // ✅ tips from Booking.tipAmount (dollars)
  const tipsDollars = bookingsInMonth.reduce((sum: number, b) => {
    return sum + decimalToNumber(b.tipAmount)
  }, 0)

  const reviewAgg = await prisma.review.aggregate({
    where: {
      professionalId: proId,
      createdAt: { gte: monthStartUtc, lt: monthEndUtc },
    },
    _count: { _all: true },
    _avg: { rating: true },
  })

  const monthlyReviewCount = reviewAgg._count._all ?? 0
  const monthlyAvgRating =
    typeof reviewAgg._avg.rating === 'number' ? Number(reviewAgg._avg.rating.toFixed(1)) : null

  const futureBookings = clientIds.length
    ? await prisma.booking.findMany({
        where: {
          professionalId: proId,
          clientId: { in: clientIds },
          scheduledFor: { gte: monthEndUtc },
          status: { not: 'CANCELLED' },
        },
        select: { clientId: true },
      })
    : []

  const retainedClientIds = new Set(futureBookings.map((b) => b.clientId))
  const retainedCount = retainedClientIds.size
  const retentionPct = clientIds.length ? Math.round((retainedCount / clientIds.length) * 100) : 0
  const noRebookCount = clientIds.length ? clientIds.filter((id) => !retainedClientIds.has(id)).length : 0

  const serviceCounts = new Map<string, number>()
  for (const b of bookingsInMonth) {
    serviceCounts.set(b.serviceId, (serviceCounts.get(b.serviceId) ?? 0) + 1)
  }

  const topServiceId = Array.from(serviceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topServiceCount = topServiceId ? serviceCounts.get(topServiceId) ?? 0 : 0
  const topService = topServiceId
    ? await prisma.service.findUnique({ where: { id: topServiceId }, select: { name: true } })
    : null

  const priorCompleted = clientIds.length
    ? await prisma.booking.findMany({
        where: {
          professionalId: proId,
          clientId: { in: clientIds },
          status: 'COMPLETED',
          scheduledFor: { lt: monthStartUtc },
        },
        select: { clientId: true },
      })
    : []

  const priorClientSet = new Set(priorCompleted.map((b) => b.clientId))

  let NR = 0
  let NNR = 0
  let RR = 0
  let AR = 0

  for (const b of bookingsInMonth) {
    const isReturn = priorClientSet.has(b.clientId)
    if (b.source === 'AFTERCARE') AR += 1
    else if (b.source === 'REQUESTED') {
      if (isReturn) RR += 1
      else NR += 1
    } else {
      if (!isReturn) NNR += 1
    }
  }

  // ✅ product revenue from ProductSale.unitPrice * quantity (unitPrice is Decimal dollars)
  const sales = await prisma.productSale.findMany({
    where: { professionalId: proId, createdAt: { gte: monthStartUtc, lt: monthEndUtc } },
    select: { productId: true, quantity: true, unitPrice: true },
  })

  const productRevenueDollars = sales.reduce((sum: number, s) => {
    const unit = decimalToNumber(s.unitPrice)
    const qty = Number.isFinite(s.quantity) ? s.quantity : 0
    return sum + unit * qty
  }, 0)

  let topProductName: string | null = null
  let topProductQty = 0

  const qtyByProduct = new Map<string, number>()
  for (const s of sales) {
    qtyByProduct.set(s.productId, (qtyByProduct.get(s.productId) ?? 0) + s.quantity)
  }

  const top = Array.from(qtyByProduct.entries()).sort((a, b) => b[1] - a[1])[0]
  if (top) {
    topProductQty = top[1]
    const p = await prisma.product.findUnique({ where: { id: top[0] }, select: { name: true } })
    topProductName = p?.name ?? null
  }

  const revenueTotalDollars = serviceRevenueDollars + productRevenueDollars

  return {
    revenueTotalDollars,
    serviceRevenueDollars,
    productRevenueDollars,
    tipsDollars,

    totalClients: clientIds.length,
    monthlyAvgRating,
    monthlyReviewCount,
    retentionPct,
    retainedCount,
    noRebookCount,

    topServiceName: topService?.name ?? null,
    topServiceCount,

    topProductName,
    topProductQty,

    breakdown: { NR, NNR, RR, AR, NRB: noRebookCount },
  }
}

function DeltaCount({ cur, prev, suffix = '' }: { cur: number; prev: number; suffix?: string }) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const color = delta > 0 ? 'text-toneSuccess' : delta < 0 ? 'text-toneDanger' : 'text-textSecondary'
  return <span className={`${color} font-black`}>{`${sign}${delta}${suffix}`}</span>
}

function DeltaMoney({ cur, prev }: { cur: number; prev: number }) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const color = delta > 0 ? 'text-toneSuccess' : delta < 0 ? 'text-toneDanger' : 'text-textSecondary'
  const label = moneyToString(Math.abs(delta)) ?? '0.00'
  return <span className={`${color} font-black`}>{`${sign}$${label}`}</span>
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="text-[12px] font-extrabold text-textSecondary">{label}</div>
      <div className="mt-2 text-[20px] font-black text-textPrimary">{value}</div>
      {sub ? <div className="mt-2 text-[12px] text-textSecondary">{sub}</div> : null}
    </div>
  )
}

export default async function ProDashboardPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) redirect('/login?from=/pro')

  const resolved = searchParams ? await searchParams : undefined
  const parsed = parseMonthParam(resolved?.month)

  const proTz = sanitizeTimeZone(user.professionalProfile.timeZone, 'America/Los_Angeles')

  const now = new Date()
  const fallbackY = now.getUTCFullYear()
  const fallbackM = now.getUTCMonth() + 1

  const y = parsed?.y ?? fallbackY
  const m = parsed?.m ?? fallbackM

  const { monthStartUtc, monthEndUtc } = monthWindowUtcForProTz({ y, m, timeZone: proTz })

  const prevY = m === 1 ? y - 1 : y
  const prevM = m === 1 ? 12 : m - 1
  const prevWindow = monthWindowUtcForProTz({ y: prevY, m: prevM, timeZone: proTz })

  const proId = user.professionalProfile.id

  const [cur, prev] = await Promise.all([
    getMonthlyStats(proId, monthStartUtc, monthEndUtc),
    getMonthlyStats(proId, prevWindow.monthStartUtc, prevWindow.monthEndUtc),
  ])

  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1

  const prevHref = `/pro?month=${monthKey(prevY, prevM)}`
  const nextHref = `/pro?month=${monthKey(nextY, nextM)}`

  const revenueLabel = moneyToString(cur.revenueTotalDollars) ?? '0.00'
  const tipsLabel = moneyToString(cur.tipsDollars) ?? '0.00'

  return (
    <main className="mx-auto max-w-5xl px-4 pt-10 pb-24 font-sans">
      {/* Month scroller */}
      <div className="mb-6 flex items-center justify-center gap-4">
        <Link
          href={prevHref}
          className="rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[14px] font-black text-textPrimary hover:border-white/20"
        >
          ←
        </Link>

        <div className="grid gap-1 text-center">
          <div className="text-[16px] font-black text-textPrimary">{monthLabelInTimeZone(y, m, proTz)}</div>
          <div className="text-[11px] font-semibold text-textSecondary">Timezone: {proTz}</div>
        </div>

        <Link
          href={nextHref}
          className="rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[14px] font-black text-textPrimary hover:border-white/20"
        >
          →
        </Link>
      </div>

      {/* Top cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Revenue (services + products, no tips)"
          value={`$${revenueLabel}`}
          sub={
            <>
              vs last month: <DeltaMoney cur={cur.revenueTotalDollars} prev={prev.revenueTotalDollars} />
            </>
          }
        />

        <StatCard
          label="Tips"
          value={`$${tipsLabel}`}
          sub={
            <>
              vs last month: <DeltaMoney cur={cur.tipsDollars} prev={prev.tipsDollars} />
            </>
          }
        />

        <StatCard
          label="Total clients (seen this month)"
          value={`${cur.totalClients}`}
          sub={
            <>
              vs last month: <DeltaCount cur={cur.totalClients} prev={prev.totalClients} />
            </>
          }
        />

        <StatCard
          label="Rating (this month only)"
          value={cur.monthlyAvgRating != null ? `${cur.monthlyAvgRating} ★` : '–'}
          sub={<>{cur.monthlyReviewCount} review(s)</>}
        />

        <StatCard
          label="Retention"
          value={`${cur.retentionPct}%`}
          sub={
            <>
              {cur.retainedCount} of {cur.totalClients} clients have a future booking
            </>
          }
        />

        <StatCard
          label="No Rebook (yet)"
          value={`${cur.noRebookCount}`}
          sub={<>Clients seen this month with no future booking scheduled</>}
        />
      </div>

      {/* Pie + tops */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[12px] font-extrabold text-textSecondary">Bookings breakdown</div>
          <div className="mt-3">
            <MonthlySourcePie
              data={[
                { label: 'NNR', value: cur.breakdown.NNR },
                { label: 'NR', value: cur.breakdown.NR },
                { label: 'RR', value: cur.breakdown.RR },
                { label: 'AR', value: cur.breakdown.AR },
                { label: 'NRB', value: cur.breakdown.NRB },
              ]}
            />
          </div>
          <div className="mt-3 text-[11px] text-textSecondary">
            Counts are based on COMPLETED bookings within this month window (pro timezone).
          </div>
        </div>

        <div className="grid gap-3">
          <StatCard
            label="Most booked service"
            value={cur.topServiceName ? cur.topServiceName : '–'}
            sub={cur.topServiceName ? `${cur.topServiceCount} booking(s)` : 'No completed bookings yet'}
          />
          <StatCard
            label="Top selling product"
            value={cur.topProductName ? cur.topProductName : '–'}
            sub={cur.topProductName ? `${cur.topProductQty} sold` : 'No product sales this month'}
          />
        </div>
      </div>

      {/* Deep links */}
      <div className="mt-6 flex flex-wrap gap-2">
        {[
          ['/pro/services', 'Services'],
          ['/pro/reviews', 'Reviews'],
          ['/pro/public-profile', 'Public profile'],
          ['/pro/media', 'Media'],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
          >
            {label}
          </Link>
        ))}
      </div>
    </main>
  )
}
