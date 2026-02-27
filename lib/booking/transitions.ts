// lib/booking/transitions.ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { BookingStatus, SessionStep } from '@prisma/client'
import { upper } from '@/lib/booking/guards'

type TransitionResult =
  | { ok: true; booking: { id: string; sessionStep: SessionStep; startedAt: Date | null } }
  | { ok: false; status: number; error: string; forcedStep?: SessionStep }

function isTerminal(status: BookingStatus, finishedAt: Date | null) {
  return status === 'CANCELLED' || status === 'COMPLETED' || Boolean(finishedAt)
}

function requiresApprovedConsult(step: SessionStep) {
  return (
    step === SessionStep.SERVICE_IN_PROGRESS ||
    step === SessionStep.FINISH_REVIEW ||
    step === SessionStep.AFTER_PHOTOS ||
    step === SessionStep.DONE ||
    step === SessionStep.BEFORE_PHOTOS
  )
}

function allowedTransition(from: SessionStep, to: SessionStep) {
  if (from === to) return true

  if (from === SessionStep.NONE) return to === SessionStep.CONSULTATION

  if (from === SessionStep.CONSULTATION)
    return to === SessionStep.CONSULTATION_PENDING_CLIENT || to === SessionStep.BEFORE_PHOTOS

  if (from === SessionStep.CONSULTATION_PENDING_CLIENT)
    return to === SessionStep.BEFORE_PHOTOS || to === SessionStep.CONSULTATION

  if (from === SessionStep.BEFORE_PHOTOS)
    return to === SessionStep.SERVICE_IN_PROGRESS || to === SessionStep.CONSULTATION

  if (from === SessionStep.SERVICE_IN_PROGRESS) return to === SessionStep.FINISH_REVIEW
  if (from === SessionStep.FINISH_REVIEW) return to === SessionStep.AFTER_PHOTOS

  if (from === SessionStep.AFTER_PHOTOS) return to === SessionStep.DONE || to === SessionStep.FINISH_REVIEW

  if (from === SessionStep.DONE) return false

  return false
}

/**
 * ✅ Tx-aware transition for callers that already have a transaction.
 * This prevents nested transactions in API routes.
 */
export async function transitionSessionStepTx(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; proId: string; nextStep: SessionStep },
): Promise<TransitionResult> {
  const { bookingId, proId, nextStep } = args

  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      professionalId: true,
      status: true,
      finishedAt: true,
      startedAt: true,
      sessionStep: true,
      consultationApproval: { select: { status: true } },
    },
  })

  if (!booking) return { ok: false, status: 404, error: 'Booking not found.' }
  if (booking.professionalId !== proId) return { ok: false, status: 403, error: 'Forbidden.' }
  if (isTerminal(booking.status, booking.finishedAt)) {
    return { ok: false, status: 409, error: 'Booking is completed/cancelled.' }
  }

  // Pending => consult only
  if (booking.status === BookingStatus.PENDING) {
    if (nextStep !== SessionStep.CONSULTATION && nextStep !== SessionStep.NONE) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { sessionStep: SessionStep.CONSULTATION },
        select: { id: true },
      })
      return { ok: false, status: 409, error: 'Pending bookings are consultation-only.', forcedStep: SessionStep.CONSULTATION }
    }
  }

  const from = booking.sessionStep ?? SessionStep.NONE

  if (!allowedTransition(from, nextStep)) {
    return { ok: false, status: 409, error: `Invalid transition: ${from} → ${nextStep}.` }
  }

  const approval = upper(booking.consultationApproval?.status)
  if (requiresApprovedConsult(nextStep) && approval !== 'APPROVED') {
    await tx.booking.update({
      where: { id: booking.id },
      data: { sessionStep: SessionStep.CONSULTATION },
      select: { id: true },
    })
    return { ok: false, status: 409, error: 'Waiting for client approval.', forcedStep: SessionStep.CONSULTATION }
  }

  // Optional: enforce “must have before media” before SERVICE_IN_PROGRESS
  if (nextStep === SessionStep.SERVICE_IN_PROGRESS) {
    const beforeCount = await tx.mediaAsset.count({
      where: { bookingId: booking.id, phase: 'BEFORE', uploadedByRole: 'PRO' },
    })
    if (beforeCount <= 0) {
      return { ok: false, status: 409, error: 'Upload at least one BEFORE photo before starting service.' }
    }
  }

  // Enforce DONE requirements if you want DONE via this endpoint
  if (nextStep === SessionStep.DONE) {
    const [beforeCount, afterCount, aftercare] = await Promise.all([
      tx.mediaAsset.count({ where: { bookingId: booking.id, phase: 'BEFORE', uploadedByRole: 'PRO' } }),
      tx.mediaAsset.count({ where: { bookingId: booking.id, phase: 'AFTER', uploadedByRole: 'PRO' } }),
      tx.aftercareSummary.findFirst({ where: { bookingId: booking.id }, select: { id: true } }),
    ])

    const missing: string[] = []
    if (beforeCount <= 0) missing.push('BEFORE photo')
    if (afterCount <= 0) missing.push('AFTER photo')
    if (!aftercare?.id) missing.push('aftercare')

    if (missing.length) {
      return {
        ok: false,
        status: 409,
        error: `Wrap-up incomplete: add ${missing.join(' + ')} before completing the session.`,
        forcedStep: SessionStep.AFTER_PHOTOS,
      }
    }
  }

  const shouldSetStartedAt = nextStep === SessionStep.SERVICE_IN_PROGRESS && !booking.startedAt

  const updated = await tx.booking.update({
    where: { id: booking.id },
    data: {
      sessionStep: nextStep,
      ...(shouldSetStartedAt ? { startedAt: new Date() } : {}),
    },
    select: { id: true, sessionStep: true, startedAt: true },
  })

  return { ok: true, booking: updated }
}

/**
 * ✅ Convenience wrapper (same external API you already use).
 */
export async function transitionSessionStep(args: {
  bookingId: string
  proId: string
  nextStep: SessionStep
}): Promise<TransitionResult> {
  return prisma.$transaction((tx) => transitionSessionStepTx(tx, args))
}