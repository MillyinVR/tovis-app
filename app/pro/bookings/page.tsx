// app/pro/bookings/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import BookingActions from './BookingActions'
import { moneyToString } from '@/lib/money'

export const dynamic = 'force-dynamic'

type BookingRow = {
  id: string
  status: string
  scheduledFor: Date
  startedAt: Date | null
  finishedAt: Date | null
  durationMinutesSnapshot: number
  priceSnapshot: any
  discountAmount: any | null
  totalAmount: any | null
  service: { name: string }
  client: {
    id: string
    firstName: string
    lastName: string
    phone: string | null
    user: { email: string } | null
  }
}

function formatDate(d: Date) {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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

function moneyNumber(maybeMoney: any) {
  if (maybeMoney == null) return 0
  if (typeof maybeMoney === 'number') return Number.isFinite(maybeMoney) ? maybeMoney : 0
  if (typeof maybeMoney === 'string') {
    const n = Number(maybeMoney)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof maybeMoney?.toNumber === 'function') {
    const n = maybeMoney.toNumber()
    return Number.isFinite(n) ? n : 0
  }
  try {
    const n = Number(String(maybeMoney))
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function PriceBlock({ b }: { b: BookingRow }) {
  const baseStr = moneyToString(b.priceSnapshot) ?? '0.00'
  const discountStr = b.discountAmount != null ? moneyToString(b.discountAmount) ?? '0.00' : null
  const totalStr = b.totalAmount != null ? moneyToString(b.totalAmount) ?? baseStr : baseStr

  const discountNum = moneyNumber(b.discountAmount)

  if (discountNum > 0) {
    return (
      <div style={{ display: 'grid', gap: 2 }}>
        <div>
          Base:{' '}
          <span style={{ textDecoration: 'line-through' }}>
            ${baseStr}
          </span>
        </div>
        <div>Last-minute discount: -${discountStr ?? '0.00'}</div>
        <div style={{ color: '#111', fontWeight: 800 }}>Total: ${totalStr ?? '0.00'}</div>
      </div>
    )
  }

  return <div>Price: ${totalStr ?? baseStr}</div>
}

function Section({ title, items }: { title: string; items: BookingRow[] }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{title}</h2>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280' }}>No bookings here yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map((b) => (
            <div
              key={b.id}
              style={{
                borderRadius: 14,
                border: '1px solid #eee',
                padding: 12,
                background: '#fff',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
                  {b.service.name}
                </div>

                <div style={{ fontSize: 12, color: '#4b5563' }}>
                  <a
                    href={`/pro/clients/${b.client.id}`}
                    style={{ color: '#111', textDecoration: 'underline' }}
                  >
                    {b.client.firstName} {b.client.lastName}
                  </a>
                  {b.client.user?.email ? ` • ${b.client.user.email}` : ''}
                  {b.client.phone ? ` • ${b.client.phone}` : ''}
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  {formatDate(b.scheduledFor)} • {Math.round(b.durationMinutesSnapshot)} min
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                  <PriceBlock b={b} />
                </div>

                <a
                  href={`/pro/bookings/${b.id}`}
                  style={{
                    fontSize: 11,
                    color: '#111',
                    textDecoration: 'underline',
                    marginTop: 8,
                    display: 'inline-block',
                  }}
                >
                  Details &amp; aftercare
                </a>
              </div>

              <div style={{ minWidth: 180, textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 11,
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid #ddd',
                    marginBottom: 8,
                  }}
                >
                  {formatStatus(b.status)}
                </div>

                <BookingActions
                  bookingId={b.id}
                  currentStatus={b.status}
                  startedAt={b.startedAt ? b.startedAt.toISOString() : null}
                  finishedAt={b.finishedAt ? b.finishedAt.toISOString() : null}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default async function ProBookingsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/bookings')
  }

  const proId = user.professionalProfile.id

  const bookings = (await prisma.booking.findMany({
    where: { professionalId: proId },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      durationMinutesSnapshot: true,
      priceSnapshot: true,
      discountAmount: true,
      totalAmount: true,
      service: { select: { name: true } },
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          user: { select: { email: true } },
        },
      },
    },
  })) as BookingRow[]

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  const todayBookings = bookings.filter((b) => b.scheduledFor >= startOfToday && b.scheduledFor < endOfToday)
  const upcomingBookings = bookings.filter((b) => b.scheduledFor >= endOfToday)
  const pastBookings = bookings.filter((b) => b.scheduledFor < startOfToday)

  return (
    <main style={{ maxWidth: 960, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>Bookings</h1>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Today, upcoming, and past.</div>
      </header>

      <Section title="Today" items={todayBookings} />
      <Section title="Upcoming" items={upcomingBookings} />
      <Section title="Past" items={pastBookings} />
    </main>
  )
}
