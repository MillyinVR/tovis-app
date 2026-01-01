// app/pro/bookings/[id]/session/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from '../ConsultationForm'
import { moneyToString } from '@/lib/money'

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

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function labelForStep(step: SessionStep) {
  const s = upper(step || 'NONE')
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

function approvalTone(status: unknown) {
  const s = upper(status)
  if (s === 'PENDING') return 'warn'
  if (s === 'APPROVED') return 'good'
  if (s === 'REJECTED') return 'bad'
  return 'neutral'
}

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

/**
 * Helper: call the canonical session-step API from a server action.
 * We avoid Prisma writes directly inside the page/action.
 */
async function postStepChange(bookingId: string, step: SessionStep) {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || ''

  const url = base
    ? `${base}/api/pro/bookings/${encodeURIComponent(bookingId)}/session-step`
    : `/api/pro/bookings/${encodeURIComponent(bookingId)}/session-step`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step }),
    cache: 'no-store',
  }).catch(() => null)

  return res
}

export default async function ProBookingSessionPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const proId = user?.role === 'PRO' ? user.professionalProfile?.id : null
  if (!proId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)

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

  const bookingStatus = upper(booking.status)
  const step = upper((booking as any).sessionStep || 'NONE') as SessionStep

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  const approval = (booking as any).consultationApproval ?? null
  const approvalStatus = upper(approval?.status || 'NONE')

  const initialPrice = booking.consultationPrice != null ? moneyToString(booking.consultationPrice) ?? '' : ''

  const isCancelled = bookingStatus === 'CANCELLED'
  const isCompleted = bookingStatus === 'COMPLETED'
  const consultationApproved = approvalStatus === 'APPROVED'
  const waitingOnClient = step === 'CONSULTATION_PENDING_CLIENT' && approvalStatus === 'PENDING'

  /**
   * Server action: validates auth then delegates to API endpoint.
   * No Prisma writes here, no render-time corrections.
   */
  async function setStep(next: SessionStep) {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    const uProId = u?.role === 'PRO' ? u.professionalProfile?.id : null
    if (!uProId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    await postStepChange(bookingId, next)
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

  // ✅ IMPORTANT: do NOT wrap server actions in inline arrow functions in JSX.
  // Next.js will throw "Functions cannot be passed..." if you do.
  async function goBeforePhotos() {
    'use server'
    await setStep('BEFORE_PHOTOS')
  }
  async function goServiceInProgress() {
    'use server'
    await setStep('SERVICE_IN_PROGRESS')
  }
  async function goFinishReview() {
    'use server'
    await setStep('FINISH_REVIEW')
  }
  async function goAfterPhotos() {
    'use server'
    await setStep('AFTER_PHOTOS')
  }
  async function goDone() {
    'use server'
    await setStep('DONE')
  }

  // CTA logic
  const showConsultForm = step === 'CONSULTATION' || step === 'NONE' || bookingStatus === 'PENDING'
  const showWaiting = step === 'CONSULTATION_PENDING_CLIENT' && approvalStatus !== 'APPROVED'
  const showBeforePhotos = step === 'BEFORE_PHOTOS' && consultationApproved
  const showService = step === 'SERVICE_IN_PROGRESS'
  const showFinishReview = step === 'FINISH_REVIEW'
  const showAfterPhotos = step === 'AFTER_PHOTOS'
  const showDone = step === 'DONE'

  return (
    <main style={{ maxWidth: 960, margin: '24px auto 90px', padding: '0 16px', fontFamily: 'system-ui' }}>
      <a href="/pro" style={{ fontSize: 12, color: '#555', textDecoration: 'none' }}>
        ← Back to dashboard
      </a>

      <h1 style={{ fontSize: 20, fontWeight: 900, marginTop: 10 }}>Session: {serviceName}</h1>
      <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>Client: {clientName}</div>

      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <StepPill step={labelForStep(step)} />
        <Badge label={`Booking: ${bookingStatus || 'UNKNOWN'}`} tone="neutral" />
        <Badge label={`Consultation: ${approvalStatus || 'NONE'}`} tone={approvalTone(approvalStatus) as any} />
      </div>

      {isCancelled ? (
        <Card>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>This booking is cancelled.</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Nothing to do here.</div>
        </Card>
      ) : null}

      {isCompleted ? (
        <Card>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>This booking is completed.</div>
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
              marginTop: 8,
            }}
          >
            View aftercare
          </a>
        </Card>
      ) : null}

      {/* CONSULTATION */}
      {showConsultForm && !isCancelled && !isCompleted ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Consultation</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
            Confirm services + price with the client, then send it for client approval.
          </p>

          <ConsultationForm
            bookingId={booking.id}
            initialNotes={(booking as any).consultationNotes ?? ''}
            initialPrice={initialPrice}
          />

          <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
            After you submit, it moves to <strong>Waiting on client</strong>.
          </div>

          {bookingStatus === 'ACCEPTED' && consultationApproved ? (
            <form action={goBeforePhotos} style={{ marginTop: 14 }}>
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
                Proceed to before photos
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {/* WAITING */}
      {showWaiting ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Waiting on client approval</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Client hasn’t approved yet. This is intentionally locked so you can’t accidentally proceed.
          </p>

          <Card>
            <div style={{ fontSize: 13, color: '#111' }}>
              Status: <strong>{approvalStatus}</strong>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
              When they approve, you’ll move to <strong>Before photos</strong>.
            </div>

            {waitingOnClient ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                (Yes, it’s “stuck” on purpose. Humans love to click buttons.)
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

      {/* BEFORE PHOTOS */}
      {showBeforePhotos ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Before photos</h2>
          <p style={{ fontSize: 13, color: '#666' }}>Client approved. Capture before photos, then start the service.</p>

          <Card>
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

            <form action={goServiceInProgress} style={{ marginTop: 12 }}>
              <button
                type="submit"
                style={{
                  border: '1px solid #111',
                  background: '#fff',
                  color: '#111',
                  borderRadius: 999,
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                Start service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* SERVICE */}
      {showService ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Service in progress</h2>
          <p style={{ fontSize: 13, color: '#666' }}>Do the fun part. We’ll handle the business part next.</p>

          <Card>
            <form action={goFinishReview}>
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
                Finish service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* FINISH REVIEW */}
      {showFinishReview ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Finish review</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Quick check before after photos. This exists to prevent “oops I forgot pictures.”
          </p>

          <Card>
            <form action={goAfterPhotos}>
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
                Proceed to after photos
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* AFTER PHOTOS */}
      {showAfterPhotos ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>After photos</h2>
          <p style={{ fontSize: 13, color: '#666' }}>Capture after photos, then close the session.</p>

          <Card>
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

            <form action={goDone} style={{ marginTop: 12 }}>
              <button
                type="submit"
                style={{
                  border: '1px solid #111',
                  background: '#fff',
                  color: '#111',
                  borderRadius: 999,
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                Done with session
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* DONE */}
      {showDone ? (
        <section style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, marginBottom: 6 }}>Next: Aftercare</h2>
          <p style={{ fontSize: 13, color: '#666' }}>This is the business side that protects you. Aftercare completes the booking.</p>

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
          </Card>
        </section>
      ) : null}
    </main>
  )
}
