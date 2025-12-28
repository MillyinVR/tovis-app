// app/pro/bookings/[id]/session/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from '../ConsultationForm'

export const dynamic = 'force-dynamic'

type SessionStep =
  | 'NONE'
  | 'CONSULTATION'
  | 'CONSULTATION_PENDING_CLIENT'
  | 'BEFORE_PHOTOS'
  | 'SERVICE_IN_PROGRESS'
  | 'FINISH_REVIEW'
  | 'AFTER_PHOTOS'
  | 'DONE'
  | string

function StepPill({ step }: { step: string }) {
  return (
    <div
      style={{
        display: 'inline-block',
        fontSize: 11,
        padding: '3px 10px',
        borderRadius: 999,
        border: '1px solid #e5e7eb',
        background: '#fafafa',
        fontWeight: 900,
        color: '#111',
        marginTop: 10,
      }}
      title="Session step"
    >
      {step}
    </div>
  )
}

function Badge({ label, tone }: { label: string; tone?: 'warn' | 'good' | 'bad' | 'neutral' }) {
  const styles =
    tone === 'warn'
      ? { bg: '#fffbeb', border: '#fde68a', color: '#854d0e' }
      : tone === 'good'
        ? { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' }
        : tone === 'bad'
          ? { bg: '#fff1f2', border: '#fecdd3', color: '#9f1239' }
          : { bg: '#f3f4f6', border: '#e5e7eb', color: '#111827' }

  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 900,
        padding: '3px 10px',
        borderRadius: 999,
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        color: styles.color,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid #eee',
        background: '#fff',
        borderRadius: 12,
        padding: 14,
      }}
    >
      {children}
    </div>
  )
}

function labelForStep(step: SessionStep) {
  const s = String(step || 'NONE').toUpperCase()
  if (s === 'NONE') return 'Not started'
  if (s === 'CONSULTATION') return 'Consultation'
  if (s === 'CONSULTATION_PENDING_CLIENT') return 'Waiting on client'
  if (s === 'BEFORE_PHOTOS') return 'Before photos'
  if (s === 'SERVICE_IN_PROGRESS') return 'Service in progress'
  if (s === 'FINISH_REVIEW') return 'Finish review'
  if (s === 'AFTER_PHOTOS') return 'After photos'
  if (s === 'DONE') return 'Done'
  return s
}

function dollarsFromCents(cents: unknown) {
  if (cents == null) return null

  let n: number | null = null

  if (typeof cents === 'number' && Number.isFinite(cents)) n = cents
  else if (typeof cents === 'bigint') n = Number(cents)
  else if (typeof cents === 'string' && cents.trim()) {
    const parsed = Number(cents)
    if (Number.isFinite(parsed)) n = parsed
  }

  if (n == null || !Number.isFinite(n)) return null
  return (n / 100).toFixed(2)
}

function approvalTone(status: unknown) {
  const s = String(status || '').toUpperCase()
  if (s === 'PENDING') return 'warn'
  if (s === 'APPROVED') return 'good'
  if (s === 'REJECTED') return 'bad'
  return 'neutral'
}

function stepOrderAdvance(step: SessionStep): SessionStep | null {
  const s = String(step || 'NONE').toUpperCase()

  // Consultation -> Pending is handled by ConsultationForm + proposal route
  if (s === 'BEFORE_PHOTOS') return 'SERVICE_IN_PROGRESS'
  if (s === 'SERVICE_IN_PROGRESS') return 'FINISH_REVIEW'
  if (s === 'FINISH_REVIEW') return 'AFTER_PHOTOS'
  if (s === 'AFTER_PHOTOS') return 'DONE'

  if (s === 'NONE') return 'CONSULTATION'

  return null
}

