// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'

import { sanitizeTimeZone } from '@/lib/timeZone'
import { COPY } from '@/lib/copy'
import { buildClientBookingDTO } from '@/lib/dto/clientBooking'

import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'
import ConsultationDecisionCard from './ConsultationDecisionCard'
import ProProfileLink from '@/app/client/components/ProProfileLink'

import { loadClientBookingPage } from './_data/loadClientBookingPage'
import { buildBookingViewModel } from './_view/buildBookingViewModel'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

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

function formatMoneyFromDecimalString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n)) return `$${n.toFixed(2)}`
  return s.startsWith('$') ? s : `$${s}`
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

type StatusVariant = 'danger' | 'success' | 'warn' | 'info' | 'neutral'

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

function pillClassByVariant(variant: Exclude<StatusVariant, 'neutral'>) {
  // Premium: keep it calm, let the accent do the talking
  if (variant === 'warn') return 'border border-white/10 bg-surfaceGlass text-textPrimary'
  if (variant === 'success') return 'border border-white/10 bg-surfaceGlass text-textPrimary'
  if (variant === 'danger') return 'border border-white/10 bg-surfaceGlass text-textPrimary'
  return 'border border-white/10 bg-surfaceGlass text-textPrimary'
}

function alertClassByVariant(variant: StatusVariant) {
  // subtle emphasis with glass, not loud banners
  if (variant === 'danger') return 'tovis-glass border border-white/10'
  if (variant === 'success') return 'tovis-glass border border-white/10'
  if (variant === 'warn') return 'tovis-glass border border-white/10'
  if (variant === 'info') return 'tovis-glass border border-white/10'
  return 'tovis-glass-soft border border-white/10'
}

function tabClass(active: boolean) {
  return cx(
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black transition',
    'border border-white/10',
    active ? 'bg-accentPrimary text-bgPrimary shadow-sm' : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  )
}

