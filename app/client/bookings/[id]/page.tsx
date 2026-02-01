// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { sanitizeTimeZone } from '@/lib/timeZone'
import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'
import ConsultationDecisionCard from './ConsultationDecisionCard'
import ProProfileLink from '@/app/client/components/ProProfileLink'
import { COPY } from '@/lib/copy'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'

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

function formatWhenInTimeZone(d: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

function formatDateRangeInTimeZone(start: Date, end: Date, timeZone: string) {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
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

function formatMoneyFromDecimalString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n)) return `$${n.toFixed(2)}`
  return s.startsWith('$') ? s : `$${s}`
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

/**
 * Same consult-approval gating logic as list route (Option 1e consistency).
 */
function needsConsultationApproval(b: {
  status: unknown
  sessionStep: unknown
  finishedAt: Date | null
  consultationApproval?: { status: unknown } | null
}) {
  const approval = upper(b.consultationApproval?.status)
  if (approval !== 'PENDING') return false

  const status = upper(b.status)
  if (status === 'CANCELLED' || status === 'COMPLETED') return false
  if (b.finishedAt) return false

  const step = upper(b.sessionStep)
  return step === 'CONSULTATION_PENDING_CLIENT' || step === 'CONSULTATION' || !step || step === 'NONE'
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
    if (s && e) {
      return { mode: 'RECOMMENDED_WINDOW', label: `Recommended rebook window: ${formatDateRangeInTimeZone(s, e, timeZone)}` }
    }
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

  // 1) Load raw booking in the exact shape needed to build ClientBookingDTO
  //    Keep raw around only for: auth, aftercare lookup key, and unread notification marking.
  const raw = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
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

      professional: {
        select: {
          id: true,
          businessName: true,
          location: true,
          timeZone: true,
          user: { select: { email: true } },
        },
      },

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
  })

  if (!raw) notFound()
  if (raw.clientId !== user.clientProfile.id) redirect('/client/bookings')

  // 2) Aftercare summary (page-specific)
  const aftercare = await prisma.aftercareSummary.findFirst({
    where: { bookingId: raw.id },
    select: {
      id: true,
      notes: true,
      publicToken: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
    },
  })

  // 3) Existing review (page-specific)
  const existingReview = await prisma.review.findFirst({
    where: { bookingId: raw.id, clientId: user.clientProfile.id },
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

  // 4) Build DTO (single source of truth for booking core)
  const hasPendingConsult = needsConsultationApproval(raw)
  const booking = await buildClientBookingDTO({
    booking: raw as any,
    unreadAftercare: false, // list/inbox computes this; this page manages read state when viewing aftercare tab
    hasPendingConsultationApproval: hasPendingConsult,
  })

  // 5) Unread aftercare badge handling (page-specific, depends on aftercare id)
  let showUnreadAftercareBadge = false
  if (step === 'aftercare' && aftercare?.id) {
    const unread = await prisma.clientNotification.findFirst({
      where: {
        clientId: user.clientProfile.id,
        type: 'AFTERCARE',
        bookingId: raw.id,
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
          bookingId: raw.id,
          aftercareId: aftercare.id,
          readAt: null,
        } as any,
        data: { readAt: new Date() } as any,
      })
      showUnreadAftercareBadge = false
    }
  }

  // --- Render derived from DTO ---
  const appointmentTz = sanitizeTimeZone(booking.timeZone, 'UTC') // DTO uses TimeZoneTruth; sanitize defensively
  const scheduled = toDate(booking.scheduledFor)
  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : COPY.common.unknownTime

  const pillVariant = statusPillVariant(booking.status)
  const msg = statusMessage(booking.status)

  const durationMinutes =
    typeof booking.totalDurationMinutes === 'number' && booking.totalDurationMinutes > 0 ? booking.totalDurationMinutes : null

  // Prefer truthful breakdown total if items exist; else fallback to snapshot
  const itemsSubtotal = booking.items.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const hasItemPrices = booking.items.some((it) => Number.isFinite(Number(it.price)))
  const breakdownTotalLabel = hasItemPrices ? `$${itemsSubtotal.toFixed(2)}` : formatMoneyFromDecimalString(booking.subtotalSnapshot)

  const modeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)

  const statusUpper = upper(booking.status)
  const sessionStepUpper = upper(booking.sessionStep)

  const showConsultationApproval =
    Boolean(booking.hasPendingConsultationApproval) && statusUpper !== 'CANCELLED' && statusUpper !== 'COMPLETED'

  const canShowConsultTab =
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED' &&
    statusUpper !== 'PENDING' &&
    (sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' || showConsultationApproval)

  const canShowAftercareTab = statusUpper === 'COMPLETED' || Boolean(aftercare?.id)

  const baseHref = `/client/bookings/${encodeURIComponent(booking.id)}`

  if (step === 'consult' && !canShowConsultTab) redirect(`${baseHref}?step=overview`)
  if (step === 'aftercare' && !canShowAftercareTab) redirect(`${baseHref}?step=overview`)

  const rebookInfo = aftercare ? getAftercareRebookInfo(aftercare, appointmentTz) : { mode: 'NONE' as const, label: null }
  const aftercareToken = aftercare ? pickToken(aftercare) : null
  const showRebookCTA = statusUpper === 'COMPLETED' && Boolean(aftercareToken)

  const consultNotes = String(booking.consultation?.approvalNotes || booking.consultation?.consultationNotes || '')
  const proposedTotalLabel =
    formatMoneyFromDecimalString(booking.consultation?.proposedTotal) ||
    formatMoneyFromDecimalString(booking.subtotalSnapshot) ||
    null

  const proLabel =
    booking.professional?.businessName || (raw as any)?.professional?.user?.email || COPY.common.professionalFallback

  const title = booking.display?.title || COPY.bookings.titleFallback
  const locLine = booking.locationLabel || ''

  return (
    <main className="mx-auto mt-20 w-full max-w-2xl px-4 pb-10 text-textPrimary">
      <h1 className="mb-3 text-lg font-black">{title}</h1>

      <div className="mb-4 flex items-center justify-between gap-3">
        <a
          href="/client/bookings"
          className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
        >
          {COPY.bookings.backToBookings}
        </a>

        <span
          className={[
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-black',
            pillClassByVariant(pillVariant),
          ].join(' ')}
        >
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

      {durationMinutes || breakdownTotalLabel || modeLabel || sourceLabel ? (
        <div className="mb-5 flex flex-wrap gap-3 text-xs font-semibold text-textSecondary">
          {durationMinutes ? <span className="font-black text-textPrimary">{durationMinutes} min</span> : null}
          {breakdownTotalLabel ? <span className="font-black text-textPrimary">{breakdownTotalLabel}</span> : null}
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

      {/* ✅ Canonical breakdown from ClientBookingDTO.items */}
      {booking.items.length ? (
        <section className="mb-5 rounded-card border border-white/10 bg-bgSecondary p-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-black text-textPrimary">What’s included</div>

            {booking.display?.addOnCount ? (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                {booking.display.addOnCount} add-on{booking.display.addOnCount === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid gap-2">
            {booking.items.map((it) => {
              const name = it.name || (it.type === 'ADD_ON' ? 'Add-on' : 'Service')
              const price = formatMoneyFromDecimalString(it.price)
              const dur = it.durationMinutes && it.durationMinutes > 0 ? `${it.durationMinutes} min` : null

              return (
                <div
                  key={it.id}
                  className="flex items-baseline justify-between gap-3 rounded-card border border-white/10 bg-bgPrimary px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-textPrimary">{name}</div>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                        {it.type === 'ADD_ON' ? 'Add-on' : 'Base'}
                      </span>
                      {dur ? <span className="text-xs font-semibold text-textSecondary">· {dur}</span> : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-xs font-black text-textPrimary">{price || '—'}</div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <nav className="mb-5 flex flex-wrap items-center gap-2">
        <a href={`${baseHref}?step=overview`} className={tabClass(step === 'overview')}>
          {COPY.bookings.tabs.overview}
        </a>

        {canShowConsultTab ? (
          <a href={`${baseHref}?step=consult`} className={tabClass(step === 'consult')}>
            {COPY.bookings.tabs.consultation}
          </a>
        ) : (
          <span
            className={tabDisabledClass()}
            title="Consultation becomes available after your booking is confirmed and started by your pro."
          >
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
                {proposedTotalLabel || COPY.common.notProvided}
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
                proposedTotalLabel={proposedTotalLabel}
                proposedServicesJson={booking.consultation?.proposedServicesJson ?? null}
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
            appointmentTz={appointmentTz}
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
                <div className="mb-3 text-xs font-semibold text-textSecondary">
                  {COPY.bookings.aftercare.noRebookRecommendation}
                </div>
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
                <div className="mt-2 text-xs font-semibold text-textSecondary">
                  {COPY.bookings.aftercare.rebookLinkNotAvailable}
                </div>
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