export default async function ProBookingSessionPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
    redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }
  const proId = user.professionalProfile.id

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: true,
      client: true,
      consultationApproval: true,
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  const step = String((booking as any).sessionStep || 'NONE').toUpperCase() as SessionStep

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  const approval = (booking as any).consultationApproval ?? null
  const approvalStatus = approval?.status ? String(approval.status).toUpperCase() : 'NONE'

  const initialPrice =
    (booking as any).consultationPriceCents != null
      ? dollarsFromCents((booking as any).consultationPriceCents)
      : ''

  // --- SERVER ACTIONS ---------------------------------------------------------

  async function setStep(nextStep: SessionStep) {
    'use server'
    const u = await getCurrentUser().catch(() => null)
    if (!u || u.role !== 'PRO' || !u.professionalProfile?.id) {
      redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })
    if (!b) notFound()
    if (b.professionalId !== u.professionalProfile.id) redirect('/pro')

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: nextStep as any },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  async function advance() {
    'use server'
    const u = await getCurrentUser().catch(() => null)
    if (!u || u.role !== 'PRO' || !u.professionalProfile?.id) {
      redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, sessionStep: true },
    })
    if (!b) notFound()
    if (b.professionalId !== u.professionalProfile.id) redirect('/pro')

    const current = String(b.sessionStep || 'NONE').toUpperCase() as SessionStep
    const next = stepOrderAdvance(current)

    if (!next) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: next as any },
    })

    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  // ---------------------------------------------------------------------------

  const canAdvance =
    step === 'BEFORE_PHOTOS' ||
    step === 'SERVICE_IN_PROGRESS' ||
    step === 'FINISH_REVIEW' ||
    step === 'AFTER_PHOTOS' ||
    step === 'NONE'

  const advanceLabel =
    step === 'NONE'
      ? 'Begin consultation'
      : step === 'BEFORE_PHOTOS'
        ? 'Start service'
        : step === 'SERVICE_IN_PROGRESS'
          ? 'Finish service'
          : step === 'FINISH_REVIEW'
            ? 'Proceed to after photos'
            : step === 'AFTER_PHOTOS'
              ? 'Mark session done'
              : 'Continue'

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a href="/pro" style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}>
        ← Back to dashboard
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>Session: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <StepPill step={labelForStep(step)} />
        <Badge label={`Booking: ${String(booking.status || 'UNKNOWN')}`} tone="neutral" />
        <Badge
          label={`Consultation: ${approvalStatus}`}
          tone={approvalStatus === 'NONE' ? 'neutral' : (approvalTone(approvalStatus) as any)}
        />
      </div>

      {canAdvance ? (
        <form action={advance} style={{ marginTop: 14 }}>
          <button
            type="submit"
            style={{
              border: '1px solid #111',
              background: '#111',
              color: '#fff',
              borderRadius: 999,
              padding: '10px 14px',
              fontSize: 12,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            {advanceLabel}
          </button>
          <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280' }}>
            (This just moves the step forward. Media upload UI comes next.)
          </span>
        </form>
      ) : null}

      {step === 'NONE' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Not started</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            This session hasn’t started its step flow yet. Begin with consultation.
          </p>
          <Card>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              If you want sessions to always start at consultation automatically, we can set that in your “start booking” endpoint.
            </div>
          </Card>
        </section>
      )}

      {step === 'CONSULTATION' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Consultation</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            Confirm services + price with the client, then send it for client approval.
          </p>

          <ConsultationForm
            bookingId={booking.id}
            initialNotes={(booking as any).consultationNotes ?? ''}
            initialPrice={initialPrice || ''}
          />

          <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
            After you submit, the session should move to <strong>Waiting on client</strong> and the client will see the approval CTA.
          </div>
        </section>
      )}

      {step === 'CONSULTATION_PENDING_CLIENT' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Waiting for client approval</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Once they approve, you’ll unlock before photos.
          </p>

          <Card>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Latest proposal</div>

            {!approval ? (
              <div style={{ fontSize: 12, color: '#777' }}>
                No consultation proposal found yet. Re-submit the consultation.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#111', display: 'grid', gap: 6 }}>
                <div>
                  Status: <strong>{String(approval.status)}</strong>
                </div>

                {approval.proposedTotal != null ? (
                  <div>
                    Proposed total: <strong>${String(approval.proposedTotal)}</strong>
                  </div>
                ) : null}

                {approval.notes ? (
                  <div style={{ color: '#555' }}>Notes: {String(approval.notes)}</div>
                ) : null}

                {approval.createdAt ? (
                  <div style={{ color: '#6b7280' }}>
                    Sent: {new Date(approval.createdAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <div style={{ marginTop: 12, fontSize: 12, color: '#777' }}>
            This is server-rendered. Refresh after the client approves (footer polling will also update the button label).
          </div>
        </section>
      )}

      {step === 'BEFORE_PHOTOS' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Before photos</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Client approved. Capture before photos, then start the service.
          </p>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>Before photos</div>
            <div style={{ fontSize: 13, color: '#111', marginBottom: 10 }}>
              Upload before photos for this booking.
            </div>

            <a
              href={`/pro/bookings/${encodeURIComponent(booking.id)}/session/before-photos`}
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
              Open before photos
            </a>

          </Card>

        </section>
      )}

      {step === 'SERVICE_IN_PROGRESS' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Service in progress</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Do the thing you’re being paid for. When you’re done, advance to finish review.
          </p>

          <Card>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              (Later we can add a timer, checklist, and “notes during service” here.)
            </div>
          </Card>
        </section>
      )}

      {step === 'FINISH_REVIEW' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Finish review</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Confirm you’re ready for after photos.
          </p>

          <Card>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              This is where you’ll eventually confirm final price adjustments and prepare aftercare.
            </div>
          </Card>
        </section>
      )}

      {step === 'AFTER_PHOTOS' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>After photos</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Capture after photos, then mark the session done.
          </p>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>After photos</div>
            <div style={{ fontSize: 13, color: '#111', marginBottom: 10 }}>
              Upload after photos for this booking.
            </div>

            <a
              href={`/pro/bookings/${encodeURIComponent(booking.id)}/session/after-photos`}
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
              Open after photos
            </a>

          </Card>

        </section>
      )}

      {step === 'DONE' && (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Done</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Session steps are complete. Next stop: aftercare + closing out the booking.
          </p>

          <Card>
            <a
              href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`}
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
              Add aftercare & complete booking
            </a>


            <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
              Later we’ll also auto-set Booking.status → COMPLETED when aftercare is submitted (if that’s your rule).
            </div>
          </Card>
        </section>
      )}

      {step !== 'NONE' &&
        step !== 'CONSULTATION' &&
        step !== 'CONSULTATION_PENDING_CLIENT' &&
        step !== 'BEFORE_PHOTOS' &&
        step !== 'SERVICE_IN_PROGRESS' &&
        step !== 'FINISH_REVIEW' &&
        step !== 'AFTER_PHOTOS' &&
        step !== 'DONE' && (
          <section style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Session</h2>
            <div style={{ fontSize: 13, color: '#666' }}>
              This step isn’t handled yet: <strong>{String(step)}</strong>
            </div>

            <Card>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                If this wasn’t intentional, your step transitions are off. Which is, historically, how most apps work.
              </div>
            </Card>
          </section>
        )}
    </main>
  )
}
