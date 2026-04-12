// app/pro/bookings/[id]/session/page.tsx
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ConsultationForm from '../ConsultationForm'
import { moneyToFixed2String } from '@/lib/money'
import {
  recordInPersonConsultationDecision,
  transitionSessionStep,
} from '@/lib/booking/writeBoundary'
import {
  BookingStatus,
  ConsultationApprovalStatus,
  ConsultationDecision,
  MediaPhase,
  Role,
  SessionStep,
} from '@prisma/client'

export const dynamic = 'force-dynamic'

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function labelForStep(step: SessionStep | string) {
  const s = upper(step || SessionStep.NONE)
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

function labelForConsultationStatus(status: ConsultationApprovalStatus | string | null) {
  const s = upper(status)
  if (s === 'PENDING') return 'Pending'
  if (s === 'APPROVED') return 'Approved'
  if (s === 'REJECTED') return 'Rejected'
  return status ? String(status) : 'NONE'
}

function labelForProofMethod(method: unknown) {
  const s = upper(method)
  if (s === 'REMOTE_SECURE_LINK') return 'Remote secure link'
  if (s === 'IN_PERSON_PRO_DEVICE') return 'In-person on pro device'
  return s || 'Unknown'
}

function labelForDecision(decision: unknown) {
  const s = upper(decision)
  if (s === 'APPROVED') return 'Approved'
  if (s === 'REJECTED') return 'Rejected'
  return s || 'Unknown'
}

function isTerminal(status: BookingStatus, finishedAt?: Date | null) {
  return (
    status === BookingStatus.CANCELLED ||
    status === BookingStatus.COMPLETED ||
    Boolean(finishedAt)
  )
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
  return (
    <div className="mt-4 rounded-card border border-white/10 bg-bgSecondary p-4">
      {children}
    </div>
  )
}

function formatMoneyFromUnknown(v: unknown): string {
  if (v == null) return ''

  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return ''
    if (s.startsWith('$')) return s

    const n = Number(s)
    if (Number.isFinite(n)) {
      const fixed = moneyToFixed2String(n)
      return fixed ? `$${fixed}` : s
    }

    return s
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    const fixed = moneyToFixed2String(v)
    return fixed ? `$${fixed}` : String(v)
  }

  if (typeof v === 'object' && v !== null) {
    const asString =
      typeof (v as { toString?: unknown }).toString === 'function'
        ? String(v)
        : ''
    const trimmed = asString.trim()

    if (!trimmed) return ''
    if (trimmed.startsWith('$')) return trimmed

    const n = Number(trimmed)
    if (Number.isFinite(n)) {
      const fixed = moneyToFixed2String(n)
      return fixed ? `$${fixed}` : trimmed
    }

    return trimmed
  }

  return ''
}

function formatDateTime(value: Date | null | undefined) {
  if (!value) return null
  return value.toLocaleString()
}

function WaitingForClientBanner() {
  return (
    <section className="mt-3 rounded-card border border-white/10 tovis-glass p-4 shadow-[0_14px_48px_rgba(0,0,0,0.35)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-bgPrimary text-[18px]">
          📸
        </div>

        <div className="min-w-0">
          <div className="text-[13px] font-black text-textPrimary">
            While you wait…
          </div>
          <div className="mt-1 text-[12px] font-semibold leading-snug text-textSecondary">
            Tap the <span className="font-black text-textPrimary">camera</span>{' '}
            in the footer and take{' '}
            <span className="font-black text-textPrimary">BEFORE</span> photos
            now.
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              It keeps the flow clean once the client approves.
            </div>
          </div>
        </div>

        <div className="ml-auto shrink-0">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-3 py-1 text-[11px] font-black text-textPrimary">
            Waiting on client
          </span>
        </div>
      </div>
    </section>
  )
}

type PageProps = { params: Promise<{ id: string }> }

function bookingHubHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session`
}

function bookingAftercareHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/aftercare`
}

function bookingBeforePhotosHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session/before-photos`
}

function bookingAfterPhotosHref(bookingId: string) {
  return `/pro/bookings/${encodeURIComponent(bookingId)}/session/after-photos`
}

async function transitionAction(bookingId: string, next: SessionStep) {
  'use server'

  const u = await getCurrentUser().catch(() => null)
  const maybeProId =
    u?.role === 'PRO' ? u.professionalProfile?.id ?? null : null

  if (!maybeProId) {
    redirect(`/login?from=${encodeURIComponent(bookingHubHref(bookingId))}`)
  }

  const proId = maybeProId

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, professionalId: true, status: true, finishedAt: true },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')
  if (isTerminal(booking.status, booking.finishedAt)) {
    redirect(bookingHubHref(bookingId))
  }

  await transitionSessionStep({
    bookingId,
    professionalId: proId,
    nextStep: next,
  })

  redirect(bookingHubHref(bookingId))
}

async function inPersonDecisionAction(
  bookingId: string,
  decision: ConsultationDecision,
) {
  'use server'

  const u = await getCurrentUser().catch(() => null)
  const maybeProId =
    u?.role === 'PRO' ? u.professionalProfile?.id ?? null : null
  const recordedByUserId = u?.id ?? null

  if (!maybeProId || !recordedByUserId) {
    redirect(`/login?from=${encodeURIComponent(bookingHubHref(bookingId))}`)
  }

  const proId = maybeProId

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, professionalId: true, status: true, finishedAt: true },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')
  if (isTerminal(booking.status, booking.finishedAt)) {
    redirect(bookingHubHref(bookingId))
  }

  await recordInPersonConsultationDecision({
    bookingId,
    professionalId: proId,
    recordedByUserId,
    decision,
    userAgent: 'pro_session_server_action',
  })

  redirect(bookingHubHref(bookingId))
}

export default async function ProBookingSessionPage(props: PageProps) {
  const { id } = await props.params
  const bookingId = String(id || '').trim()
  if (!bookingId) notFound()

  const user = await getCurrentUser().catch(() => null)
  const maybeProId =
    user?.role === 'PRO' ? user.professionalProfile?.id ?? null : null

  if (!maybeProId) {
    redirect(`/login?from=${encodeURIComponent(bookingHubHref(bookingId))}`)
  }

  const proId = maybeProId

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      finishedAt: true,
      sessionStep: true,

      service: { select: { name: true } },
      client: {
        select: {
          firstName: true,
          lastName: true,
          user: { select: { email: true } },
        },
      },

      subtotalSnapshot: true,
      totalAmount: true,
      consultationNotes: true,

      consultationApproval: {
        select: {
          status: true,
          proposedTotal: true,
          notes: true,
          approvedAt: true,
          rejectedAt: true,
          proof: {
            select: {
              id: true,
              decision: true,
              method: true,
              actedAt: true,
              recordedByUserId: true,
              clientActionTokenId: true,
              contactMethod: true,
              destinationSnapshot: true,
            },
          },
        },
      },
    },
  })

  if (!booking) notFound()
  if (booking.professionalId !== proId) redirect('/pro')

  const bookingStatus = booking.status
  const rawStep = booking.sessionStep ?? SessionStep.NONE

  const terminal = isTerminal(bookingStatus, booking.finishedAt)
  const isCancelled = bookingStatus === BookingStatus.CANCELLED
  const isCompleted =
    bookingStatus === BookingStatus.COMPLETED || Boolean(booking.finishedAt)

  const serviceName = booking.service?.name ?? 'Service'
  const clientName =
    `${booking.client?.firstName ?? ''} ${booking.client?.lastName ?? ''}`.trim() ||
    booking.client?.user?.email ||
    'Client'

  const approvalStatus = booking.consultationApproval?.status ?? null
  const consultApproved =
    approvalStatus === ConsultationApprovalStatus.APPROVED
  const consultRejected =
    approvalStatus === ConsultationApprovalStatus.REJECTED

  const consultationProof = booking.consultationApproval?.proof ?? null
  const hasConsultationProof = Boolean(consultationProof?.id)

  const initialPrice =
    formatMoneyFromUnknown(booking.consultationApproval?.proposedTotal) ||
    formatMoneyFromUnknown(booking.totalAmount) ||
    formatMoneyFromUnknown(booking.subtotalSnapshot) ||
    ''

  const [beforeCount, afterCount, aftercare] = await Promise.all([
    prisma.mediaAsset.count({
      where: {
        bookingId: booking.id,
        phase: MediaPhase.BEFORE,
        uploadedByRole: Role.PRO,
      },
    }),
    prisma.mediaAsset.count({
      where: {
        bookingId: booking.id,
        phase: MediaPhase.AFTER,
        uploadedByRole: Role.PRO,
      },
    }),
    prisma.aftercareSummary.findFirst({
      where: { bookingId: booking.id },
      select: {
        id: true,
        publicToken: true,
        draftSavedAt: true,
        sentToClientAt: true,
        lastEditedAt: true,
        version: true,
      },
    }),
  ])

  const hasBeforePhoto = beforeCount > 0
  const hasAfterPhoto = afterCount > 0
  const hasAftercareDraft = Boolean(aftercare?.id)
  const hasFinalizedAftercare = Boolean(aftercare?.sentToClientAt)

  const effectiveStep: SessionStep = (() => {
    if (bookingStatus === BookingStatus.PENDING) {
      return SessionStep.CONSULTATION
    }

    if (approvalStatus === ConsultationApprovalStatus.REJECTED) {
      return SessionStep.CONSULTATION
    }

    if (
      approvalStatus === ConsultationApprovalStatus.APPROVED &&
      rawStep === SessionStep.CONSULTATION_PENDING_CLIENT
    ) {
      return SessionStep.BEFORE_PHOTOS
    }

    if (!consultApproved) {
      if (
        rawStep === SessionStep.BEFORE_PHOTOS ||
        rawStep === SessionStep.SERVICE_IN_PROGRESS ||
        rawStep === SessionStep.FINISH_REVIEW ||
        rawStep === SessionStep.AFTER_PHOTOS ||
        rawStep === SessionStep.DONE
      ) {
        return SessionStep.CONSULTATION
      }
    }

    return rawStep
  })()

  const toConsult = transitionAction.bind(
    null,
    bookingId,
    SessionStep.CONSULTATION,
  )
  const toBefore = transitionAction.bind(
    null,
    bookingId,
    SessionStep.BEFORE_PHOTOS,
  )
  const toService = transitionAction.bind(
    null,
    bookingId,
    SessionStep.SERVICE_IN_PROGRESS,
  )
  const toFinishReview = transitionAction.bind(
    null,
    bookingId,
    SessionStep.FINISH_REVIEW,
  )
  const toWrapUp = transitionAction.bind(
    null,
    bookingId,
    SessionStep.AFTER_PHOTOS,
  )
  const approveInPerson = inPersonDecisionAction.bind(
    null,
    bookingId,
    ConsultationDecision.APPROVED,
  )
  const rejectInPerson = inPersonDecisionAction.bind(
    null,
    bookingId,
    ConsultationDecision.REJECTED,
  )

  async function completeSession() {
    'use server'

    const u = await getCurrentUser().catch(() => null)
    const maybeUserProId =
      u?.role === 'PRO' ? u.professionalProfile?.id ?? null : null

    if (!maybeUserProId) {
      redirect(`/login?from=${encodeURIComponent(bookingHubHref(bookingId))}`)
    }

    const currentProId = maybeUserProId

    const freshBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true, status: true, finishedAt: true },
    })

    if (!freshBooking) notFound()
    if (freshBooking.professionalId !== currentProId) redirect('/pro')
    if (isTerminal(freshBooking.status, freshBooking.finishedAt)) {
      redirect(bookingHubHref(bookingId))
    }

    const done = await transitionSessionStep({
      bookingId,
      professionalId: currentProId,
      nextStep: SessionStep.DONE,
    })

    if (done.ok) redirect(bookingAftercareHref(bookingId))

    await transitionSessionStep({
      bookingId,
      professionalId: currentProId,
      nextStep: SessionStep.AFTER_PHOTOS,
    }).catch(() => null)

    redirect(bookingHubHref(bookingId))
  }

  const showConsult =
    effectiveStep === SessionStep.NONE ||
    effectiveStep === SessionStep.CONSULTATION ||
    bookingStatus === BookingStatus.PENDING

  const showWaiting =
    effectiveStep === SessionStep.CONSULTATION_PENDING_CLIENT &&
    approvalStatus !== ConsultationApprovalStatus.APPROVED

  const showBefore =
    effectiveStep === SessionStep.BEFORE_PHOTOS && consultApproved
  const showService = effectiveStep === SessionStep.SERVICE_IN_PROGRESS
  const showFinish = effectiveStep === SessionStep.FINISH_REVIEW
  const showWrapUp = effectiveStep === SessionStep.AFTER_PHOTOS
  const showDone = effectiveStep === SessionStep.DONE

  const showWaitingBanner =
    showWaiting &&
    approvalStatus === ConsultationApprovalStatus.PENDING &&
    !hasBeforePhoto

  const canUseInPersonFallback =
    showWaiting &&
    approvalStatus === ConsultationApprovalStatus.PENDING &&
    !hasConsultationProof

  const proofMethodLabel = consultationProof
    ? labelForProofMethod(consultationProof.method)
    : null
  const proofDecisionLabel = consultationProof
    ? labelForDecision(consultationProof.decision)
    : null
  const proofActedAtLabel = formatDateTime(consultationProof?.actedAt)
  const proofDestination = consultationProof?.destinationSnapshot?.trim() || null

  const primaryLinkClass =
    'inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover'
  const primaryBtnClass =
    'inline-flex items-center rounded-full border border-white/10 bg-accentPrimary px-4 py-2 text-xs font-black text-bgPrimary hover:bg-accentPrimaryHover'
  const secondaryBtnClass =
    'inline-flex items-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-xs font-black text-textPrimary hover:bg-surfaceGlass'
  const dangerBtnClass =
    'inline-flex items-center rounded-full border border-red-400/25 bg-red-400/10 px-4 py-2 text-xs font-black text-red-200 hover:bg-red-400/15'

  return (
    <main className="mx-auto mt-20 w-full max-w-3xl px-4 pb-10 text-textPrimary">
      <Link href="/pro" className={secondaryBtnClass}>
        ← Back to dashboard
      </Link>

      <h1 className="mt-4 text-xl font-black">Session: {serviceName}</h1>
      <div className="mt-1 text-sm font-semibold text-textSecondary">
        Client: {clientName}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StepPill step={labelForStep(effectiveStep)} />
        <Badge label={`Booking: ${bookingStatus}`} />
        <Badge label={`Consultation: ${labelForConsultationStatus(approvalStatus)}`} />
        {proofMethodLabel ? <Badge label={`Proof: ${proofMethodLabel}`} /> : null}
      </div>

      {consultationProof ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">
            Consultation proof recorded
          </div>
          <div className="mt-2 grid gap-1 text-sm text-textSecondary">
            <div>
              Decision:{' '}
              <span className="font-black text-textPrimary">
                {proofDecisionLabel}
              </span>
            </div>
            <div>
              Method:{' '}
              <span className="font-black text-textPrimary">
                {proofMethodLabel}
              </span>
            </div>
            {proofActedAtLabel ? (
              <div>
                Recorded:{' '}
                <span className="font-black text-textPrimary">
                  {proofActedAtLabel}
                </span>
              </div>
            ) : null}
            {proofDestination ? (
              <div>
                Destination:{' '}
                <span className="font-black text-textPrimary">
                  {proofDestination}
                </span>
              </div>
            ) : null}
            {consultationProof.recordedByUserId ? (
              <div>
                Recorded by user:{' '}
                <span className="font-black text-textPrimary">
                  {consultationProof.recordedByUserId}
                </span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {isCancelled ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">
            This booking is cancelled.
          </div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">
            Nothing to do here.
          </div>
        </Card>
      ) : null}

      {isCompleted ? (
        <Card>
          <div className="text-sm font-black text-textPrimary">
            This booking is completed.
          </div>
          <Link
            href={bookingAftercareHref(booking.id)}
            className={[primaryLinkClass, 'mt-3'].join(' ')}
          >
            View aftercare
          </Link>
        </Card>
      ) : null}

      {showConsult && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Consultation</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Confirm services + price with the client, then send it for client
            approval.
          </p>

          <div className="mt-3 rounded-card border border-white/10 bg-bgSecondary p-4">
            {consultRejected ? (
              <div className="mb-4 rounded-card border border-red-400/20 bg-red-400/5 p-3">
                <div className="text-sm font-black text-textPrimary">
                  Consultation needs changes
                </div>
                <div className="mt-1 text-xs font-semibold text-textSecondary">
                  The last decision was{' '}
                  <span className="font-black text-textPrimary">
                    rejected
                  </span>
                  {proofMethodLabel ? (
                    <>
                      {' '}via{' '}
                      <span className="font-black text-textPrimary">
                        {proofMethodLabel}
                      </span>
                    </>
                  ) : null}
                  . Update the proposal and resend it when ready.
                </div>
              </div>
            ) : null}

            <ConsultationForm
              bookingId={booking.id}
              initialNotes={booking.consultationNotes ?? ''}
              initialPrice={initialPrice}
            />

            <div className="mt-3 text-xs font-semibold text-textSecondary">
              After you submit, it moves to{' '}
              <span className="font-black text-textPrimary">
                Waiting on client
              </span>
              .
            </div>

            {bookingStatus === BookingStatus.ACCEPTED && consultApproved ? (
              <form action={toBefore} className="mt-4">
                <button type="submit" className={primaryBtnClass}>
                  Proceed to before photos
                </button>
              </form>
            ) : null}

            {bookingStatus === BookingStatus.PENDING ? (
              <div className="mt-4 text-xs font-semibold text-textSecondary">
                This booking is{' '}
                <span className="font-black text-textPrimary">PENDING</span>.
                Accept it before starting the session.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {showWaiting && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Waiting on client approval</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Client hasn’t approved yet. Locked so you can’t accidentally proceed.
          </p>

          {showWaitingBanner ? <WaitingForClientBanner /> : null}

          <Card>
            <div className="text-sm font-semibold text-textSecondary">
              Status:{' '}
              <span className="font-black text-textPrimary">
                {labelForConsultationStatus(approvalStatus)}
              </span>
            </div>

            <div className="mt-2 text-xs font-semibold text-textSecondary">
              Remote approval stays the default path. Only use the in-person
              fallback when the client is physically with you and cannot access
              their secure link. It will be recorded honestly as{' '}
              <span className="font-black text-textPrimary">
                in-person on pro device
              </span>
              .
            </div>

            {canUseInPersonFallback ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={approveInPerson}>
                  <button type="submit" className={primaryBtnClass}>
                    Record in-person approval
                  </button>
                </form>

                <form action={rejectInPerson}>
                  <button type="submit" className={dangerBtnClass}>
                    Record in-person decline
                  </button>
                </form>
              </div>
            ) : null}

            <form action={toConsult} className="mt-3">
              <button type="submit" className={secondaryBtnClass}>
                Back to consult
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {showBefore && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Before photos</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Client approved. Capture before photos, then start the service.
          </p>

          <Card>
            <Link
              href={bookingBeforePhotosHref(booking.id)}
              className={primaryLinkClass}
            >
              Open before photos
            </Link>

            <form action={toService} className="mt-3">
              <button type="submit" className={secondaryBtnClass}>
                Start service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {showService && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Service in progress</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Do the fun part. We’ll handle the wrap-up next.
          </p>

          <Card>
            <form action={toFinishReview}>
              <button type="submit" className={primaryBtnClass}>
                Finish service
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {showFinish && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Wrap-up</h2>
          <p className="mt-1 text-sm font-semibold text-textSecondary">
            Next you’ll do aftercare + after photos. Order doesn’t matter — just
            get both done.
          </p>

          <Card>
            <form action={toWrapUp}>
              <button type="submit" className={primaryBtnClass}>
                Go to wrap-up (aftercare + photos)
              </button>
            </form>
          </Card>
        </section>
      ) : null}

      {showWrapUp && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Wrap-up: aftercare + after photos</h2>

          <Card>
            <div className="flex flex-wrap gap-2">
              <Link
                href={bookingAfterPhotosHref(booking.id)}
                className={primaryLinkClass}
              >
                Open after photos
              </Link>

              <Link
                href={bookingAftercareHref(booking.id)}
                className={secondaryBtnClass}
              >
                Open aftercare
              </Link>
            </div>

            <div className="mt-3 grid gap-2 text-sm">
              <div className="text-textSecondary">
                After photos:{' '}
                <span className="font-black text-textPrimary">
                  {hasAfterPhoto ? `✅ (${afterCount})` : '❌ missing'}
                </span>
              </div>

              <div className="text-textSecondary">
                Aftercare:{' '}
                <span className="font-black text-textPrimary">
                  {hasFinalizedAftercare
                    ? '✅ finalized + sent'
                    : hasAftercareDraft
                      ? '📝 draft saved (not finalized)'
                      : '❌ missing'}
                </span>
              </div>

              {aftercare?.lastEditedAt && !hasFinalizedAftercare ? (
                <div className="text-xs font-semibold text-textSecondary">
                  Draft last edited:{' '}
                  <span className="font-black text-textPrimary">
                    {aftercare.lastEditedAt.toLocaleString()}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="mt-4">
              <form action={completeSession}>
                <button
                  type="submit"
                  className={[
                    primaryBtnClass,
                    !(hasAfterPhoto && hasFinalizedAftercare)
                      ? 'pointer-events-none cursor-not-allowed opacity-60'
                      : '',
                  ].join(' ')}
                  disabled={!(hasAfterPhoto && hasFinalizedAftercare)}
                  aria-disabled={!(hasAfterPhoto && hasFinalizedAftercare)}
                >
                  Complete session (requires finalized aftercare)
                </button>
              </form>
            </div>
          </Card>
        </section>
      ) : null}

      {showDone && !terminal ? (
        <section className="mt-6">
          <h2 className="text-lg font-black">Done</h2>
          <Card>
            <Link
              href={bookingAftercareHref(booking.id)}
              className={primaryLinkClass}
            >
              Open aftercare
            </Link>
          </Card>
        </section>
      ) : null}

      {!terminal &&
      !(
        showConsult ||
        showWaiting ||
        showBefore ||
        showService ||
        showFinish ||
        showWrapUp ||
        showDone
      ) ? (
        <Card>
          <div className="text-sm font-black">
            We couldn’t map this session state cleanly.
          </div>
          <div className="mt-1 text-sm font-semibold text-textSecondary">
            Step:{' '}
            <span className="font-black text-textPrimary">
              {String(rawStep)}
            </span>
          </div>
          <form action={toConsult} className="mt-3">
            <button type="submit" className={primaryBtnClass}>
              Back to consult
            </button>
          </form>
        </Card>
      ) : null}
    </main>
  )
}