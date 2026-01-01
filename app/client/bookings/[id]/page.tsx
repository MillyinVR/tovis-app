// app/client/bookings/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ReviewSection from './ReviewSection'
import BookingActions from './BookingActions'
import ConsultationDecisionCard from './ConsultationDecisionCard'

export const dynamic = 'force-dynamic'

type StepKey = 'overview' | 'consult' | 'aftercare'

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

function sanitizeTimeZone(tz: string | null | undefined) {
  if (!tz) return null
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_\-+]+$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return null
  }
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

function statusPillTone(statusRaw: unknown) {
  const s = upper(statusRaw)
  if (s === 'CANCELLED') return { bg: '#fff1f2', color: '#9f1239' }
  if (s === 'COMPLETED') return { bg: '#ecfdf5', color: '#065f46' }
  if (s === 'PENDING') return { bg: '#fffbeb', color: '#854d0e' }
  return { bg: '#ecfeff', color: '#155e75' }
}

function statusMessage(statusRaw: unknown) {
  const s = upper(statusRaw)

  if (s === 'PENDING') {
    return {
      title: 'Request sent',
      body: 'Your professional hasn’t approved this yet. You’ll see it move to Confirmed once accepted.',
      tone: { bg: '#fffbeb', border: '#fde68a', color: '#854d0e' },
    }
  }

  if (s === 'ACCEPTED') {
    return {
      title: 'Confirmed',
      body: 'You’re booked. Show up cute and on time. Future-you will thank you.',
      tone: { bg: '#ecfeff', border: '#a5f3fc', color: '#155e75' },
    }
  }

  if (s === 'COMPLETED') {
    return {
      title: 'Completed',
      body: 'All done. Leave a review if you haven’t already (professionals live for that).',
      tone: { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' },
    }
  }

  if (s === 'CANCELLED') {
    return {
      title: 'Cancelled',
      body: 'This booking is cancelled. If you still want the service, book a new time.',
      tone: { bg: '#fff1f2', border: '#fecdd3', color: '#9f1239' },
    }
  }

  return {
    title: 'Booking status',
    body: 'We’re tracking this booking. Status updates will show here.',
    tone: { bg: '#f3f4f6', border: '#e5e7eb', color: '#111827' },
  }
}

function locationLine(pro?: { location?: string | null; city?: string | null; state?: string | null } | null) {
  if (!pro) return ''
  const parts = [pro.location, pro.city, pro.state].filter(Boolean)
  return parts.join(', ')
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
  const anyV: any = v
  if (typeof anyV?.toString === 'function') {
    const s = String(anyV.toString())
    const n = Number(s)
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`
    if (s.trim()) return s.trim()
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

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #ddd',
    textDecoration: 'none',
    color: active ? '#fff' : '#111',
    background: active ? '#111' : '#fafafa',
    fontSize: 12,
    fontWeight: 900,
  }
}

function disabledTabStyle(): React.CSSProperties {
  return {
    ...tabStyle(false),
    opacity: 0.45,
    cursor: 'not-allowed',
    userSelect: 'none',
  }
}

export default async function ClientBookingPage(props: {
  params: Promise<{ id: string }> | { id: string }
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
}) {
  const resolvedParams = await Promise.resolve(props.params as any)
  const bookingId = resolvedParams.id

  const sp = (await Promise.resolve(props.searchParams as any).catch(() => ({}))) ?? {}
  const step = normalizeStep((sp as any)?.step)

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(`/client/bookings/${bookingId}`)}`)
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      professional: { include: { user: true } },
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

  // ✅ Rule: always display in PRO’s timezone
  const appointmentTz = sanitizeTimeZone((booking.professional as any)?.timeZone) ?? 'America/Los_Angeles'
  const whenLabel = scheduled ? formatWhenInTimeZone(scheduled, appointmentTz) : 'Unknown time'

  const loc = locationLine(booking.professional as any)
  const pill = statusPillTone(booking.status)
  const msg = statusMessage(booking.status)

  const duration = booking.durationMinutesSnapshot ?? null
  const basePriceLabel = formatMoneyLoose((booking as any).priceSnapshot)

  const modeLabel = friendlyLocationType((booking as any).locationType)
  const sourceLabel = friendlySource((booking as any).source)

  const aftercare = booking.aftercareSummary
  const rebookInfo = aftercare ? getAftercareRebookInfo(aftercare, appointmentTz) : { mode: 'NONE', label: null }
  const aftercareToken = aftercare ? pickToken(aftercare) : null
  const showRebookCTA = upper(booking.status) === 'COMPLETED' && Boolean(aftercareToken)

  // ✅ Consultation approval required?
  const showConsultationApproval =
    upper(booking.consultationApproval?.status) === 'PENDING' &&
    upper(booking.sessionStep) === 'CONSULTATION_PENDING_CLIENT' &&
    upper(booking.status) !== 'CANCELLED' &&
    upper(booking.status) !== 'COMPLETED'

  // ✅ Gate tabs: consultation/aftercare should not appear as “available” until they are real.
  const statusUpper = upper(booking.status)
  const sessionStepUpper = upper((booking as any).sessionStep || 'NONE')

  // Client should only see Consultation when there's an actual client-facing action/state.
  // "CONSULTATION" is a PRO working state. Client-visible starts at CONSULTATION_PENDING_CLIENT.
  const canShowConsultTab =
    statusUpper !== 'CANCELLED' &&
    statusUpper !== 'COMPLETED' &&
    statusUpper !== 'PENDING' &&
    (sessionStepUpper === 'CONSULTATION_PENDING_CLIENT' || showConsultationApproval)

  const canShowAftercareTab = statusUpper === 'COMPLETED' || Boolean(aftercare?.id)

  const baseHref = `/client/bookings/${encodeURIComponent(booking.id)}`

  // ✅ If user manually navigates to a locked tab, shove them back to overview.
  if (step === 'consult' && !canShowConsultTab) redirect(`${baseHref}?step=overview`)
  if (step === 'aftercare' && !canShowAftercareTab) redirect(`${baseHref}?step=overview`)

  // ✅ Aftercare unread badge for this booking + mark read when viewing booking page
  let hasUnreadAftercareNotifForThisBooking = false
  if (aftercare?.id) {
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

    hasUnreadAftercareNotifForThisBooking = Boolean(unread)

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
    }
  }

  const consultNotes = (booking.consultationApproval as any)?.notes || booking.consultationNotes || ''
  const proposedTotalLabel = formatMoneyLoose((booking.consultationApproval as any)?.proposedTotal) || null
  const proposedFallback = basePriceLabel || null

  return (
    <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>{booking.service?.name || 'Booking'}</h1>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <a
          href="/client/bookings"
          style={{
            textDecoration: 'none',
            border: '1px solid #e5e7eb',
            background: '#fff',
            color: '#111',
            borderRadius: 999,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          ← Back to bookings
        </a>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 900,
            border: '1px solid #e5e7eb',
            background: pill.bg,
            color: pill.color,
          }}
        >
          {String(booking.status || 'UNKNOWN').toUpperCase()}
        </span>
      </div>

      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
        With {(booking.professional as any)?.businessName || (booking.professional as any)?.user?.email || 'your professional'}
      </div>

      <div style={{ fontSize: 13, color: '#111', marginBottom: 10 }}>
        <span style={{ fontWeight: 800 }}>{whenLabel}</span>
        <span style={{ color: '#6b7280' }}> · {appointmentTz}</span>
        {loc ? <span style={{ color: '#6b7280' }}> · {loc}</span> : null}
      </div>

      {duration || basePriceLabel || modeLabel || sourceLabel ? (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {duration ? <span style={{ fontWeight: 800, color: '#111' }}>{duration} min</span> : null}
          {basePriceLabel ? <span style={{ fontWeight: 800, color: '#111' }}>{basePriceLabel}</span> : null}
          {modeLabel ? (
            <span>
              <span style={{ fontWeight: 800, color: '#111' }}>Mode:</span> {modeLabel}
            </span>
          ) : null}
          {sourceLabel ? (
            <span>
              <span style={{ fontWeight: 800, color: '#111' }}>Source:</span> {sourceLabel}
            </span>
          ) : null}
        </div>
      ) : (
        <div style={{ marginBottom: 16 }} />
      )}

      {/* Tabs */}
      <nav style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <a href={`${baseHref}?step=overview`} style={tabStyle(step === 'overview')}>
          Overview
        </a>

        {canShowConsultTab ? (
          <a href={`${baseHref}?step=consult`} style={tabStyle(step === 'consult')}>
            Consultation
          </a>
        ) : (
          <span style={disabledTabStyle()} title="Consultation becomes available after your booking is confirmed and started by your pro.">
            Consultation
          </span>
        )}

        {canShowAftercareTab ? (
          <a href={`${baseHref}?step=aftercare`} style={tabStyle(step === 'aftercare')}>
            Aftercare
          </a>
        ) : (
          <span style={disabledTabStyle()} title="Aftercare becomes available after your appointment is completed.">
            Aftercare
          </span>
        )}

        {showConsultationApproval ? (
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #fde68a',
              background: '#fffbeb',
              color: '#854d0e',
              fontSize: 11,
              fontWeight: 900,
              whiteSpace: 'nowrap',
            }}
            title="Consultation approval needed"
          >
            Action required
          </span>
        ) : null}
      </nav>

      {/* Status message */}
      <section
        style={{
          borderRadius: 12,
          border: `1px solid ${msg.tone.border}`,
          background: msg.tone.bg,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 900, color: msg.tone.color, marginBottom: 4 }}>{msg.title}</div>
        <div style={{ fontSize: 13, color: '#111' }}>{msg.body}</div>
      </section>

      {/* CONSULTATION */}
      {step === 'consult' ? (
        <section style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>Consultation</div>

            {showConsultationApproval ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid #fde68a',
                  background: '#fffbeb',
                  color: '#854d0e',
                }}
              >
                Approval needed
              </span>
            ) : null}
          </div>

          <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 900 }}>Notes</div>
            <div style={{ fontSize: 13, color: '#111', whiteSpace: 'pre-wrap' }}>
              {consultNotes?.trim() ? consultNotes : 'No consultation notes provided.'}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                <span style={{ fontWeight: 900, color: '#111' }}>Proposed total:</span>{' '}
                {proposedTotalLabel || proposedFallback || 'Not provided'}
              </div>

              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                Times shown in <span style={{ fontWeight: 900 }}>{appointmentTz}</span>
              </div>
            </div>

            {showConsultationApproval ? (
              <ConsultationDecisionCard
                bookingId={booking.id}
                appointmentTz={appointmentTz}
                notes={String(consultNotes || '')}
                proposedTotalLabel={proposedTotalLabel || proposedFallback}
              />
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>No consultation approval needed right now.</div>
            )}
          </div>
        </section>
      ) : null}

      {/* OVERVIEW actions */}
      {step === 'overview' ? (
        <>
          {showConsultationApproval ? (
            <section
              style={{
                borderRadius: 12,
                border: '1px solid #fde68a',
                background: '#fffbeb',
                padding: 12,
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 900, color: '#854d0e', marginBottom: 4 }}>Action needed: approve consultation</div>
              <div style={{ fontSize: 13, color: '#111', marginBottom: 10 }}>
                Your pro updated services and pricing. Review it so they can proceed.
              </div>
              <a
                href={`${baseHref}?step=consult`}
                style={{
                  display: 'inline-block',
                  textDecoration: 'none',
                  border: '1px solid #111',
                  borderRadius: 999,
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 900,
                  color: '#fff',
                  background: '#111',
                }}
              >
                Review &amp; approve
              </a>
            </section>
          ) : null}

          <a
            href={`/api/calendar?bookingId=${encodeURIComponent(booking.id)}`}
            style={{
              display: 'inline-block',
              textDecoration: 'none',
              border: '1px solid #ddd',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              color: '#111',
              background: '#fff',
              marginBottom: 16,
            }}
          >
            Add to calendar
          </a>

          <BookingActions
            bookingId={booking.id}
            status={booking.status as any}
            scheduledFor={scheduled ? scheduled.toISOString() : new Date().toISOString()}
            durationMinutesSnapshot={duration}
          />
        </>
      ) : null}

      {/* AFTERCARE */}
      {step === 'aftercare' ? (
        <section id="aftercare" style={{ borderRadius: 12, border: '1px solid #eee', background: '#fff', padding: 12, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Aftercare summary</div>

            {hasUnreadAftercareNotifForThisBooking ? (
              <span
                style={{
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

          {aftercare?.notes ? (
            <div style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>{aftercare.notes}</div>
          ) : (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              {upper(booking.status) === 'COMPLETED' ? 'No aftercare notes provided.' : 'Aftercare will appear here once the service is completed.'}
            </div>
          )}

          {aftercare && (rebookInfo.label || showRebookCTA) ? (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6 }}>Rebook</div>

              {rebookInfo.label ? (
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
                  {rebookInfo.label}
                  <span style={{ color: '#9ca3af' }}> · {appointmentTz}</span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 10 }}>No rebook recommendation yet.</div>
              )}

              {showRebookCTA ? (
                <a
                  href={`/client/rebook/${encodeURIComponent(aftercareToken as string)}`}
                  style={{
                    display: 'inline-block',
                    textDecoration: 'none',
                    border: '1px solid #111',
                    borderRadius: 999,
                    padding: '10px 14px',
                    fontSize: 12,
                    fontWeight: 900,
                    color: '#fff',
                    background: '#111',
                  }}
                >
                  {rebookInfo.mode === 'BOOKED_NEXT_APPOINTMENT' ? 'View rebook details' : 'Rebook now'}
                </a>
              ) : null}

              {!aftercareToken && upper(booking.status) === 'COMPLETED' ? (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Rebook link not available yet (missing aftercare token).</div>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <a
              href="/client/aftercare"
              style={{
                display: 'inline-block',
                textDecoration: 'none',
                fontSize: 12,
                fontWeight: 900,
                color: '#111',
                border: '1px solid #e5e7eb',
                background: '#fff',
                padding: '8px 12px',
                borderRadius: 999,
              }}
            >
              View all aftercare
            </a>
          </div>
        </section>
      ) : null}

      {/* Reviews always available at bottom */}
      <div style={{ marginTop: 16 }}>
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
