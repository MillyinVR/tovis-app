// app/pro/notifications/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type NotificationType = 'BOOKING_REQUEST' | 'BOOKING_UPDATE' | 'REVIEW'

type NotificationItem = {
  id: string
  type: NotificationType
  title: string
  body: string
  createdAt: Date
  href: string
}

function formatTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function typeLabel(t: NotificationType) {
  if (t === 'BOOKING_REQUEST') return 'Booking request'
  if (t === 'BOOKING_UPDATE') return 'Booking update'
  return 'New review'
}

function typeColor(t: NotificationType) {
  if (t === 'BOOKING_REQUEST') return '#f97316'
  if (t === 'BOOKING_UPDATE') return '#2563eb'
  return '#22c55e'
}

export default async function ProNotificationsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/notifications')
  }

  const db: any = prisma
  const proId = user.professionalProfile.id

  const [pendingBookings, recentBookings, recentReviews] = await Promise.all([
    db.booking.findMany({
      where: { professionalId: proId, status: 'PENDING' },
      include: { client: true, service: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.booking.findMany({
      where: {
        professionalId: proId,
        status: { in: ['ACCEPTED', 'CANCELLED', 'COMPLETED'] },
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      include: { client: true, service: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    db.review.findMany({
      where: { professionalId: proId },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const items: NotificationItem[] = []

  for (const b of pendingBookings) {
    const first = (b.client?.firstName || '').trim()
    const last = (b.client?.lastName || '').trim()
    const clientName = `${first} ${last}`.trim() || 'Client'

    items.push({
      id: `req_${b.id}`,
      type: 'BOOKING_REQUEST',
      title: `New booking request: ${b.service?.name || 'Service'}`,
      body: `${clientName} requested ${b.service?.name || 'a service'}`,
      createdAt: b.createdAt,
      // your bookings page doesn’t actually have tabs, so don’t lie to the URL
      href: '/pro/bookings',
    })
  }

  for (const b of recentBookings) {
    const first = (b.client?.firstName || '').trim()
    const last = (b.client?.lastName || '').trim()
    const clientName = `${first} ${last}`.trim() || 'Client'

    let verb = 'Updated'
    if (b.status === 'ACCEPTED') verb = 'Accepted'
    else if (b.status === 'CANCELLED') verb = 'Cancelled'
    else if (b.status === 'COMPLETED') verb = 'Completed'

    items.push({
      id: `book_${b.id}_${b.updatedAt.getTime()}`,
      type: 'BOOKING_UPDATE',
      title: `${verb} booking: ${b.service?.name || 'Service'}`,
      body: `${clientName} • ${formatTime(b.scheduledFor)}`,
      createdAt: b.updatedAt,
      href: `/pro/bookings/${b.id}`,
    })
  }

  for (const r of recentReviews) {
    const first = (r.client?.firstName || '').trim()
    const last = (r.client?.lastName || '').trim()
    const clientName = `${first} ${last}`.trim() || 'Client'

    const preview =
      r.headline ||
      (r.body ? r.body.slice(0, 80) + (r.body.length > 80 ? '…' : '') : '')

    items.push({
      id: `rev_${r.id}`,
      type: 'REVIEW',
      title: `New review from ${clientName}`,
      body: preview,
      createdAt: r.createdAt,
      // this relies on your /pro/reviews having <article id={`review-${rev.id}`}/>
      href: `/pro/reviews#review-${r.id}`,
    })
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '8px 16px 80px',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        Notifications
      </h1>

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: '#777', marginTop: 4 }}>
          No notifications yet.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
          {items.map((n) => (
            <Link
              key={n.id}
              href={n.href}
              style={{ textDecoration: 'none', color: 'inherit' }}
              prefetch={false}
            >
              <article
                style={{
                  borderRadius: 10,
                  border: '1px solid #eee',
                  padding: 10,
                  background: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                title="Open"
              >
                <div
                  style={{
                    fontSize: 11,
                    marginBottom: 4,
                    color: typeColor(n.type),
                  }}
                >
                  {typeLabel(n.type)}
                </div>

                <div style={{ fontWeight: 600, marginBottom: 2 }}>{n.title}</div>

                {n.body ? (
                  <div style={{ color: '#555', marginBottom: 4 }}>{n.body}</div>
                ) : null}

                <div style={{ fontSize: 11, color: '#999' }}>
                  {formatTime(n.createdAt)}
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