function tabDisabledClass() {
  return cx(
    'inline-flex items-center rounded-full px-4 py-2 text-xs font-black',
    'border border-white/10 bg-bgPrimary text-textSecondary opacity-50 cursor-not-allowed select-none',
  )
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
      return {
        mode: 'RECOMMENDED_WINDOW',
        label: `Recommended rebook window: ${formatDateRangeInTimeZone(s, e, timeZone)}`,
      }
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

function SectionCard(props: {
  title: string
  subtitle?: string | null
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cx(
        'rounded-card border border-white/10 p-4',
        'tovis-glass',
        'shadow-[0_14px_48px_rgba(0,0,0,0.35)]',
        props.className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary">{props.title}</div>
          {props.subtitle ? <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">{props.subtitle}</div> : null}
        </div>
        {props.right ? <div className="shrink-0">{props.right}</div> : null}
      </div>

      <div className="mt-3">{props.children}</div>
    </section>
  )
}

function TinyMetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-2.5 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
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

  // ✅ All auth + prisma reads live in one place now
  const { user, raw, aftercare, existingReview, media } = await loadClientBookingPage(bookingId)
  const clientId = user.clientProfile?.id
  if (!clientId) redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`)

  const beforeMedia = (media || []).filter((m) => String(m.phase || '').toUpperCase() === 'BEFORE')
  const afterMedia = (media || []).filter((m) => String(m.phase || '').toUpperCase() === 'AFTER')

  // ✅ DTO remains the single source of truth for booking core
  const booking = await buildClientBookingDTO({
    booking: raw as any,
    unreadAftercare: false,
    hasPendingConsultationApproval: false,
  })

  // ✅ View model = tab gating + derived labels
  const vm = buildBookingViewModel({ step, booking, raw, aftercare })

  const baseHref = `/client/bookings/${encodeURIComponent(booking.id)}`
  if (step === 'consult' && !vm.canShowConsultTab) redirect(`${baseHref}?step=overview`)
  if (step === 'aftercare' && !vm.canShowAftercareTab) redirect(`${baseHref}?step=overview`)

  // ✅ Unread aftercare badge handling (depends on aftercare id)
  let showUnreadAftercareBadge = false
  if (step === 'aftercare' && aftercare?.id) {
    const unread = await (await import('@/lib/prisma')).prisma.clientNotification.findFirst({
      where: {
        clientId,
        type: 'AFTERCARE',
        bookingId: raw.id,
        aftercareId: aftercare.id,
        readAt: null,
      } as any,
      select: { id: true },
    })

    showUnreadAftercareBadge = Boolean(unread)

    if (unread) {
      await (await import('@/lib/prisma')).prisma.clientNotification.updateMany({
        where: {
          clientId,
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

  // --- Render derived from DTO + VM ---
  const appointmentTz = sanitizeTimeZone(booking.timeZone, 'UTC')
  const scheduled = toDate(booking.scheduledFor)
  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : COPY.common.unknownTime

  const pillVariant = statusPillVariant(booking.status)
  const msg = statusMessage(booking.status)

  const durationMinutes =
    typeof booking.totalDurationMinutes === 'number' && booking.totalDurationMinutes > 0 ? booking.totalDurationMinutes : null

  const itemsSubtotal = booking.items.reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  const hasItemPrices = booking.items.some((it) => Number.isFinite(Number(it.price)))
  const breakdownTotalLabel = hasItemPrices ? `$${itemsSubtotal.toFixed(2)}` : formatMoneyFromDecimalString(booking.subtotalSnapshot)

  const modeLabel = friendlyLocationType(booking.locationType)
  const sourceLabel = friendlySource(booking.source)

  const statusUpper = upper(booking.status)
  const showConsultationApproval = Boolean(vm.showConsultationApproval)

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
    <main className="mx-auto mt-16 w-full max-w-2xl px-4 pb-12 text-textPrimary">
      {/* Top “hero” card */}
      <section
        className={cx(
          'rounded-card border border-white/10 p-5',
          'tovis-glass',
          'shadow-[0_18px_60px_rgba(0,0,0,0.45)]',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[18px] font-black leading-snug text-textPrimary">{title}</div>

            <div className="mt-2 text-[13px] font-semibold text-textSecondary">
              {COPY.bookings.withLabel}{' '}
              <ProProfileLink
                proId={booking.professional?.id ?? null}
                label={proLabel}
                className="font-black text-textPrimary hover:opacity-80"
              />
            </div>

            <div className="mt-2 text-[13px] text-textPrimary">
              <span className="font-black">{whenLabel}</span>
              <span className="text-textSecondary"> · {appointmentTz}</span>
              {locLine ? <span className="text-textSecondary"> · {locLine}</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={cx('inline-flex items-center rounded-full px-3 py-1 text-xs font-black', pillClassByVariant(pillVariant))}>
              {String(booking.status || COPY.bookings.status.pillUnknown).toUpperCase()}
            </span>

            <a
              href="/client/bookings"
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[11px] font-black text-textPrimary hover:bg-surfaceGlass"
            >
              ← {COPY.bookings.backToBookings}
            </a>
          </div>
        </div>

        {(durationMinutes || breakdownTotalLabel || modeLabel || sourceLabel) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {durationMinutes ? <TinyMetaPill>{durationMinutes} min</TinyMetaPill> : null}
            {breakdownTotalLabel ? <TinyMetaPill>{breakdownTotalLabel}</TinyMetaPill> : null}
            {modeLabel ? <TinyMetaPill>{modeLabel}</TinyMetaPill> : null}
            {sourceLabel ? <TinyMetaPill>Source: {sourceLabel}</TinyMetaPill> : null}

            {showConsultationApproval ? (
              <span
                className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
                title={COPY.bookings.badges.actionRequired}
              >
                {COPY.bookings.badges.actionRequired}
              </span>
            ) : null}
          </div>
        )}
      </section>

      {/* Included items */}
      {booking.items.length ? (
        <div className="mt-4">
          <SectionCard
            title="What’s included"
            subtitle={booking.display?.addOnCount ? 'Includes base service + add-ons' : 'Service breakdown'}
            right={
              booking.display?.addOnCount ? (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                  {booking.display.addOnCount} add-on{booking.display.addOnCount === 1 ? '' : 's'}
                </span>
              ) : null
            }
          >
            <div className="grid gap-2">
              {booking.items.map((it) => {
                const name = it.name || (it.type === 'ADD_ON' ? 'Add-on' : 'Service')
                const price = formatMoneyFromDecimalString(it.price)
                const dur = it.durationMinutes && it.durationMinutes > 0 ? `${it.durationMinutes} min` : null

                return (
                  <div
                    key={it.id}
                    className={cx(
                      'rounded-card border border-white/10 bg-bgPrimary px-4 py-3',
                      'shadow-[0_10px_30px_rgba(0,0,0,0.25)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[14px] font-black text-textPrimary">{name}</div>
                          <span className="inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-2 py-0.5 text-[10px] font-black text-textPrimary">
                            {it.type === 'ADD_ON' ? 'Add-on' : 'Base'}
                          </span>
                          {dur ? <span className="text-[11px] font-semibold text-textSecondary">· {dur}</span> : null}
                        </div>
                      </div>

                      <div className="shrink-0 text-[13px] font-black text-textPrimary">{price || COPY.common.emDash}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {/* Tabs */}
      <nav className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`${baseHref}?step=overview`} className={tabClass(step === 'overview')}>
          {COPY.bookings.tabs.overview}
        </a>

        {vm.canShowConsultTab ? (
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

        {vm.canShowAftercareTab ? (
          <a href={`${baseHref}?step=aftercare`} className={tabClass(step === 'aftercare')}>
            {COPY.bookings.tabs.aftercare}
          </a>
        ) : (
          <span className={tabDisabledClass()} title="Aftercare becomes available after your appointment is completed.">
            {COPY.bookings.tabs.aftercare}
          </span>
        )}

        {step === 'aftercare' && showUnreadAftercareBadge ? (
          <span className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[10px] font-black text-textPrimary">
            {COPY.bookings.badges.new}
          </span>
        ) : null}
      </nav>

      {/* Status message */}
      <section className={cx('mt-4 rounded-card p-4', alertClassByVariant(msg.variant))}>
        <div className="text-[13px] font-black text-textPrimary">{msg.title}</div>
        <div className="mt-1 text-[13px] font-semibold leading-snug text-textSecondary">{msg.body}</div>
      </section>

      {/* CONSULT */}
      {step === 'consult' ? (
        <div className="mt-4">
          <SectionCard
            title={COPY.bookings.consultation.header}
            subtitle="Notes and consultation details"
            right={
              showConsultationApproval ? (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
                  {COPY.bookings.consultation.approvalNeeded}
                </span>
              ) : null
            }
          >
            <div className="grid gap-3">
              <div>
                <div className="text-[11px] font-black text-textSecondary">{COPY.bookings.consultation.notesLabel}</div>
                <div className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-textPrimary">
                  {consultNotes.trim() ? consultNotes : COPY.bookings.consultation.noNotes}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <TinyMetaPill>
                  <span className="text-textSecondary">{COPY.bookings.consultation.proposedTotalLabel} </span>
                  {proposedTotalLabel || COPY.common.notProvided}
                </TinyMetaPill>

                <TinyMetaPill>
                  <span className="text-textSecondary">{COPY.bookings.consultation.timesShownIn} </span>
                  {appointmentTz}
                </TinyMetaPill>
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
                <div className="text-[12px] font-semibold text-textSecondary">{COPY.bookings.consultation.noApprovalNeeded}</div>
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {/* OVERVIEW */}
      {step === 'overview' ? (
        <div className="mt-4 grid gap-4">
          {showConsultationApproval ? (
            <SectionCard
              title={COPY.bookings.consultation.actionNeededTitle}
              subtitle={COPY.bookings.consultation.actionNeededBody}
              right={
                <a
                  href={`${baseHref}?step=consult`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover"
                >
                  {COPY.bookings.consultation.actionNeededCta}
                </a>
              }
            >
              <div className="text-[12px] font-semibold text-textSecondary">
                One quick decision and you’re done — we love efficient queens.
              </div>
            </SectionCard>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
              className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass"
            >
              {COPY.bookings.addToCalendar}
            </a>
          </div>

          <BookingActions
            bookingId={booking.id}
            status={booking.status as any}
            scheduledFor={scheduled ? scheduled.toISOString() : new Date().toISOString()}
            durationMinutesSnapshot={(durationMinutes ?? null) as any}
            appointmentTz={appointmentTz}
          />
        </div>
      ) : null}

      {/* AFTERCARE */}
      {step === 'aftercare' ? (
        <section id="aftercare" className="mt-4 grid gap-4">
          <SectionCard
            title={COPY.bookings.aftercare.header}
            subtitle="Photos, care notes, products, and rebook options."
            right={showUnreadAftercareBadge ? <TinyMetaPill>{COPY.bookings.badges.new}</TinyMetaPill> : null}
          >
            <div className="grid gap-4">
              {/* Before & After */}
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[12px] font-black text-textPrimary">Before &amp; After</div>
                  <div className="text-[11px] font-semibold text-textSecondary">
                    {beforeMedia.length || afterMedia.length ? 'Swipe to view' : 'No photos attached'}
                  </div>
                </div>

                {beforeMedia.length || afterMedia.length ? (
                  <div className="mt-3 grid gap-3">
                    {beforeMedia.length ? (
                      <div>
                        <div className="mb-2 text-[11px] font-black text-textSecondary">Before</div>
                        <div className="flex gap-2 overflow-x-auto pb-1 looksNoScrollbar">
                          {beforeMedia.map((m) => {
                            const src = m.thumbUrl || m.url
                            return (
                              <a
                                key={m.id}
                                href={m.url}
                                className="block shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgSecondary"
                                style={{ width: 128, height: 128 }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}

                    {afterMedia.length ? (
                      <div>
                        <div className="mb-2 text-[11px] font-black text-textSecondary">After</div>
                        <div className="flex gap-2 overflow-x-auto pb-1 looksNoScrollbar">
                          {afterMedia.map((m) => {
                            const src = m.thumbUrl || m.url
                            return (
                              <a
                                key={m.id}
                                href={m.url}
                                className="block shrink-0 overflow-hidden rounded-card border border-white/10 bg-bgSecondary"
                                style={{ width: 128, height: 128 }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                    Your pro will attach photos during your appointment flow.
                  </div>
                )}
              </div>

              {/* Service */}
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[12px] font-black text-textPrimary">Service</div>
                  {breakdownTotalLabel ? <div className="text-[12px] font-black text-textPrimary">{breakdownTotalLabel}</div> : null}
                </div>

                {booking.items.length ? (
                  <div className="mt-3 grid gap-2">
                    {booking.items.map((it) => {
                      const name = it.name || (it.type === 'ADD_ON' ? 'Add-on' : 'Service')
                      const price = formatMoneyFromDecimalString(it.price)
                      const dur = it.durationMinutes && it.durationMinutes > 0 ? `${it.durationMinutes} min` : null

                      return (
                        <div
                          key={it.id}
                          className="flex items-baseline justify-between gap-3 rounded-card border border-white/10 bg-bgSecondary px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-black text-textPrimary">{name}</div>
                            <div className="text-[11px] font-semibold text-textSecondary">
                              {it.type === 'ADD_ON' ? 'Add-on' : 'Base'}
                              {dur ? ` · ${dur}` : ''}
                            </div>
                          </div>
                          <div className="shrink-0 text-[12px] font-black text-textPrimary">{price || COPY.common.emDash}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">No itemized breakdown available.</div>
                )}
              </div>

              {/* Care notes */}
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="text-[12px] font-black text-textPrimary">Care notes</div>

                {aftercare?.notes ? (
                  <div className="mt-2 whitespace-pre-wrap text-[13px] leading-snug text-textPrimary">{aftercare.notes}</div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                    {upper(booking.status) === 'COMPLETED'
                      ? COPY.bookings.aftercare.noAftercareNotesCompleted
                      : COPY.bookings.aftercare.noAftercareNotesPending}
                  </div>
                )}
              </div>

              {/* Product recs */}
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[12px] font-black text-textPrimary">Product recommendations</div>
                  <div className="text-[11px] font-semibold text-textSecondary">
                    {aftercare?.recommendations?.length ? `${aftercare.recommendations.length} item(s)` : 'None yet'}
                  </div>
                </div>

                {aftercare?.recommendations?.length ? (
                  <div className="mt-3 grid gap-2">
                    {aftercare.recommendations.map((r: any) => {
                      const name = r.product?.name || r.externalName || 'Recommended product'
                      const brand = r.product?.brand || ''
                      const price =
                        r.product?.retailPrice != null && Number.isFinite(Number(r.product.retailPrice))
                          ? `$${Number(r.product.retailPrice).toFixed(2)}`
                          : null

                      const href = typeof r.externalUrl === 'string' && r.externalUrl.trim() ? r.externalUrl.trim() : null

                      return (
                        <div key={r.id} className="rounded-card border border-white/10 bg-bgSecondary p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-black text-textPrimary">
                                {brand ? `${brand} · ` : ''}
                                {name}
                              </div>
                              {r.note ? <div className="mt-1 text-[12px] font-semibold text-textSecondary">{r.note}</div> : null}
                            </div>

                            {price ? <div className="shrink-0 text-[12px] font-black text-textPrimary">{price}</div> : null}
                          </div>

                          {href ? (
                            <a
                              href={href}
                              className="mt-2 inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1.5 text-[11px] font-black text-textPrimary hover:bg-surfaceGlass"
                            >
                              View product →
                            </a>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                    Your pro can add products later — you’ll be notified if they do.
                  </div>
                )}
              </div>

              {/* Rebook */}
              {aftercare && (rebookInfo.label || showRebookCTA) ? (
                <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                  <div className="text-[12px] font-black text-textPrimary">{COPY.bookings.aftercare.rebookHeader}</div>

                  {rebookInfo.label ? (
                    <div className="mt-2 text-[13px] text-textPrimary">
                      {rebookInfo.label}
                      <span className="text-textSecondary"> · {appointmentTz}</span>
                    </div>
                  ) : (
                    <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                      {COPY.bookings.aftercare.noRebookRecommendation}
                    </div>
                  )}

                  {showRebookCTA ? (
                    <a
                      href={`/client/rebook/${encodeURIComponent(aftercareToken as string)}`}
                      className="mt-3 inline-flex items-center rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
                    >
                      {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT'
                        ? COPY.bookings.aftercare.rebookCtaViewDetails
                        : COPY.bookings.aftercare.rebookCtaNow}
                    </a>
                  ) : null}

                  {!aftercareToken && upper(booking.status) === 'COMPLETED' ? (
                    <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                      {COPY.bookings.aftercare.rebookLinkNotAvailable}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* More */}
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="text-[12px] font-black text-textPrimary">More</div>
                <a
                  href="/client/aftercare"
                  className="mt-2 inline-flex items-center rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-[12px] font-black text-textPrimary hover:bg-surfaceGlass"
                >
                  {COPY.bookings.aftercare.viewAllAftercare}
                </a>
              </div>
            </div>
          </SectionCard>
        </section>
      ) : null}

      {/* Review */}
      <div id="review" className="mt-6">
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
