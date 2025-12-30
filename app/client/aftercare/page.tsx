// app/client/aftercare/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function formatDate(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type InboxRow = {
  id: string
  title: string | null
  body: string | null
  readAt: Date | null
  createdAt: Date
  bookingId: string | null
  aftercareId: string | null
  booking: {
    id: string
    scheduledFor: Date
    service: { name: string | null } | null
    professional: { businessName: string | null } | null
  } | null
  aftercare: {
    rebookMode: string | null
    rebookedFor: Date | null
  } | null
}

export default async function ClientAftercareInboxPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/aftercare')
  }

  const items = (await prisma.clientNotification.findMany({
    where: {
      clientId: user.clientProfile.id,
      type: 'AFTERCARE',
    } as any,
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      id: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      bookingId: true,
      aftercareId: true,
      booking: {
        select: {
          id: true,
          scheduledFor: true,
          service: { select: { name: true } },
          professional: { select: { businessName: true } },
        },
      },
      aftercare: {
        select: {
          rebookMode: true,
          rebookedFor: true,
        },
      },
    },
  })) as InboxRow[]

  return (
    <main style={{ maxWidth: 860, margin: '28px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Aftercare</h1>
      <div style={{ marginTop: 6, color: '#6b7280', fontSize: 13 }}>
        Every aftercare summary you’ve received, all in one place. Humans love reinventing inboxes.
      </div>

      {items.length === 0 ? (
        <div style={{ marginTop: 18, border: '1px solid #eee', borderRadius: 14, background: '#fff', padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Nothing yet</div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>After your appointments, your pro will post aftercare here.</div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {items.map((n) => {
            const b = n.booking
            const bookingId = b?.id || n.bookingId
            const serviceName = b?.service?.name ?? n.title ?? 'Aftercare'
            const date = b?.scheduledFor instanceof Date ? b.scheduledFor : null
            const proName = b?.professional?.businessName ?? 'Your pro'
            const isUnread = !n.readAt

            const mode = String(n.aftercare?.rebookMode || '').toUpperCase()
            const hint =
              mode === 'RECOMMENDED_WINDOW'
                ? 'Recommended booking window'
                : n.aftercare?.rebookedFor
                  ? 'Recommended rebook date'
                  : 'Aftercare notes'

            const href =
              bookingId && typeof bookingId === 'string' && bookingId.trim()
                ? `/client/bookings/${encodeURIComponent(bookingId)}?step=aftercare`
                : null

            return (
              <a
                key={n.id}
                href={href || '#'}
                style={{
                  textDecoration: 'none',
                  color: '#111',
                  border: '1px solid #eee',
                  borderRadius: 14,
                  background: '#fff',
                  padding: 14,
                  display: 'grid',
                  gap: 6,
                  opacity: href ? 1 : 0.6,
                  pointerEvents: href ? 'auto' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 900 }}>
                    {serviceName}{' '}
                    {isUnread ? (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          fontWeight: 900,
                          padding: '3px 8px',
                          borderRadius: 999,
                          border: '1px solid #fde68a',
                          background: '#fffbeb',
                          color: '#854d0e',
                          letterSpacing: 0.3,
                        }}
                      >
                        NEW
                      </span>
                    ) : null}
                  </div>

                  <div style={{ fontSize: 12, color: '#6b7280' }}>{date ? formatDate(date) : ''}</div>
                </div>

                <div style={{ fontSize: 13, color: '#374151' }}>{proName}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{hint}</div>

                {n.body ? (
                  <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.35 }}>
                    {n.body}
                  </div>
                ) : null}
              </a>
            )
          })}
        </div>
      )}
    </main>
  )
}
