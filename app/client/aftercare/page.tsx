// app/client/aftercare/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { COPY } from '@/lib/copy'
import { formatInTimeZone } from '@/lib/FormatInTimeZone'
import { buildClientBookingDTO, type ClientBookingDTO } from '@/lib/dto/clientBooking'

export const dynamic = 'force-dynamic'

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

function formatDateInTz(d: Date, timeZone: string) {
  return formatInTimeZone(d, timeZone, {
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
  booking: any | null
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
          // minimum select to build ClientBookingDTO truthfully
          id: true,
          status: true,
          source: true,
          sessionStep: true,
          scheduledFor: true,
          finishedAt: true,

          subtotalSnapshot: true,
          totalDurationMinutes: true,
          bufferMinutes: true,

          locationType: true,
          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,

          service: { select: { id: true, name: true } },

          professional: { select: { id: true, businessName: true, location: true, timeZone: true } },

          location: {
            select: {
              id: true,
              name: true,
              formattedAddress: true,
              city: true,
              state: true,
              timeZone: true,
            },
          },

          serviceItems: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            take: 80,
            select: {
              id: true,
              itemType: true,
              parentItemId: true,
              sortOrder: true,
              durationMinutesSnapshot: true,
              priceSnapshot: true,
              serviceId: true,
              service: { select: { name: true } },
            },
          },

          consultationNotes: true,
          consultationPrice: true,
          consultationConfirmedAt: true,
          consultationApproval: {
            select: {
              status: true,
              proposedServicesJson: true,
              proposedTotal: true,
              notes: true,
              approvedAt: true,
              rejectedAt: true,
            },
          },
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
            const raw = n.booking

            const bookingId = safeId(raw?.id ?? n.bookingId)
            const isUnread = !n.readAt

            // Build DTO when booking is present; fall back gracefully when missing
            let dto: ClientBookingDTO | null = null
            try {
              if (raw) {
                dto = buildClientBookingDTO({
                  booking: raw as any,
                  unreadAftercare: false,
                  hasPendingConsultationApproval: false,
                })
              }
            } catch {
              dto = null
            }

            const title = dto?.display?.title || safeText(n.title, COPY.aftercareInbox.serviceFallback)

            const proId = dto?.professional?.id ?? raw?.professional?.id ?? null
            const proName = safeText(dto?.professional?.businessName ?? raw?.professional?.businessName, COPY.aftercareInbox.proFallback)

            const tz = dto?.timeZone || 'UTC'
            const date = toDate(dto?.scheduledFor || raw?.scheduledFor)
            const dateLabel = date ? formatDateInTz(date, tz) : ''

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
                      {title}
                      {isUnread ? <SmallPill label={COPY.aftercareInbox.newPill} /> : null}
                    </div>

                    <div className="text-textSecondary" style={{ fontSize: 12 }}>
                      {dateLabel ? `${dateLabel} · ${tz}` : ''}
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
                      aria-label={`Open aftercare: ${title}`}
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
