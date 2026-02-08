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
  | 'AFTER_PHOTOS' // ✅ treated as WRAP-UP
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
  if (s === 'AFTER_PHOTOS') return 'Wrap-up (aftercare + photos)'
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

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textPrimary">
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
    include: { service: true, client: true, consultationApproval: true },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  const bookingStatus = upper(booking.status)
  const step = upper((booking as any).sessionStep || 'NONE') as SessionStep

  const serviceName = booking.service?.name ?? 'Service'
  const clientName = `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() || 'Client'

  const approval = (booking as any).consultationApproval ?? null
  const approvalStatus = upper(approval?.status || 'NONE')
  const consultationApproved = approvalStatus === 'APPROVED'

  const initialPrice =
    moneyString(approval?.proposedTotal) ||
    (moneyToFixed2String((booking as any).totalAmount ?? null) ?? '') ||
    (moneyToFixed2String((booking as any).subtotalSnapshot ?? null) ?? '') ||
    ''

  const isCancelled = bookingStatus === 'CANCELLED'
  const isCompleted = bookingStatus === 'COMPLETED'
  const waitingOnClient = step === 'CONSULTATION_PENDING_CLIENT' && approvalStatus === 'PENDING'

  // ✅ Wrap-up readiness checks (so AFTER_PHOTOS + AFTERCARE can be interchangeable)
  const [afterCount, aftercare] = await Promise.all([
    prisma.mediaAsset.count({
      where: { bookingId: booking.id, phase: 'AFTER' as any, uploadedByRole: 'PRO' },
    }),
    prisma.aftercareSummary.findFirst({
      where: { bookingId: booking.id },
      select: { id: true, publicToken: true },
    }),
  ])

  const hasAfterPhoto = afterCount > 0
  const hasAftercare = Boolean(aftercare?.id)

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
  async function goWrapUp() {
    'use server'
    // ✅ WRAP-UP step (named AFTER_PHOTOS in DB)
    await setStep('AFTER_PHOTOS')
  }

  // ✅ Complete session only when BOTH are done (aftercare + after photo)
  async function completeSession() {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    const uProId = u?.role === 'PRO' ? u.professionalProfile?.id : null
    if (!uProId) redirect(`/login?from=/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, status: true, sessionStep: true, finishedAt: true },
    })
    if (!b) notFound()
    if (b.professionalId !== uProId) redirect('/pro')

    const st = upper(b.status)
    if (st === 'CANCELLED' || st === 'COMPLETED' || b.finishedAt) redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)

    const [countAfter, ac] = await Promise.all([
      prisma.mediaAsset.count({ where: { bookingId, phase: 'AFTER' as any, uploadedByRole: 'PRO' } }),
      prisma.aftercareSummary.findFirst({ where: { bookingId }, select: { id: true } }),
    ])

    if (countAfter <= 0 || !ac?.id) {
      redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/session`)
    }

    await prisma.booking.update({
      where: { id: bookingId },
      data: { sessionStep: 'DONE' as any },
    })

    // ✅ land them in aftercare so they can hit "send to client" / finalize immediately
    redirect(`/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`)
  }

  // CTA logic
  const showConsultForm = step === 'CONSULTATION' || step === 'NONE' || bookingStatus === 'PENDING'
  const showWaiting = step === 'CONSULTATION_PENDING_CLIENT' && approvalStatus !== 'APPROVED'
  const showBeforePhotos = step === 'BEFORE_PHOTOS' && consultationApproved
  const showService = step === 'SERVICE_IN_PROGRESS'
  const showFinishReview = step === 'FINISH_REVIEW'
  const showWrapUp = step === 'AFTER_PHOTOS' // ✅ wrap-up
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
        <Badge label={`Booking: ${bookingStatus || 'UNKNOWN'}`} />
        <Badge label={`Consultation: ${approvalStatus || 'NONE'}`} />
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
            <ConsultationForm bookingId={booking.id} initialNotes={(booking as any).consultationNotes ?? ''} initialPrice={initialPrice} />

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
            Client hasn’t approved yet. Locked so you can’t accidentally proceed.
          </p>

          <Card>
            <div className="text-sm font-semibold text-textSecondary">
              Status: <span className="font-black text-textPrimary">{approvalStatus}</span>
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
          <p className="mt-1 text-sm font-semibold text-textSecondary">Do the fun part. We’ll handle the wrap-up next.</p>

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
          <h2 className="text-lg font-black">Wrap-up</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Next you’ll do aftercare + after photos. Order doesn’t matter — just get both done.
          </p>

          <Card>
            <form action={goWrapUp}>
              <button type="submit" className={primaryBtnClass}>
                Go to wrap-up (aftercare + photos)
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {/* WRAP-UP (AFTER_PHOTOS step) */}
      {showWrapUp ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Wrap-up: aftercare + after photos</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            You can do these in any order. Client can review + rebook once aftercare is sent.
          </p>

          <Card>
            <div className="flex flex-wrap gap-2">
              <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/session/after-photos`} className={primaryLinkClass}>
                Open after photos
              </a>

              <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`} className={secondaryBtnClass}>
                Open aftercare
              </a>
            </div>

            <div className="mt-3 grid gap-2 text-sm">
              <div className="text-textSecondary">
                After photos: <span className="font-black text-textPrimary">{hasAfterPhoto ? `✅ (${afterCount})` : '❌ missing'}</span>
              </div>
              <div className="text-textSecondary">
                Aftercare: <span className="font-black text-textPrimary">{hasAftercare ? '✅ created' : '❌ missing'}</span>
              </div>
            </div>

            <div className="mt-4">
              <form action={completeSession}>
                <button
                  type="submit"
                  className={[
                    primaryBtnClass,
                    !(hasAfterPhoto && hasAftercare) ? 'opacity-60 cursor-not-allowed pointer-events-none' : '',
                  ].join(' ')}
                  aria-disabled={!(hasAfterPhoto && hasAftercare)}
                  title={!(hasAfterPhoto && hasAftercare) ? 'Add at least one after photo and create aftercare first.' : 'Complete the session.'}
                >
                  Complete session (locks step → DONE)
                </button>
              </form>

              {!(hasAfterPhoto && hasAftercare) ? (
                <div className="mt-2 text-xs font-semibold text-textSecondary">
                  Finish requirements first: {hasAfterPhoto ? '' : 'add an after photo'}{!hasAfterPhoto && !hasAftercare ? ' + ' : ''}{hasAftercare ? '' : 'create aftercare'}
                </div>
              ) : null}
            </div>
          </Card>
        </section>
      ) : null}

      {/* DONE */}
      {showDone ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Done</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Session is complete. If you haven’t sent aftercare yet, do it now so the client can check out + rebook.
          </p>

          <Card>
            <a href={`/pro/bookings/${encodeURIComponent(booking.id)}/aftercare`} className={primaryLinkClass}>
              Open aftercare
            </a>
          </Card>
        </section>
      ) : null}
    </main>
  )
}
