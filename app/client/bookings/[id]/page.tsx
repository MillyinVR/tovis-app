// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'
import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'
import ConsultationDecisionCard from './ConsultationDecisionCard'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'
type StatusVariant = 'danger' | 'success' | 'warn' | 'info' | 'neutral'

function normalizeStep(raw: unknown): StepKey {
  const s = String(raw || '').toLowerCase().trim()
  if (s === 'consult' || s === 'consultation') return 'consult'
  if (s === 'aftercare') return 'aftercare'
  return 'overview'
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function normalizeTimeZone(raw: unknown, fallback: string) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const cleaned = sanitizeTimeZone(s, fallback) || fallback
  return isValidIanaTimeZone(cleaned) ? cleaned : fallback
}

function formatWhenInTimeZone(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function formatDateRangeInTimeZone(start: Date, end: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

function friendlyLocationType(v: unknown) {
  const s = upper(v)
  if (s === 'SALON') return 'In salon'
  if (s === 'MOBILE') return 'Mobile'
  return null
}

function friendlySource(v: unknown) {
  const s = upper(v)
  if (s === 'DISCOVERY') return 'Looks'
  if (s === 'REQUESTED') return 'Requested'
  if (s === 'AFTERCARE') return 'Aftercare rebook'
  return null
}

function statusPillVariant(statusRaw: unknown): Exclude<StatusVariant, 'neutral'> {
  const s = upper(statusRaw)
  if (s === 'CANCELLED') return 'danger'
  if (s === 'COMPLETED') return 'success'
  if (s === 'PENDING') return 'warn'
  return 'info'
}

function statusMessage(statusRaw: unknown): { title: string; body: string; variant: StatusVariant } {
  const s = upper(statusRaw)

  if (s === 'PENDING') {
    return {
      title: 'Request sent',
      body: 'Your professional hasn’t approved this yet. You’ll see it move to Confirmed once accepted.',
      variant: 'warn',
    }
  }

  if (s === 'ACCEPTED') {
    return {
      title: 'Confirmed',
      body: 'You’re booked. Show up cute and on time. Future-you will thank you.',
      variant: 'info',
    }
  }

  if (s === 'COMPLETED') {
    return {
      title: 'Completed',
      body: 'All done. Leave a review if you haven’t already (professionals live for that).',
      variant: 'success',
    }
  }

  if (s === 'CANCELLED') {
    return {
      title: 'Cancelled',
      body: 'This booking is cancelled. If you still want the service, book a new time.',
      variant: 'danger',
    }
  }

  return {
    title: 'Booking status',
    body: 'We’re tracking this booking. Status updates will show here.',
    variant: 'neutral',
  }
}

function formatMoneyLoose(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(2)}`
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim()
    if (s.startsWith('$')) return s
    const n = Number(s)
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`
    return s
  }
  return null
}

type AftercareRebookInfo =
  | { mode: 'BOOKED_NEXT_APPOINTMENT'; label: string }
  | { mode: 'RECOMMENDED_WINDOW'; label: string }
  | { mode: 'RECOMMENDED_DATE'; label: string }
  | { mode: 'NONE'; label: null }

function getAftercareRebookInfo(aftercare: any, timeZone: string): AftercareRebookInfo {
  const modeRaw = upper(aftercare?.rebookMode || 'NONE')

  if (modeRaw === 'BOOKED_NEXT_APPOINTMENT') {
    const d = toDate(aftercare?.rebookedFor)
    return d
      ? { mode: 'BOOKED_NEXT_APPOINTMENT', label: `Next appointment booked: ${formatWhenInTimeZone(d, timeZone)}` }
      : { mode: 'BOOKED_NEXT_APPOINTMENT', label: 'Next appointment booked.' }
  }

  if (modeRaw === 'RECOMMENDED_WINDOW') {
    const s = toDate(aftercare?.rebookWindowStart)
    const e = toDate(aftercare?.rebookWindowEnd)
    if (s && e) return { mode: 'RECOMMENDED_WINDOW', label: `Recommended rebook window: ${formatDateRangeInTimeZone(s, e, timeZone)}` }
    return { mode: 'RECOMMENDED_WINDOW', label: 'Recommended rebook window.' }
  }

  if (modeRaw === 'NONE') return { mode: 'NONE', label: null }

  const legacy = toDate(aftercare?.rebookedFor)
  if (legacy) return { mode: 'RECOMMENDED_DATE', label: `Recommended next visit: ${formatWhenInTimeZone(legacy, timeZone)}` }

  return { mode: 'NONE', label: null }
}

