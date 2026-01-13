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

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
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
      <h1 className="text-textPrimary" style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>
        Aftercare
      </h1>
      <div className="text-textSecondary" style={{ marginTop: 6, fontSize: 13 }}>
        Every aftercare summary you’ve received, all in one place. Humans love reinventing inboxes.
      </div>

      {items.length === 0 ? (
        <div
          className="border border-surfaceGlass/10 bg-bgSecondary"
          style={{ marginTop: 18, borderRadius: 14, padding: 16 }}
        >
          <div className="text-textPrimary" style={{ fontWeight: 900, marginBottom: 6 }}>
            Nothing yet
          </div>
          <div className="text-textSecondary" style={{ fontSize: 13 }}>
            After your appointments, your pro will post aftercare here.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {items.map((n) => {
            const b = n.booking
            const bookingId = b?.id || n.bookingId
            const serviceName = b?.service?.name ?? n.title ?? 'Aftercare'
            const date = toDate(b?.scheduledFor)
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
                className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
                style={{
                  textDecoration: 'none',
                  borderRadius: 14,
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
                        className="border border-accentPrimary/35 bg-accentPrimary/12 text-accentPrimary"
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          fontWeight: 900,
                          padding: '3px 8px',
                          borderRadius: 999,
                          letterSpacing: 0.3,
                        }}
                      >
                        NEW
                      </span>
                    ) : null}
                  </div>

                  <div className="text-textSecondary" style={{ fontSize: 12 }}>
                    {date ? formatDate(date) : ''}
                  </div>
                </div>

                <div className="text-textSecondary" style={{ fontSize: 13 }}>
                  {proName}
                </div>
                <div className="text-textSecondary" style={{ fontSize: 12, opacity: 0.85 }}>
                  {hint}
                </div>

                {n.body ? (
                  <div className="text-textSecondary" style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.9 }}>
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
