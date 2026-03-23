// app/client/aftercare/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { COPY } from '@/lib/copy'
import { formatInTimeZone } from '@/lib/formatInTimeZone'
import { buildClientBookingDTO, type ClientBookingDTO } from '@/lib/dto/clientBooking'
import { DEFAULT_TIME_ZONE, sanitizeTimeZone } from '@/lib/timeZone'
import { AftercareRebookMode, ClientNotificationType, ConsultationApprovalStatus, Prisma } from '@prisma/client'

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
  const tz = sanitizeTimeZone(timeZone, DEFAULT_TIME_ZONE)
  return formatInTimeZone(d, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function SmallPill({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-accentPrimary/35 bg-accentPrimary/12 px-2 py-0.5 text-[10px] font-black tracking-wide text-accentPrimary">
      {label}
    </span>
  )
}

// ✅ Booking shape must match ClientBookingRow expectations from buildClientBookingDTO
const bookingSelect = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  status: true,
  source: true,
  sessionStep: true,
  scheduledFor: true,
  finishedAt: true,

  subtotalSnapshot: true,
  serviceSubtotalSnapshot: true,
  productSubtotalSnapshot: true,
  tipAmount: true,
  taxAmount: true,
  discountAmount: true,
  totalAmount: true,
  checkoutStatus: true,
  selectedPaymentMethod: true,
  paymentAuthorizedAt: true,
  paymentCollectedAt: true,
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
    orderBy: { sortOrder: 'asc' },
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

    productSales: {
    orderBy: { createdAt: 'asc' },
    take: 80,
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true } },
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
})

const inboxSelect = Prisma.validator<Prisma.ClientNotificationSelect>()({
  id: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  bookingId: true,
  aftercareId: true,
  booking: { select: bookingSelect },
  aftercare: { select: { rebookMode: true, rebookedFor: true } },
})

type InboxItem = Prisma.ClientNotificationGetPayload<{ select: typeof inboxSelect }>

export default async function ClientAftercareInboxPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/aftercare')
  }

  const items: InboxItem[] = await prisma.clientNotification.findMany({
    where: {
      clientId: user.clientProfile.id,
      type: ClientNotificationType.AFTERCARE,
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: inboxSelect,
  })

  const rows = await Promise.all(
    items.map(async (n) => {
      const raw = n.booking

      let dto: ClientBookingDTO | null = null
      if (raw) {
        const hasPendingConsultationApproval = raw.consultationApproval?.status === ConsultationApprovalStatus.PENDING
        try {
          dto = await buildClientBookingDTO({
            booking: raw,
            unreadAftercare: !n.readAt,
            hasPendingConsultationApproval,
          })
        } catch {
          dto = null
        }
      }

      return { n, raw, dto }
    }),
  )

  return (
    <main className="mx-auto w-full max-w-860px px-4 pb-24 pt-7 text-textPrimary">
      <h1 className="text-[22px] font-black">{COPY.aftercareInbox.title}</h1>
      <div className="mt-1 text-[13px] font-semibold text-textSecondary">{COPY.aftercareInbox.subtitle}</div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black text-textPrimary">{COPY.aftercareInbox.emptyTitle}</div>
          <div className="mt-1 text-[13px] font-semibold text-textSecondary">{COPY.aftercareInbox.emptyBody}</div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {rows.map(({ n, raw, dto }) => {
            const bookingId = safeId(dto?.id ?? raw?.id ?? n.bookingId)
            const href = bookingId ? `/client/bookings/${encodeURIComponent(bookingId)}?step=aftercare` : null

            const isUnread = !n.readAt
            const title = dto?.display?.title || safeText(n.title, COPY.aftercareInbox.serviceFallback)

            const proId = dto?.professional?.id ?? raw?.professional?.id ?? null
            const proName = safeText(
              dto?.professional?.businessName ?? raw?.professional?.businessName,
              COPY.aftercareInbox.proFallback,
            )

            const tz = sanitizeTimeZone(dto?.timeZone, DEFAULT_TIME_ZONE)

            const date = toDate(dto?.scheduledFor ?? raw?.scheduledFor)
            const dateLabel = date ? formatDateInTz(date, tz) : ''

            const mode = n.aftercare?.rebookMode ?? null
            const hint =
              mode === AftercareRebookMode.RECOMMENDED_WINDOW
                ? COPY.aftercareInbox.hintRecommendedWindow
                : n.aftercare?.rebookedFor
                  ? COPY.aftercareInbox.hintRecommendedDate
                  : COPY.aftercareInbox.hintNotes

            return (
              <div
                key={n.id}
                className={[
                  'rounded-card border border-white/10 bg-bgSecondary p-4',
                  href ? '' : 'opacity-70',
                ].join(' ')}
              >
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="text-[14px] font-black text-textPrimary">
                      {title}
                      {isUnread ? <SmallPill label={COPY.aftercareInbox.newPill} /> : null}
                    </div>

                    <div className="text-[12px] font-semibold text-textSecondary">
                      {dateLabel ? (
                        <>
                          {dateLabel} <span className="opacity-75">· {tz}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <ProProfileLink
                      proId={proId}
                      label={proName}
                      className="text-textSecondary font-semibold hover:opacity-80"
                    />
                  </div>

                  <div className="text-[12px] font-semibold text-textSecondary/90">{hint}</div>

                  {n.body ? (
                    <div className="text-[12px] font-semibold leading-snug text-textSecondary/90">{n.body}</div>
                  ) : null}

                  {href ? (
                    <Link
                      href={href}
                      aria-label={`Open aftercare: ${title}`}
                      className="mt-1 inline-flex w-fit rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
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