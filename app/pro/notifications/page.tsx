// app/pro/notifications/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import MarkReadOnMount from './MarkReadOnMount'
import { getCurrentUser } from '@/lib/currentUser'
import type { NotificationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

type NotifRow = {
  id: string
  type: NotificationType
  title: string
  body: string
  href: string
  createdAt: string
  readAt: string | null
}

function formatTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function typeLabel(t: NotificationType) {
  if (t === 'BOOKING_REQUEST') return 'Booking request'
  if (t === 'BOOKING_UPDATE') return 'Booking update'
  return 'New review'
}

// no hex — using hsl
function typeColor(t: NotificationType) {
  if (t === 'BOOKING_REQUEST') return 'hsl(24 95% 53%)'
  if (t === 'BOOKING_UPDATE') return 'hsl(221 83% 53%)'
  return 'hsl(142 71% 45%)'
}

async function loadNotifications(): Promise<NotifRow[]> {
  // Server-side fetch to your API route
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/pro/notifications?take=60`, {
    // Important on Next: disable caching because notifications change constantly
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
  }).catch(() => null)

  if (!res || !res.ok) return []
  const json = (await res.json().catch(() => null)) as any
  const items = Array.isArray(json?.items) ? json.items : []

  return items.map((n: any) => ({
    id: String(n.id),
    type: n.type as NotificationType,
    title: String(n.title ?? ''),
    body: String(n.body ?? ''),
    href: String(n.href ?? ''),
    createdAt: String(n.createdAt),
    readAt: n.readAt ? String(n.readAt) : null,
  }))
}

export default async function ProNotificationsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/notifications')
  }

  const rows = await loadNotifications()

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '8px 16px 80px',
        fontFamily: 'system-ui',
      }}
    >
      <MarkReadOnMount />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Notifications</h1>
        <div style={{ fontSize: 12, color: 'hsl(215 16% 47%)' }}>
          {rows.length ? `Showing latest ${rows.length}` : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'hsl(215 16% 47%)', marginTop: 10 }}>
          No notifications yet.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {rows.map((n) => {
            const unread = !n.readAt
            const href = (n.href || '').trim() || '/pro/notifications'

            return (
              <Link key={n.id} href={href} style={{ textDecoration: 'none', color: 'inherit' }} prefetch={false}>
                <article
                  style={{
                    borderRadius: 12,
                    border: '1px solid hsl(220 13% 91%)',
                    padding: 12,
                    background: unread ? 'hsl(210 40% 98%)' : 'white',
                    fontSize: 13,
                    cursor: 'pointer',
                    boxShadow: unread ? '0 1px 0 hsl(220 13% 91%)' : 'none',
                  }}
                  title="Open"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontSize: 11, color: typeColor(n.type) }}>
                      {typeLabel(n.type)}
                      {unread ? <span style={{ marginLeft: 8, color: 'hsl(215 16% 47%)' }}>• Unread</span> : null}
                    </div>

                    <div style={{ fontSize: 11, color: 'hsl(215 16% 47%)' }}>
                      {formatTime(new Date(n.createdAt))}
                    </div>
                  </div>

                  <div style={{ fontWeight: 650, marginTop: 6, lineHeight: 1.25 }}>{n.title}</div>

                  {n.body ? (
                    <div style={{ color: 'hsl(215 19% 35%)', marginTop: 6, lineHeight: 1.35 }}>
                      {n.body}
                    </div>
                  ) : null}
                </article>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
