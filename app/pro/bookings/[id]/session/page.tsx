// app/pro/bookings/[id]/session/page.tsx
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from '../ConsultationForm'
import { moneyToFixed2String } from '@/lib/money'
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
      className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary"
      title="Session step"
    >
      {step}
    </div>
  )
}

function Badge({ label, tone }: { label: string; tone?: 'warn' | 'good' | 'bad' | 'neutral' }) {
  const cls =
    tone === 'warn'
      ? 'bg-bgSecondary text-textPrimary'
      : tone === 'good'
        ? 'bg-bgSecondary text-textPrimary'
        : tone === 'bad'
          ? 'bg-bgSecondary text-textPrimary'
          : 'bg-bgSecondary text-textPrimary'

  return (
    <span
      className={[
        'inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-black',
        cls,
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">{children}</div>
}

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

function moneyString(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  if (!s) return ''
  return s.startsWith('$') ? s : s
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

  const initialPrice =
  moneyString(approval?.proposedTotal) ||
  (moneyToFixed2String((booking as any).totalAmount ?? null) ?? '') ||
  (moneyToFixed2String((booking as any).subtotalSnapshot ?? null) ?? '') ||
  ''


  const isCancelled = bookingStatus === 'CANCELLED'
  const isCompleted = bookingStatus === 'COMPLETED'
  const consultationApproved = approvalStatus === 'APPROVED'
  const waitingOnClient = step === 'CONSULTATION_PENDING_CLIENT' && approvalStatus === 'PENDING'

  async function setStep(next: SessionStep) {
    'use server'
    const u = await getCurrentUser().catch(() => null)
    const uProId = u?.role === 'PRO' ? u.professionalProfile?.id : null
    if (!uProId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    await postStepChange(bookingId, next)
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
  }

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

  const primaryLinkClass =
    'inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover'
  const primaryBtnClass =
    'inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover'
  const secondaryBtnClass =
    'inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass'

  return (
    <main className="mx-auto mt-20 w-full max-w-3xl px-4 pb-10 text-textPrimary">
      <a href="/pro" className={secondaryBtnClass}>
        ← Back to dashboard
      </a>

      <h1 className="mt-4 text-xl font-black">Session: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">Client: {clientName}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StepPill step={labelForStep(step)} />
        <Badge label={`Booking: ${bookingStatus || 'UNKNOWN'}`} tone="neutral" />
        <Badge label={`Consultation: ${approvalStatus || 'NONE'}`} tone={approvalTone(approvalStatus) as any} />
      </div>

      {isCancelled ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">This booking is cancelled.</div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">Nothing to do here.</div>
        </Card>
      ) : null}

      {isCompleted ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">This booking is completed.</div>
          <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`} className={[primaryLinkClass, 'mt-3'].join(' ')}>
            View aftercare
          </a>
        </Card>
      ) : null}

      {/* CONSULTATION */}
      {showConsultForm && !isCancelled && !isCompleted ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Consultation</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Confirm services + price with the client, then send it for client approval.
          </p>

          <div className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
            <ConsultationForm
              bookingId={booking.id}
              initialNotes={(booking as any).consultationNotes ?? ''}
              initialPrice={initialPrice}
            />

            <div className="mt-3 text-xs font-semibold text-textSecondary">
              After you submit, it moves to <span className="font-black text-textPrimary">Waiting on client</span>.
            </div>

            {bookingStatus === 'ACCEPTED' && consultationApproved ? (
              <form action={goBeforePhotos} className="mt-4">
                <button type="submit" className={primaryBtnClass}>
                  Proceed to before photos
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* WAITING */}
      {showWaiting ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Waiting on client approval</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Client hasn’t approved yet. This is intentionally locked so you can’t accidentally proceed.
          </p>

          <Card>
            <div className="text-sm font-semibold text-textSecondary">
              Status: <span className="font-black text-textPrimary">{approvalStatus}</span>
            </div>

            <div className="mt-2 text-xs font-semibold text-textSecondary">
              When they approve, you’ll move to <span className="font-black text-textPrimary">Before photos</span>.
            </div>

            {waitingOnClient ? (
              <div className="mt-3 text-xs font-semibold text-textSecondary">
                (Yes, it’s “stuck” on purpose. Humans love to click buttons.)
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

      {/* BEFORE PHOTOS */}
      {showBeforePhotos ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Before photos</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Client approved. Capture before photos, then start the service.
          </p>

          <Card>
            <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/session/before-photos`} className={primaryLinkClass}>
              Open before photos
            </a>

            <form action={goServiceInProgress} className="mt-3">
              <button type="submit" className={secondaryBtnClass}>
                Start service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* SERVICE */}
      {showService ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Service in progress</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">Do the fun part. We’ll handle the business part next.</p>

          <Card>
            <form action={goFinishReview}>
              <button type="submit" className={primaryBtnClass}>
                Finish service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* FINISH REVIEW */}
      {showFinishReview ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Finish review</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Quick check before after photos. This exists to prevent “oops I forgot pictures.”
          </p>

          <Card>
            <form action={goAfterPhotos}>
              <button type="submit" className={primaryBtnClass}>
                Proceed to after photos
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* AFTER PHOTOS */}
      {showAfterPhotos ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">After photos</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">Capture after photos, then close the session.</p>

          <Card>
            <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/session/after-photos`} className={primaryLinkClass}>
              Open after photos
            </a>

            <form action={goDone} className="mt-3">
              <button type="submit" className={secondaryBtnClass}>
                Done with session
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* DONE */}
      {showDone ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Next: Aftercare</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            This is the business side that protects you. Aftercare completes the booking.
          </p>

          <Card>
            <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`} className={primaryLinkClass}>
              Add aftercare &amp; complete booking
            </a>
          </Card>
        </section>
      ) : null}
    </main>
  )
}
