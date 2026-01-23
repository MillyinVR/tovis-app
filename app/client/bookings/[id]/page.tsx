// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone, isValidIanaTimeZone } from '@/lib/timeZone'
import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'
import ConsultationDecisionCard from './ConsultationDecisionCard'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { COPY } from '@/lib/copy'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'
type StatusVariant = 'danger' | 'success' | 'warn' | 'info' | 'neutral'

// Neutral fallback (no business assumption)
const FALLBACK_TZ = 'UTC'

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
  const M = COPY.bookings.status.messages

  if (s === 'PENDING') return { title: M.pending.title, body: M.pending.body, variant: 'warn' }
  if (s === 'ACCEPTED') return { title: M.accepted.title, body: M.accepted.body, variant: 'info' }
  if (s === 'COMPLETED') return { title: M.completed.title, body: M.completed.body, variant: 'success' }
  if (s === 'CANCELLED') return { title: M.cancelled.title, body: M.cancelled.body, variant: 'danger' }

  return { title: M.fallback.title, body: M.fallback.body, variant: 'neutral' }
}

function formatMoneyLoose(v: unknown): string | null {
  if (v == null) return null

  if (typeof v === 'number' && Number.isFinite(v)) return `$${v.toFixed(2)}`

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
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
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
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

      aftercareSummary: true,
      consultationApproval: true,
    },
  })

  if (!booking) notFound()
  if (booking.clientId !== user.clientProfile.id) redirect('/client/bookings')

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

  // ✅ Timezone truth order: booking.locationTimeZone -> primary location tz -> pro tz -> UTC
  let appointmentTz = normalizeTimeZone(booking.locationTimeZone, FALLBACK_TZ)

  const primaryLoc = booking.professional?.locations?.[0] ?? null
  if (!booking.locationTimeZone && primaryLoc?.timeZone) {
    appointmentTz = normalizeTimeZone(primaryLoc.timeZone, appointmentTz)
  }
  if (!booking.locationTimeZone && !primaryLoc?.timeZone) {
    appointmentTz = normalizeTimeZone(booking.professional?.timeZone, appointmentTz)
  }

  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : COPY.common.unknownTime
  const locLine = formatPrimaryLocationLine(primaryLoc)

  const pillVariant = statusPillVariant(booking.status)
  const msg = statusMessage(booking.status)

  const durationMinutes =
    typeof booking.totalDurationMinutes === 'number' && booking.totalDurationMinutes > 0 ? booking.totalDurationMinutes : null

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

  const proLabel =
    booking.professional?.businessName ||
    booking.professional?.user?.email ||
    COPY.common.professionalFallback

  return (
    <main className="mx-auto mt-20 w-full max-w-2xl px-4 pb-10 text-textPrimary">
      <h1 className="mb-3 text-lg font-black">{booking.service?.name || COPY.bookings.titleFallback}</h1>

      <div className="mb-4 flex items-center justify-between gap-3">
        <a
          href="/client/bookings"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
        >
          {COPY.bookings.backToBookings}
        </a>

        <span className={['inline-flex items-center rounded-full px-3 py-1 text-xs font-black', pillClassByVariant(pillVariant)].join(' ')}>
          {String(booking.status || COPY.bookings.status.pillUnknown).toUpperCase()}
        </span>
      </div>

      <div className="mb-2 text-sm font-semibold text-textSecondary">
        {COPY.bookings.withLabel}{' '}
        <ProProfileLink
          proId={booking.professional?.id ?? null}
          label={proLabel}
          className="hover:underline underline-offset-4"
        />
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
          {COPY.bookings.tabs.overview}
        </a>

        {canShowConsultTab ? (
          <a href={`${baseHref}?step=consult`} className={tabClass(step === 'consult')}>
            {COPY.bookings.tabs.consultation}
          </a>
        ) : (
          <span className={tabDisabledClass()} title="Consultation becomes available after your booking is confirmed and started by your pro.">
            {COPY.bookings.tabs.consultation}
          </span>
        )}

        {canShowAftercareTab ? (
          <a href={`${baseHref}?step=aftercare`} className={tabClass(step === 'aftercare')}>
            {COPY.bookings.tabs.aftercare}
          </a>
        ) : (
          <span className={tabDisabledClass()} title="Aftercare becomes available after your appointment is completed.">
            {COPY.bookings.tabs.aftercare}
          </span>
        )}

        {showConsultationApproval ? (
          <span
            className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
            title={COPY.bookings.badges.actionRequired}
          >
            {COPY.bookings.badges.actionRequired}
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
            <div className="text-sm font-black">{COPY.bookings.consultation.header}</div>

            {showConsultationApproval ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                {COPY.bookings.consultation.approvalNeeded}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid gap-3">
            <div className="text-xs font-black text-textSecondary">{COPY.bookings.consultation.notesLabel}</div>
            <div className="whitespace-pre-wrap text-sm text-textPrimary">
              {consultNotes.trim() ? consultNotes : COPY.bookings.consultation.noNotes}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-semibold text-textSecondary">
                <span className="font-black text-textPrimary">{COPY.bookings.consultation.proposedTotalLabel}</span>{' '}
                {proposedTotalLabel || proposedFallback || COPY.common.notProvided}
              </div>

              <div className="text-xs font-semibold text-textSecondary">
                {COPY.bookings.consultation.timesShownIn}{' '}
                <span className="font-black text-textPrimary">{appointmentTz}</span>
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
              <div className="text-xs font-semibold text-textSecondary">{COPY.bookings.consultation.noApprovalNeeded}</div>
            )}
          </div>
        </section>
      ) : null}

      {step === 'overview' ? (
        <>
          {showConsultationApproval ? (
            <section className="mb-5 rounded-card border border-white/10 bg-bgSecondary p-3">
              <div className="mb-1 text-sm font-black text-textPrimary">{COPY.bookings.consultation.actionNeededTitle}</div>
              <div className="mb-3 text-sm text-textSecondary">{COPY.bookings.consultation.actionNeededBody}</div>
              <a
                href={`${baseHref}?step=consult`}
                className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
              >
                {COPY.bookings.consultation.actionNeededCta}
              </a>
            </section>
          ) : null}

          <a
            href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
            className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
          >
            {COPY.bookings.addToCalendar}
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
            <div className="text-sm font-black">{COPY.bookings.aftercare.header}</div>

            {showUnreadAftercareBadge ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[10px] font-black text-textPrimary">
                {COPY.bookings.badges.new}
              </span>
            ) : null}
          </div>

          {aftercare?.notes ? (
            <div className="whitespace-pre-wrap text-sm text-textPrimary">{aftercare.notes}</div>
          ) : (
            <div className="text-xs font-semibold text-textSecondary">
              {upper(booking.status) === 'COMPLETED'
                ? COPY.bookings.aftercare.noAftercareNotesCompleted
                : COPY.bookings.aftercare.noAftercareNotesPending}
            </div>
          )}

          {aftercare && (rebookInfo.label || showRebookCTA) ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="mb-2 text-xs font-black">{COPY.bookings.aftercare.rebookHeader}</div>

              {rebookInfo.label ? (
                <div className="mb-3 text-sm text-textPrimary">
                  {rebookInfo.label}
                  <span className="text-textSecondary"> · {appointmentTz}</span>
                </div>
              ) : (
                <div className="mb-3 text-xs font-semibold text-textSecondary">{COPY.bookings.aftercare.noRebookRecommendation}</div>
              )}

              {showRebookCTA ? (
                <a
                  href={`/client/rebook/${encodeURIComponent(aftercareToken as string)}`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
                >
                  {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
                    ? COPY.bookings.aftercare.rebookCtaViewDetails
                    : COPY.bookings.aftercare.rebookCtaNow}
                </a>
              ) : null}

              {!aftercareToken && upper(booking.status) === 'COMPLETED' ? (
                <div className="mt-2 text-xs font-semibold text-textSecondary">{COPY.bookings.aftercare.rebookLinkNotAvailable}</div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <a
              href="/client/aftercare"
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
            >
              {COPY.bookings.aftercare.viewAllAftercare}
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
