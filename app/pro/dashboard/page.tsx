// app/pro/dashboard/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import MonthlySourcePie from '../MonthlySourcePie'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function parseMonthParam(raw: unknown) {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null
  const [y, m] = s.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return null
  return { y, m }
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
function startOfNextMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}
function monthKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
function monthLabel(date: Date) {
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

async function getMonthlyStats(proId: string, monthStart: Date, monthEnd: Date) {
  const bookingsInMonth = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      scheduledFor: { gte: monthStart, lt: monthEnd },
      status: { in: ['COMPLETED'] },
    },
    select: {
      id: true,
      clientId: true,
      serviceId: true,
      source: true,
      priceSnapshot: true,
      tipAmount: true,
    },
  })

  const clientIds = Array.from(new Set(bookingsInMonth.map((b) => b.clientId)))

  const serviceRevenueCents = bookingsInMonth.reduce((sum, b) => {
    const n = Number(b.priceSnapshot ?? 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  const tipsCents = bookingsInMonth.reduce((sum, b) => {
    const n = Number(b.tipAmount ?? 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  const reviewAgg = await prisma.review.aggregate({
    where: {
      professionalId: proId,
      createdAt: { gte: monthStart, lt: monthEnd },
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
          scheduledFor: { gte: monthEnd },
          status: { not: 'CANCELLED' },
        },
        select: { clientId: true },
      })
    : []

  const retainedClientIds = new Set(futureBookings.map((b) => b.clientId))
  const retainedCount = Array.from(retainedClientIds).length
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
          scheduledFor: { lt: monthStart },
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

  let productRevenue = 0
  let topProductName: string | null = null
  let topProductQty = 0

  const hasProductSale = typeof (prisma as any).productSale?.findMany === 'function'
  if (hasProductSale) {
    const sales = await (prisma as any).productSale.findMany({
      where: { professionalId: proId, createdAt: { gte: monthStart, lt: monthEnd } },
      select: { productId: true, quantity: true, unitPrice: true },
    })

    productRevenue = sales.reduce(
      (sum: number, s: any) => sum + Number(s.unitPrice ?? 0) * Number(s.quantity ?? 0),
      0,
    )

    const qtyByProduct = new Map<string, number>()
    for (const s of sales) qtyByProduct.set(s.productId, (qtyByProduct.get(s.productId) ?? 0) + (s.quantity ?? 0))

    const top = Array.from(qtyByProduct.entries()).sort((a, b) => b[1] - a[1])[0]
    if (top) {
      topProductQty = top[1]
      const p = await prisma.product.findUnique({ where: { id: top[0] }, select: { name: true } })
      topProductName = p?.name ?? null
    }
  }

  const revenueTotal = serviceRevenueCents + productRevenue

  return {
    revenueTotal,
    serviceRevenueCents,
    productRevenue,
    tipsCents,
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

function Delta({ cur, prev, suffix = '' }: { cur: number; prev: number; suffix?: string }) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const color =
    delta > 0 ? 'text-toneSuccess' : delta < 0 ? 'text-toneDanger' : 'text-textSecondary'
  return <span className={`${color} font-black`}>{`${sign}${delta}${suffix}`}</span>
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="tovis-glass rounded-card border border-white/10 p-4">
      <div className="text-[12px] font-extrabold text-textSecondary">{label}</div>
      <div className="mt-2 text-[20px] font-black text-textPrimary">{value}</div>
      {sub ? <div className="mt-2 text-[12px] text-textSecondary">{sub}</div> : null}
    </div>
  )
}

export default async function ProDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) redirect('/login?from=/pro')

  const resolved = searchParams ? await searchParams : undefined
  const parsed = parseMonthParam(resolved?.month)

  const now = new Date()
  const active = parsed ? new Date(parsed.y, parsed.m - 1, 1) : startOfMonth(now)

  const monthStart = startOfMonth(active)
  const monthEnd = startOfNextMonth(active)

  const prevMonth = new Date(active.getFullYear(), active.getMonth() - 1, 1)
  const prevStart = startOfMonth(prevMonth)
  const prevEnd = startOfNextMonth(prevMonth)

  const proId = user.professionalProfile.id

  const [cur, prev] = await Promise.all([
    getMonthlyStats(proId, monthStart, monthEnd),
    getMonthlyStats(proId, prevStart, prevEnd),
  ])

  const prevHref = `/pro?month=${monthKey(prevMonth)}`
  const nextMonth = new Date(active.getFullYear(), active.getMonth() + 1, 1)
  const nextHref = `/pro?month=${monthKey(nextMonth)}`

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
        <div className="text-[16px] font-black text-textPrimary">{monthLabel(active)}</div>
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
          value={`$${moneyToString(cur.revenueTotal) ?? '0.00'}`}
          sub={
            <>
              vs last month:{' '}
              <Delta cur={cur.revenueTotal} prev={prev.revenueTotal} />
            </>
          }
        />
        <StatCard
          label="Tips"
          value={`$${moneyToString(cur.tipsCents) ?? '0.00'}`}
          sub={
            <>
              vs last month:{' '}
              <Delta cur={cur.tipsCents} prev={prev.tipsCents} />
            </>
          }
        />
        <StatCard
          label="Total clients (seen this month)"
          value={`${cur.totalClients}`}
          sub={
            <>
              vs last month:{' '}
              <Delta cur={cur.totalClients} prev={prev.totalClients} />
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
        <div className="tovis-glass rounded-card border border-white/10 p-4">
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
            Counts are based on COMPLETED bookings in this month.
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
            value={cur.topProductName ? cur.topProductName : 'Not tracked yet'}
            sub={cur.topProductName ? `${cur.topProductQty} sold` : 'Add ProductSale tracking to enable this'}
          />
        </div>
      </div>

      {/* Deep links */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/pro/services"
          className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          Services
        </Link>
        <Link
          href="/pro/reviews"
          className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          Reviews
        </Link>
        <Link
          href="/pro/public-profile"
          className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          Public profile
        </Link>
        <Link
          href="/pro/media"
          className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          Media
        </Link>
      </div>
    </main>
  )
}