function pickToken(aftercare: any): string | null {
  const t = aftercare?.publicToken
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

function pillClassByVariant(_variant: Exclude<StatusVariant, 'neutral'>) {
  return 'border border-white/10 bg-bgPrimary text-textPrimary'
}

function alertClassByVariant(_variant: StatusVariant) {
  return 'border border-white/10 bg-bgSecondary'
}

function tabClass(active: boolean) {
  return [
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black transition',
    'border border-white/10',
    active ? 'bg-accentPrimary text-bgPrimary' : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}

function tabDisabledClass() {
  return [
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black',
    'border border-white/10 bg-bgPrimary text-textSecondary opacity-50 cursor-not-allowed select-none',
  ].join(' ')
}

function formatPrimaryLocationLine(loc: {
  formattedAddress: string | null
  name: string | null
  city: string | null
  state: string | null
} | null) {
  if (!loc) return ''
  return (
    loc.formattedAddress?.trim() ||
    loc.name?.trim() ||
    [loc.city, loc.state].filter(Boolean).join(', ') ||
    ''
  )
}

export default async function ClientBookingPage(props: {
  params: Promise<{ id: string }> | { id: string }
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}) {
  const resolvedParams = await Promise.resolve(props.params as any)
  const bookingId = String(resolvedParams?.id || '').trim()
  if (!bookingId) notFound()

  const sp = (await Promise.resolve(props.searchParams as any).catch(() => ({}))) ?? {}
  const step = normalizeStep((sp as any)?.step)

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      source: true,
      locationType: true,

      scheduledFor: true,
      locationId: true,
      locationTimeZone: true,

      totalDurationMinutes: true,
      subtotalSnapshot: true,

      service: { select: { id: true, name: true } },

      professional: {
        select: {
          id: true,
          businessName: true,
          timeZone: true,
          user: { select: { email: true } },
          locations: {
            where: { isPrimary: true },
            take: 1,
            select: {
              name: true,
              formattedAddress: true,
              city: true,
              state: true,
              timeZone: true,
            },
          },
        },
      },

      // Keep these only if they really exist in your schema (they did in your paste).
      // If Prisma types complain here, comment them out.
      aftercareSummary: true,
      consultationApproval: true,
    },
  })

  if (!booking) notFound()
  if (booking.clientId !== user.clientProfile.id) redirect('/client/bookings')

  // Reviews (unchanged)
  const existingReview = await prisma.review.findFirst({
    where: { bookingId: booking.id, clientId: user.clientProfile.id },
    include: {
      mediaAssets: {
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          createdAt: true,
          isFeaturedInPortfolio: true,
          isEligibleForLooks: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const scheduled = toDate(booking.scheduledFor)

  // ✅ Timezone truth order: booking.locationTimeZone -> location.timeZone -> pro.timeZone -> fallback
  let appointmentTz = normalizeTimeZone(booking.locationTimeZone, 'America/Los_Angeles')

  const primaryLoc = booking.professional?.locations?.[0] ?? null
  if (!booking.locationTimeZone && primaryLoc?.timeZone) {
    appointmentTz = normalizeTimeZone(primaryLoc.timeZone, appointmentTz)
  }

  if (!booking.locationTimeZone && !primaryLoc?.timeZone) {
    appointmentTz = normalizeTimeZone(booking.professional?.timeZone, appointmentTz)
  }

  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : 'Unknown time'
  const locLine = formatPrimaryLocationLine(primaryLoc)

  const pillVariant = statusPillVariant(booking.status)
  const msg = statusMessage(booking.status)

  const durationMinutes =
    typeof booking.totalDurationMinutes === 'number' && booking.totalDurationMinutes > 0
      ? booking.totalDurationMinutes
      : null

  const basePriceLabel = formatMoneyLoose(booking.subtotalSnapshot) ?? null
  const modeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)

  const aftercare = (booking as any).aftercareSummary ?? null
  const consultationApproval = (booking as any).consultationApproval ?? null

  const rebookInfo = aftercare ? getAftercareRebookInfo(aftercare, appointmentTz) : { mode: 'NONE' as const, label: null }
  const aftercareToken = aftercare ? pickToken(aftercare) : null
  const showRebookCTA = upper(booking.status) === 'COMPLETED' && Boolean(aftercareToken)

  const statusUpper = upper(booking.status)
  const sessionStepUpper = upper((booking as any).sessionStep || 'NONE')

  const showConsultationApproval =
    upper(consultationApproval?.status) === 'PENDING' &&
    sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' &&
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED'

  const canShowConsultTab =
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED' &&
    statusUpper !== 'PENDING' &&
    (sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' || showConsultationApproval)

  const canShowAftercareTab = statusUpper === 'COMPLETED' || Boolean(aftercare?.id)

  const baseHref = `/client/bookings/${encodeURIComponent(booking.id)}`

  if (step === 'consult' && !canShowConsultTab) redirect(`${baseHref}?step=overview`)
  if (step === 'aftercare' && !canShowAftercareTab) redirect(`${baseHref}?step=overview`)

  // ✅ Only mark AFTERCARE notifications read when viewing aftercare
  let showUnreadAftercareBadge = false
  if (step === 'aftercare' && aftercare?.id) {
    const unread = await prisma.clientNotification.findFirst({
      where: {
        clientId: user.clientProfile.id,
        type: 'AFTERCARE',
        bookingId: booking.id,
        aftercareId: aftercare.id,
        readAt: null,
      } as any,
      select: { id: true },
    })

    showUnreadAftercareBadge = Boolean(unread)

    if (unread) {
      await prisma.clientNotification.updateMany({
        where: {
          clientId: user.clientProfile.id,
          type: 'AFTERCARE',
          bookingId: booking.id,
          aftercareId: aftercare.id,
          readAt: null,
        } as any,
        data: { readAt: new Date() } as any,
      })
      showUnreadAftercareBadge = false
    }
  }

  const consultNotes = String(consultationApproval?.notes || '')
  const proposedTotalLabel = formatMoneyLoose(consultationApproval?.proposedTotal) || null
  const proposedFallback = basePriceLabel || null

  return (
    <main className="mx-auto mt-20 w-full max-w-2xl px-4 pb-10 text-textPrimary">
      <h1 className="mb-3 text-lg font-black">{booking.service?.name || 'Booking'}</h1>

      <div className="mb-4 flex items-center justify-between gap-3">
        <a
          href="/client/bookings"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
        >
          ← Back to bookings
        </a>

        <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-black', pillClassByVariant(pillVariant)].join(' ')}>
          {String(booking.status || 'UNKNOWN').toUpperCase()}
        </span>
      </div>

      <div className="mb-2 text-sm font-semibold text-textSecondary">
        With {booking.professional?.businessName || booking.professional?.user?.email || 'your professional'}
      </div>

      <div className="mb-3 text-sm text-textPrimary">
        <span className="font-black">{whenLabel}</span>
        <span className="text-textSecondary"> · {appointmentTz}</span>
        {locLine ? <span className="text-textSecondary"> · {locLine}</span> : null}
      </div>

      {durationMinutes || basePriceLabel || modeLabel || sourceLabel ? (
        <div className="mb-5 flex flex-wrap gap-3 text-xs font-semibold text-textSecondary">
          {durationMinutes ? <span className="font-black text-textPrimary">{durationMinutes} min</span> : null}
          {basePriceLabel ? <span className="font-black text-textPrimary">{basePriceLabel}</span> : null}
          {modeLabel ? (
            <span>
              <span className="font-black text-textPrimary">Mode:</span> {modeLabel}
            </span>
          ) : null}
          {sourceLabel ? (
            <span>
              <span className="font-black text-textPrimary">Source:</span> {sourceLabel}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mb-5" />
      )}

      <nav className="mb-5 flex flex-wrap items-center gap-2">
        <a href={`${baseHref}?step=overview`} className={tabClass(step === 'overview')}>
          Overview
        </a>

        {canShowConsultTab ? (
          <a href={`${baseHref}?step=consult`} className={tabClass(step === 'consult')}>
            Consultation
          </a>
        ) : (
          <span className={tabDisabledClass()} title="Consultation becomes available after your booking is confirmed and started by your pro.">
            Consultation
          </span>
        )}

        {canShowAftercareTab ? (
          <a href={`${baseHref}?step=aftercare`} className={tabClass(step === 'aftercare')}>
            Aftercare
          </a>
        ) : (
          <span className={tabDisabledClass()} title="Aftercare becomes available after your appointment is completed.">
            Aftercare
          </span>
        )}

        {showConsultationApproval ? (
          <span
            className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
            title="Consultation approval needed"
          >
            Action required
          </span>
        ) : null}
      </nav>

      <section className={['mb-5 rounded-card p-3', alertClassByVariant(msg.variant)].join(' ')}>
        <div className="mb-1 text-sm font-black text-textPrimary">{msg.title}</div>
        <div className="text-sm text-textSecondary">{msg.body}</div>
      </section>

      {step === 'consult' ? (
        <section className="mb-5 rounded-card border border-white/10 bg-bgSecondary p-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Consultation</div>

            {showConsultationApproval ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                Approval needed
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid gap-3">
            <div className="text-xs font-black text-textSecondary">Notes</div>
            <div className="whitespace-pre-wrap text-sm text-textPrimary">
              {consultNotes.trim() ? consultNotes : 'No consultation notes provided.'}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-semibold text-textSecondary">
                <span className="font-black text-textPrimary">Proposed total:</span> {proposedTotalLabel || proposedFallback || 'Not provided'}
              </div>

              <div className="text-xs font-semibold text-textSecondary">
                Times shown in <span className="font-black text-textPrimary">{appointmentTz}</span>
              </div>
            </div>

            {showConsultationApproval ? (
              <ConsultationDecisionCard
                bookingId={booking.id}
                appointmentTz={appointmentTz}
                notes={consultNotes}
                proposedTotalLabel={proposedTotalLabel || proposedFallback}
                proposedServicesJson={consultationApproval?.proposedServicesJson ?? null}
              />
            ) : (
              <div className="text-xs font-semibold text-textSecondary">No consultation approval needed right now.</div>
            )}
          </div>
        </section>
      ) : null}

      {step === 'overview' ? (
        <>
          {showConsultationApproval ? (
            <section className="mb-5 rounded-card border border-white/10 bg-bgSecondary p-3">
              <div className="mb-1 text-sm font-black text-textPrimary">Action needed: approve consultation</div>
              <div className="mb-3 text-sm text-textSecondary">
                Your pro updated services and pricing. Review it so they can proceed.
              </div>
              <a
                href={`${baseHref}?step=consult`}
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                Review &amp; approve
              </a>
            </section>
          ) : null}

          <a
            href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
            className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
          >
            Add to calendar
          </a>

          <BookingActions
            bookingId={booking.id}
            status={booking.status as any}
            scheduledFor={scheduled ? scheduled.toISOString() : new Date().toISOString()}
            durationMinutesSnapshot={durationMinutes ?? null}
          />
        </>
      ) : null}

      {step === 'aftercare' ? (
        <section id="aftercare" className="mt-5 rounded-card border border-white/10 bg-bgSecondary p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-black">Aftercare summary</div>

            {showUnreadAftercareBadge ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[10px] font-black text-textPrimary">
                NEW
              </span>
            ) : null}
          </div>

          {aftercare?.notes ? (
            <div className="whitespace-pre-wrap text-sm text-textPrimary">{aftercare.notes}</div>
          ) : (
            <div className="text-xs font-semibold text-textSecondary">
              {upper(booking.status) === 'COMPLETED'
                ? 'No aftercare notes provided.'
                : 'Aftercare will appear here once the service is completed.'}
            </div>
          )}

          {aftercare && (rebookInfo.label || showRebookCTA) ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="mb-2 text-xs font-black">Rebook</div>

              {rebookInfo.label ? (
                <div className="mb-3 text-sm text-textPrimary">
                  {rebookInfo.label}
                  <span className="text-textSecondary"> · {appointmentTz}</span>
                </div>
              ) : (
                <div className="mb-3 text-xs font-semibold text-textSecondary">No rebook recommendation yet.</div>
              )}

              {showRebookCTA ? (
                <a
                  href={`/client/rebook/${encodeURIComponent(aftercareToken as string)}`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
                >
                  {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT' ? 'View rebook details' : 'Rebook now'}
                </a>
              ) : null}

              {!aftercareToken && upper(booking.status) === 'COMPLETED' ? (
                <div className="mt-2 text-xs font-semibold text-textSecondary">
                  Rebook link not available yet (missing aftercare token).
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <a
              href="/client/aftercare"
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
            >
              View all aftercare
            </a>
          </div>
        </section>
      ) : null}

      <div className="mt-5">
        <ReviewSection
          bookingId={booking.id}
          existingReview={
            existingReview
              ? {
                  id: existingReview.id,
                  rating: existingReview.rating,
                  headline: existingReview.headline,
                  body: existingReview.body,
                  mediaAssets: (existingReview.mediaAssets || []).map((m) => ({
                    id: m.id,
                    url: m.url,
                    thumbUrl: m.thumbUrl,
                    mediaType: m.mediaType,
                    createdAt: m.createdAt.toISOString(),
                    isFeaturedInPortfolio: m.isFeaturedInPortfolio,
                    isEligibleForLooks: m.isEligibleForLooks,
                  })),
                }
              : null
          }
        />
      </div>
    </main>
  )
}
