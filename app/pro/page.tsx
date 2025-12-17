// app/pro/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { moneyToString } from '@/lib/money'
import MonthlySourcePie from './MonthlySourcePie'

export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

function parseMonthParam(raw: unknown) {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
  // Expected: YYYY-MM
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
  // We’ll count “clients seen” as COMPLETED bookings in that month.
  // You can loosen this later (ACCEPTED too), but COMPLETED is the cleanest.
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
      scheduledFor: true,
      priceSnapshot: true,
      tipAmount: true,
    },
  })

  const bookingIds = bookingsInMonth.map((b) => b.id)
  const clientIds = Array.from(new Set(bookingsInMonth.map((b) => b.clientId)))

  // Service revenue = sum(priceSnapshot) for completed bookings that month (NOT tips)
  const serviceRevenueCents = bookingsInMonth.reduce((sum, b) => {
    const n = Number(b.priceSnapshot ?? 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  const tipsCents = bookingsInMonth.reduce((sum, b) => {
    const n = Number(b.tipAmount ?? 0)
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)

  // Rating for reviews CREATED that month
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

  // Retention: % of clients seen this month who have ANY future booking scheduled (not cancelled)
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

  // Most booked service (count by serviceId)
  const serviceCounts = new Map<string, number>()
  for (const b of bookingsInMonth) {
    serviceCounts.set(b.serviceId, (serviceCounts.get(b.serviceId) ?? 0) + 1)
  }
  const topServiceId = Array.from(serviceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topServiceCount = topServiceId ? serviceCounts.get(topServiceId) ?? 0 : 0

  const topService = topServiceId
    ? await prisma.service.findUnique({ where: { id: topServiceId }, select: { name: true } })
    : null

  // Booking source breakdown
  const sourceCounts = { REQUESTED: 0, DISCOVERY: 0, AFTERCARE: 0 }
  for (const b of bookingsInMonth) {
    if (b.source === 'REQUESTED') sourceCounts.REQUESTED += 1
    else if (b.source === 'AFTERCARE') sourceCounts.AFTERCARE += 1
    else sourceCounts.DISCOVERY += 1
  }

  // New vs return logic:
  // - New = client has no prior completed booking before monthStart
  // - Return = client has prior completed booking before monthStart
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

  let NR = 0 // New Request (REQUESTED + new)
  let NNR = 0 // New Non-Request (DISCOVERY + new)
  let RR = 0 // Return Request (REQUESTED + return)
  let AR = 0 // Aftercare Rebook (AFTERCARE)
  for (const b of bookingsInMonth) {
    const isReturn = priorClientSet.has(b.clientId)
    if (b.source === 'AFTERCARE') {
      AR += 1
    } else if (b.source === 'REQUESTED') {
      if (isReturn) RR += 1
      else NR += 1
    } else {
      // DISCOVERY
      if (!isReturn) NNR += 1
      // “Return discovery” exists but you didn’t ask for it, so we’re not making a new label.
    }
  }

  // NRB (No Rebook) as-of-now: clients seen this month who do NOT currently have a future booking
  const noRebookCount = clientIds.length ? clientIds.filter((id) => !retainedClientIds.has(id)).length : 0

  // Product stats (only if ProductSale model exists)
  let productRevenue = 0
  let topProductName: string | null = null
  let topProductQty = 0

 const hasProductSale = typeof (prisma as any).productSale?.findMany === 'function'

  if (hasProductSale) {
    const sales = await (prisma as any).productSale.findMany({
      where: { professionalId: proId, createdAt: { gte: monthStart, lt: monthEnd } },
      select: { productId: true, quantity: true, unitPrice: true },
    })

    productRevenue = sales.reduce((sum: number, s: any) => sum + Number(s.unitPrice ?? 0) * Number(s.quantity ?? 0), 0)

    const qtyByProduct = new Map<string, number>()
    for (const s of sales) qtyByProduct.set(s.productId, (qtyByProduct.get(s.productId) ?? 0) + (s.quantity ?? 0))

    const top = Array.from(qtyByProduct.entries()).sort((a, b) => b[1] - a[1])[0]
    if (top) {
      topProductQty = top[1]
      const p = await prisma.product.findUnique({ where: { id: top[0] }, select: { name: true } })
      topProductName = p?.name ?? null
    }
  }

  const revenueTotal = serviceRevenueCents + productRevenue // NOT tips

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
    rawSourceCounts: sourceCounts,
    bookingCount: bookingsInMonth.length,
  }
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 900, color: '#111' }}>{value}</div>
      {sub ? <div style={{ marginTop: 4, fontSize: 11, color: '#6b7280' }}>{sub}</div> : null}
    </div>
  )
}

