// app/client/aftercare/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { COPY } from '@/lib/copy'

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

function safeText(v: unknown, fallback: string) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : fallback
}

function safeId(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
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
    professional: { id: string; businessName: string | null } | null
  } | null
  aftercare: {
    rebookMode: string | null
    rebookedFor: Date | null
  } | null
}

function SmallPill({ label }: { label: string }) {
  return (
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
      {label}
    </span>
  )
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
          professional: { select: { id: true, businessName: true } },
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
    <main style={{ maxWidth: 860, margin: '28px auto 90px', padding: '0 16px' }}>
      <h1 className="text-textPrimary" style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>
        {COPY.aftercareInbox.title}
      </h1>

      <div className="text-textSecondary" style={{ marginTop: 6, fontSize: 13 }}>
        {COPY.aftercareInbox.subtitle}
      </div>

      {items.length === 0 ? (
        <div className="border border-surfaceGlass/10 bg-bgSecondary" style={{ marginTop: 18, borderRadius: 14, padding: 16 }}>
          <div className="text-textPrimary" style={{ fontWeight: 900, marginBottom: 6 }}>
            {COPY.aftercareInbox.emptyTitle}
          </div>
          <div className="text-textSecondary" style={{ fontSize: 13 }}>
            {COPY.aftercareInbox.emptyBody}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {items.map((n) => {
            const b = n.booking

            const bookingId = safeId(b?.id ?? n.bookingId)
            const serviceName = safeText(b?.service?.name ?? n.title, COPY.aftercareInbox.serviceFallback)
            const date = toDate(b?.scheduledFor)

            const proId = b?.professional?.id ?? null
            const proName = safeText(b?.professional?.businessName, COPY.aftercareInbox.proFallback)

            const isUnread = !n.readAt

            const mode = String(n.aftercare?.rebookMode || '').trim().toUpperCase()
            const hint =
              mode === 'RECOMMENDED_WINDOW'
                ? COPY.aftercareInbox.hintRecommendedWindow
                : n.aftercare?.rebookedFor
                  ? COPY.aftercareInbox.hintRecommendedDate
                  : COPY.aftercareInbox.hintNotes

            const href = bookingId ? `/client/bookings/${encodeURIComponent(bookingId)}?step=aftercare` : null

            return (
              <div
                key={n.id}
                className="border border-surfaceGlass/10 bg-bgSecondary text-textPrimary"
                style={{
                  borderRadius: 14,
                  padding: 14,
                  display: 'grid',
                  gap: 6,
                  position: 'relative',
                  opacity: href ? 1 : 0.6,
                }}
              >
                <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 900 }}>
                      {serviceName}
                      {isUnread ? <SmallPill label={COPY.aftercareInbox.newPill} /> : null}
                    </div>

                    <div className="text-textSecondary" style={{ fontSize: 12 }}>
                      {date ? formatDate(date) : ''}
                    </div>
                  </div>

                  {/* Pro link should always work (no overlay stealing clicks) */}
                  <div style={{ position: 'relative', zIndex: 2 }}>
                    <ProProfileLink proId={proId} label={proName} className="text-textSecondary font-semibold" />
                  </div>

                  <div className="text-textSecondary" style={{ fontSize: 12, opacity: 0.85 }}>
                    {hint}
                  </div>

                  {n.body ? (
                    <div className="text-textSecondary" style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.9 }}>
                      {n.body}
                    </div>
                  ) : null}

                  {/* Single, clean CTA to open the aftercare. Avoids nested anchors. */}
                  {href ? (
                    <Link
                      href={href}
                      aria-label={`Open aftercare: ${serviceName}`}
                      className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
                      style={{ justifySelf: 'start', textDecoration: 'none', marginTop: 6 }}
                    >
                      {COPY.aftercareInbox.openCta}
                    </Link>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