function Delta({ cur, prev, suffix = '' }: { cur: number; prev: number; suffix?: string }) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const color = delta > 0 ? '#16a34a' : delta < 0 ? '#b91c1c' : '#6b7280'
  return <span style={{ color, fontWeight: 800 }}>{`${sign}${delta}${suffix}`}</span>
}

export default async function ProDashboardPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
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
    <main style={{ maxWidth: 960, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      {/* Month scroller */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 18 }}>
        <Link href={prevHref} style={{ textDecoration: 'none', fontWeight: 900, fontSize: 18, color: '#111' }}>
          ←
        </Link>
        <div style={{ fontWeight: 900, fontSize: 18 }}>{monthLabel(active)}</div>
        <Link href={nextHref} style={{ textDecoration: 'none', fontWeight: 900, fontSize: 18, color: '#111' }}>
          →
        </Link>
      </div>

      {/* Top cards */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <StatCard
          label="Revenue (services + products, no tips)"
          value={`$${moneyToString(cur.revenueTotal) ?? '0.00'}`}
          sub={`vs last month: `}
        />
        <StatCard
          label="Tips"
          value={`$${moneyToString(cur.tipsCents) ?? '0.00'}`}
          sub={`vs last month: `}
        />

        <StatCard
          label="Total clients (seen this month)"
          value={`${cur.totalClients}`}
          sub={`vs last month: `}
        />
        <StatCard
          label="Rating (this month only)"
          value={cur.monthlyAvgRating != null ? `${cur.monthlyAvgRating} ★` : '–'}
          sub={`${cur.monthlyReviewCount} review(s)`}
        />

        <StatCard
          label="Retention"
          value={`${cur.retentionPct}%`}
          sub={`${cur.retainedCount} of ${cur.totalClients} clients have a future booking`}
        />
        <StatCard
          label="No Rebook (yet)"
          value={`${cur.noRebookCount}`}
          sub={`Clients seen this month with no future booking scheduled`}
        />
      </div>

      {/* Comparison strip (simple, readable) */}
      <div style={{ marginTop: 14, border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Compared to {monthLabel(prevMonth)}</div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', fontSize: 13 }}>
          <div>
            Revenue: <b>${moneyToString(cur.revenueTotal) ?? '0.00'}</b> ({<Delta cur={cur.revenueTotal} prev={prev.revenueTotal} />})
          </div>
          <div>
            Clients: <b>{cur.totalClients}</b> ({<Delta cur={cur.totalClients} prev={prev.totalClients} />})
          </div>
          <div>
            Retention: <b>{cur.retentionPct}%</b> ({<Delta cur={cur.retentionPct} prev={prev.retentionPct} suffix="%" />})
          </div>
          <div>
            Rating: <b>{cur.monthlyAvgRating ?? 0}</b> ({<Delta cur={cur.monthlyAvgRating ?? 0} prev={prev.monthlyAvgRating ?? 0} />})
          </div>
        </div>
      </div>

      {/* Pie + “top” stats */}
      <div style={{ marginTop: 14, display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ border: '1px solid #eee', borderRadius: 14, padding: 12, background: '#fff' }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Bookings breakdown</div>
          <MonthlySourcePie
            data={[
              { label: 'NNR', value: cur.breakdown.NNR }, // discovery new
              { label: 'NR', value: cur.breakdown.NR },   // requested new
              { label: 'RR', value: cur.breakdown.RR },   // requested return
              { label: 'AR', value: cur.breakdown.AR },   // aftercare rebook
              { label: 'NRB', value: cur.breakdown.NRB }, // not rebooked yet
            ]}
          />
          <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
            Counts are based on COMPLETED bookings in this month.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
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

      {/* Deep links to other pro pages */}
      <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link href="/pro/services" style={{ textDecoration: 'none', border: '1px solid #111', padding: '8px 12px', borderRadius: 999, color: '#111', fontSize: 12 }}>
          Services
        </Link>
        <Link href="/pro/reviews" style={{ textDecoration: 'none', border: '1px solid #111', padding: '8px 12px', borderRadius: 999, color: '#111', fontSize: 12 }}>
          Reviews
        </Link>
        <Link href="/pro/public-profile" style={{ textDecoration: 'none', border: '1px solid #111', padding: '8px 12px', borderRadius: 999, color: '#111', fontSize: 12 }}>
          Public profile
        </Link>
      </div>
    </main>
  )
}
